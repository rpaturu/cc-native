/**
 * Phase 4 State Machine Contract Tests
 *
 * Asserts that the output of handler A is valid input for handler B.
 * Catches "A added a field, B's schema wasn't updated" at unit/integration time.
 * See STATE_CONTRACT_AND_TESTING.md.
 */

import type {
  StateAfterStartExecution,
  StateAfterValidatePreflight,
  StateAfterMapActionToTool,
  StateAfterInvokeTool,
  StateToFailureRecorder,
  ToolInvocationResponseInState,
} from '../../../types/ExecutionStateMachineState';
import {
  ValidatorInputSchema,
  ToolMapperInputSchema,
  ToolInvocationRequestSchema,
  RecorderInputSchema,
  FailureRecorderInputSchema,
} from '../../../handlers/phase4/execution-state-schemas';

describe('Phase 4 State Machine Contract', () => {
  const stateAfterStartExecution: StateAfterStartExecution = {
    action_intent_id: 'intent-1',
    idempotency_key: 'idem-key-1',
    tenant_id: 'tenant-1',
    account_id: 'account-1',
    trace_id: 'trace-1',
    registry_version: 1,
    attempt_count: 1,
    started_at: '2026-01-01T00:00:00.000Z',
  };

  describe('StartExecution output → ValidatePreflight input', () => {
    it('accepts execution-starter output as execution-validator input', () => {
      const result = ValidatorInputSchema.safeParse(stateAfterStartExecution);
      expect(result.success).toBe(true);
    });
  });

  describe('ValidatePreflight output (merged state) → MapActionToTool input', () => {
    it('accepts state after ValidatePreflight (context + validation_result) as tool-mapper input', () => {
      const stateAfterValidatePreflight: StateAfterValidatePreflight = {
        ...stateAfterStartExecution,
        validation_result: { valid: true, action_intent: {} },
      };
      const result = ToolMapperInputSchema.safeParse(stateAfterValidatePreflight);
      expect(result.success).toBe(true);
    });

    it('accepts state without validation_result (optional) as tool-mapper input', () => {
      const result = ToolMapperInputSchema.safeParse(stateAfterStartExecution);
      expect(result.success).toBe(true);
    });
  });

  describe('MapActionToTool output → InvokeTool input', () => {
    it('accepts tool-mapper output as tool-invoker input', () => {
      const stateAfterMapActionToTool: StateAfterMapActionToTool = {
        gateway_url: 'https://gateway.example.com',
        tool_name: 'create_task',
        tool_arguments: { title: 'Task', idempotency_key: 'idem-key-1', action_intent_id: 'intent-1' },
        tool_schema_version: 'v1',
        registry_version: 1,
        compensation_strategy: 'NONE',
        idempotency_key: 'idem-key-1',
        action_intent_id: 'intent-1',
        tenant_id: 'tenant-1',
        account_id: 'account-1',
        trace_id: 'trace-1',
        attempt_count: 1,
        started_at: '2026-01-01T00:00:00.000Z',
      };
      const result = ToolInvocationRequestSchema.safeParse(stateAfterMapActionToTool);
      expect(result.success).toBe(true);
    });
  });

  describe('InvokeTool output (merged state) → RecordOutcome input', () => {
    it('accepts state after InvokeTool (MapActionToTool + tool_invocation_response) as execution-recorder input', () => {
      const toolInvocationResponse: ToolInvocationResponseInState = {
        success: true,
        tool_run_ref: 'toolrun/trace-1/1/create_task',
        external_object_refs: [],
      };
      const stateAfterInvokeTool: StateAfterInvokeTool = {
        gateway_url: 'https://gateway.example.com',
        tool_name: 'create_task',
        tool_arguments: {},
        tool_schema_version: 'v1',
        registry_version: 1,
        compensation_strategy: 'NONE',
        idempotency_key: 'idem-key-1',
        action_intent_id: 'intent-1',
        tenant_id: 'tenant-1',
        account_id: 'account-1',
        trace_id: 'trace-1',
        attempt_count: 1,
        started_at: '2026-01-01T00:00:00.000Z',
        tool_invocation_response: toolInvocationResponse,
      };
      const result = RecorderInputSchema.safeParse(stateAfterInvokeTool);
      expect(result.success).toBe(true);
    });
  });

  describe('Failed step state + Catch error → RecordFailure input', () => {
    it('accepts state after StartExecution + error as execution-failure-recorder input', () => {
      const stateToFailureRecorder: StateToFailureRecorder = {
        ...stateAfterStartExecution,
        error: { Error: 'ValidationError', Cause: 'Intent not found' },
      };
      const result = FailureRecorderInputSchema.safeParse(stateToFailureRecorder);
      expect(result.success).toBe(true);
    });

    it('accepts minimal failure state (action_intent_id, tenant_id, account_id, trace_id only)', () => {
      const minimal: StateToFailureRecorder = {
        action_intent_id: 'intent-1',
        tenant_id: 'tenant-1',
        account_id: 'account-1',
        trace_id: 'trace-1',
      };
      const result = FailureRecorderInputSchema.safeParse(minimal);
      expect(result.success).toBe(true);
    });
  });
});
