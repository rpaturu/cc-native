/**
 * Execution State Machine State - Phase 4
 *
 * Single source of truth for Step Functions state shape between handlers.
 * See STATE_CONTRACT_AND_TESTING.md: when you change a handler's return value,
 * update (1) the next handler's input schema and (2) these types.
 *
 * Chain: EventBridge → StartExecution → ValidatePreflight → MapActionToTool
 *        → InvokeTool → (Choice) → RecordOutcome / RecordFailure
 */

/** Input to StartExecution (from EventBridge rule → Step Functions). */
export interface StateInputStartExecution {
  action_intent_id: string;
  tenant_id: string;
  account_id: string;
}

/** Output of execution-starter-handler (input to ValidatePreflight). */
export interface StateAfterStartExecution {
  action_intent_id: string;
  idempotency_key: string;
  tenant_id: string;
  account_id: string;
  trace_id: string;
  registry_version: number;
  attempt_count: number;
  started_at: string;
}

/** Output of execution-validator-handler (merged via resultPath $.validation_result). */
export interface ValidationResultOutput {
  valid: boolean;
  action_intent: unknown;
}

/** Input to tool-mapper-handler: state after ValidatePreflight (context + validation_result). */
export interface StateAfterValidatePreflight extends StateAfterStartExecution {
  validation_result?: ValidationResultOutput;
}

/** Output of tool-mapper-handler (input to InvokeTool; full state replacement). */
export interface StateAfterMapActionToTool {
  gateway_url: string;
  tool_name: string;
  tool_arguments: Record<string, unknown>;
  tool_schema_version: string;
  registry_version: number;
  compensation_strategy: string;
  idempotency_key: string;
  action_intent_id: string;
  tenant_id: string;
  account_id: string;
  trace_id: string;
  attempt_count: number;
  started_at: string;
}

/** Output of tool-invoker-handler (merged via resultPath $.tool_invocation_response). */
export interface ToolInvocationResponseInState {
  success: boolean;
  external_object_refs?: unknown[];
  tool_run_ref: string;
  raw_response_artifact_ref?: string;
  error_code?: string;
  error_class?: string;
  error_message?: string;
}

/** Input to execution-recorder-handler: state after InvokeTool (MapActionToTool state + tool_invocation_response). */
export interface StateAfterInvokeTool extends StateAfterMapActionToTool {
  tool_invocation_response: ToolInvocationResponseInState;
}

/** Input to execution-failure-recorder-handler: state from failed step + Catch resultPath $.error. */
export interface StateToFailureRecorder {
  action_intent_id: string;
  tenant_id: string;
  account_id: string;
  trace_id: string;
  registry_version?: number;
  idempotency_key?: string;
  attempt_count?: number;
  started_at?: string;
  error?: { Error?: string; Cause?: string };
}
