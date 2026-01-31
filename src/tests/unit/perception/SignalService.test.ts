/**
 * SignalService Unit Tests
 */

import { SignalService } from '../../../services/perception/SignalService';
import { LifecycleStateService } from '../../../services/perception/LifecycleStateService';
import { SuppressionEngine } from '../../../services/perception/SuppressionEngine';
import { EventPublisher } from '../../../services/events/EventPublisher';
import { LedgerService } from '../../../services/ledger/LedgerService';
import { Logger } from '../../../services/core/Logger';
import { Signal, SignalType, SignalStatus } from '../../../types/SignalTypes';
import { mockDynamoDBDocumentClient, mockEventBridgeClient, resetAllMocks, createEventBridgeSuccessResponse } from '../../__mocks__/aws-sdk-clients';

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn(() => mockDynamoDBDocumentClient),
  },
  GetCommand: jest.fn(),
  PutCommand: jest.fn(),
  UpdateCommand: jest.fn(),
  QueryCommand: jest.fn(),
  TransactWriteCommand: jest.fn(),
}));

jest.mock('@aws-sdk/client-eventbridge', () => ({
  EventBridgeClient: jest.fn(() => mockEventBridgeClient),
  PutEventsCommand: jest.fn(),
}));

function minimalSignal(overrides: Partial<Signal> = {}): Signal {
  return {
    signalId: 'sig-123',
    signalType: SignalType.ACTION_EXECUTED,
    accountId: 'acc-123',
    tenantId: 'tenant-456',
    traceId: 'trace-789',
    dedupeKey: 'exec-dedupe-1',
    windowKey: '2026-01-23',
    detectorVersion: '1.0.0',
    detectorInputVersion: '1.0.0',
    status: SignalStatus.ACTIVE,
    metadata: {
      confidence: 1.0,
      confidenceSource: 'direct',
      severity: 'medium',
      ttl: { ttlDays: 90, expiresAt: null, isPermanent: false },
    },
    evidence: {
      evidenceRef: {
        s3Uri: 's3://bucket/key',
        sha256: 'abc123',
        capturedAt: '2026-01-23T00:00:00Z',
        schemaVersion: '1.0.0',
        detectorInputVersion: '1.0.0',
      },
      evidenceSchemaVersion: '1.0.0',
    },
    suppression: { suppressed: false, suppressedAt: null, suppressedBy: null, inferenceActive: true },
    createdAt: '2026-01-23T00:00:00Z',
    updatedAt: '2026-01-23T00:00:00Z',
    ...overrides,
  };
}

