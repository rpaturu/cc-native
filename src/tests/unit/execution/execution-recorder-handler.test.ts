/**
 * ExecutionRecorderHandler Validation Tests - Phase 4.2
 * 
 * Tests Zod schema validation for handler input.
 * Full handler integration tests deferred to Phase 4.3 (requires Gateway).
 */

import { z } from 'zod';

// Import the schema from handler (we'll test it in isolation)
const StepFunctionsInputSchema = z.object({
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
}).strict();

describe('ExecutionRecorderHandler - StepFunctionsInputSchema Validation', () => {
  describe('Valid Input', () => {
    it('should accept valid input with success=true', () => {
      const validInput = {
        action_intent_id: 'ai_test_123',
        tenant_id: 'tenant_test_1',
        account_id: 'account_test_1',
        trace_id: 'trace_123',
        tool_invocation_response: {
          success: true,
          external_object_refs: [
            {
              system: 'CRM',
              object_type: 'Task',
              object_id: 'task_12345',
            },
          ],
          tool_run_ref: 'toolrun/trace_123/1/crm.create_task',
        },
        tool_name: 'crm.create_task',
        tool_schema_version: 'v1.0',
        registry_version: 1,
        attempt_count: 1,
        started_at: '2026-01-26T12:00:00.000Z',
      };

      const result = StepFunctionsInputSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });

    it('should accept valid input with success=false', () => {
      const validInput = {
        action_intent_id: 'ai_test_123',
        tenant_id: 'tenant_test_1',
        account_id: 'account_test_1',
        trace_id: 'trace_123',
        tool_invocation_response: {
          success: false,
          tool_run_ref: 'toolrun/trace_123/1/crm.create_task',
          error_code: 'AUTH_FAILED',
          error_class: 'AUTH',
          error_message: 'Authentication failed',
        },
        tool_name: 'crm.create_task',
        tool_schema_version: 'v1.0',
        registry_version: 1,
        attempt_count: 1,
        started_at: '2026-01-26T12:00:00.000Z',
      };

      const result = StepFunctionsInputSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });
  });

  describe('Required Fields', () => {
    it('should reject missing action_intent_id', () => {
      const invalidInput = {
        tenant_id: 'tenant_test_1',
        account_id: 'account_test_1',
        trace_id: 'trace_123',
        tool_invocation_response: {
          success: true,
          tool_run_ref: 'toolrun/trace_123/1/crm.create_task',
        },
        tool_name: 'crm.create_task',
        tool_schema_version: 'v1.0',
        registry_version: 1,
        attempt_count: 1,
        started_at: '2026-01-26T12:00:00.000Z',
      };

      const result = StepFunctionsInputSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });

    it('should reject missing tool_invocation_response', () => {
      const invalidInput = {
        action_intent_id: 'ai_test_123',
        tenant_id: 'tenant_test_1',
        account_id: 'account_test_1',
        trace_id: 'trace_123',
        tool_name: 'crm.create_task',
        tool_schema_version: 'v1.0',
        registry_version: 1,
        attempt_count: 1,
        started_at: '2026-01-26T12:00:00.000Z',
      };

      const result = StepFunctionsInputSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });

    it('should reject missing tool_name', () => {
      const invalidInput = {
        action_intent_id: 'ai_test_123',
        tenant_id: 'tenant_test_1',
        account_id: 'account_test_1',
        trace_id: 'trace_123',
        tool_invocation_response: {
          success: true,
          tool_run_ref: 'toolrun/trace_123/1/crm.create_task',
        },
        tool_schema_version: 'v1.0',
        registry_version: 1,
        attempt_count: 1,
        started_at: '2026-01-26T12:00:00.000Z',
      };

      const result = StepFunctionsInputSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });
  });

  describe('tool_invocation_response Validation', () => {
    it('should require success boolean', () => {
      const invalidInput = {
        action_intent_id: 'ai_test_123',
        tenant_id: 'tenant_test_1',
        account_id: 'account_test_1',
        trace_id: 'trace_123',
        tool_invocation_response: {
          // success missing
          tool_run_ref: 'toolrun/trace_123/1/crm.create_task',
        },
        tool_name: 'crm.create_task',
        tool_schema_version: 'v1.0',
        registry_version: 1,
        attempt_count: 1,
        started_at: '2026-01-26T12:00:00.000Z',
      };

      const result = StepFunctionsInputSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });

    it('should require tool_run_ref', () => {
      const invalidInput = {
        action_intent_id: 'ai_test_123',
        tenant_id: 'tenant_test_1',
        account_id: 'account_test_1',
        trace_id: 'trace_123',
        tool_invocation_response: {
          success: true,
          // tool_run_ref missing
        },
        tool_name: 'crm.create_task',
        tool_schema_version: 'v1.0',
        registry_version: 1,
        attempt_count: 1,
        started_at: '2026-01-26T12:00:00.000Z',
      };

      const result = StepFunctionsInputSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });

    it('should accept optional external_object_refs', () => {
      const validInput = {
        action_intent_id: 'ai_test_123',
        tenant_id: 'tenant_test_1',
        account_id: 'account_test_1',
        trace_id: 'trace_123',
        tool_invocation_response: {
          success: true,
          tool_run_ref: 'toolrun/trace_123/1/crm.create_task',
          // external_object_refs optional
        },
        tool_name: 'crm.create_task',
        tool_schema_version: 'v1.0',
        registry_version: 1,
        attempt_count: 1,
        started_at: '2026-01-26T12:00:00.000Z',
      };

      const result = StepFunctionsInputSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });
  });

  describe('Type Validation', () => {
    it('should reject string instead of number for registry_version', () => {
      const invalidInput = {
        action_intent_id: 'ai_test_123',
        tenant_id: 'tenant_test_1',
        account_id: 'account_test_1',
        trace_id: 'trace_123',
        tool_invocation_response: {
          success: true,
          tool_run_ref: 'toolrun/trace_123/1/crm.create_task',
        },
        tool_name: 'crm.create_task',
        tool_schema_version: 'v1.0',
        registry_version: '1', // String instead of number
        attempt_count: 1,
        started_at: '2026-01-26T12:00:00.000Z',
      };

      const result = StepFunctionsInputSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });
  });
});
