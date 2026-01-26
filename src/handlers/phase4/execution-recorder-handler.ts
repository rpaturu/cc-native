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
import { z } from 'zod';
import { Logger } from '../../services/core/Logger';
import { TraceService } from '../../services/core/TraceService';
import { ExecutionOutcomeService } from '../../services/execution/ExecutionOutcomeService';
import { ExecutionAttemptService } from '../../services/execution/ExecutionAttemptService';
import { ActionIntentService } from '../../services/decision/ActionIntentService';
import { LedgerService } from '../../services/ledger/LedgerService';
import { LedgerEventType } from '../../types/LedgerTypes';
import { ToolInvocationResponse } from '../../types/ExecutionTypes';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { getAWSClientConfig } from '../../utils/aws-client-config';

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

// Note: AWS_REGION is automatically set by Lambda runtime (not set in CDK environment variables)
// Validate it exists (should always be present, but fail fast if somehow missing)
const region = requireEnv('AWS_REGION', 'ExecutionRecorderHandler');
const executionOutcomesTableName = requireEnv('EXECUTION_OUTCOMES_TABLE_NAME', 'ExecutionRecorderHandler');
const executionAttemptsTableName = requireEnv('EXECUTION_ATTEMPTS_TABLE_NAME', 'ExecutionRecorderHandler');
const actionIntentTableName = requireEnv('ACTION_INTENT_TABLE_NAME', 'ExecutionRecorderHandler');
const ledgerTableName = requireEnv('LEDGER_TABLE_NAME', 'ExecutionRecorderHandler');

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

// Zod schema for SFN input validation (fail fast with precise errors)
const StepFunctionsInputSchema = z.object({
  action_intent_id: z.string().min(1, 'action_intent_id is required'),
  tenant_id: z.string().min(1, 'tenant_id is required'),
  account_id: z.string().min(1, 'account_id is required'),
  trace_id: z.string().min(1, 'trace_id is required'), // execution_trace_id
  tool_invocation_response: z.object({
    success: z.boolean(),
    external_object_refs: z.array(z.any()).optional(),
    tool_run_ref: z.string(),
    raw_response_artifact_ref: z.string().optional(),
    error_code: z.string().optional(),
    error_class: z.string().optional(),
    error_message: z.string().optional(),
  }),
  tool_name: z.string().min(1, 'tool_name is required'),
  tool_schema_version: z.string().min(1, 'tool_schema_version is required'),
  registry_version: z.number().int().positive('registry_version must be positive integer'), // From starter handler
  attempt_count: z.number().int().positive('attempt_count must be positive integer'),
  started_at: z.string().min(1, 'started_at is required'),
}).strict();

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
    tool_invocation_response,
    tool_name,
    tool_schema_version,
    registry_version, // From starter handler output
    attempt_count,
    started_at,
  } = validationResult.data;
  
  logger.info('Execution recorder invoked', { action_intent_id, trace_id, registry_version });
  
  try {
    const completedAt = new Date().toISOString();
    // Note: status must match ExecutionAttempt.status enum: 'SUCCEEDED' | 'FAILED' | 'CANCELLED'
    // Phase 4.1 ExecutionAttempt uses these exact values, so this is correct
    const status = tool_invocation_response.success ? 'SUCCEEDED' : 'FAILED';
    
    // 1. Record outcome (include registry_version for audit and backwards compatibility)
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
    
    // Note: Signal emission for Phase 1 perception layer is implemented in Phase 4.4 (Safety & Outcomes)
    // See PHASE_4_4_CODE_LEVEL_PLAN.md for SignalService integration
    
    // 4. Return outcome
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
