/**
 * PlanLifecycleService — Phase 6.1 transition matrix and edge cases.
 */

import { PlanLifecycleService } from '../../../services/plan/PlanLifecycleService';
import { PlanRepositoryService } from '../../../services/plan/PlanRepositoryService';
import { PlanLedgerService } from '../../../services/plan/PlanLedgerService';
import { Logger } from '../../../services/core/Logger';
import { RevenuePlanV1 } from '../../../types/plan/PlanTypes';
import { mockDynamoDBDocumentClient, resetAllMocks } from '../../__mocks__/aws-sdk-clients';

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn(() => mockDynamoDBDocumentClient) },
  PutCommand: jest.fn().mockImplementation((params: Record<string, unknown>) => ({ input: params })),
  UpdateCommand: jest.fn().mockImplementation((params: Record<string, unknown>) => ({ input: params })),
  GetCommand: jest.fn().mockImplementation((params: Record<string, unknown>) => ({ input: params })),
  QueryCommand: jest.fn().mockImplementation((params: Record<string, unknown>) => ({ input: params })),
}));

function plan(overrides: Partial<RevenuePlanV1> = {}): RevenuePlanV1 {
  const now = new Date().toISOString();
  return {
    plan_id: 'plan-1',
    plan_type: 'RENEWAL_DEFENSE',
    account_id: 'acc-1',
    tenant_id: 't1',
    objective: 'Renew',
    plan_status: 'DRAFT',
    steps: [],
    expires_at: now,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

describe('PlanLifecycleService', () => {
  let repo: PlanRepositoryService;
  let ledger: PlanLedgerService;
  let lifecycle: PlanLifecycleService;
  let logger: Logger;

  beforeEach(() => {
    resetAllMocks();
    logger = new Logger('PlanLifecycleTest');
    repo = new PlanRepositoryService(logger, { tableName: 'RevenuePlans' });
    ledger = new PlanLedgerService(logger, { tableName: 'PlanLedger' });
    lifecycle = new PlanLifecycleService({ planRepository: repo, planLedger: ledger, logger });
  });

  function mockUpdatePlanStatusAndLedger(plan: RevenuePlanV1) {
    const withKeys = {
      ...plan,
      pk: `TENANT#${plan.tenant_id}#ACCOUNT#${plan.account_id}`,
      sk: `PLAN#${plan.plan_id}`,
      gsi1pk: 'x',
      gsi1sk: 'y',
      gsi2pk: 'z',
      gsi2sk: 'w',
    };
    mockDynamoDBDocumentClient.send
      .mockResolvedValueOnce({ Item: withKeys })
      .mockResolvedValue({});
  }

  describe('allowed transitions', () => {
    it('DRAFT → APPROVED updates repo and appends PLAN_APPROVED', async () => {
      const p = plan({ plan_status: 'DRAFT' });
      mockUpdatePlanStatusAndLedger(p);
      await lifecycle.transition(p, 'APPROVED');
      expect(mockDynamoDBDocumentClient.send).toHaveBeenCalled();
      const putCalls = (mockDynamoDBDocumentClient.send as jest.Mock).mock.calls.filter(
        (c: unknown[]) => (c[0] as { input?: { TableName?: string } })?.input?.TableName === 'PlanLedger'
      );
      expect(putCalls.length).toBeGreaterThanOrEqual(1);
      const putInput = putCalls[0][0].input;
      expect(putInput.Item?.event_type).toBe('PLAN_APPROVED');
    });

    it('APPROVED → ACTIVE appends PLAN_ACTIVATED', async () => {
      const p = plan({ plan_status: 'APPROVED' });
      mockUpdatePlanStatusAndLedger(p);
      await lifecycle.transition(p, 'ACTIVE');
      const putCalls = (mockDynamoDBDocumentClient.send as jest.Mock).mock.calls.filter(
        (c: unknown[]) => (c[0] as { input?: { TableName?: string } })?.input?.TableName === 'PlanLedger'
      );
      expect(putCalls.some((c: unknown[]) => (c[0] as { input?: { Item?: { event_type?: string } } })?.input?.Item?.event_type === 'PLAN_ACTIVATED')).toBe(true);
    });

    it('ACTIVE → PAUSED appends PLAN_PAUSED with reason', async () => {
      const p = plan({ plan_status: 'ACTIVE' });
      mockUpdatePlanStatusAndLedger(p);
      await lifecycle.transition(p, 'PAUSED', { reason: 'Manual pause' });
      const putCalls = (mockDynamoDBDocumentClient.send as jest.Mock).mock.calls.filter(
        (c: unknown[]) => (c[0] as { input?: { TableName?: string } })?.input?.TableName === 'PlanLedger'
      );
      expect(putCalls.some((c: unknown[]) => (c[0] as { input?: { Item?: { event_type?: string; data?: { reason?: string } } } })?.input?.Item?.event_type === 'PLAN_PAUSED')).toBe(true);
    });

    it('PAUSED → ACTIVE appends PLAN_RESUMED', async () => {
      const p = plan({ plan_status: 'PAUSED' });
      mockUpdatePlanStatusAndLedger(p);
      await lifecycle.transition(p, 'ACTIVE');
      const putCalls = (mockDynamoDBDocumentClient.send as jest.Mock).mock.calls.filter(
        (c: unknown[]) => (c[0] as { input?: { TableName?: string } })?.input?.TableName === 'PlanLedger'
      );
      expect(putCalls.some((c: unknown[]) => (c[0] as { input?: { Item?: { event_type?: string } } })?.input?.Item?.event_type === 'PLAN_RESUMED')).toBe(true);
    });

    it('ACTIVE → COMPLETED appends PLAN_COMPLETED', async () => {
      const p = plan({ plan_status: 'ACTIVE' });
      mockUpdatePlanStatusAndLedger(p);
      await lifecycle.transition(p, 'COMPLETED', { completion_reason: 'objective_met' });
      const putCalls = (mockDynamoDBDocumentClient.send as jest.Mock).mock.calls.filter(
        (c: unknown[]) => (c[0] as { input?: { TableName?: string } })?.input?.TableName === 'PlanLedger'
      );
      expect(putCalls.some((c: unknown[]) => (c[0] as { input?: { Item?: { event_type?: string } } })?.input?.Item?.event_type === 'PLAN_COMPLETED')).toBe(true);
    });

    it('ACTIVE → ABORTED appends PLAN_ABORTED', async () => {
      const p = plan({ plan_status: 'ACTIVE' });
      mockUpdatePlanStatusAndLedger(p);
      await lifecycle.transition(p, 'ABORTED', { reason: 'Cancelled' });
      const putCalls = (mockDynamoDBDocumentClient.send as jest.Mock).mock.calls.filter(
        (c: unknown[]) => (c[0] as { input?: { TableName?: string } })?.input?.TableName === 'PlanLedger'
      );
      expect(putCalls.some((c: unknown[]) => (c[0] as { input?: { Item?: { event_type?: string } } })?.input?.Item?.event_type === 'PLAN_ABORTED')).toBe(true);
    });

    it('ACTIVE → EXPIRED appends PLAN_EXPIRED', async () => {
      const p = plan({ plan_status: 'ACTIVE' });
      mockUpdatePlanStatusAndLedger(p);
      await lifecycle.transition(p, 'EXPIRED', { expired_at: new Date().toISOString() });
      const putCalls = (mockDynamoDBDocumentClient.send as jest.Mock).mock.calls.filter(
        (c: unknown[]) => (c[0] as { input?: { TableName?: string } })?.input?.TableName === 'PlanLedger'
      );
      expect(putCalls.some((c: unknown[]) => (c[0] as { input?: { Item?: { event_type?: string } } })?.input?.Item?.event_type === 'PLAN_EXPIRED')).toBe(true);
    });

    it('PAUSED → ABORTED appends PLAN_ABORTED', async () => {
      const p = plan({ plan_status: 'PAUSED' });
      mockUpdatePlanStatusAndLedger(p);
      await lifecycle.transition(p, 'ABORTED', { reason: 'Cancelled' });
      const putCalls = (mockDynamoDBDocumentClient.send as jest.Mock).mock.calls.filter(
        (c: unknown[]) => (c[0] as { input?: { TableName?: string } })?.input?.TableName === 'PlanLedger'
      );
      expect(putCalls.some((c: unknown[]) => (c[0] as { input?: { Item?: { event_type?: string } } })?.input?.Item?.event_type === 'PLAN_ABORTED')).toBe(true);
    });

    it('APPROVED → ABORTED appends PLAN_ABORTED', async () => {
      const p = plan({ plan_status: 'APPROVED' });
      mockUpdatePlanStatusAndLedger(p);
      await lifecycle.transition(p, 'ABORTED', { reason: 'Cancelled' });
      const putCalls = (mockDynamoDBDocumentClient.send as jest.Mock).mock.calls.filter(
        (c: unknown[]) => (c[0] as { input?: { TableName?: string } })?.input?.TableName === 'PlanLedger'
      );
      expect(putCalls.some((c: unknown[]) => (c[0] as { input?: { Item?: { event_type?: string } } })?.input?.Item?.event_type === 'PLAN_ABORTED')).toBe(true);
    });
  });

  describe('disallowed transitions', () => {
    it('DRAFT → ACTIVE rejects', async () => {
      const p = plan({ plan_status: 'DRAFT' });
      await expect(lifecycle.transition(p, 'ACTIVE')).rejects.toThrow(/invalid transition/);
    });

    it('COMPLETED → ACTIVE rejects (terminal)', async () => {
      const p = plan({ plan_status: 'COMPLETED' });
      await expect(lifecycle.transition(p, 'ACTIVE')).rejects.toThrow(/invalid transition/);
    });

    it('same status rejects', async () => {
      const p = plan({ plan_status: 'DRAFT' });
      await expect(lifecycle.transition(p, 'DRAFT')).rejects.toThrow(/same status/);
    });

    it('null toStatus rejects', async () => {
      const p = plan({ plan_status: 'DRAFT' });
      await expect(lifecycle.transition(p, null as unknown as 'APPROVED')).rejects.toThrow(/toStatus is required/);
    });

    it('DRAFT → PAUSED rejects', async () => {
      const p = plan({ plan_status: 'DRAFT' });
      await expect(lifecycle.transition(p, 'PAUSED')).rejects.toThrow(/invalid transition/);
    });

    it('APPROVED → PAUSED rejects', async () => {
      const p = plan({ plan_status: 'APPROVED' });
      await expect(lifecycle.transition(p, 'PAUSED')).rejects.toThrow(/invalid transition/);
    });

    it('APPROVED → COMPLETED rejects', async () => {
      const p = plan({ plan_status: 'APPROVED' });
      await expect(lifecycle.transition(p, 'COMPLETED')).rejects.toThrow(/invalid transition/);
    });

    it('ACTIVE → DRAFT rejects', async () => {
      const p = plan({ plan_status: 'ACTIVE' });
      await expect(lifecycle.transition(p, 'DRAFT')).rejects.toThrow(/invalid transition/);
    });

    it('ACTIVE → APPROVED rejects', async () => {
      const p = plan({ plan_status: 'ACTIVE' });
      await expect(lifecycle.transition(p, 'APPROVED')).rejects.toThrow(/invalid transition/);
    });

    it('PAUSED → DRAFT rejects', async () => {
      const p = plan({ plan_status: 'PAUSED' });
      await expect(lifecycle.transition(p, 'DRAFT')).rejects.toThrow(/invalid transition/);
    });

    it('PAUSED → APPROVED rejects', async () => {
      const p = plan({ plan_status: 'PAUSED' });
      await expect(lifecycle.transition(p, 'APPROVED')).rejects.toThrow(/invalid transition/);
    });

    it('ABORTED → ACTIVE rejects (terminal)', async () => {
      const p = plan({ plan_status: 'ABORTED' });
      await expect(lifecycle.transition(p, 'ACTIVE')).rejects.toThrow(/invalid transition/);
    });

    it('EXPIRED → ACTIVE rejects (terminal)', async () => {
      const p = plan({ plan_status: 'EXPIRED' });
      await expect(lifecycle.transition(p, 'ACTIVE')).rejects.toThrow(/invalid transition/);
    });
  });
});
