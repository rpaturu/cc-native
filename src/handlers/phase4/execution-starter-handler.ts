/**
 * Execution Starter Handler - Phase 4.1
 * 
 * Start execution attempt (exactly-once guarantee)
 * 
 * Contract: See "Execution Contract (Canonical)" section in PHASE_4_1_CODE_LEVEL_PLAN.md
 * 
 * Input: { action_intent_id, tenant_id, account_id } (from Step Functions)
 * Output: { action_intent_id, idempotency_key, tenant_id, account_id, trace_id, registry_version }
 * 
 * Note: ActionIntentService.getIntent() must be public (not private) for this handler to work.
 */

import { Handler } from 'aws-lambda';
import { z } from 'zod';
import { Logger } from '../../services/core/Logger';
import { TraceService } from '../../services/core/TraceService';
import { ExecutionAttemptService } from '../../services/execution/ExecutionAttemptService';
import { ActionIntentService } from '../../services/decision/ActionIntentService';
import { IdempotencyService } from '../../services/execution/IdempotencyService';
import { ActionTypeRegistryService } from '../../services/execution/ActionTypeRegistryService';
import { LedgerService } from '../../services/ledger/LedgerService';
import { LedgerEventType } from '../../types/LedgerTypes';
import {
  ExecutionError,
  IntentNotFoundError,
  ValidationError,
  ExecutionAlreadyInProgressError,
  UnknownExecutionError,
} from '../../types/ExecutionErrors';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { getAWSClientConfig } from '../../utils/aws-client-config';

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

// Zod schema for SFN input validation (fail fast with precise errors)
const StepFunctionsInputSchema = z.object({
  action_intent_id: z.string().min(1, 'action_intent_id is required'),
  tenant_id: z.string().min(1, 'tenant_id is required'),
  account_id: z.string().min(1, 'account_id is required'),
}).strict();

/**
 * Create handler function with dependency injection for testability
 * Exported for unit testing
 */
