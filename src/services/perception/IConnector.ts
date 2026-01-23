/**
 * IConnector - Abstract interface for data connectors
 * 
 * Connectors fetch delta changes from external systems and return
 * EvidenceSnapshotRef[] for deterministic signal detection.
 */

import { EvidenceSnapshotRef } from '../../types/SignalTypes';

/**
 * Sync Mode - Defines how connectors track sync state
 */
export enum SyncMode {
  TIMESTAMP = 'TIMESTAMP',           // Uses lastSyncTimestamp
  CURSOR = 'CURSOR',                 // Uses pagination cursor
  HYBRID = 'HYBRID',                 // Uses both (must specify precedence)
}

/**
 * Connector Interface
 */
export interface IConnector {
  /**
   * Get sync mode for this connector
   */
  getSyncMode(): SyncMode;

  /**
   * Establish connection to external system
   */
  connect(): Promise<void>;

  /**
   * Poll for delta changes
   * Returns EvidenceSnapshotRef[] for immutable evidence snapshots
   */
  poll(): Promise<EvidenceSnapshotRef[]>;

  /**
   * Clean up connection
   */
  disconnect(): Promise<void>;

  /**
   * Get last sync timestamp (if TIMESTAMP or HYBRID mode)
   */
  getLastSyncTimestamp(): Promise<string | null>;

  /**
   * Set last sync timestamp (if TIMESTAMP or HYBRID mode)
   */
  setLastSyncTimestamp(timestamp: string): Promise<void>;

  /**
   * Get pagination cursor (if CURSOR or HYBRID mode)
   */
  getCursor(): Promise<string | null>;

  /**
   * Set pagination cursor (if CURSOR or HYBRID mode)
   */
  setCursor(cursor: string): Promise<void>;
}
