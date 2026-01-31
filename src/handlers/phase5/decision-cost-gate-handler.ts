/**
 * Decision Cost Gate Handler - Phase 5.2
 *
 * Consumes RUN_DECISION events. Flow: IdempotencyStore → RunState admission lock → CostGate.
 * On ALLOW: publish DECISION_EVALUATION_REQUESTED (Phase 3). On DEFER: publish RUN_DECISION_DEFERRED.
 */

import { Handler } from 'aws-lambda';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { getAWSClientConfig } from '../../utils/aws-client-config';
import { Logger } from '../../services/core/Logger';
import { DecisionRunStateService } from '../../services/decision/DecisionRunStateService';
import { DecisionIdempotencyStoreService } from '../../services/decision/DecisionIdempotencyStoreService';
import { DecisionCostGateService, DEFAULT_TRIGGER_REGISTRY } from '../../services/decision/DecisionCostGateService';
import type {
  RunDecisionEventV1,
  DecisionTriggerType,
} from '../../types/decision/DecisionTriggerTypes';

const logger = new Logger('DecisionCostGateHandler');
const region = process.env.AWS_REGION || 'us-west-2';
const clientConfig = getAWSClientConfig(region);
const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient(clientConfig), {
  marshallOptions: { removeUndefinedValues: true },
});
const eventBridgeClient = new EventBridgeClient(clientConfig);

const decisionRunStateTable =
  process.env.DECISION_RUN_STATE_TABLE_NAME || 'cc-native-decision-run-state';
const idempotencyStoreTable =
  process.env.IDEMPOTENCY_STORE_TABLE_NAME || 'cc-native-decision-idempotency-store';
const eventBusName = process.env.EVENT_BUS_NAME || 'cc-native-events';

const runStateService = new DecisionRunStateService(
  dynamoClient,
  decisionRunStateTable,
  logger
);
const idempotencyStore = new DecisionIdempotencyStoreService(
  dynamoClient,
  idempotencyStoreTable,
  logger
);
const costGateService = new DecisionCostGateService(logger);

interface EventBridgeEnvelope {
  source?: string;
  'detail-type'?: string;
  detail?: Record<string, unknown>;
  id?: string;
  time?: string;
}

async function publishDecisionEvaluationRequested(
  tenantId: string,
  accountId: string,
  triggerType: string,
  triggerEventId?: string
): Promise<void> {
  await eventBridgeClient.send(
    new PutEventsCommand({
      Entries: [
        {
          Source: 'cc-native.decision',
          DetailType: 'DECISION_EVALUATION_REQUESTED',
          Detail: JSON.stringify({
            account_id: accountId,
            tenant_id: tenantId,
            trigger_type: triggerType,
            trigger_event_id: triggerEventId,
          }),
          EventBusName: eventBusName,
        },
      ],
    })
  );
}

async function publishRunDecisionDeferred(
  tenantId: string,
  accountId: string,
  triggerType: DecisionTriggerType,
  deferUntilEpoch: number,
  retryAfterSeconds: number | undefined,
  originalIdempotencyKey: string,
  correlationId?: string
): Promise<void> {
  await eventBridgeClient.send(
    new PutEventsCommand({
      Entries: [
        {
          Source: 'cc-native',
          DetailType: 'RUN_DECISION_DEFERRED',
          Detail: JSON.stringify({
            tenant_id: tenantId,
            account_id: accountId,
            trigger_type: triggerType,
            defer_until_epoch: deferUntilEpoch,
            retry_after_seconds: retryAfterSeconds,
            original_idempotency_key: originalIdempotencyKey,
            correlation_id: correlationId,
          }),
          EventBusName: eventBusName,
        },
      ],
    })
  );
}

export const handler: Handler<EventBridgeEnvelope, void> = async (
  event,
  context
) => {
  const envelope = event;
  const detail = envelope.detail as RunDecisionEventV1['detail'] | undefined;
  if (!detail?.tenant_id || !detail?.account_id || !detail?.trigger_type || !detail?.idempotency_key) {
    logger.warn('Invalid RUN_DECISION event: missing required detail fields', {
      hasDetail: !!detail,
      keys: detail ? Object.keys(detail) : [],
    });
    return;
  }

  const tenantId = detail.tenant_id;
  const accountId = detail.account_id;
  const triggerType = detail.trigger_type as DecisionTriggerType;
  const idempotencyKey = detail.idempotency_key;
  const correlationId = detail.correlation_id;
  const eventId = envelope.id;

  try {
    const reserved = await idempotencyStore.tryReserve(idempotencyKey);
    if (!reserved) {
      logger.info('Duplicate RUN_DECISION; skipping (DUPLICATE_IDEMPOTENCY_KEY)', {
        tenantId,
        accountId,
        idempotencyKey,
      });
      return;
    }

    const state = await runStateService.getState(tenantId, accountId);
    const registryEntry = DEFAULT_TRIGGER_REGISTRY[triggerType];
    if (!registryEntry) {
      logger.warn('Unknown trigger type; skipping', { triggerType });
      return;
    }

    const gateInput = {
      tenant_id: tenantId,
      account_id: accountId,
      trigger_type: triggerType,
      budget_remaining: undefined as number | undefined,
      recency_last_run_epoch: state?.last_allowed_at_epoch,
      action_saturation_score: undefined as number | undefined,
      tenant_tier: undefined as string | undefined,
    };
    const gateOutput = costGateService.evaluate(gateInput);

    logger.info('CostGate result', {
      tenantId,
      accountId,
      result: gateOutput.result,
      reason: gateOutput.reason,
    });

    if (gateOutput.result === 'SKIP') {
      return;
    }

    if (gateOutput.result === 'DEFER') {
      await publishRunDecisionDeferred(
        tenantId,
        accountId,
        triggerType,
        gateOutput.defer_until_epoch ?? Math.floor(Date.now() / 1000) + 300,
        gateOutput.retry_after_seconds,
        idempotencyKey,
        correlationId
      );
      return;
    }

    const lockResult = await runStateService.tryAcquireAdmissionLock(
      tenantId,
      accountId,
      triggerType,
      registryEntry
    );
    if (!lockResult.acquired) {
      logger.info('Admission lock not acquired after ALLOW; publishing DEFER', {
        tenantId,
        accountId,
        reason: lockResult.reason,
      });
      const deferUntilEpoch = Math.floor(Date.now() / 1000) + (registryEntry.cooldown_seconds || 300);
      await publishRunDecisionDeferred(
        tenantId,
        accountId,
        triggerType,
        deferUntilEpoch,
        registryEntry.cooldown_seconds,
        idempotencyKey,
        correlationId
      );
      return;
    }

    await publishDecisionEvaluationRequested(
      tenantId,
      accountId,
      triggerType,
      eventId
    );
  } catch (e) {
    logger.error('Decision cost gate handler error', {
      tenantId: detail?.tenant_id,
      accountId: detail?.account_id,
      error: e,
    });
    throw e;
  }
};
