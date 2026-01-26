# Phase 4.2 — Orchestration: Code-Level Implementation Plan

**Status:** 🟡 **PLANNING**  
**Created:** 2026-01-26  
**Last Updated:** 2026-01-26 (Updated to align with Phase 4.1 revisions)  
**Parent Document:** `PHASE_4_CODE_LEVEL_PLAN.md`  
**Prerequisites:** Phase 4.1 complete

---

## Execution Contract (Canonical)

**See Phase 4.1 document for complete contract details. Key points:**

1. **Step Functions Input** (from EventBridge rule): `{ action_intent_id, tenant_id, account_id }`
2. **execution-starter-handler Output**: `{ action_intent_id, idempotency_key, tenant_id, account_id, trace_id, registry_version, attempt_count, started_at }`
   - `trace_id` = `execution_trace_id` (generated at execution start)
   - `registry_version` = Registry version used for this execution (from ActionIntentV1)
   - `attempt_count` = Execution attempt count (from ExecutionAttempt)
   - `started_at` = Execution start timestamp (from ExecutionAttempt)
3. **Execution Tracing**: Two separate traces:
   - `execution_trace_id`: Generated at execution start, used for all execution lifecycle events
   - `decision_trace_id`: From Phase 3 ActionIntentV1, used as correlation field in ledger events
4. **ActionIntent Contract**: `ActionIntentV1.registry_version` is REQUIRED (stored at Phase 3 decision time)

**All Phase 4.2 handlers must:**
- Use `execution_trace_id` (from Step Functions input) for execution lifecycle events
- Use `registry_version` (from Step Functions input) for tool mapping lookup
- Include `decision_trace_id` as correlation field in ledger events (fetch from intent if needed)

**Key Changes from Phase 4.1 Revisions:**
1. **registry_version**: Use `registry_version` from ActionIntentV1 (not `parameters_schema_version`)
2. **execution_trace_id**: Use `trace_id` from Step Functions input (from starter handler), not `intent.trace_id`
3. **Zod Validation**: All handlers use Zod schemas for SFN input validation (fail-fast)
4. **registry_version in outcomes**: Include `registry_version` in execution outcomes for audit
5. **decision_trace_id correlation**: Fetch intent to get `decision_trace_id` for ledger event correlation

---

## Overview

Phase 4.2 implements the execution orchestration layer:
- Step Functions state machine for execution lifecycle
- Tool mapper handler (action type → tool mapping)
- ToolInvoker Lambda (MCP Gateway client)
- Execution recorder handler
- Compensation handler
- EventBridge rule (ACTION_APPROVED → Step Functions)

**Duration:** Week 2-3  
**Dependencies:** Phase 4.1 complete

---

## Implementation Tasks

1. Tool mapper handler
2. ToolInvoker Lambda (MCP Gateway client)
3. Execution recorder handler
4. Compensation handler
5. Step Functions state machine (CDK)
6. EventBridge rule (ACTION_APPROVED → Step Functions)
7. DLQs for all handlers

---

## 1. Lambda Handlers

### File: `src/handlers/phase4/tool-mapper-handler.ts`

**Purpose:** Map action type to tool (versioned registry lookup)

**Handler:**

```typescript
import { Handler } from 'aws-lambda';
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

/**
 * Step Functions input: { action_intent_id, tenant_id, account_id, idempotency_key, trace_id, registry_version, attempt_count, started_at }
 * (trace_id, registry_version, attempt_count, started_at come from execution-starter-handler output)
 * 
 * Step Functions output: { gateway_url, tool_name, tool_arguments, tool_schema_version, registry_version, compensation_strategy, idempotency_key, action_intent_id, tenant_id, account_id, trace_id, attempt_count, started_at }
 * Note: attempt_count is passed through for ToolInvoker to generate stable tool_run_ref
 * 
 * Note: jwt_token is retrieved in ToolInvoker handler (not in ToolMapper) to keep mapping deterministic.
 * 
 * Note: trace_id is execution_trace_id (from starter handler), not decision_trace_id.
 * Note: registry_version is from starter handler output (deterministic execution).
 */
import { z } from 'zod';

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
      throw new Error(`ActionIntent not found: ${action_intent_id}`);
    }
    
    // 2. Get tool mapping from registry using registry_version (from starter handler output)
    // This ensures deterministic execution - uses the exact registry version recorded at decision time
    const toolMapping = await actionTypeRegistryService.getToolMapping(
      intent.action_type,
      registry_version // Use registry_version from Step Functions input (from starter handler)
    );
    
    if (!toolMapping) {
      throw new Error(
        `Tool mapping not found for action_type: ${intent.action_type}, registry_version: ${registry_version}. ` +
        `This may indicate the action type was removed or the registry version is invalid. ` +
        `Check ActionTypeRegistry table for ACTION_TYPE#${intent.action_type}, REGISTRY_VERSION#${registry_version}.`
      );
    }
    
    // 3. Map parameters to tool arguments
    const toolArguments = actionTypeRegistryService.mapParametersToToolArguments(
      toolMapping,
      intent.parameters
    );
    
    // 4. Add idempotency_key to tool arguments (for adapter-level idempotency)
    toolArguments.idempotency_key = idempotency_key;
    
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

// Note: JWT token retrieval moved to ToolInvoker handler (see tool-invoker-handler.ts)
// This keeps mapping deterministic and purely data-driven, while auth logic lives near the HTTP caller
```

### File: `src/handlers/phase4/tool-invoker-handler.ts`

**Purpose:** MCP Gateway client (centralizes MCP protocol, auth, retries, timeouts)

**Handler:**

```typescript
import { Handler } from 'aws-lambda';
import { Logger } from '../../services/core/Logger';
import { TraceService } from '../../services/core/TraceService';
import { ToolInvocationRequest, ToolInvocationResponse } from '../../types/ExecutionTypes';
import axios, { AxiosError } from 'axios';

const logger = new Logger('ToolInvokerHandler');
const traceService = new TraceService(logger);

// Note: No DynamoDB client needed - this handler only calls Gateway via HTTP

/**
 * Step Functions input: ToolInvocationRequest
 * Step Functions output: ToolInvocationResponse
 * 
 * IMPORTANT: This handler throws errors for SFN retry/catch logic:
 * - Throws Error with name='TransientError' for retryable errors (via invokeWithRetry)
 * - Throws Error with name='PermanentError' for non-retryable errors (via invokeWithRetry)
 * - Only returns ToolInvocationResponse (with success:false) for tool-level business failures
 *   where tool ran but reported an error (proceed to RecordOutcome without SFN retry)
 */
/**
 * Zod schema for SFN input validation (fail fast with precise errors)
 */
import { z } from 'zod';

