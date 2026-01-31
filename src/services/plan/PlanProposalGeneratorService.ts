/**
 * Phase 6.2 — Plan Proposal Generator: bounded output, DRAFT only; cannot auto-approve.
 * Rule-based stub in 6.2; LLM can be added later with same contract.
 * See PHASE_6_2_CODE_LEVEL_PLAN.md §4.
 */

import { v4 as uuidv4 } from 'uuid';
import { RevenuePlanV1, PlanStepV1 } from '../../types/plan/PlanTypes';
import { PlanProposalInput, PlanProposalOutput } from '../../types/plan/PlanProposalTypes';
import { getPlanTypeConfig } from '../../config/planTypeConfig';
import { Logger } from '../core/Logger';

export interface PlanProposalGeneratorServiceConfig {
  /** Optional logger */
  logger?: Logger;
}

export class PlanProposalGeneratorService {
  private logger: Logger;

  constructor(config: PlanProposalGeneratorServiceConfig = {}) {
    this.logger = config.logger ?? new Logger('PlanProposalGenerator');
  }

  /**
   * Generate a DRAFT plan proposal. Output is never auto-approved; caller may persist via putPlan.
   * Sanitizes disallowed step action types (drops them); rejects if no steps remain.
   */
  async generateProposal(input: PlanProposalInput): Promise<PlanProposalOutput> {
    const config = getPlanTypeConfig(input.plan_type);
    if (!config) {
      throw new Error(`Plan type ${input.plan_type} is not supported.`);
    }

    const allowedSteps = new Set(config.allowed_step_action_types);
    const sequence = config.default_sequence ?? config.allowed_step_action_types;
    const suggestedActionTypes = sequence.filter((a) => allowedSteps.has(a));

    const steps: PlanStepV1[] = suggestedActionTypes
      .map((action_type, index) => ({
        step_id: uuidv4(),
        action_type,
        status: 'PENDING' as const,
        sequence: index + 1,
      }))
      .filter((step) => allowedSteps.has(step.action_type));

    if (steps.length === 0) {
      throw new Error(
        `No allowed steps for plan type ${input.plan_type}; proposal rejected.`
      );
    }

    const now = new Date().toISOString();
    const expiresAtDays = config.expires_at_days_from_creation ?? 30;
    const expiresAt = new Date(Date.now() + expiresAtDays * 24 * 60 * 60 * 1000).toISOString();
    const objective =
      config.objective_template ?? `Plan for ${input.account_id}`;

    const plan: RevenuePlanV1 = {
      plan_id: uuidv4(),
      plan_type: input.plan_type,
      account_id: input.account_id,
      tenant_id: input.tenant_id,
      objective,
      plan_status: 'DRAFT',
      steps,
      expires_at: expiresAt,
      created_at: now,
      updated_at: now,
    };

    this.logger.debug('Proposal generated', {
      plan_id: plan.plan_id,
      plan_type: plan.plan_type,
      account_id: plan.account_id,
      tenant_id: plan.tenant_id,
      step_count: plan.steps.length,
    });

    return { plan, proposal_id: plan.plan_id };
  }
}
