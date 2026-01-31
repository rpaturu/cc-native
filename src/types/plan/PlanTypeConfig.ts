/**
 * Phase 6.2 — Plan type and step type definitions (RENEWAL_DEFENSE only in 6.2).
 * See PHASE_6_2_CODE_LEVEL_PLAN.md §1.
 */

export type PlanType = 'RENEWAL_DEFENSE';

export const RENEWAL_DEFENSE_STEP_ACTION_TYPES = [
  'REQUEST_RENEWAL_MEETING',
  'PREP_RENEWAL_BRIEF',
  'ESCALATE_SUPPORT_RISK',
] as const;

export type RenewalDefenseStepActionType =
  (typeof RENEWAL_DEFENSE_STEP_ACTION_TYPES)[number];

export interface PlanTypeConfig {
  plan_type: PlanType;
  allowed_step_action_types: string[];
  default_sequence?: string[];
  objective_template?: string;
  expires_at_days_from_creation?: number;
}
