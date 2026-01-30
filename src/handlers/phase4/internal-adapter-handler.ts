/**
 * Internal Adapter Handler - Phase 4.3
 * 
 * Lambda handler for Internal adapter (called by AgentCore Gateway)
 * Converts Gateway Lambda events to MCPToolInvocation format and calls adapter execute() method.
 */

import { Handler, Context } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { InternalConnectorAdapter } from '../../adapters/internal/InternalConnectorAdapter';
import { IConnectorAdapter } from '../../adapters/IConnectorAdapter';
import { MCPToolInvocation, MCPResponse } from '../../types/MCPTypes';
import { Logger } from '../../services/core/Logger';
import { ExecutionError } from '../../types/ExecutionErrors';

/**
 * Create handler function with dependency injection for testability
 * Exported for unit testing
 */
/**
 * Build MCP error response so Tool Invoker always gets a descriptive message (not Gateway generic "An internal error occurred").
 */
function toMCPErrorResponse(
  err: unknown,
  invocationId: string,
  toolName: string | undefined,
  logger: Logger
): MCPResponse {
  const message = err instanceof Error ? err.message : String(err);
  const errorName = err instanceof Error ? err.name : 'Error';
  const errorCode =
    err instanceof ExecutionError ? err.error_code : 'ADAPTER_ERROR';
  const errorClass =
    err instanceof ExecutionError ? err.error_class : 'UNKNOWN';
  logger.error(`Internal adapter error: ${errorName} - ${message}`, {
    toolName,
    message,
    errorName,
    errorCode,
    errorClass,
    stack: err instanceof Error ? err.stack : undefined,
  });
  const errorPayload = {
    success: false,
    error_message: message,
    error_code: errorCode,
    error_class: errorClass,
  };
  return {
    jsonrpc: '2.0',
    id: invocationId,
    result: {
      content: [{ type: 'text', text: JSON.stringify(errorPayload) }],
    },
  };
}

export function createHandler(adapter: IConnectorAdapter, logger: Logger): Handler {
  return async (event: any, context: Context): Promise<MCPResponse> => {
  // Use mcpMessageId when present; otherwise fall back to gateway-* so invocation id is predictable for tests
  const invocationId =
    (context?.clientContext as any)?.custom?.bedrockAgentCoreMcpMessageId ??
    `gateway-${Date.now()}`;
  let toolName: string | undefined;

  try {
    // ✅ Extract MCP context from Lambda context (per article pattern)
    const customContext = context?.clientContext?.custom ?? {};
    const toolNameWithPrefix = customContext.bedrockAgentCoreToolName ?? '';
    const gatewayId = customContext.bedrockAgentCoreGatewayId ?? '';
    const targetId = customContext.bedrockAgentCoreTargetId ?? '';
    const mcpMessageId = customContext.bedrockAgentCoreMcpMessageId ?? '';

    // ✅ Extract actual tool name (remove target prefix, preserve namespace)
    const delimiter = '___';
    if (toolNameWithPrefix.includes(delimiter)) {
      const suffix = toolNameWithPrefix.split(delimiter)[1];
      toolName = suffix?.includes('.') ? suffix : `internal.${suffix ?? ''}`;
    } else {
      toolName = toolNameWithPrefix.includes('.') ? toolNameWithPrefix : `internal.${toolNameWithPrefix}`;
    }

    const invocation: MCPToolInvocation = {
      jsonrpc: '2.0',
      id: mcpMessageId || invocationId,
      method: 'tools/call',
      params: {
        name: toolName ?? 'internal.unknown',
        arguments: event ?? {},
      },
      identity: customContext.bedrockAgentCoreIdentity
        ? {
            accessToken: customContext.bedrockAgentCoreIdentity.accessToken,
            tenantId: customContext.bedrockAgentCoreIdentity.tenantId,
            userId: customContext.bedrockAgentCoreIdentity.userId,
          }
        : undefined,
    };

    logger.info('Gateway Lambda invocation', {
      toolName,
      gatewayId,
      targetId,
      mcpMessageId,
      eventKeys: event && typeof event === 'object' ? Object.keys(event) : [],
    });

    return await adapter.execute(invocation);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const name = err instanceof Error ? err.name : 'Error';
    logger.error(`Adapter execute() failed: ${name} - ${message}`, {
      toolName,
      invocationId,
      errorName: name,
      stack: err instanceof Error ? err.stack : undefined,
    });
    return toMCPErrorResponse(err, invocationId, toolName, logger);
  }
  };
}

// Production handler with real dependencies
const logger = new Logger('InternalAdapterHandler');
const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const notesTableName = process.env.INTERNAL_NOTES_TABLE_NAME || 'cc-native-internal-notes';
const tasksTableName = process.env.INTERNAL_TASKS_TABLE_NAME || 'cc-native-internal-tasks';
const adapter = new InternalConnectorAdapter(
  dynamoClient,
  notesTableName,
  tasksTableName,
  logger
);

export const handler = createHandler(adapter, logger);
