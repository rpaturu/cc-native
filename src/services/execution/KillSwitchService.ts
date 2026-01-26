/**
 * Kill Switch Service - Phase 4.1
 * 
 * Manage execution safety controls (kill switches)
 */

import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { Logger } from '../core/Logger';
import { KillSwitchConfig } from '../../types/ExecutionTypes';

export class KillSwitchService {
  constructor(
    private dynamoClient: DynamoDBDocumentClient,
    private configTableName: string, // Tenant config table (tenants table)
    private logger: Logger
  ) {}

  /**
   * Check if execution is enabled for tenant
   */
  async isExecutionEnabled(
    tenantId: string,
    actionType?: string
  ): Promise<boolean> {
    // Check global emergency stop (environment variable)
    const globalStop = process.env.GLOBAL_EXECUTION_STOP === 'true';
    if (globalStop) {
      return false;
    }
    
    // Check tenant config
    const config = await this.getKillSwitchConfig(tenantId);
    if (!config.execution_enabled) {
      return false;
    }
    
    // Check action type disablement
    if (actionType && config.disabled_action_types.includes(actionType)) {
      return false;
    }
    
    return true;
  }

  /**
   * Get kill switch config for tenant
   * Note: Tenants table uses tenantId as partition key directly (not composite key)
   */
  async getKillSwitchConfig(tenantId: string): Promise<KillSwitchConfig> {
    const result = await this.dynamoClient.send(new GetCommand({
      TableName: this.configTableName,
      Key: {
        tenantId: tenantId, // Tenants table uses tenantId as PK directly
      },
    }));
    
    if (result.Item) {
      // Extract kill switch config from tenant item
      // Option A: Store as attributes in tenant item
      const config: KillSwitchConfig = {
        tenant_id: tenantId,
        execution_enabled: result.Item.execution_enabled ?? true,
        disabled_action_types: result.Item.disabled_action_types ?? [],
        global_emergency_stop: process.env.GLOBAL_EXECUTION_STOP === 'true',
      };
      return config;
    }
    
    // Default: execution enabled, no disabled action types
    return {
      tenant_id: tenantId,
      execution_enabled: true,
      disabled_action_types: [],
      global_emergency_stop: process.env.GLOBAL_EXECUTION_STOP === 'true',
    };
  }
}
