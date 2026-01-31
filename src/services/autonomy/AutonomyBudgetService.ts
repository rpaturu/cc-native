/**
 * Autonomy Budget Service - Phase 5.1
 *
 * Enforces max autonomous actions per account/day and per action type.
 * Uses atomic conditional update to prevent overspend under parallel execution.
 */

import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  AutonomyBudgetV1,
  AutonomyBudgetStateV1,
} from '../../types/autonomy/AutonomyTypes';
import { Logger } from '../core/Logger';

function pk(tenantId: string, accountId: string): string {
  return `TENANT#${tenantId}#ACCOUNT#${accountId}`;
}

const SK_CONFIG = 'BUDGET#CONFIG';

function skState(dateKey: string): string {
  return `BUDGET_STATE#${dateKey}`;
}

/**
 * State item shape: pk, sk = BUDGET_STATE#YYYY-MM-DD, total, counts = { [action_type]: number }, updated_at.
 * Single item per (tenant, account, date) for atomic daily + per-action-type limits.
 */
interface BudgetStateItem {
  pk: string;
  sk: string;
  tenant_id: string;
  account_id: string;
  date_key: string;
  total: number;
  counts: Record<string, number>;
  updated_at: string;
}

export class AutonomyBudgetService {
  constructor(
    private dynamoClient: DynamoDBDocumentClient,
    private tableName: string,
    private logger: Logger
  ) {}

  /**
   * Get budget config for tenant/account. Returns null if not set.
   */
  async getConfig(
    tenantId: string,
    accountId: string
  ): Promise<AutonomyBudgetV1 | null> {
    const result = await this.dynamoClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { pk: pk(tenantId, accountId), sk: SK_CONFIG },
      })
    );
    return (result.Item as AutonomyBudgetV1) || null;
  }

  /**
   * Write budget config.
   */
  async putConfig(config: AutonomyBudgetV1): Promise<void> {
    const item: AutonomyBudgetV1 = {
      ...config,
      pk: config.pk || pk(config.tenant_id, config.account_id),
      sk: config.sk || SK_CONFIG,
      updated_at: config.updated_at || new Date().toISOString(),
    };
    await this.dynamoClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: item,
      })
    );
    this.logger.debug('Autonomy budget config written', {
      tenant_id: config.tenant_id,
      account_id: config.account_id,
    });
  }

  /**
   * Check limits and consume one unit for the given action type (atomic).
   * Returns true if consumed, false if over limit (caller should treat as REQUIRE_APPROVAL).
   */
  async checkAndConsume(
    tenantId: string,
    accountId: string,
    actionType: string
  ): Promise<boolean> {
    const config = await this.getConfig(tenantId, accountId);
    if (!config) {
      this.logger.debug('No autonomy budget config; deny auto-execute');
      return false;
    }

    const maxDaily = config.max_autonomous_per_day ?? 0;
    const maxPerType =
      config.max_per_action_type?.[actionType] ?? maxDaily;

    if (maxDaily <= 0) {
      return false;
    }

    const dateKey = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const pkVal = pk(tenantId, accountId);
    const skVal = skState(dateKey);

    const now = new Date().toISOString();
    const firstUpdateValues = {
      ':zero': 0,
      ':one': 1,
      ':emptyMap': {} as Record<string, number>,
      ':now': now,
      ':tid': tenantId,
      ':aid': accountId,
      ':dk': dateKey,
      ':maxDaily': maxDaily,
    };
    const secondUpdateValues = {
      ':zero': 0,
      ':one': 1,
      ':now': now,
      ':maxPerType': maxPerType,
    };

    try {
      // First update: increment total and ensure counts map exists. Do not reference #counts.#at here:
      // DynamoDB can reject "document path invalid" when SET #counts and ConditionExpression #counts.#at are in the same request.
      await this.dynamoClient.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { pk: pkVal, sk: skVal },
          UpdateExpression:
            'SET #total = if_not_exists(#total, :zero) + :one, #counts = if_not_exists(#counts, :emptyMap), #updated_at = :now, #tenant_id = :tid, #account_id = :aid, #date_key = :dk',
          ConditionExpression: 'attribute_not_exists(#total) OR #total < :maxDaily',
          ExpressionAttributeNames: {
            '#total': 'total',
            '#counts': 'counts',
            '#updated_at': 'updated_at',
            '#tenant_id': 'tenant_id',
            '#account_id': 'account_id',
            '#date_key': 'date_key',
          },
          ExpressionAttributeValues: firstUpdateValues,
        })
      );
      // Second update: enforce per-type limit and increment (counts map now exists).
      // Only pass names used in this expression (DynamoDB rejects unused ExpressionAttributeNames).
      await this.dynamoClient.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { pk: pkVal, sk: skVal },
          UpdateExpression:
            'SET #counts.#at = if_not_exists(#counts.#at, :zero) + :one, #updated_at = :now',
          ConditionExpression:
            'attribute_not_exists(#counts.#at) OR #counts.#at < :maxPerType',
          ExpressionAttributeNames: {
            '#counts': 'counts',
            '#at': actionType,
            '#updated_at': 'updated_at',
          },
          ExpressionAttributeValues: secondUpdateValues,
        })
      );
      return true;
    } catch (err: unknown) {
      const name = err && typeof err === 'object' && 'name' in err ? (err as { name: string }).name : '';
      if (name === 'ConditionalCheckFailedException') {
        this.logger.debug('Autonomy budget limit reached', {
          tenantId,
          accountId,
          actionType,
          dateKey,
        });
        // First update already incremented total; roll it back so total stays consistent with counts.
        try {
          await this.dynamoClient.send(
            new UpdateCommand({
              TableName: this.tableName,
              Key: { pk: pkVal, sk: skVal },
              UpdateExpression: 'SET #total = #total - :one, #updated_at = :now',
              ConditionExpression: 'attribute_exists(#total) AND #total >= :one',
              ExpressionAttributeNames: { '#total': 'total', '#updated_at': 'updated_at' },
              ExpressionAttributeValues: { ':one': 1, ':now': new Date().toISOString() },
            })
          );
        } catch {
          // Best-effort rollback; ignore so caller still gets false
        }
        return false;
      }
      throw err;
    }
  }

  /**
   * Get current day state for tenant/account (for admin/UI).
   */
  async getStateForDate(
    tenantId: string,
    accountId: string,
    dateKey: string
  ): Promise<BudgetStateItem | null> {
    const result = await this.dynamoClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { pk: pk(tenantId, accountId), sk: skState(dateKey) },
      })
    );
    return (result.Item as BudgetStateItem) || null;
  }
}
