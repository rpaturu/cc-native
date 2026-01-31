/**
 * Phase 6.1 — Plan Policy Gate: validation only; can_activate + reasons taxonomy.
 * Deterministic: same input → same output. Does not read from DB.
 * See PHASE_6_1_CODE_LEVEL_PLAN.md §5 PlanPolicyGateService.
 */

import { RevenuePlanV1 } from '../../types/plan/PlanTypes';
import {
  PlanPolicyGateInput,
  PlanPolicyGateResult,
  PlanPolicyGateReason,
  PlanPolicyGateReasonCode,
} from '../../types/plan/PlanPolicyGateTypes';

export interface PlanPolicyGateServiceConfig {
  /** Allowed plan types for tenant (default ['RENEWAL_DEFENSE']) */
  allowedPlanTypes?: string[];
  /** If true, treat plans with high-risk step as requiring elevated authority (stub) */
  requireElevatedForHighRisk?: boolean;
  /** If true, human-touch required not satisfied (stub) */
  humanTouchRequired?: boolean;
}

const DEFAULT_ALLOWED_PLAN_TYPES = ['RENEWAL_DEFENSE'];

function reason(code: PlanPolicyGateReasonCode, message: string): PlanPolicyGateReason {
  return { code, message };
}

export class PlanPolicyGateService {
  private config: PlanPolicyGateServiceConfig;

  constructor(config: PlanPolicyGateServiceConfig = {}) {
    this.config = config;
  }

  async validateForApproval(
    plan: RevenuePlanV1,
    _tenantId: string
  ): Promise<{ valid: boolean; reasons: PlanPolicyGateReason[] }> {
    const reasons: PlanPolicyGateReason[] = [];
    const allowed = this.config.allowedPlanTypes ?? DEFAULT_ALLOWED_PLAN_TYPES;
    if (!allowed.includes(plan.plan_type)) {
      reasons.push(
        reason('INVALID_PLAN_TYPE', `Plan type ${plan.plan_type} is not allowed for this tenant.`)
      );
    }
    const stepViolation = this.checkStepOrder(plan);
    if (stepViolation) reasons.push(stepViolation);
    if (this.config.requireElevatedForHighRisk && this.hasHighRiskStep(plan)) {
      reasons.push(
        reason('RISK_ELEVATED', 'Plan has high-risk step; elevated authority required.')
      );
    }
    if (this.config.humanTouchRequired) {
      reasons.push(
        reason('HUMAN_TOUCH_REQUIRED', 'Human-touch required (e.g. external contact) not satisfied.')
      );
    }
    return { valid: reasons.length === 0, reasons };
  }

  async evaluateCanActivate(input: PlanPolicyGateInput): Promise<PlanPolicyGateResult> {
    const reasons: PlanPolicyGateReason[] = [];
    const { plan, existing_active_plan_ids = [], preconditions_met } = input;
    if (typeof preconditions_met !== 'boolean') {
      reasons.push(
        reason('PRECONDITIONS_UNMET', 'preconditions_met is required and must be a boolean.')
      );
    } else if (!preconditions_met) {
      reasons.push(
        reason('PRECONDITIONS_UNMET', 'Required approvals, dependencies, or data not met.')
      );
    }
    const otherActive = (existing_active_plan_ids || []).filter(
      (id) => id !== plan.plan_id
    );
    if (otherActive.length > 0) {
      reasons.push(
        reason(
          'CONFLICT_ACTIVE_PLAN',
          `Another ACTIVE plan exists for same account and plan type: ${otherActive.join(', ')}.`
        )
      );
    }
    const allowed = this.config.allowedPlanTypes ?? DEFAULT_ALLOWED_PLAN_TYPES;
    if (!allowed.includes(plan.plan_type)) {
      reasons.push(
        reason('INVALID_PLAN_TYPE', `Plan type ${plan.plan_type} is not allowed.`)
      );
    }
    return { can_activate: reasons.length === 0, reasons };
  }

  private checkStepOrder(plan: RevenuePlanV1): PlanPolicyGateReason | null {
    const stepIds = new Set((plan.steps || []).map((s) => s.step_id));
    for (const step of plan.steps || []) {
      for (const dep of step.dependencies || []) {
        if (!stepIds.has(dep)) {
          return reason(
            'STEP_ORDER_VIOLATION',
            `Step ${step.step_id} depends on missing step ${dep}.`
          );
        }
      }
    }
    return null;
  }

  private hasHighRiskStep(plan: RevenuePlanV1): boolean {
    const highRiskActions = ['REQUEST_RENEWAL_MEETING', 'EXECUTE_CONTRACT'];
    return (plan.steps || []).some((s) =>
      highRiskActions.includes(s.action_type || '')
    );
  }
}
