import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getAWSClientConfig } from '../../utils/aws-client-config';
import { createHash } from 'crypto';
import { 
  SalesMethodology, 
  IMethodologyService, 
  CreateMethodologyInput, 
  UpdateMethodologyInput,
  MethodologyStatus
} from '../../types/MethodologyTypes';
import { Logger } from '../core/Logger';
import { SchemaRegistryService } from '../world-model/SchemaRegistryService';

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
    
    const clientConfig = getAWSClientConfig(region);
    this.dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient(clientConfig));
    this.s3Client = new S3Client(clientConfig);
  }

  /**
   * Create new methodology
   * 
   * Process:
   * 1. Always generate version internally (immutability guarantee)
   * 2. Compute schema hash
   * 3. Store in Schema Registry (S3 + DynamoDB)
   * 4. Store metadata in Methodology table
   */
  async createMethodology(input: CreateMethodologyInput): Promise<SalesMethodology> {
    const now = new Date().toISOString();
    // Always generate version internally - never accept from input (immutability guarantee)
    const version = this.generateVersion(input.methodology_id, input.tenant_id);
    
    const methodology: SalesMethodology = {
      methodology_id: input.methodology_id,
      name: input.name,
      version,
      tenantId: input.tenant_id,
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
   * 
   * CRITICAL: Version alone is not unique across methodologies.
   * We must verify methodology_id matches to prevent cross-methodology resolution.
   */
  async getMethodology(
    methodologyId: string,
    version: string,
    tenantId: string
  ): Promise<SalesMethodology | null> {
    try {
      // Try Schema Registry first (authoritative)
      // NOTE: Schema Registry lookup by (entityType, version) requires methodologyId verification
      const schema = await this.schemaRegistryService.getSchema(
        'SalesMethodology',
        version,
        undefined  // Hash verification optional on read
      );

      if (!schema) {
        return null;
      }

      // For methodologies, schema is the methodology object itself
      const methodology = (schema as any) as SalesMethodology;

      // CRITICAL: Verify methodology_id matches (prevents version collision across methodologies)
      if (methodology.methodology_id !== methodologyId) {
        this.logger.warn('Methodology ID mismatch', {
          requested_methodology_id: methodologyId,
          actual_methodology_id: methodology.methodology_id,
          version,
        });
        return null;
      }

      // Verify tenant isolation
      if (methodology.tenantId !== tenantId) {
        this.logger.warn('Tenant isolation violation', {
          methodology_id: methodologyId,
          requested_tenant: tenantId,
          actual_tenant: methodology.tenantId,
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
      await this.dynamoClient.send(new UpdateCommand({
        TableName: this.methodologyTableName,
        Key: {
          pk: `METHODOLOGY#${methodologyId}`,
          sk: `VERSION#${version}`,
        },
        UpdateExpression: 'SET #status = :status, updatedAt = :updatedAt',
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ConditionExpression: 'tenant_id = :tenantId',
        ExpressionAttributeValues: {
          ':status': 'DEPRECATED',
          ':updatedAt': new Date().toISOString(),
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
   * 
   * CRITICAL: Hash must be stable across semantically identical schemas.
   * We create a canonical payload by:
   * 1. Excluding metadata (schema_hash, schema_s3_key, createdAt, updatedAt, status)
   * 2. Sorting dimension arrays by dimension_key
   * 3. Using deterministic JSON serialization (sorted keys)
   */
  private computeSchemaHash(methodology: SalesMethodology): string {
    // Exclude metadata fields that don't affect schema semantics
    const {
      schema_hash,
      schema_s3_key,
      createdAt,
      updatedAt,
      status,
      ...schemaPayload
    } = methodology;

    // Sort dimensions by dimension_key for deterministic ordering
    const sortedDimensions = [...(schemaPayload.dimensions || [])].sort(
      (a, b) => a.dimension_key.localeCompare(b.dimension_key)
    );

    // Create canonical payload with sorted dimensions
    const canonicalPayload = {
      ...schemaPayload,
      dimensions: sortedDimensions,
    };

    // Use deterministic JSON serialization (sorted keys via replacer)
    const jsonString = JSON.stringify(canonicalPayload, (key, value) => {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        // Sort object keys for deterministic ordering
        return Object.keys(value)
          .sort()
          .reduce((sorted: Record<string, any>, k) => {
            sorted[k] = value[k];
            return sorted;
          }, {});
      }
      return value;
    });

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
