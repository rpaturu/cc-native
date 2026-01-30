/**
 * Phase 4 Execution State Machine - Input Schemas
 *
 * Single module for Zod schemas used by Step Functions handlers. No env or side effects,
 * so contract tests can import here without triggering handler requireEnv().
 * See STATE_CONTRACT_AND_TESTING.md and HANDLER_CHANGE_CHECKLIST.md.
 */

import { z } from 'zod';

/** Input to StartExecution (from EventBridge → Step Functions). */
export const StartExecutionInputSchema = z.object({
  action_intent_id: z.string().min(1, 'action_intent_id is required'),
  tenant_id: z.string().min(1, 'tenant_id is required'),
  account_id: z.string().min(1, 'account_id is required'),
}).strict();

/** Input to ValidatePreflight = output of execution-starter-handler. */
export const ValidatorInputSchema = z.object({
  action_intent_id: z.string().min(1, 'action_intent_id is required'),
  tenant_id: z.string().min(1, 'tenant_id is required'),
  account_id: z.string().min(1, 'account_id is required'),
  idempotency_key: z.string().min(1, 'idempotency_key is required'),
  trace_id: z.string().min(1, 'trace_id is required'),
  registry_version: z.number().int().positive('registry_version must be positive integer'),
  attempt_count: z.number().int().positive('attempt_count must be positive integer'),
  started_at: z.string().min(1, 'started_at is required'),
}).strict();

/** Input to MapActionToTool = state after ValidatePreflight (optional validation_result). */
export const ToolMapperInputSchema = z.object({
  action_intent_id: z.string().min(1, 'action_intent_id is required'),
  tenant_id: z.string().min(1, 'tenant_id is required'),
  account_id: z.string().min(1, 'account_id is required'),
  idempotency_key: z.string().min(1, 'idempotency_key is required'),
  trace_id: z.string().min(1, 'trace_id is required'),
  registry_version: z.number().int().positive('registry_version must be positive integer'),
  attempt_count: z.number().int().positive('attempt_count must be positive integer'),
  started_at: z.string().min(1, 'started_at is required'),
  validation_result: z.object({ valid: z.boolean(), action_intent: z.any() }).optional(),
}).strict();

const toolArgumentsSchema = z.record(z.any())
  .refine(
    (val) => {
      if (!val || typeof val !== 'object' || Array.isArray(val)) return false;
      return true;
    },
    { message: 'tool_arguments must be a plain object (not array, not null)' }
  )
  .refine(
    (val) => JSON.stringify(val).length < 200 * 1024,
    { message: 'tool_arguments exceeds size limit (200KB). Large payloads should be passed via S3 artifact reference.' }
  );

/** Input to InvokeTool = output of tool-mapper-handler. */
export const ToolInvocationRequestSchema = z.object({
  gateway_url: z.string().url('gateway_url must be a valid URL'),
  tool_name: z.string().min(1, 'tool_name is required'),
  tool_arguments: toolArgumentsSchema,
  idempotency_key: z.string().min(1, 'idempotency_key is required'),
  action_intent_id: z.string().min(1, 'action_intent_id is required'),
  tenant_id: z.string().min(1, 'tenant_id is required'),
  account_id: z.string().min(1, 'account_id is required'),
  trace_id: z.string().min(1, 'trace_id is required'),
  attempt_count: z.number().int().positive().optional(),
  tool_schema_version: z.string().min(1).optional(),
  registry_version: z.number().int().positive().optional(),
  compensation_strategy: z.string().min(1).optional(),
  started_at: z.string().min(1).optional(),
}).strict();

/** Input to RecordOutcome = state after InvokeTool (MapActionToTool state + tool_invocation_response). */
export const RecorderInputSchema = z.object({
  action_intent_id: z.string().min(1, 'action_intent_id is required'),
  tenant_id: z.string().min(1, 'tenant_id is required'),
  account_id: z.string().min(1, 'account_id is required'),
  trace_id: z.string().min(1, 'trace_id is required'),
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
  registry_version: z.number().int().positive('registry_version must be positive integer'),
  attempt_count: z.number().int().positive('attempt_count must be positive integer'),
  started_at: z.string().min(1, 'started_at is required'),
});
// No .strict() — Step Functions passes full merged state (MapActionToTool + tool_invocation_response); extra keys are stripped.

/** Input to RecordFailure = failed step state + Catch resultPath $.error. */
export const FailureRecorderInputSchema = z.object({
  action_intent_id: z.string().min(1, 'action_intent_id is required'),
  tenant_id: z.string().min(1, 'tenant_id is required'),
  account_id: z.string().min(1, 'account_id is required'),
  trace_id: z.string().min(1, 'trace_id is required'),
  registry_version: z.number().int().positive().optional(),
  idempotency_key: z.string().min(1).optional(),
  attempt_count: z.number().int().positive().optional(),
  started_at: z.string().min(1).optional(),
  error: z.object({
    Error: z.string().optional(),
    Cause: z.string().optional(),
  }).optional(),
}).strict();
