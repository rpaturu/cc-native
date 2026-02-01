/**
 * Phase 7.1 — GroundingValidator unit tests.
 * See PHASE_7_1_TEST_PLAN.md §3.
 */

import { validate } from '../../../../services/governance/validators/GroundingValidator';
import { setGovernanceConfig } from '../../../../config/governanceConfig';
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
  setGovernanceConfig({ grounding_missing_action: 'BLOCK' });
});

describe('GroundingValidator', () => {
  it('returns ALLOW with NOT_APPLICABLE when step_or_proposal missing', () => {
    const result = validate(ctx({ step_or_proposal: undefined }));
    expect(result.validator).toBe('grounding');
    expect(result.result).toBe('ALLOW');
    expect(result.reason).toBe('NOT_APPLICABLE');
  });

  it('returns ALLOW when evidence exists with valid shapes', () => {
    const result = validate(
      ctx({
        step_or_proposal: {
          evidence: [
            { source_type: 'crm', source_id: 'opp-1' },
            { ledger_event_id: 'ev-1' },
          ],
        },
      })
    );
    expect(result.result).toBe('ALLOW');
  });

  it('returns BLOCK when evidence missing (per config)', () => {
    const result = validate(
      ctx({
        step_or_proposal: { evidence: [] } as unknown as ValidatorContext['step_or_proposal'],
      })
    );
    expect(result.result).toBe('BLOCK');
    expect(result.reason).toBe('MISSING_EVIDENCE');
  });

  it('returns ALLOW when evidence_refs used and valid', () => {
    setGovernanceConfig({ grounding_missing_action: 'BLOCK' });
    const result = validate(
      ctx({
        step_or_proposal: {
          evidence_refs: [{ source_type: 'crm', source_id: '1' }],
        } as unknown as ValidatorContext['step_or_proposal'],
      })
    );
    expect(result.result).toBe('ALLOW');
  });

  it('returns BLOCK when evidence has invalid shape', () => {
    const result = validate(
      ctx({
        step_or_proposal: {
          evidence: [{ invalid: 'string' }] as unknown as ValidatorContext['step_or_proposal'] extends { evidence: infer E } ? E : never,
        },
      })
    );
    expect(result.result).toBe('BLOCK');
    expect(result.reason).toBe('INVALID_EVIDENCE_SHAPE');
  });

  it('returns WARN when grounding_missing_action is WARN and evidence empty', () => {
    setGovernanceConfig({ grounding_missing_action: 'WARN' });
    const result = validate(
      ctx({
        step_or_proposal: { evidence: [] } as unknown as ValidatorContext['step_or_proposal'],
      })
    );
    expect(result.result).toBe('WARN');
  });

  it('accepts record_locator evidence shape', () => {
    const result = validate(
      ctx({
        step_or_proposal: {
          evidence: [
            { record_locator: { system: 'crm', object: 'Opportunity', id: 'opp-1' } },
          ],
        },
      })
    );
    expect(result.result).toBe('ALLOW');
  });

  it('returns BLOCK when whitelist present and ref not in whitelist', () => {
    const ref = { source_type: 'crm', source_id: 'allowed-1' };
    const result = validate(
      ctx({
        step_or_proposal: { evidence: [{ source_type: 'crm', source_id: 'not-in-list' }] },
        evidence_references: [ref],
      })
    );
    expect(result.result).toBe('BLOCK');
    expect(result.reason).toBe('EVIDENCE_NOT_IN_WHITELIST');
  });

  it('returns ALLOW when whitelist present and ref matches', () => {
    const ref = { source_type: 'crm', source_id: 'opp-1' };
    const result = validate(
      ctx({
        step_or_proposal: { evidence: [ref] },
        evidence_references: [ref],
      })
    );
    expect(result.result).toBe('ALLOW');
  });
});
