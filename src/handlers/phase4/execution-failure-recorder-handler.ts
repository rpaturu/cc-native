/**
 * Execution Failure Recorder Handler - Phase 4.2
 * 
 * Record execution failures that occur before tool invocation (Start/Validate/Map errors)
 * 
 * Contract: See "Execution Contract (Canonical)" section in PHASE_4_2_CODE_LEVEL_PLAN.md
 * 
 * Step Functions input: state from failed step + Catch resultPath $.error.
 * So: action_intent_id, tenant_id, account_id, trace_id, error: { Error?, Cause? };
 * when failure is after StartExecution also: idempotency_key, registry_version, attempt_count, started_at.
 * Note: Catch does not add "status"; handler is only invoked on failure path.
 *
 * Note: This handler is called from Step Functions Catch blocks for Start/Validate/Map errors.
 * Note: trace_id is execution_trace_id (from starter handler), not decision_trace_id.
 */

import { Handler } from 'aws-lambda';
import { Logger } from '../../services/core/Logger';
import { TraceService } from '../../services/core/TraceService';
import { ExecutionOutcomeService } from '../../services/execution/ExecutionOutcomeService';
import { ExecutionAttemptService } from '../../services/execution/ExecutionAttemptService';
import { ActionIntentService } from '../../services/decision/ActionIntentService';
import { LedgerService } from '../../services/ledger/LedgerService';
import { LedgerEventType } from '../../types/LedgerTypes';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { getAWSClientConfig } from '../../utils/aws-client-config';

const logger = new Logger('ExecutionFailureRecorderHandler');
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

// Note: AWS_REGION is automatically set by Lambda runtime
const region = requireEnv('AWS_REGION', 'ExecutionFailureRecorderHandler');
const executionOutcomesTableName = requireEnv('EXECUTION_OUTCOMES_TABLE_NAME', 'ExecutionFailureRecorderHandler');
const executionAttemptsTableName = requireEnv('EXECUTION_ATTEMPTS_TABLE_NAME', 'ExecutionFailureRecorderHandler');
const actionIntentTableName = requireEnv('ACTION_INTENT_TABLE_NAME', 'ExecutionFailureRecorderHandler');
const ledgerTableName = requireEnv('LEDGER_TABLE_NAME', 'ExecutionFailureRecorderHandler');

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

import { FailureRecorderInputSchema } from './execution-state-schemas';
export const StepFunctionsInputSchema = FailureRecorderInputSchema;

