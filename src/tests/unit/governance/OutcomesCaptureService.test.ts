/**
 * Phase 7.4 — OutcomesCaptureService unit tests.
 * See PHASE_7_4_TEST_PLAN.md §2–§6.
 */

import { OutcomesCaptureService } from '../../../services/governance/OutcomesCaptureService';
import { Logger } from '../../../services/core/Logger';
import type {
  OutcomeEvent,
  PlanLinkedOutcomeCaptureInput,
  DownstreamOutcomeCaptureInput,
} from '../../../types/governance/OutcomeTypes';

const logger = new Logger('OutcomesCaptureServiceTest');
const NOW = 1700000000000;

type OutcomesCaptureServiceConfig = import('../../../services/governance/OutcomesCaptureService').OutcomesCaptureServiceConfig;

function createService(store?: OutcomesCaptureServiceConfig['store']) {
  return new OutcomesCaptureService({
    logger,
    evaluationTimeUtcMs: NOW,
    store,
  });
}

describe('OutcomesCaptureService', () => {
  describe('validation fail-fast', () => {
    it('throws when plan_id missing for plan-linked', async () => {
      const service = createService();
      const input: PlanLinkedOutcomeCaptureInput = {
        tenant_id: 't1',
        plan_id: '' as unknown as string,
        event_type: 'ACTION_APPROVED',
        source: 'HUMAN',
        data: {},
      };
      await expect(service.append(input)).rejects.toThrow('plan_id required');
    });

    it('throws when account_id missing for DOWNSTREAM_*', async () => {
      const service = createService();
      const input: DownstreamOutcomeCaptureInput = {
        tenant_id: 't1',
        account_id: '' as unknown as string,
        event_type: 'DOWNSTREAM_WIN',
        source: 'DOWNSTREAM',
        data: { opportunity_id: 'opp-1' },
      };
      await expect(service.append(input)).rejects.toThrow('account_id required');
    });

    it('throws when data.opportunity_id missing for DOWNSTREAM_*', async () => {
      const service = createService();
      const input: DownstreamOutcomeCaptureInput = {
        tenant_id: 't1',
        account_id: 'acc-1',
        event_type: 'DOWNSTREAM_WIN',
        source: 'DOWNSTREAM',
        data: {},
      };
      await expect(service.append(input)).rejects.toThrow('data.opportunity_id required');
    });
  });

  describe('append success (plan-linked)', () => {
    it('returns OutcomeEvent with outcome_id and timestamp from evaluation time', async () => {
      const appended: OutcomeEvent[] = [];
      const service = createService({
        appendOutcome: async (e) => { appended.push(e); },
        putDedupeIfAbsent: async () => true,
        getDedupe: async () => null,
      });
      const input: PlanLinkedOutcomeCaptureInput = {
        tenant_id: 't1',
        plan_id: 'plan-1',
        event_type: 'SELLER_EDIT',
        source: 'HUMAN',
        data: { actor_id: 'u1' },
      };
      const result = await service.append(input);
      expect('duplicate' in result ? result.duplicate : result.outcome_id).toBeDefined();
      if (!('duplicate' in result)) {
        expect(result.timestamp_utc_ms).toBe(NOW);
        expect(result.plan_id).toBe('plan-1');
        expect(result.event_type).toBe('SELLER_EDIT');
      }
      expect(appended).toHaveLength(1);
    });
  });

  describe('append success (downstream)', () => {
    it('returns OutcomeEvent with pk TENANT#...#ACCOUNT#account_id', async () => {
      const appended: OutcomeEvent[] = [];
      const service = createService({
        appendOutcome: async (e) => { appended.push(e); },
        putDedupeIfAbsent: async () => true,
        getDedupe: async () => null,
      });
      const input: DownstreamOutcomeCaptureInput = {
        tenant_id: 't1',
        account_id: 'acc-1',
        event_type: 'DOWNSTREAM_WIN',
        source: 'DOWNSTREAM',
        data: { opportunity_id: 'opp-1' },
      };
      const result = await service.append(input);
      if (!('duplicate' in result)) {
        expect(result.account_id).toBe('acc-1');
        expect(result.event_type).toBe('DOWNSTREAM_WIN');
        expect(result.data?.opportunity_id).toBe('opp-1');
      }
      expect(appended).toHaveLength(1);
    });
  });

  describe('idempotency (key events)', () => {
    it('second append with same idempotency_key returns DuplicateOutcome', async () => {
      const appended: OutcomeEvent[] = [];
      const dedupe = new Map<string, { outcome_id: string }>();
      const service = createService({
        appendOutcome: async (e) => { appended.push(e); },
        putDedupeIfAbsent: async (key, outcomeId) => {
          if (dedupe.has(key)) return false;
          dedupe.set(key, { outcome_id: outcomeId });
          return true;
        },
        getDedupe: async (key) => dedupe.get(key) ?? null,
      });
      const input: PlanLinkedOutcomeCaptureInput = {
        tenant_id: 't1',
        plan_id: 'plan-1',
        event_type: 'ACTION_APPROVED',
        source: 'HUMAN',
        data: { idempotency_key: 'idem-1' },
      };
      const r1 = await service.append(input);
      expect(appended).toHaveLength(1);
      const r2 = await service.append(input);
      expect(r2).toMatchObject({ duplicate: true, outcome_id: expect.any(String) });
      expect(appended).toHaveLength(1);
      if (!('duplicate' in r1)) expect((r2 as { outcome_id: string }).outcome_id).toBe(r1.outcome_id);
    });
  });

  describe('non-key events (no dedupe)', () => {
    it('SELLER_EDIT writes outcome only', async () => {
      const appended: OutcomeEvent[] = [];
      let putDedupeCalls = 0;
      const service = createService({
        appendOutcome: async (e) => { appended.push(e); },
        putDedupeIfAbsent: async () => {
          putDedupeCalls++;
          return true;
        },
        getDedupe: async () => null,
      });
      await service.append({
        tenant_id: 't1',
        plan_id: 'plan-1',
        event_type: 'SELLER_EDIT',
        source: 'HUMAN',
        data: {},
      });
      expect(appended).toHaveLength(1);
      expect(putDedupeCalls).toBe(0);
    });

    it('EXECUTION_SUCCESS writes outcome only', async () => {
      const appended: OutcomeEvent[] = [];
      const service = createService({
        appendOutcome: async (e) => { appended.push(e); },
        putDedupeIfAbsent: async () => true,
        getDedupe: async () => null,
      });
      await service.append({
        tenant_id: 't1',
        plan_id: 'plan-1',
        step_id: 'step-1',
        event_type: 'EXECUTION_SUCCESS',
        source: 'ORCHESTRATOR',
        data: {},
      });
      expect(appended).toHaveLength(1);
    });
  });
});
