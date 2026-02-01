/**
 * Phase 7.2 — Budget config (getBudgetConfigs, applicable, effective caps) unit tests.
 * See PHASE_7_2_TEST_PLAN.md §2.
 */

import {
  getBudgetConfigs,
  setBudgetConfigs,
  configApplies,
  effectiveHardCap,
  effectiveSoftCap,
} from '../../../config/budgetConfig';
import type { BudgetScope, BudgetConfig, CostClass } from '../../../types/governance/BudgetTypes';

function scope(overrides: Partial<BudgetScope> = {}): BudgetScope {
  return { tenant_id: 't1', ...overrides };
}

describe('BudgetConfig', () => {
  beforeEach(() => {
    setBudgetConfigs([
      { scope: { tenant_id: '*' }, period: 'DAY', hard_cap: { EXPENSIVE: 50, MEDIUM: 200 }, soft_cap: { EXPENSIVE: 40 } },
      { scope: { tenant_id: 't1', account_id: 'a1' }, period: 'DAY', hard_cap: { EXPENSIVE: 30 }, soft_cap: { EXPENSIVE: 25 } },
    ]);
  });

  describe('configApplies', () => {
    it('config with tenant_id * applies to any request tenant', () => {
      expect(configApplies({ tenant_id: '*' }, scope())).toBe(true);
      expect(configApplies({ tenant_id: '*' }, scope({ tenant_id: 't2' }))).toBe(true);
    });

    it('config with tenant_id and account_id applies when request has same or superset', () => {
      expect(configApplies({ tenant_id: 't1', account_id: 'a1' }, scope({ account_id: 'a1', plan_id: 'p1' }))).toBe(true);
    });

    it('config does not apply when account_id differs', () => {
      expect(configApplies({ tenant_id: 't1', account_id: 'a1' }, scope({ account_id: 'a2' }))).toBe(false);
    });
  });

  describe('getBudgetConfigs', () => {
    it('returns applicable configs ordered most-specific first', () => {
      const configs = getBudgetConfigs(scope({ account_id: 'a1' }), 'DAY');
      expect(configs.length).toBeGreaterThanOrEqual(1);
      const first = configs[0];
      expect(first.scope.tenant_id).toBe('t1');
      expect(first.scope.account_id).toBe('a1');
    });

    it('returns empty when no config applies for period', () => {
      setBudgetConfigs([{ scope: { tenant_id: 't1' }, period: 'DAY', hard_cap: { EXPENSIVE: 50 } }]);
      const configs = getBudgetConfigs(scope({ tenant_id: 't2' }), 'DAY');
      expect(configs).toHaveLength(0);
    });
  });

  describe('effectiveHardCap / effectiveSoftCap', () => {
    it('returns minimum of applicable hard_caps for cost class', () => {
      const configs: BudgetConfig[] = [
        { scope: { tenant_id: 't1' }, period: 'DAY', hard_cap: { EXPENSIVE: 50 } },
        { scope: { tenant_id: 't1' }, period: 'DAY', hard_cap: { EXPENSIVE: 30 } },
      ];
      expect(effectiveHardCap(configs, 'EXPENSIVE')).toBe(30);
    });

    it('returns minimum of applicable soft_caps', () => {
      const configs: BudgetConfig[] = [
        { scope: { tenant_id: 't1' }, period: 'DAY', hard_cap: {}, soft_cap: { EXPENSIVE: 40 } },
        { scope: { tenant_id: 't1' }, period: 'DAY', hard_cap: {}, soft_cap: { EXPENSIVE: 25 } },
      ];
      expect(effectiveSoftCap(configs, 'EXPENSIVE')).toBe(25);
    });

    it('returns Infinity when no hard_cap for cost class', () => {
      const configs: BudgetConfig[] = [{ scope: { tenant_id: 't1' }, period: 'DAY', hard_cap: {} }];
      expect(effectiveHardCap(configs, 'EXPENSIVE')).toBe(Infinity);
    });
  });
});
