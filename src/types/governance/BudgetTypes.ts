/**
 * Phase 7.2 — Budget and cost class types.
 * See PHASE_7_2_CODE_LEVEL_PLAN.md §1.
 */

export type CostClass = 'CHEAP' | 'MEDIUM' | 'EXPENSIVE';

export interface BudgetScope {
  tenant_id: string;
  account_id?: string;
  plan_id?: string;
  tool_id?: string;
}

export type BudgetPeriod = 'DAY' | 'MONTH';

export interface BudgetConfig {
  scope: BudgetScope;
  period: BudgetPeriod;
  hard_cap: Partial<Record<CostClass, number>>;
  soft_cap?: Partial<Record<CostClass, number>>;
}

export type BudgetServiceResultKind = 'ALLOW' | 'WARN' | 'BLOCK';

export interface BudgetServiceResult {
  result: BudgetServiceResultKind;
  reason?: string;
  details?: Record<string, unknown>;
}

export interface ReserveRequest {
  scope: BudgetScope;
  cost_class: CostClass;
  period_key: string;
  operation_id: string;
  amount?: number;
}

export interface IBudgetUsageStore {
  getUsage(scope: BudgetScope, period_key: string): Promise<Record<CostClass, number>>;
  reserve(
    scope: BudgetScope,
    period_key: string,
    cost_class: CostClass,
    amount: number,
    hard_cap: number
  ): Promise<{ success: boolean; usage_after?: number }>;
  getStoredOutcome(
    scope: BudgetScope,
    period_key: string,
    cost_class: CostClass,
    operation_id: string
  ): Promise<BudgetServiceResult | null>;
  setStoredOutcome(
    scope: BudgetScope,
    period_key: string,
    cost_class: CostClass,
    operation_id: string,
    outcome: BudgetServiceResult
  ): Promise<void>;
}
