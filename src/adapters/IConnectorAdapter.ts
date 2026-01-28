/**
 * Connector Adapter Interface
 * 
 * All connector adapters must implement this interface to provide a consistent
 * execution contract for external system integrations.
 */

import { MCPToolInvocation, MCPResponse } from '../types/MCPTypes';

/**
 * Connector Adapter Interface
 * 
 * Adapters are stateless, idempotent functions that execute actions in external systems.
 * They receive MCP tool invocations from AgentCore Gateway and return MCP responses.
 */
export interface IConnectorAdapter {
  /**
   * Execute connector action
   * 
   * @param invocation - MCP tool invocation from Gateway
   * @returns MCP response with external object references
   */
  execute(invocation: MCPToolInvocation): Promise<MCPResponse>;
  
  /**
   * Validate action parameters
   * 
   * @param parameters - Action parameters from tool invocation
   * @returns Validation result
   */
  validate(parameters: Record<string, any>): Promise<{ valid: boolean; error?: string }>;
  
  /**
   * Compensate action (rollback if reversible)
   * 
   * Optional method - only implemented for connectors that support compensation.
   * 
   * @param externalObjectId - External object ID to rollback
   * @returns Compensation result
   */
  compensate?(externalObjectId: string): Promise<{ success: boolean; error?: string }>;
}
