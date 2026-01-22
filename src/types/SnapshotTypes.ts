import { EntityState } from './WorldStateTypes';

/**
 * Snapshot metadata
 */
export interface SnapshotMetadata {
  snapshotId: string;
  entityId: string;
  entityType: string;
  tenantId: string;
  version: string;           // Schema version used
  createdAt: string;         // ISO timestamp
  asOf: string;              // ISO timestamp (point-in-time)
  createdBy?: string;        // userId or agentId
  reason?: string;           // Why snapshot was created
  bindingRequired: boolean;  // Whether this snapshot must be bound to decisions/actions
}

/**
 * World state snapshot
 */
export interface WorldSnapshot {
  snapshotId: string;
  metadata: SnapshotMetadata;
  state: EntityState;
  s3Location: string;        // S3 key where snapshot is stored
  s3VersionId?: string;      // S3 version ID for versioned buckets
  schemaHash: string;        // Hash of schema used for validation
}

/**
 * Snapshot query filters
 */
export interface SnapshotQuery {
  tenantId: string;
  entityId?: string;
  entityType?: string;
  asOf?: string;             // Point-in-time query
  startTime?: string;
  endTime?: string;
  limit?: number;
}

/**
 * Snapshot service interface
 */
export interface ISnapshotService {
  createSnapshot(entityId: string, entityType: string, tenantId: string, state?: EntityState, reason?: string): Promise<WorldSnapshot>;
  getSnapshot(snapshotId: string, tenantId: string): Promise<WorldSnapshot | null>;
  getSnapshotByTimestamp(entityId: string, tenantId: string, timestamp: string): Promise<WorldSnapshot | null>;
  query(query: SnapshotQuery): Promise<WorldSnapshot[]>;
}
