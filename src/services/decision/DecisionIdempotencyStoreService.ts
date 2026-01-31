/**
 * Decision Idempotency Store Service - Phase 5.2
 *
 * Dedupe by idempotency_key for RUN_DECISION events. Conditional put so only first
 * processing reserves the key; duplicates get false. Independent of cooldown.
 */

import { DynamoDBDocumentClient, PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { Logger } from '../core/Logger';

const SK_METADATA = 'METADATA';
const TTL_SECONDS = 24 * 60 * 60; // 24h

function pk(idempotencyKey: string): string {
  return `IDEMPOTENCY#${idempotencyKey}`;
}

export class DecisionIdempotencyStoreService {
  constructor(
    private dynamoClient: DynamoDBDocumentClient,
    private tableName: string,
    private logger: Logger
  ) {}

  /**
   * Try to reserve the idempotency key. Returns true if reserved (first time), false if duplicate.
   * Uses conditional put (attribute_not_exists(pk)) so only one caller wins under retries.
   */
  async tryReserve(idempotencyKey: string): Promise<boolean> {
    const key = pk(idempotencyKey);
    const nowIso = new Date().toISOString();
    const ttl = Math.floor(Date.now() / 1000) + TTL_SECONDS;

    try {
      await this.dynamoClient.send(
        new PutCommand({
          TableName: this.tableName,
          Item: {
            pk: key,
            sk: SK_METADATA,
            reserved_at: nowIso,
            ttl,
          },
          ConditionExpression: 'attribute_not_exists(pk)',
        })
      );
      this.logger.info('Idempotency key reserved', { idempotencyKey: key });
      return true;
    } catch (err: unknown) {
      const isConditionalCheckFailed =
        err &&
        typeof err === 'object' &&
        'name' in err &&
        (err as { name: string }).name === 'ConditionalCheckFailedException';
      if (isConditionalCheckFailed) {
        this.logger.info('Idempotency key already exists (duplicate)', {
          idempotencyKey: key,
        });
        return false;
      }
      throw err;
    }
  }

  /**
   * Check if key exists (for tests or audit). Not used in hot path.
   */
  async exists(idempotencyKey: string): Promise<boolean> {
    const result = await this.dynamoClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { pk: pk(idempotencyKey), sk: SK_METADATA },
      })
    );
    return !!result.Item;
  }
}
