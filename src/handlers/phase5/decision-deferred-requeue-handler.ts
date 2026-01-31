/**
 * Decision Deferred Requeue Handler - Phase 5.2
 *
 * Consumes RUN_DECISION_DEFERRED. Creates a single bounded retry by scheduling
 * a one-time EventBridge Scheduler run that invokes the cost-gate handler at defer_until_epoch.
 */

import { Handler } from 'aws-lambda';
import { createHash } from 'crypto';
import { SchedulerClient, CreateScheduleCommand } from '@aws-sdk/client-scheduler';
import { getAWSClientConfig } from '../../utils/aws-client-config';
import { Logger } from '../../services/core/Logger';
import type { RunDecisionDeferredEventV1 } from '../../types/decision/DecisionTriggerTypes';

const logger = new Logger('DecisionDeferredRequeueHandler');
const region = process.env.AWS_REGION || 'us-west-2';
const clientConfig = getAWSClientConfig(region);
const schedulerClient = new SchedulerClient(clientConfig);

const costGateHandlerArn =
  process.env.DECISION_COST_GATE_HANDLER_ARN || '';
const schedulerRoleArn =
  process.env.DECISION_SCHEDULER_ROLE_ARN || '';
const scheduleGroupName =
  process.env.SCHEDULE_GROUP_NAME || 'default';

interface EventBridgeEnvelope {
  source?: string;
  'detail-type'?: string;
  detail?: Record<string, unknown>;
}

function toOneTimeScheduleExpression(epochSeconds: number): string {
  const date = new Date(epochSeconds * 1000);
  return `at(${date.toISOString().replace(/\.\d{3}Z$/, 'Z')})`;
}

function newIdempotencyKeyForRetry(
  originalIdempotencyKey: string,
  deferUntilEpoch: number
): string {
  return createHash('sha256')
    .update(`${originalIdempotencyKey}|retry|${deferUntilEpoch}`, 'utf8')
    .digest('hex');
}

function scheduleName(
  tenantId: string,
  accountId: string,
  deferUntilEpoch: number
): string {
  const safe = (s: string) => s.replace(/[^a-zA-Z0-9-]/g, '-');
  return `run-decision-${safe(tenantId)}-${safe(accountId)}-${deferUntilEpoch}`.slice(0, 128);
}

export const handler: Handler<EventBridgeEnvelope, void> = async (
  event,
  _context
) => {
  const detail = event.detail as RunDecisionDeferredEventV1['detail'] | undefined;
  if (
    !detail?.tenant_id ||
    !detail?.account_id ||
    !detail?.trigger_type ||
    detail?.defer_until_epoch == null ||
    !detail?.original_idempotency_key
  ) {
    logger.warn('Invalid RUN_DECISION_DEFERRED: missing required detail', {
      hasDetail: !!detail,
      keys: detail ? Object.keys(detail) : [],
    });
    return;
  }

  const {
    tenant_id: tenantId,
    account_id: accountId,
    trigger_type: triggerType,
    defer_until_epoch: deferUntilEpoch,
    retry_after_seconds: retryAfterSeconds,
    original_idempotency_key: originalIdempotencyKey,
    correlation_id: correlationId,
  } = detail;

  if (!costGateHandlerArn || !schedulerRoleArn) {
    logger.error('Missing DECISION_COST_GATE_HANDLER_ARN or DECISION_SCHEDULER_ROLE_ARN');
    return;
  }

  const newIdempotencyKey = newIdempotencyKeyForRetry(
    originalIdempotencyKey,
    deferUntilEpoch
  );
  const runDecisionPayload = {
    source: 'cc-native',
    'detail-type': 'RUN_DECISION',
    detail: {
      tenant_id: tenantId,
      account_id: accountId,
      trigger_type: triggerType,
      scheduled_at: new Date(deferUntilEpoch * 1000).toISOString(),
      idempotency_key: newIdempotencyKey,
      correlation_id: correlationId,
    },
  };

  const name = scheduleName(tenantId, accountId, deferUntilEpoch);
  const scheduleExpression = toOneTimeScheduleExpression(deferUntilEpoch);

  try {
    await schedulerClient.send(
      new CreateScheduleCommand({
        Name: name,
        GroupName: scheduleGroupName,
        ScheduleExpression: scheduleExpression,
        FlexibleTimeWindow: { Mode: 'OFF' },
        Target: {
          Arn: costGateHandlerArn,
          RoleArn: schedulerRoleArn,
          Input: JSON.stringify(runDecisionPayload),
          RetryPolicy: { MaximumEventAgeInSeconds: 86400, MaximumRetryAttempts: 0 },
        },
        ActionAfterCompletion: 'DELETE',
      })
    );
    logger.info('Scheduled single bounded retry', {
      tenantId,
      accountId,
      deferUntilEpoch,
      retryAfterSeconds,
      scheduleName: name,
    });
  } catch (e) {
    logger.error('Failed to create defer retry schedule', {
      tenantId,
      accountId,
      deferUntilEpoch,
      error: e,
    });
    throw e;
  }
};
