/**
 * Synthesis Engine Handler Unit Tests - Phase 2
 *
 * Covers: validation (missing fields), status not COMPLETED (skip synthesis),
 * happy path (synthesize, writePostureState, append, 200), error rethrow.
 */

const mockSend = jest.fn();
const mockSynthesize = jest.fn();
const mockWritePostureState = jest.fn().mockResolvedValue(undefined);
const mockAppend = jest.fn().mockResolvedValue(undefined);
const mockNeptuneInitialize = jest.fn().mockResolvedValue(undefined);
const mockUpsertVertex = jest.fn().mockResolvedValue(undefined);
const mockUpsertEdge = jest.fn().mockResolvedValue(undefined);

jest.mock('../../../../utils/aws-client-config', () => ({
  getAWSClientConfig: jest.fn().mockReturnValue({ region: 'us-east-1' }),
}));

jest.mock('@aws-sdk/client-dynamodb', () => {
  const actual = jest.requireActual('@aws-sdk/client-dynamodb');
  return {
    ...actual,
    DynamoDBClient: jest.fn().mockImplementation(() => ({})),
  };
});

jest.mock('@aws-sdk/lib-dynamodb', () => {
  const actual = jest.requireActual('@aws-sdk/lib-dynamodb');
  return {
    ...actual,
    DynamoDBDocumentClient: {
      from: jest.fn().mockReturnValue({ send: mockSend }),
    },
  };
});

jest.mock('../../../../services/ledger/LedgerService', () => ({
  LedgerService: jest.fn().mockImplementation(() => ({
    append: mockAppend,
  })),
}));

