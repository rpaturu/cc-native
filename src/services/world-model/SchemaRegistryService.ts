import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { EntitySchema, CriticalFieldRegistry, SchemaQuery, ISchemaRegistryService } from '../../types/SchemaTypes';
import { EntityType } from '../../types/WorldStateTypes';
import { Logger } from '../core/Logger';
import { createHash } from 'crypto';

/**
 * SchemaRegistryService - Schema resolution and validation
 * 
 * Schemas are stored in S3 (immutable) and indexed in DynamoDB.
 * Hash verification ensures schema integrity (fail-closed on mismatch).
 */
export class SchemaRegistryService implements ISchemaRegistryService {
  private s3Client: S3Client;
  private dynamoClient: DynamoDBDocumentClient;
  private logger: Logger;
  private schemaBucket: string;
  private registryTableName: string;
  private criticalFieldsTableName: string;
  private schemaCache: Map<string, EntitySchema> = new Map();

  constructor(
    logger: Logger,
    schemaBucket: string,
    registryTableName: string,
    criticalFieldsTableName: string,
    region?: string
  ) {
    this.logger = logger;
    this.schemaBucket = schemaBucket;
    this.registryTableName = registryTableName;
    this.criticalFieldsTableName = criticalFieldsTableName;
    
    this.s3Client = new S3Client({ region });
    this.dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));
  }

  /**
   * Get schema by entity type and version
   * 
   * CRITICAL: Schema immutability is enforced via hash verification.
   * If hash doesn't match, fail-closed (throw error, Tier D).
   */
  async getSchema(entityType: EntityType, version: string, expectedHash?: string): Promise<EntitySchema | null> {
    try {
      // Check cache first
      const cacheKey = `${entityType}:${version}`;
      if (this.schemaCache.has(cacheKey)) {
        const cached = this.schemaCache.get(cacheKey)!;
        // Verify hash if provided
        if (expectedHash && cached.schemaHash !== expectedHash) {
          throw new SchemaHashMismatchError(
            `Schema hash mismatch: expected ${expectedHash}, got ${cached.schemaHash}`
          );
        }
        return cached;
      }

      // Query DynamoDB index
      const result = await this.dynamoClient.send(new QueryCommand({
        TableName: this.registryTableName,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
        ExpressionAttributeValues: {
          ':pk': `SCHEMA#${entityType}`,
          ':sk': `VERSION#${version}#`,
        },
        Limit: 1,
      }));

      if (!result.Items || result.Items.length === 0) {
        return null;
      }

      const index = result.Items[0];
      const s3Key = index.s3Key as string;
      const storedHash = index.schemaHash as string;

      // Verify hash if provided (fail-closed)
      if (expectedHash && storedHash !== expectedHash) {
        throw new SchemaHashMismatchError(
          `Schema hash mismatch: expected ${expectedHash}, got ${storedHash}`
        );
      }

      // Retrieve from S3
      const s3Result = await this.s3Client.send(new GetObjectCommand({
        Bucket: this.schemaBucket,
        Key: s3Key,
        VersionId: index.s3VersionId as string | undefined,
      }));

      const body = await s3Result.Body!.transformToString();
      const schema = JSON.parse(body) as EntitySchema;

      // Verify computed hash matches stored hash
      const computedHash = this.computeSchemaHash(schema);
      if (computedHash !== storedHash) {
        throw new SchemaHashMismatchError(
          `Schema hash verification failed: stored ${storedHash}, computed ${computedHash}`
        );
      }

      // Cache schema
      this.schemaCache.set(cacheKey, schema);

      return schema;
    } catch (error) {
      if (error instanceof SchemaHashMismatchError) {
        throw error;
      }
      this.logger.error('Failed to get schema', {
        entityType,
        version,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get critical fields for entity type
   */
  async getCriticalFields(entityType: EntityType): Promise<CriticalFieldRegistry[]> {
    try {
      const result = await this.dynamoClient.send(new QueryCommand({
        TableName: this.criticalFieldsTableName,
        KeyConditionExpression: 'pk = :pk',
        ExpressionAttributeValues: {
          ':pk': entityType,
        },
      }));

      if (!result.Items || result.Items.length === 0) {
        return [];
      }

      return result.Items.map(item => ({
        entityType: item.pk as EntityType,
        fieldName: item.sk as string,
        required: item.required as boolean,
        minConfidence: item.minConfidence as number | undefined,
        maxContradiction: item.maxContradiction as number | undefined,
        ttl: item.ttl as number | undefined,
        provenanceCaps: item.provenanceCaps as any,
        version: item.version as string,
        updatedAt: item.updatedAt as string,
      }));
    } catch (error) {
      this.logger.error('Failed to get critical fields', {
        entityType,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Validate entity state against schema
   */
  async validateEntityState(
    entityState: any,
    entityType: EntityType,
    version: string
  ): Promise<boolean> {
    try {
      const schema = await this.getSchema(entityType, version);
      if (!schema) {
        this.logger.warn('Schema not found for validation', { entityType, version });
        return false; // Missing schema = fail-closed
      }

      const criticalFields = await this.getCriticalFields(entityType);

      // Check critical fields
      for (const field of criticalFields) {
        if (field.required && !entityState.fields?.[field.fieldName]) {
          this.logger.warn('Missing critical field', {
            entityType,
            fieldName: field.fieldName,
          });
          return false;
        }
      }

      // Check required fields from schema
      for (const [fieldName, fieldDef] of Object.entries(schema.fields)) {
        if (fieldDef.required && !entityState.fields?.[fieldName]) {
          this.logger.warn('Missing required field', {
            entityType,
            fieldName,
          });
          return false;
        }
      }

      return true;
    } catch (error) {
      this.logger.error('Schema validation failed', {
        entityType,
        version,
        error: error instanceof Error ? error.message : String(error),
      });
      return false; // Fail-closed
    }
  }

  /**
   * Compute schema hash (SHA-256)
   */
  private computeSchemaHash(schema: EntitySchema): string {
    // Remove hash from schema for hashing
    const { schemaHash, ...schemaWithoutHash } = schema;
    const schemaString = JSON.stringify(schemaWithoutHash, null, 0); // No whitespace
    const hash = createHash('sha256').update(schemaString).digest('hex');
    return `sha256:${hash}`;
  }
}

/**
 * Schema hash mismatch error (fail-closed)
 */
export class SchemaHashMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SchemaHashMismatchError';
  }
}
