import { TrustClass, AutonomyTier, Timestamped, TenantScoped, EvidenceRef } from './CommonTypes';
import { FieldState } from './WorldStateTypes';
import { SalesMethodology } from './MethodologyTypes';

/**
 * Assessment status
 */
export type AssessmentStatus = 'ACTIVE' | 'SUPERSEDED' | 'DRAFT';

/**
 * Dimension value storage (maps to FieldState)
 */
export interface DimensionValue {
  value: any;  // Typed per field_type
  confidence: number;  // [0, 1]
  freshness: number;  // Hours since last update
  contradiction: number;  // [0, 1]
  provenanceTrust: TrustClass;
  lastUpdated: string;  // ISO 8601
  evidenceRefs: EvidenceRef[];
}

/**
 * Assessment computed outputs (deterministic)
 */
export interface AssessmentComputed {
  completeness: number;  // [0, 1]
  quality_score: number;  // [0, 1]
  critical_dimensions_complete: boolean;
  fails_due_to_freshness: boolean;
  fails_due_to_provenance: boolean;
  recommended_autonomy_tier_cap: AutonomyTier;
  reasons: string[];  // Deterministic reason codes
}

/**
 * Methodology Assessment entity
 */
export interface MethodologyAssessment extends Timestamped, TenantScoped {
  assessment_id: string;
  opportunity_id: string;
  methodology_id: string;
  methodology_version: string;  // Pinned version (no drift)
  status: AssessmentStatus;
  
  // Dimension values (maps to FieldState pattern)
  dimensions: Record<string, DimensionValue>;
  
  // Computed outputs (deterministic)
  computed: AssessmentComputed;
  
  // Metadata
  created_by?: string;
  superseded_by?: string;  // assessment_id of superseding assessment
}

/**
 * Assessment service interface
 */
export interface IAssessmentService {
  createAssessment(input: CreateAssessmentInput): Promise<MethodologyAssessment>;
  getAssessment(assessmentId: string, tenantId: string): Promise<MethodologyAssessment | null>;
  getActiveAssessment(opportunityId: string, methodologyId: string, tenantId: string): Promise<MethodologyAssessment | null>;
  updateAssessment(assessmentId: string, updates: UpdateAssessmentInput, tenantId: string): Promise<MethodologyAssessment>;
  supersedeAssessment(assessmentId: string, newAssessmentId: string, tenantId: string): Promise<void>;
  listAssessments(opportunityId: string, methodologyId: string, tenantId: string): Promise<MethodologyAssessment[]>;
}

export interface CreateAssessmentInput {
  opportunity_id: string;
  methodology_id: string;
  methodology_version: string;
  tenant_id: string;
  created_by?: string;
}

export interface UpdateAssessmentInput {
  dimensions?: Record<string, Partial<DimensionValue>>;
  // Note: dimension_confidence, dimension_provenance, dimension_as_of are merged into dimensions
}

/**
 * Assessment computation service interface
 */
export interface IAssessmentComputationService {
  computeAssessment(
    assessment: MethodologyAssessment,
    methodology: SalesMethodology
  ): Promise<AssessmentComputed>;
  
  computeCompleteness(
    dimensions: Record<string, DimensionValue>,
    methodology: SalesMethodology
  ): number;
  
  computeQualityScore(
    dimensions: Record<string, DimensionValue>,
    methodology: SalesMethodology
  ): number;
  
  computeAutonomyTierCap(
    computed: AssessmentComputed,
    methodology: SalesMethodology
  ): AutonomyTier;
}
