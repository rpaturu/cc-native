/**
 * ToolMapperHandler Validation Tests - Phase 4.2
 * 
 * Tests Zod schema validation for handler input.
 * Full handler integration tests deferred to Phase 4.3 (requires Gateway).
 */

import { z } from 'zod';

// Mirror handler schema: state after ValidatePreflight (execution context + optional validation_result)
const StepFunctionsInputSchema = z.object({
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

describe('ToolMapperHandler - StepFunctionsInputSchema Validation', () => {
  describe('Valid Input', () => {
    it('should accept valid input', () => {
      const validInput = {
        action_intent_id: 'ai_test_123',
        tenant_id: 'tenant_test_1',
        account_id: 'account_test_1',
        idempotency_key: 'key_123',
        trace_id: 'trace_123',
        registry_version: 1,
        attempt_count: 1,
        started_at: '2026-01-26T12:00:00.000Z',
      };

      const result = StepFunctionsInputSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });

    it('should accept valid input with validation_result (state after ValidatePreflight)', () => {
      const validInput = {
        action_intent_id: 'ai_test_123',
        tenant_id: 'tenant_test_1',
        account_id: 'account_test_1',
        idempotency_key: 'key_123',
        trace_id: 'trace_123',
        registry_version: 1,
        attempt_count: 1,
        started_at: '2026-01-26T12:00:00.000Z',
        validation_result: { valid: true, action_intent: { action_intent_id: 'ai_test_123' } },
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
        idempotency_key: 'key_123',
        trace_id: 'trace_123',
        registry_version: 1,
        attempt_count: 1,
        started_at: '2026-01-26T12:00:00.000Z',
      };

      const result = StepFunctionsInputSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0].path).toContain('action_intent_id');
      }
    });

    it('should reject missing tenant_id', () => {
      const invalidInput = {
        action_intent_id: 'ai_test_123',
        account_id: 'account_test_1',
        idempotency_key: 'key_123',
        trace_id: 'trace_123',
        registry_version: 1,
        attempt_count: 1,
        started_at: '2026-01-26T12:00:00.000Z',
      };

      const result = StepFunctionsInputSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });

    it('should reject missing account_id', () => {
      const invalidInput = {
        action_intent_id: 'ai_test_123',
        tenant_id: 'tenant_test_1',
        idempotency_key: 'key_123',
        trace_id: 'trace_123',
        registry_version: 1,
        attempt_count: 1,
        started_at: '2026-01-26T12:00:00.000Z',
      };

      const result = StepFunctionsInputSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });

    it('should reject missing idempotency_key', () => {
      const invalidInput = {
        action_intent_id: 'ai_test_123',
        tenant_id: 'tenant_test_1',
        account_id: 'account_test_1',
        trace_id: 'trace_123',
        registry_version: 1,
        attempt_count: 1,
        started_at: '2026-01-26T12:00:00.000Z',
      };

      const result = StepFunctionsInputSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });

    it('should reject missing trace_id', () => {
      const invalidInput = {
        action_intent_id: 'ai_test_123',
        tenant_id: 'tenant_test_1',
        account_id: 'account_test_1',
        idempotency_key: 'key_123',
        registry_version: 1,
        attempt_count: 1,
        started_at: '2026-01-26T12:00:00.000Z',
      };

      const result = StepFunctionsInputSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });

    it('should reject missing registry_version', () => {
      const invalidInput = {
        action_intent_id: 'ai_test_123',
        tenant_id: 'tenant_test_1',
        account_id: 'account_test_1',
        idempotency_key: 'key_123',
        trace_id: 'trace_123',
        attempt_count: 1,
        started_at: '2026-01-26T12:00:00.000Z',
      };

      const result = StepFunctionsInputSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });

    it('should reject missing attempt_count', () => {
      const invalidInput = {
        action_intent_id: 'ai_test_123',
        tenant_id: 'tenant_test_1',
        account_id: 'account_test_1',
        idempotency_key: 'key_123',
        trace_id: 'trace_123',
        registry_version: 1,
        started_at: '2026-01-26T12:00:00.000Z',
      };

      const result = StepFunctionsInputSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });

    it('should reject missing started_at', () => {
      const invalidInput = {
        action_intent_id: 'ai_test_123',
        tenant_id: 'tenant_test_1',
        account_id: 'account_test_1',
        idempotency_key: 'key_123',
        trace_id: 'trace_123',
        registry_version: 1,
        attempt_count: 1,
      };

      const result = StepFunctionsInputSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });
  });

  describe('Type Validation', () => {
    it('should reject string instead of number for registry_version', () => {
      const invalidInput = {
        action_intent_id: 'ai_test_123',
        tenant_id: 'tenant_test_1',
        account_id: 'account_test_1',
        idempotency_key: 'key_123',
        trace_id: 'trace_123',
        registry_version: '1', // String instead of number
        attempt_count: 1,
        started_at: '2026-01-26T12:00:00.000Z',
      };

      const result = StepFunctionsInputSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });

    it('should reject negative registry_version', () => {
      const invalidInput = {
        action_intent_id: 'ai_test_123',
        tenant_id: 'tenant_test_1',
        account_id: 'account_test_1',
        idempotency_key: 'key_123',
        trace_id: 'trace_123',
        registry_version: -1,
        attempt_count: 1,
        started_at: '2026-01-26T12:00:00.000Z',
      };

      const result = StepFunctionsInputSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });

    it('should reject zero registry_version', () => {
      const invalidInput = {
        action_intent_id: 'ai_test_123',
        tenant_id: 'tenant_test_1',
        account_id: 'account_test_1',
        idempotency_key: 'key_123',
        trace_id: 'trace_123',
        registry_version: 0,
        attempt_count: 1,
        started_at: '2026-01-26T12:00:00.000Z',
      };

      const result = StepFunctionsInputSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });

    it('should reject non-integer registry_version', () => {
      const invalidInput = {
        action_intent_id: 'ai_test_123',
        tenant_id: 'tenant_test_1',
        account_id: 'account_test_1',
        idempotency_key: 'key_123',
        trace_id: 'trace_123',
        registry_version: 1.5, // Float instead of integer
        attempt_count: 1,
        started_at: '2026-01-26T12:00:00.000Z',
      };

      const result = StepFunctionsInputSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });
  });

  describe('Empty String Validation', () => {
    it('should reject empty string for action_intent_id', () => {
      const invalidInput = {
        action_intent_id: '',
        tenant_id: 'tenant_test_1',
        account_id: 'account_test_1',
        idempotency_key: 'key_123',
        trace_id: 'trace_123',
        registry_version: 1,
        attempt_count: 1,
        started_at: '2026-01-26T12:00:00.000Z',
      };

      const result = StepFunctionsInputSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });

    it('should reject empty string for tenant_id', () => {
      const invalidInput = {
        action_intent_id: 'ai_test_123',
        tenant_id: '',
        account_id: 'account_test_1',
        idempotency_key: 'key_123',
        trace_id: 'trace_123',
        registry_version: 1,
        attempt_count: 1,
        started_at: '2026-01-26T12:00:00.000Z',
      };

      const result = StepFunctionsInputSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });
  });

  describe('Strict Mode', () => {
    it('should reject extra fields', () => {
      const invalidInput = {
        action_intent_id: 'ai_test_123',
        tenant_id: 'tenant_test_1',
        account_id: 'account_test_1',
        idempotency_key: 'key_123',
        trace_id: 'trace_123',
        registry_version: 1,
        attempt_count: 1,
        started_at: '2026-01-26T12:00:00.000Z',
        extra_field: 'should be rejected',
      };

      const result = StepFunctionsInputSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });
  });
});
