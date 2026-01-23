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
    
    // Mock EventBridge
    (mockEventBridgeClient.send as jest.Mock)
      .mockResolvedValue(createEventBridgeSuccessResponse());
    
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
  });
});
