/**
 * Phase 6.2 — Plan type config (static for 6.2).
 * Policy Gate and Proposal Generator read allowed types and steps from here.
 * See PHASE_6_2_CODE_LEVEL_PLAN.md §2.
 */

import {
  PlanType,
  PlanTypeConfig,
  RENEWAL_DEFENSE_STEP_ACTION_TYPES,
} from '../types/plan/PlanTypeConfig';

export const RENEWAL_DEFENSE_CONFIG: PlanTypeConfig = {
  plan_type: 'RENEWAL_DEFENSE',
  allowed_step_action_types: [...RENEWAL_DEFENSE_STEP_ACTION_TYPES],
  max_retries_per_step: 3,
  default_sequence: [
    'REQUEST_RENEWAL_MEETING',
    'PREP_RENEWAL_BRIEF',
    'ESCALATE_SUPPORT_RISK',
  ],
  objective_template: 'Secure renewal before day -30',
  expires_at_days_from_creation: 30,
};

const CONFIG_BY_TYPE: Record<PlanType, PlanTypeConfig> = {
  RENEWAL_DEFENSE: RENEWAL_DEFENSE_CONFIG,
};

/**
 * Returns plan type config for the given plan type, or null if not supported.
 * In 6.2 only RENEWAL_DEFENSE is supported.
 */
export function getPlanTypeConfig(planType: string): PlanTypeConfig | null {
  if (planType in CONFIG_BY_TYPE) {
    return CONFIG_BY_TYPE[planType as PlanType];
  }
  return null;
}
