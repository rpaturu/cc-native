/**
 * Unit tests for decision-deferred-requeue-handler - Phase 5.2
 *
 * Mocks: SchedulerClient CreateScheduleCommand.
 */

const mockSchedulerSend = jest.fn();

jest.mock('@aws-sdk/client-scheduler', () => ({
  SchedulerClient: jest.fn().mockImplementation(() => ({ send: mockSchedulerSend })),
  CreateScheduleCommand: jest.fn().mockImplementation(function (this: { input: unknown }, input: unknown) {
    this.input = input;
  }),
}));

process.env.DECISION_COST_GATE_HANDLER_ARN = process.env.DECISION_COST_GATE_HANDLER_ARN || 'arn:aws:lambda:us-west-2:123:function:cost-gate';
process.env.DECISION_SCHEDULER_ROLE_ARN = process.env.DECISION_SCHEDULER_ROLE_ARN || 'arn:aws:iam::123:role/SchedulerRole';

import { handler } from '../../../../handlers/phase5/decision-deferred-requeue-handler';

const originalEnv = process.env;
const mockContext = {} as any;

function makeRunDecisionDeferredEvent(overrides: Record<string, unknown> = {}) {
  const defaultDetail: Record<string, unknown> = {
    tenant_id: 't1',
    account_id: 'a1',
    trigger_type: 'SIGNAL_ARRIVED',
    defer_until_epoch: Math.floor(Date.now() / 1000) + 300,
    retry_after_seconds: 240,
    original_idempotency_key: 'orig-key-123',
    correlation_id: 'corr-1',
  };
  const detailOverrides = (overrides.detail as Record<string, unknown>) || {};
  return {
    source: 'cc-native',
    'detail-type': 'RUN_DECISION_DEFERRED',
    detail: { ...defaultDetail, ...detailOverrides },
    ...overrides,
  };
}

describe('decision-deferred-requeue-handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSchedulerSend.mockResolvedValue({});
    process.env = { ...originalEnv };
    process.env.DECISION_COST_GATE_HANDLER_ARN = 'arn:aws:lambda:us-west-2:123:function:cost-gate';
    process.env.DECISION_SCHEDULER_ROLE_ARN = 'arn:aws:iam::123:role/SchedulerRole';
    process.env.SCHEDULE_GROUP_NAME = 'default';
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('invalid event', () => {
    it('returns without throwing when detail is missing', async () => {
      await handler({ detail: undefined } as any, mockContext, jest.fn());
      expect(mockSchedulerSend).not.toHaveBeenCalled();
    });

    it('returns without throwing when tenant_id is missing', async () => {
      await handler(
        makeRunDecisionDeferredEvent({
          detail: {
            tenant_id: '',
            account_id: 'a1',
            trigger_type: 'SIGNAL_ARRIVED',
            defer_until_epoch: 9999,
            original_idempotency_key: 'k1',
          },
        }) as any,
        mockContext,
        jest.fn()
      );
      expect(mockSchedulerSend).not.toHaveBeenCalled();
    });

    it('returns without throwing when defer_until_epoch is missing', async () => {
      const evt = makeRunDecisionDeferredEvent();
      delete (evt.detail as any).defer_until_epoch;
      await handler(evt as any, mockContext, jest.fn());
      expect(mockSchedulerSend).not.toHaveBeenCalled();
    });

    it('returns without throwing when original_idempotency_key is missing', async () => {
      const evt = makeRunDecisionDeferredEvent();
      delete (evt.detail as any).original_idempotency_key;
      await handler(evt as any, mockContext, jest.fn());
      expect(mockSchedulerSend).not.toHaveBeenCalled();
    });
  });

  describe('valid event', () => {
    it('calls CreateSchedule with correct Name, GroupName, ScheduleExpression, Target', async () => {
      const deferUntilEpoch = 2000000000;
      const evt = makeRunDecisionDeferredEvent({
        detail: {
          tenant_id: 't1',
          account_id: 'a1',
          trigger_type: 'SIGNAL_ARRIVED',
          defer_until_epoch: deferUntilEpoch,
          retry_after_seconds: 100,
          original_idempotency_key: 'orig-xyz',
          correlation_id: 'c1',
        },
      });
      await handler(evt as any, mockContext, jest.fn());
      expect(mockSchedulerSend).toHaveBeenCalledTimes(1);
      const cmd = mockSchedulerSend.mock.calls[0][0];
      expect(cmd.input).toBeDefined();
      const input = (cmd as { input: Record<string, unknown> }).input;
      const target = input.Target as Record<string, unknown> | undefined;
      expect(input.Name).toBeDefined();
      expect(String(input.Name)).toContain('t1');
      expect(String(input.Name)).toContain('a1');
      expect(String(input.Name)).toContain(String(deferUntilEpoch));
      expect(input.GroupName).toBe('default');
      expect(input.ScheduleExpression).toContain('at(');
      expect(target).toBeDefined();
      expect(target?.Arn).toBe('arn:aws:lambda:us-west-2:123:function:cost-gate');
      expect(target?.RoleArn).toBe('arn:aws:iam::123:role/SchedulerRole');
      expect(target?.Input).toBeDefined();
      const targetInput = JSON.parse((target?.Input as string) ?? '{}');
      expect(targetInput['detail-type']).toBe('RUN_DECISION');
      expect(targetInput.detail.tenant_id).toBe('t1');
      expect(targetInput.detail.account_id).toBe('a1');
      expect(targetInput.detail.trigger_type).toBe('SIGNAL_ARRIVED');
      expect(targetInput.detail.idempotency_key).toBeDefined();
      expect(targetInput.detail.idempotency_key).not.toBe('orig-xyz');
      expect(targetInput.detail.correlation_id).toBe('c1');
      expect(input.ActionAfterCompletion).toBe('DELETE');
      expect(targetInput.detail.idempotency_key).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe('error handling', () => {
    it('throws when CreateSchedule fails', async () => {
      mockSchedulerSend.mockRejectedValue(new Error('Scheduler error'));
      await expect(
        handler(makeRunDecisionDeferredEvent() as any, mockContext, jest.fn())
      ).rejects.toThrow('Scheduler error');
    });
  });
});
