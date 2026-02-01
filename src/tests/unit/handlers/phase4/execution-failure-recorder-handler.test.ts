/**
 * Execution Failure Recorder Handler Unit Tests - Phase 4
 * Invokes handler from handlers/phase4/execution-failure-recorder-handler.ts
 */

const mockRecordOutcome = jest.fn();
const mockUpdateStatus = jest.fn();
const mockGetIntent = jest.fn();
const mockGetAttempt = jest.fn();
const mockAppend = jest.fn();

jest.mock('../../../../utils/aws-client-config', () => ({
  getAWSClientConfig: jest.fn().mockReturnValue({ region: 'us-east-1' }),
}));

jest.mock('@aws-sdk/client-dynamodb', () => {
  const actual = jest.requireActual('@aws-sdk/client-dynamodb');
  return { ...actual, DynamoDBClient: jest.fn().mockImplementation(() => ({})) };
});

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn().mockReturnValue({ send: jest.fn() }),
  },
}));

jest.mock('../../../../services/execution/ExecutionOutcomeService', () => ({
  ExecutionOutcomeService: jest.fn().mockImplementation(() => ({
    recordOutcome: mockRecordOutcome,
  })),
}));

jest.mock('../../../../services/execution/ExecutionAttemptService', () => ({
  ExecutionAttemptService: jest.fn().mockImplementation(() => ({
    updateStatus: mockUpdateStatus,
    getAttempt: mockGetAttempt,
  })),
}));

jest.mock('../../../../services/decision/ActionIntentService', () => ({
  ActionIntentService: jest.fn().mockImplementation(() => ({
    getIntent: mockGetIntent,
  })),
}));

jest.mock('../../../../services/ledger/LedgerService', () => ({
  LedgerService: jest.fn().mockImplementation(() => ({
    append: mockAppend,
  })),
}));

import { handler } from '../../../../handlers/phase4/execution-failure-recorder-handler';

const validEvent = {
  action_intent_id: 'ai1',
  tenant_id: 't1',
  account_id: 'acc1',
  trace_id: 'trace1',
  registry_version: 1,
  error: { Error: 'States.TaskFailed', Cause: 'Tool timeout' },
};

