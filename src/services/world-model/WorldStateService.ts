import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { EntityState, FieldState, WorldStateQuery, IWorldStateService, EntityType } from '../../types/WorldStateTypes';
import { EvidenceRecord } from '../../types/EvidenceTypes';
import { TrustClass } from '../../types/CommonTypes';
import { Logger } from '../core/Logger';
import { EvidenceService } from './EvidenceService';

/**
 * WorldStateService - Compute and store entity state
 * 
 * State is computed deterministically from evidence and stored in DynamoDB.
 */
export class WorldStateService implements IWorldStateService {
  private dynamoClient: DynamoDBDocumentClient;
  private logger: Logger;
  private evidenceService: EvidenceService;
  private stateTableName: string;

  // Trust class confidence multipliers (from World Model Contract)
  private readonly TRUST_MULTIPLIERS: Record<TrustClass, number> = {
    PRIMARY: 1.0,
    VERIFIED: 0.95,
    DERIVED: 0.85,
    AGENT_INFERENCE: 0.60,
    UNTRUSTED: 0.30,
  };

  // Freshness decay rate (confidence decreases by 1% per hour after 24 hours)
  private readonly FRESHNESS_DECAY_HOURS = 24;
  private readonly FRESHNESS_DECAY_RATE = 0.01;

