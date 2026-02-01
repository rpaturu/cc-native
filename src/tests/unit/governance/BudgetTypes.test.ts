/**
 * Phase 7.2 — BudgetTypes unit tests.
 * See PHASE_7_2_TEST_PLAN.md §1.
 */

import type {
  CostClass,
  BudgetPeriod,
  BudgetScope,
  BudgetConfig,
  ReserveRequest,
  BudgetServiceResult,
} from '../../../types/governance/BudgetTypes';

describe('BudgetTypes', () => {
  describe('CostClass', () => {
    const costClasses: CostClass[] = ['CHEAP', 'MEDIUM', 'EXPENSIVE'];

    it('includes CHEAP, MEDIUM, EXPENSIVE only', () => {
      expect(costClasses).toHaveLength(3);
      expect(costClasses).toContain('CHEAP');
      expect(costClasses).toContain('MEDIUM');
      expect(costClasses).toContain('EXPENSIVE');
    });
  });

  describe('BudgetPeriod', () => {
    const periods: BudgetPeriod[] = ['DAY', 'MONTH'];

    it('includes DAY and MONTH only', () => {
      expect(periods).toHaveLength(2);
      expect(periods).toContain('DAY');
      expect(periods).toContain('MONTH');
    });
  });

  describe('BudgetScope', () => {
    it('requires tenant_id; account_id, plan_id, tool_id optional', () => {
      const scope: BudgetScope = { tenant_id: 't1' };
      expect(scope.tenant_id).toBe('t1');
      const full: BudgetScope = { tenant_id: 't1', account_id: 'a1', plan_id: 'p1', tool_id: 'tool1' };
      expect(full.account_id).toBe('a1');
    });
  });

  describe('ReserveRequest', () => {
    it('requires scope, cost_class, period_key, operation_id; amount defaults to 1', () => {
      const req: ReserveRequest = {
        scope: { tenant_id: 't1' },
        cost_class: 'EXPENSIVE',
        period_key: '2026-01-31',
        operation_id: 'op-1',
      };
      expect(req.operation_id).toBe('op-1');
      const withAmount: ReserveRequest = { ...req, amount: 2 };
      expect(withAmount.amount).toBe(2);
    });
  });

  describe('BudgetServiceResult', () => {
    it('has result and optional reason, details', () => {
      const r: BudgetServiceResult = { result: 'ALLOW' };
      expect(r.result).toBe('ALLOW');
      const r2: BudgetServiceResult = {
        result: 'BLOCK',
        reason: 'HARD_CAP_EXCEEDED',
        details: { usage_before: 50, cap_hard: 50 },
      };
      expect(r2.reason).toBe('HARD_CAP_EXCEEDED');
    });
  });
});
