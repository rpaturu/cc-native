/**
 * Connector Configuration Service
 * 
 * Retrieves tenant-scoped connector configuration (instance URLs, API endpoints, etc.)
 * from DynamoDB and Secrets Manager.
 * 
 * Security: Account-specific secrets only (no tenant-global fallback by default)
 */

import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { Logger } from '../core/Logger';
import { ConfigurationError } from '../../types/ExecutionErrors';

export interface ConnectorConfig {
  instanceUrl?: string; // For Salesforce, Google Workspace, etc.
  apiEndpoint?: string; // For custom APIs
  apiKey?: string; // If needed (stored in Secrets Manager, not DynamoDB)
  // ... connector-specific config
}

export class ConnectorConfigService {
  constructor(
    private dynamoClient: DynamoDBDocumentClient,
    private configTableName: string,
    private secretsClient: SecretsManagerClient,
    private logger: Logger
  ) {}

  /**
   * Get connector config for tenant/account
   * 
   * Strategy:
   * 1. Check DynamoDB connector config table (non-sensitive config like instanceUrl)
   * 2. Check Secrets Manager for sensitive config (API keys, OAuth secrets)
   * 
   * ✅ MUST-FIX: Secret naming includes accountId to prevent cross-account config sharing
   * Secret ID format: tenant/{tenantId}/account/{accountId}/connector/{connectorType}
   * 
   * ✅ SECRETS DESIGN: Account-specific only (tenant-global option commented below)
   * 
   * **Default: Account-specific secrets only** - This prevents accidental cross-account config sharing.
   * Each account must have its own connector configuration at `tenant/{tenantId}/account/{accountId}/connector/{connectorType}`.
   * 
   * **When to enable tenant-global secrets:**
   * Only enable tenant-global secrets for connectors that are intentionally tenant-global
   * (e.g., shared API keys that apply to all accounts in a tenant).
   * 
   * **Security consideration:**
   * Tenant-global secrets can be accessed by any account in the tenant. Only use this
   * for connectors where cross-account access is acceptable and intentional.
   */
  async getConnectorConfig(
    tenantId: string,
    accountId: string,
    connectorType: 'salesforce' | 'google' | 'microsoft' | string
  ): Promise<ConnectorConfig | null> {
    // Get non-sensitive config from DynamoDB
    const result = await this.dynamoClient.send(new GetCommand({
      TableName: this.configTableName,
      Key: {
        pk: `TENANT#${tenantId}#ACCOUNT#${accountId}`,
        sk: `CONNECTOR#${connectorType}`,
      },
    }));

    const config: ConnectorConfig = result.Item ? {
      instanceUrl: result.Item.instance_url,
      apiEndpoint: result.Item.api_endpoint,
      // ... other non-sensitive fields
    } : {};

    // ✅ MUST-FIX: Get sensitive config from Secrets Manager (include accountId for account-specific config)
    // Secret naming: tenant/{tenantId}/account/{accountId}/connector/{connectorType}
    // This prevents accidental config sharing across accounts within the same tenant
    try {
      const secretResult = await this.secretsClient.send(new GetSecretValueCommand({
        SecretId: `tenant/${tenantId}/account/${accountId}/connector/${connectorType}`,
      }));
      const secretData = JSON.parse(secretResult.SecretString || '{}');
      config.apiKey = secretData.apiKey;
      // ... other sensitive fields
    } catch (error: any) {
      if (error.name !== 'ResourceNotFoundException') {
        this.logger.warn('Failed to retrieve connector secret', { tenantId, accountId, connectorType, error: error.message });
      }
      // ✅ SECRETS DESIGN: Account-specific only (tenant-global option commented below)
      // 
      // **Default: Account-specific secrets only** - This prevents accidental cross-account config sharing.
      // Each account must have its own connector configuration at `tenant/{tenantId}/account/{accountId}/connector/{connectorType}`.
      // 
      // **When to enable tenant-global secrets:**
      // Only enable tenant-global secrets for connectors that are intentionally tenant-global
      // (e.g., shared API keys that apply to all accounts in a tenant).
      // 
      // **Security consideration:**
      // Tenant-global secrets can be accessed by any account in the tenant. Only use this
      // for connectors where cross-account access is acceptable and intentional.
      // 
      // Uncomment below ONLY if connector is intentionally tenant-global:
      // try {
      //   const tenantSecret = await this.secretsClient.send(new GetSecretValueCommand({
      //     SecretId: `tenant/${tenantId}/connector/${connectorType}`,
      //   }));
      //   const tenantData = JSON.parse(tenantSecret.SecretString || '{}');
      //   config.apiKey = tenantData.apiKey;
      // } catch (tenantSecretError) {
      //   // No tenant-global secret found - this is expected for account-specific connectors
      // }
    }

    return Object.keys(config).length > 0 ? config : null;
  }
}