export function createHandler(
  executionAttemptService: ExecutionAttemptService,
  actionIntentService: ActionIntentService,
  actionTypeRegistryService: ActionTypeRegistryService,
  idempotencyService: IdempotencyService,
  ledgerService: LedgerService,
  traceService: TraceService,
  logger: Logger,
  stateMachineTimeoutHours: number = 1
): Handler {
  return async (event: unknown) => {
  // Validate SFN input with Zod (fail fast with precise errors)
  const validationResult = StepFunctionsInputSchema.safeParse(event);
  if (!validationResult.success) {
    const error = new Error(
      `[ExecutionStarterHandler] Invalid Step Functions input: ${validationResult.error.message}. ` +
      `Expected: { action_intent_id: string, tenant_id: string, account_id: string }. ` +
      `Received: ${JSON.stringify(event)}. ` +
      `Check EventBridge rule configuration in ExecutionInfrastructure.createExecutionTriggerRule() ` +
      `to ensure all required fields are extracted from event detail and passed to Step Functions.`
    );
    error.name = 'InvalidEventError';
    throw error;
  }
  
  const { action_intent_id, tenant_id, account_id } = validationResult.data;
  
    // Generate execution trace ID (single trace for entire execution lifecycle)
    // This is separate from decision trace_id - execution has its own trace for debugging
    const executionTraceId = traceService.generateTraceId();
    
    logger.info('Execution starter invoked', { action_intent_id, tenant_id, account_id, executionTraceId });
    
    try {
      // 1. Fetch ActionIntentV1 (with tenant/account for security validation)
      const intent = await actionIntentService.getIntent(
        action_intent_id,
        tenant_id,
        account_id
      );
      
      if (!intent) {
        throw new IntentNotFoundError(action_intent_id);
      }
      
      // 2. Get tool mapping (for idempotency key generation)
      // Use registry_version from intent (REQUIRED - must be stored in ActionIntentV1 at Phase 3)
      if (intent.registry_version === undefined || intent.registry_version === null) {
        throw new ValidationError(
          `ActionIntent missing required field: registry_version. ` +
          `ActionIntentV1 must store registry_version at creation time (Phase 3). ` +
          `This ensures deterministic execution and prevents silent behavioral drift from registry changes. ` +
          `action_intent_id: ${action_intent_id}`,
          'MISSING_REGISTRY_VERSION'
        );
      }
      
      const registryVersion = intent.registry_version;
      const toolMapping = await actionTypeRegistryService.getToolMapping(
        intent.action_type,
        registryVersion
      );
      
      if (!toolMapping) {
        throw new ValidationError(
          `Tool mapping not found for action_type: ${intent.action_type}, ` +
          `registry_version: ${registryVersion}. ` +
          `This may indicate the action type was removed or the registry version is invalid. ` +
          `Check ActionTypeRegistry table for ACTION_TYPE#${intent.action_type}, REGISTRY_VERSION#${registryVersion}.`,
          'TOOL_MAPPING_NOT_FOUND'
        );
      }
      
      // 3. Generate idempotency key (using registry_version, not tool_schema_version)
      const normalizedParams = actionTypeRegistryService.mapParametersToToolArguments(
        toolMapping,
        intent.parameters
      );
      
      const idempotencyKey = idempotencyService.generateIdempotencyKey(
        intent.tenant_id,
        action_intent_id,
        toolMapping.tool_name,
        normalizedParams,
        toolMapping.registry_version
      );
      
      // 4. Start execution attempt (conditional write for exactly-once)
      // Use executionTraceId (not intent.trace_id) - execution has its own trace
      const stateMachineTimeoutSeconds = stateMachineTimeoutHours * 3600;
      
      const attempt = await executionAttemptService.startAttempt(
        action_intent_id,
        intent.tenant_id,
        intent.account_id,
        executionTraceId, // Use execution trace, not decision trace
        idempotencyKey,
        stateMachineTimeoutSeconds, // Pass SFN timeout for TTL calculation
        false // allow_rerun=false for normal execution path (prevents accidental reruns from duplicate events)
      );
      
      // 5. Emit ledger event (use execution trace for execution lifecycle events)
      await ledgerService.append({
        eventType: LedgerEventType.EXECUTION_STARTED,
        tenantId: intent.tenant_id,
        accountId: intent.account_id,
        traceId: executionTraceId, // Use execution trace
        data: {
          action_intent_id,
          attempt_id: attempt.last_attempt_id, // Use last_attempt_id (Model A)
          attempt_count: attempt.attempt_count,
          idempotency_key: idempotencyKey,
          registry_version: toolMapping.registry_version,
          decision_trace_id: intent.trace_id, // Preserve decision trace for correlation
        },
      });
      
      // 6. Return for Step Functions (include registry_version for downstream handlers)
      return {
        action_intent_id,
        idempotency_key: idempotencyKey,
        tenant_id: intent.tenant_id,
        account_id: intent.account_id,
        trace_id: executionTraceId, // Use execution trace (single trace for execution lifecycle)
        registry_version: toolMapping.registry_version, // Pass to downstream handlers
      };
    } catch (error: any) {
      logger.error('Execution starter failed', { 
        action_intent_id, 
        error: error.message,
        errorName: error.name,
        stack: error.stack,
      });
      
      // Re-throw typed errors as-is (they're already ExecutionError subclasses)
      if (error instanceof ExecutionError || error.error_class) {
        throw error;
      }
      
      // If already executing, provide clear typed error for Step Functions
      if (error.message.includes('already in progress')) {
        throw new ExecutionAlreadyInProgressError(action_intent_id);
      }
      
      // Re-throw configuration errors as-is (they already have good messages)
      if (error.name === 'ConfigurationError') {
        throw error;
      }
      
      // Wrap unknown errors as UnknownExecutionError (fail safe)
      throw new UnknownExecutionError(
        `Failed to start execution for action_intent_id: ${action_intent_id}. ` +
        `Original error: ${error.message || 'Unknown error'}. ` +
        `Check logs for detailed error information.`,
        error
      );
    }
  };
}

// Production handler with real dependencies
const logger = new Logger('ExecutionStarterHandler');
const traceService = new TraceService(logger);

// Note: AWS_REGION is automatically set by Lambda runtime (not set in CDK environment variables)
// Validate it exists (should always be present, but fail fast if somehow missing)
const region = requireEnv('AWS_REGION', 'ExecutionStarterHandler');
const executionAttemptsTableName = requireEnv('EXECUTION_ATTEMPTS_TABLE_NAME', 'ExecutionStarterHandler');
const actionIntentTableName = requireEnv('ACTION_INTENT_TABLE_NAME', 'ExecutionStarterHandler');
const actionTypeRegistryTableName = requireEnv('ACTION_TYPE_REGISTRY_TABLE_NAME', 'ExecutionStarterHandler');
const ledgerTableName = requireEnv('LEDGER_TABLE_NAME', 'ExecutionStarterHandler');

// Initialize AWS clients
const clientConfig = getAWSClientConfig(region);
const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient(clientConfig), {
  marshallOptions: { removeUndefinedValues: true },
});

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

const actionTypeRegistryService = new ActionTypeRegistryService(
  dynamoClient,
  actionTypeRegistryTableName,
  logger
);

const idempotencyService = new IdempotencyService();

const ledgerService = new LedgerService(
  logger,
  ledgerTableName,
  region
);

const stateMachineTimeoutHours = parseInt(process.env.STATE_MACHINE_TIMEOUT_HOURS || '1', 10);

export const handler = createHandler(
  executionAttemptService,
  actionIntentService,
  actionTypeRegistryService,
  idempotencyService,
  ledgerService,
  traceService,
  logger,
  stateMachineTimeoutHours
);
