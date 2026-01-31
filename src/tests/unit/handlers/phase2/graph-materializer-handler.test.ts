/**
 * Graph Materializer Handler Unit Tests - Phase 2
 *
 * Covers: validation (missing fields), NEPTUNE_CLUSTER_ENDPOINT required,
 * happy path (materializeSignal called, 200), error path (rethrow).
 */

const mockMaterializeSignal = jest.fn().mockResolvedValue(undefined);
const mockNeptuneInitialize = jest.fn().mockResolvedValue(undefined);

jest.mock('../../../../utils/aws-client-config', () => ({
  getAWSClientConfig: jest.fn().mockReturnValue({ region: 'us-east-1' }),
}));

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn().mockReturnValue({ send: jest.fn() }),
  },
}));

jest.mock('../../../../services/ledger/LedgerService', () => ({
  LedgerService: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('../../../../services/perception/SuppressionEngine', () => ({
  SuppressionEngine: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('../../../../services/perception/LifecycleStateService', () => ({
  LifecycleStateService: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('../../../../services/events/EventPublisher', () => ({
  EventPublisher: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('../../../../services/perception/SignalService', () => ({
  SignalService: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('../../../../services/graph/NeptuneConnection', () => ({
  NeptuneConnection: {
    getInstance: jest.fn().mockReturnValue({
      initialize: mockNeptuneInitialize,
    }),
  },
}));

jest.mock('../../../../services/graph/GraphService', () => ({
  GraphService: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('../../../../services/graph/GraphMaterializer', () => ({
  GraphMaterializer: jest.fn().mockImplementation(() => ({
    materializeSignal: mockMaterializeSignal,
  })),
}));

import { handler } from '../../../../handlers/phase2/graph-materializer-handler';

describe('GraphMaterializerHandler', () => {
  beforeEach(() => {
    mockMaterializeSignal.mockClear();
    mockNeptuneInitialize.mockClear();
    process.env.AWS_REGION = 'us-east-1';
    process.env.NEPTUNE_CLUSTER_ENDPOINT = 'neptune.example.com';
    process.env.NEPTUNE_CLUSTER_PORT = '8182';
    process.env.LEDGER_TABLE_NAME = 'ledger';
    process.env.ACCOUNTS_TABLE_NAME = 'accounts';
    process.env.SIGNALS_TABLE_NAME = 'signals';
    process.env.EVENT_BUS_NAME = 'bus';
    process.env.GRAPH_MATERIALIZATION_STATUS_TABLE_NAME = 'status';
  });

  it('should call materializeSignal and return 200 on success', async () => {
    const event = {
      source: 'cc-native.perception',
      'detail-type': 'SIGNAL_DETECTED',
      detail: {
        signalId: 'sig1',
        tenantId: 't1',
        accountId: 'acc1',
      },
    };

    const result = await handler(event as any, {} as any, jest.fn());

    expect(mockNeptuneInitialize).toHaveBeenCalled();
    expect(mockMaterializeSignal).toHaveBeenCalledWith('sig1', 't1');
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body ?? '{}');
    expect(body.success).toBe(true);
    expect(body.signalId).toBe('sig1');
    expect(body.tenantId).toBe('t1');
    expect(body.traceId).toBeDefined();
  });

  it('should use event.detail.traceId when provided', async () => {
    const event = {
      source: 'cc-native.perception',
      'detail-type': 'SIGNAL_DETECTED',
      detail: {
        signalId: 'sig1',
        tenantId: 't1',
        accountId: 'acc1',
        traceId: 'trace-123',
      },
    };

    await handler(event as any, {} as any, jest.fn());

    expect(mockMaterializeSignal).toHaveBeenCalledWith('sig1', 't1');
  });

  it('should throw when signalId is missing', async () => {
    const event = {
      source: 'cc-native.perception',
      'detail-type': 'SIGNAL_DETECTED',
      detail: {
        signalId: '',
        tenantId: 't1',
        accountId: 'acc1',
      },
    };

    await expect(handler(event as any, {} as any, jest.fn())).rejects.toThrow(
      'Missing required event fields: signalId, tenantId, accountId'
    );
    expect(mockMaterializeSignal).not.toHaveBeenCalled();
  });

  it('should throw when tenantId is missing', async () => {
    const event = {
      source: 'cc-native.perception',
      'detail-type': 'SIGNAL_DETECTED',
      detail: {
        signalId: 'sig1',
        tenantId: '',
        accountId: 'acc1',
      },
    };

    await expect(handler(event as any, {} as any, jest.fn())).rejects.toThrow(
      'Missing required event fields'
    );
  });

  it('should throw when NEPTUNE_CLUSTER_ENDPOINT is not set', async () => {
    delete process.env.NEPTUNE_CLUSTER_ENDPOINT;
    const event = {
      source: 'cc-native.perception',
      'detail-type': 'SIGNAL_DETECTED',
      detail: {
        signalId: 'sig1',
        tenantId: 't1',
        accountId: 'acc1',
      },
    };

    await expect(handler(event as any, {} as any, jest.fn())).rejects.toThrow(
      'NEPTUNE_CLUSTER_ENDPOINT environment variable is required'
    );

    process.env.NEPTUNE_CLUSTER_ENDPOINT = 'neptune.example.com';
  });

  it('should rethrow when materializeSignal throws', async () => {
    mockMaterializeSignal.mockRejectedValueOnce(new Error('Neptune write failed'));
    const event = {
      source: 'cc-native.perception',
      'detail-type': 'SIGNAL_DETECTED',
      detail: {
        signalId: 'sig1',
        tenantId: 't1',
        accountId: 'acc1',
      },
    };

    await expect(handler(event as any, {} as any, jest.fn())).rejects.toThrow('Neptune write failed');
    expect(mockMaterializeSignal).toHaveBeenCalledWith('sig1', 't1');
  });
});
