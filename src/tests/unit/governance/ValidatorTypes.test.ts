/**
 * Phase 7.1 — ValidatorTypes unit tests.
 * See PHASE_7_1_TEST_PLAN.md §1.
 */

import type {
  ValidatorChokePoint,
  ValidatorResultKind,
  ValidatorResult,
  ValidatorContext,
  EvidenceReference,
  RecordLocator,
  ValidatorGatewayResult,
  ExecutablePayload,
} from '../../../types/governance/ValidatorTypes';

describe('ValidatorTypes', () => {
  describe('ValidatorChokePoint', () => {
    const chokePoints: ValidatorChokePoint[] = [
      'BEFORE_PLAN_APPROVAL',
      'BEFORE_STEP_EXECUTION',
      'BEFORE_EXTERNAL_WRITEBACK',
      'BEFORE_EXPENSIVE_READ',
    ];

    it('includes exactly four choke point literals', () => {
      expect(chokePoints).toHaveLength(4);
      expect(chokePoints).toContain('BEFORE_PLAN_APPROVAL');
      expect(chokePoints).toContain('BEFORE_STEP_EXECUTION');
      expect(chokePoints).toContain('BEFORE_EXTERNAL_WRITEBACK');
      expect(chokePoints).toContain('BEFORE_EXPENSIVE_READ');
    });
  });

  describe('ValidatorResultKind', () => {
    const kinds: ValidatorResultKind[] = ['ALLOW', 'WARN', 'BLOCK'];

    it('includes ALLOW, WARN, BLOCK only', () => {
      expect(kinds).toHaveLength(3);
      expect(kinds).toContain('ALLOW');
      expect(kinds).toContain('WARN');
      expect(kinds).toContain('BLOCK');
    });
  });

  describe('ValidatorResult', () => {
    it('accepts result with optional reason and details', () => {
      const r: ValidatorResult = { validator: 'freshness', result: 'ALLOW' };
      expect(r.result).toBe('ALLOW');
      const r2: ValidatorResult = {
        validator: 'grounding',
        result: 'WARN',
        reason: 'MISSING_EVIDENCE',
        details: { expected: 'evidence' },
      };
      expect(r2.reason).toBe('MISSING_EVIDENCE');
      expect(r2.details).toEqual({ expected: 'evidence' });
    });
  });

  describe('ValidatorContext', () => {
    it('requires choke_point, evaluation_time_utc_ms, validation_run_id, target_id, tenant_id', () => {
      const ctx: ValidatorContext = {
        choke_point: 'BEFORE_PLAN_APPROVAL',
        evaluation_time_utc_ms: 1700000000000,
        validation_run_id: 'run-1',
        target_id: 'plan-1',
        tenant_id: 't1',
      };
      expect(ctx.target_id).toBe('plan-1');
      expect(ctx.validation_run_id).toBe('run-1');
    });
  });

  describe('EvidenceReference', () => {
    it('accepts source_type + source_id shape', () => {
      const ref: EvidenceReference = { source_type: 'canonical.crm.opportunity', source_id: 'opp-123' };
      expect(ref).toHaveProperty('source_type');
      expect(ref).toHaveProperty('source_id');
    });

    it('accepts ledger_event_id shape', () => {
      const ref: EvidenceReference = { ledger_event_id: 'ev-1' };
      expect(ref).toHaveProperty('ledger_event_id');
    });

    it('accepts record_locator shape', () => {
      const loc: RecordLocator = { system: 'crm', object: 'Opportunity', id: 'opp-1' };
      const ref: EvidenceReference = { record_locator: loc };
      expect(ref).toHaveProperty('record_locator');
      expect(ref.record_locator.system).toBe('crm');
    });
  });

  describe('ValidatorGatewayResult', () => {
    it('has aggregate and results array', () => {
      const r: ValidatorGatewayResult = {
        aggregate: 'ALLOW',
        results: [
          { validator: 'freshness', result: 'ALLOW' },
          { validator: 'grounding', result: 'ALLOW' },
        ],
      };
      expect(r.aggregate).toBe('ALLOW');
      expect(r.results).toHaveLength(2);
    });
  });

  describe('ExecutablePayload', () => {
    it('requires evidence array', () => {
      const step: ExecutablePayload = {
        evidence: [{ source_type: 'crm', source_id: '1' }],
      };
      expect(step.evidence).toHaveLength(1);
    });
  });
});
