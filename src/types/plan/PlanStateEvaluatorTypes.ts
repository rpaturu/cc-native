/**
 * Phase 6.3 — Plan State Evaluator: result and input types.
 * Orchestrator calls evaluator; completion/expiry logic lives only here.
 * See PHASE_6_3_CODE_LEVEL_PLAN.md §1.
 */

import type { RevenuePlanV1 } from './PlanTypes';

export type PlanStateEvaluatorResult =
  | {
      action: 'COMPLETE';
      completion_reason: 'objective_met' | 'all_steps_done';
      completed_at: string;
    }
  | { action: 'EXPIRE'; expired_at: string }
  | { action: 'NO_CHANGE' };

export interface PlanStateEvaluatorInput {
  plan: RevenuePlanV1;
  /** Optional: for objective_met evaluation (e.g. renewal closed); 6.3 may use plan-only. */
  context?: Record<string, unknown>;
}
