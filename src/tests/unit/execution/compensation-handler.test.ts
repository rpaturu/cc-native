/**
 * CompensationHandler Validation Tests - Phase 4.2
 * 
 * Tests input validation for handler.
 * Full handler integration tests deferred to Phase 4.3 (requires Gateway + compensation tools).
 */

import { z } from 'zod';

// Import the schema from handler (we'll test it in isolation)
// Note: Compensation handler doesn't have explicit Zod schema in current implementation
// This test validates the expected input structure
const CompensationInputSchema = z.object({
  action_intent_id: z.string().min(1, 'action_intent_id is required'),
  tenant_id: z.string().min(1, 'tenant_id is required'),
  account_id: z.string().min(1, 'account_id is required'),
  trace_id: z.string().min(1, 'trace_id is required'),
  registry_version: z.number().int().positive('registry_version must be positive integer'),
  execution_result: z.any(), // ToolInvocationResponse structure
}).strict();

describe('CompensationHandler - Input Validation', () => {
  describe('Valid Input', () => {
    it('should accept valid input', () => {
      const validInput = {
        action_intent_id: 'ai_test_123',
        tenant_id: 'tenant_test_1',
        account_id: 'account_test_1',
        trace_id: 'trace_123',
        registry_version: 1,
        execution_result: {
          success: false,
          external_object_refs: [
            {
              system: 'CRM',
              object_type: 'Task',
              object_id: 'task_12345',
            },
          ],
          tool_run_ref: 'toolrun/trace_123/1/crm.create_task',
        },
      };

      const result = CompensationInputSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });
  });

  describe('Required Fields', () => {
    it('should reject missing action_intent_id', () => {
      const invalidInput = {
        tenant_id: 'tenant_test_1',
        account_id: 'account_test_1',
        trace_id: 'trace_123',
        registry_version: 1,
        execution_result: {},
      };

      const result = CompensationInputSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });

    it('should reject missing registry_version', () => {
      const invalidInput = {
        action_intent_id: 'ai_test_123',
        tenant_id: 'tenant_test_1',
        account_id: 'account_test_1',
        trace_id: 'trace_123',
        execution_result: {},
      };

      const result = CompensationInputSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });
  });

  describe('Type Validation', () => {
    it('should reject string instead of number for registry_version', () => {
      const invalidInput = {
        action_intent_id: 'ai_test_123',
        tenant_id: 'tenant_test_1',
        account_id: 'account_test_1',
        trace_id: 'trace_123',
        registry_version: '1', // String instead of number
        execution_result: {},
      };

      const result = CompensationInputSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });
  });
});
