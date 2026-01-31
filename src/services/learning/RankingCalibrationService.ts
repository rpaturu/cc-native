/**
 * Phase 5.5 — Ranking calibration: compute weights from normalized outcomes, store and register as CANDIDATE.
 * Offline job; production ranking only uses ACTIVE weights from registry.
 */

import type { NormalizedOutcomeV1, RankingWeightsV1 } from '../../types/learning/LearningTypes';
import type { IRankingWeightsRegistry } from './IRankingWeightsRegistry';

export interface CalibrationJobInput {
  tenant_id: string;
  job_id: string;
  features_version: string;
  outcomes: NormalizedOutcomeV1[];
  /** ISO date range over which outcomes were collected */
  trained_on_range: { start: string; end: string };
  /** Version compared against in evaluation (optional) */
  baseline_version_compared_to?: string;
  evaluation_summary?: string;
}

/**
 * Computes ranking weights from outcome counts (e.g. by taxonomy). Placeholder logic:
 * weight by inverse of rejection rate per action_type so that better-performing types rank higher.
 * Caller persists outcomes; this service only reads the in-memory list and writes weights + registry.
 */
export class RankingCalibrationService {
  constructor(private registry: IRankingWeightsRegistry) {}

  /**
   * Run calibration: compute weights, put artifact, set candidate version. Does not promote to active.
   */
  async runCalibration(input: CalibrationJobInput): Promise<RankingWeightsV1> {
    const weights = this.computeWeights(input);
    await this.registry.putWeights(weights);
    await this.registry.setCandidate(input.tenant_id, weights.version);
    return weights;
  }

  private computeWeights(input: CalibrationJobInput): RankingWeightsV1 {
    const { tenant_id, job_id, features_version, outcomes, trained_on_range } = input;
    const n = outcomes.length;
    const byTaxonomy: Record<string, number> = {};
    const byActionType: Record<string, number> = {};
    for (const o of outcomes) {
      byTaxonomy[o.taxonomy] = (byTaxonomy[o.taxonomy] ?? 0) + 1;
      byActionType[o.action_type] = (byActionType[o.action_type] ?? 0) + 1;
    }
    const weights: Record<string, number> = {};
    for (const [tax, count] of Object.entries(byTaxonomy)) {
      weights[`taxonomy_${tax}`] = count / Math.max(n, 1);
    }
    for (const [actionType, count] of Object.entries(byActionType)) {
      weights[`action_type_${actionType}`] = count / Math.max(n, 1);
    }
    const version = `cal-${job_id}-${Date.now()}`;
    const calibrated_at = new Date().toISOString();
    return {
      version,
      tenant_id,
      weights,
      calibrated_at,
      shadow_mode_validated: false,
      trained_on_range,
      data_volume: { n_outcomes: n },
      features_version,
      calibration_job_id: job_id,
      baseline_version_compared_to: input.baseline_version_compared_to,
      evaluation_summary: input.evaluation_summary,
    };
  }
}
