import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { Tenant, CreateTenantInput, UpdateTenantInput } from '../../types/TenantTypes';
import { Logger } from './Logger';
import { getAWSClientConfig } from '../../utils/aws-client-config';
import { v4 as uuidv4 } from 'uuid';

/**
 * TenantService - Tenant CRUD operations
 */
export class TenantService {
  private dynamoClient: DynamoDBDocumentClient;
  private logger: Logger;
  private tableName: string;

  constructor(logger: Logger, tableName: string, region?: string) {
    this.logger = logger;
    this.tableName = tableName;
    
    const clientConfig = getAWSClientConfig(region);
    const client = new DynamoDBClient(clientConfig);
    this.dynamoClient = DynamoDBDocumentClient.from(client);
  }

  /**
   * Get tenant by ID
   */
  async getTenant(tenantId: string): Promise<Tenant | null> {
    try {
      const command = new GetCommand({
        TableName: this.tableName,
        Key: { tenantId },
      });

      const result = await this.dynamoClient.send(command);
      
      if (!result.Item) {
        this.logger.debug('Tenant not found', { tenantId });
        return null;
      }

      return result.Item as Tenant;
    } catch (error) {
      this.logger.error('Failed to get tenant', {
        tenantId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Create new tenant
   */
  async createTenant(input: CreateTenantInput): Promise<Tenant> {
    const now = new Date().toISOString();
    
    const tenant: Tenant = {
      tenantId: input.tenantId,
      name: input.name,
      status: 'active',
      config: {
        name: input.name,
        ...input.config,
      },
      metadata: input.metadata || {},
      createdAt: now,
      updatedAt: now,
    };

    try {
      const command = new PutCommand({
        TableName: this.tableName,
        Item: tenant,
        // Prevent overwrites
        ConditionExpression: 'attribute_not_exists(tenantId)',
      });

      await this.dynamoClient.send(command);
      
      this.logger.info('Tenant created', { tenantId: tenant.tenantId });
      return tenant;
    } catch (error) {
      this.logger.error('Failed to create tenant', {
        tenantId: input.tenantId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Update tenant
   */
  async updateTenant(tenantId: string, updates: UpdateTenantInput): Promise<Tenant> {
    try {
      const updateExpressions: string[] = [];
      const expressionAttributeNames: Record<string, string> = {};
      const expressionAttributeValues: Record<string, any> = {};

      if (updates.name !== undefined) {
        updateExpressions.push('#name = :name');
        expressionAttributeNames['#name'] = 'name';
        expressionAttributeValues[':name'] = updates.name;
      }

      if (updates.status !== undefined) {
        updateExpressions.push('#status = :status');
        expressionAttributeNames['#status'] = 'status';
        expressionAttributeValues[':status'] = updates.status;
      }

      if (updates.config !== undefined) {
        updateExpressions.push('#config = :config');
        expressionAttributeNames['#config'] = 'config';
        expressionAttributeValues[':config'] = updates.config;
      }

      if (updates.metadata !== undefined) {
        updateExpressions.push('#metadata = :metadata');
        expressionAttributeNames['#metadata'] = 'metadata';
        expressionAttributeValues[':metadata'] = updates.metadata;
      }

      if (updateExpressions.length === 0) {
        // No updates provided, return existing tenant
        return await this.getTenant(tenantId) || 
          Promise.reject(new Error(`Tenant not found: ${tenantId}`));
      }

      updateExpressions.push('updatedAt = :updatedAt');
      expressionAttributeValues[':updatedAt'] = new Date().toISOString();

      const command = new UpdateCommand({
        TableName: this.tableName,
        Key: { tenantId },
        UpdateExpression: `SET ${updateExpressions.join(', ')}`,
        ExpressionAttributeNames: Object.keys(expressionAttributeNames).length > 0 
          ? expressionAttributeNames 
          : undefined,
        ExpressionAttributeValues: expressionAttributeValues,
        // Ensure tenant exists
        ConditionExpression: 'attribute_exists(tenantId)',
        ReturnValues: 'ALL_NEW',
      });

      const result = await this.dynamoClient.send(command);
      
      this.logger.info('Tenant updated', { tenantId });
      return result.Attributes as Tenant;
    } catch (error) {
      this.logger.error('Failed to update tenant', {
        tenantId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
