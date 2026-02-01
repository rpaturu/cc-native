/**
 * Phase 7.1 — ContradictionValidator unit tests.
 * See PHASE_7_1_TEST_PLAN.md §4.
 */

import { validate } from '../../../../services/governance/validators/ContradictionValidator';
import { setContradictionFieldConfig } from '../../../../config/contradictionFieldConfig';
import type { ValidatorContext } from '../../../../types/governance/ValidatorTypes';

function ctx(overrides: Partial<ValidatorContext> = {}): ValidatorContext {
  return {
    choke_point: 'BEFORE_PLAN_APPROVAL',
    evaluation_time_utc_ms: 1700000000000,
    validation_run_id: 'run-1',
    target_id: 'plan-1',
    tenant_id: 't1',
    ...overrides,
  };
}

beforeEach(() => {
  setContradictionFieldConfig([]);
});

describe('ContradictionValidator', () => {
  it('returns ALLOW with NOT_APPLICABLE when step_or_proposal missing', () => {
    const result = validate(ctx({ step_or_proposal: undefined, canonical_snapshot: { stage: 'lead' } }));
    expect(result.validator).toBe('contradiction');
    expect(result.result).toBe('ALLOW');
    expect(result.reason).toBe('NOT_APPLICABLE');
  });

  it('returns ALLOW with NOT_APPLICABLE when canonical_snapshot missing', () => {
    const result = validate(
      ctx({ step_or_proposal: { evidence: [], stage: 'qualified' } as unknown as ValidatorContext['step_or_proposal'] })
    );
    expect(result.result).toBe('ALLOW');
    expect(result.reason).toBe('NOT_APPLICABLE');
  });

  it('returns ALLOW when eq rule and step equals snapshot', () => {
    setContradictionFieldConfig([{ field: 'stage', rule: { kind: 'eq' } }]);
    const result = validate(
      ctx({
        canonical_snapshot: { stage: 'qualified' },
        step_or_proposal: { evidence: [], stage: 'qualified' } as unknown as ValidatorContext['step_or_proposal'],
      })
    );
    expect(result.result).toBe('ALLOW');
  });

  it('returns BLOCK when eq rule and step differs from snapshot', () => {
    setContradictionFieldConfig([{ field: 'stage', rule: { kind: 'eq' } }]);
    const result = validate(
      ctx({
        canonical_snapshot: { stage: 'qualified' },
        step_or_proposal: { evidence: [], stage: 'lead' } as unknown as ValidatorContext['step_or_proposal'],
      })
    );
    expect(result.result).toBe('BLOCK');
    expect(result.reason).toBe('CONTRADICTION');
    expect(result.details).toMatchObject({ field: 'stage', snapshot_value: 'qualified', step_value: 'lead' });
  });

  it('returns ALLOW when no_backward and step not earlier in ordering', () => {
    setContradictionFieldConfig([
      { field: 'stage', rule: { kind: 'no_backward', ordering: ['lead', 'qualified', 'closed'] } },
    ]);
    const result = validate(
      ctx({
        canonical_snapshot: { stage: 'qualified' },
        step_or_proposal: { evidence: [], stage: 'closed' } as unknown as ValidatorContext['step_or_proposal'],
      })
    );
    expect(result.result).toBe('ALLOW');
  });

  it('returns BLOCK when no_backward and step earlier in ordering', () => {
    setContradictionFieldConfig([
      { field: 'stage', rule: { kind: 'no_backward', ordering: ['lead', 'qualified', 'closed'] } },
    ]);
    const result = validate(
      ctx({
        canonical_snapshot: { stage: 'qualified' },
        step_or_proposal: { evidence: [], stage: 'lead' } as unknown as ValidatorContext['step_or_proposal'],
      })
    );
    expect(result.result).toBe('BLOCK');
    expect(result.reason).toBe('CONTRADICTION');
  });

  it('returns ALLOW when null/unknown for field (not contradictory)', () => {
    setContradictionFieldConfig([{ field: 'stage', rule: { kind: 'eq' } }]);
    const result = validate(
      ctx({
        canonical_snapshot: { stage: null },
        step_or_proposal: { evidence: [], stage: 'qualified' } as unknown as ValidatorContext['step_or_proposal'],
      })
    );
    expect(result.result).toBe('ALLOW');
  });

  it('ignores non-configured field', () => {
    setContradictionFieldConfig([{ field: 'stage', rule: { kind: 'eq' } }]);
    const result = validate(
      ctx({
        canonical_snapshot: { stage: 'qualified', other: 'x' },
        step_or_proposal: { evidence: [], stage: 'qualified', other: 'y' } as unknown as ValidatorContext['step_or_proposal'],
      })
    );
    expect(result.result).toBe('ALLOW');
  });

  it('returns ALLOW when date_window delta within max_days_delta', () => {
    setContradictionFieldConfig([{ field: 'close_date', rule: { kind: 'date_window', max_days_delta: 7 } }]);
    const snapDate = '2026-01-01';
    const stepDate = '2026-01-05';
    const result = validate(
      ctx({
        canonical_snapshot: { close_date: snapDate },
        step_or_proposal: { evidence: [], close_date: stepDate } as unknown as ValidatorContext['step_or_proposal'],
      })
    );
    expect(result.result).toBe('ALLOW');
  });

  it('returns BLOCK when date_window delta exceeds max_days_delta', () => {
    setContradictionFieldConfig([{ field: 'close_date', rule: { kind: 'date_window', max_days_delta: 2 } }]);
    const result = validate(
      ctx({
        canonical_snapshot: { close_date: '2026-01-01' },
        step_or_proposal: { evidence: [], close_date: '2026-01-10' } as unknown as ValidatorContext['step_or_proposal'],
      })
    );
    expect(result.result).toBe('BLOCK');
    expect(result.reason).toBe('CONTRADICTION');
  });
});
