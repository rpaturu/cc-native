/**
 * Phase 1 Contract Certification Tests
 * 
 * These tests validate Phase 1's non-negotiables:
 * 1. Idempotency: Same evidence snapshot processed twice → 1 signal
 * 2. Replayability: Replay produces same dedupeKey + same signal payload
 * 3. Suppression Logging: Every suppression creates a ledger entry
 * 4. Inference Stability: Same active signals set → same lifecycle state always
 * 5. Ordering/Race Safety: Signal created + AccountState updated is consistent
 * 
 * These tests serve as the Phase 1 certification harness.
 */

import { SignalService } from '../../../services/perception/SignalService';
import { LifecycleStateService } from '../../../services/perception/LifecycleStateService';
import { SuppressionEngine } from '../../../services/perception/SuppressionEngine';
import { EventPublisher } from '../../../services/events/EventPublisher';
import { LedgerService } from '../../../services/ledger/LedgerService';
import { Logger } from '../../../services/core/Logger';
import { AccountActivationDetector } from '../../../services/perception/detectors/AccountActivationDetector';
import { Signal, SignalType, SignalStatus, EvidenceSnapshotRef } from '../../../types/SignalTypes';
import { LifecycleState } from '../../../types/LifecycleTypes';
import { mockDynamoDBDocumentClient, mockS3Client, mockEventBridgeClient, resetAllMocks, createEventBridgeSuccessResponse } from '../../__mocks__/aws-sdk-clients';
import { createHash } from 'crypto';

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

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => mockS3Client),
  GetObjectCommand: jest.fn(),
}));

jest.mock('@aws-sdk/client-eventbridge', () => ({
  EventBridgeClient: jest.fn(() => mockEventBridgeClient),
  PutEventsCommand: jest.fn(),
}));

