/**
 * Phase 6.3 — Plan State Evaluator: objective conditions, expiry; COMPLETED / EXPIRED / NO_CHANGE.
 * Orchestrator calls evaluator; completion/expiry logic lives only here. No DB read/write.
 * See PHASE_6_3_CODE_LEVEL_PLAN.md §2.
 */

import type {
  PlanStateEvaluatorInput,
  PlanStateEvaluatorResult,
} from '../../types/plan/PlanStateEvaluatorTypes';

const TERMINAL_SUCCESS_STEP_STATUSES = ['DONE', 'SKIPPED'] as const;

export class PlanStateEvaluatorService {
  /**
   * Evaluate plan state: expiry first, then completion (all steps DONE or SKIPPED), else NO_CHANGE.
   * RENEWAL_DEFENSE (6.3): SKIPPED counts as terminal success for completion.
   */
  async evaluate(input: PlanStateEvaluatorInput): Promise<PlanStateEvaluatorResult> {
    const { plan } = input;
    const now = new Date().toISOString();

    if (plan.expires_at && now >= plan.expires_at) {
      return { action: 'EXPIRE', expired_at: now };
    }

    const steps = plan.steps ?? [];
    if (steps.length === 0) {
      return { action: 'NO_CHANGE' };
    }

    const allTerminalSuccess = steps.every((s) =>
      TERMINAL_SUCCESS_STEP_STATUSES.includes(s.status as 'DONE' | 'SKIPPED')
    );
    if (allTerminalSuccess) {
      return {
        action: 'COMPLETE',
        completion_reason: 'all_steps_done',
        completed_at: now,
      };
    }

    return { action: 'NO_CHANGE' };
  }
}
