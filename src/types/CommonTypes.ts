/**
 * Common types used across the system
 */

export interface TraceContext {
  traceId: string;
  tenantId: string;
  accountId?: string;
  userId?: string;
  agentId?: string;
}

export interface Timestamped {
  createdAt: string;
  updatedAt: string;
}

export interface TenantScoped {
  tenantId: string;
}

export interface Traceable {
  traceId: string;
}

export type EventSource = 
  | 'connector'
  | 'perception'
  | 'decision'
  | 'tool'
  | 'action'
  | 'user'
  | 'system';

export type Severity = 'low' | 'medium' | 'high' | 'critical';

export interface EvidenceRef {
  type: 's3' | 'dynamodb' | 'neptune' | 'external';
  location: string;
  timestamp: string;
}

/**
 * Provenance Trust Classes (from World Model Contract)
 */
export type TrustClass = 
  | 'PRIMARY'          // Direct system of record (confidence multiplier: 1.0)
  | 'VERIFIED'        // Verified by multiple sources (confidence multiplier: 0.95)
  | 'DERIVED'         // Computed from primary sources (confidence multiplier: 0.85)
  | 'AGENT_INFERENCE' // Agent-generated inference (confidence multiplier: 0.60, max Tier C)
  | 'UNTRUSTED';      // Unverified sources (confidence multiplier: 0.30, Tier D only)

/**
 * Autonomy Tiers (from Agent Read Policy)
 */
export type AutonomyTier = 'TIER_A' | 'TIER_B' | 'TIER_C' | 'TIER_D';
