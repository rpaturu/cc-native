/**
 * Unit tests for RankingCalibrationService — Phase 5.5
 */

import { RankingCalibrationService } from '../../../services/learning/RankingCalibrationService';
import type { IRankingWeightsRegistry } from '../../../services/learning/IRankingWeightsRegistry';
import type { NormalizedOutcomeV1 } from '../../../types/learning/LearningTypes';

describe('RankingCalibrationService', () => {
  let registry: jest.Mocked<IRankingWeightsRegistry>;
  let service: RankingCalibrationService;

  beforeEach(() => {
    registry = {
      getRegistry: jest.fn(),
      resolveActiveVersion: jest.fn(),
      getWeights: jest.fn(),
      putWeights: jest.fn().mockResolvedValue(undefined),
      setCandidate: jest.fn().mockResolvedValue(undefined),
      promoteCandidateToActive: jest.fn(),
      rollback: jest.fn(),
    };
    service = new RankingCalibrationService(registry);
  });

  it('computes weights from outcomes and registers as CANDIDATE', async () => {
    const outcomes: NormalizedOutcomeV1[] = [
      { outcome_id: 'o1', tenant_id: 't1', account_id: 'a1', taxonomy: 'EXECUTION_SUCCEEDED', action_type: 'A', outcome_at: '2026-01-01T00:00:00.000Z' },
      { outcome_id: 'o2', tenant_id: 't1', account_id: 'a1', taxonomy: 'EXECUTION_SUCCEEDED', action_type: 'A', outcome_at: '2026-01-01T00:00:00.000Z' },
      { outcome_id: 'o3', tenant_id: 't1', account_id: 'a1', taxonomy: 'IDEA_REJECTED', action_type: 'B', outcome_at: '2026-01-01T00:00:00.000Z' },
    ];
    const result = await service.runCalibration({
      tenant_id: 't1',
      job_id: 'job_1',
      features_version: 'v1',
      outcomes,
      trained_on_range: { start: '2026-01-01', end: '2026-01-14' },
    });

    expect(result.tenant_id).toBe('t1');
    expect(result.calibration_job_id).toBe('job_1');
    expect(result.data_volume.n_outcomes).toBe(3);
    expect(result.weights['taxonomy_EXECUTION_SUCCEEDED']).toBeCloseTo(2 / 3);
    expect(result.weights['taxonomy_IDEA_REJECTED']).toBeCloseTo(1 / 3);
    expect(result.weights['action_type_A']).toBeCloseTo(2 / 3);
    expect(result.weights['action_type_B']).toBeCloseTo(1 / 3);
    expect(result.shadow_mode_validated).toBe(false);

    expect(registry.putWeights).toHaveBeenCalledWith(expect.objectContaining({ version: result.version }));
    expect(registry.setCandidate).toHaveBeenCalledWith('t1', result.version);
  });

  it('handles empty outcomes', async () => {
    const result = await service.runCalibration({
      tenant_id: 't1',
      job_id: 'job_1',
      features_version: 'v1',
      outcomes: [],
      trained_on_range: { start: '2026-01-01', end: '2026-01-14' },
    });
    expect(result.data_volume.n_outcomes).toBe(0);
    expect(registry.putWeights).toHaveBeenCalled();
    expect(registry.setCandidate).toHaveBeenCalled();
  });

  it('includes baseline_version_compared_to and evaluation_summary when provided', async () => {
    const outcomes: NormalizedOutcomeV1[] = [
      { outcome_id: 'o1', tenant_id: 't1', account_id: 'a1', taxonomy: 'EXECUTION_SUCCEEDED', action_type: 'A', outcome_at: '2026-01-01T00:00:00.000Z' },
    ];
    const result = await service.runCalibration({
      tenant_id: 't1',
      job_id: 'job_1',
      features_version: 'v1',
      outcomes,
      trained_on_range: { start: '2026-01-01', end: '2026-01-14' },
      baseline_version_compared_to: 'v0',
      evaluation_summary: 'Uplift 5%',
    });
    expect(result.baseline_version_compared_to).toBe('v0');
    expect(result.evaluation_summary).toBe('Uplift 5%');
  });
});
