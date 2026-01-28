/**
 * CRM Connector Adapter
 * 
 * Handles CRM system operations (Salesforce, HubSpot, etc.) with OAuth authentication
 * and tenant-scoped configuration.
 */

import { IConnectorAdapter } from '../IConnectorAdapter';
import { MCPToolInvocation, MCPResponse } from '../../types/MCPTypes';
import { IdempotencyService } from '../../services/execution/IdempotencyService';
import { ConnectorConfigService } from '../../services/execution/ConnectorConfigService';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { Logger } from '../../services/core/Logger';
import { ValidationError, ConfigurationError } from '../../types/ExecutionErrors';
import { ExternalObjectRef } from '../../types/ExecutionTypes';
import axios from 'axios';

export class CrmConnectorAdapter implements IConnectorAdapter {
  private configService: ConnectorConfigService;

  constructor(
    private dynamoClient: DynamoDBDocumentClient,
    private dedupeTableName: string,
    private configTableName: string,
    private secretsClient: SecretsManagerClient,
    private logger: Logger
  ) {
    this.configService = new ConnectorConfigService(
      dynamoClient,
      configTableName,
      secretsClient,
      logger
    );
  }

  async execute(invocation: MCPToolInvocation): Promise<MCPResponse> {
    const { name, arguments: args } = invocation.params;
    const invocationId = invocation.id; // ✅ id is at top level, not in params

    // ✅ MUST-FIX: Validate idempotency_key presence (contract violation if missing)
    const idempotencyKey = args.idempotency_key;
    if (!idempotencyKey) {
      throw new ValidationError(
        'Missing required parameter: idempotency_key. ' +
        'This is a contract violation - ToolMapper handler must include idempotency_key in tool_arguments. ' +
        'Without idempotency_key, adapter-level dedupe cannot function and retries may cause double-writes.',
        'IDEMPOTENCY_KEY_MISSING'
      );
    }

    // ✅ MUST-FIX: Validate tenant_id and account_id (security: prevent cross-tenant calls)
    if (!args.tenant_id || !args.account_id) {
      throw new ValidationError(
        'Missing required parameters: tenant_id and account_id must be present in tool arguments. ' +
        'This is required for tenant binding and security enforcement.'
      );
    }

    // ✅ MUST-FIX: Validate tenant binding (if identity carries tenant claims)
    if (invocation.identity?.tenantId && invocation.identity.tenantId !== args.tenant_id) {
      throw new ValidationError(
        `Tenant mismatch: identity tenant_id (${invocation.identity.tenantId}) does not match tool argument tenant_id (${args.tenant_id}). ` +
        'This may indicate a security issue or misconfiguration.'
      );
    }

    // Check external write dedupe (adapter-level idempotency)
    // ✅ PHASE 4.3 ENHANCEMENT: checkExternalWriteDedupe now returns external_object_refs[] array
    const idempotencyService = new IdempotencyService();
    const existingObjectRefs = await idempotencyService.checkExternalWriteDedupe(
      this.dynamoClient,
      this.dedupeTableName,
      idempotencyKey
    );

    if (existingObjectRefs && existingObjectRefs.length > 0) {
      // Already executed, return existing result with full external_object_refs array
      return {
        jsonrpc: '2.0',
        id: invocationId,
        result: {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              external_object_refs: existingObjectRefs, // ✅ Direct use of array from dedupe service
            }),
          }],
        },
      };
    }

    if (name === 'crm.create_task') {
      return await this.createTask(invocation, args, idempotencyKey, invocationId);
    }

    throw new ValidationError(`Unknown tool: ${name}`);
  }

  async validate(parameters: Record<string, any>): Promise<{ valid: boolean; error?: string }> {
    if (!parameters.title) {
      return { valid: false, error: 'title is required' };
    }
    return { valid: true };
  }

  private async createTask(
    invocation: MCPToolInvocation,
    args: Record<string, any>,
    idempotencyKey: string,
    invocationId: string
  ): Promise<MCPResponse> {
    // ✅ MUST-FIX: Validate action_intent_id presence (required for dedupe recording)
    const actionIntentId = args.action_intent_id;
    if (!actionIntentId) {
      throw new ValidationError(
        'Missing required parameter: action_intent_id. ' +
        'ToolMapper handler must include action_intent_id in tool_arguments for external write dedupe recording.'
      );
    }

    // ✅ MUST-FIX: Get OAuth token with proper validation
    const oauthToken = invocation.identity?.accessToken;
    if (!oauthToken) {
      throw new ValidationError(
        'OAuth token missing from Gateway identity. ' +
        'Gateway must be configured with AgentCore Identity to provide OAuth accessToken for outbound API calls. ' +
        'The token should be bound to tenant_id/account_id claims for security.',
        'OAUTH_TOKEN_MISSING'
      );
    }

    // ✅ MUST-FIX: Get Salesforce instance URL from tenant-scoped config (NOT hardcoded)
    const config = await this.configService.getConnectorConfig(
      args.tenant_id,
      args.account_id,
      'salesforce'
    );
    const salesforceInstanceUrl = config?.instanceUrl;
    if (!salesforceInstanceUrl) {
      throw new ConfigurationError(
        `Salesforce instance URL not found for tenant_id: ${args.tenant_id}, account_id: ${args.account_id}. ` +
        'Connector configuration must be stored in tenant-scoped config store (DynamoDB/Secrets Manager).'
      );
    }

    // Call Salesforce REST API
    const apiUrl = `${salesforceInstanceUrl}/services/data/v58.0/sobjects/Task/`;
    let response;
    try {
      response = await axios.post(
        apiUrl,
        {
          Subject: args.title,
          Priority: args.priority || 'Normal',
          Description: args.description,
          // ... other fields
        },
        {
          headers: {
            'Authorization': `Bearer ${oauthToken}`,
            'Content-Type': 'application/json',
            // ✅ Idempotency-Key header is best-effort only (Salesforce may or may not support it)
            // **IMPORTANT:** DynamoDB dedupe (external_write_dedupe table) is authoritative.
            // Do NOT rely on Salesforce idempotency behavior - always check DynamoDB dedupe first.
            'Idempotency-Key': idempotencyKey, // Best-effort only, not authoritative
          },
        }
      );
    } catch (error: any) {
      // Handle Salesforce API errors
      if (error.response?.status === 401 || error.response?.status === 403) {
        throw new ValidationError(
          `Salesforce authentication failed: ${error.response?.data?.message || error.message}`,
          'SALESFORCE_AUTH_FAILED'
        );
      }
      throw error; // Re-throw for retry logic in ToolInvoker (may be transient)
    }

    // ✅ MUST-FIX: Handle Salesforce response shape correctly (Id vs id)
    const taskId = response.data.id || response.data.Id;
    if (!taskId) {
      throw new ValidationError(
        `Invalid Salesforce response: missing task ID. Response: ${JSON.stringify(response.data)}. ` +
        'Salesforce create responses must include either "id" or "Id" field.',
        'INVALID_CONNECTOR_RESPONSE'
      );
    }

    // Record external write dedupe
    // ✅ PHASE 4.3 ENHANCEMENT: recordExternalWriteDedupe now accepts external_object_refs[] array
    const idempotencyService = new IdempotencyService();
    const externalObjectRefs: ExternalObjectRef[] = [
      {
        system: 'CRM',
        object_type: 'Task',
        object_id: taskId,
        object_url: `${salesforceInstanceUrl}/${taskId}`,
      },
    ];
    await idempotencyService.recordExternalWriteDedupe(
      this.dynamoClient,
      this.dedupeTableName,
      idempotencyKey,
      externalObjectRefs, // ✅ Now accepts array instead of single string
      actionIntentId,
      'crm.create_task'
    );

    return {
      jsonrpc: '2.0',
      id: invocationId,
      result: {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            external_object_refs: [  // ✅ Preferred: array format per Phase 4.2 contract
              {
                system: 'CRM',
                object_type: 'Task',
                object_id: taskId,
                object_url: `${salesforceInstanceUrl}/${taskId}`,
              },
            ],
          }),
        }],
      },
    };
  }
}
