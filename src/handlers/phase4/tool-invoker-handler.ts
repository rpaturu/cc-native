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
import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  NotAuthorizedException,
} from '@aws-sdk/client-cognito-identity-provider';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { Logger } from '../../services/core/Logger';
import { TraceService } from '../../services/core/TraceService';
import { ToolInvocationResponse } from '../../types/ExecutionTypes';
import { getAWSClientConfig } from '../../utils/aws-client-config';
import axios, { AxiosError } from 'axios';
import { CircuitBreakerService } from '../../services/connector/CircuitBreakerService';
import { ConnectorConcurrencyService } from '../../services/connector/ConnectorConcurrencyService';
import { ToolSloMetricsService } from '../../services/connector/ToolSloMetricsService';
import { invokeWithResilience, connectorIdFromToolName } from '../../services/connector/InvokeWithResilience';

const logger = new Logger('ToolInvokerHandler');
const traceService = new TraceService(logger);

import { ToolInvocationRequestSchema } from './execution-state-schemas';
export { ToolInvocationRequestSchema };

export const handler: Handler = async (event: unknown) => {
  // Validate SFN input with Zod (fail fast with precise errors)
  const validationResult = ToolInvocationRequestSchema.safeParse(event);
  if (!validationResult.success) {
    const error = new Error(
      `[ToolInvokerHandler] Invalid Step Functions input: ${validationResult.error.message}. ` +
      `Expected: state from MapActionToTool (gateway_url, tool_name, tool_arguments, idempotency_key, action_intent_id, tenant_id, account_id, trace_id; optional: attempt_count, tool_schema_version, registry_version, compensation_strategy, started_at). ` +
      `Received: ${JSON.stringify(event)}. ` +
      `Check Step Functions state machine definition to ensure all required fields are passed from tool-mapper-handler output.`
    );
    error.name = 'ValidationError';
    throw error;
  }
  
  const { gateway_url, tool_name, tool_arguments, idempotency_key, action_intent_id, tenant_id, account_id, trace_id, attempt_count } = validationResult.data;
  
  logger.info('Tool invoker invoked', {
    action_intent_id,
    tool_name,
    trace_id,
    gateway_url_host: gateway_url ? new URL(gateway_url).host : undefined,
  });
  
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

  // Diagnostic: log MCP request so "Unknown tool" can be correlated with exact params sent
  const gatewayHost = gateway_url ? new URL(gateway_url).host : undefined;
  logger.info('MCP tools/call request', {
    action_intent_id,
    tool_name,
    gateway_url_host: gatewayHost,
    params_name: mcpRequest.params?.name,
    params_arguments_keys: tool_arguments && typeof tool_arguments === 'object' ? Object.keys(tool_arguments) : [],
  });
  
  // 3. Call Gateway with retry logic (Phase 5.7: via resilience wrapper when RESILIENCE_TABLE_NAME set)
  // invokeWithRetry throws errors with name='TransientError' or 'PermanentError' for SFN
  const resilienceTableName = process.env.RESILIENCE_TABLE_NAME;
  let response: any;
  if (resilienceTableName) {
    const region = process.env.AWS_REGION ?? 'us-east-1';
    const dynamoClient = DynamoDBDocumentClient.from(
      new DynamoDBClient(getAWSClientConfig(region)),
      { marshallOptions: { removeUndefinedValues: true } }
    );
    const circuitBreaker = new CircuitBreakerService(dynamoClient, resilienceTableName, logger);
    const concurrency = new ConnectorConcurrencyService(dynamoClient, resilienceTableName, logger);
    const metrics = new ToolSloMetricsService(logger, region);
    const connectorId = connectorIdFromToolName(tool_name);
    const result = await invokeWithResilience(
      tool_name,
      tenant_id,
      connectorId,
      'phase4_execution',
      () =>
        invokeWithRetry(
          gateway_url,
          mcpRequest,
          jwtToken,
          toolRunRef,
          action_intent_id
        ),
      { circuitBreaker, concurrency, metrics, logger }
    );
    if (result.kind === 'defer') {
      const err = new Error(
        `TransientError: Backpressure or circuit open; retry after ${result.retryAfterSeconds}s`
      );
      err.name = 'TransientError';
      throw err;
    }
    response = result.value;
  } else {
    response = await invokeWithRetry(
      gateway_url,
      mcpRequest,
      jwtToken,
      toolRunRef,
      action_intent_id
    );
  }
  
  // 4. Parse MCP response (log raw response on parse/error for "Unknown tool" troubleshooting)
  // Gateway exposes tools as "target-name___tool.name" (e.g. internal-create-task___internal.create_task).
  // If we get "Unknown tool", resolve our tool_name to the Gateway's full name via tools/list and retry.
  let parsedResponse: any;
  try {
    parsedResponse = parseMCPResponse(response);
  } catch (parseErr) {
    const responseError = (response as any)?.error;
    const isUnknownTool = responseError?.message?.includes?.('Unknown tool');
    logger.error('MCP response parse failed (Gateway or protocol error)', {
      action_intent_id,
      tool_name,
      gateway_url_host: gatewayHost,
      response_error: responseError,
      response_result_keys: response && typeof response === 'object' ? Object.keys(response) : [],
      raw_response_preview: JSON.stringify(response).substring(0, 800),
    });
    if (isUnknownTool && gateway_url && jwtToken) {
      try {
        const listResult = await listGatewayTools(gateway_url, jwtToken);
        logger.error('Gateway tools/list (compare with requested tool_name)', {
          requested_tool_name: tool_name,
          gateway_tool_names: listResult.tool_names,
          gateway_tools_count: listResult.tool_names?.length ?? 0,
        });
        const resolvedName = listResult.tool_names?.find(
          (n: string) => n === tool_name || (typeof n === 'string' && n.endsWith('___' + tool_name))
        );
        if (resolvedName) {
          logger.info('Retrying tools/call with Gateway-resolved tool name', {
            requested: tool_name,
            resolved: resolvedName,
          });
          const retryRequest = {
            ...mcpRequest,
            params: { ...mcpRequest.params, name: resolvedName },
          };
          const response2 = await invokeWithRetry(
            gateway_url,
            retryRequest,
            jwtToken,
            toolRunRef,
            action_intent_id
          );
          parsedResponse = parseMCPResponse(response2);
        } else {
          logger.warn('No Gateway tool name matched requested tool_name (cannot retry)', {
            requested: tool_name,
            gateway_tool_names: listResult.tool_names,
          });
        }
      } catch (listErr) {
        logger.warn('Failed to fetch tools/list or retry for debug', {
          error: listErr instanceof Error ? listErr.message : String(listErr),
        });
      }
    }
    if (!parsedResponse) throw parseErr;
  }
  
  // 5. Extract external object refs (use input tool_name for system inference)
  const externalObjectRefs = extractExternalObjectRefs(parsedResponse, tool_name);
  
  // 6. Check if tool reported a structured failure (tool ran but returned error)
  // In this case, we return success:false but don't throw (proceed to RecordOutcome)
  // This is different from HTTP/infrastructure errors which throw for SFN retry/catch
  if (parsedResponse.success === false) {
    const errorClassification = classifyError(parsedResponse, tool_name);
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
          timeout: 60000, // 60 seconds (Gateway → adapter Lambda → DynamoDB round-trip; cold start can exceed 30s)
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
    
    // Network errors and timeouts are retryable
    // Axios uses ECONNABORTED for request timeout (not ETIMEDOUT)
    const retryableNetworkCodes = [
      'ECONNRESET',    // Connection reset by peer
      'ETIMEDOUT',     // Connection timeout (socket-level)
      'ECONNABORTED',  // Axios: request timeout or aborted
      'ENOTFOUND',     // DNS lookup failed
      'EAI_AGAIN',     // DNS temporary failure
      'ECONNREFUSED',  // Connection refused
    ];
    if (error.code && retryableNetworkCodes.includes(error.code)) {
      return true;
    }
    // Axios timeout message fallback (message is "timeout of 30000ms exceeded")
    if (error.message && typeof error.message === 'string' && error.message.includes('timeout')) {
      return true;
    }
  }
  
  // Non-Axios network errors (e.g., from fetch or other HTTP clients)
  if (error.code && ['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED'].includes(error.code)) {
    return true;
  }
  if (error?.message && String(error.message).includes('timeout')) {
    return true;
  }
  
  return false;
}

