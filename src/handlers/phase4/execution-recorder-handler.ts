/**
 * Execution Recorder Handler - Phase 4.2
 * 
 * Record structured execution outcome (tool invocation results)
 * 
 * Contract: See "Execution Contract (Canonical)" section in PHASE_4_2_CODE_LEVEL_PLAN.md
 * 
 * Step Functions input: {
 *   action_intent_id, tenant_id, account_id, trace_id, tool_invocation_response,
 *   tool_name, tool_schema_version, registry_version, attempt_count, started_at
 * }
 * 
 * Note: For pre-tool failures (Start/Validate/Map errors), use execution-failure-recorder-handler.ts instead.
 * Note: trace_id is execution_trace_id (from starter handler), not decision_trace_id.
 */

import { Handler } from 'aws-lambda';
import { Logger } from '../../services/core/Logger';
import { TraceService } from '../../services/core/TraceService';
import { ExecutionOutcomeService } from '../../services/execution/ExecutionOutcomeService';
import { ExecutionAttemptService } from '../../services/execution/ExecutionAttemptService';
import { ActionIntentService } from '../../services/decision/ActionIntentService';
import { LedgerService } from '../../services/ledger/LedgerService';
import { SignalService } from '../../services/perception/SignalService';
import { EventPublisher } from '../../services/events/EventPublisher';
import { LedgerEventType } from '../../types/LedgerTypes';
import { ToolInvocationResponse } from '../../types/ExecutionTypes';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { getAWSClientConfig } from '../../utils/aws-client-config';
import { buildExecutionOutcomeSignal } from '../../utils/execution-signal-helpers';

const logger = new Logger('ExecutionRecorderHandler');
const traceService = new TraceService(logger);

/**
 * Helper to validate required environment variables with descriptive errors
 */
function requireEnv(name: string, handlerName: string): string {
  const value = process.env[name];
  if (!value) {
    const error = new Error(
      `[${handlerName}] Missing required environment variable: ${name}. ` +
      `This variable must be set in the Lambda function configuration. ` +
      `Check CDK stack definition for ExecutionInfrastructure construct.`
    );
    error.name = 'ConfigurationError';
    throw error;
  }
  return value;
}

// AWS_REGION is set by Lambda runtime; do not use requireEnv (use runtime-specific message if missing).
const region: string =
  process.env.AWS_REGION ||
  (() => {
    const err = new Error(
      '[ExecutionRecorderHandler] AWS_REGION is not set. This is normally set by the Lambda runtime; check that the function is running in a Lambda environment.'
    );
    err.name = 'ConfigurationError';
    throw err;
  })();
const executionOutcomesTableName = requireEnv('EXECUTION_OUTCOMES_TABLE_NAME', 'ExecutionRecorderHandler');
const executionAttemptsTableName = requireEnv('EXECUTION_ATTEMPTS_TABLE_NAME', 'ExecutionRecorderHandler');
const actionIntentTableName = requireEnv('ACTION_INTENT_TABLE_NAME', 'ExecutionRecorderHandler');
const ledgerTableName = requireEnv('LEDGER_TABLE_NAME', 'ExecutionRecorderHandler');
const signalsTableName = requireEnv('SIGNALS_TABLE_NAME', 'ExecutionRecorderHandler');
const eventBusName = requireEnv('EVENT_BUS_NAME', 'ExecutionRecorderHandler');

// Initialize AWS clients
const clientConfig = getAWSClientConfig(region);
const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient(clientConfig), {
  marshallOptions: { removeUndefinedValues: true },
});

// Initialize services
const executionOutcomeService = new ExecutionOutcomeService(
  dynamoClient,
  executionOutcomesTableName,
  logger
);

const executionAttemptService = new ExecutionAttemptService(
  dynamoClient,
  executionAttemptsTableName,
  logger
);

const actionIntentService = new ActionIntentService(
  dynamoClient,
  actionIntentTableName,
  logger
);

const ledgerService = new LedgerService(
  logger,
  ledgerTableName,
  region
);

const eventPublisher = new EventPublisher(logger, eventBusName, region);
const signalService = new SignalService({
  logger,
  signalsTableName,
  eventPublisher,
  ledgerService,
  region,
});

import { RecorderInputSchema } from './execution-state-schemas';
export const StepFunctionsInputSchema = RecorderInputSchema;