describe('ExecutionFailureRecorderHandler (handler-invoking)', () => {
  beforeEach(() => {
    mockRecordOutcome.mockClear();
    mockUpdateStatus.mockClear();
    mockGetIntent.mockClear();
    mockGetAttempt.mockClear();
    mockAppend.mockClear();
    mockGetIntent.mockResolvedValue({ trace_id: 'decision-trace-1', registry_version: 1 });
    mockGetAttempt.mockResolvedValue({ attempt_count: 1, started_at: new Date().toISOString() });
    mockRecordOutcome.mockResolvedValue({ completed_at: new Date().toISOString() });
  });

  it('should validate input and throw on invalid event', async () => {
    await expect(handler({} as any, {} as any, jest.fn())).rejects.toThrow(/Invalid Step Functions input/);
    expect(mockRecordOutcome).not.toHaveBeenCalled();
  });

  it('should record failure and return on valid event', async () => {
    const result = await handler(validEvent as any, {} as any, jest.fn());

    expect(mockGetIntent).toHaveBeenCalledWith('ai1', 't1', 'acc1');
    expect(mockGetAttempt).toHaveBeenCalledWith('ai1', 't1', 'acc1');
    expect(mockRecordOutcome).toHaveBeenCalledTimes(1);
    expect(mockUpdateStatus).toHaveBeenCalledWith('ai1', 't1', 'acc1', 'FAILED', expect.any(String));
    expect(mockAppend).toHaveBeenCalled();
    expect(result).toHaveProperty('success', true);
    expect(result).toHaveProperty('outcome_id');
  });

  it('should throw when ActionIntent not found', async () => {
    mockGetIntent.mockResolvedValueOnce(null);

    await expect(handler(validEvent as any, {} as any, jest.fn())).rejects.toThrow(/ActionIntent not found/);
  });

  it('should throw when execution attempt not found', async () => {
    mockGetAttempt.mockResolvedValueOnce(null);

    await expect(handler(validEvent as any, {} as any, jest.fn())).rejects.toThrow(/Execution attempt not found/);
  });

  it('should classify AUTH and record outcome with error_class AUTH', async () => {
    const eventWithAuth = {
      ...validEvent,
      error: { Cause: 'AUTH failed: token expired' },
    };
    await handler(eventWithAuth as any, {} as any, jest.fn());

    expect(mockRecordOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        error_class: 'AUTH',
        error_code: 'EXECUTION_FAILED',
      })
    );
    expect(mockUpdateStatus).toHaveBeenCalledWith('ai1', 't1', 'acc1', 'FAILED', 'AUTH');
  });

  it('should classify VALIDATION for KILL_SWITCH error', async () => {
    const eventWithKillSwitch = {
      ...validEvent,
      error: { Cause: 'KILL_SWITCH_ACTIVE: Execution disabled' },
    };
    await handler(eventWithKillSwitch as any, {} as any, jest.fn());

    expect(mockRecordOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        error_class: 'VALIDATION',
      })
    );
  });

  it('should classify VALIDATION for CONFIGURATION error', async () => {
    const eventWithConfig = {
      ...validEvent,
      error: { Cause: 'CONFIGURATION: Missing config' },
    };
    await handler(eventWithConfig as any, {} as any, jest.fn());

    expect(mockRecordOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        error_class: 'VALIDATION',
      })
    );
  });

  it('should classify UNKNOWN when error details empty', async () => {
    const eventEmptyError = {
      ...validEvent,
      error: {},
    };
    await handler(eventEmptyError as any, {} as any, jest.fn());

    expect(mockRecordOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        error_class: 'UNKNOWN',
        error_code: 'EXECUTION_FAILED',
      })
    );
  });

  it('should use VALIDATION and REGISTRY_VERSION_MISSING when registry_version is null', async () => {
    mockGetIntent.mockResolvedValueOnce({ trace_id: 'dt1', registry_version: null });
    const eventNoRegistry = {
      action_intent_id: 'ai1',
      tenant_id: 't1',
      account_id: 'acc1',
      trace_id: 'trace1',
      error: { Error: 'TaskFailed', Cause: 'Some error' },
    };
    await handler(eventNoRegistry as any, {} as any, jest.fn());

    expect(mockRecordOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        error_class: 'VALIDATION',
        error_code: 'REGISTRY_VERSION_MISSING',
        error_message: expect.stringContaining('Missing registry_version'),
        registry_version: 0,
      })
    );
    expect(mockAppend).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          error_class: 'VALIDATION',
          error_code: 'REGISTRY_VERSION_MISSING',
        }),
      })
    );
  });

  it('should append REPLAY_FAILED when is_replay and replay_reason and requested_by present', async () => {
    const eventReplay = {
      ...validEvent,
      is_replay: true,
      replay_reason: 'audit-retry',
      requested_by: 'admin@test.com',
    };
    await handler(eventReplay as any, {} as any, jest.fn());

    expect(mockAppend).toHaveBeenCalledTimes(2);
    const replayCall = mockAppend.mock.calls.find(
      (c: any[]) => c[0]?.eventType === 'REPLAY_FAILED'
    );
    expect(replayCall).toBeDefined();
    expect(replayCall[0].data).toMatchObject({
      action_intent_id: 'ai1',
      status: 'FAILED',
      replay_reason: 'audit-retry',
      requested_by: 'admin@test.com',
    });
  });

  it('should rethrow when getIntent throws', async () => {
    mockGetIntent.mockRejectedValueOnce(new Error('DynamoDB error'));

    await expect(handler(validEvent as any, {} as any, jest.fn())).rejects.toThrow('DynamoDB error');
    expect(mockRecordOutcome).not.toHaveBeenCalled();
  });
});
