/**
 * Phase 6.3 — Plan Orchestrator: APPROVED→ACTIVE, step dispatch via Phase 3/4, state evaluator, per-run bound K.
 * See PHASE_6_3_CODE_LEVEL_PLAN.md §4.
 */

import { RevenuePlanV1, PlanStepStatus, PlanStepV1 } from '../../types/plan/PlanTypes';
import type { PlanStateEvaluatorResult } from '../../types/plan/PlanStateEvaluatorTypes';
import type { PlanTypeConfig } from '../../types/plan/PlanTypeConfig';
import { PlanRepositoryService } from './PlanRepositoryService';
import { PlanLifecycleService } from './PlanLifecycleService';
import { PlanPolicyGateService } from './PlanPolicyGateService';
import { PlanLedgerService } from './PlanLedgerService';
import { PlanStateEvaluatorService } from './PlanStateEvaluatorService';
import { PlanStepExecutionStateService } from './PlanStepExecutionStateService';
import type { IPlanStepToActionIntentAdapter } from './PlanStepToActionIntentAdapter';
import { Logger } from '../core/Logger';

const TERMINAL_STEP_STATUSES: PlanStepStatus[] = ['DONE', 'FAILED', 'SKIPPED'];
const DEFAULT_MAX_PLANS_PER_RUN = 10;
const DEFAULT_MAX_RETRIES_PER_STEP = 3;

export interface PlanOrchestratorServiceConfig {
  planRepository: PlanRepositoryService;
  planLifecycle: PlanLifecycleService;
  planPolicyGate: PlanPolicyGateService;
  planLedger: PlanLedgerService;
  planStateEvaluator: PlanStateEvaluatorService;
  stepExecutionState: PlanStepExecutionStateService;
  createIntentFromPlanStep: IPlanStepToActionIntentAdapter;
  getPlanTypeConfig: (planType: string) => PlanTypeConfig | null;
  logger: Logger;
  maxPlansPerRun?: number;
}

export interface RunCycleResult {
  activated: number;
  stepsStarted: number;
  completed: number;
  expired: number;
}

export type StepOutcome = 'DONE' | 'FAILED' | 'SKIPPED';

export class PlanOrchestratorService {
  private repo: PlanRepositoryService;
  private lifecycle: PlanLifecycleService;
  private gate: PlanPolicyGateService;
  private ledger: PlanLedgerService;
  private evaluator: PlanStateEvaluatorService;
  private stepState: PlanStepExecutionStateService;
  private createIntent: IPlanStepToActionIntentAdapter;
  private getPlanTypeConfig: (planType: string) => PlanTypeConfig | null;
  private logger: Logger;
  private maxPlansPerRun: number;

  constructor(config: PlanOrchestratorServiceConfig) {
    this.repo = config.planRepository;
    this.lifecycle = config.planLifecycle;
    this.gate = config.planPolicyGate;
    this.ledger = config.planLedger;
    this.evaluator = config.planStateEvaluator;
    this.stepState = config.stepExecutionState;
    this.createIntent = config.createIntentFromPlanStep;
    this.getPlanTypeConfig = config.getPlanTypeConfig;
    this.logger = config.logger;
    this.maxPlansPerRun = config.maxPlansPerRun ?? DEFAULT_MAX_PLANS_PER_RUN;
  }

