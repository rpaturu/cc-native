/**
 * Phase 5.5 — Learning & Evaluation types.
 * Outcome taxonomy, normalized outcomes, ranking weights, registry, shadow mode.
 */

/** Canonical outcome labels; use everywhere for learning. */
export type OutcomeTaxonomyV1 =
  | 'IDEA_REJECTED'     // human rejected the proposal
  | 'IDEA_EDITED'       // human edited then approved
  | 'EXECUTION_FAILED'  // execution attempted and failed
  | 'EXECUTION_SUCCEEDED' // execution attempted and succeeded
  | 'NO_RESPONSE'       // (later) no response from recipient
  | 'NEGATIVE_RESPONSE'; // (later) negative response

/** Learning-ready normalized outcome. */
export interface NormalizedOutcomeV1 {
  outcome_id: string;
  /** Present for execution/approval flows; absent for IDEA_REJECTED (no intent created). */
  action_intent_id?: string;
  tenant_id: string;
  account_id: string;
  taxonomy: OutcomeTaxonomyV1;
  action_type: string;
  confidence_score?: number;
  executed_at?: string;
  outcome_at: string;
  metadata?: Record<string, unknown>;
}

/** Output of offline calibration jobs; versioned with provenance. */
export interface RankingWeightsV1 {
  version: string;
  tenant_id: string;
  action_type?: string;
  weights: Record<string, number>;
  calibrated_at: string;
  shadow_mode_validated?: boolean;
  trained_on_range: { start: string; end: string };
  data_volume: { n_outcomes: number };
  features_version: string;
  calibration_job_id: string;
  baseline_version_compared_to?: string;
  evaluation_summary?: string;
  evaluation_metrics?: {
    metric_name: string;
    baseline_value: number;
    candidate_value: number;
    uplift: number;
    sample_size: number;
    window_start: string;
    window_end: string;
  };
}

/** Production only uses weights whose registry status is ACTIVE. */
export type RankingWeightsRegistryStatusV1 = 'ACTIVE' | 'CANDIDATE' | 'ROLLED_BACK';

export interface RankingWeightsRegistryV1 {
  tenant_id: string;
  active_version: string;
  candidate_version?: string;
  status: RankingWeightsRegistryStatusV1;
  activated_at: string;
  activated_by: string;
  rollback_of?: string;
}

/** Shadow mode score (offline; not surfaced to sellers). */
export interface ShadowModeScoreV1 {
  proposal_id: string;
  action_type: string;
  tenant_id: string;
  account_id: string;
  score: number;
  validated_at: string;
  used_for_production: boolean;
}

/** Parameters for Shadow Mode gate (explicit and auditable). */
export interface ShadowModeGateParamsV1 {
  evaluation_window_days: number;
  minimum_sample_size: number;
  /** e.g. minimum agreement rate 0.6 or minimum uplift 0.05 */
  threshold_value: number;
  metric_name: string;
}