const ToolInvocationRequestSchema = z.object({
  gateway_url: z.string().url('gateway_url must be a valid URL'),
  tool_name: z.string().min(1, 'tool_name is required'),
  tool_arguments: z.record(z.string(), z.any(), 'tool_arguments must be a plain object (not array, not null)')
    .refine(
      (val) => {
        // Size guard: prevent huge SFN payloads (max 256KB for SFN input)
        // tool_arguments should be < 200KB to leave room for other fields
        const size = JSON.stringify(val).length;
        return size < 200 * 1024; // 200KB
      },
      { message: 'tool_arguments exceeds size limit (200KB). Large payloads should be passed via S3 artifact reference.' }
    ),
  idempotency_key: z.string().min(1, 'idempotency_key is required'),
  action_intent_id: z.string().min(1, 'action_intent_id is required'),
  tenant_id: z.string().min(1, 'tenant_id is required'),
  account_id: z.string().min(1, 'account_id is required'),
  trace_id: z.string().min(1, 'trace_id is required'),
  attempt_count: z.number().int().positive().optional(), // Optional for tool_run_ref generation
}).strict();

export const handler: Handler = async (event: unknown) => {
  // Validate SFN input with Zod (fail fast with precise errors)
  const validationResult = ToolInvocationRequestSchema.safeParse(event);
  if (!validationResult.success) {
    const error = new Error(
      `[ToolInvokerHandler] Invalid Step Functions input: ${validationResult.error.message}. ` +
      `Expected: { gateway_url: string, tool_name: string, tool_arguments: object, idempotency_key: string, action_intent_id: string, tenant_id: string, account_id: string, trace_id: string, attempt_count?: number }. ` +
      `Received: ${JSON.stringify(event)}. ` +
      `Check Step Functions state machine definition to ensure all required fields are passed from tool-mapper-handler output.`
    );
    error.name = 'ValidationError';
    throw error;
  }
  
  const { gateway_url, tool_name, tool_arguments, idempotency_key, action_intent_id, tenant_id, account_id, trace_id, attempt_count } = validationResult.data;
  
  logger.info('Tool invoker invoked', { action_intent_id, tool_name, trace_id });
  
  // IMPORTANT: Error semantics for SFN retry/catch logic
  // 
  // THROW (for SFN retry/catch):
  // - Infrastructure errors: network failures, timeouts, 5xx responses
  // - Auth errors: JWT token retrieval failures, 401/403 responses
  // - These throw TransientError (retryable) or PermanentError (non-retryable)
  // - SFN will retry on TransientError and catch PermanentError
  //
  // RETURN success:false (for business logic):
  // - Tool ran successfully but reported a structured business failure
  // - Gateway returned HTTP 200 with success:false in response payload
  // - These proceed to RecordOutcome without SFN retry
  //
  // No try-catch wrapper - let ALL infrastructure/auth errors bubble up to SFN
  
  // 1. Get JWT token for Gateway authentication (Cognito)
  // This is done here (not in ToolMapper) to keep mapping deterministic and auth logic near HTTP caller
  // If getJwtToken throws, error bubbles to SFN (will be caught as generic error or we can wrap it)
  const jwtToken = await getJwtToken(tenant_id);
  
  // 2. Make MCP protocol call to AgentCore Gateway
  const mcpRequest = {
    jsonrpc: '2.0',
    id: `invoke-${Date.now()}`,
    method: 'tools/call',
    params: {
      name: tool_name,
      arguments: tool_arguments,
    },
  };
  
  // Generate stable, traceable tool_run_ref for audit joins
  // Format: toolrun/{execution_trace_id}/{attempt_count}/{tool_name}
  // This allows correlating tool invocations with execution attempts and traces
  const toolRunRef = `toolrun/${trace_id}/${attempt_count || 1}/${tool_name}`;
  
  // 3. Call Gateway with retry logic
  // invokeWithRetry throws errors with name='TransientError' or 'PermanentError' for SFN
  const response = await invokeWithRetry(
    gateway_url,
    mcpRequest,
    jwtToken,
    toolRunRef,
    action_intent_id
  );
  
  // 4. Parse MCP response
  const parsedResponse = parseMCPResponse(response);
  
  // 5. Extract external object refs (use input tool_name for system inference)
  const externalObjectRefs = extractExternalObjectRefs(parsedResponse, tool_name);
  
  // 6. Check if tool reported a structured failure (tool ran but returned error)
  // In this case, we return success:false but don't throw (proceed to RecordOutcome)
  // This is different from HTTP/infrastructure errors which throw for SFN retry/catch
  if (parsedResponse.success === false) {
    const errorClassification = classifyError(parsedResponse);
    return {
      success: false,
      external_object_refs: externalObjectRefs,
      tool_run_ref: toolRunRef,
      raw_response_artifact_ref: parsedResponse.raw_response_artifact_ref,
      error_code: errorClassification?.error_code,
      error_class: errorClassification?.error_class,
      error_message: errorClassification?.error_message,
    };
  }
  
  // 7. Tool succeeded - return structured response
  return {
    success: true,
    external_object_refs: externalObjectRefs,
    tool_run_ref: toolRunRef,
    raw_response_artifact_ref: parsedResponse.raw_response_artifact_ref,
  };
};

/**
 * Invoke Gateway with retry logic (exponential backoff)
 * 
 * IMPORTANT: This function throws errors for SFN retry/catch logic.
 * - Throws Error with name='TransientError' for retryable errors (5xx, network, timeout)
 * - Throws Error with name='PermanentError' for non-retryable errors (4xx auth/validation)
 * - Only returns response data on success
 * 
 * Step Functions will:
 * - Retry on 'TransientError' (via .addRetry configuration)
 * - Catch 'PermanentError' and route to compensation/failure handlers
 */
async function invokeWithRetry(
  gatewayUrl: string,
  mcpRequest: any,
  jwtToken: string,
  toolRunRef: string,
  actionIntentId: string,
  maxRetries: number = 3
): Promise<any> {
  let lastError: any;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await axios.post(
        gatewayUrl,
        mcpRequest,
        {
          headers: {
            'Authorization': `Bearer ${jwtToken}`,
            'Content-Type': 'application/json',
          },
          timeout: 30000, // 30 seconds
        }
      );
      
      return response.data;
    } catch (error: any) {
      lastError = error;
      
      // Check if error is retryable
      const isRetryable = isRetryableError(error);
      
      // If not retryable or max retries reached, throw with SFN-compatible error name
      if (!isRetryable || attempt === maxRetries) {
        const errorName = isRetryable ? 'TransientError' : 'PermanentError';
        const sfError = new Error(`${errorName}: ${error.message || 'Unknown error'}`);
        sfError.name = errorName;
        throw sfError;
      }
      
      // Exponential backoff
      const delay = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
      await new Promise(resolve => setTimeout(resolve, delay));
      
      logger.warn('Tool invocation retry', {
        action_intent_id: actionIntentId,
        attempt: attempt + 1,
        maxRetries,
        error: error.message,
      });
    }
  }
  
  // Should never reach here (thrown in loop), but TypeScript requires return
  const errorName = isRetryableError(lastError) ? 'TransientError' : 'PermanentError';
  const sfError = new Error(`${errorName}: ${lastError?.message || 'Unknown error'}`);
  sfError.name = errorName;
  throw sfError;
}

