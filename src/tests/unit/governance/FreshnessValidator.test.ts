/**
 * Phase 7.1 — FreshnessValidator unit tests.
 * See PHASE_7_1_CODE_LEVEL_PLAN.md §10, testing/PHASE_7_1_TEST_PLAN.md.
 */

import { validate } from '../../../services/governance/validators/FreshnessValidator';
import { setFreshnessTtlConfig } from '../../../config/freshnessTtlConfig';
import type { ValidatorContext } from '../../../types/governance/ValidatorTypes';

const NOW = 1700000000000; // fixed evaluation time

function ctx(overrides: Partial<ValidatorContext> = {}): ValidatorContext {
  return {
    choke_point: 'BEFORE_PLAN_APPROVAL',
    evaluation_time_utc_ms: NOW,
    validation_run_id: 'run-1',
    target_id: 'plan-1',
    tenant_id: 't1',
    ...overrides,
  };
}

beforeEach(() => {
  setFreshnessTtlConfig([
    { source_id: 'crm', hard_ttl_ms: 14 * 86400 * 1000, soft_ttl_ms: 7 * 86400 * 1000 },
    { source_id: 'support', hard_ttl_ms: 10 * 86400 * 1000, soft_ttl_ms: 5 * 86400 * 1000 },
  ]);
});

describe('FreshnessValidator', () => {
  it('returns ALLOW when age ≤ soft_ttl', () => {
    const sevenDaysMs = 7 * 86400 * 1000;
    const lastUpdated = NOW - sevenDaysMs;
    const result = validate(
      ctx({ data_sources: [{ source_id: 'crm', last_updated_utc_ms: lastUpdated }] })
    );
    expect(result.validator).toBe('freshness');
    expect(result.result).toBe('ALLOW');
    expect(result.details?.evaluated_sources).toHaveLength(1);
    expect(result.details?.worst_result).toBe('ALLOW');
  });

  it('returns WARN when age in (soft_ttl, hard_ttl]', () => {
    const eightDaysMs = 8 * 86400 * 1000;
    const lastUpdated = NOW - eightDaysMs;
    const result = validate(
      ctx({ data_sources: [{ source_id: 'crm', last_updated_utc_ms: lastUpdated }] })
    );
    expect(result.result).toBe('WARN');
    expect(result.reason).toBe('DATA_STALE');
    expect(result.details?.worst_result).toBe('WARN');
  });

  it('returns BLOCK when age > hard_ttl', () => {
    const fifteenDaysMs = 15 * 86400 * 1000;
    const lastUpdated = NOW - fifteenDaysMs;
    const result = validate(
      ctx({ data_sources: [{ source_id: 'crm', last_updated_utc_ms: lastUpdated }] })
    );
    expect(result.result).toBe('BLOCK');
    expect(result.reason).toBe('DATA_STALE');
    expect(result.details?.worst_result).toBe('BLOCK');
  });

  it('returns ALLOW with NOT_APPLICABLE when no data_sources', () => {
    const result = validate(ctx({ data_sources: undefined }));
    expect(result.result).toBe('ALLOW');
    expect(result.reason).toBe('NOT_APPLICABLE');
  });

  it('returns ALLOW with NOT_APPLICABLE when data_sources empty', () => {
    const result = validate(ctx({ data_sources: [] }));
    expect(result.result).toBe('ALLOW');
    expect(result.reason).toBe('NOT_APPLICABLE');
  });

  it('uses canonical details shape (evaluated_sources, worst_result, worst_source_id)', () => {
    const eightDaysMs = 8 * 86400 * 1000;
    const result = validate(
      ctx({ data_sources: [{ source_id: 'crm', last_updated_utc_ms: NOW - eightDaysMs }] })
    );
    expect(result.details).toMatchObject({
      evaluated_sources: expect.any(Array),
      worst_result: 'WARN',
      worst_source_id: 'crm',
    });
  });

  it('multiple sources: worst result wins (one BLOCK → BLOCK)', () => {
    const result = validate(
      ctx({
        data_sources: [
          { source_id: 'crm', last_updated_utc_ms: NOW - 3 * 86400 * 1000 },
          { source_id: 'support', last_updated_utc_ms: 0 },
        ],
      })
    );
    expect(result.result).toBe('BLOCK');
    expect(result.details?.worst_result).toBe('BLOCK');
  });

  it('same context twice yields same result (determinism)', () => {
    const context = ctx({
      data_sources: [{ source_id: 'crm', last_updated_utc_ms: NOW - 5 * 86400 * 1000 }],
    });
    const r1 = validate(context);
    const r2 = validate({ ...context });
    expect(r2.result).toBe(r1.result);
    expect(r2.reason).toBe(r1.reason);
    expect(r2.details?.worst_result).toBe(r1.details?.worst_result);
  });
});
