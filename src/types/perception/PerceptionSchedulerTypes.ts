/**
 * Perception Scheduler Types - Phase 5.3
 *
 * Heat scoring, pull orchestration, budget state, and deterministic cadence.
 * Depth units: SHALLOW=1, DEEP=3 (configurable). Budget/state atomic; idempotency at-most-once.
 */

/** Reason code for idempotency hits in audit, metrics, and ledger. */
export const DUPLICATE_PULL_JOB_ID = 'DUPLICATE_PULL_JOB_ID';

/** Depth for pull: SHALLOW = metadata/deltas (1 unit), DEEP = full object graph (3 units). */
export type PullDepth = 'SHALLOW' | 'DEEP';

/** Default depth units (configurable per connector). */
export const DEPTH_UNITS: Record<PullDepth, number> = {
  SHALLOW: 1,
  DEEP: 3,
};

export type HeatTier = 'HOT' | 'WARM' | 'COLD';

/**
 * Account heat — latest only per account (sk=HEAT#LATEST).
 * Optional daily rollup sk=HEAT#<date> with TTL for analytics.
 */
export interface AccountHeatV1 {
  pk: string; // TENANT#<tenant_id>#ACCOUNT#<account_id>
  sk: string; // HEAT#LATEST or HEAT#<date> for optional daily rollup with TTL
  tenant_id: string;
  account_id: string;
  heat_score: number; // 0–1
  heat_tier: HeatTier;
  factors?: {
    posture_score?: number;
    signal_recency?: number;
    signal_volume?: number;
  };
  computed_at: string; // ISO
  updated_at: string;
}

/**
 * Pull job request — output of scheduler; input to pull Step Functions or worker.
 * pull_job_id required for idempotency (derived from tenant/account/connector/depth/time-bucket).
 */
export interface PerceptionPullJobV1 {
  pull_job_id: string;
  tenant_id: string;
  account_id: string;
  connector_id: string;
  depth: PullDepth;
  depth_units: number; // 1 or 3 (or from config)
  scheduled_at: string; // ISO
  correlation_id?: string;
  budget_remaining?: number;
}

/** Per-tenant pull budget (config). */
export interface PerceptionPullBudgetV1 {
  pk: string; // TENANT#<tenant_id>
  sk: string; // BUDGET#PULL
  tenant_id: string;
  max_pull_units_per_day?: number;
  max_per_connector_per_day?: Record<string, number>;
  updated_at: string;
}

/**
 * Runtime pull budget state — required for atomic consume.
 * Keyed by tenant + date (+ optional connector).
 */
export interface PerceptionPullBudgetStateV1 {
  pk: string; // TENANT#<tenant_id>
  sk: string; // BUDGET_STATE#<date_key> or BUDGET_STATE#<date_key>#CONNECTOR#<connector_id>
  tenant_id: string;
  date_key: string; // YYYY-MM-DD
  connector_id?: string;
  units_consumed: number;
  pull_count: number;
  updated_at: string;
}

/** Result of checkAndConsumePullBudget (atomic). */
export interface CheckAndConsumePullBudgetResult {
  allowed: boolean;
  remaining?: number;
  reason?: string; // e.g. DUPLICATE_PULL_JOB_ID when idempotency hit
}

/**
 * Deterministic cadence: HeatTierPolicyV1.
 * Promotion/demotion rules so accounts don't flap.
 */
export interface HeatTierPolicyV1 {
  tier: HeatTier;
  pull_cadence: string; // e.g. '1h', '6h', '3d'
  default_depth: PullDepth;
  promotion_signals_in_hours?: number;
  promotion_window_hours?: number;
  demotion_cooldown_hours?: number;
}
