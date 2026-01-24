/**
 * Posture Types - Phase 2: Deterministic Synthesis
 * 
 * Defines posture state, risk factors, opportunities, and unknowns for AccountPostureState.
 * All types are versioned (V1) and enforce deterministic synthesis.
 */

import { TenantScoped, Timestamped } from './CommonTypes';
import { EvidenceSnapshotRef } from './SignalTypes';

/**
 * Posture State Enum
 */
export enum PostureState {
  OK = 'OK',
  WATCH = 'WATCH',
  AT_RISK = 'AT_RISK',
  EXPAND = 'EXPAND',
  DORMANT = 'DORMANT',
}

/**
 * Momentum Enum
 */
export enum Momentum {
  UP = 'UP',
  FLAT = 'FLAT',
  DOWN = 'DOWN',
}

/**
 * Severity Enum (Normalized)
 * 
 * Only three values allowed: low, medium, high
 * No 'critical' or other values allowed.
 */
export enum Severity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
}

/**
 * Risk Factor V1
 * 
 * Represents a risk factor derived from synthesis rules.
 * risk_id is a deterministic hash including tenant_id to prevent cross-tenant collisions.
 */
export interface RiskFactorV1 {
  risk_id: string; // Deterministic hash (includes tenant_id)
  type: string; // e.g., "RENEWAL_RISK", "USAGE_DECLINE"
  severity: Severity; // low | medium | high
  description: string;
  evidence_signal_ids: string[]; // Top K signal IDs (authoritative)
  evidence_snapshot_refs: EvidenceSnapshotRef[]; // Top K snapshot refs
  introduced_at: string; // ISO timestamp
  expires_at?: string | null; // ISO timestamp (optional)
  rule_id?: string; // Rule that generated this risk factor
  ruleset_version: string; // Ruleset version (e.g., "v1.0.0")
}

/**
 * Opportunity V1
 * 
 * Represents an opportunity derived from synthesis rules.
 * opportunity_id is a deterministic hash including tenant_id.
 */
export interface OpportunityV1 {
  opportunity_id: string; // Deterministic hash (includes tenant_id)
  type: string; // e.g., "EARLY_ENGAGEMENT", "USAGE_GROWTH"
  severity: Severity; // low | medium | high
  description: string;
  evidence_signal_ids: string[]; // Top K signal IDs (authoritative)
  evidence_snapshot_refs: EvidenceSnapshotRef[]; // Top K snapshot refs
  introduced_at: string; // ISO timestamp
  expires_at?: string | null; // ISO timestamp (optional)
  rule_id?: string; // Rule that generated this opportunity
  ruleset_version: string; // Ruleset version (e.g., "v1.0.0")
}

/**
 * Unknown V1 (TTL Semantics Required)
 * 
 * Represents an unknown that requires investigation or review.
 * At least one of expires_at or review_after must be set.
 * 
 * Critical: Timestamps (introduced_at, expires_at, review_after) are derived from
 * event.as_of_time (not wall clock) and are excluded from semantic-equality checks.
 */
export interface UnknownV1 {
  unknown_id: string; // Deterministic hash (includes tenant_id)
  type: string; // e.g., "ENGAGEMENT_QUALITY", "SUSPECT_PROGRESSION"
  description: string;
  introduced_at: string; // ISO timestamp (REQUIRED, stamped by engine using event.as_of_time)
  expires_at: string | null; // ISO timestamp OR null (stamped by engine using event.as_of_time)
  review_after: string; // ISO timestamp (alternative to expires_at, stamped by engine using event.as_of_time)
  // At least one of expires_at or review_after must be set
  rule_id?: string; // Rule that generated this unknown
  ruleset_version: string; // Ruleset version (e.g., "v1.0.0")
}

/**
 * Account Posture State V1
 * 
 * Complete account posture state derived from deterministic synthesis.
 * 
 * Evidence Contract (IDs-first):
 * - evidence_signal_ids: Top K signal IDs (authoritative, for audit/readability)
 * - evidence_snapshot_refs: Top K snapshot refs (authoritative, for audit/readability)
 * - evidence_signal_types: Human-readable signal types (documentation only)
 * 
 * Determinism:
 * - active_signals_hash: SHA256 hash of ALL active signal IDs (after TTL + suppression), sorted lexicographically
 * - inputs_hash: SHA256 hash of (active_signals_hash + lifecycle_state + ruleset_version)
 * - Same inputs → same output (bitwise identical JSON ignoring timestamps)
 * 
 * Timestamp Handling:
 * - evaluated_at: Uses event.as_of_time (not wall clock)
 * - Timestamps in unknowns (introduced_at, expires_at, review_after) are excluded from equality checks
 */
