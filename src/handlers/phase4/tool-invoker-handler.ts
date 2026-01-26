/**
 * Tool Invoker Handler - Phase 4.2
 * 
 * MCP Gateway client (centralizes MCP protocol, auth, retries, timeouts)
 * 
 * Contract: See "Execution Contract (Canonical)" section in PHASE_4_2_CODE_LEVEL_PLAN.md
 * 
 * Step Functions input: ToolInvocationRequest
 * Step Functions output: ToolInvocationResponse
 * 
 * IMPORTANT: This handler throws errors for SFN retry/catch logic:
 * - Throws Error with name='TransientError' for retryable errors (via invokeWithRetry)
 * - Throws Error with name='PermanentError' for non-retryable errors (via invokeWithRetry)
 * - Only returns ToolInvocationResponse (with success:false) for tool-level business failures
 *   where tool ran but reported an error (proceed to RecordOutcome without SFN retry)
 */

import { Handler } from 'aws-lambda';
import { z } from 'zod';
import { Logger } from '../../services/core/Logger';
import { TraceService } from '../../services/core/TraceService';
import { ToolInvocationResponse } from '../../types/ExecutionTypes';
import axios, { AxiosError } from 'axios';

const logger = new Logger('ToolInvokerHandler');
const traceService = new TraceService(logger);

// Note: No DynamoDB client needed - this handler only calls Gateway via HTTP

const ToolInvocationRequestSchema = z.object({
  gateway_url: z.string().url('gateway_url must be a valid URL'),
  tool_name: z.string().min(1, 'tool_name is required'),
  tool_arguments: z.record(z.any())
    .refine(
      (val) => {
        // Must be a plain object (not array, not null)
        if (!val || typeof val !== 'object' || Array.isArray(val)) {
          return false;
        }
        return true;
      },
      { message: 'tool_arguments must be a plain object (not array, not null)' }
    )
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
 * 
 * Error Classification Policy:
 * - Invalid structure (missing result.content): TransientError (plausibly upstream outage/partial response)
 * - Malformed JSON: TransientError (plausibly gateway timeout/truncation)
 * - MCP error response: PermanentError (structured error from Gateway/adapter, typically non-retryable)
 */
function parseMCPResponse(response: any): any {
  // MCP error response (structured error from Gateway)
  if (response.error) {
    // MCP protocol error - structured error from Gateway/adapter
    // Typically indicates configuration/auth issues (non-retryable)
    const error = new Error(
      `MCP protocol error: ${JSON.stringify(response.error)}. ` +
      `This indicates a Gateway or adapter protocol failure, not a tool business failure.`
    );
    error.name = 'PermanentError'; // Structured errors are typically non-retryable
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
        // Classify as TransientError (plausibly gateway timeout/truncation causing partial JSON)
        const error = new Error(
          `Failed to parse MCP response JSON: ${e instanceof Error ? e.message : 'Unknown parse error'}. ` +
          `Response text: ${textContent.text?.substring(0, 500)}. ` +
          `This is a protocol failure, not a tool business failure.`
        );
        error.name = 'TransientError'; // Malformed JSON may be due to upstream timeout/truncation
        throw error;
      }
    }
  }
  
  // Invalid MCP response structure - protocol failure, throw for SFN
  // Classify as TransientError (plausibly upstream outage/partial response)
  const error = new Error(
    `Invalid MCP response format: missing result.content or text content. ` +
    `Response: ${JSON.stringify(response).substring(0, 500)}. ` +
    `This is a protocol failure, not a tool business failure.`
  );
  error.name = 'TransientError'; // Invalid structure may be due to upstream outage
  throw error;
}

/**
 * Extract external object refs from parsed response
 * 
 * @param parsedResponse - Parsed MCP response from Gateway
 * @param toolName - Tool name from input (used for system inference, not from response)
 * 
 * CONTRACT REQUIREMENT: All execution tools must return external_object_refs on success.
 * This is a Phase 4.2 contract requirement - tools that create/modify external objects must
 * return references for audit, compensation, and signal emission.
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
  
  // CONTRACT VIOLATION: Tool succeeded but no external refs
  // All execution tools must return external_object_refs on success (Phase 4.2 contract requirement)
  const error = new Error(
    'Tool invocation response is missing required field: external_object_refs (or legacy external_object_id + object_type). ' +
    'CONTRACT REQUIREMENT: All execution tools must return external_object_refs when success=true. ' +
    'This is required for audit, compensation, and signal emission. ' +
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
