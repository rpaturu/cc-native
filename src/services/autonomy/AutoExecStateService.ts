/**
 * Auto-Exec State Service - Phase 5.4
 *
 * Idempotency state for auto-execute gate: RESERVED | PUBLISHED.
 * Prevents double budget consume under retries; RESERVED allows retry publish until PUBLISHED.
 * Stored in autonomy config table; TTL 90 days for audit.
 */

import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { AutoExecStateStatus, AutoExecStateV1 } from '../../types/autonomy/AutonomyTypes';
import { Logger } from '../core/Logger';

const PK_AUTO_EXEC_STATE = 'AUTO_EXEC_STATE';
const TTL_DAYS = 90;

function skState(actionIntentId: string): string {
  return actionIntentId;
}

export class AutoExecStateService {
  constructor(
    private dynamoClient: DynamoDBDocumentClient,
    private tableName: string,
    private logger: Logger
  ) {}

  /**
   * Get current state for action_intent_id. Returns null if never reserved/published.
   */
  async getState(actionIntentId: string): Promise<AutoExecStateV1 | null> {
    const result = await this.dynamoClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { pk: PK_AUTO_EXEC_STATE, sk: skState(actionIntentId) },
      })
    );
    return (result.Item as AutoExecStateV1) ?? null;
  }

  /**
   * Set state to RESERVED (after budget consume, before publish). Fails if already exists (conditional).
   */
  async setReserved(actionIntentId: string): Promise<void> {
    const now = new Date().toISOString();
    const ttl = Math.floor(Date.now() / 1000) + TTL_DAYS * 86400;
    const item: AutoExecStateV1 = {
      pk: PK_AUTO_EXEC_STATE,
      sk: skState(actionIntentId),
      action_intent_id: actionIntentId,
      status: 'RESERVED',
      updated_at: now,
      ttl,
    };
    await this.dynamoClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: item,
        ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)',
      })
    );
    this.logger.debug('Auto-exec state RESERVED', { action_intent_id: actionIntentId });
  }

  /**
   * Set state to PUBLISHED (after successful EventBridge publish). Overwrites RESERVED.
   */
  async setPublished(actionIntentId: string): Promise<void> {
    const now = new Date().toISOString();
    const ttl = Math.floor(Date.now() / 1000) + TTL_DAYS * 86400;
    const item: AutoExecStateV1 = {
      pk: PK_AUTO_EXEC_STATE,
      sk: skState(actionIntentId),
      action_intent_id: actionIntentId,
      status: 'PUBLISHED',
      updated_at: now,
      ttl,
    };
    await this.dynamoClient.send(
      new PutCommand({ TableName: this.tableName, Item: item })
    );
    this.logger.debug('Auto-exec state PUBLISHED', { action_intent_id: actionIntentId });
  }
}
