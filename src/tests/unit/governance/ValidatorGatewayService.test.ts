/**
 * Phase 7.1 — ValidatorGatewayService unit tests.
 * See PHASE_7_1_CODE_LEVEL_PLAN.md §10.
 */

import { ValidatorGatewayService } from '../../../services/governance/ValidatorGatewayService';
import { PlanLedgerService } from '../../../services/plan/PlanLedgerService';
import { Logger } from '../../../services/core/Logger';
import type { ValidatorContext } from '../../../types/governance/ValidatorTypes';

const logger = new Logger('ValidatorGatewayTest');

function createMockPlanLedger(): PlanLedgerService {
  const appended: Record<string, unknown>[] = [];
  return {
    append: jest.fn().mockImplementation(async (entry: Record<string, unknown>) => {
      appended.push(entry);
      return { ...entry, entry_id: 'e-' + appended.length, timestamp: new Date().toISOString() };
    }),
    getByPlanId: jest.fn().mockResolvedValue([]),
  } as unknown as PlanLedgerService;
}

function ctx(overrides: Partial<ValidatorContext> = {}): ValidatorContext {
  return {
    choke_point: 'BEFORE_PLAN_APPROVAL',
    evaluation_time_utc_ms: 1700000000000,
    validation_run_id: 'run-1',
    target_id: 'plan-1',
    tenant_id: 't1',
    plan_id: 'plan-1',
    account_id: 'acc-1',
    ...overrides,
  };
}

describe('ValidatorGatewayService', () => {
  it('runs all four validators and returns aggregate', async () => {
    const planLedger = createMockPlanLedger();
    const gateway = new ValidatorGatewayService({ planLedger, logger });
    const result = await gateway.run(ctx());
    expect(result.results).toHaveLength(4);
    expect(['freshness', 'grounding', 'contradiction', 'compliance']).toEqual(
      result.results.map((r) => r.validator)
    );
    expect(['ALLOW', 'WARN', 'BLOCK']).toContain(result.aggregate);
  });

  it('appends VALIDATOR_RUN for each validator then VALIDATOR_RUN_SUMMARY', async () => {
    const planLedger = createMockPlanLedger();
    const gateway = new ValidatorGatewayService({ planLedger, logger });
    await gateway.run(ctx());
    expect(planLedger.append).toHaveBeenCalledTimes(5);
    const calls = (planLedger.append as jest.Mock).mock.calls;
    expect(calls.slice(0, 4).every((c: unknown[]) => (c[0] as { event_type: string }).event_type === 'VALIDATOR_RUN')).toBe(true);
    expect(calls[4][0].event_type).toBe('VALIDATOR_RUN_SUMMARY');
    expect(calls[4][0].data.aggregate).toBeDefined();
    expect(calls[4][0].data.results).toHaveLength(4);
  });

  it('aggregates BLOCK if any validator returns BLOCK', async () => {
    const planLedger = createMockPlanLedger();
    const gateway = new ValidatorGatewayService({ planLedger, logger });
    const result = await gateway.run(
      ctx({
        data_sources: [
          { source_id: 'crm', last_updated_utc_ms: 0 },
        ],
      })
    );
    expect(result.aggregate).toBe('BLOCK');
  });

  it('runs validators in order: Freshness, Grounding, Contradiction, Compliance', async () => {
    const planLedger = createMockPlanLedger();
    const gateway = new ValidatorGatewayService({ planLedger, logger });
    const result = await gateway.run(ctx());
    const order = result.results.map((r) => r.validator);
    expect(order).toEqual(['freshness', 'grounding', 'contradiction', 'compliance']);
  });

  it('aggregates WARN when no BLOCK but at least one WARN', async () => {
    const planLedger = createMockPlanLedger();
    const gateway = new ValidatorGatewayService({ planLedger, logger });
    const eightDaysMs = 8 * 86400 * 1000;
    const result = await gateway.run(
      ctx({
        data_sources: [{ source_id: 'crm', last_updated_utc_ms: 1700000000000 - eightDaysMs }],
        step_or_proposal: { evidence: [{ source_type: 'crm', source_id: '1' }] },
        canonical_snapshot: {},
      })
    );
    expect(result.aggregate).toBe('WARN');
  });

  it('returns BLOCK with LEDGER_WRITE_FAILED when summary append fails', async () => {
    const planLedger = createMockPlanLedger();
    let callCount = 0;
    (planLedger.append as jest.Mock).mockImplementation(async (entry: Record<string, unknown>) => {
      callCount++;
      if (callCount === 5) throw new Error('Ledger write failed');
      return { ...entry, entry_id: 'e-' + callCount, timestamp: new Date().toISOString() };
    });
    const gateway = new ValidatorGatewayService({ planLedger, logger });
    const result = await gateway.run(ctx());
    expect(result.aggregate).toBe('BLOCK');
    const synthetic = result.results.find((r) => r.validator === 'gateway' && r.reason === 'LEDGER_WRITE_FAILED');
    expect(synthetic).toBeDefined();
  });

  it('same context twice yields same result (determinism)', async () => {
    const planLedger = createMockPlanLedger();
    const gateway = new ValidatorGatewayService({ planLedger, logger });
    const context = ctx();
    const r1 = await gateway.run(context);
    const r2 = await gateway.run({ ...context });
    expect(r2.aggregate).toBe(r1.aggregate);
    expect(r2.results).toHaveLength(r1.results.length);
    r2.results.forEach((r, i) => {
      expect(r.validator).toBe(r1.results[i].validator);
      expect(r.result).toBe(r1.results[i].result);
    });
  });
});
