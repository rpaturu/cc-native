# Methodology Entities Implementation Plan

## 1. Purpose

This document provides a **code-level implementation plan** for `SalesMethodology` and `MethodologyAssessment` entities, following the specifications in:
- `SALES_METHODOLOGY_SCHEMA.md`
- `METHODOLOGY_ASSESSMENT.md`

**Implementation Phase:** Post-Phase 0 (Phase 1 or later)

---

## 2. Overview

### 2.1 Entities to Implement

1. **SalesMethodology** - Methodology definition (stored in Schema Registry + DynamoDB)
2. **MethodologyAssessment** - Opportunity assessment instance (DynamoDB + S3 snapshots)

### 2.2 Key Services

1. **MethodologyService** - CRUD for methodology definitions
2. **AssessmentService** - CRUD for assessments, deterministic computation
3. **AssessmentComputationService** - Deterministic completeness/quality score computation

### 2.3 Integration Points

- **Schema Registry** - Methodology definitions stored as schemas
- **World State Service** - Assessments stored as entity state
- **Evidence Service** - Dimension provenance references evidence
- **Snapshot Service** - Assessments bound to snapshots

---

## 3. Type Definitions

### 3.1 Methodology Types

**File:** `src/types/MethodologyTypes.ts`

```typescript
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
}

export interface UpdateMethodologyInput {
  name?: string;
  description?: string;
  dimensions?: MethodologyDimension[];
  scoring_model?: MethodologyScoringModel;
  autonomy_gates?: MethodologyAutonomyGates;
}
```

---

### 3.2 Assessment Types

**File:** `src/types/AssessmentTypes.ts`

```typescript
import { TrustClass, AutonomyTier, Timestamped, TenantScoped, EvidenceRef } from './CommonTypes';
import { FieldState } from './WorldStateTypes';

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
```

---

## 4. Service Implementations

### 4.1 Methodology Service

**File:** `src/services/methodology/MethodologyService.ts`

