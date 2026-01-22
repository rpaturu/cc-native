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
      tenantId: input.tenant_id,
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
      if (assessment.tenantId !== tenantId) {
        this.logger.warn('Tenant isolation violation', {
          assessment_id: assessmentId,
          requested_tenant: tenantId,
          actual_tenant: assessment.tenantId,
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
      if (assessment.tenantId !== tenantId) {
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

    // Deterministic status transition rules:
    // 1. If transitioning from DRAFT to ACTIVE, auto-SUPERSEDE any existing ACTIVE assessment
    // 2. This ensures getActiveAssessment() is deterministic (one ACTIVE per methodology/opportunity)
    if (updated.status === 'DRAFT' && Object.keys(updatedDimensions).length > 0) {
      updated.status = 'ACTIVE';
      
      // Find and supersede any existing ACTIVE assessment for same opportunity/methodology
      const existingActive = await this.getActiveAssessment(
        updated.opportunity_id,
        updated.methodology_id,
        updated.tenantId
      );
      
      if (existingActive && existingActive.assessment_id !== updated.assessment_id) {
        await this.supersedeAssessment(
          existingActive.assessment_id,
          updated.assessment_id,
          updated.tenantId
        );
      }
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
        .filter(a => a.tenantId === tenantId);
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
      tenant_id: assessment.tenantId,  // Store as tenant_id in DynamoDB for queries
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
