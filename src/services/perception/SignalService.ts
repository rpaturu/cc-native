/**
 * SignalService - Manage signal creation, storage, and retrieval
 * 
 * Key features:
 * - Idempotent signal creation via dedupeKey
 * - Atomic updates with AccountState (TransactWriteItems)
 * - TTL expiry management
 * - Status state machine (ACTIVE | SUPPRESSED | EXPIRED)
 * - Signal replayability for determinism verification
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { Signal, SignalType, SignalStatus, EvidenceSnapshotRef } from '../../types/SignalTypes';
import { AccountState, LifecycleState } from '../../types/LifecycleTypes';
import { Logger } from '../core/Logger';
import { LifecycleStateService } from './LifecycleStateService';
import { EventPublisher } from '../events/EventPublisher';
import { LedgerService } from '../ledger/LedgerService';
import { LedgerEventType } from '../../types/LedgerTypes';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { createHash } from 'crypto';

export interface SignalServiceConfig {
  logger: Logger;
  signalsTableName: string;
  /** Required for createSignal (lifecycle signals). Omit for execution-only (createExecutionSignal only). */
  accountsTableName?: string;
  /** Required for createSignal. Omit for execution-only. */
  lifecycleStateService?: LifecycleStateService;
  /** Optional for createExecutionSignal (event publish). */
  eventPublisher?: EventPublisher;
  /** Optional for createExecutionSignal (ledger append). */
  ledgerService?: LedgerService;
  s3Client?: S3Client;
  region?: string;
}

/**
 * SignalService
 */
export class SignalService {
  private dynamoClient: DynamoDBDocumentClient;
  private logger: Logger;
  private signalsTableName: string;
  private accountsTableName: string | undefined;
  private lifecycleStateService: LifecycleStateService | undefined;
  private eventPublisher: EventPublisher | undefined;
  private ledgerService: LedgerService | undefined;
  private s3Client?: S3Client;