  /**
   * Run one orchestration cycle: activate APPROVED (limit K), then advance ACTIVE (limit K) — start next PENDING step.
   */
  async runCycle(tenantId: string): Promise<RunCycleResult> {
    const result: RunCycleResult = {
      activated: 0,
      stepsStarted: 0,
      completed: 0,
      expired: 0,
    };

    const approved = await this.repo.listPlansByTenantAndStatus(
      tenantId,
      'APPROVED',
      this.maxPlansPerRun
    );
    for (const plan of approved) {
      const existing_active_plan_ids = await this.repo.listActivePlansForAccountAndType(
        tenantId,
        plan.account_id,
        plan.plan_type
      );
      const can = await this.gate.evaluateCanActivate({
        plan,
        tenant_id: tenantId,
        account_id: plan.account_id,
        existing_active_plan_ids,
        preconditions_met: true,
      });
      if (can.can_activate) {
        await this.lifecycle.transition(plan, 'ACTIVE');
        result.activated++;
      } else {
        const hasConflict = can.reasons.some((r) => r.code === 'CONFLICT_ACTIVE_PLAN');
        if (hasConflict) {
          const conflicting_plan_ids = existing_active_plan_ids
            .filter((id) => id !== plan.plan_id)
            .sort((a, b) => a.localeCompare(b));
          await this.ledger.append({
            plan_id: plan.plan_id,
            tenant_id: plan.tenant_id,
            account_id: plan.account_id,
            event_type: 'PLAN_ACTIVATION_REJECTED',
            data: {
              plan_type: plan.plan_type,
              conflicting_plan_ids,
              caller: 'orchestrator',
              reason_code: 'CONFLICT_ACTIVE_PLAN',
            },
          });
        }
      }
    }

    const active = await this.repo.listPlansByTenantAndStatus(
      tenantId,
      'ACTIVE',
      this.maxPlansPerRun
    );
    for (const plan of active) {
      const next = this.getNextPendingStep(plan);
      if (!next) {
        const evalResult = await this.evaluator.evaluate({ plan });
        if (evalResult.action === 'COMPLETE') {
          await this.lifecycle.transition(plan, 'COMPLETED', {
            completed_at: evalResult.completed_at,
            completion_reason: evalResult.completion_reason,
          });
          result.completed++;
        } else if (evalResult.action === 'EXPIRE') {
          await this.lifecycle.transition(plan, 'EXPIRED', {
            expired_at: evalResult.expired_at,
          });
          result.expired++;
        }
        continue;
      }

      const typeConfig = this.getPlanTypeConfig(plan.plan_type);
      const maxRetries =
        typeConfig?.max_retries_per_step ?? DEFAULT_MAX_RETRIES_PER_STEP;
      const nextAttempt =
        await this.stepState.getCurrentNextAttempt(plan.plan_id, next.step_id);
      if (nextAttempt >= maxRetries) {
        await this.failStepAndPausePlan(
          plan,
          next.step_id,
          'retry_limit_exceeded'
        );
        continue;
      }

      const attempt = await this.stepState.reserveNextAttempt(
        plan.plan_id,
        next.step_id
      );
      const recorded = await this.stepState.recordStepStarted(
        plan.plan_id,
        next.step_id,
        attempt
      );
      if (!recorded.claimed) continue;

      const traceId = `plan_${plan.plan_id}_${next.step_id}_${attempt}_${Date.now()}`;
      await this.createIntent.createIntentFromPlanStep({
        tenant_id: plan.tenant_id,
        account_id: plan.account_id,
        plan_id: plan.plan_id,
        step_id: next.step_id,
        attempt,
        step: next,
        trace_id: traceId,
      });
      await this.ledger.append({
        plan_id: plan.plan_id,
        tenant_id: plan.tenant_id,
        account_id: plan.account_id,
        event_type: 'STEP_STARTED',
        data: {
          plan_id: plan.plan_id,
          step_id: next.step_id,
          action_type: next.action_type,
          attempt,
        },
      });
      result.stepsStarted++;
    }

    return result;
  }

