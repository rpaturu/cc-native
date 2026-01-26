/**
 * MCP (Model Context Protocol) Types
 * JSON-RPC 2.0 based protocol for tool invocation
 */

/**
 * MCP Tool Invocation (Gateway → Lambda Adapter)
 */
export interface MCPToolInvocation {
  jsonrpc: '2.0';
  id: string;
  method: 'tools/call';
  params: {
    name: string; // Tool name (e.g., "crm.create_task")
    arguments: Record<string, any>; // Tool parameters
  };
  identity?: {
    accessToken: string; // OAuth token from AgentCore Identity
    tenantId: string;
    userId?: string;
  };
}

/**
 * MCP Tool Response (Lambda Adapter → Gateway)
 */
export interface MCPResponse {
  jsonrpc: '2.0';
  id: string;
  result?: {
    content: Array<{
      type: 'text';
      text: string; // JSON stringified result
    }>;
  };
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

/**
 * MCP Tools List Response
 */
export interface MCPToolsListResponse {
  jsonrpc: '2.0';
  id: string;
  result: {
    tools: Array<{
      name: string;
      description: string;
      inputSchema: Record<string, any>; // JSON Schema
    }>;
  };
}
