/**
 * Compensation Handler - Phase 4.2
 * 
 * Handle compensation (rollback) for failed executions
 * 
 * Contract: See "Execution Contract (Canonical)" section in PHASE_4_2_CODE_LEVEL_PLAN.md
 * 
 * Step Functions input: {
 *   action_intent_id, tenant_id, account_id, trace_id, registry_version,
 *   execution_result: ToolInvocationResponse
 * }
 * 
 * Note: trace_id is execution_trace_id (from starter handler), not decision_trace_id.
 * Note: AUTOMATIC compensation implementation is deferred to Phase 4.3/4.4.
 */

import { Handler } from 'aws-lambda';
import { Logger } from '../../services/core/Logger';
import { TraceService } from '../../services/core/TraceService';
import { ActionIntentService } from '../../services/decision/ActionIntentService';
import { ActionTypeRegistryService } from '../../services/execution/ActionTypeRegistryService';
import { ExecutionOutcomeService } from '../../services/execution/ExecutionOutcomeService';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { getAWSClientConfig } from '../../utils/aws-client-config';

const logger = new Logger('CompensationHandler');
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
const region = requireEnv('AWS_REGION', 'CompensationHandler');
const actionIntentTableName = requireEnv('ACTION_INTENT_TABLE_NAME', 'CompensationHandler');
const actionTypeRegistryTableName = requireEnv('ACTION_TYPE_REGISTRY_TABLE_NAME', 'CompensationHandler');
const executionOutcomesTableName = requireEnv('EXECUTION_OUTCOMES_TABLE_NAME', 'CompensationHandler');

// Initialize AWS clients
const clientConfig = getAWSClientConfig(region);
const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient(clientConfig), {
  marshallOptions: { removeUndefinedValues: true },
});

// Initialize services
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

const executionOutcomeService = new ExecutionOutcomeService(
  dynamoClient,
  executionOutcomesTableName,
  logger
);

export const handler: Handler = async (event: {
  action_intent_id: string;
  tenant_id: string;
  account_id: string;
  trace_id: string;
  registry_version: number;
  execution_result: any;
}) => {
  const { action_intent_id, tenant_id, account_id, trace_id, registry_version, execution_result } = event;
  // Use execution_trace_id from SFN input (do NOT generate new traceId)
  // This maintains trace correlation across the entire execution lifecycle
  // If you need per-handler span IDs for distributed tracing, use a different field name
  
  logger.info('Compensation handler invoked', { action_intent_id, trace_id });
  
  try {
    // 1. Fetch ActionIntentV1
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
    
    // 2. Get tool mapping to determine compensation strategy
    // Use registry_version from SFN input (deterministic execution)
    // If not provided, fall back to intent.registry_version
    const registryVersion = registry_version || intent.registry_version;
    if (!registryVersion) {
      throw new Error(`Registry version not found for action_intent_id: ${action_intent_id}. ` +
        `This is required for deterministic compensation.`);
    }
    
    const toolMapping = await actionTypeRegistryService.getToolMapping(
      intent.action_type,
      registryVersion
    );
    
    if (!toolMapping) {
      throw new Error(`Tool mapping not found for action_type: ${intent.action_type}`);
    }
    
    // 3. Check if compensation is supported
    if (toolMapping.compensation_strategy === 'NONE') {
      logger.warn('Compensation not supported for this action type', {
        action_intent_id,
        action_type: intent.action_type,
      });
      return {
        compensation_status: 'NONE',
        reason: 'Compensation not supported for this action type',
      };
    }
    
    // 4. Get external object refs from execution result
    const externalObjectRefs = execution_result.external_object_refs || [];
    
    if (externalObjectRefs.length === 0) {
      logger.info('No external objects to compensate', { action_intent_id });
      return {
        compensation_status: 'COMPLETED',
        reason: 'No external objects created',
      };
    }
    
    // 5. Call compensation tool via Gateway (if automatic)
    // TODO: Implement compensation tool invocation via Gateway
    // For now, mark as pending manual compensation
    if (toolMapping.compensation_strategy === 'AUTOMATIC') {
      // NOTE: AUTOMATIC compensation strategy exists in registry, but implementation lands in Phase 4.3/4.4
      // Phase 4.2 only implements the SFN routing and handler structure
      // The actual compensation tool invocation will be implemented in later phases
      logger.info('Automatic compensation not yet implemented (Phase 4.3/4.4)', {
        action_intent_id,
        external_object_refs: externalObjectRefs,
      });
      
      return {
        compensation_status: 'PENDING',
        reason: 'Automatic compensation implementation deferred to Phase 4.3/4.4',
      };
    }
    
    // Manual compensation
    return {
      compensation_status: 'PENDING',
      reason: 'Requires manual compensation',
    };
  } catch (error: any) {
    logger.error('Compensation failed', { action_intent_id, error });
    
    return {
      compensation_status: 'FAILED',
      compensation_error: error.message,
    };
  }
};
