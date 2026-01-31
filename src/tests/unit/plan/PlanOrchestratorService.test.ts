/**
 * Phase 6.3 — PlanOrchestratorService unit tests (mocked dependencies).
 */

import { PlanOrchestratorService } from '../../../services/plan/PlanOrchestratorService';
import type { PlanOrchestratorServiceConfig } from '../../../services/plan/PlanOrchestratorService';
import type { RevenuePlanV1 } from '../../../types/plan/PlanTypes';
import { Logger } from '../../../services/core/Logger';

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
    steps: [
      { step_id: 's1', action_type: 'REQUEST_RENEWAL_MEETING', status: 'PENDING' },
    ],
    expires_at: future,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

describe('PlanOrchestratorService', () => {
  const logger = new Logger('PlanOrchestratorTest');

  const mockRepo = {
    listPlansByTenantAndStatus: jest.fn(),
    getPlan: jest.fn(),
    updateStepStatus: jest.fn(),
  };
  const mockLifecycle = { transition: jest.fn() };
  const mockGate = { evaluateCanActivate: jest.fn() };
  const mockLedger = { append: jest.fn() };
  const mockEvaluator = { evaluate: jest.fn() };
  const mockStepState = {
    getCurrentNextAttempt: jest.fn(),
    reserveNextAttempt: jest.fn(),
    recordStepStarted: jest.fn(),
    updateStepOutcome: jest.fn(),
  };
  const mockCreateIntent = { createIntentFromPlanStep: jest.fn() };
  const mockGetPlanTypeConfig = jest.fn();

  function orchestrator(): PlanOrchestratorService {
    return new PlanOrchestratorService({
      planRepository: mockRepo as unknown as PlanOrchestratorServiceConfig['planRepository'],
      planLifecycle: mockLifecycle as unknown as PlanOrchestratorServiceConfig['planLifecycle'],
      planPolicyGate: mockGate as unknown as PlanOrchestratorServiceConfig['planPolicyGate'],
      planLedger: mockLedger as unknown as PlanOrchestratorServiceConfig['planLedger'],
      planStateEvaluator: mockEvaluator as unknown as PlanOrchestratorServiceConfig['planStateEvaluator'],
      stepExecutionState: mockStepState as unknown as PlanOrchestratorServiceConfig['stepExecutionState'],
      createIntentFromPlanStep: mockCreateIntent as unknown as PlanOrchestratorServiceConfig['createIntentFromPlanStep'],
      getPlanTypeConfig: mockGetPlanTypeConfig,
      logger,
      maxPlansPerRun: 10,
    });
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetPlanTypeConfig.mockReturnValue({ max_retries_per_step: 3 });
  });

  describe('runCycle', () => {
    it('activates APPROVED plans when can_activate true', async () => {
      const approvedPlan = plan({ plan_status: 'APPROVED', steps: [] });
      mockRepo.listPlansByTenantAndStatus.mockImplementation(
        (_t: string, status: string) =>
          Promise.resolve(status === 'APPROVED' ? [approvedPlan] : [])
      );
      mockGate.evaluateCanActivate.mockResolvedValue({ can_activate: true, reasons: [] });

      const result = await orchestrator().runCycle('t1');

      expect(result.activated).toBe(1);
      expect(mockLifecycle.transition).toHaveBeenCalledWith(approvedPlan, 'ACTIVE');
    });

    it('does not activate when can_activate false', async () => {
      const approvedPlan = plan({ plan_status: 'APPROVED', steps: [] });
      mockRepo.listPlansByTenantAndStatus.mockImplementation(
        (_t: string, status: string) =>
          Promise.resolve(status === 'APPROVED' ? [approvedPlan] : [])
      );
      mockGate.evaluateCanActivate.mockResolvedValue({
        can_activate: false,
        reasons: [{ code: 'CONFLICT_ACTIVE_PLAN', message: 'x' }],
      });

      const result = await orchestrator().runCycle('t1');

      expect(result.activated).toBe(0);
      expect(mockLifecycle.transition).not.toHaveBeenCalled();
    });

    it('starts next PENDING step and appends STEP_STARTED', async () => {
      const activePlan = plan({
        plan_status: 'ACTIVE',
        steps: [{ step_id: 's1', action_type: 'REQUEST_RENEWAL_MEETING', status: 'PENDING' }],
      });
      mockRepo.listPlansByTenantAndStatus.mockImplementation(
        (_t: string, status: string) =>
          Promise.resolve(status === 'ACTIVE' ? [activePlan] : [])
      );
      mockStepState.getCurrentNextAttempt.mockResolvedValue(0);
      mockStepState.reserveNextAttempt.mockResolvedValue(1);
      mockStepState.recordStepStarted.mockResolvedValue({ attempt: 1, claimed: true });
      mockCreateIntent.createIntentFromPlanStep.mockResolvedValue({
        action_intent_id: 'ai-1',
      });

      const result = await orchestrator().runCycle('t1');

      expect(result.stepsStarted).toBe(1);
      expect(mockLedger.append).toHaveBeenCalledWith(
        expect.objectContaining({
          event_type: 'STEP_STARTED',
          data: expect.objectContaining({ step_id: 's1', attempt: 1 }),
        })
      );
    });

    it('fails step and pauses plan when retry limit exceeded', async () => {
      const activePlan = plan({
        plan_status: 'ACTIVE',
        steps: [{ step_id: 's1', action_type: 'X', status: 'PENDING' }],
      });
      mockRepo.listPlansByTenantAndStatus.mockImplementation(
        (_t: string, status: string) =>
          Promise.resolve(status === 'ACTIVE' ? [activePlan] : [])
      );
      mockStepState.getCurrentNextAttempt.mockResolvedValue(3);

      await orchestrator().runCycle('t1');

      expect(mockRepo.updateStepStatus).toHaveBeenCalledWith(
        't1',
        'a1',
        'p1',
        's1',
        'FAILED'
      );
      expect(mockLedger.append).toHaveBeenCalledWith(
        expect.objectContaining({ event_type: 'STEP_FAILED' })
      );
      expect(mockLifecycle.transition).toHaveBeenCalledWith(activePlan, 'PAUSED', expect.any(Object));
    });

    it('transitions to COMPLETED when no next step and evaluator returns COMPLETE', async () => {
      const activePlan = plan({
        plan_status: 'ACTIVE',
        steps: [{ step_id: 's1', action_type: 'X', status: 'DONE' }],
      });
      mockRepo.listPlansByTenantAndStatus.mockImplementation(
        (_t: string, status: string) =>
          Promise.resolve(status === 'ACTIVE' ? [activePlan] : [])
      );
      mockEvaluator.evaluate.mockResolvedValue({
        action: 'COMPLETE',
        completion_reason: 'all_steps_done',
        completed_at: new Date().toISOString(),
      });

      const result = await orchestrator().runCycle('t1');

      expect(result.completed).toBe(1);
      expect(mockLifecycle.transition).toHaveBeenCalledWith(
        activePlan,
        'COMPLETED',
        expect.objectContaining({ completion_reason: 'all_steps_done' })
      );
    });

    it('transitions to EXPIRED when no next step and evaluator returns EXPIRE', async () => {
      const activePlan = plan({
        plan_status: 'ACTIVE',
        steps: [{ step_id: 's1', action_type: 'X', status: 'DONE' }],
      });
      mockRepo.listPlansByTenantAndStatus.mockImplementation(
        (_t: string, status: string) =>
          Promise.resolve(status === 'ACTIVE' ? [activePlan] : [])
      );
      mockEvaluator.evaluate.mockResolvedValue({
        action: 'EXPIRE',
        expired_at: new Date().toISOString(),
      });

      const result = await orchestrator().runCycle('t1');

      expect(result.expired).toBe(1);
      expect(mockLifecycle.transition).toHaveBeenCalledWith(
        activePlan,
        'EXPIRED',
        expect.objectContaining({ expired_at: expect.any(String) })
      );
    });

    it('respects maxPlansPerRun K (only K APPROVED and K ACTIVE processed)', async () => {
      const approvedPlans = Array.from({ length: 12 }, (_, i) =>
        plan({ plan_id: `p-${i}`, plan_status: 'APPROVED', steps: [] })
      );
      mockRepo.listPlansByTenantAndStatus.mockImplementation(
        (_t: string, status: string, limit?: number) =>
          Promise.resolve(
            status === 'APPROVED' ? approvedPlans.slice(0, limit ?? 12) : []
          )
      );
      mockGate.evaluateCanActivate.mockResolvedValue({ can_activate: true, reasons: [] });

      const result = await orchestrator().runCycle('t1');

      expect(result.activated).toBe(10);
      expect(mockLifecycle.transition).toHaveBeenCalledTimes(10);
    });

    it('does not increment stepsStarted when recordStepStarted claimed false', async () => {
      const activePlan = plan({
        plan_status: 'ACTIVE',
        steps: [{ step_id: 's1', action_type: 'REQUEST_RENEWAL_MEETING', status: 'PENDING' }],
      });
      mockRepo.listPlansByTenantAndStatus.mockImplementation(
        (_t: string, status: string) =>
          Promise.resolve(status === 'ACTIVE' ? [activePlan] : [])
      );
      mockStepState.getCurrentNextAttempt.mockResolvedValue(0);
      mockStepState.reserveNextAttempt.mockResolvedValue(1);
      mockStepState.recordStepStarted.mockResolvedValue({ attempt: 1, claimed: false });

      const result = await orchestrator().runCycle('t1');

      expect(result.stepsStarted).toBe(0);
      expect(mockCreateIntent.createIntentFromPlanStep).not.toHaveBeenCalled();
      expect(mockLedger.append).not.toHaveBeenCalledWith(
        expect.objectContaining({ event_type: 'STEP_STARTED' })
      );
    });

    it('picks next PENDING step with dependencies satisfied (skips step with unsatisfied dep)', async () => {
      const activePlan = plan({
        plan_status: 'ACTIVE',
        steps: [
          { step_id: 's1', action_type: 'X', status: 'PENDING', dependencies: ['s0'] },
          { step_id: 's0', action_type: 'Y', status: 'PENDING' },
        ],
      });
      mockRepo.listPlansByTenantAndStatus.mockImplementation(
        (_t: string, status: string) =>
          Promise.resolve(status === 'ACTIVE' ? [activePlan] : [])
      );
      mockStepState.getCurrentNextAttempt.mockResolvedValue(0);
      mockStepState.reserveNextAttempt.mockResolvedValue(1);
      mockStepState.recordStepStarted.mockResolvedValue({ attempt: 1, claimed: true });
      mockCreateIntent.createIntentFromPlanStep.mockResolvedValue({ action_intent_id: 'ai-1' });

      const result = await orchestrator().runCycle('t1');

      expect(result.stepsStarted).toBe(1);
      expect(mockCreateIntent.createIntentFromPlanStep).toHaveBeenCalledWith(
        expect.objectContaining({ step_id: 's0' })
      );
    });

    it('no transition when no next step and evaluator returns NO_CHANGE', async () => {
      const activePlanNoPending = plan({
        plan_status: 'ACTIVE',
        steps: [{ step_id: 's1', action_type: 'X', status: 'DONE' }],
      });
      mockRepo.listPlansByTenantAndStatus.mockImplementation(
        (_t: string, status: string) =>
          Promise.resolve(status === 'ACTIVE' ? [activePlanNoPending] : [])
      );
      mockEvaluator.evaluate.mockResolvedValue({ action: 'NO_CHANGE' });

      const result = await orchestrator().runCycle('t1');

      expect(result.completed).toBe(0);
      expect(result.expired).toBe(0);
      expect(mockLifecycle.transition).not.toHaveBeenCalled();
    });
  });

  describe('applyStepOutcome', () => {
    it('updates step status, ledger, and transitions plan when evaluator COMPLETE', async () => {
      const updatedPlan = plan({
        plan_status: 'ACTIVE',
        steps: [
          { step_id: 's1', action_type: 'X', status: 'DONE' },
        ],
      });
      mockRepo.getPlan.mockResolvedValue(updatedPlan);
      mockEvaluator.evaluate.mockResolvedValue({
        action: 'COMPLETE',
        completion_reason: 'all_steps_done',
        completed_at: new Date().toISOString(),
      });

      const svc = orchestrator();
      await svc.applyStepOutcome('t1', 'a1', 'p1', 's1', 1, 'DONE');

      expect(mockRepo.updateStepStatus).toHaveBeenCalledWith('t1', 'a1', 'p1', 's1', 'DONE');
      expect(mockLedger.append).toHaveBeenCalledWith(
        expect.objectContaining({ event_type: 'STEP_COMPLETED' })
      );
      expect(mockLifecycle.transition).toHaveBeenCalledWith(
        updatedPlan,
        'COMPLETED',
        expect.any(Object)
      );
    });

    it('updates step FAILED and appends STEP_FAILED', async () => {
      const updatedPlan = plan({
        plan_status: 'ACTIVE',
        steps: [{ step_id: 's1', action_type: 'X', status: 'FAILED' }],
      });
      mockRepo.getPlan.mockResolvedValue(updatedPlan);
      mockEvaluator.evaluate.mockResolvedValue({ action: 'NO_CHANGE' });

      await orchestrator().applyStepOutcome('t1', 'a1', 'p1', 's1', 1, 'FAILED', {
        error_message: 'timeout',
      });

      expect(mockRepo.updateStepStatus).toHaveBeenCalledWith('t1', 'a1', 'p1', 's1', 'FAILED');
      expect(mockLedger.append).toHaveBeenCalledWith(
        expect.objectContaining({
          event_type: 'STEP_FAILED',
          data: expect.objectContaining({ reason: 'timeout' }),
        })
      );
      expect(mockStepState.updateStepOutcome).toHaveBeenCalledWith(
        'p1',
        's1',
        1,
        'FAILED',
        expect.objectContaining({ error_message: 'timeout' })
      );
    });

    it('updates step SKIPPED and appends STEP_SKIPPED', async () => {
      const updatedPlan = plan({
        plan_status: 'ACTIVE',
        steps: [{ step_id: 's1', action_type: 'X', status: 'SKIPPED' }],
      });
      mockRepo.getPlan.mockResolvedValue(updatedPlan);
      mockEvaluator.evaluate.mockResolvedValue({ action: 'NO_CHANGE' });

      await orchestrator().applyStepOutcome('t1', 'a1', 'p1', 's1', 1, 'SKIPPED', {
        error_message: 'manual skip',
      });

      expect(mockRepo.updateStepStatus).toHaveBeenCalledWith('t1', 'a1', 'p1', 's1', 'SKIPPED');
      expect(mockLedger.append).toHaveBeenCalledWith(
        expect.objectContaining({
          event_type: 'STEP_SKIPPED',
          data: expect.objectContaining({ reason: 'manual skip' }),
        })
      );
    });

    it('throws when plan not found', async () => {
      mockRepo.getPlan.mockResolvedValue(null);

      await expect(
        orchestrator().applyStepOutcome('t1', 'a1', 'p1', 's1', 1, 'DONE')
      ).rejects.toThrow(/Plan not found|p1/);
    });

    it('returns early when plan status not ACTIVE or PAUSED', async () => {
      mockRepo.getPlan.mockResolvedValue(
        plan({ plan_status: 'COMPLETED', steps: [{ step_id: 's1', action_type: 'X', status: 'DONE' }] })
      );

      await orchestrator().applyStepOutcome('t1', 'a1', 'p1', 's1', 1, 'DONE');

      expect(mockRepo.updateStepStatus).not.toHaveBeenCalled();
      expect(mockLedger.append).not.toHaveBeenCalled();
    });

    it('does not transition when evaluator returns NO_CHANGE after step outcome', async () => {
      const updatedPlan = plan({
        plan_status: 'ACTIVE',
        steps: [{ step_id: 's1', action_type: 'X', status: 'DONE' }],
      });
      mockRepo.getPlan.mockResolvedValue(updatedPlan);
      mockEvaluator.evaluate.mockResolvedValue({ action: 'NO_CHANGE' });

      await orchestrator().applyStepOutcome('t1', 'a1', 'p1', 's1', 1, 'DONE');

      expect(mockRepo.updateStepStatus).toHaveBeenCalledWith('t1', 'a1', 'p1', 's1', 'DONE');
      expect(mockLedger.append).toHaveBeenCalledWith(
        expect.objectContaining({ event_type: 'STEP_COMPLETED' })
      );
      expect(mockLifecycle.transition).not.toHaveBeenCalled();
    });

    it('returns early when getPlan(updated) returns null after step outcome', async () => {
      mockRepo.getPlan
        .mockResolvedValueOnce(
          plan({
            plan_status: 'ACTIVE',
            steps: [{ step_id: 's1', action_type: 'X', status: 'DONE' }],
          })
        )
        .mockResolvedValueOnce(null);

      await orchestrator().applyStepOutcome('t1', 'a1', 'p1', 's1', 1, 'DONE');

      expect(mockRepo.updateStepStatus).toHaveBeenCalled();
      expect(mockLedger.append).toHaveBeenCalledWith(
        expect.objectContaining({ event_type: 'STEP_COMPLETED' })
      );
      expect(mockEvaluator.evaluate).not.toHaveBeenCalled();
      expect(mockLifecycle.transition).not.toHaveBeenCalled();
    });
  });
});
