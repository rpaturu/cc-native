/**
 * Phase 7.2 — BudgetUsageStore unit tests.
 * See PHASE_7_2_TEST_PLAN.md §3.
 */

import { BudgetUsageStore } from '../../../services/governance/BudgetUsageStore';
import type { BudgetScope, CostClass } from '../../../types/governance/BudgetTypes';

function scope(overrides: Partial<BudgetScope> = {}): BudgetScope {
  return { tenant_id: 't1', ...overrides };
}

describe('BudgetUsageStore', () => {
  let store: BudgetUsageStore;

  beforeEach(() => {
    store = new BudgetUsageStore();
  });

  it('getUsage returns reserved_count per cost class', async () => {
    const usage = await store.getUsage(scope(), '2026-01-31');
    expect(usage.EXPENSIVE).toBe(0);
    expect(usage.MEDIUM).toBe(0);
    expect(usage.CHEAP).toBe(0);
  });

  it('reserve succeeds when usage_after <= hard_cap', async () => {
    const result = await store.reserve(scope(), '2026-01-31', 'EXPENSIVE', 1, 50);
    expect(result.success).toBe(true);
    expect(result.usage_after).toBe(1);
    const usage = await store.getUsage(scope(), '2026-01-31');
    expect(usage.EXPENSIVE).toBe(1);
  });

  it('reserve fails when usage_after > hard_cap', async () => {
    const periodKey = '2026-01-31-cap-fail';
    await store.reserve(scope(), periodKey, 'EXPENSIVE', 50, 50);
    const result = await store.reserve(scope(), periodKey, 'EXPENSIVE', 1, 50);
    expect(result.success).toBe(false);
    const usage = await store.getUsage(scope(), periodKey);
    expect(usage.EXPENSIVE).toBe(50);
  });

  it('period_key isolation: different period_key has separate usage', async () => {
    await store.reserve(scope(), '2026-01-31', 'EXPENSIVE', 10, 50);
    const usageOther = await store.getUsage(scope(), '2026-01-30');
    expect(usageOther.EXPENSIVE).toBe(0);
  });

  it('getStoredOutcome / setStoredOutcome for dedupe', async () => {
    const outcome = { result: 'ALLOW' as const, details: { usage_before: 0, usage_after: 1 } };
    await store.setStoredOutcome(scope(), '2026-01-31', 'EXPENSIVE', 'op-1', outcome);
    const stored = await store.getStoredOutcome(scope(), '2026-01-31', 'EXPENSIVE', 'op-1');
    expect(stored).toEqual(outcome);
    expect(await store.getStoredOutcome(scope(), '2026-01-31', 'EXPENSIVE', 'op-2')).toBeNull();
  });
});
