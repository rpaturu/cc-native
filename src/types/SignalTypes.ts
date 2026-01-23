/**
 * Signal Types - Phase 1: Lifecycle-Aware Perception & Signals
 * 
 * Defines canonical signal types and lifecycle state types for autonomous
 * account lifecycle progression detection (Prospect → Suspect → Customer).
 */

import { Timestamped, TenantScoped, Traceable } from './CommonTypes';

/**
 * Lifecycle State
 */
export enum LifecycleState {
  PROSPECT = 'PROSPECT',
  SUSPECT = 'SUSPECT',
  CUSTOMER = 'CUSTOMER',
}

/**
 * Signal Type - All 8 Phase 1 signals
 */
export enum SignalType {
  // PROSPECT signals
  ACCOUNT_ACTIVATION_DETECTED = 'ACCOUNT_ACTIVATION_DETECTED',
  NO_ENGAGEMENT_PRESENT = 'NO_ENGAGEMENT_PRESENT',
  
  // SUSPECT signals
  FIRST_ENGAGEMENT_OCCURRED = 'FIRST_ENGAGEMENT_OCCURRED',
  DISCOVERY_PROGRESS_STALLED = 'DISCOVERY_PROGRESS_STALLED',
  STAKEHOLDER_GAP_DETECTED = 'STAKEHOLDER_GAP_DETECTED',
  
  // CUSTOMER signals
  USAGE_TREND_CHANGE = 'USAGE_TREND_CHANGE',
  SUPPORT_RISK_EMERGING = 'SUPPORT_RISK_EMERGING',
  RENEWAL_WINDOW_ENTERED = 'RENEWAL_WINDOW_ENTERED',
}

/**
 * Signal Status - Explicit state machine
 */
export enum SignalStatus {
  ACTIVE = 'ACTIVE',
  SUPPRESSED = 'SUPPRESSED',
  EXPIRED = 'EXPIRED',
}

/**
 * Confidence Source Taxonomy
 */
export type ConfidenceSource = 'direct' | 'derived' | 'inferred';

/**
 * Signal Severity
 */
export type SignalSeverity = 'low' | 'medium' | 'high' | 'critical';

/**
 * Evidence Snapshot Reference
 * 
 * Reference to immutable evidence snapshot stored in S3.
 * Ensures replayability and determinism.
 */
export interface EvidenceSnapshotRef {
  s3Uri: string;                    // S3 URI of evidence snapshot
  sha256: string;                   // SHA256 hash of evidence content
  capturedAt: string;               // ISO timestamp when snapshot was captured
  schemaVersion: string;            // Schema version of evidence (evidence schema)
  detectorInputVersion: string;     // Detector input contract version (may differ from evidence schema)
}

/**
 * Evidence Binding
 * 
 * Links signal to immutable evidence with schema versioning.
 */
export interface EvidenceBinding {
  evidenceRef: EvidenceSnapshotRef;
  evidenceSchemaVersion: string;    // Schema version used at signal creation time
}

/**
 * Signal TTL Configuration
 */
export interface SignalTTL {
  ttlDays: number | null;           // TTL in days (null for permanent)
  expiresAt: string | null;         // ISO timestamp when signal expires (null if permanent)
  isPermanent: boolean;             // Whether signal never expires
}

/**
 * Signal Suppression Metadata
 */
export interface SignalSuppression {
  suppressed: boolean;              // Whether signal is suppressed
  suppressedAt: string | null;      // ISO timestamp when suppressed (null if not suppressed)
  suppressedBy: string | null;      // Reason/rule that suppressed (null if not suppressed)
  inferenceActive: boolean;         // Whether signal can influence lifecycle inference
}

/**
 * Signal Metadata
 */
export interface SignalMetadata {
  confidence: number;                // Confidence score [0.0 - 1.0]
  confidenceSource: ConfidenceSource; // Source of confidence (direct | derived | inferred)
  severity: SignalSeverity;         // Signal severity
  ttl: SignalTTL;                   // TTL configuration
}

/**
 * Signal
 * 
 * Core signal structure representing lifecycle-relevant change detection.
 */
export interface Signal extends Timestamped, TenantScoped, Traceable {
  signalId: string;                  // Unique signal ID
  signalType: SignalType;            // Type of signal
  accountId: string;                 // Account this signal relates to
  
  // Idempotency
  dedupeKey: string;                 // Deterministic idempotency key (accountId + signalType + windowKey + evidence hash)
  windowKey: string;                 // Signal-specific window identifier (see WindowKey Derivation table)
  
