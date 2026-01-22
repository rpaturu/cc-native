import { TrustClass, EvidenceRef, AutonomyTier } from './CommonTypes';

/**
 * Entity types
 */
export type EntityType = 
  | 'Account'
  | 'Contact'
  | 'Opportunity'
  | 'Contract'
  | 'Renewal'
  | 'SupportCase'
  | 'UsageSignal'
  | 'TelemetryAggregate'
  | 'Meeting'
  | 'Activity'
  | 'NewsItem'
  | 'WebSignal'
  | 'Decision'
  | 'Action'
  | 'Approval'
  | 'AuditEvent'
  | 'Run'
  | 'QualityCheck'
  | 'RelationshipEdge';

/**
 * Field state (concrete, not abstract)
 * Each field in entity state has these properties
 */
export interface FieldState {
  value: any;
  confidence: number;        // 0-1
  freshness: number;          // hours since last update
  contradiction: number;      // 0-1 (contradiction score)
  provenanceTrust: TrustClass;
  lastUpdated: string;        // ISO timestamp
  evidenceRefs: EvidenceRef[];
}

/**
 * Entity state
 */
export interface EntityState {
  entityId: string;
  entityType: EntityType;
  tenantId: string;
  fields: Record<string, FieldState>;
  computedAt: string;        // ISO timestamp when state was computed
  autonomyTier: AutonomyTier;
  overallConfidence: number;  // 0-1 (aggregate of field confidences)
  overallFreshness: number;    // hours (oldest field freshness)
  overallContradiction: number; // 0-1 (max field contradiction)
  metadata?: Record<string, any>;
}

/**
 * World state query filters
 */
export interface WorldStateQuery {
  tenantId: string;
  entityId?: string;
  entityType?: EntityType;
  minConfidence?: number;
  maxContradiction?: number;
  limit?: number;
}

/**
 * World state service interface
 */
export interface IWorldStateService {
  computeState(entityId: string, entityType: EntityType, tenantId: string): Promise<EntityState>;
  getState(entityId: string, tenantId: string): Promise<EntityState | null>;
  query(query: WorldStateQuery): Promise<EntityState[]>;
}
