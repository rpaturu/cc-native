/**
 * Phase 7.2 — Budget usage store: reserved_count only, one conditional update per reserve.
 * In-memory impl for 7.2 baseline; replace with DynamoDB conditional update for production.
 * See PHASE_7_2_CODE_LEVEL_PLAN.md §3.
 */

import type { BudgetScope, CostClass, BudgetServiceResult } from '../../types/governance/BudgetTypes';
import type { IBudgetUsageStore } from '../../types/governance/BudgetTypes';

function scopeKey(scope: BudgetScope): string {
  const parts = ['TENANT', scope.tenant_id];
  if (scope.account_id) parts.push('ACCOUNT', scope.account_id);
  if (scope.plan_id) parts.push('PLAN', scope.plan_id);
  if (scope.tool_id) parts.push('TOOL', scope.tool_id);
  return parts.join('#');
}

function opKey(scope: BudgetScope, period_key: string, cost_class: CostClass, operation_id: string): string {
  return `${scopeKey(scope)}#${period_key}#${cost_class}#${operation_id}`;
}

const usageMap = new Map<string, Record<CostClass, number>>();
const outcomeMap = new Map<string, BudgetServiceResult>();

export class BudgetUsageStore implements IBudgetUsageStore {
  async getUsage(scope: BudgetScope, period_key: string): Promise<Record<CostClass, number>> {
    const pk = `${scopeKey(scope)}#${period_key}`;
    const row = usageMap.get(pk);
    return row ?? { CHEAP: 0, MEDIUM: 0, EXPENSIVE: 0 };
  }

  async reserve(
    scope: BudgetScope,
    period_key: string,
    cost_class: CostClass,
    amount: number,
    hard_cap: number
  ): Promise<{ success: boolean; usage_after?: number }> {
    const pk = `${scopeKey(scope)}#${period_key}`;
    const row = usageMap.get(pk) ?? { CHEAP: 0, MEDIUM: 0, EXPENSIVE: 0 };
    const current = row[cost_class] ?? 0;
    const usage_after = current + amount;
    if (usage_after > hard_cap) return { success: false };
    row[cost_class] = usage_after;
    usageMap.set(pk, row);
    return { success: true, usage_after };
  }

  async getStoredOutcome(
    scope: BudgetScope,
    period_key: string,
    cost_class: CostClass,
    operation_id: string
  ): Promise<BudgetServiceResult | null> {
    const key = opKey(scope, period_key, cost_class, operation_id);
    return outcomeMap.get(key) ?? null;
  }

  async setStoredOutcome(
    scope: BudgetScope,
    period_key: string,
    cost_class: CostClass,
    operation_id: string,
    outcome: BudgetServiceResult
  ): Promise<void> {
    const key = opKey(scope, period_key, cost_class, operation_id);
    outcomeMap.set(key, outcome);
  }
}
