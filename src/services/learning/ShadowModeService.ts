/**
 * Phase 5.5 — Learning Shadow Mode: gate production ranking changes.
 * Only if candidate meets explicit metric, window, sample size, and threshold may it be promoted.
 */

import type {
  ShadowModeScoreV1,
  ShadowModeGateParamsV1,
} from '../../types/learning/LearningTypes';

export interface ShadowModeGateResult {
  passed: boolean;
  metric_value: number;
  sample_size: number;
  threshold_value: number;
  reason: string;
}

/**
 * Evaluates whether a candidate weight set may be promoted to ACTIVE.
 * Metric (Phase 5): agreement rate = % of top-K suggested actions where seller took similar action.
 * This implementation uses average score over the evaluation window as the metric.
 */
export class ShadowModeService {
  /**
   * Evaluate gate: candidate passes only if sample_size >= minimum_sample_size
   * and metric_value >= threshold_value.
   */
  evaluateGate(
    scores: ShadowModeScoreV1[],
    params: ShadowModeGateParamsV1,
    baselineMetricValue?: number
  ): ShadowModeGateResult {
    const sample_size = scores.length;
    if (sample_size < params.minimum_sample_size) {
      return {
        passed: false,
        metric_value: 0,
        sample_size,
        threshold_value: params.threshold_value,
        reason: `Sample size ${sample_size} below minimum ${params.minimum_sample_size}`,
      };
    }
    const metric_value =
      scores.length === 0 ? 0 : scores.reduce((s, x) => s + x.score, 0) / scores.length;
    const passed = metric_value >= params.threshold_value;
    const reason = passed
      ? `Metric ${params.metric_name}=${metric_value.toFixed(4)} >= ${params.threshold_value}`
      : `Metric ${params.metric_name}=${metric_value.toFixed(4)} < ${params.threshold_value}`;
    return {
      passed,
      metric_value,
      sample_size,
      threshold_value: params.threshold_value,
      reason,
    };
  }
}
