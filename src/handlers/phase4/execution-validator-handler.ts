/**
 * Execution Validator Handler - Phase 4.1
 * 
 * Validate preflight checks (expiration, kill switches, params, budget)
 * 
 * Contract: See "Execution Contract (Canonical)" section in PHASE_4_1_CODE_LEVEL_PLAN.md
 * 
 * Input: { action_intent_id, tenant_id, account_id } (from Step Functions)
 * Output: { valid: true, action_intent: {...} } or throws typed error
 * 
 * Error Taxonomy: See error taxonomy table in PHASE_4_1_CODE_LEVEL_PLAN.md
 * Errors are typed (ExecutionError subclasses) for SFN retry/catch logic.
 */

import { Handler } from 'aws-lambda';
import { z } from 'zod';
import { Logger } from '../../services/core/Logger';
import { TraceService } from '../../services/core/TraceService';
import { ActionIntentService } from '../../services/decision/ActionIntentService';
import { KillSwitchService } from '../../services/execution/KillSwitchService';
import {
  ExecutionError,
  IntentExpiredError,
  KillSwitchEnabledError,
  IntentNotFoundError,
  ValidationError,
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
  actionIntentService: ActionIntentService,
  killSwitchService: KillSwitchService,
  traceService: TraceService,
  logger: Logger
): Handler {
  return async (event: unknown) => {
  // Validate SFN input with Zod (fail fast with precise errors)
  const validationResult = StepFunctionsInputSchema.safeParse(event);
  if (!validationResult.success) {
    throw new ValidationError(
      `Invalid Step Functions input: ${validationResult.error.message}. ` +
      `Expected: { action_intent_id: string, tenant_id: string, account_id: string }. ` +
      `Received: ${JSON.stringify(event)}. ` +
      `Check EventBridge rule configuration in ExecutionInfrastructure.createExecutionTriggerRule().`
    );
  }
  
    const { action_intent_id, tenant_id, account_id } = validationResult.data;
    const traceId = traceService.generateTraceId();
    
    logger.info('Execution validator invoked', { action_intent_id, tenant_id, account_id, traceId });
    
    try {
      // 1. Fetch ActionIntentV1
      const intent = await actionIntentService.getIntent(action_intent_id, tenant_id, account_id);
      
      if (!intent) {
        throw new IntentNotFoundError(action_intent_id);
      }
      
      // 2. Check expiration
      const now = Math.floor(Date.now() / 1000);
      if (intent.expires_at_epoch <= now) {
        throw new IntentExpiredError(action_intent_id, intent.expires_at_epoch, now);
      }
      
      // 3. Check kill switches
      const executionEnabled = await killSwitchService.isExecutionEnabled(tenant_id, intent.action_type);
      if (!executionEnabled) {
        throw new KillSwitchEnabledError(tenant_id, intent.action_type);
      }
      
      // 4. Check budget (stub for Phase 4.1 - Phase 4.3 adds per-tenant budget model)
      // TODO (Phase 4.3): Implement budget checks using CostBudgetService
      // For Phase 4.1, budget checks are stubbed (always pass)
      // const budgetCheck = await costBudgetService.checkExecutionBudget(tenant_id, intent.action_type);
      // if (!budgetCheck.allowed) {
      //   throw new ValidationError(`Execution budget exceeded for tenant: ${tenant_id}`, 'BUDGET_EXCEEDED');
      // }
      
      // 5. Check required parameters (basic validation)
      // Detailed parameter validation happens in tool mapper
      
      // 6. Return valid
      return {
        valid: true,
        action_intent: intent,
      };
    } catch (error: any) {
      logger.error('Execution validation failed', { 
        action_intent_id, 
        tenant_id,
        account_id,
        error: error.message,
        errorName: error.name,
        errorClass: error.error_class,
        errorCode: error.error_code,
        retryable: error.retryable,
        stack: error.stack,
      });
      
      // Re-throw typed errors as-is (they're already ExecutionError subclasses)
      if (error instanceof ExecutionError || error.error_class) {
        throw error;
      }
      
      // Re-throw configuration errors as-is
      if (error.name === 'ConfigurationError') {
        throw error;
      }
      
      // Wrap unknown errors as ValidationError (fail safe)
      throw new ValidationError(
        `Validation failed for action_intent_id: ${action_intent_id}. ` +
        `Original error: ${error.message || 'Unknown error'}.`,
        'VALIDATION_FAILED'
      );
    }
  };
}

// Production handler with real dependencies
const logger = new Logger('ExecutionValidatorHandler');
const traceService = new TraceService(logger);

// Note: AWS_REGION is automatically set by Lambda runtime (not set in CDK environment variables)
// Validate it exists (should always be present, but fail fast if somehow missing)
const region = requireEnv('AWS_REGION', 'ExecutionValidatorHandler');
const actionIntentTableName = requireEnv('ACTION_INTENT_TABLE_NAME', 'ExecutionValidatorHandler');
const tenantsTableName = requireEnv('TENANTS_TABLE_NAME', 'ExecutionValidatorHandler');

// Initialize AWS clients
const clientConfig = getAWSClientConfig(region);
const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient(clientConfig), {
  marshallOptions: { removeUndefinedValues: true },
});

const actionIntentService = new ActionIntentService(
  dynamoClient,
  actionIntentTableName,
  logger
);

const killSwitchService = new KillSwitchService(
  dynamoClient,
  tenantsTableName,
  logger
);

export const handler = createHandler(
  actionIntentService,
  killSwitchService,
  traceService,
  logger
);
