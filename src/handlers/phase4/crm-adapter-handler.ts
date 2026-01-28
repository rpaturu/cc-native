/**
 * CRM Adapter Handler - Phase 4.3
 * 
 * Lambda handler for CRM adapter (called by AgentCore Gateway)
 * Converts Gateway Lambda events to MCPToolInvocation format and calls adapter execute() method.
 */

import { Handler, Context } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { CrmConnectorAdapter } from '../../adapters/crm/CrmConnectorAdapter';
import { IConnectorAdapter } from '../../adapters/IConnectorAdapter';
import { MCPToolInvocation, MCPResponse } from '../../types/MCPTypes';
import { Logger } from '../../services/core/Logger';

/**
 * Create handler function with dependency injection for testability
 * Exported for unit testing
 */
export function createHandler(adapter: IConnectorAdapter, logger: Logger): Handler {
  return async (event: any, context: Context): Promise<MCPResponse> => {
  // ✅ Extract MCP context from Lambda context (same pattern as internal adapter)
  const customContext = context.clientContext?.custom || {};
  const toolNameWithPrefix = customContext.bedrockAgentCoreToolName || '';
  const gatewayId = customContext.bedrockAgentCoreGatewayId || '';
  const targetId = customContext.bedrockAgentCoreTargetId || '';
  const mcpMessageId = customContext.bedrockAgentCoreMcpMessageId || '';

  // ✅ Extract actual tool name (remove target prefix, preserve namespace)
  // Format: target_name___tool_name (e.g., "crm-adapter___crm.create_task" or "crm-adapter___create_task")
  const delimiter = '___';
  let toolName: string;
  if (toolNameWithPrefix.includes(delimiter)) {
    const suffix = toolNameWithPrefix.split(delimiter)[1];
    // If suffix already contains namespace (has '.'), use as-is
    // Otherwise, prefix with adapter namespace (e.g., "crm." for CRM adapter)
    toolName = suffix.includes('.') ? suffix : `crm.${suffix}`;
  } else {
    // No prefix found, assume it's already the full tool name or add namespace
    toolName = toolNameWithPrefix.includes('.') ? toolNameWithPrefix : `crm.${toolNameWithPrefix}`;
  }

  // ✅ Convert Gateway Lambda event to MCPToolInvocation format
  const invocation: MCPToolInvocation = {
    jsonrpc: '2.0',
    id: mcpMessageId || `gateway-${Date.now()}`,
    method: 'tools/call',
    params: {
      name: toolName, // e.g., "crm.create_task" (namespaced)
      arguments: event, // Event data matches inputSchema (includes tenant_id, account_id, etc.)
    },
    // ✅ Extract identity context (OAuth token for outbound calls, tenant binding validation)
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
}

// Production handler with real dependencies
const logger = new Logger('CrmAdapterHandler');
const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const secretsClient = new SecretsManagerClient({});
const dedupeTableName = process.env.EXTERNAL_WRITE_DEDUPE_TABLE_NAME!;
const configTableName = process.env.CONNECTOR_CONFIG_TABLE_NAME!;
const adapter = new CrmConnectorAdapter(
  dynamoClient,
  dedupeTableName,
  configTableName,
  secretsClient,
  logger
);

export const handler = createHandler(adapter, logger);
