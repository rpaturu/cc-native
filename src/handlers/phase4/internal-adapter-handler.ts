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
import { MCPToolInvocation, MCPResponse } from '../../types/MCPTypes';
import { Logger } from '../../services/core/Logger';

const logger = new Logger('InternalAdapterHandler');
// ✅ FIX: Use AWS SDK v3 constructor pattern (not .from({}))
const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const notesTableName = process.env.INTERNAL_NOTES_TABLE_NAME || 'cc-native-internal-notes';
const tasksTableName = process.env.INTERNAL_TASKS_TABLE_NAME || 'cc-native-internal-tasks';

const adapter = new InternalConnectorAdapter(
  dynamoClient,
  notesTableName,
  tasksTableName,
  logger
);

export const handler: Handler = async (event: any, context: Context): Promise<MCPResponse> => {
  // ✅ Extract MCP context from Lambda context (per article pattern)
  // Gateway injects MCP metadata into context.clientContext.custom
  const customContext = context.clientContext?.custom || {};
  const toolNameWithPrefix = customContext.bedrockAgentCoreToolName || '';
  const gatewayId = customContext.bedrockAgentCoreGatewayId || '';
  const targetId = customContext.bedrockAgentCoreTargetId || '';
  const mcpMessageId = customContext.bedrockAgentCoreMcpMessageId || '';

  // ✅ Extract actual tool name (remove target prefix, preserve namespace)
  // Format: target_name___tool_name (e.g., "internal-adapter___internal.create_note" or "internal-adapter___create_note")
  // Important: Tool name may already be namespaced (e.g., "internal.create_note") or not (e.g., "create_note")
  // Adapter expects namespaced format (e.g., "internal.create_note"), so preserve namespace if present
  const delimiter = '___';
  let toolName: string;
  if (toolNameWithPrefix.includes(delimiter)) {
    const suffix = toolNameWithPrefix.split(delimiter)[1];
    // If suffix already contains namespace (has '.'), use as-is
    // Otherwise, prefix with adapter namespace (e.g., "internal." for internal adapter)
    toolName = suffix.includes('.') ? suffix : `internal.${suffix}`;
  } else {
    // No prefix found, assume it's already the full tool name or add namespace
    toolName = toolNameWithPrefix.includes('.') ? toolNameWithPrefix : `internal.${toolNameWithPrefix}`;
  }

  // ✅ Convert Gateway Lambda event to MCPToolInvocation format
  // Event contains inputSchema data (e.g., { content: "...", tenant_id: "...", account_id: "..." })
  const invocation: MCPToolInvocation = {
    jsonrpc: '2.0',
    id: mcpMessageId || `gateway-${Date.now()}`,
    method: 'tools/call',
    params: {
      name: toolName, // e.g., "internal.create_note" (namespaced)
      arguments: event, // Event data matches inputSchema
    },
    // ✅ Extract identity context if available (for tenant binding validation)
    identity: customContext.bedrockAgentCoreIdentity ? {
      accessToken: customContext.bedrockAgentCoreIdentity.accessToken,
      tenantId: customContext.bedrockAgentCoreIdentity.tenantId,
      userId: customContext.bedrockAgentCoreIdentity.userId,
    } : undefined,
  };

  logger.info('Gateway Lambda invocation', {
    toolName,
    gatewayId,
    targetId,
    mcpMessageId,
    eventKeys: Object.keys(event),
  });

  // ✅ Call adapter execute() method
  return await adapter.execute(invocation);
};