/**
 * Check if error is retryable (transient)
 * 
 * Retryable errors include:
 * - 5xx server errors (gateway/adapter failures)
 * - 429 rate limiting (with backoff)
 * - Network errors: DNS failures, connection refused, timeouts, resets
 */
function isRetryableError(error: any): boolean {
  if (error instanceof AxiosError) {
    // 5xx errors are retryable (server failures)
    if (error.response?.status && error.response.status >= 500) {
      return true;
    }
    
    // 429 rate limiting is retryable (with exponential backoff)
    if (error.response?.status === 429) {
      return true;
    }
    
    // Network errors are retryable
    const retryableNetworkCodes = [
      'ECONNRESET',    // Connection reset by peer
      'ETIMEDOUT',     // Connection timeout
      'ENOTFOUND',     // DNS lookup failed
      'EAI_AGAIN',     // DNS temporary failure
      'ECONNREFUSED',  // Connection refused
    ];
    if (error.code && retryableNetworkCodes.includes(error.code)) {
      return true;
    }
  }
  
  // Non-Axios network errors (e.g., from fetch or other HTTP clients)
  if (error.code && ['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT'].includes(error.code)) {
    return true;
  }
  
  return false;
}

/**
 * Parse MCP response
 * 
 * IMPORTANT: Protocol failures (malformed JSON, invalid MCP structure) throw errors for SFN retry/catch.
 * Only tool-reported business failures (success:false in valid JSON) return success:false.
 */
function parseMCPResponse(response: any): any {
  // MCP error response (structured error from Gateway)
  if (response.error) {
    // MCP protocol error - throw for SFN retry/catch
    const error = new Error(
      `MCP protocol error: ${JSON.stringify(response.error)}. ` +
      `This indicates a Gateway or adapter protocol failure, not a tool business failure.`
    );
    error.name = 'PermanentError'; // Protocol errors are typically non-retryable (but can be changed to TransientError if needed)
    throw error;
  }
  
  if (response.result?.content) {
    // Extract text content
    const textContent = response.result.content.find((c: any) => c.type === 'text');
    if (textContent) {
      try {
        const parsed = JSON.parse(textContent.text);
        // Valid JSON - return parsed response (success may be false for business failures)
        return {
          success: parsed.success !== false,
          ...parsed,
        };
      } catch (e) {
        // JSON parse failure - protocol failure, throw for SFN
        const error = new Error(
          `Failed to parse MCP response JSON: ${e instanceof Error ? e.message : 'Unknown parse error'}. ` +
          `Response text: ${textContent.text?.substring(0, 500)}. ` +
          `This is a protocol failure, not a tool business failure.`
        );
        error.name = 'PermanentError'; // Malformed JSON is typically non-retryable
        throw error;
      }
    }
  }
  
  // Invalid MCP response structure - protocol failure, throw for SFN
  const error = new Error(
    `Invalid MCP response format: missing result.content or text content. ` +
    `Response: ${JSON.stringify(response).substring(0, 500)}. ` +
    `This is a protocol failure, not a tool business failure.`
  );
  error.name = 'PermanentError';
  throw error;
}

/**
 * Extract external object refs from parsed response
 * 
 * @param parsedResponse - Parsed MCP response from Gateway
 * @param toolName - Tool name from input (used for system inference, not from response)
 * 
 * Note: Adapter contract should return external_object_refs as an array directly.
 * This function supports both:
 * - Direct array: parsedResponse.external_object_refs (preferred)
 * - Legacy single object: parsedResponse.external_object_id + object_type (for backwards compatibility)
 */
function extractExternalObjectRefs(
  parsedResponse: any,
  toolName: string
): ToolInvocationResponse['external_object_refs'] {
  // If tool failed, external refs may not exist (that's fine)
  if (!parsedResponse.success) {
    return undefined;
  }
  
  // Preferred: adapter returns external_object_refs array directly
  if (Array.isArray(parsedResponse.external_object_refs)) {
    // Validate each ref has required fields
    const validatedRefs = parsedResponse.external_object_refs.map((ref: any, index: number) => {
      if (!ref.object_id || !ref.object_type) {
        throw new Error(
          `Tool invocation response external_object_refs[${index}] is missing required fields (object_id, object_type). ` +
          `Tool: ${toolName}, Ref: ${JSON.stringify(ref)}`
        );
      }
      // Infer system from tool_name if not provided
      return {
        system: ref.system || inferSystemFromTool(toolName),
        object_type: ref.object_type,
        object_id: ref.object_id,
        object_url: ref.object_url,
      };
    });
    return validatedRefs.length > 0 ? validatedRefs : undefined;
  }
  
  // Legacy: single object format (for backwards compatibility)
  if (parsedResponse.external_object_id && parsedResponse.object_type) {
    const system = inferSystemFromTool(toolName);
    return [{
      system,
      object_type: parsedResponse.object_type,
      object_id: parsedResponse.external_object_id,
      object_url: parsedResponse.object_url,
    }];
  }
  
  // If tool succeeded but no external refs, that's an error (tool should return them)
  const error = new Error(
    'Tool invocation response is missing required field: external_object_refs (or legacy external_object_id + object_type). ' +
    'The connector adapter must return external_object_refs array in the MCP response when success=true. ' +
    `Tool: ${toolName}, Response: ${JSON.stringify(parsedResponse)}`
  );
  error.name = 'InvalidToolResponseError';
  throw error;
}

/**
 * Infer system from tool name
 */
function inferSystemFromTool(toolName: string): 'CRM' | 'CALENDAR' | 'INTERNAL' {
  if (toolName.startsWith('crm.')) {
    return 'CRM';
  }
  if (toolName.startsWith('calendar.')) {
    return 'CALENDAR';
  }
  return 'INTERNAL';
}

/**
 * Classify error from MCP response
 */
function classifyError(parsedResponse: any): {
  error_code?: string;
  error_class?: ToolInvocationResponse['error_class'];
  error_message?: string;
} {
  if (parsedResponse.success) {
    return {};
  }
  
  const error = parsedResponse.error || parsedResponse;
  const errorMessage = error.message || error.error;
  if (!errorMessage) {
    const errorObj = new Error(
      'Tool invocation failed but no error message was provided. ' +
      'The connector adapter must return a descriptive error message in the MCP response. ' +
      `Tool: ${parsedResponse.tool_name || 'unknown'}, Response: ${JSON.stringify(parsedResponse)}`
    );
    errorObj.name = 'InvalidToolResponseError';
    throw errorObj;
  }
  
  // Classify by error message patterns
  if (errorMessage.includes('authentication') || errorMessage.includes('unauthorized')) {
    return {
      error_code: 'AUTH_FAILED',
      error_class: 'AUTH',
      error_message: errorMessage,
    };
  }
  
  if (errorMessage.includes('rate limit') || errorMessage.includes('throttle')) {
    return {
      error_code: 'RATE_LIMIT',
      error_class: 'RATE_LIMIT',
      error_message: errorMessage,
    };
  }
  
  if (errorMessage.includes('validation') || errorMessage.includes('invalid')) {
    return {
      error_code: 'VALIDATION_ERROR',
      error_class: 'VALIDATION',
      error_message: errorMessage,
    };
  }
  
  if (errorMessage.includes('timeout')) {
    return {
      error_code: 'TIMEOUT',
      error_class: 'TIMEOUT',
      error_message: errorMessage,
    };
  }
  
  return {
    error_code: 'UNKNOWN_ERROR',
    error_class: 'UNKNOWN',
    error_message: errorMessage,
  };
}

