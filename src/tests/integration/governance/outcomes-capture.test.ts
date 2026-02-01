/**
 * Phase 7.4 — Outcomes capture integration tests.
 * See PHASE_7_4_TEST_PLAN.md §10.
 * Uses in-memory store when OUTCOMES_TABLE_NAME is not set; can be extended for real DynamoDB.
 */

import { OutcomesCaptureService } from '../../../services/governance/OutcomesCaptureService';
import { Logger } from '../../../services/core/Logger';
import type { OutcomeEvent } from '../../../types/governance/OutcomeTypes';

const logger = new Logger('OutcomesCaptureIntegrationTest');
const NOW = 1700000000000;

describe('Outcomes capture integration', () => {
  const outcomes: OutcomeEvent[] = [];
  const dedupe = new Map<string, { outcome_id: string }>();

  function createService() {
    return new OutcomesCaptureService({
      logger,
      evaluationTimeUtcMs: NOW,
      store: {
        appendOutcome: async (e) => { outcomes.push(e); },
        putDedupeIfAbsent: async (key, outcomeId) => {
          if (dedupe.has(key)) return false;
          dedupe.set(key, { outcome_id: outcomeId });
          return true;
        },
        getDedupe: async (key) => dedupe.get(key) ?? null,
      },
    });
  }

  beforeEach(() => {
    outcomes.length = 0;
    dedupe.clear();
  });

  describe('approval + completion flow', () => {
    it('append ACTION_APPROVED then PLAN_COMPLETED; outcomes stored', async () => {
      const service = createService();
      const r1 = await service.append({
        tenant_id: 't1',
        plan_id: 'plan-int-1',
        event_type: 'ACTION_APPROVED',
        source: 'HUMAN',
        data: { idempotency_key: 'approve-1', ledger_entry_id: 'le-1' },
      });
      expect('duplicate' in r1 ? false : r1.event_type).toBe('ACTION_APPROVED');
      expect(outcomes).toHaveLength(1);
      expect(outcomes[0].event_type).toBe('ACTION_APPROVED');
      expect(outcomes[0].data?.idempotency_key).toBe('approve-1');

      const r2 = await service.append({
        tenant_id: 't1',
        plan_id: 'plan-int-1',
        event_type: 'PLAN_COMPLETED',
        source: 'ORCHESTRATOR',
        data: { idempotency_key: 'complete-1', completion_reason: 'all_steps_done', terminal_state: 'COMPLETED' },
      });
      expect('duplicate' in r2 ? false : r2.event_type).toBe('PLAN_COMPLETED');
      expect(outcomes).toHaveLength(2);
      expect(outcomes[1].event_type).toBe('PLAN_COMPLETED');
      expect(outcomes[1].data?.completion_reason).toBe('all_steps_done');
    });
  });

  describe('DOWNSTREAM_* contract', () => {
    it('append DOWNSTREAM_WIN with account_id and opportunity_id', async () => {
      const service = createService();
      const result = await service.append({
        tenant_id: 't1',
        account_id: 'acc-int-1',
        event_type: 'DOWNSTREAM_WIN',
        source: 'DOWNSTREAM',
        data: { opportunity_id: 'opp-123' },
      });
      expect('duplicate' in result ? false : result.event_type).toBe('DOWNSTREAM_WIN');
      expect(outcomes).toHaveLength(1);
      expect(outcomes[0].data?.opportunity_id).toBe('opp-123');
    });

    it('append DOWNSTREAM_WIN without opportunity_id throws', async () => {
      const service = createService();
      await expect(
        service.append({
          tenant_id: 't1',
          account_id: 'acc-1',
          event_type: 'DOWNSTREAM_WIN',
          source: 'DOWNSTREAM',
          data: {},
        })
      ).rejects.toThrow('data.opportunity_id required');
      expect(outcomes).toHaveLength(0);
    });
  });

  describe('idempotency', () => {
    it('same idempotency_key twice returns DuplicateOutcome; only one outcome', async () => {
      const service = createService();
      const r1 = await service.append({
        tenant_id: 't1',
        plan_id: 'plan-1',
        event_type: 'ACTION_APPROVED',
        source: 'HUMAN',
        data: { idempotency_key: 'idem-int-1' },
      });
      const r2 = await service.append({
        tenant_id: 't1',
        plan_id: 'plan-1',
        event_type: 'ACTION_APPROVED',
        source: 'HUMAN',
        data: { idempotency_key: 'idem-int-1' },
      });
      expect(r2).toMatchObject({ duplicate: true });
      expect(outcomes).toHaveLength(1);
      if (!('duplicate' in r1)) expect((r2 as { outcome_id: string }).outcome_id).toBe(r1.outcome_id);
    });
  });

  describe('execution + seller edit', () => {
    it('append EXECUTION_SUCCESS and SELLER_EDIT', async () => {
      const service = createService();
      await service.append({
        tenant_id: 't1',
        plan_id: 'plan-1',
        step_id: 'step-1',
        event_type: 'EXECUTION_SUCCESS',
        source: 'ORCHESTRATOR',
        data: {},
      });
      await service.append({
        tenant_id: 't1',
        plan_id: 'plan-1',
        event_type: 'SELLER_EDIT',
        source: 'HUMAN',
        data: { actor_id: 'u1', edited_fields: ['objective'] },
      });
      expect(outcomes).toHaveLength(2);
      expect(outcomes[0].event_type).toBe('EXECUTION_SUCCESS');
      expect(outcomes[1].event_type).toBe('SELLER_EDIT');
    });
  });
});