  /**
   * Apply step outcome when Phase 4 reports result. Updates step status, ledger, state evaluator, plan transition.
   */
  async applyStepOutcome(
    tenantId: string,
    accountId: string,
    planId: string,
    stepId: string,
    attempt: number,
    outcome: StepOutcome,
    options?: { outcome_id?: string; error_message?: string }
  ): Promise<void> {
    const plan = await this.repo.getPlan(tenantId, accountId, planId);
    if (!plan) throw new Error(`Plan not found: ${planId}`);
    if (plan.plan_status !== 'ACTIVE' && plan.plan_status !== 'PAUSED') return;

    const completedAt = new Date().toISOString();
    const execStatus =
      outcome === 'DONE'
        ? 'SUCCEEDED'
        : outcome === 'FAILED'
          ? 'FAILED'
          : 'SKIPPED';
    await this.stepState.updateStepOutcome(
      planId,
      stepId,
      attempt,
      execStatus,
      {
        completed_at: completedAt,
        outcome_id: options?.outcome_id,
        error_message: options?.error_message,
      }
    );

    const planStepStatus: PlanStepStatus =
      outcome === 'DONE' ? 'DONE' : outcome === 'FAILED' ? 'FAILED' : 'SKIPPED';
    await this.repo.updateStepStatus(
      tenantId,
      accountId,
      planId,
      stepId,
      planStepStatus
    );

    const eventType =
      outcome === 'DONE'
        ? 'STEP_COMPLETED'
        : outcome === 'FAILED'
          ? 'STEP_FAILED'
          : 'STEP_SKIPPED';
    await this.ledger.append({
      plan_id: planId,
      tenant_id: tenantId,
      account_id: accountId,
      event_type: eventType,
      data: {
        plan_id: planId,
        step_id: stepId,
        attempt,
        ...(outcome === 'FAILED' && { reason: options?.error_message ?? 'failed' }),
        ...(outcome === 'SKIPPED' && { reason: options?.error_message ?? 'skipped' }),
        ...(options?.outcome_id && { outcome_id: options.outcome_id }),
      },
    });

    const updated = await this.repo.getPlan(tenantId, accountId, planId);
    if (!updated) return;
    const evalResult = await this.evaluator.evaluate({ plan: updated });
    if (evalResult.action === 'COMPLETE') {
      await this.lifecycle.transition(updated, 'COMPLETED', {
        completed_at: evalResult.completed_at,
        completion_reason: evalResult.completion_reason,
      });
    } else if (evalResult.action === 'EXPIRE') {
      await this.lifecycle.transition(updated, 'EXPIRED', {
        expired_at: evalResult.expired_at,
      });
    }
  }

  private getNextPendingStep(plan: RevenuePlanV1): PlanStepV1 | null {
    const steps = plan.steps ?? [];
    const byId = new Map(steps.map((s) => [s.step_id, s]));
    const ordered = [...steps].sort(
      (a, b) => (a.sequence ?? 999) - (b.sequence ?? 999)
    );
    for (const step of ordered) {
      if (step.status !== 'PENDING') continue;
      const deps = step.dependencies ?? [];
      const depsSatisfied = deps.every((depId) => {
        const dep = byId.get(depId);
        return dep && (dep.status === 'DONE' || dep.status === 'SKIPPED');
      });
      if (depsSatisfied) return step;
    }
    return null;
  }

  /**
   * Phase 6.5 — Uses repo.listActivePlansForAccountAndType (canonical conflict lookup).
   */
  private async getActivePlanIdsForAccount(
    tenantId: string,
    accountId: string,
    planType: string
  ): Promise<string[]> {
    return this.repo.listActivePlansForAccountAndType(tenantId, accountId, planType);
  }

  private async failStepAndPausePlan(
    plan: RevenuePlanV1,
    stepId: string,
    reason: string
  ): Promise<void> {
    const nextAttempt = await this.stepState.getCurrentNextAttempt(
      plan.plan_id,
      stepId
    );
    await this.repo.updateStepStatus(
      plan.tenant_id,
      plan.account_id,
      plan.plan_id,
      stepId,
      'FAILED'
    );
    await this.ledger.append({
      plan_id: plan.plan_id,
      tenant_id: plan.tenant_id,
      account_id: plan.account_id,
      event_type: 'STEP_FAILED',
      data: {
        plan_id: plan.plan_id,
        step_id: stepId,
        reason,
        attempt: nextAttempt,
      },
    });
    await this.lifecycle.transition(plan, 'PAUSED', { reason });
  }
}
