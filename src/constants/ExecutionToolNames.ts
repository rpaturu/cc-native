/**
 * Execution tool names – single source of truth for MCP Gateway and Action Type Registry.
 *
 * Use these constants everywhere tool names are referenced to avoid mismatches:
 * - Gateway target registration (ExecutionInfrastructure)
 * - Action Type Registry seed data (tool_name in DynamoDB)
 * - Tests and fixtures
 *
 * Naming: namespace.action (e.g. internal.create_task, crm.create_task).
 * See docs/implementation/phase_4/TOOL_INVENTORY.md for inventory and strategy references.
 */

/** Internal adapter: create note. */
export const INTERNAL_CREATE_NOTE = 'internal.create_note' as const;

/** Internal adapter: create task. */
export const INTERNAL_CREATE_TASK = 'internal.create_task' as const;

/** CRM adapter: create task. */
export const CRM_CREATE_TASK = 'crm.create_task' as const;

/** All known execution tool names (for Gateway registration and inventory). */
export const EXECUTION_TOOL_NAMES = [
  INTERNAL_CREATE_NOTE,
  INTERNAL_CREATE_TASK,
  CRM_CREATE_TASK,
] as const;

export type ExecutionToolName = (typeof EXECUTION_TOOL_NAMES)[number];

/**
 * Build the tool name format the AgentCore Gateway expects for MCP tools/call.
 * Gateway uses: {target_name}___{tool_name}. Target name is derived from tool name
 * (kebab-case). See: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/gateway-tool-naming.html
 */
export function toGatewayToolName(toolName: string): string {
  const targetName = toolName.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  return `${targetName}___${toolName}`;
}
