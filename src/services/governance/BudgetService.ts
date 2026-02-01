/**
 * Phase 7.2 — BudgetService: reserve-before-execute, BLOCK/WARN/ALLOW, ledger all decisions.
 * See PHASE_7_2_CODE_LEVEL_PLAN.md §4.
 */

import type {
  ReserveRequest,
  BudgetServiceResult,
  BudgetServiceResultKind,
  BudgetScope,
} from '../../types/governance/BudgetTypes';
import type { IBudgetUsageStore } from '../../types/governance/BudgetTypes';
import {
  getBudgetConfigs,
  effectiveHardCap,
  effectiveSoftCap,
} from '../../config/budgetConfig';
import { PlanLedgerService } from '../plan/PlanLedgerService';
import { Logger } from '../core/Logger';

export interface BudgetServiceConfig {
  usageStore: IBudgetUsageStore;
  planLedger: PlanLedgerService;
  logger: Logger;
  /** Plan ID and account_id for ledger entries when not in request scope. */
  defaultPlanId?: string;
  defaultAccountId?: string;
}

export class BudgetService {
  private usageStore: IBudgetUsageStore;
  private planLedger: PlanLedgerService;
  private logger: Logger;
  private defaultPlanId: string;
  private defaultAccountId: string;

  constructor(config: BudgetServiceConfig) {
    this.usageStore = config.usageStore;
    this.planLedger = config.planLedger;
    this.logger = config.logger;
    this.defaultPlanId = config.defaultPlanId ?? '_budget';
    this.defaultAccountId = config.defaultAccountId ?? '';
  }

  async reserve(request: ReserveRequest): Promise<BudgetServiceResult> {
    const { scope, period_key, cost_class, operation_id, amount = 1 } = request;
    const period = period_key.length === 7 ? 'MONTH' : 'DAY';
    const configs = getBudgetConfigs(scope, period);
    if (!configs.length) {
      return {
        result: 'BLOCK',
        reason: 'NO_APPLICABLE_CONFIG',
        details: { scope, cost_class, cap_hard: undefined, usage_before: 0, matched_configs: [] },
      };
    }

    const stored = await this.usageStore.getStoredOutcome(scope, period_key, cost_class, operation_id);
    if (stored) return stored;

    const cap_hard = effectiveHardCap(configs, cost_class);
    const cap_soft = effectiveSoftCap(configs, cost_class);
    const usage_before = (await this.usageStore.getUsage(scope, period_key))[cost_class] ?? 0;

    if (cap_hard === Infinity) {
      const usage_after = usage_before + amount;
      const result: BudgetServiceResult = {
        result: 'ALLOW',
        details: {
          usage_before,
          usage_after,
          cap_hard: undefined,
          cap_soft,
          matched_configs: configs.map((c) => c.scope),
        },
      };
      await this.usageStore.reserve(scope, period_key, cost_class, amount, Infinity);
      await this.usageStore.setStoredOutcome(scope, period_key, cost_class, operation_id, result);
      await this.appendLedger('BUDGET_RESERVE', scope, period_key, cost_class, result, amount);
      return result;
    }

    const { success, usage_after: ua } = await this.usageStore.reserve(
      scope,
      period_key,
      cost_class,
      amount,
      cap_hard
    );

    if (!success) {
      const result: BudgetServiceResult = {
        result: 'BLOCK',
        reason: 'HARD_CAP_EXCEEDED',
        details: {
          usage_before,
          cap_hard,
          matched_configs: configs.map((c) => c.scope),
        },
      };
      await this.usageStore.setStoredOutcome(scope, period_key, cost_class, operation_id, result);
      await this.appendLedger('BUDGET_BLOCK', scope, period_key, cost_class, result);
      return result;
    }

    const usage_after = ua ?? usage_before + amount;
    let aggregate: BudgetServiceResultKind = 'ALLOW';
    let reason: string | undefined;
    if (cap_soft != null && usage_after > cap_soft) {
      aggregate = 'WARN';
      reason = 'SOFT_CAP_EXCEEDED';
    }

    const result: BudgetServiceResult = {
      result: aggregate,
      reason,
      details: {
        usage_before,
        usage_after,
        cap_hard,
        cap_soft,
        matched_configs: configs.map((c) => c.scope),
      },
    };
    await this.usageStore.setStoredOutcome(scope, period_key, cost_class, operation_id, result);
    if (aggregate === 'WARN') {
      await this.appendLedger('BUDGET_WARN', scope, period_key, cost_class, result, amount);
    } else {
      await this.appendLedger('BUDGET_RESERVE', scope, period_key, cost_class, result, amount);
    }
    return result;
  }

  private async appendLedger(
    eventType: 'BUDGET_RESERVE' | 'BUDGET_BLOCK' | 'BUDGET_WARN',
    scope: BudgetScope,
    period_key: string,
    cost_class: string,
    result: BudgetServiceResult,
    amount?: number
  ): Promise<void> {
    const planId = scope.plan_id ?? this.defaultPlanId;
    const accountId = scope.account_id ?? this.defaultAccountId;
    try {
      await this.planLedger.append({
        plan_id: planId,
        tenant_id: scope.tenant_id,
        account_id: accountId,
        event_type: eventType,
        data: {
          scope,
          period_key,
          cost_class,
          amount,
          result: result.result,
          reason: result.reason,
          ...result.details,
        },
      });
    } catch (err) {
      this.logger.warn('BudgetService: ledger append failed', { eventType, error: err });
    }
  }
}
