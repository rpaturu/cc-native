/**
 * PlanStepToActionIntentAdapter — Phase 6.3
 * Covers buildProposal (via createIntentFromPlanStep) and createIntentFromPlanStep.
 */

import { PlanStepToActionIntentAdapter } from '../../../services/plan/PlanStepToActionIntentAdapter';
import { ActionIntentService } from '../../../services/decision/ActionIntentService';
import type { PlanStepToActionIntentAdapterInput } from '../../../services/plan/PlanStepToActionIntentAdapter';
import type { PlanStepV1 } from '../../../types/plan/PlanTypes';
import type { ActionIntentV1 } from '../../../types/DecisionTypes';

function mockActionIntentV1(overrides: Partial<ActionIntentV1> = {}): ActionIntentV1 {
  const now = new Date().toISOString();
  const epoch = Math.floor(Date.now() / 1000);
  return {
    action_intent_id: 'intent-1',
    action_type: 'CREATE_INTERNAL_TASK',
    target: { entity_type: 'ACCOUNT', entity_id: 'acc-1' },
    parameters: {},
    approved_by: 'plan-orchestrator',
    approval_timestamp: now,
    execution_policy: { retry_count: 3, timeout_seconds: 60, max_attempts: 3 },
    expires_at: now,
    expires_at_epoch: epoch,
    original_decision_id: 'plan-1#step-1#1',
    original_proposal_id: 'plan-1#step-1#1',
    edited_fields: [],
    tenant_id: 't1',
    account_id: 'acc-1',
    trace_id: 'trace-1',
    registry_version: 1,
    ...overrides,
  };
}

describe('PlanStepToActionIntentAdapter', () => {
  let mockActionIntentService: { createIntent: jest.Mock };
  let adapter: PlanStepToActionIntentAdapter;

  const step: PlanStepV1 = {
    step_id: 'step-1',
    action_type: 'CREATE_INTERNAL_TASK',
    status: 'PENDING',
    sequence: 1,
    constraints: { title: 'Renewal task', priority: 'HIGH' },
  };

  const input: PlanStepToActionIntentAdapterInput = {
    tenant_id: 't1',
    account_id: 'acc-1',
    plan_id: 'plan-1',
    step_id: 'step-1',
    attempt: 1,
    step,
    trace_id: 'trace-1',
  };

  const mockIntent = mockActionIntentV1();

  beforeEach(() => {
    mockActionIntentService = { createIntent: jest.fn().mockResolvedValue(mockIntent) };
    adapter = new PlanStepToActionIntentAdapter(mockActionIntentService as unknown as ActionIntentService);
  });

  describe('createIntentFromPlanStep', () => {
    it('calls actionIntentService.createIntent with proposal from buildProposal and returns intent', async () => {
      const result = await adapter.createIntentFromPlanStep(input);

      expect(result).toEqual(mockIntent);
      expect(mockActionIntentService.createIntent).toHaveBeenCalledTimes(1);
      const [proposal, decisionId, approvedBy, tenantId, accountId, traceId] =
        mockActionIntentService.createIntent.mock.calls[0];
      expect(proposal.action_type).toBe('CREATE_INTERNAL_TASK');
      expect(proposal.why).toEqual(['PLAN_STEP']);
      expect(proposal.confidence).toBe(1);
      expect(proposal.action_ref).toBe('plan-1#step-1#1');
      expect(proposal.target).toEqual({ entity_type: 'ACCOUNT', entity_id: 'acc-1' });
      expect(proposal.parameters).toEqual({ title: 'Renewal task', priority: 'HIGH' });
      expect(decisionId).toBe('plan-1#step-1#1');
      expect(approvedBy).toBe('plan-orchestrator');
      expect(tenantId).toBe('t1');
      expect(accountId).toBe('acc-1');
      expect(traceId).toBe('trace-1');
    });

    it('uses empty object for parameters when step.constraints is undefined', async () => {
      const inputNoConstraints = { ...input, step: { ...step, constraints: undefined } };
      await adapter.createIntentFromPlanStep(inputNoConstraints);

      const [proposal] = mockActionIntentService.createIntent.mock.calls[0];
      expect(proposal.parameters).toEqual({});
    });
  });
});
