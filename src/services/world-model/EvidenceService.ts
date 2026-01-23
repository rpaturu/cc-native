import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { EvidenceRecord, EvidenceQuery, IEvidenceService } from '../../types/EvidenceTypes';
import { Logger } from '../core/Logger';
import { getAWSClientConfig } from '../../utils/aws-client-config';
import { v4 as uuidv4 } from 'uuid';

/**
 * EvidenceService - Store and retrieve immutable evidence
 * 
 * Evidence is stored in S3 (immutable, Object Lock) and indexed in DynamoDB.
 */
export class EvidenceService implements IEvidenceService {
  private s3Client: S3Client;
  private dynamoClient: DynamoDBDocumentClient;
  private logger: Logger;
  private evidenceBucket: string;
  private indexTableName: string;

  constructor(
    logger: Logger,
    evidenceBucket: string,
    indexTableName: string,
    region?: string
  ) {
    this.logger = logger;
    this.evidenceBucket = evidenceBucket;
    this.indexTableName = indexTableName;
    
    const clientConfig = getAWSClientConfig(region);
    this.s3Client = new S3Client(clientConfig);
    this.dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient(clientConfig));
  }

  /**
   * Store immutable evidence (append-only)
   */
  async store(evidence: Omit<EvidenceRecord, 'evidenceId' | 's3Location' | 's3VersionId' | 'timestamp'>): Promise<EvidenceRecord> {
    const evidenceId = `evt_${Date.now()}_${uuidv4()}`;
    const timestamp = new Date().toISOString();
    
    const evidenceRecord: EvidenceRecord = {
      ...evidence,
      evidenceId,
      timestamp,
      s3Location: '', // Will be set after S3 upload
    };

    try {
      // Store in S3 (immutable with Object Lock)
      const s3Key = `evidence/${evidence.entityType}/${evidence.entityId}/${evidenceId}.json`;
      
      // Calculate retention date (7 years from now)
      const retentionDate = new Date();
      retentionDate.setFullYear(retentionDate.getFullYear() + 7);
      
      await this.s3Client.send(new PutObjectCommand({
        Bucket: this.evidenceBucket,
        Key: s3Key,
        Body: JSON.stringify(evidenceRecord, null, 2),
        ContentType: 'application/json',
        ObjectLockMode: 'COMPLIANCE',
        ObjectLockRetainUntilDate: retentionDate,
      }));

      // Get version ID if versioning is enabled
      const headResult = await this.s3Client.send(new GetObjectCommand({
        Bucket: this.evidenceBucket,
        Key: s3Key,
      }));
      const versionId = headResult.VersionId;

      evidenceRecord.s3Location = s3Key;
      if (versionId) {
        evidenceRecord.s3VersionId = versionId;
      }

      // Index in DynamoDB
      const indexRecord = {
        pk: `ENTITY#${evidence.entityId}`,
        sk: `EVIDENCE#${timestamp}#${evidenceId}`,
        evidenceId,
        entityId: evidence.entityId,
        entityType: evidence.entityType,
        timestamp,
        s3Key,
        s3VersionId: versionId,
        evidenceType: evidence.evidenceType,
        trustClass: evidence.provenance.trustClass,
        sourceSystem: evidence.provenance.sourceSystem,
        tenantId: evidence.metadata.tenantId,
        traceId: evidence.metadata.traceId,
        gsi1pk: `ENTITY_TYPE#${evidence.entityType}`,
        gsi1sk: timestamp,
      };

      await this.dynamoClient.send(new PutCommand({
        TableName: this.indexTableName,
        Item: indexRecord,
      }));

      this.logger.debug('Evidence stored', {
        evidenceId,
        entityId: evidence.entityId,
        entityType: evidence.entityType,
        source: evidence.provenance.sourceSystem,
      });

      return evidenceRecord;
    } catch (error) {
      this.logger.error('Failed to store evidence', {
        evidenceId,
        entityId: evidence.entityId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Retrieve evidence from S3
   * Note: entityId is optional but recommended for efficient query (Phase 0 limitation)
   * TODO: Add GSI on evidenceId for direct lookup without entityId
   */
  async get(evidenceId: string, tenantId: string, entityId?: string): Promise<EvidenceRecord | null> {
    if (!entityId) {
      // For Phase 0, entityId is required for efficient query
      // In future, we'll add GSI on evidenceId
      this.logger.warn('EvidenceService.get() called without entityId - inefficient query', {
        evidenceId,
        tenantId,
      });
      // For now, we can't efficiently query without entityId
      // Return null and log warning
      return null;
    }
    try {
      // Query by entityId (primary key) - get all evidence for this entity
      // Filter by evidenceId and tenantId in code (more reliable than FilterExpression for eventual consistency)
      const queryResult = await this.dynamoClient.send(new QueryCommand({
        TableName: this.indexTableName,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
        ExpressionAttributeValues: {
          ':pk': `ENTITY#${entityId}`,
          ':sk': 'EVIDENCE#',
        },
        Limit: 50, // Get enough items to find the matching one
      }));
      
      // Filter by evidenceId and tenantId in code
      let matchingItems = (queryResult.Items || []).filter(item => {
        const itemEvidenceId = item.evidenceId as string;
        const itemTenantId = item.tenantId as string;
        const matchesEvidenceId = itemEvidenceId === evidenceId;
        const matchesTenantId = !tenantId || itemTenantId === tenantId;
        return matchesEvidenceId && matchesTenantId;
      });
      
      if (matchingItems.length === 0) {
        this.logger.debug('No evidence found in index after filtering', {
          evidenceId,
          entityId,
          tenantId,
          totalItemsFound: queryResult.Items?.length || 0,
        });
        return null;
      }
      
      // Use the first matching item
      const index = matchingItems[0];
      
      this.logger.debug('Evidence found in index', {
        evidenceId,
        itemCount: matchingItems.length,
        firstItemKeys: index ? Object.keys(index) : [],
        firstItemEvidenceId: index?.evidenceId,
      });
      const s3Key = index.s3Key as string;
      
      // Get evidenceId from index, fallback to parameter if not in index
      // The index should always have evidenceId, but we use parameter as fallback for safety
      const indexEvidenceId = index.evidenceId as string | undefined;
      const finalEvidenceId = indexEvidenceId || evidenceId;

      if (!finalEvidenceId) {
        this.logger.error('No evidenceId found in index or parameter', {
          evidenceId,
          entityId,
          tenantId,
          indexKeys: Object.keys(index),
          indexEvidenceId,
        });
        throw new Error(`No evidenceId found for evidence lookup`);
      }

      // Retrieve from S3
      const s3Result = await this.s3Client.send(new GetObjectCommand({
        Bucket: this.evidenceBucket,
        Key: s3Key,
        VersionId: index.s3VersionId as string | undefined,
      }));

      const body = await s3Result.Body!.transformToString();
      const evidenceFromS3 = JSON.parse(body) as any;
      
      // Create evidence record - use index as source of truth for metadata
      const evidence: EvidenceRecord = {
        evidenceId: finalEvidenceId, // CRITICAL: Always set from index or parameter
        entityId: evidenceFromS3.entityId || index.entityId,
        entityType: evidenceFromS3.entityType || index.entityType,
        evidenceType: evidenceFromS3.evidenceType || index.evidenceType,
        timestamp: evidenceFromS3.timestamp || index.timestamp,
        payload: evidenceFromS3.payload || {},
        provenance: evidenceFromS3.provenance || {},
        metadata: evidenceFromS3.metadata || {},
        s3Location: s3Key,
        s3VersionId: index.s3VersionId as string | undefined,
      };
      
      // Final verification - evidenceId must be set
      // Double-check that evidenceId is actually set on the object
      if (!evidence.evidenceId || evidence.evidenceId !== finalEvidenceId) {
        this.logger.error('EvidenceId verification failed before return', {
          evidenceId,
          finalEvidenceId,
          actualEvidenceId: evidence.evidenceId,
          indexEvidenceId,
          indexKeys: Object.keys(index),
          evidenceKeys: Object.keys(evidence),
          evidenceHasEvidenceId: 'evidenceId' in evidence,
          evidenceDescriptor: Object.getOwnPropertyDescriptor(evidence, 'evidenceId'),
        });
        throw new Error(`EvidenceId mismatch: expected ${finalEvidenceId}, got ${evidence.evidenceId}`);
      }
      
      // Log what we're about to return
      this.logger.debug('Returning evidence with evidenceId', {
        evidenceId: evidence.evidenceId,
        finalEvidenceId,
        entityId: evidence.entityId,
        returnObjectKeys: Object.keys(evidence),
        returnObjectHasEvidenceId: 'evidenceId' in evidence,
      });
      
      // Create a fresh object to ensure all properties are properly set
      const returnEvidence: EvidenceRecord = {
        evidenceId: finalEvidenceId,
        entityId: evidence.entityId,
        entityType: evidence.entityType,
        evidenceType: evidence.evidenceType,
        timestamp: evidence.timestamp,
        payload: evidence.payload,
        provenance: evidence.provenance,
        metadata: evidence.metadata,
        s3Location: evidence.s3Location,
        s3VersionId: evidence.s3VersionId,
      };
      
      // Final check on return object
      if (!returnEvidence.evidenceId) {
        this.logger.error('Return evidence missing evidenceId', {
          finalEvidenceId,
          returnObjectKeys: Object.keys(returnEvidence),
        });
        throw new Error(`Return evidence missing evidenceId`);
      }
      
      return returnEvidence;
    } catch (error) {
      this.logger.error('Failed to retrieve evidence', {
        evidenceId,
        tenantId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Query evidence by filters
   */
  async query(query: EvidenceQuery): Promise<EvidenceRecord[]> {
    try {
      let keyConditionExpression = '';
      let filterExpression = '';
      const expressionAttributeValues: Record<string, any> = {
        ':tenantId': query.tenantId,
      };
      const expressionAttributeNames: Record<string, string> = {};

      if (query.entityId) {
        // Query by entityId (most efficient)
        // sk is part of primary key, so begins_with must be in KeyConditionExpression
        keyConditionExpression = 'pk = :pk AND begins_with(sk, :sk)';
        expressionAttributeValues[':pk'] = `ENTITY#${query.entityId}`;
        expressionAttributeValues[':sk'] = 'EVIDENCE#';
        filterExpression = 'tenantId = :tenantId';
      } else if (query.entityType) {
        // Query by entityType using GSI
        keyConditionExpression = 'gsi1pk = :gsi1pk';
        expressionAttributeValues[':gsi1pk'] = `ENTITY_TYPE#${query.entityType}`;
        filterExpression = 'tenantId = :tenantId';
      } else {
        throw new Error('Either entityId or entityType must be provided');
      }

      // Add additional filters
      if (query.evidenceType) {
        filterExpression += filterExpression ? ' AND evidenceType = :evidenceType' : 'evidenceType = :evidenceType';
        expressionAttributeValues[':evidenceType'] = query.evidenceType;
      }

      if (query.trustClass) {
        filterExpression += filterExpression ? ' AND trustClass = :trustClass' : 'trustClass = :trustClass';
        expressionAttributeValues[':trustClass'] = query.trustClass;
      }

      if (query.startTime && query.endTime) {
        filterExpression += filterExpression ? ' AND #ts BETWEEN :startTime AND :endTime' : '#ts BETWEEN :startTime AND :endTime';
        expressionAttributeNames['#ts'] = 'timestamp';
        expressionAttributeValues[':startTime'] = query.startTime;
        expressionAttributeValues[':endTime'] = query.endTime;
      }

      const command = new QueryCommand({
        TableName: this.indexTableName,
        ...(query.entityId ? {} : { IndexName: 'entityType-index' }),
        KeyConditionExpression: keyConditionExpression,
        ...(filterExpression ? { FilterExpression: filterExpression } : {}),
        ...(Object.keys(expressionAttributeNames).length > 0 ? { ExpressionAttributeNames: expressionAttributeNames } : {}),
        ExpressionAttributeValues: expressionAttributeValues,
        ...(query.limit ? { Limit: query.limit } : {}),
        ScanIndexForward: false, // Most recent first
      });

      const result = await this.dynamoClient.send(command);
      
      if (!result.Items || result.Items.length === 0) {
        return [];
      }

      // Retrieve evidence from S3
      const evidenceRecords: EvidenceRecord[] = [];
      for (const index of result.Items) {
        try {
          const s3Result = await this.s3Client.send(new GetObjectCommand({
            Bucket: this.evidenceBucket,
            Key: index.s3Key as string,
            VersionId: index.s3VersionId as string | undefined,
          }));

          const body = await s3Result.Body!.transformToString();
          const evidence = JSON.parse(body) as EvidenceRecord;
          evidenceRecords.push(evidence);
        } catch (error) {
          this.logger.warn('Failed to retrieve evidence from S3', {
            s3Key: index.s3Key,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      return evidenceRecords;
    } catch (error) {
      this.logger.error('Failed to query evidence', {
        query,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
