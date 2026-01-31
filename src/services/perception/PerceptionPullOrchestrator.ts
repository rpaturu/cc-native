/**
 * Perception Pull Orchestrator - Phase 5.3
 *
 * Order: (1) rate-limit eligibility, (2) reserve idempotency key, (3) atomic consume budget,
 * (4) emit job. At-most-once; use DUPLICATE_PULL_JOB_ID for idempotency hits.
 */

import {
  DEPTH_UNITS,
  DUPLICATE_PULL_JOB_ID,
  PerceptionPullJobV1,
  PullDepth,
} from '../../types/perception/PerceptionSchedulerTypes';
import { HeatTierPolicyService } from './HeatTierPolicyService';
import { PerceptionPullBudgetService } from './PerceptionPullBudgetService';
import { PullIdempotencyStoreService } from './PullIdempotencyStoreService';
import { Logger } from '../core/Logger';

export interface SchedulePullInput {
  tenantId: string;
  accountId: string;
  connectorId: string;
  pullJobId: string; // derived from tenant/account/connector/depth/time-bucket
  depth: PullDepth;
  correlationId?: string;
}

export interface SchedulePullResult {
  scheduled: boolean;
  job?: PerceptionPullJobV1;
  reason?: string; // DUPLICATE_PULL_JOB_ID, BUDGET_EXCEEDED, RATE_LIMIT
}

export type RateLimitCheck = (
  tenantId: string,
  connectorId: string
) => Promise<boolean>;

export interface PerceptionPullOrchestratorConfig {
  perceptionPullBudgetService: PerceptionPullBudgetService;
  pullIdempotencyStoreService: PullIdempotencyStoreService;
  heatTierPolicyService: HeatTierPolicyService;
  /** Optional. Default: always eligible. */
  rateLimitCheck?: RateLimitCheck;
  logger: Logger;
}

export class PerceptionPullOrchestrator {
  private budgetService: PerceptionPullBudgetService;
  private idempotencyService: PullIdempotencyStoreService;
  private heatTierPolicyService: HeatTierPolicyService;
  private rateLimitCheck: RateLimitCheck;
  private logger: Logger;

  constructor(config: PerceptionPullOrchestratorConfig) {
    this.budgetService = config.perceptionPullBudgetService;
    this.idempotencyService = config.pullIdempotencyStoreService;
    this.heatTierPolicyService = config.heatTierPolicyService;
    this.rateLimitCheck =
      config.rateLimitCheck ?? (() => Promise.resolve(true));
    this.logger = config.logger;
  }

  /**
   * Schedule a pull job following orchestrator order. Returns job if scheduled, else reason.
   */
  async schedulePull(input: SchedulePullInput): Promise<SchedulePullResult> {
    const { tenantId, accountId, connectorId, pullJobId, depth, correlationId } =
      input;
    const depthUnits = DEPTH_UNITS[depth];
    const now = new Date().toISOString();

    // (1) Rate limit eligibility (cheap)
    const rateLimitOk = await this.rateLimitCheck(tenantId, connectorId);
    if (!rateLimitOk) {
      this.logger.debug('Rate limit ineligible', { tenantId, connectorId });
      return { scheduled: false, reason: 'RATE_LIMIT' };
    }

    // (2) Reserve idempotency key (dedupe)
    const reserved = await this.idempotencyService.tryReserve(pullJobId);
    if (!reserved) {
      this.logger.debug('Duplicate pull job id', { pullJobId });
      return { scheduled: false, reason: DUPLICATE_PULL_JOB_ID };
    }

    // (3) Atomic consume budget (per-connector then tenant total)
    const consumeResult =
      await this.budgetService.checkAndConsumePullBudget(
        tenantId,
        connectorId,
        depthUnits
      );
    if (!consumeResult.allowed) {
      this.logger.debug('Pull budget exceeded', { tenantId, connectorId });
      return { scheduled: false, reason: 'BUDGET_EXCEEDED' };
    }

    // (4) Emit job (caller invokes connector pull or SFN)
    const job: PerceptionPullJobV1 = {
      pull_job_id: pullJobId,
      tenant_id: tenantId,
      account_id: accountId,
      connector_id: connectorId,
      depth,
      depth_units: depthUnits,
      scheduled_at: now,
      correlation_id: correlationId,
      budget_remaining: consumeResult.remaining,
    };

    this.logger.info('Pull job scheduled', {
      tenantId,
      connectorId,
      depth,
      pullJobId,
    });
    return { scheduled: true, job };
  }
}
