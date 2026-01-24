/**
 * Graph Types - Phase 2: Situation Graph
 * 
 * Defines vertex and edge types, ID schemes, and properties for the Neptune Situation Graph.
 * All vertex IDs are tenant-scoped to prevent cross-tenant collisions.
 */

import { TenantScoped } from './CommonTypes';

/**
 * Vertex Labels (Gremlin label values)
 */
export enum VertexLabel {
  TENANT = 'Tenant',
  ACCOUNT = 'Account',
  SIGNAL = 'Signal',
  EVIDENCE_SNAPSHOT = 'EvidenceSnapshot',
  POSTURE = 'Posture',
  RISK_FACTOR = 'RiskFactor',
  OPPORTUNITY = 'Opportunity',
  UNKNOWN = 'Unknown',
}

/**
 * Edge Labels (Gremlin edge label values)
 */
export enum EdgeLabel {
  HAS_SIGNAL = 'HAS_SIGNAL',
  SUPPORTED_BY = 'SUPPORTED_BY',
  HAS_POSTURE = 'HAS_POSTURE',
  IMPLIES_RISK = 'IMPLIES_RISK',
  IMPLIES_OPPORTUNITY = 'IMPLIES_OPPORTUNITY',
  HAS_UNKNOWN = 'HAS_UNKNOWN',
}

/**
 * Base vertex properties (required for all vertices)
 */
export interface BaseVertexProperties extends TenantScoped {
  entity_type: string; // e.g., "SIGNAL", "ACCOUNT", "POSTURE"
  created_at: string; // ISO timestamp (snake_case)
  updated_at: string; // ISO timestamp (snake_case)
  schema_version: string; // e.g., "v1"
}

/**
 * Tenant Vertex
 * ID: TENANT#{tenant_id}
 */
export interface TenantVertex extends BaseVertexProperties {
  entity_type: 'TENANT';
  tenant_id: string;
}

/**
 * Account Vertex
 * ID: ACCOUNT#{tenant_id}#{account_id}
 */
export interface AccountVertex extends BaseVertexProperties {
  entity_type: 'ACCOUNT';
  account_id: string;
  lifecycle_state?: string; // From Phase 1 lifecycle inference
}

/**
 * Signal Vertex
 * ID: SIGNAL#{tenant_id}#{signal_id}
 * 
 * Critical: Vertex ID uses signal_id (tenant-scoped), NOT dedupeKey.
 * dedupeKey is stored as a property to prevent accidental graph collapse.
 */
export interface SignalVertex extends BaseVertexProperties {
  entity_type: 'SIGNAL';
  signal_id: string; // From Phase 1 signal record
  signal_type: string; // SignalType enum value
  status: string; // SignalStatus enum value (ACTIVE, SUPPRESSED, EXPIRED)
  dedupeKey?: string; // Stored as property, NOT used for vertex identity
  detector_version?: string; // Version of detector that created this signal
  window_key?: string; // Time window key for deduplication
}

/**
 * Evidence Snapshot Vertex
 * ID: EVIDENCE_SNAPSHOT#{tenant_id}#{evidence_snapshot_id}
 * 
 * evidence_snapshot_id can be SHA256 hash or unique ID from EvidenceSnapshotRef
 */
export interface EvidenceSnapshotVertex extends BaseVertexProperties {
  entity_type: 'EVIDENCE_SNAPSHOT';
  evidence_snapshot_id: string; // SHA256 hash or unique ID
  s3_key?: string; // S3 key for evidence snapshot
  sha256?: string; // SHA256 hash of evidence content
}

/**
 * Posture Vertex
 * ID: POSTURE#{tenant_id}#{account_id}#{posture_id}
 * 
 * posture_id = inputs_hash (NOT timestamp) to ensure determinism.
 * Same inputs → same posture_id → same vertex (idempotent).
 */
export interface PostureVertex extends BaseVertexProperties {
  entity_type: 'POSTURE';
  account_id: string;
  posture_id: string; // SHA256 hash of inputs (deterministic)
  posture: string; // PostureState enum value
  momentum?: string; // Momentum enum value
  ruleset_version: string; // Synthesis ruleset version (e.g., "v1.0.0")
  active_signals_hash?: string; // Hash of active signals used in synthesis
}

/**
 * Risk Factor Vertex
 * ID: RISK_FACTOR#{risk_factor_id}
 * 
 * risk_factor_id = SHA256 hash of:
 * {tenant_id, account_id, ruleset_version, inputs_hash, rule_id, type: "RISK_FACTOR", risk_type}
 * 
 * Critical: Must include tenant_id in hash to prevent cross-tenant collisions.
 * Hash components must be sorted lexicographically before hashing.
 */
