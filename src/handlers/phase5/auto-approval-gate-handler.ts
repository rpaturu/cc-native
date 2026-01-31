/**
 * Auto-Approval Gate Handler - Phase 5.4
 *
 * Order: allowlist → mode → policy → idempotency guard → budget consume → RESERVED → publish → PUBLISHED.
 * If any step fails (allowlist, policy, budget) → REQUIRE_APPROVAL (never silent defer).
 * Idempotent on action_intent_id; no double budget consume under retries.
 */

import { Handler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { getAWSClientConfig } from '../../utils/aws-client-config';
import { Logger } from '../../services/core/Logger';
import { ActionIntentService } from '../../services/decision/ActionIntentService';
import { AutonomyModeService } from '../../services/autonomy/AutonomyModeService';
import { AutonomyBudgetService } from '../../services/autonomy/AutonomyBudgetService';
import { AutoExecuteAllowListService } from '../../services/autonomy/AutoExecuteAllowListService';
import { AutoExecStateService } from '../../services/autonomy/AutoExecStateService';
import { evaluateAutoApprovalPolicy } from '../../services/autonomy/AutoApprovalPolicyEngine';
import { ACTION_TYPE_RISK_TIERS } from '../../types/DecisionTypes';
import type { ActionTypeV1 } from '../../types/DecisionTypes';

const logger = new Logger('AutoApprovalGateHandler');
const region = process.env.AWS_REGION || 'us-west-2';
const clientConfig = getAWSClientConfig(region);
const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient(clientConfig), {
  marshallOptions: { removeUndefinedValues: true },
});

const autonomyConfigTableName = process.env.AUTONOMY_CONFIG_TABLE_NAME || '';
const autonomyBudgetStateTableName = process.env.AUTONOMY_BUDGET_STATE_TABLE_NAME || '';
const actionIntentTableName = process.env.ACTION_INTENT_TABLE_NAME || '';
const eventBusName = process.env.EVENT_BUS_NAME || '';

const autoExecuteAllowListService = new AutoExecuteAllowListService(
  dynamoClient,
  autonomyConfigTableName,
  logger
);
const autoExecStateService = new AutoExecStateService(
  dynamoClient,
  autonomyConfigTableName,
  logger
);
const autonomyModeService = new AutonomyModeService(
  dynamoClient,
  autonomyConfigTableName,
  logger
);
const autonomyBudgetService = new AutonomyBudgetService(
  dynamoClient,
  autonomyBudgetStateTableName,
  logger
);
const actionIntentService = new ActionIntentService(
  dynamoClient,
  actionIntentTableName,
  logger
);

const eventBridgeClient = new EventBridgeClient(clientConfig);

export interface AutoApprovalGateEvent {
  action_intent_id: string;
  tenant_id: string;
  account_id: string;
}

export type AutoApprovalGateResult = 'AUTO_EXECUTED' | 'REQUIRE_APPROVAL';

export interface AutoApprovalGateResponse {
  result: AutoApprovalGateResult;
  reason?: string;
  action_intent_id: string;
  already_published?: boolean;
}

function requireApproval(reason: string, actionIntentId: string): AutoApprovalGateResponse {
  return { result: 'REQUIRE_APPROVAL', reason, action_intent_id: actionIntentId };
}

