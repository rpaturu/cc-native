/**
 * Circuit Breaker Service - Phase 5.7
 *
 * Persistent state in DDB (key CONNECTOR#<connector_id>, sk STATE).
 * Failure window: N failures in T seconds. Strict single probe in HALF_OPEN
 * via conditional writes. TTL 7–30 days on state record.
 *
 * Contract: PHASE_5_7_CODE_LEVEL_PLAN.md §1.
 */

import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { Logger } from '../core/Logger';
import type { CircuitBreakerStateV1, CircuitState, CircuitBreakerConfig } from '../../types/phase5/CircuitBreakerTypes';
import { DEFAULT_CIRCUIT_BREAKER_CONFIG } from '../../types/phase5/CircuitBreakerTypes';

export interface AllowRequestResult {
  allowed: boolean;
  state?: CircuitState;
  retryAfterSeconds?: number;
}

export class CircuitBreakerService {
  private readonly pkPrefix = 'CONNECTOR#';
  private readonly skState = 'STATE';

  constructor(
    private readonly dynamoClient: DynamoDBDocumentClient,
    private readonly tableName: string,
    private readonly logger: Logger,
    private readonly config: CircuitBreakerConfig = DEFAULT_CIRCUIT_BREAKER_CONFIG
  ) {}

  /**
   * Check if a request is allowed (circuit CLOSED or we won the HALF_OPEN probe).
   * If OPEN and past cooldown, one caller will win the conditional write and be allowed (probe).
   */
  async allowRequest(connectorId: string): Promise<AllowRequestResult> {
    const nowSec = Math.floor(Date.now() / 1000);
    const pk = this.pkPrefix + connectorId;

    const state = await this.getState(connectorId);

    if (!state) {
      return { allowed: true };
    }

    if (state.state === 'CLOSED') {
      return { allowed: true, state: 'CLOSED' };
    }

    if (state.state === 'OPEN') {
      const openUntil = state.open_until_epoch_sec ?? 0;
      if (nowSec < openUntil) {
        return {
          allowed: false,
          state: 'OPEN',
          retryAfterSeconds: Math.max(1, openUntil - nowSec),
        };
      }
      const wonProbe = await this.tryTransitionOpenToHalfOpen(connectorId, pk, nowSec);
      if (wonProbe) {
        return { allowed: true, state: 'HALF_OPEN' };
      }
      return {
        allowed: false,
        state: 'HALF_OPEN',
        retryAfterSeconds: this.config.cooldownSeconds,
      };
    }

    if (state.state === 'HALF_OPEN') {
      if (state.half_open_probe_in_flight === true) {
        return {
          allowed: false,
          state: 'HALF_OPEN',
          retryAfterSeconds: this.config.cooldownSeconds,
        };
      }
      return { allowed: false, state: 'HALF_OPEN', retryAfterSeconds: this.config.cooldownSeconds };
    }

    return { allowed: true };
  }

