/**
 * Phase 7.1 — ComplianceValidator unit tests.
 * See PHASE_7_1_TEST_PLAN.md §5.
 */

import { validate } from '../../../../services/governance/validators/ComplianceValidator';
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
  setGovernanceConfig({ restricted_fields: [], prohibited_action_types: [] });
});

describe('ComplianceValidator', () => {
  it('returns ALLOW with NOT_APPLICABLE when neither step nor writeback present', () => {
    const result = validate(ctx({ step_or_proposal: undefined, writeback_payload: undefined }));
    expect(result.validator).toBe('compliance');
    expect(result.result).toBe('ALLOW');
    expect(result.reason).toBe('NOT_APPLICABLE');
  });

  it('returns BLOCK with RESTRICTED_FIELD when step contains restricted field', () => {
    setGovernanceConfig({ restricted_fields: ['ssn'], prohibited_action_types: [] });
    const result = validate(
      ctx({
        step_or_proposal: { evidence: [], ssn: '123-45-6789' } as unknown as ValidatorContext['step_or_proposal'],
      })
    );
    expect(result.result).toBe('BLOCK');
    expect(result.reason).toBe('RESTRICTED_FIELD');
    expect(result.details).toMatchObject({ field_or_action: 'ssn' });
  });

  it('returns BLOCK with PROHIBITED_ACTION when step has prohibited action_type', () => {
    setGovernanceConfig({ restricted_fields: [], prohibited_action_types: ['DELETE_ACCOUNT'] });
    const result = validate(
      ctx({
        step_or_proposal: { evidence: [], action_type: 'DELETE_ACCOUNT' } as unknown as ValidatorContext['step_or_proposal'],
      })
    );
    expect(result.result).toBe('BLOCK');
    expect(result.reason).toBe('PROHIBITED_ACTION');
    expect(result.details).toMatchObject({ field_or_action: 'DELETE_ACCOUNT' });
  });

  it('returns ALLOW when no restricted field or prohibited action', () => {
    setGovernanceConfig({ restricted_fields: ['ssn'], prohibited_action_types: ['DELETE_ACCOUNT'] });
    const result = validate(
      ctx({
        step_or_proposal: { evidence: [], action_type: 'SEND_EMAIL' } as unknown as ValidatorContext['step_or_proposal'],
      })
    );
    expect(result.result).toBe('ALLOW');
  });

  it('returns BLOCK when writeback_payload contains restricted field', () => {
    setGovernanceConfig({ restricted_fields: ['pii_field'] });
    const result = validate(
      ctx({
        step_or_proposal: undefined,
        writeback_payload: { pii_field: 'value' },
      })
    );
    expect(result.result).toBe('BLOCK');
    expect(result.reason).toBe('RESTRICTED_FIELD');
  });
});