export const handler: Handler<AutoApprovalGateEvent, AutoApprovalGateResponse> = async (event) => {
  const { action_intent_id, tenant_id, account_id } = event;
  if (!action_intent_id || !tenant_id || !account_id) {
    logger.warn('Auto-approval gate skipped: missing action_intent_id, tenant_id, or account_id', { event });
    return requireApproval('MISSING_INPUT', action_intent_id || '');
  }

  if (!autonomyConfigTableName || !autonomyBudgetStateTableName || !actionIntentTableName || !eventBusName) {
    logger.warn('Auto-approval gate skipped: missing table or event bus config');
    return requireApproval('CONFIG_MISSING', action_intent_id);
  }

  // 1. Load intent
  const intent = await actionIntentService.getIntent(action_intent_id, tenant_id, account_id);
  if (!intent) {
    logger.debug('Intent not found', { action_intent_id });
    return requireApproval('INTENT_NOT_FOUND', action_intent_id);
  }

  const actionType = intent.action_type as ActionTypeV1;

  // 2. Allowlist (first)
  const allowlisted = await autoExecuteAllowListService.isAllowlisted(tenant_id, actionType, account_id);
  if (!allowlisted) {
    logger.info('Action type not allowlisted for auto-execute', { action_type: actionType, tenant_id, account_id });
    return requireApproval('ACTION_TYPE_NOT_ALLOWLISTED', action_intent_id);
  }

  // 3. Mode
  const autonomyMode = await autonomyModeService.getMode(tenant_id, account_id, actionType);

  // 4. Policy
  const riskLevel = intent.risk_level ?? ACTION_TYPE_RISK_TIERS[actionType]?.risk_tier ?? 'MEDIUM';
  const confidenceScore = typeof intent.confidence_score === 'number' ? intent.confidence_score : 0.5;
  const policyResult = evaluateAutoApprovalPolicy({
    action_type: actionType,
    confidence_score: confidenceScore,
    risk_level: riskLevel,
    tenant_id,
    account_id,
    autonomy_mode: autonomyMode,
  });
  if (policyResult.decision !== 'AUTO_EXECUTE') {
    logger.info('Policy does not allow auto-execute', { reason: policyResult.reason, action_intent_id });
    return requireApproval(policyResult.reason ?? 'POLICY_REQUIRE_APPROVAL', action_intent_id);
  }

  // 5. Idempotency guard
  const state = await autoExecStateService.getState(action_intent_id);
  if (state?.status === 'PUBLISHED') {
    logger.debug('Already published (idempotent)', { action_intent_id });
    return { result: 'AUTO_EXECUTED', action_intent_id, already_published: true };
  }
  if (state?.status === 'RESERVED') {
    // Retry publish only (no double-consume)
    try {
      await eventBridgeClient.send(new PutEventsCommand({
        Entries: [{
          Source: 'cc-native',
          DetailType: 'ACTION_APPROVED',
          Detail: JSON.stringify({
            data: {
              action_intent_id,
              tenant_id,
              account_id,
              approval_source: 'POLICY' as const,
              auto_executed: true,
            },
          }),
          EventBusName: eventBusName,
        }],
      }));
      await autoExecStateService.setPublished(action_intent_id);
      logger.info('Retry publish succeeded', { action_intent_id });
      return { result: 'AUTO_EXECUTED', action_intent_id };
    } catch (err) {
      logger.error('Retry publish failed', { action_intent_id, error: err });
      throw err;
    }
  }

  // 6. Budget consume
  const consumed = await autonomyBudgetService.checkAndConsume(tenant_id, account_id, actionType);
  if (!consumed) {
    logger.info('Budget check failed; require approval', { action_intent_id });
    return requireApproval('BUDGET_EXCEEDED', action_intent_id);
  }

  // 7. Reserve (conditional; prevents double publish from concurrent runs)
  try {
    await autoExecStateService.setReserved(action_intent_id);
  } catch (err: unknown) {
    const name = err && typeof err === 'object' && 'name' in err ? (err as { name: string }).name : '';
    if (name === 'ConditionalCheckFailedException') {
      // Another Lambda reserved; treat as RESERVED and retry publish
      const retryState = await autoExecStateService.getState(action_intent_id);
      if (retryState?.status === 'RESERVED') {
        await eventBridgeClient.send(new PutEventsCommand({
          Entries: [{
            Source: 'cc-native',
            DetailType: 'ACTION_APPROVED',
            Detail: JSON.stringify({
              data: {
                action_intent_id,
                tenant_id,
                account_id,
                approval_source: 'POLICY' as const,
                auto_executed: true,
              },
            }),
            EventBusName: eventBusName,
          }],
        }));
        await autoExecStateService.setPublished(action_intent_id);
        return { result: 'AUTO_EXECUTED', action_intent_id };
      }
    }
    throw err;
  }

  // 8. Publish
  try {
    await eventBridgeClient.send(new PutEventsCommand({
      Entries: [{
        Source: 'cc-native',
        DetailType: 'ACTION_APPROVED',
        Detail: JSON.stringify({
          data: {
            action_intent_id,
            tenant_id,
            account_id,
            approval_source: 'POLICY' as const,
            auto_executed: true,
          },
        }),
        EventBusName: eventBusName,
      }],
    }));
    await autoExecStateService.setPublished(action_intent_id);
    logger.info('Auto-execute published', { action_intent_id, tenant_id, account_id });
    return { result: 'AUTO_EXECUTED', action_intent_id };
  } catch (err) {
    logger.error('Publish failed after reserve', { action_intent_id, error: err });
    throw err;
  }
};
