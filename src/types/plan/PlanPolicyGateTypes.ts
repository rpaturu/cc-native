/**
 * Phase 6.1 — Plan Policy Gate input/output and reason taxonomy.
 * See PHASE_6_1_CODE_LEVEL_PLAN.md §2.
 */

import type { RevenuePlanV1 } from './PlanTypes';

export interface PlanPolicyGateInput {
  plan: RevenuePlanV1;
  tenant_id: string;
  account_id: string;
  existing_active_plan_ids?: string[];
  preconditions_met: boolean;
}

export interface PlanPolicyGateResult {
  can_activate: boolean;
  reasons: PlanPolicyGateReason[];
}

export interface PlanPolicyGateReason {
  code: PlanPolicyGateReasonCode;
  message: string;
}

export type PlanPolicyGateReasonCode =
  | 'CONFLICT_ACTIVE_PLAN'
  | 'PRECONDITIONS_UNMET'
  | 'RISK_ELEVATED'
  | 'INVALID_PLAN_TYPE'
  | 'STEP_ORDER_VIOLATION'
  | 'HUMAN_TOUCH_REQUIRED';
