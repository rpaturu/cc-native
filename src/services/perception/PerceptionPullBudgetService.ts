/**
 * Perception Pull Budget Service - Phase 5.3
 *
 * Runtime pull budget state + atomic consume. Per-connector cap first, then tenant total;
 * reject if either cap would be exceeded. Uses DDB conditional update (or transaction when both caps).
 */

import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  CheckAndConsumePullBudgetResult,
  PerceptionPullBudgetV1,
  PerceptionPullBudgetStateV1,
} from '../../types/perception/PerceptionSchedulerTypes';
import { Logger } from '../core/Logger';

const SK_BUDGET_PULL = 'BUDGET#PULL';

function pkTenant(tenantId: string): string {
  return `TENANT#${tenantId}`;
}

function skState(dateKey: string): string {
  return `BUDGET_STATE#${dateKey}`;
}

function skStateConnector(dateKey: string, connectorId: string): string {
  return `BUDGET_STATE#${dateKey}#CONNECTOR#${connectorId}`;
}

export class PerceptionPullBudgetService {
  constructor(
    private dynamoClient: DynamoDBDocumentClient,
    private tableName: string,
    private logger: Logger
  ) {}

  /** Get pull budget config for tenant. */
  async getConfig(tenantId: string): Promise<PerceptionPullBudgetV1 | null> {
    const result = await this.dynamoClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { pk: pkTenant(tenantId), sk: SK_BUDGET_PULL },
      })
    );
    return (result.Item as PerceptionPullBudgetV1) ?? null;
  }

  /** Write pull budget config. */
  async putConfig(config: PerceptionPullBudgetV1): Promise<void> {
    const item: PerceptionPullBudgetV1 = {
      ...config,
      pk: config.pk || pkTenant(config.tenant_id),
      sk: config.sk || SK_BUDGET_PULL,
      updated_at: config.updated_at || new Date().toISOString(),
    };
    await this.dynamoClient.send(
      new PutCommand({ TableName: this.tableName, Item: item })
    );
    this.logger.debug('Perception pull budget config written', {
      tenant_id: config.tenant_id,
    });
  }

  /**
   * Atomic consume: per-connector cap first, then tenant total; reject if either would be exceeded.
   * Returns { allowed, remaining }.
   */
  async checkAndConsumePullBudget(
    tenantId: string,
    connectorId: string,
    depthUnits: number
  ): Promise<CheckAndConsumePullBudgetResult> {
    const config = await this.getConfig(tenantId);
    if (!config) {
      this.logger.debug('No perception pull budget config; deny');
      return { allowed: false };
    }

    const maxTenant = config.max_pull_units_per_day ?? 0;
    const maxConnector =
      config.max_per_connector_per_day?.[connectorId] ?? maxTenant;

    if (maxTenant <= 0) {
      return { allowed: false };
    }

    const dateKey = new Date().toISOString().slice(0, 10);
    const pkVal = pkTenant(tenantId);
    const now = new Date().toISOString();

    const exprNames = {
      '#uc': 'units_consumed',
      '#pc': 'pull_count',
      '#ua': 'updated_at',
      '#tid': 'tenant_id',
      '#dk': 'date_key',
    };
    const maxTenantAfter = maxTenant - depthUnits;
    const maxConnectorAfter = maxConnector - depthUnits;
    const exprValuesTenantOnly = {
      ':units': depthUnits,
      ':one': 1,
      ':now': now,
      ':tid': tenantId,
      ':dk': dateKey,
      ':maxTenantAfter': maxTenantAfter,
      ':zero': 0,
    };
    const exprValuesWithConnector = {
      ...exprValuesTenantOnly,
      ':maxConnectorAfter': maxConnectorAfter,
    };

    try {
      if (
        maxConnector !== maxTenant &&
        config.max_per_connector_per_day?.[connectorId] != null
      ) {
        await this.dynamoClient.send(
          new TransactWriteCommand({
            TransactItems: [
              {
                Update: {
                  TableName: this.tableName,
                  Key: {
                    pk: pkVal,
                    sk: skStateConnector(dateKey, connectorId),
                  },
                  UpdateExpression:
                    'SET #uc = if_not_exists(#uc, :zero) + :units, #pc = if_not_exists(#pc, :zero) + :one, #ua = :now, #tid = :tid, #dk = :dk, #cid = :cid',
                  ConditionExpression:
                    'attribute_not_exists(#uc) OR #uc <= :maxConnectorAfter',
                  ExpressionAttributeNames: { ...exprNames, '#cid': 'connector_id' },
                  ExpressionAttributeValues: { ...exprValuesWithConnector, ':cid': connectorId },
                },
              },
              {
                Update: {
                  TableName: this.tableName,
                  Key: { pk: pkVal, sk: skState(dateKey) },
                  UpdateExpression:
                    'SET #uc = if_not_exists(#uc, :zero) + :units, #pc = if_not_exists(#pc, :zero) + :one, #ua = :now, #tid = :tid, #dk = :dk',
                  ConditionExpression:
                    'attribute_not_exists(#uc) OR #uc <= :maxTenantAfter',
                  ExpressionAttributeNames: exprNames,
                  ExpressionAttributeValues: exprValuesTenantOnly,
                },
              },
            ],
          })
        );
      } else {
        await this.dynamoClient.send(
          new UpdateCommand({
            TableName: this.tableName,
            Key: { pk: pkVal, sk: skState(dateKey) },
            UpdateExpression:
              'SET #uc = if_not_exists(#uc, :zero) + :units, #pc = if_not_exists(#pc, :zero) + :one, #ua = :now, #tid = :tid, #dk = :dk',
            ConditionExpression:
              'attribute_not_exists(#uc) OR #uc <= :maxTenantAfter',
            ExpressionAttributeNames: exprNames,
            ExpressionAttributeValues: exprValuesTenantOnly,
          })
        );
      }

      const remaining = Math.max(0, maxTenant - depthUnits);
      this.logger.debug('Perception pull budget consumed', {
        tenantId,
        connectorId,
        depthUnits,
      });
      return { allowed: true, remaining };
    } catch (err: unknown) {
      const name =
        err && typeof err === 'object' && 'name' in err
          ? (err as { name: string }).name
          : '';
      if (name === 'ConditionalCheckFailedException' || name === 'TransactionCanceledException') {
        this.logger.debug('Perception pull budget limit reached', {
          tenantId,
          connectorId,
          dateKey,
        });
        return { allowed: false };
      }
      throw err;
    }
  }

  /** Get state for date (tenant total) for admin/UI. */
  async getStateForDate(
    tenantId: string,
    dateKey: string
  ): Promise<PerceptionPullBudgetStateV1 | null> {
    const result = await this.dynamoClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { pk: pkTenant(tenantId), sk: skState(dateKey) },
      })
    );
    return (result.Item as PerceptionPullBudgetStateV1) ?? null;
  }
}
