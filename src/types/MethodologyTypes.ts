import { TrustClass, AutonomyTier, Timestamped, TenantScoped } from './CommonTypes';
import { EntityType } from './WorldStateTypes';

/**
 * Methodology dimension field types
 */
export type DimensionFieldType = 
  | 'boolean'
  | 'enum'
  | 'string'
  | 'number'
  | 'entity_ref'
  | 'list_entity_ref'
  | 'object';

/**
 * Methodology dimension definition
 */
export interface MethodologyDimension {
  dimension_key: string;
  label: string;
  description?: string;
  critical: boolean;
  required: boolean;
  
  field_type: DimensionFieldType;
  allowed_values?: string[];  // For enum type
  ref_entity_type?: EntityType;  // For entity_ref type
  
  min_confidence_autonomous: number;  // [0, 1]
  ttl_days: number;
  allowed_provenance: TrustClass[];
  
  completion_rule: {
    type: 'non_null' | 'enum_match' | 'entity_exists';
    params?: Record<string, any>;
  };
  
  score_rule: {
    type: 'weighted' | 'binary';
    weight: number;  // For weighted type
  };
}

/**
 * Methodology autonomy gates
 */
export interface MethodologyAutonomyGates {
  tier_a?: {
    min_completeness?: number;
    min_quality_score?: number;
    required_critical_dimensions_complete?: boolean;
    disallow_inference_only_for_critical?: boolean;
  };
  tier_b?: {
    min_completeness?: number;
    min_quality_score?: number;
  };
  tier_c?: {
    min_completeness?: number;
  };
}

/**
 * Methodology scoring model
 */
export interface MethodologyScoringModel {
  completeness_formula: 'count_required' | 'weighted_required';
  quality_formula: 'weighted_sum' | 'geometric_mean';
  freshness_decay: {
    within_ttl: number;      // 1.0
    one_x_ttl: number;        // 0.5
    two_x_ttl: number;         // 0.25
    beyond_two_x_ttl: number;  // 0.1
  };
  provenance_multipliers: Record<TrustClass, number>;
}

/**
 * Sales Methodology status
 */
export type MethodologyStatus = 'ACTIVE' | 'DEPRECATED' | 'DRAFT';

/**
 * Sales Methodology entity
 */
export interface SalesMethodology extends Timestamped, TenantScoped {
  methodology_id: string;
  name: string;
  version: string;  // e.g., "2026-01-v1" or "meddicc-global-2026-01-15-v1"
  status: MethodologyStatus;
  description?: string;
  
  dimensions: MethodologyDimension[];
  scoring_model: MethodologyScoringModel;
  autonomy_gates: MethodologyAutonomyGates;
  
  // Schema Registry integration
  schema_hash?: string;  // SHA-256 hash of methodology JSON
  schema_s3_key?: string;  // S3 location in schema registry
}

/**
 * Methodology service interface
 */
export interface IMethodologyService {
  createMethodology(input: CreateMethodologyInput): Promise<SalesMethodology>;
  getMethodology(methodologyId: string, version: string, tenantId: string): Promise<SalesMethodology | null>;
  updateMethodology(methodologyId: string, version: string, updates: UpdateMethodologyInput, tenantId: string): Promise<SalesMethodology>;
  listMethodologies(tenantId: string, status?: MethodologyStatus): Promise<SalesMethodology[]>;
  deprecateMethodology(methodologyId: string, version: string, tenantId: string): Promise<void>;
}

export interface CreateMethodologyInput {
  methodology_id: string;
  name: string;
  description?: string;
  dimensions: MethodologyDimension[];
  scoring_model: MethodologyScoringModel;
  autonomy_gates: MethodologyAutonomyGates;
  tenant_id: string;
  // NOTE: version is NOT in input - always generated internally for immutability
}

export interface UpdateMethodologyInput {
  name?: string;
  description?: string;
  dimensions?: MethodologyDimension[];
  scoring_model?: MethodologyScoringModel;
  autonomy_gates?: MethodologyAutonomyGates;
}
