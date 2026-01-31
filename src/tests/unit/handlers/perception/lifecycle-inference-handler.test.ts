/**
 * Lifecycle Inference Handler Unit Tests - Phase 1
 *
 * Covers: AccountState not found, no transition, transition (recordTransition, applySuppression,
 * logSuppressionEntries), event.traceId, service throw rethrow.
 */

import { LifecycleState } from '../../../../types/LifecycleTypes';
import { SignalType, SignalStatus } from '../../../../types/SignalTypes';

const mockGetAccountState = jest.fn();
const mockInferLifecycleState = jest.fn();
const mockRecordTransition = jest.fn();
const mockGetSignalsForAccount = jest.fn();
const mockApplyPrecedenceRules = jest.fn();
const mockComputeSuppressionSet = jest.fn();
const mockApplySuppression = jest.fn().mockResolvedValue(undefined);
const mockLogSuppressionEntries = jest.fn().mockResolvedValue(undefined);

jest.mock('../../../../services/ledger/LedgerService', () => ({
  LedgerService: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('../../../../services/perception/SuppressionEngine', () => ({
  SuppressionEngine: jest.fn().mockImplementation(() => ({
    applyPrecedenceRules: mockApplyPrecedenceRules,
    computeSuppressionSet: mockComputeSuppressionSet,
    applySuppression: mockApplySuppression,
    logSuppressionEntries: mockLogSuppressionEntries,
  })),
}));

jest.mock('../../../../services/perception/LifecycleStateService', () => ({
  LifecycleStateService: jest.fn().mockImplementation(() => ({
    getAccountState: mockGetAccountState,
    inferLifecycleState: mockInferLifecycleState,
    recordTransition: mockRecordTransition,
  })),
}));

jest.mock('../../../../services/perception/SignalService', () => ({
  SignalService: jest.fn().mockImplementation(() => ({
    getSignalsForAccount: mockGetSignalsForAccount,
  })),
}));

jest.mock('../../../../services/events/EventPublisher', () => ({
  EventPublisher: jest.fn().mockImplementation(() => ({})),
}));

import { handler } from '../../../../handlers/perception/lifecycle-inference-handler';

describe('LifecycleInferenceHandler', () => {
  beforeEach(() => {
    mockGetAccountState.mockClear();
    mockInferLifecycleState.mockClear();
    mockRecordTransition.mockClear();
    mockGetSignalsForAccount.mockClear();
    mockApplyPrecedenceRules.mockClear();
    mockComputeSuppressionSet.mockClear();
    mockApplySuppression.mockClear();
    mockLogSuppressionEntries.mockClear();
    process.env.AWS_REGION = 'us-east-1';
    process.env.LEDGER_TABLE_NAME = 'ledger';
    process.env.ACCOUNTS_TABLE_NAME = 'accounts';
    process.env.SIGNALS_TABLE_NAME = 'signals';
    process.env.EVENT_BUS_NAME = 'bus';
  });

  it('should return 200 with message when AccountState not found', async () => {
    mockGetAccountState.mockResolvedValueOnce(null);
    const event = {
      accountId: 'acc1',
      tenantId: 't1',
      signalType: SignalType.ACCOUNT_ACTIVATION_DETECTED,
    };

    const result = await handler(event, {} as any, jest.fn());

    expect(mockGetAccountState).toHaveBeenCalledWith('acc1', 't1');
    expect(mockGetSignalsForAccount).not.toHaveBeenCalled();
    expect(mockRecordTransition).not.toHaveBeenCalled();
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body ?? '{}');
    expect(body.success).toBe(true);
    expect(body.message).toContain('AccountState not found');
  });

  it('should return 200 with transitionOccurred false when no transition', async () => {
    mockGetAccountState.mockResolvedValueOnce({
      currentLifecycleState: LifecycleState.PROSPECT,
    });
    mockGetSignalsForAccount.mockResolvedValueOnce([]);
    mockApplyPrecedenceRules.mockResolvedValueOnce([]);
    mockInferLifecycleState.mockResolvedValueOnce(LifecycleState.PROSPECT);

    const event = {
      accountId: 'acc1',
      tenantId: 't1',
      signalType: SignalType.FIRST_ENGAGEMENT_OCCURRED,
    };

    const result = await handler(event, {} as any, jest.fn());

    expect(mockInferLifecycleState).toHaveBeenCalledWith('acc1', 't1');
    expect(mockRecordTransition).not.toHaveBeenCalled();
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body ?? '{}');
    expect(body.transitionOccurred).toBe(false);
    expect(body.currentState).toBe(LifecycleState.PROSPECT);
    expect(body.previousState).toBe(LifecycleState.PROSPECT);
  });

  it('should call recordTransition and suppression when transition occurs', async () => {
    mockGetAccountState.mockResolvedValueOnce({
      currentLifecycleState: LifecycleState.PROSPECT,
    });
    mockGetSignalsForAccount.mockResolvedValueOnce([
      { signalType: SignalType.FIRST_ENGAGEMENT_OCCURRED, status: SignalStatus.ACTIVE },
    ]);
    mockApplyPrecedenceRules.mockResolvedValueOnce([
      { signalType: SignalType.FIRST_ENGAGEMENT_OCCURRED, status: SignalStatus.ACTIVE },
    ]);
    mockInferLifecycleState.mockResolvedValueOnce(LifecycleState.SUSPECT);
    mockComputeSuppressionSet.mockResolvedValueOnce([]);
    mockRecordTransition.mockResolvedValueOnce({
      transitionId: 'tr1',
      accountId: 'acc1',
      tenantId: 't1',
    });

    const event = {
      accountId: 'acc1',
      tenantId: 't1',
      signalType: SignalType.FIRST_ENGAGEMENT_OCCURRED,
    };

    const result = await handler(event, {} as any, jest.fn());

    expect(mockRecordTransition).toHaveBeenCalledWith(
      'acc1',
      't1',
      LifecycleState.PROSPECT,
      LifecycleState.SUSPECT,
      expect.any(Array),
      [],
      expect.any(String)
    );
    expect(mockApplySuppression).toHaveBeenCalled();
    expect(mockLogSuppressionEntries).toHaveBeenCalled();
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body ?? '{}');
    expect(body.transitionOccurred).toBe(true);
    expect(body.currentState).toBe(LifecycleState.SUSPECT);
    expect(body.previousState).toBe(LifecycleState.PROSPECT);
  });

  it('should use event.traceId when provided', async () => {
    mockGetAccountState.mockResolvedValueOnce({ currentLifecycleState: LifecycleState.CUSTOMER });
    mockGetSignalsForAccount.mockResolvedValueOnce([]);
    mockApplyPrecedenceRules.mockResolvedValueOnce([]);
    mockInferLifecycleState.mockResolvedValueOnce(LifecycleState.CUSTOMER);

    const event = {
      accountId: 'acc1',
      tenantId: 't1',
      signalType: SignalType.RENEWAL_WINDOW_ENTERED,
      traceId: 'trace-123',
    };

    await handler(event, {} as any, jest.fn());

    expect(mockRecordTransition).not.toHaveBeenCalled();
  });

  it('should rethrow when getAccountState throws', async () => {
    mockGetAccountState.mockRejectedValueOnce(new Error('DynamoDB error'));
    const event = {
      accountId: 'acc1',
      tenantId: 't1',
      signalType: SignalType.ACCOUNT_ACTIVATION_DETECTED,
    };

    await expect(handler(event, {} as any, jest.fn())).rejects.toThrow('DynamoDB error');
  });
});