export const handler: Handler = async (event: unknown) => {
  // Validate SFN input with Zod (fail fast with precise errors)
  const validationResult = StepFunctionsInputSchema.safeParse(event);
  if (!validationResult.success) {
    const error = new Error(
      `[ExecutionRecorderHandler] Invalid Step Functions input: ${validationResult.error.message}. ` +
      `Expected: { action_intent_id, tenant_id, account_id, trace_id, tool_invocation_response, tool_name, tool_schema_version, registry_version, attempt_count, started_at }. ` +
      `Received: ${JSON.stringify(event)}. ` +
      `Check Step Functions state machine definition to ensure all required fields are passed from tool-invoker-handler output.`
    );
    error.name = 'InvalidEventError';
    throw error;
  }
  
  const {
    action_intent_id,
    tenant_id,
    account_id,
    trace_id, // execution_trace_id (from starter handler)
    approval_source,
    auto_executed,
    tool_invocation_response,
    tool_name,
    tool_schema_version,
    registry_version, // From starter handler output
    attempt_count,
    started_at,
    is_replay,
    replay_reason,
    requested_by,
  } = validationResult.data;
  
  logger.info('Execution recorder invoked', { action_intent_id, trace_id, registry_version });
  
  try {
    const completedAt = new Date().toISOString();
    // Note: status must match ExecutionAttempt.status enum: 'SUCCEEDED' | 'FAILED' | 'CANCELLED'
    // Phase 4.1 ExecutionAttempt uses these exact values, so this is correct
    const status = tool_invocation_response.success ? 'SUCCEEDED' : 'FAILED';
    
    // 1. Record outcome (include registry_version, approval_source, auto_executed for audit and Phase 5.4)
    const outcome = await executionOutcomeService.recordOutcome({
      action_intent_id,
      status,
      external_object_refs: tool_invocation_response.external_object_refs || [],
      error_code: tool_invocation_response.error_code,
      error_class: tool_invocation_response.error_class as 'AUTH' | 'RATE_LIMIT' | 'VALIDATION' | 'DOWNSTREAM' | 'TIMEOUT' | 'UNKNOWN' | undefined,
      error_message: tool_invocation_response.error_message,
      attempt_count,
      tool_name,
      tool_schema_version,
      registry_version, // Include registry_version in outcome (for audit and backwards compatibility)
      tool_run_ref: tool_invocation_response.tool_run_ref,
      raw_response_artifact_ref: tool_invocation_response.raw_response_artifact_ref,
      started_at,
      completed_at: completedAt,
      compensation_status: 'NONE', // Compensation handled separately
      tenant_id,
      account_id,
      trace_id, // execution_trace_id (from starter handler), not decision_trace_id
      approval_source,
      auto_executed,
    });
    
    // 2. Update execution attempt status
    await executionAttemptService.updateStatus(
      action_intent_id,
      tenant_id,
      account_id,
      status
    );
    
    // 3. Emit ledger event
    // Note: Use execution_trace_id (trace_id) for execution lifecycle events
    // Include decision_trace_id as correlation field (fetch from intent if needed)
    const ledgerEventType = status === 'SUCCEEDED' 
      ? LedgerEventType.ACTION_EXECUTED 
      : LedgerEventType.ACTION_FAILED;
    
    // Fetch intent to get decision_trace_id for correlation
    const intent = await actionIntentService.getIntent(action_intent_id, tenant_id, account_id);
    const decisionTraceId = intent?.trace_id; // decision_trace_id from Phase 3
    
    await ledgerService.append({
      eventType: ledgerEventType,
      tenantId: tenant_id,
      accountId: account_id,
      traceId: trace_id, // execution_trace_id (from starter handler)
      data: {
        action_intent_id,
        status,
        external_object_refs: outcome.external_object_refs,
        error_code: outcome.error_code,
        error_class: outcome.error_class,
        registry_version: registry_version, // Include registry_version for audit
        decision_trace_id: decisionTraceId, // Correlation field (decision trace)
        attempt_count,
      },
    });

    // Phase 5.7: Replay trail (REPLAY_COMPLETED on success, REPLAY_FAILED on tool failure)
    if (is_replay && replay_reason && requested_by) {
      await ledgerService.append({
        eventType: status === 'SUCCEEDED' ? LedgerEventType.REPLAY_COMPLETED : LedgerEventType.REPLAY_FAILED,
        tenantId: tenant_id,
        accountId: account_id,
        traceId: trace_id,
        data: {
          action_intent_id,
          status,
          replay_reason,
          requested_by,
        },
      });
    }

    // 4. Emit execution outcome signal (Phase 4.4 — dedupeKey prevents duplicate signals per action_intent_id)
    const now = new Date().toISOString();
    const executionSignal = buildExecutionOutcomeSignal(outcome, intent ?? null, trace_id, now);
    await signalService.createExecutionSignal(executionSignal);

    // 5. Return outcome
    return {
      outcome,
    };
  } catch (error: any) {
    logger.error('Execution recording failed', { action_intent_id, error });
    
    // Return structured error for Step Functions
    const errorDetails = {
      errorType: error.name || 'UnknownError',
      errorMessage: error.message || 'Unknown error occurred',
      action_intent_id,
      handler: 'ExecutionRecorderHandler',
      timestamp: new Date().toISOString(),
    };
    
    logger.error('Execution recording failed with details', errorDetails);
    
    // Throw structured error for Step Functions
    const recordingError = new Error(
      `[ExecutionRecorderHandler] Failed to record execution outcome for action_intent_id: ${action_intent_id}. ` +
      `Error: ${error.message || 'Unknown error'}. ` +
      `This may indicate a problem with DynamoDB write permissions or table configuration.`
    );
    recordingError.name = error.name || 'ExecutionRecordingError';
    throw recordingError;
  }
};