export interface RiskFactorVertex extends BaseVertexProperties {
  entity_type: 'RISK_FACTOR';
  risk_factor_id: string; // Deterministic hash (includes tenant_id)
  account_id: string;
  risk_type: string; // Risk type identifier
  severity: string; // Severity enum value (low, medium, high)
  description?: string;
  rule_id?: string; // Rule that generated this risk factor
  ruleset_version: string;
}

/**
 * Opportunity Vertex
 * ID: OPPORTUNITY#{opportunity_id}
 * 
 * opportunity_id = SHA256 hash of:
 * {tenant_id, account_id, ruleset_version, inputs_hash, rule_id, type: "OPPORTUNITY", opportunity_type}
 * 
 * Critical: Must include tenant_id in hash to prevent cross-tenant collisions.
 */
export interface OpportunityVertex extends BaseVertexProperties {
  entity_type: 'OPPORTUNITY';
  opportunity_id: string; // Deterministic hash (includes tenant_id)
  account_id: string;
  opportunity_type: string; // Opportunity type identifier
  severity: string; // Severity enum value (low, medium, high)
  description?: string;
  rule_id?: string; // Rule that generated this opportunity
  ruleset_version: string;
}

/**
 * Unknown Vertex
 * ID: UNKNOWN#{unknown_id}
 * 
 * unknown_id = SHA256 hash of:
 * {tenant_id, account_id, ruleset_version, inputs_hash, rule_id, type: "UNKNOWN", unknown_type}
 * 
 * Critical: Must include tenant_id in hash to prevent cross-tenant collisions.
 */
export interface UnknownVertex extends BaseVertexProperties {
  entity_type: 'UNKNOWN';
  unknown_id: string; // Deterministic hash (includes tenant_id)
  account_id: string;
  unknown_type: string; // Unknown type identifier
  description?: string;
  rule_id?: string; // Rule that generated this unknown
  ruleset_version: string;
  introduced_at?: string; // ISO timestamp (stamped by engine, not in ruleset)
  expires_at?: string; // ISO timestamp (stamped by engine, not in ruleset)
  review_after?: string; // ISO timestamp (stamped by engine, not in ruleset)
}

/**
 * Base edge properties (required for all edges)
 */
export interface BaseEdgeProperties {
  created_at: string; // ISO timestamp
  updated_at: string; // ISO timestamp
  trace_id?: string; // For ledger alignment
  schema_version: string; // e.g., "v1"
  weight?: number; // Optional edge weight
  metadata?: Record<string, any>; // Optional JSON metadata
}

/**
 * Vertex ID generation utilities
 */
export class VertexIdGenerator {
  /**
   * Generate tenant vertex ID
   */
  static tenant(tenantId: string): string {
    return `TENANT#${tenantId}`;
  }

  /**
   * Generate account vertex ID (tenant-scoped)
   */
  static account(tenantId: string, accountId: string): string {
    return `ACCOUNT#${tenantId}#${accountId}`;
  }

  /**
   * Generate signal vertex ID (tenant-scoped)
   * 
   * Critical: Uses signal_id, NOT dedupeKey, to prevent accidental graph collapse.
   */
  static signal(tenantId: string, signalId: string): string {
    return `SIGNAL#${tenantId}#${signalId}`;
  }

  /**
   * Generate evidence snapshot vertex ID (tenant-scoped)
   */
  static evidenceSnapshot(tenantId: string, evidenceSnapshotId: string): string {
    return `EVIDENCE_SNAPSHOT#${tenantId}#${evidenceSnapshotId}`;
  }

  /**
   * Generate posture vertex ID
   * 
   * postureId should be a deterministic hash of inputs (not timestamp).
   */
  static posture(tenantId: string, accountId: string, postureId: string): string {
    return `POSTURE#${tenantId}#${accountId}#${postureId}`;
  }

  /**
   * Generate risk factor vertex ID
   * 
   * riskFactorId should be a deterministic hash including tenant_id.
   */
  static riskFactor(riskFactorId: string): string {
    return `RISK_FACTOR#${riskFactorId}`;
  }

  /**
   * Generate opportunity vertex ID
   * 
   * opportunityId should be a deterministic hash including tenant_id.
   */
  static opportunity(opportunityId: string): string {
    return `OPPORTUNITY#${opportunityId}`;
  }

  /**
   * Generate unknown vertex ID
   * 
   * unknownId should be a deterministic hash including tenant_id.
   */
  static unknown(unknownId: string): string {
    return `UNKNOWN#${unknownId}`;
  }
}

/**
 * Type guard utilities
 */
export function isSignalVertex(vertex: any): vertex is SignalVertex {
  return vertex?.entity_type === 'SIGNAL';
}

export function isAccountVertex(vertex: any): vertex is AccountVertex {
  return vertex?.entity_type === 'ACCOUNT';
}

export function isPostureVertex(vertex: any): vertex is PostureVertex {
  return vertex?.entity_type === 'POSTURE';
}