export const handler: Handler = async (event: unknown) => {
  // Validate SFN input with Zod (fail fast with precise errors)
  const validationResult = StepFunctionsInputSchema.safeParse(event);
  if (!validationResult.success) {
    const error = new Error(
      `[ExecutionFailureRecorderHandler] Invalid Step Functions input: ${validationResult.error.message}. ` +
      `Expected: state from failed step + error (action_intent_id, tenant_id, account_id, trace_id, error?; optional: registry_version, idempotency_key, attempt_count, started_at). ` +
      `Received: ${JSON.stringify(event)}.`
    );
    error.name = 'ValidationError';
    throw error;
  }
  
  const { action_intent_id, tenant_id, account_id, trace_id, registry_version, error: errorDetails } = validationResult.data;
  
  logger.info('Execution failure recorder invoked', { action_intent_id, trace_id, errorDetails });
  
  try {
    // 1. Fetch ActionIntentV1 (for decision_trace_id correlation)
    const intent = await actionIntentService.getIntent(action_intent_id, tenant_id, account_id);
    if (!intent) {
      // Use typed error for SFN-friendly classification
      const error = new Error(
        `ActionIntent not found: ${action_intent_id}. ` +
        `This may indicate the intent was deleted or the tenant/account combination is invalid. ` +
        `Check ActionIntent table for ACTION_INTENT#${action_intent_id} with tenant_id=${tenant_id}, account_id=${account_id}.`
      );
      error.name = 'ValidationError'; // SFN will route to failure recorder, not retry
      throw error;
    }
    
    // 2. Get execution attempt (for attempt_count and started_at)
    const attempt = await executionAttemptService.getAttempt(action_intent_id, tenant_id, account_id);
    if (!attempt) {
      throw new Error(`Execution attempt not found: ${action_intent_id}`);
    }
    
    // 3. Classify error from Step Functions error details
    const errorMessage = errorDetails?.Cause || errorDetails?.Error || 'Unknown error';
    const errorClass = classifyErrorFromStepFunctionsError(errorDetails);
    
    // 4. Record failure outcome
    // Note: If registry_version is missing, record null and set error_class=VALIDATION
    // Missing registry_version is a Phase 3 contract violation that should be flagged
    const finalRegistryVersion = registry_version ?? intent?.registry_version ?? null;
    const finalErrorClass = (finalRegistryVersion === null ? 'VALIDATION' : errorClass) as 'AUTH' | 'RATE_LIMIT' | 'VALIDATION' | 'DOWNSTREAM' | 'TIMEOUT' | 'UNKNOWN';
    const finalErrorCode = finalRegistryVersion === null ? 'REGISTRY_VERSION_MISSING' : 'EXECUTION_FAILED';
    
    const outcome = await executionOutcomeService.recordOutcome({
      action_intent_id,
      tenant_id,
      account_id,
      trace_id, // execution_trace_id
      // Note: registry_version is required in ActionOutcomeV1, but may be null for pre-tool failures
      // Use 0 as fallback (indicates contract violation, but allows recording the failure)
      registry_version: finalRegistryVersion ?? 0,
      status: 'FAILED',
      external_object_refs: [], // Pre-tool failures have no external objects
      error_class: finalErrorClass,
      error_code: finalErrorCode,
      error_message: finalRegistryVersion === null 
        ? 'Missing registry_version in ActionIntentV1 (Phase 3 contract violation)'
        : errorMessage,
      attempt_count: attempt.attempt_count,
      tool_name: 'unknown', // Pre-tool failure - tool was never invoked
      tool_schema_version: 'unknown', // Pre-tool failure - tool was never invoked
      tool_run_ref: `pre-tool-failure-${action_intent_id}`, // Placeholder for pre-tool failures
      started_at: attempt.started_at,
      completed_at: new Date().toISOString(),
      compensation_status: 'NONE', // Pre-tool failures have nothing to compensate
    });
    
    // 5. Update execution attempt status
    await executionAttemptService.updateStatus(
      action_intent_id,
      tenant_id,
      account_id,
      'FAILED',
      finalErrorClass
    );
    
    // 6. Emit ledger event (use execution trace for execution lifecycle events)
    await ledgerService.append({
      eventType: LedgerEventType.ACTION_FAILED,
      tenantId: tenant_id,
      accountId: account_id,
      traceId: trace_id, // Use execution trace
      data: {
        action_intent_id,
        error_class: finalErrorClass,
        error_code: finalErrorCode,
        error_message: finalRegistryVersion === null 
          ? 'Missing registry_version in ActionIntentV1 (Phase 3 contract violation)'
          : errorMessage,
        decision_trace_id: intent.trace_id, // Preserve decision trace for correlation
        registry_version: finalRegistryVersion,
      },
    });
    
    logger.info('Execution failure recorded', { action_intent_id, trace_id, outcome });
    
    return {
      success: true,
      outcome_id: `${action_intent_id}#${outcome.completed_at}`,
    };
  } catch (error: any) {
    logger.error('Execution failure recorder failed', { 
      action_intent_id, 
      error: error.message,
      errorName: error.name,
      stack: error.stack,
    });
    throw error;
  }
};

/**
 * Classify error from Step Functions error structure
 */
function classifyErrorFromStepFunctionsError(errorDetails?: { Error?: string; Cause?: string }): string {
  if (!errorDetails) {
    return 'UNKNOWN';
  }
  
  const errorStr = (errorDetails.Error || errorDetails.Cause || '').toUpperCase();
  
  if (errorStr.includes('VALIDATION') || errorStr.includes('INTENT_NOT_FOUND') || errorStr.includes('INTENT_EXPIRED')) {
    return 'VALIDATION';
  }
  if (errorStr.includes('AUTH') || errorStr.includes('AUTHENTICATION')) {
    return 'AUTH';
  }
  if (errorStr.includes('KILL_SWITCH')) {
    return 'VALIDATION';
  }
  if (errorStr.includes('CONFIGURATION')) {
    return 'VALIDATION';
  }
  
  return 'UNKNOWN';
}
