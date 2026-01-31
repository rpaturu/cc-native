/**
 * Phase 6.1 — RevenuePlan schema and lifecycle types.
 * See PHASE_6_1_CODE_LEVEL_PLAN.md.
 */

export type PlanStatus =
  | 'DRAFT'
  | 'APPROVED'
  | 'ACTIVE'
  | 'PAUSED'
  | 'COMPLETED'
  | 'ABORTED'
  | 'EXPIRED';

export type PlanStepStatus =
  | 'PENDING'
  | 'PENDING_APPROVAL'
  | 'AUTO_EXECUTED'
  | 'DONE'
  | 'SKIPPED'
  | 'FAILED';

export interface PlanStepV1 {
  step_id: string;
  action_type: string;
  status: PlanStepStatus;
  sequence?: number;
  dependencies?: string[];
  constraints?: Record<string, unknown>;
}

export interface RevenuePlanV1 {
  plan_id: string;
  plan_type: string;
  account_id: string;
  tenant_id: string;
  objective: string;
  plan_status: PlanStatus;
  steps: PlanStepV1[];
  constraints?: Record<string, unknown>;
  expires_at: string;
  created_at: string;
  updated_at: string;
  approved_at?: string;
  approved_by?: string;
  completed_at?: string;
  aborted_at?: string;
  expired_at?: string;
  completion_reason?: 'objective_met' | 'all_steps_done';
}
