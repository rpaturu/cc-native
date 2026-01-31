/**
 * Unit tests for decision-cost-gate-handler - Phase 5.2
 *
 * Mocks: DecisionRunStateService, DecisionIdempotencyStoreService, DecisionCostGateService, EventBridgeClient.
 */

const mockTryReserve = jest.fn();
const mockGetState = jest.fn();
const mockTryAcquireAdmissionLock = jest.fn();
const mockCostGateEvaluate = jest.fn();
const mockEventBridgeSend = jest.fn();

jest.mock('../../../../services/decision/DecisionIdempotencyStoreService', () => ({
  DecisionIdempotencyStoreService: jest.fn().mockImplementation(() => ({
    tryReserve: mockTryReserve,
  })),
}));

jest.mock('../../../../services/decision/DecisionRunStateService', () => ({
  DecisionRunStateService: jest.fn().mockImplementation(() => ({
    getState: mockGetState,
    tryAcquireAdmissionLock: mockTryAcquireAdmissionLock,
  })),
}));

jest.mock('../../../../services/decision/DecisionCostGateService', () => {
  const actual = jest.requireActual('../../../../services/decision/DecisionCostGateService');
  return {
    ...actual,
    DecisionCostGateService: jest.fn().mockImplementation(() => ({
      evaluate: mockCostGateEvaluate,
    })),
  };
});

jest.mock('@aws-sdk/client-eventbridge', () => ({
  EventBridgeClient: jest.fn().mockImplementation(() => ({ send: mockEventBridgeSend })),
  PutEventsCommand: jest.fn().mockImplementation(function (this: { input: unknown }, input: unknown) {
    this.input = input;
  }),
}));

import { handler } from '../../../../handlers/phase5/decision-cost-gate-handler';

const mockContext = {} as any;

function makeRunDecisionEvent(overrides: Record<string, unknown> = {}) {
  return {
    source: 'cc-native',
    'detail-type': 'RUN_DECISION',
    id: 'evt-123',
    detail: {
      tenant_id: 't1',
      account_id: 'a1',
      trigger_type: 'SIGNAL_ARRIVED',
      scheduled_at: new Date().toISOString(),
      idempotency_key: 'key-' + Date.now(),
      correlation_id: 'corr-1',
      ...overrides,
    },
    ...overrides,
  };
}

