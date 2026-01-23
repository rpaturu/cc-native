/**
 * BaseConnector - Common connector functionality
 * 
 * Provides base implementation for connectors with:
 * - Delta-based polling
 * - Rate limiting
 * - Error handling
 * - Evidence storage integration
 */

import { IConnector, SyncMode } from './IConnector';
import { EvidenceSnapshotRef } from '../../types/SignalTypes';
import { EvidenceService } from '../world-model/EvidenceService';
import { Logger } from '../core/Logger';
import { S3Client } from '@aws-sdk/client-s3';
import { createHash } from 'crypto';

export interface BaseConnectorConfig {
  connectorName: string;
  tenantId: string;
  evidenceService: EvidenceService;
  logger: Logger;
  syncMode: SyncMode;
  rateLimit?: {
    requestsPerMinute: number;
    burst: number;
  };
}

/**
 * Base Connector Class
 * 
 * Abstract base class for all connectors. Handles common functionality
 * like evidence snapshot creation, rate limiting, and error handling.
 */
export abstract class BaseConnector implements IConnector {
  protected connectorName: string;
  protected tenantId: string;
  protected evidenceService: EvidenceService;
  protected logger: Logger;
  protected syncMode: SyncMode;
  protected rateLimit?: {
    requestsPerMinute: number;
    burst: number;
  };

  // Sync state
  protected lastSyncTimestamp: string | null = null;
  protected cursor: string | null = null;

  constructor(config: BaseConnectorConfig) {
    this.connectorName = config.connectorName;
    this.tenantId = config.tenantId;
    this.evidenceService = config.evidenceService;
    this.logger = config.logger;
    this.syncMode = config.syncMode;
    this.rateLimit = config.rateLimit;
  }

  /**
   * Get sync mode for this connector
   */
  getSyncMode(): SyncMode {
    return this.syncMode;
  }

  /**
   * Connect to external system
   * Must be implemented by subclasses
   */
  abstract connect(): Promise<void>;

  /**
   * Poll for delta changes
   * Must be implemented by subclasses
   */
  abstract poll(): Promise<EvidenceSnapshotRef[]>;

  /**
   * Disconnect from external system
   * Must be implemented by subclasses
   */
  abstract disconnect(): Promise<void>;

  /**
   * Get last sync timestamp
   */
  async getLastSyncTimestamp(): Promise<string | null> {
    if (this.syncMode === SyncMode.CURSOR) {
      throw new Error(`Connector ${this.connectorName} uses CURSOR mode, not TIMESTAMP`);
    }
    return this.lastSyncTimestamp;
  }

  /**
   * Set last sync timestamp
   */
  async setLastSyncTimestamp(timestamp: string): Promise<void> {
    if (this.syncMode === SyncMode.CURSOR) {
      throw new Error(`Connector ${this.connectorName} uses CURSOR mode, not TIMESTAMP`);
    }
    this.lastSyncTimestamp = timestamp;
    this.logger.debug('Last sync timestamp updated', {
      connector: this.connectorName,
      timestamp,
    });
  }

  /**
   * Get pagination cursor
   */
  async getCursor(): Promise<string | null> {
    if (this.syncMode === SyncMode.TIMESTAMP) {
      throw new Error(`Connector ${this.connectorName} uses TIMESTAMP mode, not CURSOR`);
    }
    return this.cursor;
  }

  /**
   * Set pagination cursor
   */
  async setCursor(cursor: string): Promise<void> {
    if (this.syncMode === SyncMode.TIMESTAMP) {
      throw new Error(`Connector ${this.connectorName} uses TIMESTAMP mode, not CURSOR`);
    }
    this.cursor = cursor;
    this.logger.debug('Cursor updated', {
      connector: this.connectorName,
      cursor: cursor.substring(0, 20) + '...', // Log partial cursor
    });
  }

  /**
   * Create EvidenceSnapshotRef from raw data
   * 
   * Stores evidence snapshot in S3 and returns reference.
   */
  protected async createEvidenceSnapshot(
    entityId: string,
    entityType: string,
    data: any,
    schemaVersion: string,
    detectorInputVersion: string
  ): Promise<EvidenceSnapshotRef> {
    const now = new Date().toISOString();
    const traceId = `connector-${this.connectorName}-${now}`;
    
    // Compute SHA256 hash
    const dataString = JSON.stringify(data);
    const sha256 = createHash('sha256').update(dataString).digest('hex');

    // Store evidence via EvidenceService
    const evidence = await this.evidenceService.store({
      entityId,
      entityType,
      evidenceType: 'EXTERNAL' as any, // Connector evidence is external source
      payload: {
        ...data,
        _schemaVersion: schemaVersion,
        _detectorInputVersion: detectorInputVersion,
      },
      provenance: {
        trustClass: 'PRIMARY',
        sourceSystem: this.connectorName,
        collectedAt: now,
      },
      metadata: {
        traceId,
        tenantId: this.tenantId,
      },
    });

    // Construct S3 URI from s3Location
    // s3Location is the S3 key, we need to construct full URI
    const s3Uri = `s3://${this.evidenceService['evidenceBucket']}/${evidence.s3Location}`;

    // Return EvidenceSnapshotRef
    return {
      s3Uri,
      sha256,
      capturedAt: now,
      schemaVersion,
      detectorInputVersion,
    };
  }

  /**
   * Apply rate limiting
   * 
   * Simple token bucket implementation.
   */
  protected async applyRateLimit(): Promise<void> {
    if (!this.rateLimit) {
      return;
    }

    // TODO: Implement token bucket rate limiting
    // For now, just log that rate limiting would be applied
    this.logger.debug('Rate limit check', {
      connector: this.connectorName,
      rateLimit: this.rateLimit,
    });
  }

  /**
   * Handle errors with consistent logging
   */
  protected handleError(error: unknown, context: Record<string, any>): void {
    this.logger.error('Connector error', {
      connector: this.connectorName,
      error: error instanceof Error ? error.message : String(error),
      ...context,
    });
  }
}
