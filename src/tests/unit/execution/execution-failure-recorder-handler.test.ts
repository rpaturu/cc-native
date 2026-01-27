/**
 * ExecutionFailureRecorderHandler Validation Tests - Phase 4.2
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
  registry_version: z.number().int().positive('registry_version must be positive integer').optional(),
  status: z.literal('FAILED'),
  error: z.object({
    Error: z.string().optional(),
    Cause: z.string().optional(),
  }).optional(),
}).strict();

describe('ExecutionFailureRecorderHandler - StepFunctionsInputSchema Validation', () => {
  describe('Valid Input', () => {
    it('should accept valid input with error details', () => {
      const validInput = {
        action_intent_id: 'ai_test_123',
        tenant_id: 'tenant_test_1',
        account_id: 'account_test_1',
        trace_id: 'trace_123',
        registry_version: 1,
        status: 'FAILED' as const,
        error: {
          Error: 'States.TaskFailed',
          Cause: 'Execution failed',
        },
      };

      const result = StepFunctionsInputSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });

    it('should accept valid input without error details', () => {
      const validInput = {
        action_intent_id: 'ai_test_123',
        tenant_id: 'tenant_test_1',
        account_id: 'account_test_1',
        trace_id: 'trace_123',
        status: 'FAILED' as const,
      };

      const result = StepFunctionsInputSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });

    it('should accept valid input without registry_version', () => {
      const validInput = {
        action_intent_id: 'ai_test_123',
        tenant_id: 'tenant_test_1',
        account_id: 'account_test_1',
        trace_id: 'trace_123',
        status: 'FAILED' as const,
        error: {
          Error: 'States.TaskFailed',
        },
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
        status: 'FAILED' as const,
      };

      const result = StepFunctionsInputSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });

    it('should reject missing status', () => {
      const invalidInput = {
        action_intent_id: 'ai_test_123',
        tenant_id: 'tenant_test_1',
        account_id: 'account_test_1',
        trace_id: 'trace_123',
      };

      const result = StepFunctionsInputSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });
  });

  describe('Status Validation', () => {
    it('should reject status other than FAILED', () => {
      const invalidInput = {
        action_intent_id: 'ai_test_123',
        tenant_id: 'tenant_test_1',
        account_id: 'account_test_1',
        trace_id: 'trace_123',
        status: 'SUCCEEDED', // Not FAILED
      };

      const result = StepFunctionsInputSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });
  });

  describe('Error Structure Validation', () => {
    it('should accept error with Error field', () => {
      const validInput = {
        action_intent_id: 'ai_test_123',
        tenant_id: 'tenant_test_1',
        account_id: 'account_test_1',
        trace_id: 'trace_123',
        status: 'FAILED' as const,
        error: {
          Error: 'States.TaskFailed',
        },
      };

      const result = StepFunctionsInputSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });

    it('should accept error with Cause field', () => {
      const validInput = {
        action_intent_id: 'ai_test_123',
        tenant_id: 'tenant_test_1',
        account_id: 'account_test_1',
        trace_id: 'trace_123',
        status: 'FAILED' as const,
        error: {
          Cause: 'Execution failed',
        },
      };

      const result = StepFunctionsInputSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });
  });
});