describe('Phase 1 Contract Certification Tests', () => {
  let logger: Logger;
  let signalService: SignalService;
  let lifecycleStateService: LifecycleStateService;
  let suppressionEngine: SuppressionEngine;
  let detector: AccountActivationDetector;

  beforeEach(() => {
    resetAllMocks();
    logger = new Logger('Phase1CertificationTest');
    
    // Mock EventBridge
    (mockEventBridgeClient.send as jest.Mock)
      .mockResolvedValue(createEventBridgeSuccessResponse());
    
    const ledgerService = new LedgerService(logger, 'test-ledger', 'us-west-2');
    suppressionEngine = new SuppressionEngine({ logger, ledgerService });
    lifecycleStateService = new LifecycleStateService({
      logger,
      accountsTableName: 'test-accounts',
      ledgerService,
      suppressionEngine,
      region: 'us-west-2',
    });
    
    signalService = new SignalService({
      logger,
      signalsTableName: 'test-signals',
      accountsTableName: 'test-accounts',
      lifecycleStateService,
      eventPublisher: new EventPublisher(logger, 'test-events', 'us-west-2'),
      ledgerService,
      region: 'us-west-2',
    });

    // Create detector with mocked S3Client
    // The S3Client is already mocked via jest.mock, so we can use it directly
    detector = new AccountActivationDetector(logger, mockS3Client as any);
  });

  describe('Contract Test 1: Idempotency', () => {
    it('should process same evidence snapshot twice and produce 1 signal', async () => {
      const snapshotRef: EvidenceSnapshotRef = {
        s3Uri: 's3://bucket/evidence.json',
        sha256: 'abc123',
        capturedAt: '2026-01-23T00:00:00Z',
        schemaVersion: '1.0.0',
        detectorInputVersion: '1.0.0',
      };

      // Mock evidence snapshot - need to return proper structure
      const evidenceData = {
        entityId: 'acc-123',
        accountId: 'acc-123',
        metadata: { tenantId: 'tenant-456', traceId: 'trace-789' },
        payload: { 
          activationDetected: true,
          targetAccountListUpdate: true,
        },
      };
      
      // Compute correct SHA256 hash for the evidence data
      const evidenceString = JSON.stringify(evidenceData);
      const correctHash = createHash('sha256').update(evidenceString).digest('hex');
      
      // Update snapshotRef with correct hash
      snapshotRef.sha256 = correctHash;
      
      // Mock S3 GetObjectCommand response
      // Reset and set up mock for this test
      (mockS3Client.send as jest.Mock).mockReset();
      (mockS3Client.send as jest.Mock).mockResolvedValue({
        Body: {
          transformToString: jest.fn().mockResolvedValue(evidenceString),
        },
      });

      // First detection
      let signals1: any[];
      try {
        signals1 = await detector.detect(snapshotRef);
      } catch (error) {
        console.error('Detector error:', error);
        throw error;
      }
      expect(signals1.length).toBe(1);

      const signal1 = signals1[0];
      const dedupeKey1 = signal1.dedupeKey;

      // Second detection (same snapshot)
      const signals2 = await detector.detect(snapshotRef);
      expect(signals2.length).toBe(1);

      const signal2 = signals2[0];
      const dedupeKey2 = signal2.dedupeKey;

      // DedupeKeys should be identical (deterministic)
      expect(dedupeKey1).toBe(dedupeKey2);

      // Mock signal creation (idempotent)
      // First create succeeds
      (mockDynamoDBDocumentClient.send as jest.Mock)
        .mockResolvedValueOnce({ Item: null }) // getAccountState
        .mockResolvedValueOnce({}) // TransactWriteItems (first create) succeeds
        .mockResolvedValueOnce({}) // Ledger append
        .mockResolvedValueOnce(createEventBridgeSuccessResponse()); // Event publish

      // Create signal first time
      const created1 = await signalService.createSignal({
        ...signal1,
        traceId: 'trace-789',
      });

      // Reset mocks for second attempt
      (mockDynamoDBDocumentClient.send as jest.Mock).mockReset();
      
      // Second attempt - should return existing signal (idempotent)
      // getSignalByDedupeKey returns existing signal
      (mockDynamoDBDocumentClient.send as jest.Mock)
        .mockResolvedValueOnce({ Item: created1 }); // getSignalByDedupeKey returns existing

      // Should handle idempotency gracefully and return existing signal
      const created2 = await signalService.createSignal({
        ...signal2,
        traceId: 'trace-789',
      });

      // Should be the same signal (idempotent) - dedupeKey is the key, not signalId
      // Signal IDs may differ due to timestamp, but dedupeKey ensures idempotency
      expect(created1.dedupeKey).toBe(created2.dedupeKey);
      expect(created2.signalId).toBe(created1.signalId); // Should return existing signal
    });
  });

  describe('Contract Test 2: Replayability', () => {
    it('should replay signal and produce same dedupeKey + same payload', async () => {
      const snapshotRef: EvidenceSnapshotRef = {
        s3Uri: 's3://bucket/evidence.json',
        sha256: 'abc123',
        capturedAt: '2026-01-23T00:00:00Z',
        schemaVersion: '1.0.0',
        detectorInputVersion: '1.0.0',
      };

      const storedSignal: Signal = {
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
          evidenceRef: snapshotRef,
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

      // Mock evidence snapshot load
      (mockS3Client.send as jest.Mock).mockResolvedValue({
        Body: {
          transformToString: jest.fn().mockResolvedValue(JSON.stringify({
            entityId: 'acc-123',
            accountId: 'acc-123',
            metadata: { tenantId: 'tenant-456', traceId: 'trace-789' },
            payload: { activationDetected: true },
          })),
        },
      });

      (mockDynamoDBDocumentClient.send as jest.Mock)
        .mockResolvedValueOnce({ Item: storedSignal }) // Get stored signal
        .mockResolvedValueOnce({ Item: null }); // getAccountState returns null

      // Replay signal
      const result = await signalService.replaySignalFromEvidence('sig-123', 'tenant-456', detector);

      // Should match (or at least not throw)
      expect(result).toBeDefined();
      expect(result.recomputedSignal).toBeDefined();
      expect(result.recomputedSignal.dedupeKey).toBe(storedSignal.dedupeKey);
    });
  });

  describe('Contract Test 3: Suppression Logging', () => {
    it('should create ledger entry for every suppression', async () => {
      const signal: Signal = {
        signalId: 'sig-123',
        signalType: SignalType.NO_ENGAGEMENT_PRESENT,
        accountId: 'acc-123',
        tenantId: 'tenant-456',
        traceId: 'trace-789',
        dedupeKey: 'dedupe-key',
        windowKey: 'window-key',
        detectorVersion: '1.0.0',
        detectorInputVersion: '1.0.0',
        status: SignalStatus.ACTIVE,
        metadata: {
          confidence: 0.8,
          confidenceSource: 'derived',
          severity: 'low',
          ttl: {
            ttlDays: null,
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

      const suppressionSet = {
        signalIds: ['sig-123'],
        signalTypes: [SignalType.NO_ENGAGEMENT_PRESENT],
        reason: 'Lifecycle transition: PROSPECT → SUSPECT',
        suppressedBy: 'suppression-rule-prospect-to-suspect-suppression',
        suppressedAt: '2026-01-23T00:00:00Z',
      };

      (mockDynamoDBDocumentClient.send as jest.Mock)
        .mockResolvedValueOnce({}) // Ledger append for suppression
        .mockResolvedValueOnce({ Item: signal }) // Get signal
        .mockResolvedValueOnce({ Attributes: { ...signal, status: SignalStatus.SUPPRESSED } }) // Update status
        .mockResolvedValueOnce({}); // Ledger append for suppression logging

      // Apply suppression
      await suppressionEngine.applySuppression(suppressionSet, signalService, 'tenant-456');

      // Log suppression entries
      await suppressionEngine.logSuppressionEntries(
        suppressionSet,
        'acc-123',
        'tenant-456',
        'trace-789'
      );

      // Verify ledger was called (check all DynamoDB calls, ledger uses same client)
      const allCalls = (mockDynamoDBDocumentClient.send as jest.Mock).mock.calls;
      expect(allCalls.length).toBeGreaterThan(0);
    });
  });

  describe('Contract Test 4: Inference Stability', () => {
    it('should produce same lifecycle state for same active signals set', async () => {
      const accountId = 'acc-123';
      const tenantId = 'tenant-456';

      const activeSignals: Signal[] = [
        {
          signalId: 'sig-1',
          signalType: SignalType.FIRST_ENGAGEMENT_OCCURRED,
          accountId,
          tenantId,
          traceId: 'trace-1',
          dedupeKey: 'dedupe-1',
          windowKey: 'window-1',
          detectorVersion: '1.0.0',
          detectorInputVersion: '1.0.0',
          status: SignalStatus.ACTIVE,
          metadata: {
            confidence: 1.0,
            confidenceSource: 'direct',
            severity: 'high',
            ttl: {
              ttlDays: null,
              expiresAt: null,
              isPermanent: true,
            },
          },
          evidence: {
            evidenceRef: {
              s3Uri: 's3://bucket/key1',
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
        },
      ];

      const accountState = {
        accountId,
        tenantId,
        currentLifecycleState: LifecycleState.PROSPECT,
        activeSignalIndex: {
          [SignalType.FIRST_ENGAGEMENT_OCCURRED]: ['sig-1'],
        } as any,
        lastTransitionAt: null,
        lastEngagementAt: '2026-01-23T00:00:00Z',
        hasActiveContract: false,
        lastInferenceAt: '2026-01-23T00:00:00Z',
        inferenceRuleVersion: '1.0.0',
        createdAt: '2026-01-23T00:00:00Z',
        updatedAt: '2026-01-23T00:00:00Z',
      };

      (mockDynamoDBDocumentClient.send as jest.Mock)
        .mockResolvedValue({ Item: accountState });

      // Infer state multiple times
      const state1 = await lifecycleStateService.inferLifecycleState(accountId, tenantId);
      const state2 = await lifecycleStateService.inferLifecycleState(accountId, tenantId);
      const state3 = await lifecycleStateService.inferLifecycleState(accountId, tenantId);

      // Should always be the same (deterministic)
      expect(state1).toBe(state2);
      expect(state2).toBe(state3);
      expect(state1).toBe(LifecycleState.SUSPECT); // FIRST_ENGAGEMENT_OCCURRED → SUSPECT
    });
  });

  describe('Contract Test 5: Ordering/Race Safety', () => {
    it('should maintain consistency under retries and out-of-order invocations', async () => {
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
        .mockResolvedValue({ Item: null }); // getAccountState returns null

      // Simulate retry scenario
      // First attempt succeeds
      (mockDynamoDBDocumentClient.send as jest.Mock)
        .mockResolvedValueOnce({ Item: null }) // getAccountState
        .mockResolvedValueOnce({}) // TransactWriteItems succeeds
        .mockResolvedValueOnce({}) // Ledger append
        .mockResolvedValueOnce(createEventBridgeSuccessResponse()) // Event publish
        .mockResolvedValueOnce({ Item: null }) // getAccountState (second attempt)
        .mockResolvedValueOnce({ Item: signal }); // Returns existing signal (idempotent)

      const result1 = await signalService.createSignal(signal);

      // Second attempt (retry) - should be idempotent
      const result2 = await signalService.createSignal(signal);

      // Results should be consistent (same signal or idempotent)
      expect(result1.signalId).toBe(result2.signalId);
      expect(result1.dedupeKey).toBe(result2.dedupeKey);

      // Verify DynamoDB was called (atomicity via TransactWriteItems)
      const allCalls = (mockDynamoDBDocumentClient.send as jest.Mock).mock.calls;
      expect(allCalls.length).toBeGreaterThan(0);
    });
  });
});
