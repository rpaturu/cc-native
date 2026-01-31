/**
 * Phase 6.2 — PlanProposalGeneratorService unit tests.
 */

import * as planTypeConfig from '../../../config/planTypeConfig';
import { PlanProposalGeneratorService } from '../../../services/plan/PlanProposalGeneratorService';
import { RENEWAL_DEFENSE_STEP_ACTION_TYPES } from '../../../types/plan/PlanTypeConfig';

describe('PlanProposalGeneratorService', () => {
  let service: PlanProposalGeneratorService;

  beforeEach(() => {
    service = new PlanProposalGeneratorService();
  });

  describe('generateProposal', () => {
    it('returns plan with plan_status DRAFT only (no auto-approve)', async () => {
      const out = await service.generateProposal({
        tenant_id: 't1',
        account_id: 'acc-1',
        plan_type: 'RENEWAL_DEFENSE',
      });
      expect(out.plan.plan_status).toBe('DRAFT');
      expect(out.plan.plan_type).toBe('RENEWAL_DEFENSE');
    });

    it('never sets plan_status other than DRAFT (governance: no LLM-suggested status)', async () => {
      const out = await service.generateProposal({
        tenant_id: 't1',
        account_id: 'acc-1',
        plan_type: 'RENEWAL_DEFENSE',
      });
      expect(out.plan.plan_status).toBe('DRAFT');
      expect(['APPROVED', 'ACTIVE', 'PAUSED', 'COMPLETED', 'ABORTED', 'EXPIRED']).not.toContain(out.plan.plan_status);
    });

    it('returns plan_type RENEWAL_DEFENSE and allowed step action types only', async () => {
      const out = await service.generateProposal({
        tenant_id: 't1',
        account_id: 'acc-1',
        plan_type: 'RENEWAL_DEFENSE',
      });
      expect(out.plan.plan_type).toBe('RENEWAL_DEFENSE');
      const allowed = new Set<string>(RENEWAL_DEFENSE_STEP_ACTION_TYPES);
      for (const step of out.plan.steps) {
        expect(allowed.has(step.action_type)).toBe(true);
      }
    });

    it('each step has step_id (UUID), status PENDING, and sequence', async () => {
      const out = await service.generateProposal({
        tenant_id: 't1',
        account_id: 'acc-1',
        plan_type: 'RENEWAL_DEFENSE',
      });
      const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      out.plan.steps.forEach((step, i) => {
        expect(step.step_id).toMatch(uuidRe);
        expect(step.status).toBe('PENDING');
        expect(step.sequence).toBe(i + 1);
      });
    });

    it('plan has plan_id, expires_at, created_at, updated_at', async () => {
      const out = await service.generateProposal({
        tenant_id: 't1',
        account_id: 'acc-1',
        plan_type: 'RENEWAL_DEFENSE',
      });
      expect(out.plan.plan_id).toBeDefined();
      expect(out.plan.expires_at).toBeDefined();
      expect(new Date(out.plan.expires_at).getTime()).toBeGreaterThan(Date.now());
      expect(out.plan.created_at).toBeDefined();
      expect(out.plan.updated_at).toBeDefined();
    });

    it('throws for unsupported plan type', async () => {
      await expect(
        service.generateProposal({
          tenant_id: 't1',
          account_id: 'acc-1',
          plan_type: 'OTHER_TYPE' as 'RENEWAL_DEFENSE',
        })
      ).rejects.toThrow(/not supported/);
    });

    it('returns proposal_id equal to plan_id', async () => {
      const out = await service.generateProposal({
        tenant_id: 't1',
        account_id: 'acc-1',
        plan_type: 'RENEWAL_DEFENSE',
      });
      expect(out.proposal_id).toBe(out.plan.plan_id);
    });

    it('objective comes from config template', async () => {
      const out = await service.generateProposal({
        tenant_id: 't1',
        account_id: 'acc-1',
        plan_type: 'RENEWAL_DEFENSE',
      });
      expect(out.plan.objective).toBe('Secure renewal before day -30');
    });

    it('uses objective fallback when config has no objective_template', async () => {
      jest.spyOn(planTypeConfig, 'getPlanTypeConfig').mockReturnValueOnce({
        plan_type: 'RENEWAL_DEFENSE',
        allowed_step_action_types: [...RENEWAL_DEFENSE_STEP_ACTION_TYPES],
        default_sequence: ['REQUEST_RENEWAL_MEETING', 'PREP_RENEWAL_BRIEF', 'ESCALATE_SUPPORT_RISK'],
        objective_template: undefined,
        expires_at_days_from_creation: 30,
      });
      const out = await service.generateProposal({
        tenant_id: 't1',
        account_id: 'acc-99',
        plan_type: 'RENEWAL_DEFENSE',
      });
      expect(out.plan.objective).toBe('Plan for acc-99');
    });

    it('filters out steps with disallowed action_type (sanitize branch)', async () => {
      jest.spyOn(planTypeConfig, 'getPlanTypeConfig').mockReturnValueOnce({
        plan_type: 'RENEWAL_DEFENSE',
        allowed_step_action_types: ['REQUEST_RENEWAL_MEETING'],
        default_sequence: ['REQUEST_RENEWAL_MEETING', 'DISALLOWED_ACTION'],
        objective_template: 'Test',
        expires_at_days_from_creation: 30,
      });
      const out = await service.generateProposal({
        tenant_id: 't1',
        account_id: 'acc-1',
        plan_type: 'RENEWAL_DEFENSE',
      });
      expect(out.plan.steps).toHaveLength(1);
      expect(out.plan.steps[0].action_type).toBe('REQUEST_RENEWAL_MEETING');
    });
  });
});
