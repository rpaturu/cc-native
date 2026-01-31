/**
 * Phase 6.3 — Adapter: create action intent from plan step (Phase 3/4 path only).
 * Orchestrator uses this to create intents; execution is Phase 4 (existing flow).
 * See PHASE_6_3_CODE_LEVEL_PLAN.md §4.
 */

import type { PlanStepV1 } from '../../types/plan/PlanTypes';
import type { ActionProposalV1, ActionIntentV1 } from '../../types/DecisionTypes';
import { ActionIntentService } from '../decision/ActionIntentService';

const PLAN_ORCHESTRATOR_APPROVER = 'plan-orchestrator';

export interface PlanStepToActionIntentAdapterInput {
  tenant_id: string;
  account_id: string;
  plan_id: string;
  step_id: string;
  attempt: number;
  step: PlanStepV1;
  trace_id: string;
}

export interface IPlanStepToActionIntentAdapter {
  createIntentFromPlanStep(
    input: PlanStepToActionIntentAdapterInput
  ): Promise<ActionIntentV1>;
}

function buildProposal(
  input: PlanStepToActionIntentAdapterInput
): ActionProposalV1 {
  const { tenant_id, account_id, plan_id, step_id, attempt, step, trace_id } =
    input;
  const action_ref = `${plan_id}#${step_id}#${attempt}`;
  return {
    action_type: step.action_type as ActionProposalV1['action_type'],
    why: ['PLAN_STEP'],
    confidence: 1,
    risk_level: 'MEDIUM',
    llm_suggests_human_review: false,
    blocking_unknowns: [],
    parameters: (step.constraints as Record<string, unknown>) ?? {},
    target: { entity_type: 'ACCOUNT', entity_id: account_id },
    action_ref,
  };
}

export class PlanStepToActionIntentAdapter implements IPlanStepToActionIntentAdapter {
  constructor(private actionIntentService: ActionIntentService) {}

  async createIntentFromPlanStep(
    input: PlanStepToActionIntentAdapterInput
  ): Promise<ActionIntentV1> {
    const proposal = buildProposal(input);
    const decisionId = `${input.plan_id}#${input.step_id}#${input.attempt}`;
    return this.actionIntentService.createIntent(
      proposal,
      decisionId,
      PLAN_ORCHESTRATOR_APPROVER,
      input.tenant_id,
      input.account_id,
      input.trace_id
    );
  }
}
