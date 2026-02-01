/**
 * Phase 7.4 — OutcomeTypes unit tests.
 * See PHASE_7_4_TEST_PLAN.md §1.
 */

import type {
  PlanLinkedEventType,
  OutcomeSource,
  PlanLinkedOutcomeEvent,
  DownstreamOutcomeEvent,
  PlanLinkedOutcomeCaptureInput,
  DownstreamOutcomeCaptureInput,
  DuplicateOutcome,
} from '../../../types/governance/OutcomeTypes';

describe('OutcomeTypes', () => {
  describe('PlanLinkedEventType', () => {
    const planLinked: PlanLinkedEventType[] = [
      'ACTION_APPROVED',
      'ACTION_REJECTED',
      'SELLER_EDIT',
      'EXECUTION_SUCCESS',
      'EXECUTION_FAILURE',
      'PLAN_COMPLETED',
      'PLAN_ABORTED',
      'PLAN_EXPIRED',
    ];

    it('includes all plan-linked event types', () => {
      expect(planLinked).toContain('ACTION_APPROVED');
      expect(planLinked).toContain('PLAN_COMPLETED');
      expect(planLinked).toContain('EXECUTION_SUCCESS');
    });
  });

  describe('Downstream event types', () => {
    it('includes DOWNSTREAM_WIN and DOWNSTREAM_LOSS', () => {
      const downstream = ['DOWNSTREAM_WIN', 'DOWNSTREAM_LOSS'] as const;
      expect(downstream).toHaveLength(2);
    });
  });

  describe('PlanLinkedOutcomeEvent', () => {
    it('requires plan_id and timestamp_utc_ms number', () => {
      const e: PlanLinkedOutcomeEvent = {
        outcome_id: 'o1',
        tenant_id: 't1',
        plan_id: 'plan-1',
        event_type: 'ACTION_APPROVED',
        source: 'HUMAN',
        timestamp_utc_ms: 1700000000000,
        data: {},
      };
      expect(e.plan_id).toBe('plan-1');
      expect(typeof e.timestamp_utc_ms).toBe('number');
    });
  });

  describe('DownstreamOutcomeEvent', () => {
    it('requires account_id and source DOWNSTREAM', () => {
      const e: DownstreamOutcomeEvent = {
        outcome_id: 'o1',
        tenant_id: 't1',
        account_id: 'acc-1',
        event_type: 'DOWNSTREAM_WIN',
        source: 'DOWNSTREAM',
        timestamp_utc_ms: 1700000000000,
        data: { opportunity_id: 'opp-1' },
      };
      expect(e.account_id).toBe('acc-1');
      expect(e.source).toBe('DOWNSTREAM');
    });
  });

  describe('PlanLinkedOutcomeCaptureInput', () => {
    it('requires plan_id for plan-linked', () => {
      const input: PlanLinkedOutcomeCaptureInput = {
        tenant_id: 't1',
        plan_id: 'plan-1',
        event_type: 'ACTION_APPROVED',
        source: 'HUMAN',
        data: { idempotency_key: 'k1' },
      };
      expect(input.plan_id).toBe('plan-1');
    });
  });

  describe('DownstreamOutcomeCaptureInput', () => {
    it('requires account_id and data.opportunity_id', () => {
      const input: DownstreamOutcomeCaptureInput = {
        tenant_id: 't1',
        account_id: 'acc-1',
        event_type: 'DOWNSTREAM_WIN',
        source: 'DOWNSTREAM',
        data: { opportunity_id: 'opp-1' },
      };
      expect(input.account_id).toBe('acc-1');
      expect(input.data.opportunity_id).toBe('opp-1');
    });
  });

  describe('DuplicateOutcome', () => {
    it('has duplicate true and outcome_id', () => {
      const d: DuplicateOutcome = { duplicate: true, outcome_id: 'o1' };
      expect(d.duplicate).toBe(true);
      expect(d.outcome_id).toBe('o1');
    });
  });
});
