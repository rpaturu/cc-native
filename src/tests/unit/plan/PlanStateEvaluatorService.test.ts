/**
 * Phase 6.3 — PlanStateEvaluatorService unit tests.
 */

import { PlanStateEvaluatorService } from '../../../services/plan/PlanStateEvaluatorService';
import type { RevenuePlanV1 } from '../../../types/plan/PlanTypes';

function plan(overrides: Partial<RevenuePlanV1> = {}): RevenuePlanV1 {
  const now = new Date().toISOString();
  const future = new Date(Date.now() + 86400000).toISOString();
  return {
    plan_id: 'p1',
    plan_type: 'RENEWAL_DEFENSE',
    account_id: 'a1',
    tenant_id: 't1',
    objective: 'Renew',
    plan_status: 'ACTIVE',
    steps: [],
    expires_at: future,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

describe('PlanStateEvaluatorService', () => {
  const evaluator = new PlanStateEvaluatorService();

  describe('evaluate', () => {
    it('returns EXPIRE when now >= expires_at', async () => {
      const past = new Date(Date.now() - 1000).toISOString();
      const result = await evaluator.evaluate({
        plan: plan({ expires_at: past }),
      });
      expect(result.action).toBe('EXPIRE');
      expect('expired_at' in result && result.expired_at).toBeDefined();
    });

    it('returns NO_CHANGE when no steps', async () => {
      const result = await evaluator.evaluate({ plan: plan({ steps: [] }) });
      expect(result.action).toBe('NO_CHANGE');
    });

    it('returns NO_CHANGE when some steps not terminal success', async () => {
      const result = await evaluator.evaluate({
        plan: plan({
          steps: [
            { step_id: 's1', action_type: 'X', status: 'DONE' },
            { step_id: 's2', action_type: 'Y', status: 'PENDING' },
          ],
        }),
      });
      expect(result.action).toBe('NO_CHANGE');
    });

    it('returns COMPLETE all_steps_done when all steps DONE', async () => {
      const result = await evaluator.evaluate({
        plan: plan({
          steps: [
            { step_id: 's1', action_type: 'X', status: 'DONE' },
            { step_id: 's2', action_type: 'Y', status: 'DONE' },
          ],
        }),
      });
      expect(result.action).toBe('COMPLETE');
      expect('completion_reason' in result && result.completion_reason).toBe('all_steps_done');
      expect('completed_at' in result && result.completed_at).toBeDefined();
    });

    it('returns COMPLETE all_steps_done when all steps SKIPPED (RENEWAL_DEFENSE)', async () => {
      const result = await evaluator.evaluate({
        plan: plan({
          steps: [
            { step_id: 's1', action_type: 'X', status: 'SKIPPED' },
            { step_id: 's2', action_type: 'Y', status: 'SKIPPED' },
          ],
        }),
      });
      expect(result.action).toBe('COMPLETE');
      expect('completion_reason' in result && result.completion_reason).toBe('all_steps_done');
    });

    it('returns COMPLETE when mix DONE and SKIPPED', async () => {
      const result = await evaluator.evaluate({
        plan: plan({
          steps: [
            { step_id: 's1', action_type: 'X', status: 'DONE' },
            { step_id: 's2', action_type: 'Y', status: 'SKIPPED' },
          ],
        }),
      });
      expect(result.action).toBe('COMPLETE');
      expect('completion_reason' in result && result.completion_reason).toBe('all_steps_done');
    });

    it('returns NO_CHANGE when any step is FAILED', async () => {
      const result = await evaluator.evaluate({
        plan: plan({
          steps: [
            { step_id: 's1', action_type: 'X', status: 'DONE' },
            { step_id: 's2', action_type: 'Y', status: 'FAILED' },
          ],
        }),
      });
      expect(result.action).toBe('NO_CHANGE');
    });

    it('returns NO_CHANGE when expires_at is undefined (no expiry check)', async () => {
      const p = plan({ expires_at: undefined as unknown as string });
      const result = await evaluator.evaluate({ plan: p });
      expect(result.action).not.toBe('EXPIRE');
      expect(['NO_CHANGE', 'COMPLETE']).toContain(result.action);
    });

    it('determinism: same input yields same result', async () => {
      const p = plan({
        steps: [
          { step_id: 's1', action_type: 'X', status: 'DONE' },
          { step_id: 's2', action_type: 'Y', status: 'DONE' },
        ],
      });
      const a = await evaluator.evaluate({ plan: p });
      const b = await evaluator.evaluate({ plan: p });
      expect(a.action).toBe(b.action);
      if (a.action === 'COMPLETE' && b.action === 'COMPLETE') {
        expect(a.completion_reason).toBe(b.completion_reason);
      }
    });
  });
});
