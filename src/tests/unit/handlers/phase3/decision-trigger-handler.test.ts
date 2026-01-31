/**
 * Decision Trigger Handler Unit Tests - Phase 3
 *
 * Covers: inferTriggerType (via payload), shouldTriggerDecision, PutEvents.
 */

const mockShouldTriggerDecision = jest.fn();
const mockEventBridgeSend = jest.fn().mockResolvedValue({});

jest.mock('../../../../services/decision/DecisionTriggerService', () => ({
  DecisionTriggerService: jest.fn().mockImplementation(() => ({
    shouldTriggerDecision: mockShouldTriggerDecision,
  })),
}));

jest.mock('@aws-sdk/client-eventbridge', () => ({
  EventBridgeClient: jest.fn().mockImplementation(() => ({ send: mockEventBridgeSend })),
  PutEventsCommand: jest.fn().mockImplementation(function (this: { input: unknown }, input: unknown) {
    this.input = input;
  }),
}));

import { handler } from '../../../../handlers/phase3/decision-trigger-handler';
import { DecisionTriggerType } from '../../../../types/DecisionTriggerTypes';
import { SignalType } from '../../../../types/SignalTypes';

describe('DecisionTriggerHandler', () => {
  beforeEach(() => {
    mockShouldTriggerDecision.mockClear();
    mockEventBridgeSend.mockClear();
    process.env.EVENT_BUS_NAME = 'cc-native-events';
  });

  it('should not call PutEvents when detail-type is unknown', async () => {
    const event = {
      source: 'unknown',
      'detail-type': 'UNKNOWN',
      detail: { account_id: 'acc1', tenant_id: 't1' },
    };

    await handler(event as any, {} as any, jest.fn());

    expect(mockShouldTriggerDecision).not.toHaveBeenCalled();
    expect(mockEventBridgeSend).not.toHaveBeenCalled();
  });

  it('should not call PutEvents when shouldTriggerDecision returns should_evaluate false', async () => {
    const event = {
      source: 'cc-native.perception',
      'detail-type': 'LIFECYCLE_STATE_CHANGED',
      detail: { account_id: 'acc1', tenant_id: 't1' },
      id: 'evt-1',
    };
    mockShouldTriggerDecision.mockResolvedValue({ should_evaluate: false, reason: 'cooldown' });

    await handler(event as any, {} as any, jest.fn());

    expect(mockShouldTriggerDecision).toHaveBeenCalledWith('acc1', 't1', DecisionTriggerType.LIFECYCLE_TRANSITION, 'evt-1');
    expect(mockEventBridgeSend).not.toHaveBeenCalled();
  });

  it('should call PutEvents with DECISION_EVALUATION_REQUESTED when LIFECYCLE_STATE_CHANGED and should_evaluate true', async () => {
    const event = {
      source: 'cc-native.perception',
      'detail-type': 'LIFECYCLE_STATE_CHANGED',
      detail: { account_id: 'acc1', tenant_id: 't1' },
      id: 'evt-1',
    };
    mockShouldTriggerDecision.mockResolvedValue({ should_evaluate: true });

    await handler(event as any, {} as any, jest.fn());

    expect(mockShouldTriggerDecision).toHaveBeenCalledWith('acc1', 't1', DecisionTriggerType.LIFECYCLE_TRANSITION, 'evt-1');
    expect(mockEventBridgeSend).toHaveBeenCalledTimes(1);
    const sent = mockEventBridgeSend.mock.calls[0][0];
    const entries = sent.input?.Entries ?? [];
    expect(entries).toHaveLength(1);
    const detail = JSON.parse(entries[0].Detail ?? '{}');
    expect(detail.trigger_type).toBe(DecisionTriggerType.LIFECYCLE_TRANSITION);
    expect(detail.account_id).toBe('acc1');
    expect(detail.tenant_id).toBe('t1');
  });

  it('should call PutEvents with HIGH_SIGNAL_ARRIVAL when SIGNAL_DETECTED and high signal type', async () => {
    const event = {
      source: 'cc-native.perception',
      'detail-type': 'SIGNAL_DETECTED',
      detail: { account_id: 'acc1', tenant_id: 't1', signal_type: SignalType.RENEWAL_WINDOW_ENTERED },
      id: 'evt-2',
    };
    mockShouldTriggerDecision.mockResolvedValue({ should_evaluate: true });

    await handler(event as any, {} as any, jest.fn());

    expect(mockShouldTriggerDecision).toHaveBeenCalledWith('acc1', 't1', DecisionTriggerType.HIGH_SIGNAL_ARRIVAL, 'evt-2');
    expect(mockEventBridgeSend).toHaveBeenCalledTimes(1);
    const sendCall = mockEventBridgeSend.mock.calls[0][0];
    const entries = sendCall.input?.Entries ?? sendCall.Entries;
    const detail = JSON.parse(entries[0].Detail);
    expect(detail.trigger_type).toBe(DecisionTriggerType.HIGH_SIGNAL_ARRIVAL);
  });

  it('should not call PutEvents when SIGNAL_DETECTED with low signal type', async () => {
    const event = {
      source: 'cc-native.perception',
      'detail-type': 'SIGNAL_DETECTED',
      detail: { account_id: 'acc1', tenant_id: 't1', signal_type: SignalType.ACCOUNT_ACTIVATION_DETECTED },
      id: 'evt-3',
    };

    await handler(event as any, {} as any, jest.fn());

    expect(mockShouldTriggerDecision).not.toHaveBeenCalled();
    expect(mockEventBridgeSend).not.toHaveBeenCalled();
  });

  it('should call PutEvents with COOLDOWN_GATED_PERIODIC when source cc-native.scheduler and PERIODIC_DECISION_EVALUATION', async () => {
    const event = {
      source: 'cc-native.scheduler',
      'detail-type': 'PERIODIC_DECISION_EVALUATION',
      detail: { account_id: 'acc1', tenant_id: 't1' },
      id: 'evt-4',
    };
    mockShouldTriggerDecision.mockResolvedValue({ should_evaluate: true });

    await handler(event as any, {} as any, jest.fn());

    expect(mockShouldTriggerDecision).toHaveBeenCalledWith('acc1', 't1', DecisionTriggerType.COOLDOWN_GATED_PERIODIC, 'evt-4');
    expect(mockEventBridgeSend).toHaveBeenCalledTimes(1);
    const sent = mockEventBridgeSend.mock.calls[0][0];
    const entries = sent.input?.Entries ?? [];
    const detail = JSON.parse(entries[0]?.Detail ?? '{}');
    expect(detail.trigger_type).toBe(DecisionTriggerType.COOLDOWN_GATED_PERIODIC);
  });

  it('should propagate error when shouldTriggerDecision throws', async () => {
    const event = {
      source: 'cc-native.perception',
      'detail-type': 'LIFECYCLE_STATE_CHANGED',
      detail: { account_id: 'acc1', tenant_id: 't1' },
    };
    mockShouldTriggerDecision.mockRejectedValue(new Error('Trigger check failed'));

    await expect(handler(event as any, {} as any, jest.fn())).rejects.toThrow('Trigger check failed');
  });

  it('should propagate error when EventBridge send throws', async () => {
    const event = {
      source: 'cc-native.perception',
      'detail-type': 'LIFECYCLE_STATE_CHANGED',
      detail: { account_id: 'acc1', tenant_id: 't1' },
    };
    mockShouldTriggerDecision.mockResolvedValue({ should_evaluate: true });
    mockEventBridgeSend.mockRejectedValueOnce(new Error('EventBridge failed'));

    await expect(handler(event as any, {} as any, jest.fn())).rejects.toThrow('EventBridge failed');
  });
});