  constructor(
    logger: Logger,
    evidenceService: EvidenceService,
    stateTableName: string,
    region?: string
  ) {
    this.logger = logger;
    this.evidenceService = evidenceService;
    this.stateTableName = stateTableName;
    
    this.dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));
  }

  /**
   * Compute state from evidence (deterministic)
   */
  async computeState(entityId: string, entityType: EntityType, tenantId: string): Promise<EntityState> {
    try {
      // Query all evidence for this entity
      const evidenceQuery = await this.evidenceService.query({
        tenantId,
        entityId,
        limit: 1000, // Reasonable limit for Phase 0
      });
      
      const evidenceRecords = evidenceQuery;

      // NOTE: If we need to fetch evidence by IDs in the future, use Promise.all with concurrency cap
      // Example: const evidenceRecords = await Promise.all(
      //   evidenceIds.map(id => this.evidenceService.get(id, tenantId, entityId))
      // ).filter(e => e !== null) as EvidenceRecord[];

      if (evidenceRecords.length === 0) {
        throw new Error(`No evidence found for entity ${entityId}`);
      }

      // Compute state deterministically from evidence
      const fields: Record<string, FieldState> = {};
      const fieldEvidence: Record<string, EvidenceRecord[]> = {};

      // Group evidence by field
      for (const evidence of evidenceRecords) {
        for (const [fieldName, fieldValue] of Object.entries(evidence.payload)) {
          if (!fieldEvidence[fieldName]) {
            fieldEvidence[fieldName] = [];
          }
          fieldEvidence[fieldName].push(evidence);
        }
      }

      // Compute field state for each field
      for (const [fieldName, evidenceList] of Object.entries(fieldEvidence)) {
        fields[fieldName] = this.computeFieldState(fieldName, evidenceList);
      }

      // Compute overall metrics
      const fieldConfidences = Object.values(fields).map(f => f.confidence);
      const fieldFreshness = Object.values(fields).map(f => f.freshness);
      const fieldContradictions = Object.values(fields).map(f => f.contradiction);

      const overallConfidence = fieldConfidences.length > 0
        ? fieldConfidences.reduce((a, b) => a + b, 0) / fieldConfidences.length
        : 0;

      const overallFreshness = fieldFreshness.length > 0
        ? Math.min(...fieldFreshness)
        : 0;

      const overallContradiction = fieldContradictions.length > 0
        ? Math.max(...fieldContradictions)
        : 0;

      // Determine autonomy tier (simplified for Phase 0)
      // Full tier calculation will be in Agent Read Policy service
      const autonomyTier = this.calculateAutonomyTier(overallConfidence, overallFreshness, overallContradiction);

      const computedAt = new Date().toISOString();
      const state: EntityState = {
        entityId,
        entityType,
        tenantId,
        fields,
        computedAt,
        autonomyTier,
        overallConfidence,
        overallFreshness,
        overallContradiction,
      };

      // Store state
      await this.storeState(state);

      this.logger.debug('State computed', {
        entityId,
        entityType,
        fieldCount: Object.keys(fields).length,
        overallConfidence,
        autonomyTier,
      });

      return state;
    } catch (error) {
      this.logger.error('Failed to compute state', {
        entityId,
        entityType,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Compute field state from evidence
   */
  private computeFieldState(fieldName: string, evidenceList: EvidenceRecord[]): FieldState {
    // Sort by timestamp (most recent first)
    const sortedEvidence = [...evidenceList].sort((a, b) => 
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );

    // Use most recent evidence value
    const latestEvidence = sortedEvidence[0];
    const value = latestEvidence.payload[fieldName];

    // Calculate confidence from trust class and freshness
    const trustMultiplier = this.TRUST_MULTIPLIERS[latestEvidence.provenance.trustClass];
    const hoursSinceUpdate = this.getHoursSince(latestEvidence.timestamp);
    const freshnessMultiplier = this.calculateFreshnessMultiplier(hoursSinceUpdate);
    const confidence = trustMultiplier * freshnessMultiplier;

    // Calculate freshness
    const freshness = hoursSinceUpdate;

    // Calculate contradiction (compare with other evidence)
    const contradiction = this.computeContradiction(fieldName, sortedEvidence);

    // Collect evidence refs
    const evidenceRefs = sortedEvidence.map(ev => ({
      type: 's3' as const,
      location: ev.s3Location,
      timestamp: ev.timestamp,
    }));

    return {
      value,
      confidence: Math.max(0, Math.min(1, confidence)), // Clamp to [0, 1]
      freshness,
      contradiction: Math.max(0, Math.min(1, contradiction)), // Clamp to [0, 1]
      provenanceTrust: latestEvidence.provenance.trustClass,
      lastUpdated: latestEvidence.timestamp,
      evidenceRefs,
    };
  }

  /**
   * Calculate freshness multiplier (decay after threshold)
   */
  private calculateFreshnessMultiplier(hours: number): number {
    if (hours <= this.FRESHNESS_DECAY_HOURS) {
      return 1.0;
    }
    const decayHours = hours - this.FRESHNESS_DECAY_HOURS;
    const multiplier = 1.0 - (decayHours * this.FRESHNESS_DECAY_RATE);
    return Math.max(0.1, multiplier); // Minimum 10% confidence
  }

  /**
   * Compute contradiction score (field-specific comparison)
   */
  private computeContradiction(fieldName: string, evidenceList: EvidenceRecord[]): number {
    if (evidenceList.length <= 1) {
      return 0; // No contradiction with single evidence
    }

    // Normalize values for comparison
    const normalizeValue = (val: any): string => {
      if (val === null || val === undefined) return 'null';
      if (typeof val === 'object') return JSON.stringify(val, Object.keys(val).sort());
      return String(val).toLowerCase().trim();
    };

    // Get expected value from most recent evidence
    const expectedValue = normalizeValue(evidenceList[0].payload[fieldName]);
    
    // Count contradictions (different values)
    let contradictions = 0;
    for (let i = 1; i < evidenceList.length; i++) {
      const currentValue = normalizeValue(evidenceList[i].payload[fieldName]);
      if (currentValue !== expectedValue) {
        contradictions++;
      }
    }

    // Contradiction score: ratio of contradictory evidence
    return contradictions / (evidenceList.length - 1);
  }

  /**
   * Calculate autonomy tier (simplified for Phase 0)
   */
  private calculateAutonomyTier(
    confidence: number,
    freshness: number,
    contradiction: number
  ): 'TIER_A' | 'TIER_B' | 'TIER_C' | 'TIER_D' {
    // Simplified tier calculation
    // Full implementation will be in Agent Read Policy service
    
    if (contradiction > 0.5) {
      return 'TIER_D'; // High contradiction
    }

    if (confidence >= 0.9 && freshness <= 24 && contradiction <= 0.1) {
      return 'TIER_A';
    }

    if (confidence >= 0.75 && freshness <= 72 && contradiction <= 0.3) {
      return 'TIER_B';
    }

    if (confidence >= 0.6 && freshness <= 168 && contradiction <= 0.5) {
      return 'TIER_C';
    }

    return 'TIER_D';
  }

  /**
   * Get hours since timestamp
   */
  private getHoursSince(timestamp: string): number {
    const now = new Date().getTime();
    const then = new Date(timestamp).getTime();
    return (now - then) / (1000 * 60 * 60);
  }

  /**
   * Store computed state
   */
  private async storeState(state: EntityState): Promise<void> {
    const record = {
      pk: `ENTITY#${state.entityId}`,
      sk: `STATE#${state.computedAt}`,
      entityId: state.entityId,
      entityType: state.entityType,
      tenantId: state.tenantId,
      state,
      gsi1pk: `ENTITY_TYPE#${state.entityType}`,
      gsi1sk: state.computedAt,
    };

    await this.dynamoClient.send(new PutCommand({
      TableName: this.stateTableName,
      Item: record,
    }));
  }

  /**
   * Get current state for entity
   */
  async getState(entityId: string, tenantId: string): Promise<EntityState | null> {
    try {
      const result = await this.dynamoClient.send(new QueryCommand({
        TableName: this.stateTableName,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
        ExpressionAttributeValues: {
          ':pk': `ENTITY#${entityId}`,
          ':sk': 'STATE#',
        },
        ScanIndexForward: false, // Most recent first
        Limit: 1,
      }));

      if (!result.Items || result.Items.length === 0) {
        return null;
      }

      const state = (result.Items[0] as any).state as EntityState;
      
      // Verify tenant isolation
      if (state.tenantId !== tenantId) {
        this.logger.warn('Tenant isolation violation detected', {
          entityId,
          requestedTenantId: tenantId,
          actualTenantId: state.tenantId,
        });
        return null;
      }

      return state;
    } catch (error) {
      this.logger.error('Failed to get state', {
        entityId,
        tenantId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Query states by filters
   */
  async query(query: WorldStateQuery): Promise<EntityState[]> {
    try {
      let keyConditionExpression = '';
      const expressionAttributeValues: Record<string, any> = {
        ':tenantId': query.tenantId,
      };

      if (query.entityId) {
        keyConditionExpression = 'pk = :pk';
        expressionAttributeValues[':pk'] = `ENTITY#${query.entityId}`;
      } else if (query.entityType) {
        // Use GSI
        keyConditionExpression = 'gsi1pk = :gsi1pk';
        expressionAttributeValues[':gsi1pk'] = `ENTITY_TYPE#${query.entityType}`;
      } else {
        throw new Error('Either entityId or entityType must be provided');
      }

      let filterExpression = 'tenantId = :tenantId';
      
      if (query.minConfidence !== undefined) {
        filterExpression += ' AND state.overallConfidence >= :minConfidence';
        expressionAttributeValues[':minConfidence'] = query.minConfidence;
      }

      if (query.maxContradiction !== undefined) {
        filterExpression += ' AND state.overallContradiction <= :maxContradiction';
        expressionAttributeValues[':maxContradiction'] = query.maxContradiction;
      }

      const command = new QueryCommand({
        TableName: this.stateTableName,
        ...(query.entityId ? {} : { IndexName: 'entityType-index' }),
        KeyConditionExpression: keyConditionExpression,
        FilterExpression: filterExpression,
        ExpressionAttributeValues: expressionAttributeValues,
        ...(query.limit ? { Limit: query.limit } : {}),
        ScanIndexForward: false,
      });

      const result = await this.dynamoClient.send(command);
      
      if (!result.Items || result.Items.length === 0) {
        return [];
      }

      return result.Items.map(item => (item as any).state as EntityState);
    } catch (error) {
      this.logger.error('Failed to query states', {
        query,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
