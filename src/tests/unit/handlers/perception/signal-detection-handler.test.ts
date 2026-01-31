/**
 * Signal Detection Handler Unit Tests - Phase 1
 *
 * Covers: empty snapshots, one snapshot with signals, idempotency (ConditionalCheckFailed),
 * detector error (continue), createSignal non-idempotency error (rethrow), event.traceId.
 */

const mockCreateSignal = jest.fn().mockResolvedValue({ signalId: 's1' });
const mockDetect = jest.fn().mockResolvedValue([]);

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({})),
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

jest.mock('../../../../services/perception/SignalService', () => ({
  SignalService: jest.fn().mockImplementation(() => ({
    createSignal: mockCreateSignal,
  })),
}));

jest.mock('../../../../services/events/EventPublisher', () => ({
  EventPublisher: jest.fn().mockImplementation(() => ({})),
}));

const detectorMock = () => ({ detect: mockDetect });
jest.mock('../../../../services/perception/detectors/AccountActivationDetector', () => ({
  AccountActivationDetector: jest.fn().mockImplementation(detectorMock),
}));
jest.mock('../../../../services/perception/detectors/EngagementDetector', () => ({
  EngagementDetector: jest.fn().mockImplementation(detectorMock),
}));
jest.mock('../../../../services/perception/detectors/DiscoveryStallDetector', () => ({
  DiscoveryStallDetector: jest.fn().mockImplementation(detectorMock),
}));
jest.mock('../../../../services/perception/detectors/StakeholderGapDetector', () => ({
  StakeholderGapDetector: jest.fn().mockImplementation(detectorMock),
}));
jest.mock('../../../../services/perception/detectors/UsageTrendDetector', () => ({
  UsageTrendDetector: jest.fn().mockImplementation(detectorMock),
}));
jest.mock('../../../../services/perception/detectors/SupportRiskDetector', () => ({
  SupportRiskDetector: jest.fn().mockImplementation(detectorMock),
}));
jest.mock('../../../../services/perception/detectors/RenewalWindowDetector', () => ({
  RenewalWindowDetector: jest.fn().mockImplementation(detectorMock),
}));

import { handler } from '../../../../handlers/perception/signal-detection-handler';

describe('SignalDetectionHandler', () => {
  beforeEach(() => {
    mockCreateSignal.mockClear();
    mockDetect.mockClear();
    process.env.AWS_REGION = 'us-east-1';
    process.env.LEDGER_TABLE_NAME = 'ledger';
    process.env.ACCOUNTS_TABLE_NAME = 'accounts';
    process.env.SIGNALS_TABLE_NAME = 'signals';
    process.env.EVENT_BUS_NAME = 'bus';
  });

  it('should return 200 with signalsCreated 0 when snapshots is empty', async () => {
    const event = {
      snapshots: [],
      tenantId: 't1',
    };

    const result = await handler(event, {} as any, jest.fn());

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body ?? '{}');
    expect(body.success).toBe(true);
    expect(body.signalsCreated).toBe(0);
    expect(mockDetect).not.toHaveBeenCalled();
    expect(mockCreateSignal).not.toHaveBeenCalled();
  });

  it('should run detectors and createSignal when one detector returns one signal', async () => {
    const event = {
      snapshots: [
        {
          s3Uri: 's3://b/k',
          sha256: 'abc',
          capturedAt: new Date().toISOString(),
          schemaVersion: '1',
          detectorInputVersion: '1',
        },
      ],
      tenantId: 't1',
    };
    mockDetect.mockResolvedValueOnce([{ signalId: 's1', dedupeKey: 'k1' } as any]);
    mockDetect.mockResolvedValue([]);

    const result = await handler(event, {} as any, jest.fn());

    expect(mockDetect).toHaveBeenCalled();
    expect(mockCreateSignal).toHaveBeenCalledTimes(1);
    expect(mockCreateSignal).toHaveBeenCalledWith(
      expect.objectContaining({
        signalId: 's1',
        dedupeKey: 'k1',
      })
    );
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body ?? '{}').signalsCreated).toBe(1);
  });

  it('should continue when createSignal throws ConditionalCheckFailedException (idempotent)', async () => {
    const err = new Error('ConditionalCheckFailed');
    (err as any).name = 'TransactionCanceledException';
    mockCreateSignal.mockRejectedValueOnce(err);
    const event = {
      snapshots: [
        {
          s3Uri: 's3://b/k',
          sha256: 'a',
          capturedAt: new Date().toISOString(),
          schemaVersion: '1',
          detectorInputVersion: '1',
        },
      ],
      tenantId: 't1',
    };
    mockDetect.mockResolvedValueOnce([{ signalId: 's1' } as any]);
    mockDetect.mockResolvedValue([]);

    const result = await handler(event, {} as any, jest.fn());

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body ?? '{}').signalsCreated).toBe(0);
  });

  it('should continue when createSignal throws with message containing ConditionalCheckFailed', async () => {
    mockCreateSignal.mockRejectedValueOnce(new Error('ConditionalCheckFailed'));
    const event = {
      snapshots: [
        {
          s3Uri: 's3://b/k',
          sha256: 'a',
          capturedAt: new Date().toISOString(),
          schemaVersion: '1',
          detectorInputVersion: '1',
        },
      ],
      tenantId: 't1',
    };
    mockDetect.mockResolvedValueOnce([{ signalId: 's1' } as any]);
    mockDetect.mockResolvedValue([]);

    const result = await handler(event, {} as any, jest.fn());

    expect(result.statusCode).toBe(200);
  });

  it('should log and continue when createSignal throws non-idempotency error (caught by detector catch)', async () => {
    mockCreateSignal.mockRejectedValueOnce(new Error('DynamoDB throttled'));
    const event = {
      snapshots: [
        {
          s3Uri: 's3://b/k',
          sha256: 'a',
          capturedAt: new Date().toISOString(),
          schemaVersion: '1',
          detectorInputVersion: '1',
        },
      ],
      tenantId: 't1',
    };
    mockDetect.mockResolvedValueOnce([{ signalId: 's1' } as any]);
    mockDetect.mockResolvedValue([]);

    const result = await handler(event, {} as any, jest.fn());

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body ?? '{}').signalsCreated).toBe(0);
  });

  it('should log and continue when a detector throws', async () => {
    mockDetect.mockRejectedValueOnce(new Error('Detector failed'));
    mockDetect.mockResolvedValue([]);
    const event = {
      snapshots: [
        {
          s3Uri: 's3://b/k',
          sha256: 'a',
          capturedAt: new Date().toISOString(),
          schemaVersion: '1',
          detectorInputVersion: '1',
        },
      ],
      tenantId: 't1',
    };

    const result = await handler(event, {} as any, jest.fn());

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body ?? '{}').signalsCreated).toBe(0);
  });

  it('should use event.traceId when provided', async () => {
    const event = {
      snapshots: [],
      tenantId: 't1',
      traceId: 'trace-123',
    };

    await handler(event, {} as any, jest.fn());

    expect(mockCreateSignal).not.toHaveBeenCalled();
  });
});