  constructor(config: SignalServiceConfig) {
    this.logger = config.logger;
    this.signalsTableName = config.signalsTableName;
    this.accountsTableName = config.accountsTableName;
    this.lifecycleStateService = config.lifecycleStateService;
    this.eventPublisher = config.eventPublisher;
    this.ledgerService = config.ledgerService;
    this.s3Client = config.s3Client;
    this.dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({ region: config.region }));
  }

  /**
   * Create and store signal (idempotent via dedupeKey)
   * 
   * Atomicity: Updates signalsTable + AccountState in single transaction.
   * Uses DynamoDB TransactWriteItems for atomicity.
   * Requires accountsTableName, lifecycleStateService, eventPublisher, ledgerService (full config).
   */
  async createSignal(signal: Signal): Promise<Signal> {
    if (
      !this.accountsTableName ||
      !this.lifecycleStateService ||
      !this.eventPublisher ||
      !this.ledgerService
    ) {
      throw new Error(
        'SignalService not configured for full lifecycle signals. ' +
          'Provide accountsTableName, lifecycleStateService, eventPublisher, and ledgerService for createSignal(). ' +
          'Use createExecutionSignal() for execution-only signals.'
      );
    }
    try {
      // Check for existing signal with same dedupeKey (idempotency check)
      const existing = await this.getSignalByDedupeKey(signal.tenantId, signal.dedupeKey);
      if (existing) {
        this.logger.debug('Signal already exists (idempotent)', {
          signalId: existing.signalId,
          dedupeKey: signal.dedupeKey,
        });
        return existing;
      }

      // Get current AccountState
      const accountState = await this.lifecycleStateService.getAccountState(
        signal.accountId,
        signal.tenantId
      );

      // Prepare AccountState update
      const updatedSignalIndex = accountState
        ? { ...accountState.activeSignalIndex }
        : this.initializeActiveSignalIndex();
      
      // Add signal to active index
      if (!updatedSignalIndex[signal.signalType]) {
        updatedSignalIndex[signal.signalType] = [];
      }
      updatedSignalIndex[signal.signalType].push(signal.signalId);

      // Update lastEngagementAt if engagement signal
      const lastEngagementAt = signal.signalType === SignalType.FIRST_ENGAGEMENT_OCCURRED
        ? signal.createdAt
        : accountState?.lastEngagementAt || null;

      // Use TransactWriteItems for atomicity
      await this.dynamoClient.send(new TransactWriteCommand({
        TransactItems: [
          // Write signal
          {
            Put: {
              TableName: this.signalsTableName,
              Item: {
                ...signal,
                timestamp: signal.createdAt, // Add timestamp for GSI
              },
              ConditionExpression: 'attribute_not_exists(signalId)',
            },
          },
          // Update AccountState
          {
            Update: {
              TableName: this.accountsTableName,
              Key: {
                tenantId: signal.tenantId,
                accountId: signal.accountId,
              },
              UpdateExpression: 'SET activeSignalIndex = :index, lastEngagementAt = :engagement, updatedAt = :now, lastInferenceAt = :now',
              ExpressionAttributeValues: {
                ':index': updatedSignalIndex,
                ':engagement': lastEngagementAt,
                ':now': new Date().toISOString(),
              },
            },
          },
        ],
      }));

      // Log to ledger
      await this.ledgerService.append({
        eventType: LedgerEventType.SIGNAL,
        accountId: signal.accountId,
        tenantId: signal.tenantId,
        traceId: signal.traceId,
        data: {
          signalId: signal.signalId,
          signalType: signal.signalType,
          confidence: signal.metadata.confidence,
          severity: signal.metadata.severity,
        },
        evidenceRefs: [{
          type: 's3',
          location: signal.evidence.evidenceRef.s3Uri,
          timestamp: signal.evidence.evidenceRef.capturedAt,
        }],
      });

      // Publish event
      await this.eventPublisher.publish({
        eventType: 'SIGNAL_CREATED',
        source: 'perception',
        payload: {
          signalId: signal.signalId,
          signalType: signal.signalType,
          accountId: signal.accountId,
        },
        traceId: signal.traceId,
        tenantId: signal.tenantId,
        ts: signal.createdAt,
      });

      this.logger.info('Signal created', {
        signalId: signal.signalId,
        signalType: signal.signalType,
        accountId: signal.accountId,
        tenantId: signal.tenantId,
      });

      return signal;
    } catch (error: any) {
      // Check if it's a conditional check failure (idempotency)
      if (error.name === 'TransactionCanceledException' || 
          error.message?.includes('ConditionalCheckFailed')) {
        // Try to get existing signal
        const existing = await this.getSignalByDedupeKey(signal.tenantId, signal.dedupeKey);
        if (existing) {
          return existing;
        }
      }

      this.logger.error('Failed to create signal', {
        signalId: signal.signalId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Create execution outcome signal (Phase 4.4).
   * Writes only to signals table; no lifecycle state or accounts table update.
   * Idempotent via signalId (ConditionExpression attribute_not_exists(signalId)).
   * Optionally publishes event and appends to ledger when configured.
   */
  async createExecutionSignal(signal: Signal): Promise<Signal> {
    try {
      await this.dynamoClient.send(
        new PutCommand({
          TableName: this.signalsTableName,
          Item: {
            ...signal,
            timestamp: signal.createdAt,
          },
          ConditionExpression: 'attribute_not_exists(signalId)',
        })
      );

      if (this.ledgerService) {
        await this.ledgerService.append({
          eventType: LedgerEventType.SIGNAL,
          accountId: signal.accountId,
          tenantId: signal.tenantId,
          traceId: signal.traceId,
          data: {
            signalId: signal.signalId,
            signalType: signal.signalType,
            confidence: signal.metadata.confidence,
            severity: signal.metadata.severity,
          },
          evidenceRefs: [
            {
              type: 's3',
              location: signal.evidence.evidenceRef.s3Uri,
              timestamp: signal.evidence.evidenceRef.capturedAt,
            },
          ],
        });
      }

      if (this.eventPublisher) {
        await this.eventPublisher.publish({
          eventType: 'SIGNAL_CREATED',
          source: 'perception',
          payload: {
            signalId: signal.signalId,
            signalType: signal.signalType,
            accountId: signal.accountId,
          },
          traceId: signal.traceId,
          tenantId: signal.tenantId,
          ts: signal.createdAt,
        });
      }

      this.logger.info('Execution signal created', {
        signalId: signal.signalId,
        signalType: signal.signalType,
        accountId: signal.accountId,
        tenantId: signal.tenantId,
      });
      return signal;
    } catch (error: any) {
      if (error.name === 'ConditionalCheckFailedException') {
        const existing = await this.dynamoClient.send(
          new GetCommand({
            TableName: this.signalsTableName,
            Key: { tenantId: signal.tenantId, signalId: signal.signalId },
          })
        );
        if (existing.Item) {
          this.logger.debug('Execution signal already exists (idempotent)', {
            signalId: signal.signalId,
            dedupeKey: signal.dedupeKey,
          });
          return existing.Item as Signal;
        }
      }
      this.logger.error('Failed to create execution signal', {
        signalId: signal.signalId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get signal by dedupeKey (for idempotency)
   * 
   * Note: For Phase 1, we rely on the ConditionExpression in createSignal
   * to prevent duplicates. A dedupeKey-index GSI can be added later for
   * better idempotency checking.
   */
  private async getSignalByDedupeKey(tenantId: string, dedupeKey: string): Promise<Signal | null> {
    // For Phase 1, we rely on TransactWriteItems ConditionExpression
    // to prevent duplicates. This method is a placeholder for future
    // GSI-based lookup if needed.
    return null;
  }

  /**
   * Get signals for account (ACTIVE only by default)
   */
  async getSignalsForAccount(
    accountId: string,
    tenantId: string,
    filters?: {
      signalTypes?: SignalType[];
      status?: SignalStatus;
      startTime?: string;
      endTime?: string;
    }
  ): Promise<Signal[]> {
    try {
      const status = filters?.status || SignalStatus.ACTIVE;

      const result = await this.dynamoClient.send(new QueryCommand({
        TableName: this.signalsTableName,
        IndexName: 'accountId-index',
        KeyConditionExpression: 'accountId = :accountId',
        FilterExpression: filters?.signalTypes
          ? '#status = :status AND signalType IN (:types)'
          : '#status = :status',
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: {
          ':accountId': accountId,
          ':status': status,
          ...(filters?.signalTypes ? { ':types': filters.signalTypes } : {}),
        },
        ScanIndexForward: false, // Most recent first
      }));

      return (result.Items || []) as Signal[];
    } catch (error) {
      this.logger.error('Failed to get signals for account', {
        accountId,
        tenantId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Update signal status (ACTIVE | SUPPRESSED | EXPIRED)
   */
  async updateSignalStatus(
    signalId: string,
    tenantId: string,
    status: SignalStatus,
    reason?: string
  ): Promise<Signal> {
    try {
      const now = new Date().toISOString();

      // Get current signal
      const current = await this.dynamoClient.send(new GetCommand({
        TableName: this.signalsTableName,
        Key: {
          tenantId,
          signalId,
        },
      }));

      if (!current.Item) {
        throw new Error(`Signal not found: ${signalId}`);
      }

      const signal = current.Item as Signal;

      // Enforce status state machine invariants
      if (signal.status === SignalStatus.SUPPRESSED && status === SignalStatus.ACTIVE) {
        throw new Error('SUPPRESSED signals cannot become ACTIVE again');
      }

      // Update status
      const updated = await this.dynamoClient.send(new UpdateCommand({
        TableName: this.signalsTableName,
        Key: {
          tenantId,
          signalId,
        },
        UpdateExpression: 'SET #status = :status, updatedAt = :now, suppression.suppressed = :suppressed, suppression.suppressedAt = :suppressedAt, suppression.suppressedBy = :suppressedBy, suppression.inferenceActive = :inferenceActive',
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: {
          ':status': status,
          ':now': now,
          ':suppressed': status === SignalStatus.SUPPRESSED,
          ':suppressedAt': status === SignalStatus.SUPPRESSED ? now : null,
          ':suppressedBy': status === SignalStatus.SUPPRESSED ? reason || 'system' : null,
          ':inferenceActive': status === SignalStatus.ACTIVE,
        },
        ReturnValues: 'ALL_NEW',
      }));

      // Update AccountState activeSignalIndex if status changed
      if (signal.status === SignalStatus.ACTIVE && status !== SignalStatus.ACTIVE) {
        await this.removeSignalFromAccountState(signal.accountId, signal.tenantId, signal.signalId, signal.signalType);
      } else if (signal.status !== SignalStatus.ACTIVE && status === SignalStatus.ACTIVE) {
        await this.addSignalToAccountState(signal.accountId, signal.tenantId, signal.signalId, signal.signalType);
      }

      return updated.Attributes as Signal;
    } catch (error) {
      this.logger.error('Failed to update signal status', {
        signalId,
        tenantId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Check and mark expired signals
   */
  async checkTTLExpiry(signalId: string, tenantId: string): Promise<Signal | null> {
    try {
      const signal = await this.dynamoClient.send(new GetCommand({
        TableName: this.signalsTableName,
        Key: {
          tenantId,
          signalId,
        },
      }));

      if (!signal.Item) {
        return null;
      }

      const sig = signal.Item as Signal;

      // Don't expire suppressed signals
      if (sig.status === SignalStatus.SUPPRESSED) {
        return sig;
      }

      // Check if expired
      const expiresAt = sig.metadata.ttl.expiresAt;
      if (expiresAt && new Date(expiresAt) < new Date()) {
        return await this.updateSignalStatus(signalId, tenantId, SignalStatus.EXPIRED, 'TTL expired');
      }

      return sig;
    } catch (error) {
      this.logger.error('Failed to check TTL expiry', {
        signalId,
        tenantId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Replay signal detection from evidence snapshot
   * 
   * Returns recomputed signal and compares to stored signal.
   * If mismatch, logs REPLAY_MISMATCH to ledger.
   */
  async replaySignalFromEvidence(signalId: string, tenantId: string, detector: any): Promise<{
    recomputedSignal: Signal;
    matches: boolean;
  }> {
    if (!this.lifecycleStateService || !this.ledgerService) {
      throw new Error(
        'SignalService not configured for replay. Provide lifecycleStateService and ledgerService.'
      );
    }
    try {
      // Get stored signal
      const stored = await this.dynamoClient.send(new GetCommand({
        TableName: this.signalsTableName,
        Key: {
          tenantId,
          signalId,
        },
      }));

      if (!stored.Item) {
        throw new Error(`Signal not found: ${signalId}`);
      }

      const storedSignal = stored.Item as Signal;

      // Get AccountState for context
      const accountState = await this.lifecycleStateService.getAccountState(
        storedSignal.accountId,
        tenantId
      );

      // Replay detection
      const detectedSignals = await detector.detect(
        storedSignal.evidence.evidenceRef,
        accountState || undefined
      );

      // Find matching signal
      const recomputed = detectedSignals.find((s: Signal) => s.signalType === storedSignal.signalType);

      if (!recomputed) {
        // No signal detected on replay
        await this.ledgerService.append({
          eventType: LedgerEventType.VALIDATION,
          accountId: storedSignal.accountId,
          tenantId,
          traceId: `replay-${Date.now()}`,
          data: {
            replayMismatch: true,
            signalId,
            reason: 'Signal not detected on replay',
          },
        });

        return {
          recomputedSignal: storedSignal, // Return stored as fallback
          matches: false,
        };
      }

      // Compare dedupeKey and key fields
      const matches =
        recomputed.dedupeKey === storedSignal.dedupeKey &&
        recomputed.windowKey === storedSignal.windowKey &&
        (recomputed.metadata?.confidence ?? 0) === (storedSignal.metadata?.confidence ?? 0);

      if (!matches) {
        // Log mismatch
        await this.ledgerService.append({
          eventType: LedgerEventType.VALIDATION,
          accountId: storedSignal.accountId,
          tenantId,
          traceId: `replay-${Date.now()}`,
          data: {
            replayMismatch: true,
            signalId,
            reason: 'Signal payload mismatch on replay',
            storedDedupeKey: storedSignal.dedupeKey,
            recomputedDedupeKey: recomputed.dedupeKey,
          },
        });
      }

      return {
        recomputedSignal: recomputed,
        matches,
      };
    } catch (error) {
      this.logger.error('Failed to replay signal from evidence', {
        signalId,
        tenantId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Remove signal from AccountState activeSignalIndex
   */
  private async removeSignalFromAccountState(
    accountId: string,
    tenantId: string,
    signalId: string,
    signalType: SignalType
  ): Promise<void> {
    if (!this.lifecycleStateService) return;
    const accountState = await this.lifecycleStateService.getAccountState(accountId, tenantId);
    if (!accountState) {
      return;
    }

    const updatedIndex = { ...accountState.activeSignalIndex };
    const list = updatedIndex[signalType];
    if (list) {
      updatedIndex[signalType] = list.filter((id) => id !== signalId);
    }

    await this.lifecycleStateService.updateAccountState(accountId, tenantId, {
      activeSignalIndex: updatedIndex,
    });
  }

  /**
   * Add signal to AccountState activeSignalIndex
   */
  private async addSignalToAccountState(
    accountId: string,
    tenantId: string,
    signalId: string,
    signalType: SignalType
  ): Promise<void> {
    if (!this.lifecycleStateService) {
      throw new Error('SignalService not configured for lifecycle. Provide lifecycleStateService.');
    }
    const accountState = await this.lifecycleStateService.getAccountState(accountId, tenantId);
    const updatedIndex = accountState
      ? { ...accountState.activeSignalIndex }
      : this.initializeActiveSignalIndex();

    const list = updatedIndex[signalType] ?? [];
    if (!list.includes(signalId)) {
      updatedIndex[signalType] = [...list, signalId];
    }

    await this.lifecycleStateService.updateAccountState(accountId, tenantId, {
      activeSignalIndex: updatedIndex,
    });
  }

  /**
   * Initialize active signal index
   */
  private initializeActiveSignalIndex(): Record<SignalType, string[]> {
    return {
      [SignalType.ACCOUNT_ACTIVATION_DETECTED]: [],
      [SignalType.NO_ENGAGEMENT_PRESENT]: [],
      [SignalType.FIRST_ENGAGEMENT_OCCURRED]: [],
      [SignalType.DISCOVERY_PROGRESS_STALLED]: [],
      [SignalType.STAKEHOLDER_GAP_DETECTED]: [],
      [SignalType.USAGE_TREND_CHANGE]: [],
      [SignalType.SUPPORT_RISK_EMERGING]: [],
      [SignalType.ACTION_EXECUTED]: [],
      [SignalType.ACTION_FAILED]: [],
      [SignalType.RENEWAL_WINDOW_ENTERED]: [],
    };
  }
}
