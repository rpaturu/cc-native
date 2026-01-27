/**
 * Tool Mapper Handler - Phase 4.2
 * 
 * Maps action types to tools using deterministic registry_version
 * 
 * Contract: See "Execution Contract (Canonical)" section in PHASE_4_2_CODE_LEVEL_PLAN.md
 * 
 * Step Functions input: { action_intent_id, tenant_id, account_id, idempotency_key, trace_id, registry_version, attempt_count, started_at }
 * Step Functions output: { gateway_url, tool_name, tool_arguments, tool_schema_version, registry_version, compensation_strategy, idempotency_key, action_intent_id, tenant_id, account_id, trace_id, attempt_count, started_at }
 * 
 * Note: jwt_token is retrieved in ToolInvoker handler (not in ToolMapper) to keep mapping deterministic.
 * Note: trace_id is execution_trace_id (from starter handler), not decision_trace_id.
 * Note: registry_version is from starter handler output (deterministic execution).
 */

import { Handler } from 'aws-lambda';
import { z } from 'zod';
import { Logger } from '../../services/core/Logger';
import { TraceService } from '../../services/core/TraceService';
import { ActionIntentService } from '../../services/decision/ActionIntentService';
import { ActionTypeRegistryService } from '../../services/execution/ActionTypeRegistryService';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { getAWSClientConfig } from '../../utils/aws-client-config';

const logger = new Logger('ToolMapperHandler');
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
      `Check CDK stack definition for ExecutionInfrastructure construct. ` +
      `For AGENTCORE_GATEWAY_URL, ensure Gateway is configured and URL is provided.`
    );
    error.name = 'ConfigurationError';
    throw error;
  }
  return value;
}

// Note: AWS_REGION is automatically set by Lambda runtime (not set in CDK environment variables)
// Validate it exists (should always be present, but fail fast if somehow missing)
const region = requireEnv('AWS_REGION', 'ToolMapperHandler');
const actionIntentTableName = requireEnv('ACTION_INTENT_TABLE_NAME', 'ToolMapperHandler');
const actionTypeRegistryTableName = requireEnv('ACTION_TYPE_REGISTRY_TABLE_NAME', 'ToolMapperHandler');
const gatewayUrl = requireEnv('AGENTCORE_GATEWAY_URL', 'ToolMapperHandler');

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

// Zod schema for SFN input validation (fail fast with precise errors)
const StepFunctionsInputSchema = z.object({
  action_intent_id: z.string().min(1, 'action_intent_id is required'),
  tenant_id: z.string().min(1, 'tenant_id is required'),
  account_id: z.string().min(1, 'account_id is required'),
  idempotency_key: z.string().min(1, 'idempotency_key is required'),
  trace_id: z.string().min(1, 'trace_id is required'), // execution_trace_id from starter handler
  registry_version: z.number().int().positive('registry_version must be positive integer'), // From starter handler output
  attempt_count: z.number().int().positive('attempt_count must be positive integer'), // From starter handler output
  started_at: z.string().min(1, 'started_at is required'), // From starter handler output
}).strict();

export const handler: Handler = async (event: unknown) => {
  // Validate SFN input with Zod (fail fast with precise errors)
  const validationResult = StepFunctionsInputSchema.safeParse(event);
  if (!validationResult.success) {
    const error = new Error(
      `[ToolMapperHandler] Invalid Step Functions input: ${validationResult.error.message}. ` +
      `Expected: { action_intent_id: string, tenant_id: string, account_id: string, idempotency_key: string, trace_id: string, registry_version: number, attempt_count: number, started_at: string }. ` +
      `Received: ${JSON.stringify(event)}. ` +
      `Check Step Functions state machine definition to ensure all required fields are passed from execution-starter-handler output.`
    );
    error.name = 'InvalidEventError';
    throw error;
  }
  
  const { action_intent_id, tenant_id, account_id, idempotency_key, trace_id, registry_version, attempt_count, started_at } = validationResult.data;
  
  logger.info('Tool mapper invoked', { action_intent_id, tenant_id, account_id, trace_id, registry_version });
  
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
    
    // 2. Get tool mapping from registry using registry_version (from starter handler output)
    // This ensures deterministic execution - uses the exact registry version recorded at decision time
    const toolMapping = await actionTypeRegistryService.getToolMapping(
      intent.action_type,
      registry_version // Use registry_version from Step Functions input (from starter handler)
    );
    
    if (!toolMapping) {
      // Use typed error for SFN-friendly classification
      const error = new Error(
        `Tool mapping not found for action_type: ${intent.action_type}, registry_version: ${registry_version}. ` +
        `This may indicate the action type was removed or the registry version is invalid. ` +
        `Check ActionTypeRegistry table for ACTION_TYPE#${intent.action_type}, REGISTRY_VERSION#${registry_version}.`
      );
      error.name = 'ConfigurationError'; // SFN will route to failure recorder, not retry
      throw error;
    }
    
    // 3. Map parameters to tool arguments
    const toolArguments = actionTypeRegistryService.mapParametersToToolArguments(
      toolMapping,
      intent.parameters
    );
    
    // 4. Add execution metadata to tool arguments (for adapter-level idempotency and audit)
    toolArguments.idempotency_key = idempotency_key;
    toolArguments.action_intent_id = action_intent_id; // Required for recordExternalWriteDedupe()
    
    // 5. Return for Step Functions (JWT token retrieval moved to ToolInvoker)
    // Note: trace_id is execution_trace_id (from starter handler), not decision_trace_id
    // Note: registry_version, attempt_count, started_at are passed through for execution recorder
    // Note: compensation_strategy is included for SFN Choice state to determine if compensation is needed
    return {
      gateway_url: gatewayUrl,
      tool_name: toolMapping.tool_name,
      tool_arguments: toolArguments,
      tool_schema_version: toolMapping.tool_schema_version,
      registry_version: registry_version, // Pass through for execution recorder
      compensation_strategy: toolMapping.compensation_strategy, // For SFN compensation decision
      idempotency_key: idempotency_key,
      action_intent_id,
      tenant_id,
      account_id,
      trace_id, // execution_trace_id (from starter handler), not intent.trace_id
      attempt_count, // Pass through for execution recorder
      started_at, // Pass through for execution recorder
    };
  } catch (error: any) {
    logger.error('Tool mapping failed', { action_intent_id, error: error.message, errorName: error.name, stack: error.stack });
    throw error;
  }
};
