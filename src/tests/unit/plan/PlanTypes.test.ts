/**
 * PlanTypes — Phase 6.1 schema/type invariants and fixture validation.
 */

import {
  RevenuePlanV1Schema,
  PlanStepV1Schema,
  PlanPolicyGateInputSchema,
  PlanLedgerEntrySchema,
  PlanLedgerEventTypeSchema,
} from '../../../types/plan/PlanSchema';

import revenuePlanDraft from '../../fixtures/plan/revenue-plan-draft.json';
import revenuePlanApproved from '../../fixtures/plan/revenue-plan-approved.json';
import revenuePlanActive from '../../fixtures/plan/revenue-plan-active.json';
import planPolicyGateInput from '../../fixtures/plan/plan-policy-gate-input.json';

describe('PlanTypes schema invariants', () => {
  describe('RevenuePlanV1', () => {
    it('valid fixture (draft) passes', () => {
      const result = RevenuePlanV1Schema.safeParse(revenuePlanDraft);
      expect(result.success).toBe(true);
    });

    it('valid fixture (approved) passes', () => {
      const result = RevenuePlanV1Schema.safeParse(revenuePlanApproved);
      expect(result.success).toBe(true);
    });

    it('valid fixture (active) passes', () => {
      const result = RevenuePlanV1Schema.safeParse(revenuePlanActive);
      expect(result.success).toBe(true);
    });

    it('invalid: missing plan_id fails', () => {
      const invalid = { ...revenuePlanDraft, plan_id: undefined };
      const result = RevenuePlanV1Schema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('invalid: invalid plan_status fails', () => {
      const invalid = { ...revenuePlanDraft, plan_status: 'INVALID_STATUS' };
      const result = RevenuePlanV1Schema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('invalid: missing plan_status fails', () => {
      const invalid = { ...revenuePlanDraft, plan_status: undefined };
      const result = RevenuePlanV1Schema.safeParse(invalid);
      expect(result.success).toBe(false);
    });
  });

  describe('PlanStepV1', () => {
    it('valid step with step_id, action_type, status passes', () => {
      const step = { step_id: 's1', action_type: 'REQUEST_MEETING', status: 'PENDING' };
      const result = PlanStepV1Schema.safeParse(step);
      expect(result.success).toBe(true);
    });

    it('step_id required — missing step_id fails', () => {
      const step = { action_type: 'X', status: 'PENDING' };
      const result = PlanStepV1Schema.safeParse(step);
      expect(result.success).toBe(false);
    });

    it('object with retry_count still parses (schema does not include retry_count)', () => {
      const step = {
        step_id: 's1',
        action_type: 'X',
        status: 'PENDING',
        retry_count: 2,
      };
      const result = PlanStepV1Schema.safeParse(step);
      expect(result.success).toBe(true);
      const parsed = result.success ? result.data : null;
      expect(parsed).not.toBeNull();
      expect('retry_count' in (parsed ?? {})).toBe(false);
    });
  });

  describe('PlanPolicyGateInput', () => {
    it('valid fixture passes', () => {
      const result = PlanPolicyGateInputSchema.safeParse(planPolicyGateInput);
      expect(result.success).toBe(true);
    });

    it('preconditions_met required — missing preconditions_met fails', () => {
      const invalid = { ...planPolicyGateInput, preconditions_met: undefined };
      const result = PlanPolicyGateInputSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('preconditions_met must be boolean', () => {
      const invalid = { ...planPolicyGateInput, preconditions_met: 'true' };
      const result = PlanPolicyGateInputSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });
  });

  describe('PlanLedgerEntry', () => {
    it('valid entry with event_type in union and data passes', () => {
      const entry = {
        entry_id: 'e1',
        plan_id: 'p1',
        tenant_id: 't1',
        account_id: 'a1',
        event_type: 'PLAN_APPROVED',
        timestamp: '2026-01-30T10:00:00.000Z',
        data: { plan_id: 'p1' },
      };
      const result = PlanLedgerEntrySchema.safeParse(entry);
      expect(result.success).toBe(true);
    });

    it('event_type must be in PlanLedgerEventType union', () => {
      const invalid = {
        entry_id: 'e1',
        plan_id: 'p1',
        tenant_id: 't1',
        account_id: 'a1',
        event_type: 'INVALID_EVENT',
        timestamp: '2026-01-30T10:00:00.000Z',
        data: {},
      };
      const result = PlanLedgerEntrySchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('data required', () => {
      const invalid = {
        entry_id: 'e1',
        plan_id: 'p1',
        tenant_id: 't1',
        account_id: 'a1',
        event_type: 'PLAN_APPROVED',
        timestamp: '2026-01-30T10:00:00.000Z',
        data: undefined,
      };
      const result = PlanLedgerEntrySchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('all PlanLedgerEventType values are valid', () => {
      const types = [
        'PLAN_CREATED',
        'PLAN_UPDATED',
        'PLAN_APPROVED',
        'PLAN_ACTIVATED',
        'PLAN_PAUSED',
        'PLAN_RESUMED',
        'PLAN_ABORTED',
        'PLAN_COMPLETED',
        'PLAN_EXPIRED',
        'STEP_STARTED',
        'STEP_COMPLETED',
        'STEP_SKIPPED',
        'STEP_FAILED',
      ];
      types.forEach((event_type) => {
        const result = PlanLedgerEventTypeSchema.safeParse(event_type);
        expect(result.success).toBe(true);
      });
    });
  });
});
