/**
 * Connector Poll Handler Unit Tests - Phase 1
 *
 * Covers: CRM / USAGE_ANALYTICS / SUPPORT paths, CONNECTOR_POLL_COMPLETED publish,
 * unknown connector type throw, CONNECTOR_POLL_FAILED on error.
 */

const mockConnect = jest.fn().mockResolvedValue(undefined);
const mockPoll = jest.fn().mockResolvedValue([
  { s3Uri: 's3://bucket/key', capturedAt: new Date().toISOString() },
]);
const mockDisconnect = jest.fn().mockResolvedValue(undefined);
const mockPublish = jest.fn().mockResolvedValue(undefined);

jest.mock('../../../../services/world-model/EvidenceService', () => ({
  EvidenceService: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('../../../../services/events/EventPublisher', () => ({
  EventPublisher: jest.fn().mockImplementation(() => ({
    publish: mockPublish,
  })),
}));

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({})),
}));

const mockConnectorInstance = {
  connect: mockConnect,
  poll: mockPoll,
  disconnect: mockDisconnect,
};

jest.mock('../../../../services/perception/connectors/CRMConnector', () => ({
  CRMConnector: jest.fn().mockImplementation(() => mockConnectorInstance),
}));

jest.mock('../../../../services/perception/connectors/UsageAnalyticsConnector', () => ({
  UsageAnalyticsConnector: jest.fn().mockImplementation(() => mockConnectorInstance),
}));

jest.mock('../../../../services/perception/connectors/SupportConnector', () => ({
  SupportConnector: jest.fn().mockImplementation(() => mockConnectorInstance),
}));

import { handler } from '../../../../handlers/perception/connector-poll-handler';

describe('ConnectorPollHandler', () => {
  beforeEach(() => {
    mockConnect.mockClear();
    mockPoll.mockClear();
    mockDisconnect.mockClear();
    mockPublish.mockClear();
    process.env.AWS_REGION = 'us-east-1';
    process.env.EVIDENCE_LEDGER_BUCKET = 'test-bucket';
    process.env.EVIDENCE_INDEX_TABLE_NAME = 'test-index';
    process.env.EVENT_BUS_NAME = 'test-bus';
  });

  it('should poll CRM connector and publish CONNECTOR_POLL_COMPLETED', async () => {
    const event = {
      connectorType: 'CRM' as const,
      tenantId: 't1',
    };

    const result = await handler(event, {} as any, jest.fn());

    expect(mockConnect).toHaveBeenCalledTimes(1);
    expect(mockPoll).toHaveBeenCalledTimes(1);
    expect(mockDisconnect).toHaveBeenCalledTimes(1);
    expect(mockPublish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'CONNECTOR_POLL_COMPLETED',
        source: 'perception',
        payload: expect.objectContaining({
          connectorType: 'CRM',
          snapshotCount: 1,
        }),
      })
    );
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body ?? '{}');
    expect(body.success).toBe(true);
    expect(body.connectorType).toBe('CRM');
    expect(body.snapshotCount).toBe(1);
    expect(body.traceId).toBeDefined();
  });

  it('should poll USAGE_ANALYTICS connector and return 200', async () => {
    mockPoll.mockResolvedValueOnce([]);

    const event = {
      connectorType: 'USAGE_ANALYTICS' as const,
      tenantId: 't2',
    };

    const result = await handler(event, {} as any, jest.fn());

    expect(mockPoll).toHaveBeenCalled();
    expect(mockPublish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'CONNECTOR_POLL_COMPLETED',
        payload: expect.objectContaining({ connectorType: 'USAGE_ANALYTICS', snapshotCount: 0 }),
      })
    );
    expect(result.statusCode).toBe(200);
  });

  it('should poll SUPPORT connector and return 200', async () => {
    const event = {
      connectorType: 'SUPPORT' as const,
      tenantId: 't3',
    };

    const result = await handler(event, {} as any, jest.fn());

    expect(mockPoll).toHaveBeenCalled();
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body ?? '{}').connectorType).toBe('SUPPORT');
  });

  it('should use event.traceId when provided', async () => {
    const event = {
      connectorType: 'CRM' as const,
      tenantId: 't1',
      traceId: 'trace-123',
    };

    await handler(event, {} as any, jest.fn());

    expect(mockPublish).toHaveBeenCalledWith(
      expect.objectContaining({
        traceId: 'trace-123',
      })
    );
  });

  it('should publish CONNECTOR_POLL_FAILED and throw for unknown connector type', async () => {
    const event = {
      connectorType: 'UNKNOWN' as any,
      tenantId: 't1',
    };

    await expect(handler(event, {} as any, jest.fn())).rejects.toThrow(
      'Unknown connector type: UNKNOWN'
    );
    expect(mockConnect).not.toHaveBeenCalled();
    expect(mockPublish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'CONNECTOR_POLL_FAILED',
        payload: expect.objectContaining({ error: 'Unknown connector type: UNKNOWN' }),
      })
    );
  });

  it('should publish CONNECTOR_POLL_FAILED and rethrow when connector.poll throws', async () => {
    const event = {
      connectorType: 'CRM' as const,
      tenantId: 't1',
    };
    mockPoll.mockRejectedValueOnce(new Error('Poll failed'));

    await expect(handler(event, {} as any, jest.fn())).rejects.toThrow('Poll failed');

    expect(mockPublish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'CONNECTOR_POLL_FAILED',
        source: 'perception',
        payload: expect.objectContaining({
          connectorType: 'CRM',
          error: 'Poll failed',
        }),
      })
    );
  });

  it('should rethrow when publish of CONNECTOR_POLL_FAILED also throws', async () => {
    const event = {
      connectorType: 'CRM' as const,
      tenantId: 't1',
    };
    mockPoll.mockRejectedValueOnce(new Error('Poll failed'));
    mockPublish.mockRejectedValueOnce(new Error('EventBus error'));

    await expect(handler(event, {} as any, jest.fn())).rejects.toThrow('Poll failed');
  });
});