  // Versioning
  detectorVersion: string;           // Version of detector that created this signal
  detectorInputVersion: string;      // Version of detector input contract
  ruleVersion?: string;              // Version of rule used (optional)
  
  // Status
  status: SignalStatus;              // ACTIVE | SUPPRESSED | EXPIRED
  
  // Metadata
  metadata: SignalMetadata;          // Confidence, severity, TTL
  
  // Evidence
  evidence: EvidenceBinding;         // Links to immutable evidence
  
  // Suppression
  suppression: SignalSuppression;    // Suppression metadata
  
  // Context
  description?: string;               // Human-readable description
  context?: Record<string, any>;      // Additional context data
}

/**
 * WindowKey Derivation Rules
 * 
 * Maps SignalType to windowKey derivation logic.
 * Prevents duplicates or missed updates.
 */
export const WINDOW_KEY_DERIVATION: Record<SignalType, (accountId: string, evidence: any, timestamp: string) => string> = {
  [SignalType.ACCOUNT_ACTIVATION_DETECTED]: (accountId, evidence, timestamp) => {
    // One activation per day
    const date = new Date(timestamp).toISOString().split('T')[0];
    return `${accountId}-${date}`;
  },
  
  [SignalType.NO_ENGAGEMENT_PRESENT]: (accountId, evidence, timestamp) => {
    // One per lifecycle state entry
    const date = new Date(timestamp).toISOString().split('T')[0];
    return `${accountId}-${date}`;
  },
  
  [SignalType.FIRST_ENGAGEMENT_OCCURRED]: (accountId, evidence, timestamp) => {
    // Historical milestone, one per engagement
    const engagementId = evidence?.engagementId || `eng-${timestamp}`;
    return `${accountId}-${engagementId}`;
  },
  
  [SignalType.DISCOVERY_PROGRESS_STALLED]: (accountId, evidence, timestamp) => {
    // One per 14-day stall window
    const date = new Date(timestamp);
    const windowStart = new Date(date);
    windowStart.setDate(date.getDate() - (date.getDate() % 14));
    return `${accountId}-${windowStart.toISOString().split('T')[0]}`;
  },
  
  [SignalType.STAKEHOLDER_GAP_DETECTED]: (accountId, evidence, timestamp) => {
    // One per gap analysis cycle
    const date = new Date(timestamp).toISOString().split('T')[0];
    return `${accountId}-${date}`;
  },
  
  [SignalType.USAGE_TREND_CHANGE]: (accountId, evidence, timestamp) => {
    // One per 7-day trend window
    const date = new Date(timestamp);
    const windowStart = new Date(date);
    windowStart.setDate(date.getDate() - (date.getDate() % 7));
    return `${accountId}-${windowStart.toISOString().split('T')[0]}`;
  },
  
  [SignalType.SUPPORT_RISK_EMERGING]: (accountId, evidence, timestamp) => {
    // One per day boundary snapshot
    const date = new Date(timestamp).toISOString().split('T')[0];
    return `${accountId}-${date}`;
  },
  
  [SignalType.RENEWAL_WINDOW_ENTERED]: (accountId, evidence, timestamp) => {
    // Only once per contract threshold
    const contractId = evidence?.contractId || 'unknown';
    const thresholdBoundary = evidence?.thresholdBoundary || 'default';
    return `${accountId}-${contractId}-${thresholdBoundary}`;
  },
};

/**
 * Default TTL Configuration by Signal Type
 */
export const DEFAULT_SIGNAL_TTL: Record<SignalType, { ttlDays: number | null; isPermanent: boolean }> = {
  [SignalType.ACCOUNT_ACTIVATION_DETECTED]: { ttlDays: 90, isPermanent: false },
  [SignalType.NO_ENGAGEMENT_PRESENT]: { ttlDays: null, isPermanent: false }, // Until transition
  [SignalType.FIRST_ENGAGEMENT_OCCURRED]: { ttlDays: null, isPermanent: true },
  [SignalType.DISCOVERY_PROGRESS_STALLED]: { ttlDays: 30, isPermanent: false },
  [SignalType.STAKEHOLDER_GAP_DETECTED]: { ttlDays: 60, isPermanent: false },
  [SignalType.USAGE_TREND_CHANGE]: { ttlDays: 30, isPermanent: false },
  [SignalType.SUPPORT_RISK_EMERGING]: { ttlDays: 30, isPermanent: false },
  [SignalType.RENEWAL_WINDOW_ENTERED]: { ttlDays: null, isPermanent: false }, // Contract-bound
};
