/**
 * Execution Recorder Handler Unit Tests - Phase 4
 * Invokes handler from handlers/phase4/execution-recorder-handler.ts
 */

const mockRecordOutcome = jest.fn();
const mockUpdateStatus = jest.fn();
const mockGetIntent = jest.fn();
const mockAppend = jest.fn();
const mockCreateExecutionSignal = jest.fn();

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

jest.mock('../../../../services/events/EventPublisher', () => ({
  EventPublisher: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('../../../../services/perception/SignalService', () => ({
  SignalService: jest.fn().mockImplementation(() => ({
    createExecutionSignal: mockCreateExecutionSignal,
  })),
}));

import { handler } from '../../../../handlers/phase4/execution-recorder-handler';

const validEvent = {
  action_intent_id: 'ai1',
  tenant_id: 't1',
  account_id: 'acc1',
  trace_id: 'trace1',
  tool_invocation_response: {
    success: true,
    tool_run_ref: 'run1',
  },
  tool_name: 'CREATE_TASK',
  tool_schema_version: '1.0',
  registry_version: 1,
  attempt_count: 1,
  started_at: new Date().toISOString(),
};

describe('ExecutionRecorderHandler (handler-invoking)', () => {
  beforeEach(() => {
    mockRecordOutcome.mockClear();
    mockUpdateStatus.mockClear();
    mockGetIntent.mockClear();
    mockAppend.mockClear();
    mockCreateExecutionSignal.mockClear();
    mockRecordOutcome.mockResolvedValue({
      action_intent_id: 'ai1',
      status: 'SUCCEEDED',
      external_object_refs: [],
      completed_at: new Date().toISOString(),
    });
    mockGetIntent.mockResolvedValue({ trace_id: 'decision-trace-1' });
  });

  it('should validate input and throw on invalid event', async () => {
    await expect(handler({} as any, {} as any, jest.fn())).rejects.toThrow(/Invalid Step Functions input/);
    expect(mockRecordOutcome).not.toHaveBeenCalled();
  });

  it('should record outcome and return on valid event', async () => {
    const result = await handler(validEvent as any, {} as any, jest.fn());

    expect(mockRecordOutcome).toHaveBeenCalledTimes(1);
    expect(mockUpdateStatus).toHaveBeenCalledWith('ai1', 't1', 'acc1', 'SUCCEEDED');
    expect(mockGetIntent).toHaveBeenCalled();
    expect(mockAppend).toHaveBeenCalled();
    expect(mockCreateExecutionSignal).toHaveBeenCalled();
    expect(result).toHaveProperty('outcome');
    expect(result.outcome).toHaveProperty('action_intent_id', 'ai1');
  });

  it('should use FAILED status when tool_invocation_response.success is false', async () => {
    const event = { ...validEvent, tool_invocation_response: { success: false, tool_run_ref: 'run1' } };
    await handler(event as any, {} as any, jest.fn());

    expect(mockRecordOutcome).toHaveBeenCalledWith(expect.objectContaining({ status: 'FAILED' }));
    expect(mockUpdateStatus).toHaveBeenCalledWith('ai1', 't1', 'acc1', 'FAILED');
  });

  it('should rethrow when recordOutcome throws', async () => {
    mockRecordOutcome.mockRejectedValueOnce(new Error('DynamoDB error'));

    await expect(handler(validEvent as any, {} as any, jest.fn())).rejects.toThrow(/Failed to record execution outcome/);
  });
});
