/**
 * Pull Idempotency Store Service - Phase 5.3
 *
 * Dedupe by pull_job_id. Conditional put so only first processing reserves the key;
 * duplicates get false. Use reason code DUPLICATE_PULL_JOB_ID in audit/metrics/ledger.
 */

import { DynamoDBDocumentClient, PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { Logger } from '../core/Logger';

const SK_METADATA = 'METADATA';
const TTL_SECONDS = 24 * 60 * 60; // 24h

function pk(pullJobId: string): string {
  return `IDEMPOTENCY#PULL#${pullJobId}`;
}

export class PullIdempotencyStoreService {
  constructor(
    private dynamoClient: DynamoDBDocumentClient,
    private tableName: string,
    private logger: Logger
  ) {}

  /**
   * Try to reserve the pull_job_id. Returns true if reserved (first time), false if duplicate.
   * Uses conditional put (attribute_not_exists(pk)) so only one caller wins under retries.
   */
  async tryReserve(pullJobId: string): Promise<boolean> {
    const key = pk(pullJobId);
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
      this.logger.debug('Pull idempotency key reserved', { pullJobId: key });
      return true;
    } catch (err: unknown) {
      const isConditionalCheckFailed =
        err &&
        typeof err === 'object' &&
        'name' in err &&
        (err as { name: string }).name === 'ConditionalCheckFailedException';
      if (isConditionalCheckFailed) {
        this.logger.debug('Pull idempotency key already exists (duplicate)', {
          pullJobId: key,
        });
        return false;
      }
      throw err;
    }
  }

  /** Check if key exists (for tests or audit). */
  async exists(pullJobId: string): Promise<boolean> {
    const result = await this.dynamoClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { pk: pk(pullJobId), sk: SK_METADATA },
      })
    );
    return !!result.Item;
  }
}
