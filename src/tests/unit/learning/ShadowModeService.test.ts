/**
 * Unit tests for ShadowModeService — Phase 5.5
 */

import { ShadowModeService } from '../../../services/learning/ShadowModeService';
import type { ShadowModeScoreV1, ShadowModeGateParamsV1 } from '../../../types/learning/LearningTypes';

describe('ShadowModeService', () => {
  let service: ShadowModeService;

  beforeEach(() => {
    service = new ShadowModeService();
  });

  const defaultParams: ShadowModeGateParamsV1 = {
    evaluation_window_days: 14,
    minimum_sample_size: 10,
    threshold_value: 0.6,
    metric_name: 'agreement_rate',
  };

  it('fails when sample size below minimum', () => {
    const scores: ShadowModeScoreV1[] = Array(5).fill({
      proposal_id: 'p1',
      action_type: 'CREATE_CRM_TASK',
      tenant_id: 't1',
      account_id: 'a1',
      score: 1,
      validated_at: new Date().toISOString(),
      used_for_production: false,
    });
    const result = service.evaluateGate(scores, defaultParams);
    expect(result.passed).toBe(false);
    expect(result.sample_size).toBe(5);
    expect(result.reason).toContain('Sample size 5 below minimum 10');
  });

  it('passes when metric_value >= threshold and sample size sufficient', () => {
    const scores: ShadowModeScoreV1[] = Array(15).fill({
      proposal_id: 'p1',
      action_type: 'CREATE_CRM_TASK',
      tenant_id: 't1',
      account_id: 'a1',
      score: 0.7,
      validated_at: new Date().toISOString(),
      used_for_production: false,
    });
    const result = service.evaluateGate(scores, defaultParams);
    expect(result.passed).toBe(true);
    expect(result.metric_value).toBeCloseTo(0.7);
    expect(result.sample_size).toBe(15);
  });

  it('fails when metric_value < threshold', () => {
    const scores: ShadowModeScoreV1[] = Array(15).fill({
      proposal_id: 'p1',
      action_type: 'CREATE_CRM_TASK',
      tenant_id: 't1',
      account_id: 'a1',
      score: 0.5,
      validated_at: new Date().toISOString(),
      used_for_production: false,
    });
    const result = service.evaluateGate(scores, defaultParams);
    expect(result.passed).toBe(false);
    expect(result.metric_value).toBe(0.5);
    expect(result.reason).toContain('0.5');
    expect(result.reason).toContain(defaultParams.threshold_value.toString());
  });

  it('handles empty scores', () => {
    const result = service.evaluateGate([], defaultParams);
    expect(result.passed).toBe(false);
    expect(result.sample_size).toBe(0);
    expect(result.metric_value).toBe(0);
  });

  it('passes when metric_value at or above threshold (boundary)', () => {
    const scores: ShadowModeScoreV1[] = Array(15).fill({
      proposal_id: 'p1',
      action_type: 'CREATE_CRM_TASK',
      tenant_id: 't1',
      account_id: 'a1',
      score: 0.61,
      validated_at: new Date().toISOString(),
      used_for_production: false,
    });
    const result = service.evaluateGate(scores, defaultParams);
    expect(result.passed).toBe(true);
    expect(result.metric_value).toBeCloseTo(0.61);
  });

  it('reason string contains metric_name', () => {
    const scores: ShadowModeScoreV1[] = Array(15).fill({
      proposal_id: 'p1',
      action_type: 'CREATE_CRM_TASK',
      tenant_id: 't1',
      account_id: 'a1',
      score: 0.7,
      validated_at: new Date().toISOString(),
      used_for_production: false,
    });
    const result = service.evaluateGate(scores, defaultParams);
    expect(result.reason).toContain(defaultParams.metric_name);
  });
});
