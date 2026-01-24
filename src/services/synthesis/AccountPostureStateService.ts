/**
 * Account Posture State Service - Phase 2
 * 
 * Manages AccountPostureState read model in DynamoDB.
 * Provides idempotent upserts with churn prevention.
 */

import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { AccountPostureStateV1 } from '../../types/PostureTypes';
import { Logger } from '../core/Logger';

const logger = new Logger('AccountPostureStateService');

/**
 * Account Posture State Service Configuration
 */
export interface AccountPostureStateServiceConfig {
  dynamoClient: DynamoDBDocumentClient;
  tableName: string;
}

/**
 * Account Posture State Service
 */
export class AccountPostureStateService {
  private dynamoClient: DynamoDBDocumentClient;
  private tableName: string;

  constructor(config: AccountPostureStateServiceConfig) {
    this.dynamoClient = config.dynamoClient;
    this.tableName = config.tableName;
  }

  /**
   * Get posture state (single DDB read)
   * 
   * Returns null if posture state doesn't exist.
   */
  async getPostureState(
    accountId: string,
    tenantId: string
  ): Promise<AccountPostureStateV1 | null> {
    try {
      const pk = `ACCOUNT#${tenantId}#${accountId}`;
      const sk = 'POSTURE#LATEST';

      const result = await this.dynamoClient.send(
        new GetCommand({
          TableName: this.tableName,
          Key: {
            pk,
            sk,
          },
        })
      );

      if (!result.Item) {
        return null;
      }

      return result.Item as AccountPostureStateV1;
    } catch (error) {
      logger.error('Failed to get posture state', { accountId, tenantId, error });
      throw error;
    }
  }

  /**
   * Write posture state (idempotent upsert with churn prevention)
   * 
   * Uses inputs_hash as idempotency key.
   * Only updates if inputs_hash changes (prevents churn).
   */
  async writePostureState(postureState: AccountPostureStateV1): Promise<void> {
    try {
      const pk = `ACCOUNT#${postureState.tenantId}#${postureState.account_id}`;
      const sk = 'POSTURE#LATEST';

      // Conditional write: only update if inputs_hash changes
      // This prevents churn when only event.as_of_time changes but signals/lifecycle don't
      await this.dynamoClient.send(
        new PutCommand({
          TableName: this.tableName,
          Item: {
            pk,
            sk,
            ...postureState,
          },
          // Churn prevention: only write if inputs_hash is new or changed
          ConditionExpression:
            'attribute_not_exists(inputs_hash) OR inputs_hash <> :new_inputs_hash',
          ExpressionAttributeValues: {
            ':new_inputs_hash': postureState.inputs_hash,
          },
        })
      );

      logger.debug('Posture state written', {
        accountId: postureState.account_id,
        tenantId: postureState.tenantId,
        inputsHash: postureState.inputs_hash,
      });
    } catch (error: any) {
      // ConditionalCheckFailedException means inputs_hash hasn't changed (expected, not an error)
      if (error.name === 'ConditionalCheckFailedException') {
        logger.debug('Posture state unchanged (inputs_hash matches existing)', {
          accountId: postureState.account_id,
          tenantId: postureState.tenantId,
          inputsHash: postureState.inputs_hash,
        });
        return; // Not an error - churn prevention working as intended
      }

      logger.error('Failed to write posture state', {
        accountId: postureState.account_id,
        tenantId: postureState.tenantId,
        error,
      });
      throw error;
    }
  }

  /**
   * Delete posture state (soft delete)
   * 
   * Marks posture state as deleted rather than removing it.
   */
  async deletePostureState(accountId: string, tenantId: string): Promise<void> {
    try {
      const pk = `ACCOUNT#${tenantId}#${accountId}`;
      const sk = 'POSTURE#LATEST';
      const now = new Date().toISOString();

      // Soft delete: mark as deleted
      await this.dynamoClient.send(
        new PutCommand({
          TableName: this.tableName,
          Item: {
            pk,
            sk,
            deleted: true,
            deleted_at: now,
            updated_at: now,
          },
        })
      );

      logger.debug('Posture state soft deleted', { accountId, tenantId });
    } catch (error) {
      logger.error('Failed to delete posture state', { accountId, tenantId, error });
      throw error;
    }
  }
}
