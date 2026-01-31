/**
 * PlanPolicyGateService — Phase 6.1 reason codes and determinism; Phase 6.2 plan-type config.
 */

import { PlanPolicyGateService } from '../../../services/plan/PlanPolicyGateService';
import { RevenuePlanV1 } from '../../../types/plan/PlanTypes';
import type { PlanPolicyGateInput } from '../../../types/plan/PlanPolicyGateTypes';
import { getPlanTypeConfig } from '../../../config/planTypeConfig';

function plan(overrides: Partial<RevenuePlanV1> = {}): RevenuePlanV1 {
  const now = new Date().toISOString();
  return {
    plan_id: 'plan-1',
    plan_type: 'RENEWAL_DEFENSE',
    account_id: 'acc-1',
    tenant_id: 't1',
    objective: 'Renew',
    plan_status: 'DRAFT',
    steps: [{ step_id: 's1', action_type: 'REQUEST_MEETING', status: 'PENDING' }],
    expires_at: now,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

describe('PlanPolicyGateService', () => {
  describe('validateForApproval', () => {
    it('returns invalid with INVALID_PLAN_TYPE when plan_type not allowed', async () => {
      const gate = new PlanPolicyGateService({ allowedPlanTypes: ['OTHER_TYPE'] });
      const p = plan({ plan_type: 'RENEWAL_DEFENSE' });
      const { valid, reasons } = await gate.validateForApproval(p, 't1');
      expect(valid).toBe(false);
      expect(reasons.some((r) => r.code === 'INVALID_PLAN_TYPE')).toBe(true);
    });

    it('returns valid when plan_type allowed and no other blockers', async () => {
      const gate = new PlanPolicyGateService({ allowedPlanTypes: ['RENEWAL_DEFENSE'] });
      const p = plan();
      const { valid, reasons } = await gate.validateForApproval(p, 't1');
      expect(valid).toBe(true);
      expect(reasons.length).toBe(0);
    });

    it('returns invalid with STEP_ORDER_VIOLATION when dependency step missing', async () => {
      const gate = new PlanPolicyGateService();
      const p = plan({
        steps: [
          { step_id: 's1', action_type: 'X', status: 'PENDING', dependencies: ['s-missing'] },
        ],
      });
      const { valid, reasons } = await gate.validateForApproval(p, 't1');
      expect(valid).toBe(false);
      expect(reasons.some((r) => r.code === 'STEP_ORDER_VIOLATION')).toBe(true);
    });

    it('returns invalid with RISK_ELEVATED when requireElevatedForHighRisk and plan has high-risk step', async () => {
      const gate = new PlanPolicyGateService({
        allowedPlanTypes: ['RENEWAL_DEFENSE'],
        requireElevatedForHighRisk: true,
      });
      const p = plan({
        steps: [{ step_id: 's1', action_type: 'REQUEST_RENEWAL_MEETING', status: 'PENDING' }],
      });
      const { valid, reasons } = await gate.validateForApproval(p, 't1');
      expect(valid).toBe(false);
      expect(reasons.some((r) => r.code === 'RISK_ELEVATED')).toBe(true);
    });

    it('returns invalid with HUMAN_TOUCH_REQUIRED when humanTouchRequired is true', async () => {
      const gate = new PlanPolicyGateService({
        allowedPlanTypes: ['RENEWAL_DEFENSE'],
        humanTouchRequired: true,
      });
      const p = plan();
      const { valid, reasons } = await gate.validateForApproval(p, 't1');
      expect(valid).toBe(false);
      expect(reasons.some((r) => r.code === 'HUMAN_TOUCH_REQUIRED')).toBe(true);
    });

    it('determinism: same plan + tenantId yields same result', async () => {
      const gate = new PlanPolicyGateService();
      const p = plan();
      const a = await gate.validateForApproval(p, 't1');
      const b = await gate.validateForApproval(p, 't1');
      expect(a.valid).toBe(b.valid);
      expect(JSON.stringify(a.reasons)).toBe(JSON.stringify(b.reasons));
    });

    describe('with getPlanTypeConfig (6.2)', () => {
      it('returns invalid with INVALID_PLAN_TYPE when plan_type not in config', async () => {
        const gate = new PlanPolicyGateService({ getPlanTypeConfig });
        const p = plan({ plan_type: 'OTHER_TYPE' });
        const { valid, reasons } = await gate.validateForApproval(p, 't1');
        expect(valid).toBe(false);
        expect(reasons.some((r) => r.code === 'INVALID_PLAN_TYPE')).toBe(true);
      });

      it('returns invalid with STEP_ORDER_VIOLATION when step action_type not allowed', async () => {
        const gate = new PlanPolicyGateService({ getPlanTypeConfig });
        const p = plan({
          steps: [{ step_id: 's1', action_type: 'DISALLOWED_ACTION', status: 'PENDING' }],
        });
        const { valid, reasons } = await gate.validateForApproval(p, 't1');
        expect(valid).toBe(false);
        expect(reasons.some((r) => r.code === 'STEP_ORDER_VIOLATION' && r.message.includes('Disallowed step action_type'))).toBe(true);
      });

      it('returns valid for RENEWAL_DEFENSE with allowed step action types', async () => {
        const gate = new PlanPolicyGateService({ getPlanTypeConfig });
        const p = plan({
          steps: [
            { step_id: 's1', action_type: 'REQUEST_RENEWAL_MEETING', status: 'PENDING' },
            { step_id: 's2', action_type: 'PREP_RENEWAL_BRIEF', status: 'PENDING' },
          ],
        });
        const { valid, reasons } = await gate.validateForApproval(p, 't1');
        expect(valid).toBe(true);
        expect(reasons.length).toBe(0);
      });
    });
  });

  describe('evaluateCanActivate', () => {
    it('returns can_activate false with CONFLICT_ACTIVE_PLAN when existing_active_plan_ids has another plan', async () => {
      const gate = new PlanPolicyGateService();
      const p = plan({ plan_status: 'APPROVED' });
      const input: PlanPolicyGateInput = {
        plan: p,
        tenant_id: 't1',
        account_id: 'acc-1',
        existing_active_plan_ids: ['other-plan-id'],
        preconditions_met: true,
      };
      const result = await gate.evaluateCanActivate(input);
      expect(result.can_activate).toBe(false);
      expect(result.reasons.some((r) => r.code === 'CONFLICT_ACTIVE_PLAN')).toBe(true);
    });

    it('returns can_activate true when existing_active_plan_ids contains only plan own id (self-conflict ignored)', async () => {
      const gate = new PlanPolicyGateService();
      const p = plan({ plan_id: 'plan-1', plan_status: 'APPROVED' });
      const input: PlanPolicyGateInput = {
        plan: p,
        tenant_id: 't1',
        account_id: 'acc-1',
        existing_active_plan_ids: ['plan-1'],
        preconditions_met: true,
      };
      const result = await gate.evaluateCanActivate(input);
      expect(result.can_activate).toBe(true);
      expect(result.reasons.some((r) => r.code === 'CONFLICT_ACTIVE_PLAN')).toBe(false);
    });

    it('returns can_activate false with PRECONDITIONS_UNMET when preconditions_met is false', async () => {
      const gate = new PlanPolicyGateService();
      const p = plan({ plan_status: 'APPROVED' });
      const input: PlanPolicyGateInput = {
        plan: p,
        tenant_id: 't1',
        account_id: 'acc-1',
        preconditions_met: false,
      };
      const result = await gate.evaluateCanActivate(input);
      expect(result.can_activate).toBe(false);
      expect(result.reasons.some((r) => r.code === 'PRECONDITIONS_UNMET')).toBe(true);
    });

    it('returns can_activate false when preconditions_met is not boolean (undefined)', async () => {
      const gate = new PlanPolicyGateService();
      const p = plan({ plan_status: 'APPROVED' });
      const input: PlanPolicyGateInput = {
        plan: p,
        tenant_id: 't1',
        account_id: 'acc-1',
        existing_active_plan_ids: [],
        preconditions_met: undefined as unknown as boolean,
      };
      const result = await gate.evaluateCanActivate(input);
      expect(result.can_activate).toBe(false);
      expect(result.reasons.some((r) => r.code === 'PRECONDITIONS_UNMET' && r.message.includes('required'))).toBe(true);
    });

    it('returns can_activate true when no conflict and preconditions_met true', async () => {
      const gate = new PlanPolicyGateService();
      const p = plan({ plan_status: 'APPROVED' });
      const input: PlanPolicyGateInput = {
        plan: p,
        tenant_id: 't1',
        account_id: 'acc-1',
        existing_active_plan_ids: [],
        preconditions_met: true,
      };
      const result = await gate.evaluateCanActivate(input);
      expect(result.can_activate).toBe(true);
      expect(result.reasons.length).toBe(0);
    });

    it('uses default empty array when existing_active_plan_ids omitted', async () => {
      const gate = new PlanPolicyGateService();
      const p = plan({ plan_status: 'APPROVED' });
      const input: PlanPolicyGateInput = {
        plan: p,
        tenant_id: 't1',
        account_id: 'acc-1',
        preconditions_met: true,
      };
      const result = await gate.evaluateCanActivate(input);
      expect(result.can_activate).toBe(true);
      expect(result.reasons.length).toBe(0);
    });

    it('returns can_activate false with INVALID_PLAN_TYPE when plan_type not allowed', async () => {
      const gate = new PlanPolicyGateService({ allowedPlanTypes: ['OTHER_TYPE'] });
      const p = plan({ plan_status: 'APPROVED', plan_type: 'RENEWAL_DEFENSE' });
      const input: PlanPolicyGateInput = {
        plan: p,
        tenant_id: 't1',
        account_id: 'acc-1',
        existing_active_plan_ids: [],
        preconditions_met: true,
      };
      const result = await gate.evaluateCanActivate(input);
      expect(result.can_activate).toBe(false);
      expect(result.reasons.some((r) => r.code === 'INVALID_PLAN_TYPE')).toBe(true);
    });

    it('determinism: same input yields same result', async () => {
      const gate = new PlanPolicyGateService();
      const input: PlanPolicyGateInput = {
        plan: plan({ plan_status: 'APPROVED' }),
        tenant_id: 't1',
        account_id: 'acc-1',
        preconditions_met: true,
      };
      const a = await gate.evaluateCanActivate(input);
      const b = await gate.evaluateCanActivate(input);
      expect(a.can_activate).toBe(b.can_activate);
      expect(JSON.stringify(a.reasons)).toBe(JSON.stringify(b.reasons));
    });

    it('returns can_activate false with INVALID_PLAN_TYPE when getPlanTypeConfig returns null (6.2)', async () => {
      const gate = new PlanPolicyGateService({ getPlanTypeConfig });
      const p = plan({ plan_status: 'APPROVED', plan_type: 'OTHER_TYPE' });
      const input: PlanPolicyGateInput = {
        plan: p,
        tenant_id: 't1',
        account_id: 'acc-1',
        existing_active_plan_ids: [],
        preconditions_met: true,
      };
      const result = await gate.evaluateCanActivate(input);
      expect(result.can_activate).toBe(false);
      expect(result.reasons.some((r) => r.code === 'INVALID_PLAN_TYPE')).toBe(true);
    });
  });
});
