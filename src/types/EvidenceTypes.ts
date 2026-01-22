import { TrustClass, EvidenceRef, Traceable, TenantScoped } from './CommonTypes';

/**
 * Evidence types
 */
export enum EvidenceType {
  CRM = 'CRM',
  SCRAPE = 'SCRAPE',
  TRANSCRIPT = 'TRANSCRIPT',
  AGENT_INFERENCE = 'AGENT_INFERENCE',
  USER_INPUT = 'USER_INPUT',
  TELEMETRY = 'TELEMETRY',
  SUPPORT = 'SUPPORT',
  EXTERNAL = 'EXTERNAL',
}

/**
 * Evidence provenance metadata
 */
export interface EvidenceProvenance {
  trustClass: TrustClass;
  sourceSystem: string;
  sourceEventId?: string;
  collectedAt: string;
  collectedBy?: string;
}

/**
 * Evidence metadata
 */
export interface EvidenceMetadata extends Traceable, TenantScoped {
  accountId?: string;
  userId?: string;
  agentId?: string;
}

/**
 * Evidence record
 */
export interface EvidenceRecord {
  evidenceId: string;
  entityId: string;
  entityType: string;
  evidenceType: EvidenceType;
  timestamp: string;
  payload: Record<string, any>;
  provenance: EvidenceProvenance;
  metadata: EvidenceMetadata;
  s3Location: string; // S3 key where evidence is stored
  s3VersionId?: string; // S3 version ID for versioned buckets
}

/**
 * Evidence query filters
 */
export interface EvidenceQuery {
  tenantId: string;
  entityId?: string;
  entityType?: string;
  evidenceType?: EvidenceType;
  startTime?: string;
  endTime?: string;
  trustClass?: TrustClass;
  limit?: number;
}

/**
 * Evidence service interface
 */
export interface IEvidenceService {
  store(evidence: Omit<EvidenceRecord, 'evidenceId' | 's3Location' | 's3VersionId' | 'timestamp'>): Promise<EvidenceRecord>;
  get(evidenceId: string, tenantId: string, entityId?: string): Promise<EvidenceRecord | null>;
  query(query: EvidenceQuery): Promise<EvidenceRecord[]>;
}