```typescript
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { createHash } from 'crypto';
import { 
  SalesMethodology, 
  IMethodologyService, 
  CreateMethodologyInput, 
  UpdateMethodologyInput 
} from '../../types/MethodologyTypes';
import { Logger } from '../core/Logger';
import { SchemaRegistryService } from '../world-model/SchemaRegistryService';
import { v4 as uuidv4 } from 'uuid';

/**
 * MethodologyService - CRUD for methodology definitions
 * 
 * Methodologies are stored in:
 * - Schema Registry (S3 + DynamoDB index) - immutable source of truth
 * - Methodology table (DynamoDB) - fast lookup and metadata
 */
export class MethodologyService implements IMethodologyService {
  private dynamoClient: DynamoDBDocumentClient;
  private s3Client: S3Client;
  private logger: Logger;
  private schemaRegistryService: SchemaRegistryService;
  private methodologyTableName: string;
  private schemaBucket: string;

  constructor(
    logger: Logger,
    schemaRegistryService: SchemaRegistryService,
    methodologyTableName: string,
    schemaBucket: string,
    region?: string
  ) {
    this.logger = logger;
    this.schemaRegistryService = schemaRegistryService;
    this.methodologyTableName = methodologyTableName;
    this.schemaBucket = schemaBucket;
    
    this.dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));
    this.s3Client = new S3Client({ region });
  }

  /**
   * Create new methodology
   * 
   * Process:
   * 1. Generate version if not provided
   * 2. Compute schema hash
   * 3. Store in Schema Registry (S3 + DynamoDB)
   * 4. Store metadata in Methodology table
   */
  async createMethodology(input: CreateMethodologyInput): Promise<SalesMethodology> {
    const now = new Date().toISOString();
    const version = input.version || this.generateVersion(input.methodology_id, input.tenant_id);
    
    const methodology: SalesMethodology = {
      methodology_id: input.methodology_id,
      name: input.name,
      version,
      tenant_id: input.tenant_id,
      status: 'DRAFT',
      description: input.description,
      dimensions: input.dimensions,
      scoring_model: input.scoring_model,
      autonomy_gates: input.autonomy_gates,
      createdAt: now,
      updatedAt: now,
    };

    try {
      // Compute schema hash
      const schemaHash = this.computeSchemaHash(methodology);
      methodology.schema_hash = schemaHash;

      // Store in Schema Registry (S3)
      const s3Key = `methodologies/${input.methodology_id}/${version}.json`;
      await this.s3Client.send(new PutObjectCommand({
        Bucket: this.schemaBucket,
        Key: s3Key,
        Body: JSON.stringify(methodology, null, 2),
        ContentType: 'application/json',
        ObjectLockMode: 'COMPLIANCE',
        ObjectLockRetainUntilDate: this.getRetentionDate(),
      }));

      methodology.schema_s3_key = s3Key;

      // Store in Methodology table (DynamoDB)
      const record = {
        pk: `METHODOLOGY#${input.methodology_id}`,
        sk: `VERSION#${version}`,
        methodology_id: input.methodology_id,
        version,
        tenant_id: input.tenant_id,
        status: methodology.status,
        methodology,
        schema_hash: schemaHash,
        schema_s3_key: s3Key,
        gsi1pk: `TENANT#${input.tenant_id}`,
        gsi1sk: `${methodology.status}#${version}`,
        createdAt: now,
        updatedAt: now,
      };

      await this.dynamoClient.send(new PutCommand({
        TableName: this.methodologyTableName,
        Item: record,
        ConditionExpression: 'attribute_not_exists(pk) OR attribute_not_exists(sk)',
      }));

      // Register in Schema Registry (DynamoDB index)
      await this.schemaRegistryService.registerSchema({
        entityType: 'SalesMethodology',
        version,
        schemaHash,
        s3Key,
        schema: methodology,
      });

      this.logger.info('Methodology created', {
        methodology_id: input.methodology_id,
        version,
        schema_hash: schemaHash,
      });

      return methodology;
    } catch (error) {
      this.logger.error('Failed to create methodology', {
        methodology_id: input.methodology_id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get methodology by ID and version
   */
  async getMethodology(
    methodologyId: string,
    version: string,
    tenantId: string
  ): Promise<SalesMethodology | null> {
    try {
      // Try Schema Registry first (authoritative)
      const schema = await this.schemaRegistryService.getSchema(
        'SalesMethodology',
        version,
        undefined  // Hash verification optional on read
      );

      if (!schema) {
        return null;
      }

      const methodology = schema as any as SalesMethodology;

      // Verify tenant isolation
      if (methodology.tenant_id !== tenantId) {
        this.logger.warn('Tenant isolation violation', {
          methodology_id: methodologyId,
          requested_tenant: tenantId,
          actual_tenant: methodology.tenant_id,
        });
        return null;
      }

      return methodology;
    } catch (error) {
      this.logger.error('Failed to get methodology', {
        methodology_id: methodologyId,
        version,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Update methodology (creates new version)
   */
  async updateMethodology(
    methodologyId: string,
    currentVersion: string,
    updates: UpdateMethodologyInput,
    tenantId: string
  ): Promise<SalesMethodology> {
    // Get current methodology
    const current = await this.getMethodology(methodologyId, currentVersion, tenantId);
    if (!current) {
      throw new Error('Methodology not found');
    }

    // Create new version with updates
    const newVersion = this.generateVersion(methodologyId, tenantId);
    const updated: SalesMethodology = {
      ...current,
      ...updates,
      version: newVersion,
      updatedAt: new Date().toISOString(),
    };

    // Create new version (immutable)
    return this.createMethodology({
      methodology_id: methodologyId,
      name: updated.name,
      description: updated.description,
      dimensions: updated.dimensions,
      scoring_model: updated.scoring_model,
      autonomy_gates: updated.autonomy_gates,
      tenant_id: tenantId,
      version: newVersion,
    });
  }

  /**
   * List methodologies for tenant
   */
  async listMethodologies(
    tenantId: string,
    status?: MethodologyStatus
  ): Promise<SalesMethodology[]> {
    try {
      let keyConditionExpression = 'gsi1pk = :gsi1pk';
      const expressionAttributeValues: Record<string, any> = {
        ':gsi1pk': `TENANT#${tenantId}`,
      };

      if (status) {
        keyConditionExpression += ' AND begins_with(gsi1sk, :status)';
        expressionAttributeValues[':status'] = `${status}#`;
      }

      const result = await this.dynamoClient.send(new QueryCommand({
        TableName: this.methodologyTableName,
        IndexName: 'tenant-status-index',
        KeyConditionExpression: keyConditionExpression,
        ExpressionAttributeValues: expressionAttributeValues,
        ScanIndexForward: false,  // Most recent first
      }));

      if (!result.Items || result.Items.length === 0) {
        return [];
      }

      return result.Items.map(item => (item as any).methodology as SalesMethodology);
    } catch (error) {
      this.logger.error('Failed to list methodologies', {
        tenant_id: tenantId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Deprecate methodology
   */
  async deprecateMethodology(
    methodologyId: string,
    version: string,
    tenantId: string
  ): Promise<void> {
    try {
      const result = await this.dynamoClient.send(new UpdateCommand({
        TableName: this.methodologyTableName,
        Key: {
          pk: `METHODOLOGY#${methodologyId}`,
          sk: `VERSION#${version}`,
        },
        UpdateExpression: 'SET #status = :status, updatedAt = :updatedAt',
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: {
          ':status': 'DEPRECATED',
          ':updatedAt': new Date().toISOString(),
        },
        ConditionExpression: 'tenant_id = :tenantId',
        ExpressionAttributeValues: {
          ':tenantId': tenantId,
        },
      }));

      this.logger.info('Methodology deprecated', {
        methodology_id: methodologyId,
        version,
      });
    } catch (error) {
      this.logger.error('Failed to deprecate methodology', {
        methodology_id: methodologyId,
        version,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Generate version string
   */
  private generateVersion(methodologyId: string, tenantId: string): string {
    const date = new Date().toISOString().split('T')[0].replace(/-/g, '');
    return `${methodologyId}-${tenantId}-${date}-v1`;
  }

  /**
   * Compute schema hash (SHA-256)
   */
  private computeSchemaHash(methodology: SalesMethodology): string {
    const { schema_hash, schema_s3_key, ...methodologyWithoutHash } = methodology;
    const jsonString = JSON.stringify(methodologyWithoutHash, null, 0);
    const hash = createHash('sha256').update(jsonString).digest('hex');
    return `sha256:${hash}`;
  }

  /**
   * Get retention date (7 years)
   */
  private getRetentionDate(): Date {
    const date = new Date();
    date.setFullYear(date.getFullYear() + 7);
    return date;
  }
}
```

---

### 4.2 Assessment Computation Service

**File:** `src/services/methodology/AssessmentComputationService.ts`

```typescript
import { 
  MethodologyAssessment, 
  AssessmentComputed, 
  DimensionValue,
  IAssessmentComputationService 
} from '../../types/AssessmentTypes';
import { SalesMethodology } from '../../types/MethodologyTypes';
import { AutonomyTier, TrustClass } from '../../types/CommonTypes';
import { Logger } from '../core/Logger';

/**
 * AssessmentComputationService - Deterministic computation of assessment metrics
 * 
 * All computations are deterministic and reproducible.
 */
export class AssessmentComputationService implements IAssessmentComputationService {
  private logger: Logger;

  // Provenance multipliers (from World Model Contract)
  private readonly PROVENANCE_MULTIPLIERS: Record<TrustClass, number> = {
    PRIMARY: 1.0,
    VERIFIED: 0.95,
    DERIVED: 0.85,
    AGENT_INFERENCE: 0.60,
    UNTRUSTED: 0.30,
  };

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /**
   * Compute all assessment metrics
   */
  async computeAssessment(
    assessment: MethodologyAssessment,
    methodology: SalesMethodology
  ): Promise<AssessmentComputed> {
    const completeness = this.computeCompleteness(assessment.dimensions, methodology);
    const qualityScore = this.computeQualityScore(assessment.dimensions, methodology);
    
    const criticalDimensionsComplete = this.checkCriticalDimensions(
      assessment.dimensions,
      methodology
    );
    
    const failsDueToFreshness = this.checkFreshnessFailures(
      assessment.dimensions,
      methodology
    );
    
    const failsDueToProvenance = this.checkProvenanceFailures(
      assessment.dimensions,
      methodology
    );
    
    const reasons = this.computeReasons(
      assessment.dimensions,
      methodology,
      criticalDimensionsComplete,
      failsDueToFreshness,
      failsDueToProvenance
    );
    
    const recommendedTierCap = this.computeAutonomyTierCap(
      { completeness, quality_score: qualityScore, critical_dimensions_complete: criticalDimensionsComplete },
      methodology
    );

    return {
      completeness,
      quality_score: qualityScore,
      critical_dimensions_complete: criticalDimensionsComplete,
      fails_due_to_freshness: failsDueToFreshness,
      fails_due_to_provenance: failsDueToProvenance,
      recommended_autonomy_tier_cap: recommendedTierCap,
      reasons,
    };
  }

  /**
   * Compute completeness (deterministic)
   */
  computeCompleteness(
    dimensions: Record<string, DimensionValue>,
    methodology: SalesMethodology
  ): number {
    const requiredDimensions = methodology.dimensions.filter(d => d.required);
    
    if (requiredDimensions.length === 0) {
      return 1.0;  // No required dimensions = 100% complete
    }

    let completedCount = 0;

    for (const dimension of requiredDimensions) {
      const dimensionValue = dimensions[dimension.dimension_key];
      
      if (!dimensionValue) {
        continue;  // Missing dimension
      }

      // Check completion criteria
      const isComplete = this.isDimensionComplete(dimensionValue, dimension);
      
      if (isComplete) {
        completedCount++;
      }
    }

    return completedCount / requiredDimensions.length;
  }

  /**
   * Compute quality score (deterministic)
   */
  computeQualityScore(
    dimensions: Record<string, DimensionValue>,
    methodology: SalesMethodology
  ): number {
    let totalWeight = 0;
    let weightedSum = 0;

    for (const dimension of methodology.dimensions) {
      const dimensionValue = dimensions[dimension.dimension_key];
      
      if (!dimensionValue) {
        continue;  // Missing dimension doesn't contribute
      }

      // Check if dimension is complete
      if (!this.isDimensionComplete(dimensionValue, dimension)) {
        continue;  // Incomplete dimension doesn't contribute
      }

      const weight = dimension.score_rule.weight || 1.0;
      const freshnessMultiplier = this.computeFreshnessMultiplier(
        dimensionValue.freshness,
        dimension.ttl_days
      );
      const provenanceMultiplier = this.PROVENANCE_MULTIPLIERS[dimensionValue.provenanceTrust];

      const dimensionScore = 
        dimensionValue.confidence * 
        freshnessMultiplier * 
        provenanceMultiplier;

      weightedSum += weight * dimensionScore;
      totalWeight += weight;
    }

    return totalWeight > 0 ? weightedSum / totalWeight : 0;
  }

  /**
   * Compute autonomy tier cap
   */
  computeAutonomyTierCap(
    computed: Partial<AssessmentComputed>,
    methodology: SalesMethodology
  ): AutonomyTier {
    const gates = methodology.autonomy_gates;

    // Check Tier A
    if (gates.tier_a) {
      const tierA = gates.tier_a;
      const meetsCompleteness = !tierA.min_completeness || 
        (computed.completeness !== undefined && computed.completeness >= tierA.min_completeness);
      const meetsQuality = !tierA.min_quality_score || 
        (computed.quality_score !== undefined && computed.quality_score >= tierA.min_quality_score);
      const meetsCritical = !tierA.required_critical_dimensions_complete || 
        computed.critical_dimensions_complete === true;

      if (meetsCompleteness && meetsQuality && meetsCritical) {
        return 'TIER_A';
      }
    }

    // Check Tier B
    if (gates.tier_b) {
      const tierB = gates.tier_b;
      const meetsCompleteness = !tierB.min_completeness || 
        (computed.completeness !== undefined && computed.completeness >= tierB.min_completeness);
      const meetsQuality = !tierB.min_quality_score || 
        (computed.quality_score !== undefined && computed.quality_score >= tierB.min_quality_score);

      if (meetsCompleteness && meetsQuality) {
        return 'TIER_B';
      }
    }

    // Check Tier C
    if (gates.tier_c) {
      const tierC = gates.tier_c;
      const meetsCompleteness = !tierC.min_completeness || 
        (computed.completeness !== undefined && computed.completeness >= tierC.min_completeness);

      if (meetsCompleteness) {
        return 'TIER_C';
      }
    }

    // Default to Tier D
    return 'TIER_D';
  }

  /**
   * Check if dimension is complete
   */
  private isDimensionComplete(
    dimensionValue: DimensionValue,
    dimension: any
  ): boolean {
    // Check value is not null
    if (dimensionValue.value === null || dimensionValue.value === undefined) {
      return false;
    }

    // Check confidence threshold
    if (dimensionValue.confidence < dimension.min_confidence_autonomous) {
      return false;
    }

    // Check freshness (within TTL)
    const ttlHours = dimension.ttl_days * 24;
    if (dimensionValue.freshness > ttlHours) {
      return false;
    }

    // Check provenance is allowed
    if (!dimension.allowed_provenance.includes(dimensionValue.provenanceTrust)) {
      return false;
    }

    return true;
  }

  /**
   * Compute freshness multiplier
   */
  private computeFreshnessMultiplier(freshnessHours: number, ttlDays: number): number {
    const ttlHours = ttlDays * 24;
    const model = {
      within_ttl: 1.0,
      one_x_ttl: 0.5,
      two_x_ttl: 0.25,
      beyond_two_x_ttl: 0.1,
    };

    if (freshnessHours <= ttlHours) {
      return model.within_ttl;
    } else if (freshnessHours <= ttlHours * 2) {
      return model.one_x_ttl;
    } else if (freshnessHours <= ttlHours * 3) {
      return model.two_x_ttl;
    } else {
      return model.beyond_two_x_ttl;
    }
  }

  /**
   * Check critical dimensions complete
   */
  private checkCriticalDimensions(
    dimensions: Record<string, DimensionValue>,
    methodology: SalesMethodology
  ): boolean {
    const criticalDimensions = methodology.dimensions.filter(d => d.critical);
    
    for (const dimension of criticalDimensions) {
      const dimensionValue = dimensions[dimension.dimension_key];
      
      if (!dimensionValue || !this.isDimensionComplete(dimensionValue, dimension)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Check freshness failures
   */
  private checkFreshnessFailures(
    dimensions: Record<string, DimensionValue>,
    methodology: SalesMethodology
  ): boolean {
    const requiredDimensions = methodology.dimensions.filter(d => d.required);
    
    for (const dimension of requiredDimensions) {
      const dimensionValue = dimensions[dimension.dimension_key];
      
      if (dimensionValue) {
        const ttlHours = dimension.ttl_days * 24;
        if (dimensionValue.freshness > ttlHours) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Check provenance failures
   */
  private checkProvenanceFailures(
    dimensions: Record<string, DimensionValue>,
    methodology: SalesMethodology
  ): boolean {
    const criticalDimensions = methodology.dimensions.filter(d => d.critical);
    
    for (const dimension of criticalDimensions) {
      const dimensionValue = dimensions[dimension.dimension_key];
      
      if (dimensionValue) {
        // Check if all provenance is inference-only
        const allInference = dimensionValue.evidenceRefs.every(ref => {
          // This would need to check evidence trust class
          // For now, check if provenanceTrust is AGENT_INFERENCE
          return dimensionValue.provenanceTrust === 'AGENT_INFERENCE';
        });

        if (allInference && dimensionValue.provenanceTrust === 'AGENT_INFERENCE') {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Compute reason codes
   */
  private computeReasons(
    dimensions: Record<string, DimensionValue>,
    methodology: SalesMethodology,
    criticalComplete: boolean,
    freshnessFailure: boolean,
    provenanceFailure: boolean
  ): string[] {
    const reasons: string[] = [];

    if (!criticalComplete) {
      reasons.push('CRITICAL_DIMENSIONS_INCOMPLETE');
    }

    if (freshnessFailure) {
      reasons.push('REQUIRED_DIM_STALE');
    }

    if (provenanceFailure) {
      reasons.push('CRITICAL_DIM_INFERENCE_ONLY');
    }

    // Check individual dimensions
    for (const dimension of methodology.dimensions) {
      const dimensionValue = dimensions[dimension.dimension_key];
      
      if (dimension.required && !dimensionValue) {
        reasons.push(`REQUIRED_DIM_MISSING_${dimension.dimension_key}`);
      } else if (dimensionValue) {
        if (dimensionValue.confidence < dimension.min_confidence_autonomous) {
          reasons.push(`DIM_LOW_CONFIDENCE_${dimension.dimension_key}`);
        }
        
        const ttlHours = dimension.ttl_days * 24;
        if (dimensionValue.freshness > ttlHours) {
          reasons.push(`DIM_STALE_${dimension.dimension_key}`);
        }
        
        if (!dimension.allowed_provenance.includes(dimensionValue.provenanceTrust)) {
          reasons.push(`PROVENANCE_NOT_ALLOWED_${dimension.dimension_key}`);
        }
      }
    }

    return reasons;
  }
}
```

---

### 4.3 Assessment Service

**File:** `src/services/methodology/AssessmentService.ts`

```typescript
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { 
  MethodologyAssessment, 
  IAssessmentService, 
  CreateAssessmentInput, 
  UpdateAssessmentInput,
  DimensionValue 
} from '../../types/AssessmentTypes';
import { IMethodologyService } from '../../types/MethodologyTypes';
import { Logger } from '../core/Logger';
import { AssessmentComputationService } from './AssessmentComputationService';
import { WorldStateService } from '../world-model/WorldStateService';
import { v4 as uuidv4 } from 'uuid';

/**
 * AssessmentService - CRUD for methodology assessments
 */
export class AssessmentService implements IAssessmentService {
  private dynamoClient: DynamoDBDocumentClient;
  private logger: Logger;
  private methodologyService: IMethodologyService;
  private computationService: AssessmentComputationService;
  private worldStateService: WorldStateService;
  private assessmentTableName: string;

  constructor(
    logger: Logger,
    methodologyService: IMethodologyService,
    computationService: AssessmentComputationService,
    worldStateService: WorldStateService,
    assessmentTableName: string,
    region?: string
  ) {
    this.logger = logger;
    this.methodologyService = methodologyService;
    this.computationService = computationService;
    this.worldStateService = worldStateService;
    this.assessmentTableName = assessmentTableName;
    
    this.dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));
  }

  /**
   * Create new assessment
   */
  async createAssessment(input: CreateAssessmentInput): Promise<MethodologyAssessment> {
    // Validate methodology exists
    const methodology = await this.methodologyService.getMethodology(
      input.methodology_id,
      input.methodology_version,
      input.tenant_id
    );

    if (!methodology) {
      throw new Error('METHODOLOGY_NOT_FOUND');
    }

    if (methodology.status === 'DEPRECATED') {
      throw new Error('METHODOLOGY_DEPRECATED');
    }

    // Validate opportunity exists
    const opportunity = await this.worldStateService.getState(
      `opportunity:${input.opportunity_id}`,
      input.tenant_id
    );

    if (!opportunity) {
      throw new Error('OPPORTUNITY_NOT_FOUND');
    }

    const now = new Date().toISOString();
    const assessmentId = `assessment-${Date.now()}-${uuidv4()}`;

    // Create empty assessment (dimensions will be populated via update)
    const assessment: MethodologyAssessment = {
      assessment_id: assessmentId,
      tenant_id: input.tenant_id,
      opportunity_id: input.opportunity_id,
      methodology_id: input.methodology_id,
      methodology_version: input.methodology_version,
      status: 'DRAFT',
      dimensions: {},
      computed: {
        completeness: 0,
        quality_score: 0,
        critical_dimensions_complete: false,
        fails_due_to_freshness: false,
        fails_due_to_provenance: false,
        recommended_autonomy_tier_cap: 'TIER_D',
        reasons: ['ASSESSMENT_CREATED'],
      },
      created_by: input.created_by,
      createdAt: now,
      updatedAt: now,
    };

    // Compute initial metrics (will be 0 for empty dimensions)
    assessment.computed = await this.computationService.computeAssessment(
      assessment,
      methodology
    );

    // Store assessment
    await this.storeAssessment(assessment);

    this.logger.info('Assessment created', {
      assessment_id: assessmentId,
      opportunity_id: input.opportunity_id,
      methodology_id: input.methodology_id,
    });

    return assessment;
  }

  /**
   * Get assessment by ID
   */
  async getAssessment(assessmentId: string, tenantId: string): Promise<MethodologyAssessment | null> {
    try {
      const result = await this.dynamoClient.send(new GetCommand({
        TableName: this.assessmentTableName,
        Key: {
          pk: `ASSESSMENT#${assessmentId}`,
          sk: 'METADATA',
        },
      }));

      if (!result.Item) {
        return null;
      }

      const assessment = (result.Item as any).assessment as MethodologyAssessment;

      // Verify tenant isolation
      if (assessment.tenant_id !== tenantId) {
        this.logger.warn('Tenant isolation violation', {
          assessment_id: assessmentId,
          requested_tenant: tenantId,
          actual_tenant: assessment.tenant_id,
        });
        return null;
      }

      return assessment;
    } catch (error) {
      this.logger.error('Failed to get assessment', {
        assessment_id: assessmentId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get active assessment for opportunity + methodology
   */
  async getActiveAssessment(
    opportunityId: string,
    methodologyId: string,
    tenantId: string
  ): Promise<MethodologyAssessment | null> {
    try {
      const result = await this.dynamoClient.send(new QueryCommand({
        TableName: this.assessmentTableName,
        IndexName: 'opportunity-methodology-index',
        KeyConditionExpression: 'gsi1pk = :gsi1pk AND begins_with(gsi1sk, :gsi1sk)',
        FilterExpression: '#status = :status',
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: {
          ':gsi1pk': `OPPORTUNITY#${opportunityId}`,
          ':gsi1sk': `METHODOLOGY#${methodologyId}#`,
          ':status': 'ACTIVE',
        },
        ScanIndexForward: false,  // Most recent first
        Limit: 1,
      }));

      if (!result.Items || result.Items.length === 0) {
        return null;
      }

      const assessment = (result.Items[0] as any).assessment as MethodologyAssessment;

      // Verify tenant isolation
      if (assessment.tenant_id !== tenantId) {
        return null;
      }

      return assessment;
    } catch (error) {
      this.logger.error('Failed to get active assessment', {
        opportunity_id: opportunityId,
        methodology_id: methodologyId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Update assessment dimensions
   */
  async updateAssessment(
    assessmentId: string,
    updates: UpdateAssessmentInput,
    tenantId: string
  ): Promise<MethodologyAssessment> {
    // Get current assessment
    const current = await this.getAssessment(assessmentId, tenantId);
    if (!current) {
      throw new Error('ASSESSMENT_NOT_FOUND');
    }

    // Get methodology
    const methodology = await this.methodologyService.getMethodology(
      current.methodology_id,
      current.methodology_version,
      tenantId
    );

    if (!methodology) {
      throw new Error('METHODOLOGY_NOT_FOUND');
    }

    // Merge dimension updates
    const updatedDimensions: Record<string, DimensionValue> = {
      ...current.dimensions,
    };

    if (updates.dimensions) {
      for (const [dimensionKey, dimensionUpdate] of Object.entries(updates.dimensions)) {
        // Validate dimension key exists in methodology
        const dimensionDef = methodology.dimensions.find(d => d.dimension_key === dimensionKey);
        if (!dimensionDef) {
          throw new Error(`INVALID_DIMENSION_KEY: ${dimensionKey}`);
        }

        // Merge with existing or create new
        const existing = updatedDimensions[dimensionKey] || {
          value: null,
          confidence: 0,
          freshness: 0,
          contradiction: 0,
          provenanceTrust: 'UNTRUSTED' as any,
          lastUpdated: new Date().toISOString(),
          evidenceRefs: [],
        };

        updatedDimensions[dimensionKey] = {
          ...existing,
          ...dimensionUpdate,
          lastUpdated: dimensionUpdate.lastUpdated || existing.lastUpdated,
        };

        // Compute freshness if lastUpdated changed
        if (dimensionUpdate.lastUpdated) {
          const now = new Date().getTime();
          const updated = new Date(dimensionUpdate.lastUpdated).getTime();
          updatedDimensions[dimensionKey].freshness = (now - updated) / (1000 * 60 * 60);
        }
      }
    }

    // Create updated assessment
    const updated: MethodologyAssessment = {
      ...current,
      dimensions: updatedDimensions,
      updatedAt: new Date().toISOString(),
    };

    // Recompute metrics
    updated.computed = await this.computationService.computeAssessment(
      updated,
      methodology
    );

    // Update status to ACTIVE if was DRAFT
    if (updated.status === 'DRAFT' && Object.keys(updatedDimensions).length > 0) {
      updated.status = 'ACTIVE';
    }

    // Store updated assessment
    await this.storeAssessment(updated);

    this.logger.info('Assessment updated', {
      assessment_id: assessmentId,
      completeness: updated.computed.completeness,
      quality_score: updated.computed.quality_score,
    });

    return updated;
  }

  /**
   * Supersede assessment (mark old as SUPERSEDED, link to new)
   */
  async supersedeAssessment(
    assessmentId: string,
    newAssessmentId: string,
    tenantId: string
  ): Promise<void> {
    const assessment = await this.getAssessment(assessmentId, tenantId);
    if (!assessment) {
      throw new Error('ASSESSMENT_NOT_FOUND');
    }

    assessment.status = 'SUPERSEDED';
    assessment.superseded_by = newAssessmentId;
    assessment.updatedAt = new Date().toISOString();

    await this.storeAssessment(assessment);

    this.logger.info('Assessment superseded', {
      old_assessment_id: assessmentId,
      new_assessment_id: newAssessmentId,
    });
  }

  /**
   * List assessments for opportunity + methodology
   */
  async listAssessments(
    opportunityId: string,
    methodologyId: string,
    tenantId: string
  ): Promise<MethodologyAssessment[]> {
    try {
      const result = await this.dynamoClient.send(new QueryCommand({
        TableName: this.assessmentTableName,
        IndexName: 'opportunity-methodology-index',
        KeyConditionExpression: 'gsi1pk = :gsi1pk AND begins_with(gsi1sk, :gsi1sk)',
        ExpressionAttributeValues: {
          ':gsi1pk': `OPPORTUNITY#${opportunityId}`,
          ':gsi1sk': `METHODOLOGY#${methodologyId}#`,
        },
        ScanIndexForward: false,  // Most recent first
      }));

      if (!result.Items || result.Items.length === 0) {
        return [];
      }

      return result.Items
        .map(item => (item as any).assessment as MethodologyAssessment)
        .filter(a => a.tenant_id === tenantId);
    } catch (error) {
      this.logger.error('Failed to list assessments', {
        opportunity_id: opportunityId,
        methodology_id: methodologyId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Store assessment in DynamoDB
   */
  private async storeAssessment(assessment: MethodologyAssessment): Promise<void> {
    const record = {
      pk: `ASSESSMENT#${assessment.assessment_id}`,
      sk: 'METADATA',
      assessment_id: assessment.assessment_id,
      tenant_id: assessment.tenant_id,
      opportunity_id: assessment.opportunity_id,
      methodology_id: assessment.methodology_id,
      methodology_version: assessment.methodology_version,
      status: assessment.status,
      assessment,
      // GSI1 for opportunity + methodology queries
      gsi1pk: `OPPORTUNITY#${assessment.opportunity_id}`,
      gsi1sk: `METHODOLOGY#${assessment.methodology_id}#${assessment.status}#${assessment.createdAt}`,
      createdAt: assessment.createdAt,
      updatedAt: assessment.updatedAt,
    };

    await this.dynamoClient.send(new PutCommand({
      TableName: this.assessmentTableName,
      Item: record,
    }));
  }
}
```

---

## 5. CDK Infrastructure Updates

### 5.1 DynamoDB Tables

**File:** `src/stacks/CCNativeStack.ts` (additions)

```typescript
// Methodology Table
this.methodologyTable = new dynamodb.Table(this, 'MethodologyTable', {
  tableName: 'cc-native-methodology',
  partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
  sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
  billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
  pointInTimeRecoverySpecification: {
    pointInTimeRecoveryEnabled: true,
  },
});

// GSI for tenant + status queries
this.methodologyTable.addGlobalSecondaryIndex({
  indexName: 'tenant-status-index',
  partitionKey: { name: 'gsi1pk', type: dynamodb.AttributeType.STRING },
  sortKey: { name: 'gsi1sk', type: dynamodb.AttributeType.STRING },
});

// Assessment Table
this.assessmentTable = new dynamodb.Table(this, 'AssessmentTable', {
  tableName: 'cc-native-assessment',
  partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
  sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
  billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
  pointInTimeRecoverySpecification: {
    pointInTimeRecoveryEnabled: true,
  },
});

// GSI for opportunity + methodology queries
this.assessmentTable.addGlobalSecondaryIndex({
  indexName: 'opportunity-methodology-index',
  partitionKey: { name: 'gsi1pk', type: dynamodb.AttributeType.STRING },
  sortKey: { name: 'gsi1sk', type: dynamodb.AttributeType.STRING },
});

// Stack Outputs
new cdk.CfnOutput(this, 'MethodologyTableName', {
  value: this.methodologyTable.tableName,
});

new cdk.CfnOutput(this, 'AssessmentTableName', {
  value: this.assessmentTable.tableName,
});
```

---

## 6. Integration with Existing Services

### 6.1 Schema Registry Integration

**Update:** `src/services/world-model/SchemaRegistryService.ts`

Add method to register methodology schemas:

```typescript
async registerSchema(input: {
  entityType: 'SalesMethodology';
  version: string;
  schemaHash: string;
  s3Key: string;
  schema: any;
}): Promise<void> {
  // Store in Schema Registry table
  // Verify hash matches
  // Index for fast lookup
}
```

### 6.2 World State Integration

Assessments are stored as entity state:

```typescript
// Assessment entity state
const assessmentState: EntityState = {
  entityId: `assessment:${assessment.assessment_id}`,
  entityType: 'MethodologyAssessment',
  tenantId: assessment.tenant_id,
  fields: {
    // Map dimensions to fields
    // Each dimension becomes a field with FieldState
  },
  computedAt: new Date().toISOString(),
  autonomyTier: assessment.computed.recommended_autonomy_tier_cap,
  overallConfidence: assessment.computed.quality_score,
  overallFreshness: Math.min(...Object.values(assessment.dimensions).map(d => d.freshness)),
  overallContradiction: Math.max(...Object.values(assessment.dimensions).map(d => d.contradiction)),
};
```

### 6.3 Snapshot Binding

When creating snapshots for decisions, include assessment:

```typescript
const snapshot = await snapshotService.createSnapshot(
  `opportunity:${opportunityId}`,
  'Opportunity',
  tenantId,
  opportunityState,
  'Decision snapshot with methodology assessment',
  {
    assessmentId: assessment.assessment_id,
    methodologyId: assessment.methodology_id,
    methodologyVersion: assessment.methodology_version,
    computed: assessment.computed,
  }
);
```

---

## 7. Testing Requirements

### 7.1 Unit Tests

**Files:**
- `src/tests/unit/methodology/MethodologyService.test.ts`
- `src/tests/unit/methodology/AssessmentService.test.ts`
- `src/tests/unit/methodology/AssessmentComputationService.test.ts`

**Test Coverage:**
- Methodology CRUD operations
- Assessment CRUD operations
- Deterministic computation (same inputs → same outputs)
- Autonomy tier cap computation
- Completeness/quality score formulas
- Tenant isolation
- Schema Registry integration
- Error handling (missing methodology, invalid dimensions)

### 7.2 Integration Tests

**File:** `src/tests/integration/methodology.test.ts`

**Test Scenarios:**
1. Create methodology → Create assessment → Update dimensions → Verify computation
2. Supersede assessment → Verify old is SUPERSEDED, new is ACTIVE
3. Autonomy tier cap enforcement (MIN rule)
4. Schema Registry hash verification
5. Snapshot binding with assessment

### 7.3 Golden Test Fixtures

**File:** `src/tests/fixtures/methodology/`

Create deterministic test fixtures for:
- Methodology definitions (MEDDICC baseline)
- Assessment scenarios (complete, incomplete, stale, inference-only)
- Expected computed outputs

---

## 8. Implementation Checklist

### Phase 1: Types & Infrastructure
- [ ] Create `MethodologyTypes.ts`
- [ ] Create `AssessmentTypes.ts`
- [ ] Add DynamoDB tables to CDK stack
- [ ] Add table outputs to stack

### Phase 2: Computation Service
- [ ] Implement `AssessmentComputationService`
- [ ] Unit tests for computation formulas
- [ ] Golden test fixtures for deterministic outputs

### Phase 3: Methodology Service
- [ ] Implement `MethodologyService`
- [ ] Schema Registry integration
- [ ] Unit tests
- [ ] Integration tests

### Phase 4: Assessment Service
- [ ] Implement `AssessmentService`
- [ ] World State integration
- [ ] Snapshot binding
- [ ] Unit tests
- [ ] Integration tests

### Phase 5: End-to-End
- [ ] Full workflow test (create methodology → create assessment → update → compute)
- [ ] Autonomy tier cap enforcement test
- [ ] Snapshot binding test
- [ ] Documentation

---

## 9. Dependencies

**Required Services (must exist):**
- `SchemaRegistryService` - For methodology schema storage
- `WorldStateService` - For opportunity validation and assessment state
- `EvidenceService` - For dimension provenance references
- `SnapshotService` - For assessment binding in snapshots

**Required Infrastructure:**
- Schema Registry S3 bucket (already exists)
- Methodology DynamoDB table (new)
- Assessment DynamoDB table (new)

---

## 10. Error Handling

### 10.1 Methodology Errors

- `METHODOLOGY_NOT_FOUND` - Methodology ID/version not found
- `METHODOLOGY_DEPRECATED` - Attempting to use deprecated methodology
- `INVALID_SCHEMA_HASH` - Schema hash mismatch (fail-closed)
- `TENANT_ISOLATION_VIOLATION` - Cross-tenant access attempt

### 10.2 Assessment Errors

- `ASSESSMENT_NOT_FOUND` - Assessment ID not found
- `OPPORTUNITY_NOT_FOUND` - Opportunity entity not found
- `INVALID_DIMENSION_KEY` - Dimension key not in methodology
- `INVALID_DIMENSION_VALUE` - Value doesn't match field_type
- `INVALID_PROVENANCE` - Provenance not in allowed list
- `DIMENSION_VALIDATION_FAILED` - Dimension fails validation rules

---

## 11. Performance Considerations

### 11.1 Caching

- Methodology definitions should be cached (Schema Registry has caching)
- Assessment computations are deterministic (can cache results)

### 11.2 Query Patterns

- `getActiveAssessment` uses GSI (efficient)
- `listAssessments` uses GSI (efficient)
- Methodology lookups use Schema Registry (cached)

### 11.3 Computation Optimization

- Computation service is stateless (can be parallelized)
- Dimension validation can be batched

---

## 12. Summary

This implementation plan provides:

1. **Complete type definitions** for both entities
2. **Three service implementations** (Methodology, Assessment, Computation)
3. **CDK infrastructure** updates
4. **Integration points** with existing services
5. **Testing requirements** (unit, integration, golden fixtures)
6. **Error handling** specifications
7. **Performance considerations**

All implementations follow existing patterns:
- Single intent per file
- No circular references
- <500 lines per file
- Deterministic computation
- Fail-closed validation
- Tenant isolation
