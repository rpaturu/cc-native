/**
 * PostureTypes Unit Tests - Phase 2
 *
 * Covers postureEquals for determinism checks (lines 182–233).
 * See PHASE_2_LOW_COVERAGE_PLAN.md.
 */

import {
  postureEquals,
  AccountPostureStateV1,
  PostureState,
  Momentum,
  RiskFactorV1,
  OpportunityV1,
  UnknownV1,
  Severity,
} from '../../../types/PostureTypes';

function minimalPosture(overrides: Partial<AccountPostureStateV1> = {}): AccountPostureStateV1 {
  return {
    account_id: 'acc-1',
    tenantId: 't1',
    posture: PostureState.OK,
    momentum: Momentum.FLAT,
    risk_factors: [],
    opportunities: [],
    unknowns: [],
    evidence_signal_ids: [],
    evidence_snapshot_refs: [],
    evidence_signal_types: [],
    ruleset_version: 'v1.0.0',
    schema_version: 'v1',
    active_signals_hash: 'h1',
    inputs_hash: 'i1',
    evaluated_at: '2025-01-01T00:00:00Z',
    output_ttl_days: 7,
    rule_id: 'rule-1',
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('postureEquals', () => {
  it('returns true when a and b are deep-equal excluding timestamps', () => {
    const a = minimalPosture({ createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-02T00:00:00Z' });
    const b = minimalPosture({ createdAt: '2025-02-01T00:00:00Z', updatedAt: '2025-02-02T00:00:00Z' });
    expect(postureEquals(a, b)).toBe(true);
  });

  it('returns false when account_id differs', () => {
    const a = minimalPosture({ account_id: 'acc-1' });
    const b = minimalPosture({ account_id: 'acc-2' });
    expect(postureEquals(a, b)).toBe(false);
  });

  it('returns false when tenantId differs', () => {
    const a = minimalPosture({ tenantId: 't1' });
    const b = minimalPosture({ tenantId: 't2' });
    expect(postureEquals(a, b)).toBe(false);
  });

  it('returns false when posture differs', () => {
    const a = minimalPosture({ posture: PostureState.OK });
    const b = minimalPosture({ posture: PostureState.AT_RISK });
    expect(postureEquals(a, b)).toBe(false);
  });

  it('returns false when momentum differs', () => {
    const a = minimalPosture({ momentum: Momentum.FLAT });
    const b = minimalPosture({ momentum: Momentum.UP });
    expect(postureEquals(a, b)).toBe(false);
  });

  it('returns false when rule_id differs', () => {
    const a = minimalPosture({ rule_id: 'rule-1' });
    const b = minimalPosture({ rule_id: 'rule-2' });
    expect(postureEquals(a, b)).toBe(false);
  });

  it('returns false when active_signals_hash differs', () => {
    const a = minimalPosture({ active_signals_hash: 'h1' });
    const b = minimalPosture({ active_signals_hash: 'h2' });
    expect(postureEquals(a, b)).toBe(false);
  });

  it('returns false when inputs_hash differs', () => {
    const a = minimalPosture({ inputs_hash: 'i1' });
    const b = minimalPosture({ inputs_hash: 'i2' });
    expect(postureEquals(a, b)).toBe(false);
  });

  it('returns false when output_ttl_days differs', () => {
    const a = minimalPosture({ output_ttl_days: 7 });
    const b = minimalPosture({ output_ttl_days: 14 });
    expect(postureEquals(a, b)).toBe(false);
  });

  it('returns false when ruleset_version differs', () => {
    const a = minimalPosture({ ruleset_version: 'v1.0.0' });
    const b = minimalPosture({ ruleset_version: 'v1.1.0' });
    expect(postureEquals(a, b)).toBe(false);
  });

  it('returns false when schema_version differs', () => {
    const a = minimalPosture({ schema_version: 'v1' });
    const b = minimalPosture({ schema_version: 'v2' });
    expect(postureEquals(a, b)).toBe(false);
  });

  it('returns false when risk_factors differ', () => {
    const risk: RiskFactorV1 = {
      risk_id: 'r1',
      type: 'RENEWAL_RISK',
      severity: Severity.HIGH,
      description: 'desc',
      evidence_signal_ids: [],
      evidence_snapshot_refs: [],
      introduced_at: '2025-01-01T00:00:00Z',
      ruleset_version: 'v1.0.0',
    };
    const a = minimalPosture({ risk_factors: [] });
    const b = minimalPosture({ risk_factors: [risk] });
    expect(postureEquals(a, b)).toBe(false);
  });

  it('returns false when risk_factors order differs', () => {
    const r1: RiskFactorV1 = {
      risk_id: 'r1',
      type: 'A',
      severity: Severity.LOW,
      description: 'd1',
      evidence_signal_ids: [],
      evidence_snapshot_refs: [],
      introduced_at: '2025-01-01T00:00:00Z',
      ruleset_version: 'v1.0.0',
    };
    const r2: RiskFactorV1 = {
      risk_id: 'r2',
      type: 'B',
      severity: Severity.LOW,
      description: 'd2',
      evidence_signal_ids: [],
      evidence_snapshot_refs: [],
      introduced_at: '2025-01-01T00:00:00Z',
      ruleset_version: 'v1.0.0',
    };
    const a = minimalPosture({ risk_factors: [r1, r2] });
    const b = minimalPosture({ risk_factors: [r2, r1] });
    expect(postureEquals(a, b)).toBe(false);
  });

  it('returns true when risk_factors are same (timestamps ignored)', () => {
    const r1: RiskFactorV1 = {
      risk_id: 'r1',
      type: 'A',
      severity: Severity.LOW,
      description: 'd1',
      evidence_signal_ids: [],
      evidence_snapshot_refs: [],
      introduced_at: '2025-01-01T00:00:00Z',
      ruleset_version: 'v1.0.0',
    };
    const r1Later = { ...r1, introduced_at: '2025-02-01T00:00:00Z' };
    const a = minimalPosture({ risk_factors: [r1] });
    const b = minimalPosture({ risk_factors: [r1Later] });
    expect(postureEquals(a, b)).toBe(true);
  });

  it('returns false when opportunities differ', () => {
    const opp: OpportunityV1 = {
      opportunity_id: 'o1',
      type: 'USAGE_GROWTH',
      severity: Severity.MEDIUM,
      description: 'desc',
      evidence_signal_ids: [],
      evidence_snapshot_refs: [],
      introduced_at: '2025-01-01T00:00:00Z',
      ruleset_version: 'v1.0.0',
    };
    const a = minimalPosture({ opportunities: [] });
    const b = minimalPosture({ opportunities: [opp] });
    expect(postureEquals(a, b)).toBe(false);
  });

  it('returns false when unknowns differ', () => {
    const u: UnknownV1 = {
      unknown_id: 'u1',
      type: 'ENGAGEMENT',
      description: 'desc',
      introduced_at: '2025-01-01T00:00:00Z',
      expires_at: null,
      review_after: '2025-02-01T00:00:00Z',
      ruleset_version: 'v1.0.0',
    };
    const a = minimalPosture({ unknowns: [] });
    const b = minimalPosture({ unknowns: [u] });
    expect(postureEquals(a, b)).toBe(false);
  });

  it('returns false when evidence_signal_ids differ', () => {
    const a = minimalPosture({ evidence_signal_ids: ['s1'] });
    const b = minimalPosture({ evidence_signal_ids: ['s2'] });
    expect(postureEquals(a, b)).toBe(false);
  });

  it('returns false when evidence_snapshot_refs differ', () => {
    const ref = (uri: string, sha: string) => ({
      s3Uri: uri,
      sha256: sha,
      capturedAt: '2025-01-01T00:00:00Z',
      schemaVersion: 'v1',
      detectorInputVersion: 'v1',
    });
    const a = minimalPosture({ evidence_snapshot_refs: [ref('s3://b/k1', 'a')] });
    const b = minimalPosture({ evidence_snapshot_refs: [ref('s3://b/k2', 'b')] });
    expect(postureEquals(a, b)).toBe(false);
  });

  it('returns false when evidence_signal_types differ', () => {
    const a = minimalPosture({ evidence_signal_types: ['type1'] });
    const b = minimalPosture({ evidence_signal_types: ['type2'] });
    expect(postureEquals(a, b)).toBe(false);
  });

  it('returns true for two identical AccountPostureStateV1 with different timestamps', () => {
    const a = minimalPosture();
    const b = {
      ...minimalPosture(),
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      evaluated_at: '2026-01-01T00:00:00Z',
    };
    expect(postureEquals(a, b)).toBe(true);
  });
});