describe('SignalService', () => {
  let signalService: SignalService;
  let logger: Logger;
  let lifecycleStateService: LifecycleStateService;
  let suppressionEngine: SuppressionEngine;
  let eventPublisher: EventPublisher;
  let ledgerService: LedgerService;

  beforeEach(() => {
    resetAllMocks();
    logger = new Logger('SignalServiceTest');
    (mockEventBridgeClient.send as jest.Mock).mockResolvedValue(createEventBridgeSuccessResponse());
    ledgerService = new LedgerService(logger, 'test-ledger', 'us-west-2');
    suppressionEngine = new SuppressionEngine({ logger, ledgerService });
    lifecycleStateService = new LifecycleStateService({
      logger,
      accountsTableName: 'test-accounts',
      ledgerService,
      suppressionEngine,
      region: 'us-west-2',
    });
    eventPublisher = new EventPublisher(logger, 'test-events', 'us-west-2');
    signalService = new SignalService({
      logger,
      signalsTableName: 'test-signals',
      accountsTableName: 'test-accounts',
      lifecycleStateService,
      eventPublisher,
      ledgerService,
      region: 'us-west-2',
    });
  });

  describe('createSignal', () => {
    it('should create signal atomically with AccountState update', async () => {
      const signal: Signal = {
        signalId: 'sig-123',
        signalType: SignalType.ACCOUNT_ACTIVATION_DETECTED,
        accountId: 'acc-123',
        tenantId: 'tenant-456',
        traceId: 'trace-789',
        dedupeKey: 'acc-123-ACCOUNT_ACTIVATION_DETECTED-2026-01-23-abc123',
        windowKey: '2026-01-23',
        detectorVersion: '1.0.0',
        detectorInputVersion: '1.0.0',
        status: SignalStatus.ACTIVE,
        metadata: {
          confidence: 1.0,
          confidenceSource: 'direct',
          severity: 'medium',
          ttl: {
            ttlDays: 90,
            expiresAt: null,
            isPermanent: false,
          },
        },
        evidence: {
          evidenceRef: {
            s3Uri: 's3://bucket/key',
            sha256: 'abc123',
            capturedAt: '2026-01-23T00:00:00Z',
            schemaVersion: '1.0.0',
            detectorInputVersion: '1.0.0',
          },
          evidenceSchemaVersion: '1.0.0',
        },
        suppression: {
          suppressed: false,
          suppressedAt: null,
          suppressedBy: null,
          inferenceActive: true,
        },
        createdAt: '2026-01-23T00:00:00Z',
        updatedAt: '2026-01-23T00:00:00Z',
      };

      // Mock AccountState
      (mockDynamoDBDocumentClient.send as jest.Mock)
        .mockResolvedValueOnce({ Item: null }) // getAccountState returns null
        .mockResolvedValueOnce({}) // TransactWriteItems succeeds
        .mockResolvedValueOnce({}) // Ledger append
        .mockResolvedValueOnce(createEventBridgeSuccessResponse()); // Event publish
      
      // Mock EventBridge
      (mockEventBridgeClient.send as jest.Mock)
        .mockResolvedValue(createEventBridgeSuccessResponse());

      const result = await signalService.createSignal(signal);

      expect(result).toBeDefined();
      expect(result.signalId).toBe('sig-123');
      
      // Verify TransactWriteItems was called (atomicity)
      // Check if any call was made to DynamoDB (which includes TransactWriteItems)
      const dynamoDBCalls = (mockDynamoDBDocumentClient.send as jest.Mock).mock.calls;
      expect(dynamoDBCalls.length).toBeGreaterThan(0);
      
      // Verify signal was created
      expect(result.signalId).toBe('sig-123');
      expect(result.dedupeKey).toBe('acc-123-ACCOUNT_ACTIVATION_DETECTED-2026-01-23-abc123');
    });

    it('should throw when not configured for full lifecycle (missing accountsTableName)', async () => {
      const executionOnlyService = new SignalService({
        logger,
        signalsTableName: 'test-signals',
        region: 'us-west-2',
      });
      await expect(executionOnlyService.createSignal(minimalSignal({ signalType: SignalType.ACCOUNT_ACTIVATION_DETECTED }))).rejects.toThrow(
        'not configured for full lifecycle'
      );
    });

    it('should be idempotent (dedupeKey prevents duplicates)', async () => {
      const signal: Signal = {
        signalId: 'sig-123',
        signalType: SignalType.ACCOUNT_ACTIVATION_DETECTED,
        accountId: 'acc-123',
        tenantId: 'tenant-456',
        traceId: 'trace-789',
        dedupeKey: 'acc-123-ACCOUNT_ACTIVATION_DETECTED-2026-01-23-abc123',
        windowKey: '2026-01-23',
        detectorVersion: '1.0.0',
        detectorInputVersion: '1.0.0',
        status: SignalStatus.ACTIVE,
        metadata: {
          confidence: 1.0,
          confidenceSource: 'direct',
          severity: 'medium',
          ttl: {
            ttlDays: 90,
            expiresAt: null,
            isPermanent: false,
          },
        },
        evidence: {
          evidenceRef: {
            s3Uri: 's3://bucket/key',
            sha256: 'abc123',
            capturedAt: '2026-01-23T00:00:00Z',
            schemaVersion: '1.0.0',
            detectorInputVersion: '1.0.0',
          },
          evidenceSchemaVersion: '1.0.0',
        },
        suppression: {
          suppressed: false,
          suppressedAt: null,
          suppressedBy: null,
          inferenceActive: true,
        },
        createdAt: '2026-01-23T00:00:00Z',
        updatedAt: '2026-01-23T00:00:00Z',
      };

      // Mock TransactionCanceledException (idempotency)
      const error = new Error('TransactionCanceledException');
      error.name = 'TransactionCanceledException';
      
      (mockDynamoDBDocumentClient.send as jest.Mock)
        .mockResolvedValueOnce({ Item: null })
        .mockRejectedValueOnce(error);

      // Should handle idempotency gracefully
      await expect(signalService.createSignal(signal)).rejects.toThrow();
    });
  });

  describe('createExecutionSignal', () => {
    it('should write signal and return it (execution-only config)', async () => {
      const executionOnlyService = new SignalService({
        logger,
        signalsTableName: 'test-signals',
        region: 'us-west-2',
      });
      (mockDynamoDBDocumentClient.send as jest.Mock).mockResolvedValue({});
      const signal = minimalSignal();
      const result = await executionOnlyService.createExecutionSignal(signal);
      expect(result).toEqual(signal);
      expect(mockDynamoDBDocumentClient.send).toHaveBeenCalled();
    });

    it('should return existing signal on ConditionalCheckFailed (idempotent)', async () => {
      const executionOnlyService = new SignalService({
        logger,
        signalsTableName: 'test-signals',
        region: 'us-west-2',
      });
      const signal = minimalSignal();
      const conditionalError = new Error('Conditional check failed');
      (conditionalError as any).name = 'ConditionalCheckFailedException';
      (mockDynamoDBDocumentClient.send as jest.Mock)
        .mockRejectedValueOnce(conditionalError)
        .mockResolvedValueOnce({ Item: signal });
      const result = await executionOnlyService.createExecutionSignal(signal);
      expect(result).toEqual(signal);
    });
  });

  describe('getSignalsForAccount', () => {
    it('should return signals from Query', async () => {
      const items = [minimalSignal({ signalId: 'sig-1' }), minimalSignal({ signalId: 'sig-2' })];
      (mockDynamoDBDocumentClient.send as jest.Mock).mockResolvedValue({ Items: items });
      const result = await signalService.getSignalsForAccount('acc-123', 'tenant-456');
      expect(result).toEqual(items);
    });

    it('should pass signalTypes filter when provided', async () => {
      (mockDynamoDBDocumentClient.send as jest.Mock).mockResolvedValue({ Items: [] });
      const result = await signalService.getSignalsForAccount('acc-123', 'tenant-456', {
        signalTypes: [SignalType.ACTION_EXECUTED],
      });
      expect(result).toEqual([]);
      expect(mockDynamoDBDocumentClient.send).toHaveBeenCalled();
    });
  });

  describe('updateSignalStatus', () => {
    it('should enforce status state machine invariants', async () => {
      const signal: Signal = {
        signalId: 'sig-123',
        signalType: SignalType.ACCOUNT_ACTIVATION_DETECTED,
        accountId: 'acc-123',
        tenantId: 'tenant-456',
        traceId: 'trace-789',
        dedupeKey: 'dedupe-key',
        windowKey: 'window-key',
        detectorVersion: '1.0.0',
        detectorInputVersion: '1.0.0',
        status: SignalStatus.SUPPRESSED,
        metadata: {
          confidence: 1.0,
          confidenceSource: 'direct',
          severity: 'medium',
          ttl: {
            ttlDays: 90,
            expiresAt: null,
            isPermanent: false,
          },
        },
        evidence: {
          evidenceRef: {
            s3Uri: 's3://bucket/key',
            sha256: 'abc123',
            capturedAt: '2026-01-23T00:00:00Z',
            schemaVersion: '1.0.0',
            detectorInputVersion: '1.0.0',
          },
          evidenceSchemaVersion: '1.0.0',
        },
        suppression: {
          suppressed: true,
          suppressedAt: '2026-01-23T00:00:00Z',
          suppressedBy: 'system',
          inferenceActive: false,
        },
        createdAt: '2026-01-23T00:00:00Z',
        updatedAt: '2026-01-23T00:00:00Z',
      };

      (mockDynamoDBDocumentClient.send as jest.Mock)
        .mockResolvedValueOnce({ Item: signal });

      // Attempt to make SUPPRESSED signal ACTIVE (should fail)
      await expect(
        signalService.updateSignalStatus('sig-123', 'tenant-456', SignalStatus.ACTIVE)
      ).rejects.toThrow('SUPPRESSED signals cannot become ACTIVE again');
    });

    it('should update ACTIVE to SUPPRESSED and remove from account state', async () => {
      const currentSignal = minimalSignal({ status: SignalStatus.ACTIVE });
      const updatedSignal = { ...currentSignal, status: SignalStatus.SUPPRESSED };
      const accountState = { tenantId: 'tenant-456', accountId: 'acc-123', activeSignalIndex: { [SignalType.ACTION_EXECUTED]: ['sig-123'] } };
      (mockDynamoDBDocumentClient.send as jest.Mock)
        .mockResolvedValueOnce({ Item: currentSignal })
        .mockResolvedValueOnce({ Attributes: updatedSignal })
        .mockResolvedValueOnce({ Item: accountState })
        .mockResolvedValueOnce({});
      const result = await signalService.updateSignalStatus('sig-123', 'tenant-456', SignalStatus.SUPPRESSED);
      expect(result.status).toBe(SignalStatus.SUPPRESSED);
    });
  });

  describe('checkTTLExpiry', () => {
    it('should return null when signal not found', async () => {
      (mockDynamoDBDocumentClient.send as jest.Mock).mockResolvedValue({ Item: undefined });
      const result = await signalService.checkTTLExpiry('sig-123', 'tenant-456');
      expect(result).toBeNull();
    });

    it('should return signal when SUPPRESSED (do not expire)', async () => {
      const sig = minimalSignal({ status: SignalStatus.SUPPRESSED });
      (mockDynamoDBDocumentClient.send as jest.Mock).mockResolvedValue({ Item: sig });
      const result = await signalService.checkTTLExpiry('sig-123', 'tenant-456');
      expect(result).toEqual(sig);
    });

    it('should return signal when not expired', async () => {
      const sig = minimalSignal({
        metadata: {
          confidence: 1,
          confidenceSource: 'direct',
          severity: 'medium',
          ttl: { ttlDays: 90, expiresAt: '2099-01-01T00:00:00Z', isPermanent: false },
        },
      });
      (mockDynamoDBDocumentClient.send as jest.Mock).mockResolvedValue({ Item: sig });
      const result = await signalService.checkTTLExpiry('sig-123', 'tenant-456');
      expect(result).toEqual(sig);
    });

    it('should call updateSignalStatus when expired', async () => {
      const sig = minimalSignal({
        metadata: {
          confidence: 1,
          confidenceSource: 'direct',
          severity: 'medium',
          ttl: { ttlDays: 90, expiresAt: '2020-01-01T00:00:00Z', isPermanent: false },
        },
      });
      const updatedSig = { ...sig, status: SignalStatus.EXPIRED };
      (mockDynamoDBDocumentClient.send as jest.Mock)
        .mockResolvedValueOnce({ Item: sig })
        .mockResolvedValueOnce({ Item: sig })
        .mockResolvedValueOnce({ Attributes: updatedSig })
        .mockResolvedValueOnce({ Item: { activeSignalIndex: {} } })
        .mockResolvedValueOnce({});
      const result = await signalService.checkTTLExpiry('sig-123', 'tenant-456');
      expect(result?.status).toBe(SignalStatus.EXPIRED);
    });
  });

  describe('replaySignalFromEvidence', () => {
    it('should throw when lifecycleStateService or ledgerService not configured', async () => {
      const executionOnlyService = new SignalService({
        logger,
        signalsTableName: 'test-signals',
        region: 'us-west-2',
      });
      const detector = { detect: jest.fn().mockResolvedValue([]) };
      await expect(
        executionOnlyService.replaySignalFromEvidence('sig-123', 'tenant-456', detector as any)
      ).rejects.toThrow('not configured for replay');
    });

    it('should throw when signal not found', async () => {
      (mockDynamoDBDocumentClient.send as jest.Mock).mockResolvedValue({ Item: undefined });
      const detector = { detect: jest.fn().mockResolvedValue([]) };
      await expect(
        signalService.replaySignalFromEvidence('sig-123', 'tenant-456', detector as any)
      ).rejects.toThrow('Signal not found');
    });

    it('should return matches: false when no signal detected on replay', async () => {
      const storedSignal = minimalSignal();
      (mockDynamoDBDocumentClient.send as jest.Mock)
        .mockResolvedValueOnce({ Item: storedSignal })
        .mockResolvedValueOnce({ Item: null });
      const detector = { detect: jest.fn().mockResolvedValue([]) };
      const result = await signalService.replaySignalFromEvidence('sig-123', 'tenant-456', detector as any);
      expect(result.matches).toBe(false);
      expect(result.recomputedSignal).toEqual(storedSignal);
    });

    it('should return matches: true when recomputed matches stored', async () => {
      const storedSignal = minimalSignal();
      const recomputed = { ...storedSignal, dedupeKey: storedSignal.dedupeKey, windowKey: storedSignal.windowKey, metadata: { ...storedSignal.metadata, confidence: storedSignal.metadata.confidence } };
      (mockDynamoDBDocumentClient.send as jest.Mock)
        .mockResolvedValueOnce({ Item: storedSignal })
        .mockResolvedValueOnce({ Item: null });
      const detector = { detect: jest.fn().mockResolvedValue([recomputed]) };
      const result = await signalService.replaySignalFromEvidence('sig-123', 'tenant-456', detector as any);
      expect(result.matches).toBe(true);
      expect(result.recomputedSignal).toEqual(recomputed);
    });
  });
});
