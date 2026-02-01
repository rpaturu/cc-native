/**
 * Phase 7.2 — Budget config (Option A: config file). Applicable config matching.
 * See PHASE_7_2_CODE_LEVEL_PLAN.md §2.
 */

import type { BudgetConfig, BudgetScope, BudgetPeriod, CostClass } from '../types/governance/BudgetTypes';

/** Config applies if every non-null scope field in config matches request scope (request may have superset). */
export function configApplies(configScope: BudgetScope, requestScope: BudgetScope): boolean {
  if (configScope.tenant_id !== '*' && configScope.tenant_id !== requestScope.tenant_id) return false;
  if (configScope.account_id != null && configScope.account_id !== requestScope.account_id) return false;
  if (configScope.plan_id != null && configScope.plan_id !== requestScope.plan_id) return false;
  if (configScope.tool_id != null && configScope.tool_id !== requestScope.tool_id) return false;
  return true;
}

/** Specificity: more non-null scope fields = more specific. */
function specificity(scope: BudgetScope): number {
  let n = 0;
  if (scope.tenant_id) n += 1;
  if (scope.account_id) n += 2;
  if (scope.plan_id) n += 4;
  if (scope.tool_id) n += 8;
  return n;
}

const DEFAULT_CONFIGS: BudgetConfig[] = [
  {
    scope: { tenant_id: '*' },
    period: 'DAY',
    hard_cap: { EXPENSIVE: 50, MEDIUM: 200, CHEAP: 1000 },
    soft_cap: { EXPENSIVE: 40 },
  },
];

let configs: BudgetConfig[] = [...DEFAULT_CONFIGS];

export function getBudgetConfigs(scope: BudgetScope, period: BudgetPeriod): BudgetConfig[] {
  const applicable = configs.filter(
    (c) => c.period === period && configApplies(c.scope, scope)
  );
  applicable.sort((a, b) => specificity(b.scope) - specificity(a.scope));
  return applicable;
}

export function setBudgetConfigs(entries: BudgetConfig[]): void {
  configs = entries?.length ? entries : [...DEFAULT_CONFIGS];
}

/** Effective hard cap = min of all applicable hard_cap[cost_class]. */
export function effectiveHardCap(configs: BudgetConfig[], costClass: CostClass): number {
  const values = configs
    .map((c) => c.hard_cap[costClass])
    .filter((n): n is number => n != null && n >= 0);
  if (!values.length) return Infinity;
  return Math.min(...values);
}

/** Effective soft cap = min of all applicable soft_cap[cost_class], or undefined if none. */
export function effectiveSoftCap(configs: BudgetConfig[], costClass: CostClass): number | undefined {
  const values = configs
    .map((c) => c.soft_cap?.[costClass])
    .filter((n): n is number => n != null && n >= 0);
  if (!values.length) return undefined;
  return Math.min(...values);
}
