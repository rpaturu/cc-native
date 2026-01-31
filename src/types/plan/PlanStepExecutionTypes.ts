/**
 * Phase 6.3 — Step execution state: attempt, idempotency, status.
 * Stored in PlanStepExecution table; in-flight status lives here, not in plan document.
 * See PHASE_6_3_CODE_LEVEL_PLAN.md §3, §3a, §3b.
 */

export type PlanStepExecutionStatus =
  | 'STARTED'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'SKIPPED';

export interface PlanStepExecutionRecord {
  plan_id: string;
  step_id: string;
  attempt: number;
  status: PlanStepExecutionStatus;
  started_at: string;
  completed_at?: string;
  outcome_id?: string;
  error_message?: string;
}

export interface PlanStepAttemptResult {
  attempt: number;
  claimed: boolean;
}
