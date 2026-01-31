/**
 * Phase 6.1 — Plan lifecycle: valid transitions only; updates repo + ledger.
 * Policy Gate is called by API/orchestrator before requesting transition.
 * See PHASE_6_1_CODE_LEVEL_PLAN.md §5 PlanLifecycleService.
 */

import { RevenuePlanV1, PlanStatus } from '../../types/plan/PlanTypes';
import { PlanLedgerEventType } from '../../types/plan/PlanLedgerTypes';
import { PlanRepositoryService } from './PlanRepositoryService';
import { PlanLedgerService } from './PlanLedgerService';
import { Logger } from '../core/Logger';

const ALLOWED: Record<PlanStatus, PlanStatus[]> = {
  DRAFT: ['APPROVED'],
  APPROVED: ['ACTIVE', 'ABORTED'],
  ACTIVE: ['PAUSED', 'COMPLETED', 'ABORTED', 'EXPIRED'],
  PAUSED: ['ACTIVE', 'ABORTED'],
  COMPLETED: [],
  ABORTED: [],
  EXPIRED: [],
};

const LEDGER_EVENT: Record<string, PlanLedgerEventType> = {
  APPROVED: 'PLAN_APPROVED',
  ACTIVE: 'PLAN_ACTIVATED',
  PAUSED: 'PLAN_PAUSED',
  COMPLETED: 'PLAN_COMPLETED',
  ABORTED: 'PLAN_ABORTED',
  EXPIRED: 'PLAN_EXPIRED',
};

/** PAUSED→ACTIVE emits PLAN_RESUMED */
function ledgerEventForTransition(from: PlanStatus, to: PlanStatus): PlanLedgerEventType {
  if (from === 'PAUSED' && to === 'ACTIVE') return 'PLAN_RESUMED';
  return LEDGER_EVENT[to] ?? 'PLAN_ABORTED';
}

export interface PlanLifecycleServiceConfig {
  planRepository: PlanRepositoryService;
  planLedger: PlanLedgerService;
  logger: Logger;
}

export class PlanLifecycleService {
  private repo: PlanRepositoryService;
  private ledger: PlanLedgerService;
  private logger: Logger;

  constructor(config: PlanLifecycleServiceConfig) {
    this.repo = config.planRepository;
    this.ledger = config.planLedger;
    this.logger = config.logger;
  }

  async transition(
    plan: RevenuePlanV1,
    toStatus: PlanStatus,
    options?: {
      reason?: string;
      completed_at?: string;
      aborted_at?: string;
      expired_at?: string;
      completion_reason?: 'objective_met' | 'all_steps_done';
    }
  ): Promise<void> {
    if (toStatus == null) {
      throw new Error('PlanLifecycleService.transition: toStatus is required.');
    }
    const from = plan.plan_status;
    if (from === toStatus) {
      throw new Error(`PlanLifecycleService.transition: same status (${from}) is not a valid transition.`);
    }
    const allowed = ALLOWED[from];
    if (!allowed?.includes(toStatus)) {
      throw new Error(
        `PlanLifecycleService.transition: invalid transition ${from} → ${toStatus}.`
      );
    }
    const now = new Date().toISOString();
    const updateOpts = {
      ...(toStatus === 'COMPLETED' && {
        completed_at: options?.completed_at ?? now,
        completion_reason: options?.completion_reason,
      }),
      ...(toStatus === 'ABORTED' && {
        aborted_at: options?.aborted_at ?? now,
      }),
      ...(toStatus === 'EXPIRED' && {
        expired_at: options?.expired_at ?? now,
      }),
    };
    await this.repo.updatePlanStatus(
      plan.tenant_id,
      plan.account_id,
      plan.plan_id,
      toStatus,
      updateOpts
    );
    const eventType = ledgerEventForTransition(from, toStatus);
    const data: Record<string, unknown> = {
      plan_id: plan.plan_id,
      ...(options?.reason != null && { reason: options.reason }),
      ...(options?.completed_at != null && { completed_at: options.completed_at }),
      ...(options?.completion_reason != null && { completion_reason: options.completion_reason }),
      ...(options?.aborted_at != null && { aborted_at: options.aborted_at }),
      ...(options?.expired_at != null && { expired_at: options.expired_at }),
    };
    if (toStatus === 'ABORTED' && (options?.reason ?? options?.aborted_at)) {
      data.reason = options?.reason;
      data.aborted_at = options?.aborted_at ?? now;
    }
    await this.ledger.append({
      plan_id: plan.plan_id,
      tenant_id: plan.tenant_id,
      account_id: plan.account_id,
      event_type: eventType,
      data,
    });
    this.logger.info('Plan transition completed', {
      plan_id: plan.plan_id,
      from,
      to: toStatus,
      event_type: eventType,
    });
  }
}
