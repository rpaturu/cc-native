/**
 * ExecutionFailureRecorderHandler Validation Tests - Phase 4.2
 * 
 * Tests Zod schema validation for handler input.
 * Full handler integration tests deferred to Phase 4.3 (requires Gateway).
 */

import { z } from 'zod';

// Mirror handler schema: state from failed step + Catch resultPath $.error (no status in input)
const StepFunctionsInputSchema = z.object({
  action_intent_id: z.string().min(1, 'action_intent_id is required'),
  tenant_id: z.string().min(1, 'tenant_id is required'),
  account_id: z.string().min(1, 'account_id is required'),
  trace_id: z.string().min(1, 'trace_id is required'),
  registry_version: z.number().int().positive('registry_version must be positive integer').optional(),
  idempotency_key: z.string().min(1).optional(),
  attempt_count: z.number().int().positive().optional(),
  started_at: z.string().min(1).optional(),
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
      };

      const result = StepFunctionsInputSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });

    it('should accept valid input with idempotency_key, attempt_count, started_at (state from Catch after StartExecution)', () => {
      const validInput = {
        action_intent_id: 'ai_test_123',
        tenant_id: 'tenant_test_1',
        account_id: 'account_test_1',
        trace_id: 'trace_123',
        registry_version: 1,
        idempotency_key: 'idem_123',
        attempt_count: 1,
        started_at: '2026-01-29T05:00:00.000Z',
        error: { Error: 'ValidationError', Cause: 'Invalid input' },
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
        error: {
          Cause: 'Execution failed',
        },
      };

      const result = StepFunctionsInputSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });
  });
});