export interface AccountPostureStateV1 extends TenantScoped, Timestamped {
  // Primary key
  account_id: string;

  // Posture
  posture: PostureState;
  momentum: Momentum;

  // Arrays
  risk_factors: RiskFactorV1[];
  opportunities: OpportunityV1[];
  unknowns: UnknownV1[];

  // Evidence (IDs-first, types-second)
  evidence_signal_ids: string[]; // Top K (authoritative, for audit/readability)
  evidence_snapshot_refs: EvidenceSnapshotRef[]; // Top K (authoritative, for audit/readability)
  evidence_signal_types: string[]; // Human-readable (documentation only)

  // Versioning & Determinism
  ruleset_version: string; // e.g., "v1.0.0"
  schema_version: string; // e.g., "v1"
  active_signals_hash: string; // SHA256 hash of ALL active signal IDs (after TTL + suppression), sorted lexicographically
  inputs_hash: string; // SHA256 hash of (active_signals_hash + lifecycle_state + ruleset_version)
  // Note: active_signals_hash includes ALL active signals, not just top K evidence signals

  // Metadata
  evaluated_at: string; // ISO timestamp (event.as_of_time)
  output_ttl_days: number | null; // Posture expiry (null = permanent)
  rule_id: string; // Which rule matched
}

/**
 * Rule Trigger Metadata
 * 
 * Metadata about which rule triggered and when.
 */
export interface RuleTriggerMetadata {
  rule_id: string;
  ruleset_version: string;
  inputs_hash: string; // SHA256 hash of inputs
  matched_at: string; // ISO timestamp
  priority: number; // Rule priority
}

/**
 * Posture equality function (for determinism checks)
 * 
 * Compares two AccountPostureStateV1 objects for semantic equality,
 * excluding non-deterministic timestamp fields.
 * 
 * Excluded fields (not compared):
 * - created_at, updated_at, evaluated_at (timestamps)
 * - introduced_at, expires_at, review_after in unknowns (timestamps)
 * 
 * This ensures replayability: same inputs → same semantic output.
 */
export function postureEquals(
  a: AccountPostureStateV1,
  b: AccountPostureStateV1
): boolean {
  // Compare all fields except timestamps
  if (
    a.account_id !== b.account_id ||
    a.tenantId !== b.tenantId ||
    a.posture !== b.posture ||
    a.momentum !== b.momentum ||
    a.ruleset_version !== b.ruleset_version ||
    a.schema_version !== b.schema_version ||
    a.active_signals_hash !== b.active_signals_hash ||
    a.inputs_hash !== b.inputs_hash ||
    a.output_ttl_days !== b.output_ttl_days ||
    a.rule_id !== b.rule_id
  ) {
    return false;
  }

  // Compare arrays (order matters for determinism)
  if (
    JSON.stringify(a.risk_factors.map(r => ({ ...r, introduced_at: '', expires_at: null }))) !==
    JSON.stringify(b.risk_factors.map(r => ({ ...r, introduced_at: '', expires_at: null })))
  ) {
    return false;
  }

  if (
    JSON.stringify(a.opportunities.map(o => ({ ...o, introduced_at: '', expires_at: null }))) !==
    JSON.stringify(b.opportunities.map(o => ({ ...o, introduced_at: '', expires_at: null })))
  ) {
    return false;
  }

  // Compare unknowns (excluding timestamps)
  if (
    JSON.stringify(a.unknowns.map(u => ({ ...u, introduced_at: '', expires_at: null, review_after: '' }))) !==
    JSON.stringify(b.unknowns.map(u => ({ ...u, introduced_at: '', expires_at: null, review_after: '' })))
  ) {
    return false;
  }

  // Compare evidence arrays
  if (JSON.stringify(a.evidence_signal_ids) !== JSON.stringify(b.evidence_signal_ids)) {
    return false;
  }

  if (JSON.stringify(a.evidence_snapshot_refs) !== JSON.stringify(b.evidence_snapshot_refs)) {
    return false;
  }

  if (JSON.stringify(a.evidence_signal_types) !== JSON.stringify(b.evidence_signal_types)) {
    return false;
  }

  return true;
}
