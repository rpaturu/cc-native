/**
 * Phase 5.2 Decision Trigger Types
 *
 * Types for Decision Triggering & Scheduling: RUN_DECISION, CostGate, RunState, IdempotencyStore.
 * See PHASE_5_2_CODE_LEVEL_PLAN.md.
 */

export type DecisionTriggerType =
  | 'SIGNAL_ARRIVED'
  | 'LIFECYCLE_STATE_CHANGE'
  | 'POSTURE_CHANGE'
  | 'TIME_RITUAL_DAILY_BRIEF'
  | 'TIME_RITUAL_WEEKLY_REVIEW'
  | 'TIME_RITUAL_RENEWAL_RUNWAY';

export interface DecisionTriggerRegistryEntryV1 {
  trigger_type: DecisionTriggerType;
  debounce_seconds: number;
  cooldown_seconds: number;
  max_per_tenant_per_hour?: number;
  max_per_account_per_hour?: number;
}

export type DecisionCostGateResult = 'ALLOW' | 'DEFER' | 'SKIP';

export interface DecisionCostGateOutputV1 {
  result: DecisionCostGateResult;
  reason?: string;
  explanation?: string;
  evaluated_at: string;
  defer_until_epoch?: number;
  retry_after_seconds?: number;
}

export interface DecisionCostGateInputV1 {
  tenant_id: string;
  account_id: string;
  trigger_type: DecisionTriggerType;
  budget_remaining?: number;
  recency_last_run_epoch?: number;
  action_saturation_score?: number;
  tenant_tier?: string;
}

export interface RunDecisionEventV1 {
  source: string;
  'detail-type': 'RUN_DECISION';
  detail: {
    tenant_id: string;
    account_id: string;
    trigger_type: DecisionTriggerType;
    scheduled_at: string;
    idempotency_key: string;
    correlation_id?: string;
  };
}

export interface RunDecisionDeferredEventV1 {
  source: string;
  'detail-type': 'RUN_DECISION_DEFERRED';
  detail: {
    tenant_id: string;
    account_id: string;
    trigger_type: DecisionTriggerType;
    defer_until_epoch: number;
    retry_after_seconds?: number;
    original_idempotency_key: string;
    correlation_id?: string;
  };
}

export interface DecisionRunStateV1 {
  pk: string;
  sk: string;
  last_allowed_at_epoch: number;
  last_deferred_at_epoch?: number;
  last_trigger_at_by_type?: Record<string, number>;
  run_count_this_hour?: number;
  updated_at: string;
}
