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
});
