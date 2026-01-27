/**
 * Action Type Registry Service - Phase 4.1
 * 
 * Manage versioned tool mapping (deterministic, supports schema evolution)
 */

import { DynamoDBDocumentClient, GetCommand, QueryCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { Logger } from '../core/Logger';
import { ActionTypeRegistry } from '../../types/ExecutionTypes';
import { ValidationError } from '../../types/ExecutionErrors';

export class ActionTypeRegistryService {
  constructor(
    private dynamoClient: DynamoDBDocumentClient,
    private tableName: string,
    private logger: Logger
  ) {}

  /**
   * Get tool mapping for action type and registry version
   * 
   * @param actionType - Action type (e.g., "CREATE_TASK")
   * @param registryVersion - Registry version number (if not provided, returns latest)
   * 
   * Note: Latest version lookup queries all versions and sorts by registry_version in memory.
   * This is acceptable for Phase 4.1 (small number of versions per action_type).
   * For production with many versions, consider a GSI with registry_version as sort key.
   */
  async getToolMapping(
    actionType: string,
    registryVersion?: number
  ): Promise<ActionTypeRegistry | null> {
    if (registryVersion !== undefined) {
      // Get specific registry version (for backwards compatibility with old intents)
      const result = await this.dynamoClient.send(new GetCommand({
        TableName: this.tableName,
        Key: {
          pk: `ACTION_TYPE#${actionType}`,
          sk: `REGISTRY_VERSION#${registryVersion}`,
        },
      }));
      
      return result.Item ? (result.Item as ActionTypeRegistry) : null;
    } else {
      // Get latest version: query all versions, sort by registry_version (monotonic, deterministic)
      // "Latest" means highest registry_version, NOT newest created_at timestamp
      // 
      // Future optimization options:
      // - Add LATEST pointer item per action_type (sk = LATEST, points to current registry_version)
      // - Add GSI with registry_version as sort key (REGISTRY_VERSION#000001, #000002, etc.)
      const result = await this.dynamoClient.send(new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'pk = :pk',
        ExpressionAttributeValues: {
          ':pk': `ACTION_TYPE#${actionType}`,
        },
      }));
      
      if (!result.Items || result.Items.length === 0) {
        return null;
      }
      
      // Sort by registry_version descending (highest = latest)
      // This is deterministic and safe (registry_version is monotonic)
      // Validate that registry_version is numeric and present (fail fast on bad data)
      const validItems = (result.Items as ActionTypeRegistry[]).filter(item => {
        if (item.registry_version === undefined || item.registry_version === null) {
          this.logger.warn('ActionTypeRegistry item missing registry_version', {
            action_type: item.action_type,
            pk: item.pk,
            sk: item.sk,
          });
          return false;
        }
        if (typeof item.registry_version !== 'number' || !Number.isInteger(item.registry_version) || item.registry_version < 1) {
          this.logger.warn('ActionTypeRegistry item has invalid registry_version', {
            action_type: item.action_type,
            pk: item.pk,
            sk: item.sk,
            registry_version: item.registry_version,
          });
          return false;
        }
        return true;
      });
      
      if (validItems.length === 0) {
        return null;
      }
      
      const sorted = validItems.sort((a, b) => b.registry_version! - a.registry_version!);
      
      return sorted[0] || null;
    }
  }

  /**
   * Map action parameters to tool arguments using registry
   */
  mapParametersToToolArguments(
    registry: ActionTypeRegistry,
    actionParameters: Record<string, any>
  ): Record<string, any> {
    const toolArguments: Record<string, any> = {};
    
    for (const [actionParam, mapping] of Object.entries(registry.parameter_mapping)) {
      const value = actionParameters[actionParam];
      
      if (mapping.required && value === undefined) {
        throw new ValidationError(
          `Required parameter missing: ${actionParam}`,
          'MISSING_REQUIRED_PARAMETER'
        );
      }
      
      if (value !== undefined) {
        let transformedValue = value;
        
        switch (mapping.transform) {
          case 'UPPERCASE':
            transformedValue = String(value).toUpperCase();
            break;
          case 'LOWERCASE':
            transformedValue = String(value).toLowerCase();
            break;
          case 'PASSTHROUGH':
          default:
            transformedValue = value;
        }
        
        toolArguments[mapping.toolParam] = transformedValue;
      }
    }
    
    return toolArguments;
  }

  /**
   * Register new tool mapping (admin operation)
   */
  async registerMapping(mapping: Omit<ActionTypeRegistry, 'pk' | 'sk' | 'created_at' | 'registry_version'>): Promise<void> {
    const now = new Date().toISOString();
    
    // Get latest version to determine next registry_version
    const latest = await this.getToolMapping(mapping.action_type);
    const nextRegistryVersion = latest ? latest.registry_version + 1 : 1;
    
    const registry: ActionTypeRegistry = {
      ...mapping,
      pk: `ACTION_TYPE#${mapping.action_type}`,
      sk: `REGISTRY_VERSION#${nextRegistryVersion}`,
      registry_version: nextRegistryVersion,
      created_at: now,
    };
    
    await this.dynamoClient.send(new PutCommand({
      TableName: this.tableName,
      Item: registry,
    }));
  }
}
