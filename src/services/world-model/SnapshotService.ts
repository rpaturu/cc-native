import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { WorldSnapshot, SnapshotQuery, ISnapshotService } from '../../types/SnapshotTypes';
import { EntityState } from '../../types/WorldStateTypes';
import { Logger } from '../core/Logger';
import { WorldStateService } from './WorldStateService';
import { getAWSClientConfig } from '../../utils/aws-client-config';
import { v4 as uuidv4 } from 'uuid';

/**
 * SnapshotService - Create and retrieve immutable snapshots
 * 
 * Snapshots are stored in S3 (immutable, Object Lock) and indexed in DynamoDB.
 */
export class SnapshotService implements ISnapshotService {
  private s3Client: S3Client;
  private dynamoClient: DynamoDBDocumentClient;
  private logger: Logger;
  private worldStateService: WorldStateService;
  private snapshotsBucket: string;
  private indexTableName: string;

  constructor(
    logger: Logger,
    worldStateService: WorldStateService,
    snapshotsBucket: string,
    indexTableName: string,
    region?: string
  ) {
    this.logger = logger;
    this.worldStateService = worldStateService;
    this.snapshotsBucket = snapshotsBucket;
    this.indexTableName = indexTableName;
    
    const clientConfig = getAWSClientConfig(region);
    this.s3Client = new S3Client(clientConfig);
    this.dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient(clientConfig));
  }

  /**
   * Create immutable snapshot of world state
   */
  async createSnapshot(
    entityId: string,
    entityType: string,
    tenantId: string,
    state?: EntityState,
    reason?: string
  ): Promise<WorldSnapshot> {
    try {
      // Get current state if not provided
      let snapshotState: EntityState;
      if (state) {
        snapshotState = state;
      } else {
        const fetchedState = await this.worldStateService.getState(entityId, tenantId);
        if (!fetchedState) {
          throw new Error(`No state found for entity ${entityId}`);
        }
        snapshotState = fetchedState;
      }

      // Verify state belongs to entity
      if (snapshotState.entityId !== entityId || snapshotState.entityType !== entityType || snapshotState.tenantId !== tenantId) {
        throw new Error('State does not match entity');
      }

      const snapshotId = `snap_${Date.now()}_${entityId.replace(/:/g, '_')}_${uuidv4().substring(0, 8)}`;
      const timestamp = new Date().toISOString();

      const snapshot: WorldSnapshot = {
        snapshotId,
        metadata: {
          snapshotId,
          entityId,
          entityType,
          tenantId,
          version: '1.0', // Schema version (will be dynamic in future)
          createdAt: timestamp,
          asOf: timestamp,
          createdBy: 'world-model-snapshot-service',
          reason: reason || 'Manual snapshot',
          bindingRequired: true, // All snapshots require binding for decisions/actions
        },
        state: snapshotState,
        s3Location: '', // Will be set after S3 upload
        schemaHash: '', // Will be set from schema registry in future
      };

      // Store in S3 (immutable with Object Lock)
      const s3Key = `snapshots/${entityType}/${entityId}/${snapshotId}.json`;
      
      // Calculate retention date (7 years from now)
      const retentionDate = new Date();
      retentionDate.setFullYear(retentionDate.getFullYear() + 7);
      
      await this.s3Client.send(new PutObjectCommand({
        Bucket: this.snapshotsBucket,
        Key: s3Key,
        Body: JSON.stringify(snapshot, null, 2),
        ContentType: 'application/json',
        ObjectLockMode: 'COMPLIANCE',
        ObjectLockRetainUntilDate: retentionDate,
      }));

      // Get version ID if versioning is enabled
      const headResult = await this.s3Client.send(new GetObjectCommand({
        Bucket: this.snapshotsBucket,
        Key: s3Key,
      }));
      const versionId = headResult.VersionId;

      snapshot.s3Location = s3Key;
      if (versionId) {
        snapshot.s3VersionId = versionId;
      }

      // Index in DynamoDB
      const indexRecord = {
        pk: `ENTITY#${entityId}`,
        sk: `SNAPSHOT#${timestamp}#${snapshotId}`,
        snapshotId,
        entityId,
        entityType,
        tenantId,
        timestamp,
        asOf: timestamp,
        s3Key,
        s3VersionId: versionId,
        version: snapshot.metadata.version,
        gsi1pk: `ENTITY_TYPE#${entityType}`,
        gsi1sk: timestamp,
      };

      await this.dynamoClient.send(new PutCommand({
        TableName: this.indexTableName,
        Item: indexRecord,
      }));

      this.logger.debug('Snapshot created', {
        snapshotId,
        entityId,
        entityType,
        reason,
      });

      return snapshot;
    } catch (error) {
      this.logger.error('Failed to create snapshot', {
        entityId,
        entityType,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get snapshot by ID
   */
  async getSnapshot(snapshotId: string, tenantId: string): Promise<WorldSnapshot | null> {
    try {
      // Query index to find snapshot
      // Note: This requires a GSI on snapshotId for efficient lookup
      // For Phase 0, we'll scan (inefficient but functional)
      // TODO: Add GSI on snapshotId
      
      // Alternative: Store snapshotId in a separate lookup table
      // For now, we'll require entityId for efficient query
      throw new Error('getSnapshot requires entityId - use getSnapshotByTimestamp or query with entityId');
    } catch (error) {
      this.logger.error('Failed to get snapshot', {
        snapshotId,
        tenantId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get snapshot by timestamp (point-in-time query)
   */
  async getSnapshotByTimestamp(entityId: string, tenantId: string, timestamp: string): Promise<WorldSnapshot | null> {
    try {
      // Query for snapshot closest to timestamp
      const result = await this.dynamoClient.send(new QueryCommand({
        TableName: this.indexTableName,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
        FilterExpression: 'tenantId = :tenantId AND asOf <= :timestamp',
        ExpressionAttributeValues: {
          ':pk': `ENTITY#${entityId}`,
          ':sk': 'SNAPSHOT#',
          ':tenantId': tenantId,
          ':timestamp': timestamp,
        },
        ScanIndexForward: false, // Most recent first
        Limit: 1,
      }));

      if (!result.Items || result.Items.length === 0) {
        return null;
      }

      const index = result.Items[0];
      const s3Key = index.s3Key as string;

      // Retrieve from S3
      const s3Result = await this.s3Client.send(new GetObjectCommand({
        Bucket: this.snapshotsBucket,
        Key: s3Key,
        VersionId: index.s3VersionId as string | undefined,
      }));

      const body = await s3Result.Body!.transformToString();
      const snapshot = JSON.parse(body) as WorldSnapshot;
      return snapshot;
    } catch (error) {
      this.logger.error('Failed to get snapshot by timestamp', {
        entityId,
        tenantId,
        timestamp,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Query snapshots by filters
   */
  async query(query: SnapshotQuery): Promise<WorldSnapshot[]> {
    try {
      let keyConditionExpression = '';
      let filterExpression = '';
      const expressionAttributeValues: Record<string, any> = {
        ':tenantId': query.tenantId,
      };

      if (query.entityId) {
        keyConditionExpression = 'pk = :pk';
        expressionAttributeValues[':pk'] = `ENTITY#${query.entityId}`;
        filterExpression = 'begins_with(sk, :sk) AND tenantId = :tenantId';
        expressionAttributeValues[':sk'] = 'SNAPSHOT#';
      } else if (query.entityType) {
        // Use GSI
        keyConditionExpression = 'gsi1pk = :gsi1pk';
        expressionAttributeValues[':gsi1pk'] = `ENTITY_TYPE#${query.entityType}`;
        filterExpression = 'tenantId = :tenantId';
      } else {
        throw new Error('Either entityId or entityType must be provided');
      }

      if (query.asOf) {
        filterExpression += filterExpression ? ' AND asOf <= :asOf' : 'asOf <= :asOf';
        expressionAttributeValues[':asOf'] = query.asOf;
      }

      if (query.startTime && query.endTime) {
        filterExpression += filterExpression ? ' AND #ts BETWEEN :startTime AND :endTime' : '#ts BETWEEN :startTime AND :endTime';
        expressionAttributeValues[':startTime'] = query.startTime;
        expressionAttributeValues[':endTime'] = query.endTime;
      }

      const command = new QueryCommand({
        TableName: this.indexTableName,
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

      // Retrieve snapshots from S3
      const snapshots: WorldSnapshot[] = [];
      for (const index of result.Items) {
        try {
          const s3Result = await this.s3Client.send(new GetObjectCommand({
            Bucket: this.snapshotsBucket,
            Key: index.s3Key as string,
            VersionId: index.s3VersionId as string | undefined,
          }));

          const body = await s3Result.Body!.transformToString();
          const snapshot = JSON.parse(body) as WorldSnapshot;
          snapshots.push(snapshot);
        } catch (error) {
          this.logger.warn('Failed to retrieve snapshot from S3', {
            s3Key: index.s3Key,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      return snapshots;
    } catch (error) {
      this.logger.error('Failed to query snapshots', {
        query,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
