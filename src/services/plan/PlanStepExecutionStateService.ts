/**
 * Phase 6.3 — Step execution state: atomic attempt, idempotency, status.
 * Single authoritative mechanism for attempt (§3a); step status transitions (§3b).
 * See PHASE_6_3_CODE_LEVEL_PLAN.md §3, §7.
 */

import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { Logger } from '../core/Logger';
import { getAWSClientConfig } from '../../utils/aws-client-config';
import type {
  PlanStepExecutionRecord,
  PlanStepExecutionStatus,
  PlanStepAttemptResult,
} from '../../types/plan/PlanStepExecutionTypes';

export interface PlanStepExecutionStateServiceConfig {
  tableName: string;
  region?: string;
}

const PK_PREFIX = 'PLAN#';
const SK_ATTEMPT_PREFIX = 'STEP#';
const SK_ATTEMPT_SUFFIX = '#ATTEMPT#';
const SK_META_SUFFIX = '#META';

function pk(planId: string): string {
  return `${PK_PREFIX}${planId}`;
}

function skAttempt(stepId: string, attempt: number): string {
  return `${SK_ATTEMPT_PREFIX}${stepId}${SK_ATTEMPT_SUFFIX}${attempt}`;
}

function skMeta(stepId: string): string {
  return `${SK_ATTEMPT_PREFIX}${stepId}${SK_META_SUFFIX}`;
}

export class PlanStepExecutionStateService {
  private client: DynamoDBDocumentClient;
  private tableName: string;
  private logger: Logger;

  constructor(
    logger: Logger,
    config: PlanStepExecutionStateServiceConfig
  ) {
    this.logger = logger;
    this.tableName = config.tableName;
    const base = new DynamoDBClient(getAWSClientConfig(config.region));
    this.client = DynamoDBDocumentClient.from(base, {
      marshallOptions: { removeUndefinedValues: true },
    });
  }

  /**
   * Current next attempt number (without incrementing). Used to check retry limit before reserving.
   */
  async getCurrentNextAttempt(planId: string, stepId: string): Promise<number> {
    const result = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { pk: pk(planId), sk: skMeta(stepId) },
        ProjectionExpression: 'next_attempt',
      })
    );
    const n = result.Item?.next_attempt;
    return typeof n === 'number' ? n : 0;
  }

  /**
   * Atomically reserve next attempt (§3a). Returns attempt number.
   * Caller should then recordStepStarted; if that fails, another runner claimed the attempt.
   */
  async reserveNextAttempt(planId: string, stepId: string): Promise<number> {
    const result = await this.client.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { pk: pk(planId), sk: skMeta(stepId) },
        UpdateExpression: 'ADD next_attempt :one',
        ExpressionAttributeValues: { ':one': 1 },
        ReturnValues: 'UPDATED_NEW',
      })
    );
    const attempt = result.Attributes?.next_attempt as number | undefined;
    if (typeof attempt !== 'number' || attempt < 1) {
      throw new Error(
        `PlanStepExecutionStateService.reserveNextAttempt: invalid attempt for ${planId}/${stepId}`
      );
    }
    return attempt;
  }

  /**
   * Record step execution started (idempotency). Condition: attribute_not_exists(sk).
   * Returns true if this invocation claimed the attempt; false if another runner did.
   */
  async recordStepStarted(
    planId: string,
    stepId: string,
    attempt: number
  ): Promise<PlanStepAttemptResult> {
    const startedAt = new Date().toISOString();
    const record: PlanStepExecutionRecord = {
      plan_id: planId,
      step_id: stepId,
      attempt,
      status: 'STARTED',
      started_at: startedAt,
    };
    try {
      await this.client.send(
        new PutCommand({
          TableName: this.tableName,
          Item: {
            ...record,
            pk: pk(planId),
            sk: skAttempt(stepId, attempt),
          },
          ConditionExpression: 'attribute_not_exists(sk)',
        })
      );
      return { attempt, claimed: true };
    } catch (err: unknown) {
      const name = err && typeof err === 'object' && 'name' in err ? (err as { name: string }).name : '';
      if (name === 'ConditionalCheckFailedException') {
        return { attempt, claimed: false };
      }
      throw err;
    }
  }

  /**
   * Update step execution to terminal status (DONE/FAILED/SKIPPED per §3b).
   */
  async updateStepOutcome(
    planId: string,
    stepId: string,
    attempt: number,
    status: PlanStepExecutionStatus,
    options?: { completed_at?: string; outcome_id?: string; error_message?: string }
  ): Promise<void> {
    const completedAt = options?.completed_at ?? new Date().toISOString();
    await this.client.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { pk: pk(planId), sk: skAttempt(stepId, attempt) },
        UpdateExpression:
          'set #status = :status, completed_at = :completed_at' +
          (options?.outcome_id ? ', outcome_id = :outcome_id' : '') +
          (options?.error_message ? ', error_message = :error_message' : ''),
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':status': status,
          ':completed_at': completedAt,
          ...(options?.outcome_id && { ':outcome_id': options.outcome_id }),
          ...(options?.error_message && { ':error_message': options.error_message }),
        },
      })
    );
  }
}
