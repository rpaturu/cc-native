/**
 * BaseDetector - Base class for signal detectors
 * 
 * Provides common functionality for all detectors:
 * - Evidence snapshot loading
 * - Signal creation helpers
 * - WindowKey derivation
 * - DedupeKey generation
 */

import { ISignalDetector } from '../ISignalDetector';
import {
  Signal,
  SignalType,
  EvidenceSnapshotRef,
  SignalStatus,
  SignalMetadata,
  EvidenceBinding,
  SignalSuppression,
  SignalTTL,
  WINDOW_KEY_DERIVATION,
  DEFAULT_SIGNAL_TTL,
} from '../../../types/SignalTypes';
import { AccountState } from '../../../types/LifecycleTypes';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { createHash } from 'crypto';
import { Logger } from '../../../services/core/Logger';

export interface BaseDetectorConfig {
  detectorName: string;
  detectorVersion: string;
  supportedSignals: SignalType[];
  logger: Logger;
  s3Client?: S3Client;
}

/**
 * Base Detector Class
 */
export abstract class BaseDetector implements ISignalDetector {
  protected detectorName: string;
  protected detectorVersion: string;
  protected supportedSignals: SignalType[];
  protected logger: Logger;
  protected s3Client?: S3Client;

  constructor(config: BaseDetectorConfig) {
    this.detectorName = config.detectorName;
    this.detectorVersion = config.detectorVersion;
    this.supportedSignals = config.supportedSignals;
    this.logger = config.logger;
    this.s3Client = config.s3Client;
  }

  getDetectorVersion(): string {
    return this.detectorVersion;
  }

  getSupportedSignals(): SignalType[] {
    return this.supportedSignals;
  }

  /**
   * Detect signals - must be implemented by subclasses
   */
  abstract detect(
    snapshotRef: EvidenceSnapshotRef,
    priorState?: AccountState
  ): Promise<Signal[]>;

  /**
   * Load evidence snapshot from S3
   */
  protected async loadEvidenceSnapshot(snapshotRef: EvidenceSnapshotRef): Promise<any> {
    if (!this.s3Client) {
      throw new Error('S3Client not configured for detector');
    }

    // Parse S3 URI: s3://bucket/key
    const uriMatch = snapshotRef.s3Uri.match(/^s3:\/\/([^/]+)\/(.+)$/);
    if (!uriMatch) {
      throw new Error(`Invalid S3 URI: ${snapshotRef.s3Uri}`);
    }

    const [, bucket, key] = uriMatch;

    try {
      const response = await this.s3Client.send(new GetObjectCommand({
        Bucket: bucket,
        Key: key,
      }));

      if (!response.Body) {
        throw new Error('Empty response body from S3');
      }

      const bodyString = await response.Body.transformToString();
      const evidence = JSON.parse(bodyString);

      // Verify SHA256 hash
      const computedHash = createHash('sha256').update(bodyString).digest('hex');
      if (computedHash !== snapshotRef.sha256) {
        throw new Error(`SHA256 hash mismatch for evidence snapshot: ${snapshotRef.s3Uri}`);
      }

      return evidence;
    } catch (error) {
      this.logger.error('Failed to load evidence snapshot', {
        detector: this.detectorName,
        s3Uri: snapshotRef.s3Uri,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Create signal with all required metadata
   */
  protected createSignal(
    signalType: SignalType,
    accountId: string,
    tenantId: string,
    traceId: string,
    snapshotRef: EvidenceSnapshotRef,
    evidence: any,
    metadata: {
      confidence: number;
      confidenceSource: 'direct' | 'derived' | 'inferred';
      severity: 'low' | 'medium' | 'high' | 'critical';
      description?: string;
      context?: Record<string, any>;
    }
  ): Signal {
    const now = new Date().toISOString();

    // Derive windowKey
    const windowKey = WINDOW_KEY_DERIVATION[signalType](accountId, evidence, now);

    // Generate dedupeKey: accountId + signalType + windowKey + evidence hash
    const evidenceHash = snapshotRef.sha256.substring(0, 16); // Use first 16 chars
    const dedupeKey = `${accountId}-${signalType}-${windowKey}-${evidenceHash}`;

    // Get TTL configuration
    const ttlConfig = DEFAULT_SIGNAL_TTL[signalType];
    const expiresAt = ttlConfig.isPermanent
      ? null
      : ttlConfig.ttlDays
      ? new Date(Date.now() + ttlConfig.ttlDays * 24 * 60 * 60 * 1000).toISOString()
      : null;

    // Create signal
    const signal: Signal = {
      signalId: `sig_${Date.now()}_${createHash('md5').update(dedupeKey).digest('hex').substring(0, 8)}`,
      signalType,
      accountId,
      tenantId,
      traceId,
      dedupeKey,
      windowKey,
      detectorVersion: this.detectorVersion,
      detectorInputVersion: snapshotRef.detectorInputVersion,
      status: SignalStatus.ACTIVE,
      metadata: {
        confidence: metadata.confidence,
        confidenceSource: metadata.confidenceSource,
        severity: metadata.severity,
        ttl: {
          ttlDays: ttlConfig.ttlDays,
          expiresAt,
          isPermanent: ttlConfig.isPermanent,
        },
      } as SignalMetadata,
      evidence: {
        evidenceRef: snapshotRef,
        evidenceSchemaVersion: snapshotRef.schemaVersion,
      } as EvidenceBinding,
      suppression: {
        suppressed: false,
        suppressedAt: null,
        suppressedBy: null,
        inferenceActive: true,
      } as SignalSuppression,
      description: metadata.description,
      context: metadata.context,
      createdAt: now,
      updatedAt: now,
    };

    return signal;
  }
}