/**
 * Call Gateway MCP tools/list to return tool names (for "Unknown tool" debugging).
 * See https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/gateway-using-mcp-list.html
 */
async function listGatewayTools(
  gatewayUrl: string,
  jwtToken: string
): Promise<{ tool_names: string[]; tools?: any[] }> {
  const listRequest = {
    jsonrpc: '2.0',
    id: 'list-tools-debug',
    method: 'tools/list',
    params: {},
  };
  const res = await axios.post(gatewayUrl, listRequest, {
    headers: {
      Authorization: `Bearer ${jwtToken}`,
      'Content-Type': 'application/json',
    },
    timeout: 10000,
  });
  const data = res.data as any;
  if (data.error) {
    throw new Error(`tools/list error: ${JSON.stringify(data.error)}`);
  }
  const tools = data.result?.tools ?? data.result?.content ?? [];
  const toolNames = Array.isArray(tools)
    ? tools.map((t: any) => (typeof t === 'string' ? t : t?.name ?? t?.tool?.name ?? String(t)))
    : [];
  return { tool_names: toolNames, tools: Array.isArray(tools) ? tools : undefined };
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
        // Text is not JSON - adapter may have returned plain error message (e.g. LambdaClientException)
        // When result.isError is true, treat as tool/adapter failure and return success:false for RecordOutcome
        if (response.result?.isError === true && textContent.text) {
          return {
            success: false,
            error_message: textContent.text,
          };
        }
        // Otherwise treat as protocol failure (truncation/malformed upstream)
        const error = new Error(
          `Failed to parse MCP response JSON: ${e instanceof Error ? e.message : 'Unknown parse error'}. ` +
          `Response text: ${textContent.text?.substring(0, 500)}. ` +
          `This is a protocol failure, not a tool business failure.`
        );
        error.name = 'TransientError';
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
 * Extract payload from MCP response for ref/success checks.
 * Handles both: (1) already-parsed payload with external_object_refs at top level,
 * (2) raw MCP envelope with result.content[].text containing JSON string.
 */
function getPayloadFromResponse(parsedResponse: any): { payload: any; success: boolean } {
  if (Array.isArray(parsedResponse.external_object_refs) || (parsedResponse.external_object_id && parsedResponse.object_type)) {
    return { payload: parsedResponse, success: parsedResponse.success !== false };
  }
  const content = parsedResponse?.result?.content;
  if (Array.isArray(content)) {
    const textContent = content.find((c: any) => c.type === 'text');
    if (textContent?.text) {
      try {
        const inner = JSON.parse(textContent.text);
        return { payload: inner, success: inner.success !== false };
      } catch {
        // not JSON, use outer
      }
    }
  }
  return { payload: parsedResponse, success: parsedResponse.success !== false };
}

/**
 * Extract external object refs from parsed response
 * 
 * @param parsedResponse - Parsed MCP response from Gateway (or raw MCP envelope with result.content[].text)
 * @param toolName - Tool name from input (used for system inference, not from response)
 * 
 * CONTRACT REQUIREMENT: All execution tools must return external_object_refs on success.
 * Supports: direct payload, legacy single object, or MCP envelope with JSON in result.content[].text.
 */
function extractExternalObjectRefs(
  parsedResponse: any,
  toolName: string
): ToolInvocationResponse['external_object_refs'] {
  const { payload, success } = getPayloadFromResponse(parsedResponse);
  if (!success) {
    return undefined;
  }

  if (Array.isArray(payload.external_object_refs)) {
    const validatedRefs = payload.external_object_refs.map((ref: any, index: number) => {
      if (!ref.object_id || !ref.object_type) {
        throw new Error(
          `Tool invocation response external_object_refs[${index}] is missing required fields (object_id, object_type). ` +
          `Tool: ${toolName}, Ref: ${JSON.stringify(ref)}`
        );
      }
      return {
        system: ref.system || inferSystemFromTool(toolName),
        object_type: ref.object_type,
        object_id: ref.object_id,
        object_url: ref.object_url,
      };
    });
    return validatedRefs.length > 0 ? validatedRefs : undefined;
  }

  if (payload.external_object_id && payload.object_type) {
    const system = inferSystemFromTool(toolName);
    return [{
      system,
      object_type: payload.object_type,
      object_id: payload.external_object_id,
      object_url: payload.object_url,
    }];
  }

  const error = new Error(
    'Tool invocation response is missing required field: external_object_refs (or legacy external_object_id + object_type). ' +
    'CONTRACT REQUIREMENT: All execution tools must return external_object_refs when success=true. ' +
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
function classifyError(
  parsedResponse: any,
  toolName?: string
): {
  error_code?: string;
  error_class?: ToolInvocationResponse['error_class'];
  error_message?: string;
} {
  if (parsedResponse.success) {
    return {};
  }
  
  const error = parsedResponse.error || parsedResponse;
  const errorMessage =
    error.message ||
    error.error ||
    error.error_message ||
    parsedResponse.error_message;
  if (!errorMessage) {
    const errorObj = new Error(
      'Tool invocation failed but no error message was provided. ' +
      'The connector adapter must return a descriptive error message in the MCP response. ' +
      `Tool: ${toolName ?? parsedResponse.tool_name ?? 'unknown'}, Response: ${JSON.stringify(parsedResponse)}`
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
 * JWT credentials from Secrets Manager (per JWT_SERVICE_USER_STACK_PLAN.md 3.1.1).
 * Handler uses only username and password; other fields are for ops/audit.
 */
interface JwtSecretPayload {
  username: string;
  password: string;
  userPoolId?: string;
  clientId?: string;
  createdAt?: string;
}

/**
 * Get JWT token for Gateway authentication (Cognito User Pool)
 *
 * 1. If COGNITO_SERVICE_USER_SECRET_ARN is set: fetch secret, parse JSON for username/password, use for InitiateAuth.
 * 2. Else: use COGNITO_SERVICE_USERNAME + COGNITO_SERVICE_PASSWORD (env vars; dev/test fallback).
 *
 * Prerequisite: User Pool Client must enable USER_PASSWORD_AUTH (see JWT_SERVICE_USER_STACK_PLAN.md).
 * Throws PermanentError on auth failure or missing/malformed config (non-retryable for SFN).
 */
async function getJwtToken(_tenantId: string): Promise<string> {
  const userPoolId = process.env.COGNITO_USER_POOL_ID;
  const clientId = process.env.COGNITO_CLIENT_ID;
  const secretArn = process.env.COGNITO_SERVICE_USER_SECRET_ARN;
  const usernameEnv = process.env.COGNITO_SERVICE_USERNAME;
  const passwordEnv = process.env.COGNITO_SERVICE_PASSWORD;

  if (!userPoolId || !clientId) {
    const error = new Error('PermanentError: JWT token retrieval not implemented. Set COGNITO_USER_POOL_ID and COGNITO_CLIENT_ID (provide userPool and userPoolClient to ExecutionInfrastructure).');
    error.name = 'PermanentError';
    throw error;
  }

  let username: string;
  let password: string;

  if (secretArn) {
    const payload = await getCredentialsFromSecret(secretArn);
    username = payload.username;
    password = payload.password;
  } else if (usernameEnv && passwordEnv) {
    username = usernameEnv;
    password = passwordEnv;
  } else {
    const error = new Error(
      'PermanentError: JWT credentials not configured. Set COGNITO_SERVICE_USER_SECRET_ARN (stack-provisioned secret) or COGNITO_SERVICE_USERNAME and COGNITO_SERVICE_PASSWORD in the ToolInvoker Lambda environment.'
    );
    error.name = 'PermanentError';
    throw error;
  }

  const region = process.env.AWS_REGION ?? 'us-east-1';
  const client = new CognitoIdentityProviderClient(getAWSClientConfig(region));

  try {
    const result = await client.send(
      new InitiateAuthCommand({
        AuthFlow: 'USER_PASSWORD_AUTH',
        ClientId: clientId,
        AuthParameters: {
          USERNAME: username,
          PASSWORD: password,
        },
      })
    );

    // Bedrock AgentCore Gateway CUSTOM_JWT expects an access token (see gateway-inbound-auth docs).
    // Prefer AccessToken; fall back to IdToken for compatibility.
    const accessToken = result.AuthenticationResult?.AccessToken;
    const idToken = result.AuthenticationResult?.IdToken;
    const token = accessToken ?? idToken;
    if (!token) {
      const error = new Error('PermanentError: Cognito InitiateAuth did not return AccessToken or IdToken.');
      error.name = 'PermanentError';
      throw error;
    }
    return token;
  } catch (err: unknown) {
    if (err instanceof NotAuthorizedException) {
      const error = new Error(`PermanentError: Cognito auth failed (invalid service user credentials): ${(err as Error).message}`);
      error.name = 'PermanentError';
      throw error;
    }
    const message = err instanceof Error ? err.message : String(err);
    const error = new Error(`PermanentError: JWT token retrieval failed: ${message}`);
    error.name = 'PermanentError';
    throw error;
  }
}

async function getCredentialsFromSecret(secretArn: string): Promise<JwtSecretPayload> {
  const region = process.env.AWS_REGION ?? 'us-east-1';
  const client = new SecretsManagerClient(getAWSClientConfig(region));
  try {
    const response = await client.send(new GetSecretValueCommand({ SecretId: secretArn }));
    const raw = response.SecretString;
    if (!raw) {
      const error = new Error('PermanentError: JWT secret has no SecretString.');
      error.name = 'PermanentError';
      throw error;
    }
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const username = parsed?.username;
    const password = parsed?.password;
    if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
      const error = new Error('PermanentError: JWT secret must contain username and password (string). Malformed secret.');
      error.name = 'PermanentError';
      throw error;
    }
    return { username, password };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const error = new Error(`PermanentError: JWT secret retrieval failed (GetSecretValue): ${message}`);
    error.name = 'PermanentError';
    throw error;
  }
}