jest.mock('../../../../services/perception/SuppressionEngine', () => ({
  SuppressionEngine: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('../../../../services/perception/LifecycleStateService', () => ({
  LifecycleStateService: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('../../../../services/perception/SignalService', () => ({
  SignalService: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('../../../../services/events/EventPublisher', () => ({
  EventPublisher: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('../../../../services/synthesis/SynthesisEngine', () => ({
  SynthesisEngine: jest.fn().mockImplementation(() => ({
    synthesize: mockSynthesize,
  })),
}));

jest.mock('../../../../services/synthesis/AccountPostureStateService', () => ({
  AccountPostureStateService: jest.fn().mockImplementation(() => ({
    writePostureState: mockWritePostureState,
  })),
}));

jest.mock('../../../../services/graph/NeptuneConnection', () => ({
  NeptuneConnection: {
    getInstance: jest.fn().mockReturnValue({
      initialize: mockNeptuneInitialize,
    }),
  },
}));

jest.mock('../../../../services/graph/GraphService', () => ({
  GraphService: jest.fn().mockImplementation(() => ({
    upsertVertex: mockUpsertVertex,
    upsertEdge: mockUpsertEdge,
  })),
}));

import { handler } from '../../../../handlers/phase2/synthesis-engine-handler';

const samplePostureState = {
  tenantId: 't1',
  account_id: 'acc1',
  posture: 'GROWTH',
  rule_id: 'r1',
  inputs_hash: 'h1',
  momentum: 1,
  ruleset_version: 'v1',
  active_signals_hash: 'ash1',
  risk_factors: [],
  opportunities: [],
  unknowns: [],
};

describe('SynthesisEngineHandler', () => {
  beforeEach(() => {
    mockSend.mockClear();
    mockSynthesize.mockClear();
    mockWritePostureState.mockClear();
    mockAppend.mockClear();
    mockNeptuneInitialize.mockClear();
    mockUpsertVertex.mockClear();
    mockUpsertEdge.mockClear();
    process.env.AWS_REGION = 'us-east-1';
    process.env.LEDGER_TABLE_NAME = 'ledger';
    process.env.ACCOUNTS_TABLE_NAME = 'accounts';
    process.env.SIGNALS_TABLE_NAME = 'signals';
    process.env.EVENT_BUS_NAME = 'bus';
    process.env.GRAPH_MATERIALIZATION_STATUS_TABLE_NAME = 'status';
    process.env.ACCOUNT_POSTURE_STATE_TABLE_NAME = 'posture';
    process.env.NEPTUNE_CLUSTER_ENDPOINT = 'neptune.example.com';
    mockSend.mockResolvedValue({
      Item: {
        pk: 'SIGNAL#t1#sig1',
        status: 'COMPLETED',
        trace_id: 'trace-1',
        updated_at: new Date().toISOString(),
      },
    });
    mockSynthesize.mockResolvedValue(samplePostureState);
  });

  it('should return 200 with success true when synthesis completes', async () => {
    const event = {
      source: 'cc-native.graph',
      'detail-type': 'GRAPH_MATERIALIZED',
      detail: {
        accountId: 'acc1',
        tenantId: 't1',
        signalId: 'sig1',
      },
    };

    const result = await handler(event as any, {} as any, jest.fn());

    expect(mockSend).toHaveBeenCalled();
    expect(mockSynthesize).toHaveBeenCalledWith('acc1', 't1', expect.any(String));
    expect(mockWritePostureState).toHaveBeenCalledWith(samplePostureState);
    expect(mockAppend).toHaveBeenCalled();
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body ?? '{}');
    expect(body.success).toBe(true);
    expect(body.accountId).toBe('acc1');
    expect(body.tenantId).toBe('t1');
    expect(body.posture).toBe('GROWTH');
  });

  it('should return 200 with success false when graph materialization status is not COMPLETED', async () => {
    mockSend.mockResolvedValueOnce({
      Item: {
        pk: 'SIGNAL#t1#sig1',
        status: 'IN_PROGRESS',
        trace_id: 'trace-1',
        updated_at: new Date().toISOString(),
      },
    });
    const event = {
      source: 'cc-native.graph',
      'detail-type': 'GRAPH_MATERIALIZED',
      detail: {
        accountId: 'acc1',
        tenantId: 't1',
        signalId: 'sig1',
      },
    };

    const result = await handler(event as any, {} as any, jest.fn());

    expect(mockSynthesize).not.toHaveBeenCalled();
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body ?? '{}');
    expect(body.success).toBe(false);
    expect(body.reason).toContain('Graph materialization not completed');
  });

  it('should return 200 with success false when status item is not found', async () => {
    mockSend.mockResolvedValueOnce({ Item: undefined });
    const event = {
      source: 'cc-native.graph',
      'detail-type': 'GRAPH_MATERIALIZED',
      detail: {
        accountId: 'acc1',
        tenantId: 't1',
        signalId: 'sig1',
      },
    };

    const result = await handler(event as any, {} as any, jest.fn());

    expect(mockSynthesize).not.toHaveBeenCalled();
    const body = JSON.parse(result.body ?? '{}');
    expect(body.success).toBe(false);
  });

  it('should throw when required event fields are missing', async () => {
    const event = {
      source: 'cc-native.graph',
      'detail-type': 'GRAPH_MATERIALIZED',
      detail: {
        accountId: '',
        tenantId: 't1',
        signalId: 'sig1',
      },
    };

    await expect(handler(event as any, {} as any, jest.fn())).rejects.toThrow(
      'Missing required event fields: accountId, tenantId, signalId'
    );
  });

  it('should rethrow when synthesize throws', async () => {
    mockSynthesize.mockRejectedValueOnce(new Error('Synthesis failed'));
    const event = {
      source: 'cc-native.graph',
      'detail-type': 'GRAPH_MATERIALIZED',
      detail: {
        accountId: 'acc1',
        tenantId: 't1',
        signalId: 'sig1',
      },
    };

    await expect(handler(event as any, {} as any, jest.fn())).rejects.toThrow('Synthesis failed');
  });

  it('should use event.detail.traceId and event.time when provided', async () => {
    const event = {
      source: 'cc-native.graph',
      'detail-type': 'GRAPH_MATERIALIZED',
      time: '2025-01-01T00:00:00Z',
      detail: {
        accountId: 'acc1',
        tenantId: 't1',
        signalId: 'sig1',
        traceId: 'trace-123',
      },
    };

    await handler(event as any, {} as any, jest.fn());

    expect(mockSynthesize).toHaveBeenCalledWith('acc1', 't1', '2025-01-01T00:00:00Z');
  });
});
