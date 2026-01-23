import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { CognitoIdentityProviderClient, AdminGetUserCommand, ListUsersCommand } from '@aws-sdk/client-cognito-identity-provider';
import {
  UserIdentity,
  AgentIdentity,
  IIdentityService,
  CreateUserIdentityInput,
  CreateAgentIdentityInput,
  UpdateUserIdentityInput,
  UpdateAgentIdentityInput,
  IdentityPermissions,
  IdentityStatus,
} from '../../types/IdentityTypes';
import { Logger } from './Logger';

/**
 * IdentityService - User and agent identity management
 * 
 * Manages user and agent identities, permissions, and validation.
 * Integrates with Cognito for user authentication and IAM for agent roles.
 */
export class IdentityService implements IIdentityService {
  private dynamoClient: DynamoDBDocumentClient;
  private cognitoClient?: CognitoIdentityProviderClient;
  private logger: Logger;
  private identitiesTableName: string;
  private userPoolId?: string;
  private region?: string;

  constructor(
    logger: Logger,
    identitiesTableName: string,
    userPoolId?: string,
    region?: string
  ) {
    this.logger = logger;
    this.identitiesTableName = identitiesTableName;
    this.userPoolId = userPoolId;
    this.region = region;
    
    this.dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));
    if (userPoolId) {
      this.cognitoClient = new CognitoIdentityProviderClient({ region });
    }
  }

  /**
   * Get user identity
   */
  async getUserIdentity(userId: string, tenantId: string): Promise<UserIdentity | null> {
    try {
      const result = await this.dynamoClient.send(new GetCommand({
        TableName: this.identitiesTableName,
        Key: {
          pk: `USER#${userId}`,
          sk: `TENANT#${tenantId}`,
        },
      }));

      if (!result.Item) {
        return null;
      }

      const item = result.Item;
      return {
        userId: item.userId,
        tenantId: item.tenantId,
        email: item.email,
        username: item.username,
        firstName: item.firstName,
        lastName: item.lastName,
        roles: item.roles || [],
        permissions: item.permissions || this.getDefaultUserPermissions(),
        cognitoUserId: item.cognitoUserId,
        status: item.status || 'ACTIVE',
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      };
    } catch (error) {
      this.logger.error('Failed to get user identity', {
        userId,
        tenantId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get agent identity
   */
  async getAgentIdentity(agentId: string, tenantId: string): Promise<AgentIdentity | null> {
    try {
      const result = await this.dynamoClient.send(new GetCommand({
        TableName: this.identitiesTableName,
        Key: {
          pk: `AGENT#${agentId}`,
          sk: `TENANT#${tenantId}`,
        },
      }));

      if (!result.Item) {
        return null;
      }

      const item = result.Item;
      return {
        agentId: item.agentId,
        tenantId: item.tenantId,
        name: item.name,
        description: item.description,
        agentType: item.agentType,
        permissions: item.permissions || this.getDefaultAgentPermissions(),
        iamRoleArn: item.iamRoleArn,
        status: item.status || 'ACTIVE',
        capabilities: item.capabilities || [],
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      };
    } catch (error) {
      this.logger.error('Failed to get agent identity', {
        agentId,
        tenantId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Validate user identity
   */
  async validateUserIdentity(userId: string, tenantId: string): Promise<boolean> {
    try {
      const identity = await this.getUserIdentity(userId, tenantId);
      if (!identity) {
        return false;
      }

      // Check status
      if (identity.status !== 'ACTIVE') {
        this.logger.warn('User identity not active', {
          userId,
          tenantId,
          status: identity.status,
        });
        return false;
      }

      // Verify tenant matches
      if (identity.tenantId !== tenantId) {
        this.logger.warn('Tenant mismatch in user identity', {
          userId,
          requestedTenant: tenantId,
          actualTenant: identity.tenantId,
        });
        return false;
      }

      // If Cognito is configured, verify user exists in Cognito
      if (this.userPoolId && identity.cognitoUserId && this.cognitoClient) {
        try {
          await this.cognitoClient.send(new AdminGetUserCommand({
            UserPoolId: this.userPoolId,
            Username: identity.cognitoUserId,
          }));
        } catch (error: any) {
          if (error.name === 'UserNotFoundException') {
            this.logger.warn('User not found in Cognito', {
              userId,
              cognitoUserId: identity.cognitoUserId,
            });
            return false;
          }
          // Other errors (e.g., network) - log but don't fail validation
          this.logger.warn('Cognito validation error (non-fatal)', {
            userId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      return true;
    } catch (error) {
      this.logger.error('Failed to validate user identity', {
        userId,
        tenantId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Validate agent identity
   */
  async validateAgentIdentity(agentId: string, tenantId: string): Promise<boolean> {
    try {
      const identity = await this.getAgentIdentity(agentId, tenantId);
      if (!identity) {
        return false;
      }

      // Check status
      if (identity.status !== 'ACTIVE') {
        this.logger.warn('Agent identity not active', {
          agentId,
          tenantId,
          status: identity.status,
        });
        return false;
      }

      // Verify tenant matches
      if (identity.tenantId !== tenantId) {
        this.logger.warn('Tenant mismatch in agent identity', {
          agentId,
          requestedTenant: tenantId,
          actualTenant: identity.tenantId,
        });
        return false;
      }

      return true;
    } catch (error) {
      this.logger.error('Failed to validate agent identity', {
        agentId,
        tenantId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Get user permissions
   */
  async getUserPermissions(userId: string, tenantId: string): Promise<IdentityPermissions | null> {
    try {
      const identity = await this.getUserIdentity(userId, tenantId);
      return identity?.permissions || null;
    } catch (error) {
      this.logger.error('Failed to get user permissions', {
        userId,
        tenantId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Get agent permissions
   */
  async getAgentPermissions(agentId: string, tenantId: string): Promise<IdentityPermissions | null> {
    try {
      const identity = await this.getAgentIdentity(agentId, tenantId);
      return identity?.permissions || null;
    } catch (error) {
      this.logger.error('Failed to get agent permissions', {
        agentId,
        tenantId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Create user identity
   */
  async createUserIdentity(input: CreateUserIdentityInput): Promise<UserIdentity> {
    const now = new Date().toISOString();
    
    const identity: UserIdentity = {
      userId: input.userId,
      tenantId: input.tenantId,
      email: input.email,
      username: input.username,
      firstName: input.firstName,
      lastName: input.lastName,
      roles: input.roles,
      permissions: {
        ...this.getDefaultUserPermissions(),
        ...input.permissions,
      },
      cognitoUserId: input.cognitoUserId,
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    };

    try {
      const record = {
        pk: `USER#${input.userId}`,
        sk: `TENANT#${input.tenantId}`,
        gsi1pk: `TENANT#${input.tenantId}`,
        gsi1sk: `USER#${input.userId}`,
        ...identity,
      };

      await this.dynamoClient.send(new PutCommand({
        TableName: this.identitiesTableName,
        Item: record,
        ConditionExpression: 'attribute_not_exists(pk) OR attribute_not_exists(sk)',
      }));

      this.logger.info('User identity created', {
        userId: input.userId,
        tenantId: input.tenantId,
      });

      return identity;
    } catch (error) {
      this.logger.error('Failed to create user identity', {
        userId: input.userId,
        tenantId: input.tenantId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Create agent identity
   */
  async createAgentIdentity(input: CreateAgentIdentityInput): Promise<AgentIdentity> {
    const now = new Date().toISOString();
    
    const identity: AgentIdentity = {
      agentId: input.agentId,
      tenantId: input.tenantId,
      name: input.name,
      description: input.description,
      agentType: input.agentType,
      permissions: {
        ...this.getDefaultAgentPermissions(),
        ...input.permissions,
      },
      iamRoleArn: input.iamRoleArn,
      status: 'ACTIVE',
      capabilities: input.capabilities,
      createdAt: now,
      updatedAt: now,
    };

    try {
      const record = {
        pk: `AGENT#${input.agentId}`,
        sk: `TENANT#${input.tenantId}`,
        gsi1pk: `TENANT#${input.tenantId}`,
        gsi1sk: `AGENT#${input.agentId}`,
        ...identity,
      };

      await this.dynamoClient.send(new PutCommand({
        TableName: this.identitiesTableName,
        Item: record,
        ConditionExpression: 'attribute_not_exists(pk) OR attribute_not_exists(sk)',
      }));

      this.logger.info('Agent identity created', {
        agentId: input.agentId,
        tenantId: input.tenantId,
        agentType: input.agentType,
      });

      return identity;
    } catch (error) {
      this.logger.error('Failed to create agent identity', {
        agentId: input.agentId,
        tenantId: input.tenantId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Update user identity
   */
  async updateUserIdentity(
    userId: string,
    tenantId: string,
    updates: UpdateUserIdentityInput
  ): Promise<UserIdentity> {
    try {
      const existing = await this.getUserIdentity(userId, tenantId);
      if (!existing) {
        throw new Error('User identity not found');
      }

      const updated: UserIdentity = {
        ...existing,
        ...updates,
        permissions: {
          ...existing.permissions,
          ...updates.permissions,
        },
        updatedAt: new Date().toISOString(),
      };

      // Build UpdateExpression dynamically to handle optional fields
      const updateExpressions: string[] = [];
      const expressionAttributeValues: Record<string, any> = {
        ':updatedAt': updated.updatedAt,
      };
      const expressionAttributeNames: Record<string, string> = {};

      if (updates.email !== undefined) {
        updateExpressions.push('email = :email');
        expressionAttributeValues[':email'] = updated.email;
      }
      if (updates.username !== undefined) {
        updateExpressions.push('username = :username');
        expressionAttributeValues[':username'] = updated.username;
      }
      if (updates.firstName !== undefined) {
        updateExpressions.push('firstName = :firstName');
        expressionAttributeValues[':firstName'] = updated.firstName;
      }
      if (updates.lastName !== undefined) {
        updateExpressions.push('lastName = :lastName');
        expressionAttributeValues[':lastName'] = updated.lastName;
      }
      if (updates.roles !== undefined) {
        updateExpressions.push('roles = :roles');
        expressionAttributeValues[':roles'] = updated.roles;
      }
      if (updates.permissions !== undefined) {
        updateExpressions.push('permissions = :permissions');
        expressionAttributeValues[':permissions'] = updated.permissions;
      }
      if (updates.status !== undefined) {
        updateExpressions.push('#status = :status');
        expressionAttributeNames['#status'] = 'status';
        expressionAttributeValues[':status'] = updated.status;
      }

      updateExpressions.push('updatedAt = :updatedAt');

      await this.dynamoClient.send(new UpdateCommand({
        TableName: this.identitiesTableName,
        Key: {
          pk: `USER#${userId}`,
          sk: `TENANT#${tenantId}`,
        },
        UpdateExpression: `SET ${updateExpressions.join(', ')}`,
        ExpressionAttributeNames: Object.keys(expressionAttributeNames).length > 0 ? expressionAttributeNames : undefined,
        ExpressionAttributeValues: expressionAttributeValues,
        ConditionExpression: 'attribute_exists(pk) AND attribute_exists(sk)',
      }));

      this.logger.info('User identity updated', {
        userId,
        tenantId,
      });

      return updated;
    } catch (error) {
      this.logger.error('Failed to update user identity', {
        userId,
        tenantId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Update agent identity
   */
  async updateAgentIdentity(
    agentId: string,
    tenantId: string,
    updates: UpdateAgentIdentityInput
  ): Promise<AgentIdentity> {
    try {
      const existing = await this.getAgentIdentity(agentId, tenantId);
      if (!existing) {
        throw new Error('Agent identity not found');
      }

      const updated: AgentIdentity = {
        ...existing,
        ...updates,
        permissions: {
          ...existing.permissions,
          ...updates.permissions,
        },
        updatedAt: new Date().toISOString(),
      };

      // Build UpdateExpression dynamically to handle optional fields
      const updateExpressions: string[] = [];
      const expressionAttributeValues: Record<string, any> = {
        ':updatedAt': updated.updatedAt,
      };
      const expressionAttributeNames: Record<string, string> = {};

      if (updates.name !== undefined) {
        updateExpressions.push('name = :name');
        expressionAttributeValues[':name'] = updated.name;
      }
      if (updates.description !== undefined) {
        updateExpressions.push('description = :description');
        expressionAttributeValues[':description'] = updated.description;
      }
      if (updates.permissions !== undefined) {
        updateExpressions.push('permissions = :permissions');
        expressionAttributeValues[':permissions'] = updated.permissions;
      }
      if (updates.capabilities !== undefined) {
        updateExpressions.push('capabilities = :capabilities');
        expressionAttributeValues[':capabilities'] = updated.capabilities;
      }
      if (updates.status !== undefined) {
        updateExpressions.push('#status = :status');
        expressionAttributeNames['#status'] = 'status';
        expressionAttributeValues[':status'] = updated.status;
      }

      updateExpressions.push('updatedAt = :updatedAt');

      await this.dynamoClient.send(new UpdateCommand({
        TableName: this.identitiesTableName,
        Key: {
          pk: `AGENT#${agentId}`,
          sk: `TENANT#${tenantId}`,
        },
        UpdateExpression: `SET ${updateExpressions.join(', ')}`,
        ExpressionAttributeNames: Object.keys(expressionAttributeNames).length > 0 ? expressionAttributeNames : undefined,
        ExpressionAttributeValues: expressionAttributeValues,
        ConditionExpression: 'attribute_exists(pk) AND attribute_exists(sk)',
      }));

      this.logger.info('Agent identity updated', {
        agentId,
        tenantId,
      });

      return updated;
    } catch (error) {
      this.logger.error('Failed to update agent identity', {
        agentId,
        tenantId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get default user permissions
   */
  private getDefaultUserPermissions(): IdentityPermissions {
    return {
      canReadWorldState: true,
      canReadEvidence: true,
      canReadSnapshots: true,
      canExecuteTools: false, // Users don't execute tools directly
      canCreateActions: true,
      canApproveActions: true,
      maxAutonomyTier: 'TIER_A', // Users can approve Tier A actions
    };
  }

  /**
   * Get default agent permissions (read-only per AGENT_READ_POLICY.md)
   */
  private getDefaultAgentPermissions(): IdentityPermissions {
    return {
      canReadWorldState: true,
      canReadEvidence: true,
      canReadSnapshots: true,
      canExecuteTools: true, // Agents can execute tools
      canCreateActions: true,
      canApproveActions: false, // Agents cannot approve actions
      maxAutonomyTier: 'TIER_C', // Default max tier for agents (can be overridden per agent)
    };
  }
}