describe('decision-cost-gate-handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEventBridgeSend.mockResolvedValue({});
    mockTryReserve.mockResolvedValue(true);
    mockGetState.mockResolvedValue(null);
    mockTryAcquireAdmissionLock.mockResolvedValue({ acquired: true });
    mockCostGateEvaluate.mockReturnValue({
      result: 'ALLOW',
      evaluated_at: new Date().toISOString(),
    });
  });

  describe('invalid event', () => {
    it('returns without throwing when detail is missing', async () => {
      await handler({ detail: undefined } as any, mockContext, jest.fn());
      expect(mockTryReserve).not.toHaveBeenCalled();
    });

    it('returns without throwing when tenant_id is missing', async () => {
      await handler(
        makeRunDecisionEvent({ detail: { tenant_id: '', account_id: 'a1', trigger_type: 'SIGNAL_ARRIVED', idempotency_key: 'k1' } }) as any,
        mockContext,
        jest.fn()
      );
      expect(mockTryReserve).not.toHaveBeenCalled();
    });

    it('returns without throwing when idempotency_key is missing', async () => {
      const evt = makeRunDecisionEvent();
      delete (evt.detail as any).idempotency_key;
      await handler(evt as any, mockContext, jest.fn());
      expect(mockTryReserve).not.toHaveBeenCalled();
    });
  });

  describe('idempotency duplicate', () => {
    it('does not call Phase 3 or DEFER when tryReserve returns false', async () => {
      mockTryReserve.mockResolvedValue(false);
      await handler(makeRunDecisionEvent() as any, mockContext, jest.fn());
      expect(mockTryReserve).toHaveBeenCalled();
      expect(mockCostGateEvaluate).not.toHaveBeenCalled();
      expect(mockEventBridgeSend).not.toHaveBeenCalled();
    });
  });

  describe('CostGate SKIP', () => {
    it('does not publish DECISION_EVALUATION_REQUESTED or RUN_DECISION_DEFERRED when result is SKIP', async () => {
      mockCostGateEvaluate.mockReturnValue({
        result: 'SKIP',
        reason: 'BUDGET_EXHAUSTED',
        explanation: 'Run-count budget exhausted',
        evaluated_at: new Date().toISOString(),
      });
      await handler(makeRunDecisionEvent() as any, mockContext, jest.fn());
      expect(mockTryAcquireAdmissionLock).not.toHaveBeenCalled();
      expect(mockEventBridgeSend).not.toHaveBeenCalled();
    });
  });

  describe('CostGate DEFER', () => {
    it('publishes RUN_DECISION_DEFERRED with defer_until_epoch and original_idempotency_key when result is DEFER', async () => {
      const deferUntil = Math.floor(Date.now() / 1000) + 300;
      mockCostGateEvaluate.mockReturnValue({
        result: 'DEFER',
        reason: 'COOLDOWN',
        explanation: 'Cooldown remaining',
        evaluated_at: new Date().toISOString(),
        defer_until_epoch: deferUntil,
        retry_after_seconds: 240,
      });
      const evt = makeRunDecisionEvent();
      const idempotencyKey = (evt.detail as any).idempotency_key;
      await handler(evt as any, mockContext, jest.fn());
      expect(mockTryAcquireAdmissionLock).not.toHaveBeenCalled();
      expect(mockEventBridgeSend).toHaveBeenCalledTimes(1);
      const sent = mockEventBridgeSend.mock.calls[0][0];
      expect(sent.input?.Entries?.[0]?.DetailType).toBe('RUN_DECISION_DEFERRED');
      const detail = JSON.parse(sent.input?.Entries?.[0]?.Detail ?? '{}');
      expect(detail.tenant_id).toBe('t1');
      expect(detail.account_id).toBe('a1');
      expect(detail.defer_until_epoch).toBe(deferUntil);
      expect(detail.retry_after_seconds).toBe(240);
      expect(detail.original_idempotency_key).toBe(idempotencyKey);
    });
  });

  describe('CostGate ALLOW', () => {
    it('acquires lock and publishes DECISION_EVALUATION_REQUESTED when lock acquired', async () => {
      mockTryAcquireAdmissionLock.mockResolvedValue({ acquired: true });
      const evt = makeRunDecisionEvent();
      await handler(evt as any, mockContext, jest.fn());
      expect(mockTryAcquireAdmissionLock).toHaveBeenCalledWith('t1', 'a1', 'SIGNAL_ARRIVED', expect.any(Object));
      expect(mockEventBridgeSend).toHaveBeenCalledTimes(1);
      const sent = mockEventBridgeSend.mock.calls[0][0];
      expect(sent.input?.Entries?.[0]?.DetailType).toBe('DECISION_EVALUATION_REQUESTED');
      const detail = JSON.parse(sent.input?.Entries?.[0]?.Detail ?? '{}');
      expect(detail.tenant_id).toBe('t1');
      expect(detail.account_id).toBe('a1');
      expect(detail.trigger_type).toBe('SIGNAL_ARRIVED');
      expect(detail.trigger_event_id).toBe('evt-123');
    });

    it('publishes RUN_DECISION_DEFERRED when lock not acquired after ALLOW', async () => {
      mockTryAcquireAdmissionLock.mockResolvedValue({ acquired: false, reason: 'COOLDOWN' });
      await handler(makeRunDecisionEvent() as any, mockContext, jest.fn());
      expect(mockEventBridgeSend).toHaveBeenCalledTimes(1);
      const sent = mockEventBridgeSend.mock.calls[0][0];
      expect(sent.input?.Entries?.[0]?.DetailType).toBe('RUN_DECISION_DEFERRED');
    });
  });

  describe('unknown trigger type', () => {
    it('returns without publishing when trigger_type not in DEFAULT_TRIGGER_REGISTRY', async () => {
      mockGetState.mockResolvedValue(null);
      const evt = makeRunDecisionEvent();
      (evt.detail as any).trigger_type = 'UNKNOWN_TYPE' as any;
      await handler(evt as any, mockContext, jest.fn());
      expect(mockCostGateEvaluate).not.toHaveBeenCalled();
      expect(mockEventBridgeSend).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('throws when idempotencyStore.tryReserve throws', async () => {
      mockTryReserve.mockRejectedValue(new Error('DynamoDB error'));
      await expect(handler(makeRunDecisionEvent() as any, mockContext, jest.fn())).rejects.toThrow('DynamoDB error');
    });

    it('throws when runStateService.getState throws', async () => {
      mockGetState.mockRejectedValue(new Error('DynamoDB error'));
      await expect(handler(makeRunDecisionEvent() as any, mockContext, jest.fn())).rejects.toThrow('DynamoDB error');
    });

    it('throws when publishDecisionEvaluationRequested throws', async () => {
      mockEventBridgeSend.mockRejectedValue(new Error('EventBridge error'));
      await expect(handler(makeRunDecisionEvent() as any, mockContext, jest.fn())).rejects.toThrow('EventBridge error');
    });
  });
});