/**
 * Get JWT token for Gateway authentication (Cognito)
 * 
 * Note: This is done in ToolInvoker (not ToolMapper) to keep mapping deterministic
 * and auth logic near the HTTP caller where retry/refresh logic lives.
 * 
 * IMPORTANT: If this throws, the error bubbles to SFN. Auth failures should be
 * PermanentError (non-retryable). This function throws PermanentError for consistent SFN error handling.
 */
async function getJwtToken(tenantId: string): Promise<string> {
  // TODO: Implement Cognito JWT token retrieval
  // Use Cognito Identity Pool or User Pool client credentials
  // For now, throw PermanentError (auth failures are not retryable)
  const error = new Error('PermanentError: JWT token retrieval not implemented');
  error.name = 'PermanentError';
  throw error;
}
```

### File: `src/handlers/phase4/execution-recorder-handler.ts`

**Purpose:** Record structured execution outcome (tool invocation results)

**Note:** For pre-tool failures (Start/Validate/Map errors), use `execution-failure-recorder-handler.ts` instead.

**Handler:**

```typescript
import { Handler } from 'aws-lambda';
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

/**
 * Step Functions input: {
 *   action_intent_id,
 *   tenant_id,
 *   account_id,
 *   trace_id, // execution_trace_id (from starter handler)
 *   tool_invocation_response: ToolInvocationResponse,
 *   tool_name,
 *   tool_schema_version,
 *   registry_version, // From starter handler output (for audit and backwards compatibility)
 *   attempt_count,
 *   started_at
 * }
 * 
 * Note: trace_id is execution_trace_id (from starter handler), not decision_trace_id.
 */
