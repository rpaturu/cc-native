/**
 * Connector Concurrency Service - Phase 5.7
 *
 * Backpressure: limit in-flight calls per connector via DDB.
 * Primary mechanism per plan: SQS concurrency per connector; this DDB semaphore
 * implements "limit concurrent executions that call a given connector" for ship-first.
 *
 * Contract: PHASE_5_7_CODE_LEVEL_PLAN.md §4.
 */

import {
  DynamoDBDocumentClient,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { Logger } from '../core/Logger';

const PK_PREFIX = 'CONNECTOR#';
const SK_CONCURRENCY = 'CONCURRENCY';

export interface ConcurrencyAcquireResult {
  acquired: boolean;
  retryAfterSeconds?: number;
}

const DEFAULT_MAX_IN_FLIGHT = 20;

export class ConnectorConcurrencyService {
  constructor(
    private readonly dynamoClient: DynamoDBDocumentClient,
    private readonly tableName: string,
    private readonly logger: Logger,
    private readonly maxInFlightPerConnector: number = DEFAULT_MAX_IN_FLIGHT
  ) {}

  /**
   * Try to acquire a concurrency slot. Call release() in finally after the call.
   */
  async tryAcquire(connectorId: string): Promise<ConcurrencyAcquireResult> {
    const pk = PK_PREFIX + connectorId;
    try {
      await this.dynamoClient.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { pk, sk: SK_CONCURRENCY },
          UpdateExpression:
            'SET in_flight_count = if_not_exists(in_flight_count, :zero) + :one',
          ConditionExpression:
            'attribute_not_exists(in_flight_count) OR in_flight_count < :max',
          ExpressionAttributeValues: {
            ':zero': 0,
            ':one': 1,
            ':max': this.maxInFlightPerConnector,
          },
        })
      );
      return { acquired: true };
    } catch (e: unknown) {
      if (
        e &&
        typeof e === 'object' &&
        'name' in e &&
        e.name === 'ConditionalCheckFailedException'
      ) {
        this.logger.debug('Backpressure: at concurrency limit', {
          connectorId,
          max: this.maxInFlightPerConnector,
        });
        return { acquired: false, retryAfterSeconds: 5 };
      }
      throw e;
    }
  }

  /**
   * Release a concurrency slot (call in finally after connector call).
   * Best-effort: does not throw on double-release or missing item.
   */
  async release(connectorId: string): Promise<void> {
    const pk = PK_PREFIX + connectorId;
    try {
      await this.dynamoClient.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { pk, sk: SK_CONCURRENCY },
          UpdateExpression: 'SET in_flight_count = in_flight_count - :one',
          ConditionExpression: 'attribute_exists(in_flight_count) AND in_flight_count > :zero',
          ExpressionAttributeValues: { ':one': 1, ':zero': 0 },
        })
      );
    } catch (e: unknown) {
      if (
        e &&
        typeof e === 'object' &&
        'name' in e &&
        e.name === 'ConditionalCheckFailedException'
      ) {
        this.logger.debug('Concurrency release skipped (already zero or missing)', {
          connectorId,
        });
        return;
      }
      throw e;
    }
  }
}
