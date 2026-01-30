/**
 * Decision Run State Service - Phase 5.2
 *
 * Manages DecisionRunState in DynamoDB for debounce/cooldown and atomic admission lock.
 * tryAcquireAdmissionLock uses conditional update so only one ALLOW proceeds under concurrency.
 */

import {
  DynamoDBDocumentClient,
  GetCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { Logger } from '../core/Logger';
import {
  DecisionRunStateV1,
  DecisionTriggerRegistryEntryV1,
  DecisionTriggerType,
} from '../../types/decision/DecisionTriggerTypes';

const SK_GLOBAL = 'RUN_STATE#GLOBAL';

function pk(tenantId: string, accountId: string): string {
  return `TENANT#${tenantId}#ACCOUNT#${accountId}`;
}

export interface TryAcquireAdmissionLockResult {
  acquired: boolean;
  reason?: string;
  explanation?: string;
}

export class DecisionRunStateService {
  constructor(
    private dynamoClient: DynamoDBDocumentClient,
    private tableName: string,
    private logger: Logger
  ) {}

  /**
   * Get current run state for tenant/account. Returns null if no state exists.
   */
  async getState(
    tenantId: string,
    accountId: string
  ): Promise<DecisionRunStateV1 | null> {
    const result = await this.dynamoClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { pk: pk(tenantId, accountId), sk: SK_GLOBAL },
      })
    );
    return (result.Item as DecisionRunStateV1) || null;
  }

  /**
   * Try to acquire the admission lock (atomic). Only one caller can succeed under concurrency.
   * On success, updates last_allowed_at_epoch and increments run_count_this_hour.
   * Condition: last_allowed_at_epoch + cooldown_seconds <= now (or attribute not exists).
   */
  async tryAcquireAdmissionLock(
    tenantId: string,
    accountId: string,
    _triggerType: DecisionTriggerType,
    registryEntry: DecisionTriggerRegistryEntryV1
  ): Promise<TryAcquireAdmissionLockResult> {
    const nowEpoch = Math.floor(Date.now() / 1000);
    const nowIso = new Date().toISOString();
    const cooldownBound = nowEpoch - registryEntry.cooldown_seconds;
    const primaryKey = { pk: pk(tenantId, accountId), sk: SK_GLOBAL };

    const maxPerAccount = registryEntry.max_per_account_per_hour;
    const exprAttrNames: Record<string, string> = {
      '#pk': 'pk',
      '#laae': 'last_allowed_at_epoch',
      '#rcth': 'run_count_this_hour',
    };
    const conditionParts: string[] = [
      'attribute_not_exists(#pk) OR #laae < :cooldownBound',
    ];
    const exprAttrValues: Record<string, number | string> = {
      ':cooldownBound': cooldownBound,
      ':nowEpoch': nowEpoch,
      ':nowIso': nowIso,
      ':zero': 0,
      ':one': 1,
    };

    if (maxPerAccount != null && maxPerAccount > 0) {
      conditionParts.push(
        'attribute_not_exists(#rcth) OR #rcth < :maxPerAccount'
      );
      exprAttrValues[':maxPerAccount'] = maxPerAccount;
    }

    try {
      await this.dynamoClient.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: primaryKey,
          UpdateExpression:
            'SET #laae = :nowEpoch, updated_at = :nowIso, #rcth = if_not_exists(#rcth, :zero) + :one',
          ConditionExpression: conditionParts.join(' AND '),
          ExpressionAttributeNames: exprAttrNames,
          ExpressionAttributeValues: exprAttrValues,
        })
      );
      this.logger.info('Admission lock acquired', {
        tenantId,
        accountId,
        nowEpoch,
      });
      return { acquired: true };
    } catch (err: unknown) {
      const isConditionalCheckFailed =
        err &&
        typeof err === 'object' &&
        'name' in err &&
        (err as { name: string }).name === 'ConditionalCheckFailedException';
      if (isConditionalCheckFailed) {
        this.logger.info('Admission lock not acquired (cooldown or limit)', {
          tenantId,
          accountId,
        });
        return {
          acquired: false,
          reason: 'COOLDOWN',
          explanation: 'Cooldown or max_per_account_per_hour not met',
        };
      }
      throw err;
    }
  }
}
