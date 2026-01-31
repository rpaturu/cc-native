/**
 * Phase 5.6 Audit Export Worker Handler unit tests.
 */

const mockDynamoSend = jest.fn();
const mockS3Send = jest.fn();
const mockQuery = jest.fn();
const mockGetJob = jest.fn();
const mockUpdateJobCompletion = jest.fn();

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn().mockImplementation(() => ({ send: mockDynamoSend })),
  },
  PutCommand: jest.fn(),
  GetCommand: jest.fn(),
  UpdateCommand: jest.fn(),
}));

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({ send: mockS3Send })),
  PutObjectCommand: jest.fn(),
}));

jest.mock('../../../../services/ledger/LedgerService', () => ({
  LedgerService: jest.fn().mockImplementation(() => ({ query: mockQuery })),
}));

jest.mock('../../../../services/autonomy/AuditExportService', () => ({
  AuditExportService: jest.fn().mockImplementation(() => ({
    getJob: mockGetJob,
    updateJobCompletion: mockUpdateJobCompletion,
  })),
}));

import { handler } from '../../../../handlers/phase5/audit-export-worker-handler';

function makeEvent(detail: Record<string, unknown>) {
  return {
    version: '0',
    id: 'test-id',
    'detail-type': 'AuditExportRequested',
    source: 'cc-native.autonomy',
    account: '123',
    time: '2026-01-28T00:00:00Z',
    region: 'us-west-2',
    resources: [],
    detail,
  };
}

describe('audit-export-worker-handler', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = {
      ...originalEnv,
      LEDGER_TABLE_NAME: 'ledger-table',
      AUDIT_EXPORT_TABLE_NAME: 'audit-export-table',
      AUDIT_EXPORT_BUCKET_NAME: 'audit-bucket',
    };
    mockQuery.mockResolvedValue([]);
    mockGetJob.mockResolvedValue({
      export_id: 'exp-abc123',
      tenant_id: 't1',
      status: 'PENDING',
      from: '2026-01-01',
      to: '2026-01-31',
      format: 'json',
    });
    mockUpdateJobCompletion.mockResolvedValue(undefined);
    mockDynamoSend.mockResolvedValue({});
    mockS3Send.mockResolvedValue({});
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns early when detail missing export_id', async () => {
    await handler(
      makeEvent({
        tenant_id: 't1',
        from: '2026-01-01',
        to: '2026-01-31',
      }) as any,
      {} as any
    );

    expect(mockGetJob).not.toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('returns early when detail missing tenant_id', async () => {
    await handler(
      makeEvent({
        export_id: 'exp-1',
        from: '2026-01-01',
        to: '2026-01-31',
      }) as any,
      {} as any
    );

    expect(mockGetJob).not.toHaveBeenCalled();
  });

  it('calls markFailed when env missing (AUDIT_EXPORT_TABLE_NAME left set so markFailed can update)', async () => {
    process.env.LEDGER_TABLE_NAME = '';
    process.env.AUDIT_EXPORT_BUCKET_NAME = '';
    process.env.AUDIT_EXPORT_TABLE_NAME = 'audit-export-table';

    await handler(
      makeEvent({
        export_id: 'exp-1',
        tenant_id: 't1',
        from: '2026-01-01',
        to: '2026-01-31',
      }) as any,
      {} as any
    );

    expect(mockUpdateJobCompletion).toHaveBeenCalledWith('exp-1', 't1', {
      status: 'FAILED',
      error_message: 'Worker misconfigured',
    });
  });

  it('returns early when job not found', async () => {
    mockGetJob.mockResolvedValue(null);

    await handler(
      makeEvent({
        export_id: 'exp-1',
        tenant_id: 't1',
        from: '2026-01-01',
        to: '2026-01-31',
      }) as any,
      {} as any
    );

    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockUpdateJobCompletion).not.toHaveBeenCalled();
  });

  it('returns early when job status is not PENDING', async () => {
    mockGetJob.mockResolvedValue({
      export_id: 'exp-1',
      tenant_id: 't1',
      status: 'COMPLETED',
      from: '2026-01-01',
      to: '2026-01-31',
    });

    await handler(
      makeEvent({
        export_id: 'exp-1',
        tenant_id: 't1',
        from: '2026-01-01',
        to: '2026-01-31',
      }) as any,
      {} as any
    );

    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockUpdateJobCompletion).not.toHaveBeenCalled();
  });

  it('queries ledger, writes JSON to S3, updates job to COMPLETED', async () => {
    const entries = [
      {
        entryId: 'e1',
        eventType: 'ACTION_EXECUTED',
        timestamp: '2026-01-15T00:00:00Z',
        tenantId: 't1',
        traceId: 'trace-1',
        data: {},
      },
    ];
    mockQuery.mockResolvedValue(entries);

    await handler(
      makeEvent({
        export_id: 'exp-abc123',
        tenant_id: 't1',
        from: '2026-01-01',
        to: '2026-01-31',
        format: 'json',
      }) as any,
      {} as any
    );

    expect(mockQuery).toHaveBeenCalledWith({
      tenantId: 't1',
      accountId: undefined,
      startTime: '2026-01-01',
      endTime: '2026-01-31',
      limit: 10_000,
    });
    expect(mockS3Send).toHaveBeenCalled();
    expect(mockUpdateJobCompletion).toHaveBeenCalledWith('exp-abc123', 't1', {
      status: 'COMPLETED',
      s3_bucket: 'audit-bucket',
      s3_key: 'audit-exports/t1/exp-abc123.json',
    });
  });

  it('writes CSV when format is csv', async () => {
    mockQuery.mockResolvedValue([]);

    await handler(
      makeEvent({
        export_id: 'exp-abc123',
        tenant_id: 't1',
        from: '2026-01-01',
        to: '2026-01-31',
        format: 'csv',
      }) as any,
      {} as any
    );

    expect(mockS3Send).toHaveBeenCalled();
    expect(mockUpdateJobCompletion).toHaveBeenCalledWith('exp-abc123', 't1', expect.objectContaining({
      status: 'COMPLETED',
      s3_key: 'audit-exports/t1/exp-abc123.csv',
    }));
  });

  it('writes CSV with ledger rows when format is csv and entries exist', async () => {
    mockQuery.mockResolvedValue([
      {
        entryId: 'e1',
        eventType: 'ACTION_EXECUTED',
        timestamp: '2026-01-15T00:00:00Z',
        tenantId: 't1',
        accountId: 'a1',
        traceId: 'trace-1',
        data: { key: 'value' },
      },
    ]);

    await handler(
      makeEvent({
        export_id: 'exp-abc123',
        tenant_id: 't1',
        from: '2026-01-01',
        to: '2026-01-31',
        format: 'csv',
      }) as any,
      {} as any
    );

    expect(mockS3Send).toHaveBeenCalled();
    expect(mockUpdateJobCompletion).toHaveBeenCalledWith('exp-abc123', 't1', expect.objectContaining({
      status: 'COMPLETED',
      s3_key: 'audit-exports/t1/exp-abc123.csv',
    }));
  });

  it('calls markFailed when ledger query or S3 throws', async () => {
    mockQuery.mockRejectedValue(new Error('DynamoDB error'));

    await handler(
      makeEvent({
        export_id: 'exp-abc123',
        tenant_id: 't1',
        from: '2026-01-01',
        to: '2026-01-31',
      }) as any,
      {} as any
    );

    expect(mockUpdateJobCompletion).toHaveBeenCalledWith('exp-abc123', 't1', {
      status: 'FAILED',
      error_message: 'DynamoDB error',
    });
  });
});