import { z } from 'zod';

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
    const status = tool_invocation_response.success ? 'SUCCEEDED' : 'FAILED';
    
    // 1. Record outcome (include registry_version for audit and backwards compatibility)
    const outcome = await executionOutcomeService.recordOutcome({
      action_intent_id,
      status,
      external_object_refs: tool_invocation_response.external_object_refs || [],
      error_code: tool_invocation_response.error_code,
      error_class: tool_invocation_response.error_class,
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
```

### File: `src/handlers/phase4/execution-failure-recorder-handler.ts`

**Purpose:** Record execution failures that occur before tool invocation (Start/Validate/Map errors)

**Handler:**

```typescript
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

/**
 * Step Functions input: {
 *   action_intent_id,
 *   tenant_id,
 *   account_id,
 *   trace_id, // execution_trace_id (from starter handler)
 *   registry_version, // From starter handler output
 *   status: "FAILED",
 *   error: { // Error details from Step Functions catch
 *     Error: string,
 *     Cause: string
 *   }
 * }
 * 
 * Note: This handler is called from Step Functions Catch blocks for Start/Validate/Map errors.
 */
import { z } from 'zod';

// Zod schema for SFN input validation (fail fast with precise errors)
const StepFunctionsInputSchema = z.object({
  action_intent_id: z.string().min(1, 'action_intent_id is required'),
  tenant_id: z.string().min(1, 'tenant_id is required'),
  account_id: z.string().min(1, 'account_id is required'),
  trace_id: z.string().min(1, 'trace_id is required'), // execution_trace_id
  registry_version: z.number().int().positive('registry_version must be positive integer').optional(), // May be missing if failure in starter
  status: z.literal('FAILED'),
  error: z.object({
    Error: z.string().optional(),
    Cause: z.string().optional(),
  }).optional(),
}).strict();

export const handler: Handler = async (event: unknown) => {
  // Validate SFN input with Zod (fail fast with precise errors)
  const validationResult = StepFunctionsInputSchema.safeParse(event);
  if (!validationResult.success) {
    const error = new Error(
      `[ExecutionFailureRecorderHandler] Invalid Step Functions input: ${validationResult.error.message}. ` +
      `Expected: { action_intent_id: string, tenant_id: string, account_id: string, trace_id: string, registry_version?: number, status: "FAILED", error?: { Error?: string, Cause?: string } }. ` +
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
      throw new Error(`ActionIntent not found: ${action_intent_id}`);
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
    const finalErrorClass = finalRegistryVersion === null ? 'VALIDATION' : errorClass;
    const finalErrorCode = finalRegistryVersion === null ? 'REGISTRY_VERSION_MISSING' : 'EXECUTION_FAILED';
    
    const outcome = await executionOutcomeService.recordOutcome({
      action_intent_id,
      tenant_id,
      account_id,
      trace_id, // execution_trace_id
      registry_version: finalRegistryVersion,
      status: 'FAILED',
      error_class: finalErrorClass,
      error_code: finalErrorCode,
      error_message: finalRegistryVersion === null 
        ? 'Missing registry_version in ActionIntentV1 (Phase 3 contract violation)'
        : errorMessage,
      completed_at: new Date().toISOString(),
      attempt_count: attempt.attempt_count,
      started_at: attempt.started_at,
    });
    
    // 5. Update execution attempt status
    await executionAttemptService.updateStatus(
      action_intent_id,
      tenant_id,
      account_id,
      'FAILED',
      errorClass
    );
    
    // 6. Emit ledger event (use execution trace for execution lifecycle events)
    await ledgerService.append({
      eventType: LedgerEventType.ACTION_FAILED,
      tenantId: tenant_id,
      accountId: account_id,
      traceId: trace_id, // Use execution trace
      data: {
        action_intent_id,
        error_class: errorClass,
        error_code: 'EXECUTION_FAILED',
        error_message: errorMessage,
        decision_trace_id: intent.trace_id, // Preserve decision trace for correlation
        registry_version: registry_version || intent.registry_version,
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
```

---

### File: `src/handlers/phase4/compensation-handler.ts`

**Purpose:** Handle compensation (rollback) for failed executions

**Handler:**

```typescript
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

/**
 * Step Functions input: {
 *   action_intent_id,
 *   tenant_id,
 *   account_id,
 *   trace_id, // execution_trace_id (from starter handler)
 *   registry_version, // From starter handler output (REQUIRED for deterministic compensation)
 *   execution_result: ToolInvocationResponse
 * }
 */
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
      throw new Error(`ActionIntent not found: ${action_intent_id}`);
    }
    
    // 2. Get tool mapping to determine compensation strategy
    // Use registry_version from SFN input (deterministic execution)
    // If not provided, fall back to intent.registry_version
    const registryVersion = event.registry_version || intent.registry_version;
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
      // TODO: Invoke compensation tool via Gateway
      logger.info('Automatic compensation not yet implemented', {
        action_intent_id,
        external_object_refs: externalObjectRefs,
      });
      
      return {
        compensation_status: 'PENDING',
        reason: 'Automatic compensation not yet implemented',
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
```

---

## 2. CDK Infrastructure

### File: `src/stacks/constructs/ExecutionInfrastructure.ts` (Phase 4.2 Additions)

**Purpose:** Add orchestration components to existing Phase 4.1 construct

**Phase 4.2 Additions:**

```typescript
// Add to existing ExecutionInfrastructure class

// Additional Lambda Functions (Phase 4.2)
public readonly toolMapperHandler: lambda.Function;
public readonly toolInvokerHandler: lambda.Function;
public readonly executionRecorderHandler: lambda.Function;
public readonly executionFailureRecorderHandler: lambda.Function; // For pre-tool failures
public readonly compensationHandler: lambda.Function;

// Additional Dead Letter Queues (Phase 4.2)
public readonly toolMapperDlq: sqs.Queue;
public readonly toolInvokerDlq: sqs.Queue;
public readonly executionRecorderDlq: sqs.Queue;
public readonly executionFailureRecorderDlq: sqs.Queue;
public readonly compensationDlq: sqs.Queue;

// Step Functions
public readonly executionStateMachine: stepfunctions.StateMachine;

// EventBridge Rule
public readonly executionTriggerRule: events.Rule;

// S3 Bucket (for raw response artifacts)
public readonly executionArtifactsBucket?: s3.IBucket;

  // In constructor, add Phase 4.2 components:
  constructor(scope: Construct, id: string, props: ExecutionInfrastructureProps) {
    super(scope, id);

    // Use provided config or default (consistent with Phase 3 pattern)
    const config = props.config || DEFAULT_EXECUTION_INFRASTRUCTURE_CONFIG;
    const region = props.region || config.defaults.region;

    // ... Phase 4.1 components ...
  
  // Phase 4.2: Additional DLQs
  this.toolMapperDlq = this.createDlq('ToolMapperDlq', config.queueNames.toolMapperDlq, config);
  this.toolInvokerDlq = this.createDlq('ToolInvokerDlq', config.queueNames.toolInvokerDlq, config);
  this.executionRecorderDlq = this.createDlq('ExecutionRecorderDlq', config.queueNames.executionRecorderDlq, config);
  this.executionFailureRecorderDlq = this.createDlq('ExecutionFailureRecorderDlq', config.queueNames.executionFailureRecorderDlq, config);
  this.compensationDlq = this.createDlq('CompensationDlq', config.queueNames.compensationDlq, config);
  
  // Phase 4.2: Additional Lambda Functions
  this.toolMapperHandler = this.createToolMapperHandler(props, config);
  this.toolInvokerHandler = this.createToolInvokerHandler(props, config);
  this.executionRecorderHandler = this.createExecutionRecorderHandler(props, config);
  this.executionFailureRecorderHandler = this.createExecutionFailureRecorderHandler(props, config);
  this.compensationHandler = this.createCompensationHandler(props, config);
  
  // Phase 4.2: S3 Bucket (if not provided)
  if (!props.artifactsBucket) {
    this.executionArtifactsBucket = new s3.Bucket(this, 'ExecutionArtifactsBucket', {
      bucketName: `${config.s3.executionArtifactsBucketPrefix}-${cdk.Aws.ACCOUNT_ID}-${cdk.Aws.REGION}`,
      versioned: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
    });
  } else {
    this.executionArtifactsBucket = props.artifactsBucket;
  }
  
  // Phase 4.2: Step Functions State Machine
  this.executionStateMachine = this.createExecutionStateMachine(config);
  
  // Phase 4.2: EventBridge Rule
  this.executionTriggerRule = this.createExecutionTriggerRule(props, config);
}

private createToolMapperHandler(
  props: ExecutionInfrastructureProps,
  config: ExecutionInfrastructureConfig
): lambda.Function {
  const handler = new lambdaNodejs.NodejsFunction(this, 'ToolMapperHandler', {
    functionName: config.functionNames.toolMapper,
    entry: 'src/handlers/phase4/tool-mapper-handler.ts',
    handler: 'handler',
    runtime: lambda.Runtime.NODEJS_20_X,
    timeout: cdk.Duration.seconds(config.defaults.timeout.toolMapper),
    memorySize: config.defaults.memorySize?.toolMapper,
    environment: {
      ACTION_INTENT_TABLE_NAME: props.actionIntentTable.tableName,
      ACTION_TYPE_REGISTRY_TABLE_NAME: this.actionTypeRegistryTable.tableName,
      AGENTCORE_GATEWAY_URL: props.gatewayUrl || (() => {
        throw new Error(
          '[ExecutionInfrastructure] Missing required property: gatewayUrl. ' +
          'Provide gatewayUrl in ExecutionInfrastructureProps or ensure AgentCore Gateway is configured. ' +
          'The Gateway URL is required for tool-mapper-handler to invoke connector adapters.'
        );
      })(),
      // Note: AWS_REGION is automatically set by Lambda runtime and should not be set manually
    },
    deadLetterQueue: this.toolMapperDlq,
    deadLetterQueueEnabled: true,
    retryAttempts: config.lambda.retryAttempts,
  });
  
  // Grant permissions
  props.actionIntentTable.grantReadData(handler);
  this.actionTypeRegistryTable.grantReadData(handler);
  
  // Note: Cognito permissions are NOT granted here - JWT token retrieval is done in ToolInvoker
  // This keeps ToolMapper "pure mapping + param shaping" and deterministic
  
  return handler;
}

private createToolInvokerHandler(
  props: ExecutionInfrastructureProps,
  config: ExecutionInfrastructureConfig
): lambda.Function {
  const handler = new lambdaNodejs.NodejsFunction(this, 'ToolInvokerHandler', {
    functionName: config.functionNames.toolInvoker,
    entry: 'src/handlers/phase4/tool-invoker-handler.ts',
    handler: 'handler',
    runtime: lambda.Runtime.NODEJS_20_X,
    timeout: cdk.Duration.seconds(config.defaults.timeout.toolInvoker),
    memorySize: config.defaults.memorySize?.toolInvoker,
    environment: {
      EXECUTION_ARTIFACTS_BUCKET: this.executionArtifactsBucket?.bucketName || (() => {
        throw new Error(
          '[ExecutionInfrastructure] Missing required property: artifactsBucket. ' +
          'Provide artifactsBucket in ExecutionInfrastructureProps or ensure ExecutionArtifactsBucket is created. ' +
          'This bucket is used to store large tool invocation responses.'
        );
      })(),
      // Note: AWS_REGION is automatically set by Lambda runtime and should not be set manually
    },
    deadLetterQueue: this.toolInvokerDlq,
    deadLetterQueueEnabled: true,
    retryAttempts: config.lambda.retryAttempts,
  });
  
  // Grant S3 permissions (for raw response artifacts)
  if (this.executionArtifactsBucket) {
    this.executionArtifactsBucket.grantWrite(handler);
  }
  
  // Grant Cognito permissions for JWT token retrieval (if userPool provided)
  // Note: JWT token retrieval is done in ToolInvoker (not ToolMapper) to keep mapping deterministic
  if (props.userPool) {
    handler.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['cognito-idp:GetUser', 'cognito-idp:InitiateAuth'],
      resources: [props.userPool.userPoolArn],
    }));
  }
  
  return handler;
}

private createExecutionRecorderHandler(
  props: ExecutionInfrastructureProps,
  config: ExecutionInfrastructureConfig
): lambda.Function {
  const handler = new lambdaNodejs.NodejsFunction(this, 'ExecutionRecorderHandler', {
    functionName: config.functionNames.executionRecorder,
    entry: 'src/handlers/phase4/execution-recorder-handler.ts',
    handler: 'handler',
    runtime: lambda.Runtime.NODEJS_20_X,
    timeout: cdk.Duration.seconds(config.defaults.timeout.executionRecorder),
    memorySize: config.defaults.memorySize?.executionRecorder,
    environment: {
      EXECUTION_OUTCOMES_TABLE_NAME: this.executionOutcomesTable.tableName,
      EXECUTION_ATTEMPTS_TABLE_NAME: this.executionAttemptsTable.tableName,
      LEDGER_TABLE_NAME: props.ledgerTable.tableName,
      SIGNALS_TABLE_NAME: props.signalsTable?.tableName || (() => {
        throw new Error(
          '[ExecutionInfrastructure] Missing required property: signalsTable. ' +
          'Provide signalsTable in ExecutionInfrastructureProps. ' +
          'This table is required for execution-recorder-handler to emit execution outcome signals.'
        );
      })(),
      ACCOUNTS_TABLE_NAME: props.accountsTable?.tableName || (() => {
        throw new Error(
          '[ExecutionInfrastructure] Missing required property: accountsTable. ' +
          'Provide accountsTable in ExecutionInfrastructureProps. ' +
          'This table is required for SignalService to update account state atomically with signals.'
        );
      })(),
      EVENT_BUS_NAME: props.eventBus.eventBusName,
      // Note: AWS_REGION is automatically set by Lambda runtime and should not be set manually
    },
    deadLetterQueue: this.executionRecorderDlq,
    deadLetterQueueEnabled: true,
    retryAttempts: config.lambda.retryAttempts,
  });
  
    // Grant permissions
    this.executionOutcomesTable.grantWriteData(handler);
    this.executionAttemptsTable.grantWriteData(handler);
    props.actionIntentTable.grantReadData(handler); // For fetching decision_trace_id
    props.ledgerTable.grantWriteData(handler);
  props.eventBus.grantPutEventsTo(handler);
  
  return handler;
}

private createExecutionFailureRecorderHandler(
  props: ExecutionInfrastructureProps,
  config: ExecutionInfrastructureConfig
): lambda.Function {
  // Use NodejsFunction for consistency with other handlers (same bundling, env var behavior)
  const handler = new lambdaNodejs.NodejsFunction(this, 'ExecutionFailureRecorderHandler', {
    functionName: config.functionNames.executionFailureRecorder,
    entry: 'src/handlers/phase4/execution-failure-recorder-handler.ts',
    handler: 'handler',
    runtime: lambda.Runtime.NODEJS_20_X,
    timeout: cdk.Duration.seconds(config.defaults.timeout.executionRecorder),
    memorySize: config.defaults.memorySize?.executionRecorder,
    environment: {
      EXECUTION_OUTCOMES_TABLE_NAME: config.tableNames.executionOutcomes,
      EXECUTION_ATTEMPTS_TABLE_NAME: config.tableNames.executionAttempts,
      ACTION_INTENT_TABLE_NAME: config.tableNames.actionIntent,
      LEDGER_TABLE_NAME: config.tableNames.ledger,
      // Note: AWS_REGION is automatically set by Lambda runtime and should not be set manually
    },
    deadLetterQueue: this.executionFailureRecorderDlq,
    deadLetterQueueEnabled: true,
    retryAttempts: 0, // No retries - failures are terminal
  });
  
  // Grant permissions
  this.executionOutcomesTable.grantWriteData(handler);
  this.executionAttemptsTable.grantReadWriteData(handler);
  this.actionIntentTable.grantReadData(handler);
  this.ledgerTable.grantWriteData(handler);
  
  return handler;
}

private createCompensationHandler(
  props: ExecutionInfrastructureProps,
  config: ExecutionInfrastructureConfig
): lambda.Function {
  const handler = new lambdaNodejs.NodejsFunction(this, 'CompensationHandler', {
    functionName: config.functionNames.compensation,
    entry: 'src/handlers/phase4/compensation-handler.ts',
    handler: 'handler',
    runtime: lambda.Runtime.NODEJS_20_X,
    timeout: cdk.Duration.seconds(config.defaults.timeout.compensation),
    memorySize: config.defaults.memorySize?.compensation,
    environment: {
      ACTION_INTENT_TABLE_NAME: props.actionIntentTable.tableName,
      ACTION_TYPE_REGISTRY_TABLE_NAME: this.actionTypeRegistryTable.tableName,
      EXECUTION_OUTCOMES_TABLE_NAME: this.executionOutcomesTable.tableName,
      EXTERNAL_WRITE_DEDUPE_TABLE_NAME: this.externalWriteDedupeTable.tableName,
      // Note: AWS_REGION is automatically set by Lambda runtime and should not be set manually
    },
    deadLetterQueue: this.compensationDlq,
    deadLetterQueueEnabled: true,
    retryAttempts: config.lambda.retryAttempts,
  });
  
  // Grant permissions
  props.actionIntentTable.grantReadData(handler);
  this.actionTypeRegistryTable.grantReadData(handler);
  this.executionOutcomesTable.grantReadWriteData(handler);
  this.externalWriteDedupeTable.grantReadData(handler);
  
  return handler;
}

private createExecutionStateMachine(config: ExecutionInfrastructureConfig): stepfunctions.StateMachine {
  const definition = this.buildStateMachineDefinition();
  
  return new stepfunctions.StateMachine(this, 'ExecutionStateMachine', {
    stateMachineName: config.stepFunctions.stateMachineName,
    definition,
    timeout: cdk.Duration.hours(config.stepFunctions.timeoutHours),
  });
}

private buildStateMachineDefinition(): stepfunctions.IChainable {
  // START_EXECUTION
  const startExecution = new stepfunctionsTasks.LambdaInvoke(this, 'StartExecution', {
    lambdaFunction: this.executionStarterHandler,
    payloadResponseOnly: true, // Return payload only (not Lambda response envelope)
  });
  
  // VALIDATE_PREFLIGHT
  const validatePreflight = new stepfunctionsTasks.LambdaInvoke(this, 'ValidatePreflight', {
    lambdaFunction: this.executionValidatorHandler,
    payloadResponseOnly: true,
  });
  
  // MAP_ACTION_TO_TOOL
  const mapActionToTool = new stepfunctionsTasks.LambdaInvoke(this, 'MapActionToTool', {
    lambdaFunction: this.toolMapperHandler,
    payloadResponseOnly: true,
  });
  
  // INVOKE_TOOL (with retry)
  // Note: resultPath wraps ToolInvoker output under tool_invocation_response key
  // This matches execution-recorder-handler input schema
  // IMPORTANT: tool_name and tool_schema_version from ToolMapper output remain at top level
  // (resultPath only wraps ToolInvoker output, it doesn't replace the entire state)
  const invokeTool = new stepfunctionsTasks.LambdaInvoke(this, 'InvokeTool', {
    lambdaFunction: this.toolInvokerHandler,
    payloadResponseOnly: true,
    resultPath: '$.tool_invocation_response', // Wrap output for recorder handler
    retryOnServiceExceptions: true,
  }).addRetry({
    errors: ['TransientError'],
    interval: cdk.Duration.seconds(2),
    maxAttempts: 3,
    backoffRate: 2.0,
  });
  
  // COMPENSATE_ACTION (conditional - only if external write occurred)
  // Note: Compensation should only run if tool succeeded or partially succeeded with external_object_refs
  // Use Choice state to check if compensation is needed, not automatic catch on PermanentError
  const compensateAction = new stepfunctionsTasks.LambdaInvoke(this, 'CompensateAction', {
    lambdaFunction: this.compensationHandler,
    payloadResponseOnly: true,
  });
  
  // RECORD_OUTCOME (for tool invocation results)
  const recordOutcome = new stepfunctionsTasks.LambdaInvoke(this, 'RecordOutcome', {
    lambdaFunction: this.executionRecorderHandler,
    payloadResponseOnly: true,
  });
  
  // RECORD_FAILURE (for errors in early states - uses separate failure recorder)
  const recordFailure = new stepfunctionsTasks.LambdaInvoke(this, 'RecordFailure', {
    lambdaFunction: this.executionFailureRecorderHandler,
    payloadResponseOnly: true,
  });
  
  // Add error handling
  startExecution.addCatch(recordFailure, {
    errors: ['States.ALL'],
    resultPath: '$.error',
  });
  
  validatePreflight.addCatch(recordFailure, {
    errors: ['States.ALL'],
    resultPath: '$.error',
  });
  
  mapActionToTool.addCatch(recordFailure, {
    errors: ['States.ALL'],
    resultPath: '$.error',
  });
  
  // InvokeTool errors: route to RecordFailure (not compensation)
  // Compensation should only run conditionally if external write occurred (see Choice state below)
  invokeTool.addCatch(recordFailure, {
    errors: ['States.ALL'], // All errors (TransientError exhausted, PermanentError, etc.)
    resultPath: '$.error',
  });
  
  // Choice state: Check if compensation is needed after tool invocation
  // Compensation should only run if:
  // 1. Tool invocation failed (success: false) AND
  // 2. External object refs exist (write occurred) AND
  // 3. Registry compensation strategy is AUTOMATIC
  const checkCompensation = new stepfunctions.Choice(this, 'CheckCompensation')
    .when(
      stepfunctions.Condition.and(
        stepfunctions.Condition.booleanEquals('$.tool_invocation_response.success', false),
        stepfunctions.Condition.isPresent('$.tool_invocation_response.external_object_refs[0]'),
        stepfunctions.Condition.stringEquals('$.compensation_strategy', 'AUTOMATIC')
      ),
      compensateAction.next(recordOutcome)
    )
    .otherwise(recordOutcome);
  
  // Build chain
  return startExecution
    .next(validatePreflight)
    .next(mapActionToTool)
    .next(invokeTool)
    .next(checkCompensation); // Choice state routes to compensation or directly to recordOutcome
}

private createExecutionTriggerRule(
  props: ExecutionInfrastructureProps,
  config: ExecutionInfrastructureConfig
): events.Rule {
  const rule = new events.Rule(this, 'ExecutionTriggerRule', {
    eventBus: props.eventBus,
    eventPattern: {
      source: [config.eventBridge.source],
      detailType: [config.eventBridge.detailTypes.actionApproved],
    },
  });
  
  // Trigger Step Functions with action_intent_id, tenant_id, and account_id
  // Note: tenant_id and account_id are REQUIRED - execution-starter-handler needs them for security validation
  // Note: Execution name uses action_intent_id for idempotency (Step Functions enforces uniqueness at execution level)
  // This provides duplicate start protection in addition to DynamoDB attempt lock
  rule.addTarget(new eventsTargets.SfnStateMachine(this.executionStateMachine, {
    input: events.RuleTargetInput.fromObject({
      action_intent_id: events.EventField.fromPath('$.detail.data.action_intent_id'),
      tenant_id: events.EventField.fromPath('$.detail.data.tenant_id'),
      account_id: events.EventField.fromPath('$.detail.data.account_id'),
    }),
    // Set execution name to action_intent_id for idempotency (Step Functions enforces uniqueness)
    // If duplicate ACTION_APPROVED event arrives, SFN will reject with ExecutionAlreadyExists
    executionName: events.EventField.fromPath('$.detail.data.action_intent_id'),
  }));
  
  // Grant Step Functions permission to be invoked by EventBridge
  this.executionStateMachine.grantStartExecution(new iam.ServicePrincipal('events.amazonaws.com'));
  
  return rule;
}
```

---

## 3. Step Functions State Machine Definition

**File:** `src/stacks/constructs/ExecutionInfrastructure.ts` (in `buildStateMachineDefinition` method)

**Note:** The Step Functions state machine is built programmatically in CDK using `stepfunctionsTasks.LambdaInvoke` with Lambda function references. Function names come from `config.functionNames.*`. 

**IMPORTANT:** The CDK code above (`buildStateMachineDefinition()`) is the canonical definition. The JSON below is for reference only to show the equivalent Step Functions JSON structure. Always refer to the CDK code for the actual implementation.

**State Machine JSON (for reference only - matches CDK implementation above):**

```json
{
  "Comment": "Action Intent Execution Orchestrator",
  "StartAt": "StartExecution",
  "States": {
    "StartExecution": {
      "Type": "Task",
      "Resource": "arn:aws:states:::lambda:invoke",
      "Parameters": {
        "FunctionName": "cc-native-execution-starter",
        "Payload": {
          "action_intent_id": "$.action_intent_id",
          "tenant_id": "$.tenant_id",
          "account_id": "$.account_id"
        }
      },
      "Next": "ValidatePreflight",
      "Catch": [
        {
          "ErrorEquals": ["States.ALL"],
          "Next": "RecordFailure",
          "ResultPath": "$.error"
        }
      ]
    },
    "ValidatePreflight": {
      "Type": "Task",
      "Resource": "arn:aws:states:::lambda:invoke",
      "Parameters": {
        "FunctionName": "cc-native-execution-validator",
        "Payload": {
          "action_intent_id": "$.action_intent_id",
          "tenant_id": "$.tenant_id",
          "account_id": "$.account_id"
        }
      },
      "Next": "MapActionToTool",
      "Catch": [
        {
          "ErrorEquals": ["States.ALL"],
          "Next": "RecordFailure",
          "ResultPath": "$.error"
        }
      ]
    },
    "MapActionToTool": {
      "Type": "Task",
      "Resource": "arn:aws:states:::lambda:invoke",
      "Parameters": {
        "FunctionName": "cc-native-tool-mapper",
        "Payload": {
          "action_intent_id": "$.action_intent_id",
          "tenant_id": "$.tenant_id",
          "account_id": "$.account_id",
          "idempotency_key": "$.idempotency_key",
          "trace_id": "$.trace_id",
          "registry_version": "$.registry_version"
        }
      },
      "Next": "InvokeTool",
      "Catch": [
        {
          "ErrorEquals": ["States.ALL"],
          "Next": "RecordFailure",
          "ResultPath": "$.error"
        }
      ]
    },
    "InvokeTool": {
        "Type": "Task",
        "Resource": "arn:aws:states:::lambda:invoke",
        "Parameters": {
          "FunctionName": "cc-native-tool-invoker",
          "Payload": {
            "gateway_url": "$.gateway_url",
            "tool_name": "$.tool_name",
            "tool_arguments": "$.tool_arguments",
            "idempotency_key": "$.idempotency_key",
            "action_intent_id": "$.action_intent_id",
            "tenant_id": "$.tenant_id",
            "account_id": "$.account_id",
            "trace_id": "$.trace_id",
            "attempt_count": "$.attempt_count"
          }
        },
        "ResultPath": "$.tool_invocation_response",
        "Retry": [
          {
            "ErrorEquals": ["TransientError"],
            "IntervalSeconds": 2,
            "MaxAttempts": 3,
            "BackoffRate": 2.0
          }
        ],
        "Catch": [
          {
            "ErrorEquals": ["States.ALL"],
            "Next": "RecordFailure",
            "ResultPath": "$.error"
          }
        ],
        "Next": "CheckCompensation"
      },
      "CheckCompensation": {
        "Type": "Choice",
        "Choices": [
          {
            "And": [
              {
                "Variable": "$.tool_invocation_response.success",
                "BooleanEquals": false
              },
              {
                "Variable": "$.tool_invocation_response.external_object_refs[0]",
                "IsPresent": true
              },
              {
                "Variable": "$.compensation_strategy",
                "StringEquals": "AUTOMATIC"
              }
            ],
            "Next": "CompensateAction"
          }
        ],
        "Default": "RecordOutcome"
      },
    "CompensateAction": {
      "Type": "Task",
      "Resource": "arn:aws:states:::lambda:invoke",
      "Parameters": {
        "FunctionName": "cc-native-compensation-handler",
        "Payload": {
          "action_intent_id": "$.action_intent_id",
          "tenant_id": "$.tenant_id",
          "account_id": "$.account_id",
          "trace_id": "$.trace_id",
          "registry_version": "$.registry_version",
          "execution_result": "$.tool_invocation_response"
        }
      },
      "Next": "RecordOutcome"
    },
    "RecordOutcome": {
      "Type": "Task",
      "Resource": "arn:aws:states:::lambda:invoke",
      "Parameters": {
        "FunctionName": "cc-native-execution-recorder",
        "Payload": {
          "action_intent_id": "$.action_intent_id",
          "tenant_id": "$.tenant_id",
          "account_id": "$.account_id",
          "trace_id": "$.trace_id",
          "tool_invocation_response": "$.tool_invocation_response",
          "tool_name": "$.tool_name",
          "tool_schema_version": "$.tool_schema_version",
          "registry_version": "$.registry_version",
          "compensation_strategy": "$.compensation_strategy",
          "attempt_count": "$.attempt_count",
          "started_at": "$.started_at"
        }
      },
      "End": true
    },
    "RecordFailure": {
      "Type": "Task",
      "Resource": "arn:aws:states:::lambda:invoke",
      "Parameters": {
        "FunctionName": "cc-native-execution-failure-recorder",
        "Payload": {
          "action_intent_id": "$.action_intent_id",
          "tenant_id": "$.tenant_id",
          "account_id": "$.account_id",
          "trace_id": "$.trace_id",
          "registry_version": "$.registry_version",
          "status": "FAILED",
          "error": "$.error"
        }
      },
      "End": true
    }
  }
}
```

---

## 4. Testing

### Integration Tests

**Files to Create:**
- `src/tests/integration/execution/orchestration-flow.test.ts` - Step Functions execution flow
- `src/tests/integration/execution/tool-invocation.test.ts` - ToolInvoker → Gateway → Adapter flow

---

## 5. Implementation Checklist

- [ ] Create `src/handlers/phase4/tool-mapper-handler.ts`
- [ ] Create `src/handlers/phase4/tool-invoker-handler.ts`
- [ ] Create `src/handlers/phase4/execution-recorder-handler.ts`
- [ ] Create `src/handlers/phase4/execution-failure-recorder-handler.ts`
- [ ] Create `src/handlers/phase4/compensation-handler.ts`
- [ ] Update `src/stacks/constructs/ExecutionInfrastructure.ts` (Phase 4.2 additions - use config for all hardcoded values)
- [ ] Add Phase 4.2 handlers to CDK construct - use `config.functionNames.*`, `config.defaults.timeout.*`, `config.lambda.retryAttempts`
- [ ] Add Phase 4.2 DLQs to CDK construct - use `config.queueNames.*` and `config.lambda.dlqRetentionDays`
- [ ] Add S3 bucket for raw response artifacts - use `config.s3.executionArtifactsBucketPrefix`
- [ ] Create Step Functions state machine in CDK (with error handling) - use `config.stepFunctions.*`
- [ ] Create EventBridge rule (ACTION_APPROVED → Step Functions) - use `config.eventBridge.*`
- [ ] Integration tests for orchestration

---

## 6. Next Steps

After Phase 4.2 completion:
- ✅ Orchestration layer complete
- ⏳ Proceed to Phase 4.3 (Connectors) - Adapter interface, Internal adapter, CRM adapter, AgentCore Gateway

---

**See:** `PHASE_4_CODE_LEVEL_PLAN.md` for complete Phase 4 overview and cross-references.