  /**
   * Record success: close circuit if HALF_OPEN; otherwise reset or decrement failure count in window.
   */
  async recordSuccess(connectorId: string): Promise<void> {
    const nowSec = Math.floor(Date.now() / 1000);
    const pk = this.pkPrefix + connectorId;
    const ttlSec = nowSec + this.config.stateTtlDays * 86400;

    const state = await this.getState(connectorId);

    if (!state) {
      return;
    }

    if (state.state === 'HALF_OPEN') {
      await this.dynamoClient.send(
        new PutCommand({
          TableName: this.tableName,
          Item: {
            pk,
            sk: this.skState,
            state: 'CLOSED',
            failure_count: 0,
            window_start_epoch_sec: nowSec,
            ttl_epoch_sec: ttlSec,
          },
        })
      );
      this.logger.info('Circuit closed after successful probe', { connectorId });
      return;
    }

    if (state.state === 'CLOSED') {
      await this.dynamoClient.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { pk, sk: this.skState },
          UpdateExpression: 'SET failure_count = :zero, window_start_epoch_sec = :now, #ttl = :ttl',
          ExpressionAttributeNames: { '#ttl': 'ttl_epoch_sec' },
          ExpressionAttributeValues: {
            ':zero': 0,
            ':now': nowSec,
            ':ttl': ttlSec,
          },
        })
      );
    }
  }

  /**
   * Record failure: increment count; if >= threshold in window, open circuit.
   * If HALF_OPEN, reopen circuit.
   */
  async recordFailure(connectorId: string): Promise<void> {
    const nowSec = Math.floor(Date.now() / 1000);
    const pk = this.pkPrefix + connectorId;
    const ttlSec = nowSec + this.config.stateTtlDays * 86400;

    const state = await this.getState(connectorId);

    if (!state) {
      await this.dynamoClient.send(
        new PutCommand({
          TableName: this.tableName,
          Item: {
            pk,
            sk: this.skState,
            state: 'CLOSED',
            failure_count: 1,
            window_start_epoch_sec: nowSec,
            ttl_epoch_sec: ttlSec,
          },
        })
      );
      if (1 >= this.config.failureThreshold) {
        await this.openCircuit(connectorId, nowSec, ttlSec);
      }
      return;
    }

    if (state.state === 'HALF_OPEN') {
      await this.openCircuit(connectorId, nowSec, ttlSec);
      this.logger.info('Circuit reopened after probe failure', { connectorId });
      return;
    }

    const windowStart = state.window_start_epoch_sec ?? nowSec;
    const inWindow = nowSec - windowStart <= this.config.windowSeconds;
    const newCount = inWindow ? (state.failure_count ?? 0) + 1 : 1;
    const newWindowStart = inWindow ? windowStart : nowSec;

    if (newCount >= this.config.failureThreshold) {
      await this.dynamoClient.send(
        new PutCommand({
          TableName: this.tableName,
          Item: {
            pk,
            sk: this.skState,
            state: 'OPEN',
            failure_count: newCount,
            window_start_epoch_sec: newWindowStart,
            open_until_epoch_sec: nowSec + this.config.cooldownSeconds,
            ttl_epoch_sec: ttlSec,
          },
        })
      );
      this.logger.info('Circuit opened', { connectorId, failureCount: newCount });
    } else {
      await this.dynamoClient.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { pk, sk: this.skState },
          UpdateExpression:
            'SET failure_count = :count, window_start_epoch_sec = :ws, #ttl = :ttl',
          ExpressionAttributeNames: { '#ttl': 'ttl_epoch_sec' },
          ExpressionAttributeValues: {
            ':count': newCount,
            ':ws': newWindowStart,
            ':ttl': ttlSec,
          },
        })
      );
    }
  }

  async getState(connectorId: string): Promise<CircuitBreakerStateV1 | null> {
    const pk = this.pkPrefix + connectorId;
    const res = await this.dynamoClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { pk, sk: this.skState },
      })
    );
    const item = res.Item as CircuitBreakerStateV1 | undefined;
    return item ?? null;
  }

  private async tryTransitionOpenToHalfOpen(
    connectorId: string,
    pk: string,
    nowSec: number
  ): Promise<boolean> {
    const ttlSec = nowSec + this.config.stateTtlDays * 86400;
    try {
      await this.dynamoClient.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { pk, sk: this.skState },
          UpdateExpression:
            'SET #st = :halfOpen, half_open_probe_in_flight = :true, #ttl = :ttl REMOVE open_until_epoch_sec',
          ConditionExpression: '#st = :open AND (attribute_not_exists(half_open_probe_in_flight) OR half_open_probe_in_flight = :false)',
          ExpressionAttributeNames: { '#st': 'state', '#ttl': 'ttl_epoch_sec' },
          ExpressionAttributeValues: {
            ':halfOpen': 'HALF_OPEN',
            ':true': true,
            ':open': 'OPEN',
            ':false': false,
            ':ttl': ttlSec,
          },
        })
      );
      return true;
    } catch (e: unknown) {
    if (e && typeof e === 'object' && 'name' in e && e.name === 'ConditionalCheckFailedException') {
      return false;
    }
      throw e;
    }
  }

  private async openCircuit(connectorId: string, nowSec: number, ttlSec: number): Promise<void> {
    const pk = this.pkPrefix + connectorId;
    await this.dynamoClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          pk,
          sk: this.skState,
          state: 'OPEN',
          failure_count: this.config.failureThreshold,
          window_start_epoch_sec: nowSec,
          open_until_epoch_sec: nowSec + this.config.cooldownSeconds,
          ttl_epoch_sec: ttlSec,
        },
      })
    );
  }
}
