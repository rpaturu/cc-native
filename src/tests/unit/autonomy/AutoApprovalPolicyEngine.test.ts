/**
 * Unit tests for AutoApprovalPolicyEngine - Phase 5.1
 */

import {
  evaluateAutoApprovalPolicy,
  AutoApprovalPolicyEngine,
} from '../../../services/autonomy/AutoApprovalPolicyEngine';
import type { AutoApprovalPolicyInputV1 } from '../../../types/autonomy/AutonomyTypes';

describe('evaluateAutoApprovalPolicy', () => {
  const baseInput: AutoApprovalPolicyInputV1 = {
    action_type: 'CREATE_INTERNAL_NOTE',
    confidence_score: 0.85,
    risk_level: 'LOW',
    tenant_id: 't1',
    account_id: 'a1',
    autonomy_mode: 'AUTO_EXECUTE',
  };

  it('returns BLOCK when autonomy_mode is DISABLED', () => {
    const result = evaluateAutoApprovalPolicy({
      ...baseInput,
      autonomy_mode: 'DISABLED',
    });
    expect(result.decision).toBe('BLOCK');
    expect(result.reason).toBe('ACTION_TYPE_DISABLED');
    expect(result.explanation).toContain('disabled');
  });

  it('returns REQUIRE_APPROVAL when autonomy_mode is PROPOSE_ONLY', () => {
    const result = evaluateAutoApprovalPolicy({
      ...baseInput,
      autonomy_mode: 'PROPOSE_ONLY',
    });
    expect(result.decision).toBe('REQUIRE_APPROVAL');
    expect(result.reason).toBe('PROPOSE_ONLY');
  });

  it('returns REQUIRE_APPROVAL when autonomy_mode is APPROVAL_REQUIRED', () => {
    const result = evaluateAutoApprovalPolicy({
      ...baseInput,
      autonomy_mode: 'APPROVAL_REQUIRED',
    });
    expect(result.decision).toBe('REQUIRE_APPROVAL');
    expect(result.reason).toBe('TENANT_POLICY');
  });

  it('returns REQUIRE_APPROVAL with UNKNOWN_MODE for unexpected autonomy_mode', () => {
    const result = evaluateAutoApprovalPolicy({
      ...baseInput,
      autonomy_mode: 'CUSTOM_OR_INVALID' as any,
    });
    expect(result.decision).toBe('REQUIRE_APPROVAL');
    expect(result.reason).toBe('UNKNOWN_MODE');
    expect(result.explanation).toContain('Unexpected autonomy mode');
    expect(result.policy_clause).toBe('UNKNOWN_MODE');
  });

  it('returns REQUIRE_APPROVAL when risk is HIGH even with AUTO_EXECUTE', () => {
    const result = evaluateAutoApprovalPolicy({
      ...baseInput,
      autonomy_mode: 'AUTO_EXECUTE',
      risk_level: 'HIGH',
    });
    expect(result.decision).toBe('REQUIRE_APPROVAL');
    expect(result.reason).toBe('RISK_LEVEL_HIGH');
  });

  it('returns REQUIRE_APPROVAL when confidence below threshold', () => {
    const result = evaluateAutoApprovalPolicy({
      ...baseInput,
      autonomy_mode: 'AUTO_EXECUTE',
      confidence_score: 0.5,
      risk_level: 'LOW',
    });
    expect(result.decision).toBe('REQUIRE_APPROVAL');
    expect(result.reason).toBe('CONFIDENCE_BELOW_THRESHOLD');
  });

  it('returns AUTO_EXECUTE when AUTO_EXECUTE mode, LOW risk, sufficient confidence', () => {
    const result = evaluateAutoApprovalPolicy({
      ...baseInput,
      autonomy_mode: 'AUTO_EXECUTE',
      risk_level: 'LOW',
      confidence_score: 0.8,
    });
    expect(result.decision).toBe('AUTO_EXECUTE');
    expect(result.explanation).toBeDefined();
    expect(result.policy_version).toBe('AutoApprovalPolicyV1');
  });

  it('returns AUTO_EXECUTE for MINIMAL risk with sufficient confidence', () => {
    const result = evaluateAutoApprovalPolicy({
      ...baseInput,
      autonomy_mode: 'AUTO_EXECUTE',
      risk_level: 'MINIMAL',
      confidence_score: 0.75,
    });
    expect(result.decision).toBe('AUTO_EXECUTE');
  });
});

describe('AutoApprovalPolicyEngine', () => {
  it('evaluate delegates to evaluateAutoApprovalPolicy', () => {
    const engine = new AutoApprovalPolicyEngine();
    const result = engine.evaluate({
      action_type: 'FLAG_FOR_REVIEW',
      confidence_score: 0.9,
      risk_level: 'LOW',
      tenant_id: 't1',
      account_id: 'a1',
      autonomy_mode: 'AUTO_EXECUTE',
    });
    expect(result.decision).toBe('AUTO_EXECUTE');
  });
});
