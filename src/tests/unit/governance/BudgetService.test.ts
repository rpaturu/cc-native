/**
 * Phase 7.2 — BudgetService unit tests.
 * See PHASE_7_2_TEST_PLAN.md §4.
 */

import { BudgetService } from '../../../services/governance/BudgetService';
import { BudgetUsageStore } from '../../../services/governance/BudgetUsageStore';
import { setBudgetConfigs } from '../../../config/budgetConfig';
import { PlanLedgerService } from '../../../services/plan/PlanLedgerService';
import { Logger } from '../../../services/core/Logger';
import type { ReserveRequest, BudgetScope } from '../../../types/governance/BudgetTypes';

const logger = new Logger('BudgetServiceTest');

function createMockPlanLedger(): PlanLedgerService {
  return {
    append: jest.fn().mockResolvedValue({ entry_id: 'e1', timestamp: new Date().toISOString() }),
    getByPlanId: jest.fn().mockResolvedValue([]),
  } as unknown as PlanLedgerService;
}

function scope(overrides: Partial<BudgetScope> = {}): BudgetScope {
  return { tenant_id: 't1', ...overrides };
}

describe('BudgetService', () => {
  let usageStore: BudgetUsageStore;
  let planLedger: PlanLedgerService;
  let service: BudgetService;

  beforeEach(() => {
    usageStore = new BudgetUsageStore();
    planLedger = createMockPlanLedger();
    setBudgetConfigs([
      { scope: { tenant_id: '*' }, period: 'DAY', hard_cap: { EXPENSIVE: 50, MEDIUM: 200 }, soft_cap: { EXPENSIVE: 40 } },
    ]);
    service = new BudgetService({ usageStore, planLedger, logger });
  });

  it('returns BLOCK with NO_APPLICABLE_CONFIG when no config applies', async () => {
    setBudgetConfigs([{ scope: { tenant_id: 'other-tenant' }, period: 'DAY', hard_cap: { EXPENSIVE: 50 } }]);
    const request: ReserveRequest = {
      scope: scope({ tenant_id: 't1' }),
      cost_class: 'EXPENSIVE',
      period_key: '2026-01-31',
      operation_id: 'op-1',
    };
    const result = await service.reserve(request);
    expect(result.result).toBe('BLOCK');
    expect(result.reason).toBe('NO_APPLICABLE_CONFIG');
    expect(planLedger.append).not.toHaveBeenCalled();
  });

  it('reserve returns ALLOW and appends BUDGET_RESERVE when under caps', async () => {
    const request: ReserveRequest = {
      scope: scope(),
      cost_class: 'EXPENSIVE',
      period_key: '2026-01-31',
      operation_id: 'op-1',
      amount: 1,
    };
    const result = await service.reserve(request);
    expect(result.result).toBe('ALLOW');
    expect(result.details?.usage_before).toBe(0);
    expect(result.details?.usage_after).toBe(1);
    expect(result.details?.cap_hard).toBe(50);
    expect(planLedger.append).toHaveBeenCalledWith(
      expect.objectContaining({ event_type: 'BUDGET_RESERVE', data: expect.objectContaining({ result: 'ALLOW' }) })
    );
  });

  it('same operation_id twice returns stored outcome (dedupe)', async () => {
    const request: ReserveRequest = {
      scope: scope(),
      cost_class: 'EXPENSIVE',
      period_key: '2026-01-31',
      operation_id: 'op-same',
    };
    const r1 = await service.reserve(request);
    const r2 = await service.reserve(request);
    expect(r1.result).toBe(r2.result);
    expect(usageStore.getStoredOutcome(scope(), '2026-01-31', 'EXPENSIVE', 'op-same')).resolves.toBeDefined();
  });

  it('returns BLOCK with HARD_CAP_EXCEEDED when reserve would exceed hard cap', async () => {
    const periodKey = '2026-01-31-hard-cap';
    await service.reserve({
      scope: scope(),
      cost_class: 'EXPENSIVE',
      period_key: periodKey,
      operation_id: 'op-1',
      amount: 50,
    });
    const result = await service.reserve({
      scope: scope(),
      cost_class: 'EXPENSIVE',
      period_key: periodKey,
      operation_id: 'op-2',
      amount: 1,
    });
    expect(result.result).toBe('BLOCK');
    expect(result.reason).toBe('HARD_CAP_EXCEEDED');
    expect(planLedger.append).toHaveBeenLastCalledWith(
      expect.objectContaining({ event_type: 'BUDGET_BLOCK' })
    );
  });

  it('returns WARN when usage_after exceeds soft_cap but not hard_cap', async () => {
    const periodKey = '2026-01-31-warn';
    setBudgetConfigs([
      { scope: { tenant_id: '*' }, period: 'DAY', hard_cap: { EXPENSIVE: 50 }, soft_cap: { EXPENSIVE: 40 } },
    ]);
    const freshStore = new BudgetUsageStore();
    const freshService = new BudgetService({ usageStore: freshStore, planLedger, logger });
    await freshService.reserve({
      scope: scope(),
      cost_class: 'EXPENSIVE',
      period_key: periodKey,
      operation_id: 'op-40',
      amount: 40,
    });
    const warnResult = await freshService.reserve({
      scope: scope(),
      cost_class: 'EXPENSIVE',
      period_key: periodKey,
      operation_id: 'op-41',
      amount: 1,
    });
    expect(warnResult.result).toBe('WARN');
    expect(warnResult.reason).toBe('SOFT_CAP_EXCEEDED');
    const usage = await freshStore.getUsage(scope(), periodKey);
    expect(usage.EXPENSIVE).toBe(41);
  });

  it('amount defaults to 1 when omitted', async () => {
    const periodKey = '2026-01-31-default-amount';
    const result = await service.reserve({
      scope: scope(),
      cost_class: 'EXPENSIVE',
      period_key: periodKey,
      operation_id: 'op-default',
    });
    expect(result.result).toBe('ALLOW');
    expect(result.details?.usage_after).toBe(1);
  });
});
