# Phase 4.3 — Connectors: Code-Level Implementation Plan

**Status:** 🟡 **PLANNING**  
**Created:** 2026-01-26  
**Last Updated:** 2026-01-26  
**Reviewed & Updated:** 2026-01-26 (aligned with Phase 4.1/4.2 implementation)  
**Implementation Status Check:** 2026-01-26 (compared with current codebase - Phase 4.3 not yet implemented)  
**Parent Document:** `PHASE_4_CODE_LEVEL_PLAN.md`  
**Prerequisites:** Phase 4.1 and 4.2 complete

---

## Overview

Phase 4.3 implements connector adapters for external system integration:
- Connector adapter interface
- Internal systems adapter (safest, no external dependencies)
- CRM adapter (initial implementation)
- AgentCore Gateway setup (CDK)
- Tool registration pattern
- ActionTypeRegistry seed data

**Duration:** Week 3-5  
**Dependencies:** Phase 4.1 and 4.2 complete

---

## Implementation Tasks

1. Connector adapter interface
2. Internal systems adapter (with persistence)
3. CRM adapter (initial, with tenant-scoped config)
4. Connector configuration service (tenant-scoped config retrieval)
5. AgentCore Gateway setup (CDK - automated)
6. Register adapters as Gateway targets (CDK - automated)
7. ✅ ToolMapper handler updated to pass `action_intent_id` in tool arguments (already fixed)
8. Seed initial ActionTypeRegistry entries (with MANUAL_ONLY compensation for CRM)
9. Security controls (VPC isolation, per-connector IAM, tenant binding)

**Note:** Task 7 (ToolMapper update) is already complete - `action_intent_id` is now included in `tool_arguments`. See Phase 4.2 ToolMapper handler for implementation.

**Current Implementation Status (as of 2026-01-26):**
- ✅ Phase 4.1 and 4.2 infrastructure complete (`ExecutionInfrastructure.ts`, handlers, Step Functions)
- ✅ `MCPTypes.ts` exists and matches plan (`MCPToolInvocation`, `MCPResponse`)
- ✅ `ActionOutcomeV1.external_object_refs` already uses array format (inline type definition)
- ❌ Phase 4.3 components not yet implemented:
  - `src/adapters/` directory does not exist
  - `internal-adapter-handler.ts` and `crm-adapter-handler.ts` not created
  - Gateway setup not added to `ExecutionInfrastructure.ts`
  - `ConnectorConfigService.ts` not created
  - `IdempotencyService` still uses `external_object_id: string` (needs enhancement)
  - `ExternalWriteDedupe` type still uses `external_object_id: string` (needs enhancement)

---

## 1. Connector Adapter Interface

### File: `src/adapters/IConnectorAdapter.ts`

**Purpose:** Connector adapter interface

**Interface:**

```typescript
import { MCPToolInvocation, MCPResponse } from '../../types/MCPTypes';

// Note: MCPTypes.ts was created in Phase 4.1 (see Phase 4.1 Type Definitions)

/**
 * Connector Adapter Interface
 * All adapters must implement this interface
 */
export interface IConnectorAdapter {
  /**
   * Execute connector action
   * @param invocation - MCP tool invocation from Gateway
   * @returns MCP response with external object IDs
   */
  execute(invocation: MCPToolInvocation): Promise<MCPResponse>;
  
  /**
   * Validate action parameters
   * @param parameters - Action parameters
   * @returns Validation result
   */
  validate(parameters: Record<string, any>): Promise<{ valid: boolean; error?: string }>;
  
  /**
   * Compensate action (rollback if reversible)
   * @param externalObjectId - External object ID to rollback
   * @returns Compensation result
   */
  compensate?(externalObjectId: string): Promise<{ success: boolean; error?: string }>;
}
```

---

## 2. Internal Systems Adapter

### File: `src/adapters/internal/InternalConnectorAdapter.ts`

**Purpose:** Internal systems adapter (safest, no external dependencies)

**Implementation:**

```typescript
import { IConnectorAdapter } from '../IConnectorAdapter';
import { MCPToolInvocation, MCPResponse } from '../../../types/MCPTypes';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { Logger } from '../../services/core/Logger';
import { ValidationError } from '../../../types/ExecutionErrors';

export class InternalConnectorAdapter implements IConnectorAdapter {
  constructor(
    private dynamoClient: DynamoDBDocumentClient,
    private logger: Logger
  ) {}

  async execute(invocation: MCPToolInvocation): Promise<MCPResponse> {
    const { name, arguments: args } = invocation.params;
    const invocationId = invocation.id; // ✅ id is at top level, not in params
    
    if (name === 'internal.create_note') {
      return await this.createNote(args, invocationId);
    }
    
    if (name === 'internal.create_task') {
      return await this.createTask(args, invocationId);
    }
    
    throw new Error(`Unknown tool: ${name}`);
  }

  async validate(parameters: Record<string, any>): Promise<{ valid: boolean; error?: string }> {
    // Basic validation
    return { valid: true };
  }

  private async createNote(args: Record<string, any>, invocationId: string): Promise<MCPResponse> {
    // Validate required fields
    if (!args.tenant_id || !args.account_id) {
      throw new ValidationError(
        'Missing required fields: tenant_id and account_id must be present in tool arguments. ' +
        'This is required for tenant binding and security enforcement.',
        'TENANT_BINDING_MISSING'
      );
    }

    // Create internal note in DynamoDB
    const noteId = `note_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    
    // ✅ MUST persist before returning success (per review feedback)
    // Do not return success unless data is actually persisted
    await this.dynamoClient.send(new PutCommand({
      TableName: process.env.INTERNAL_NOTES_TABLE_NAME || 'cc-native-internal-notes',
      Item: {
        note_id: noteId,
        content: args.content,
        account_id: args.account_id,
        tenant_id: args.tenant_id,
        created_at: new Date().toISOString(),
      },
    }));
    
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
                system: 'INTERNAL',
                object_type: 'Note',
                object_id: noteId,
              },
            ],
          }),
        }],
      },
    };
  }

  private async createTask(args: Record<string, any>, invocationId: string): Promise<MCPResponse> {
    // Validate required fields
    if (!args.tenant_id || !args.account_id) {
      throw new ValidationError(
        'Missing required fields: tenant_id and account_id must be present in tool arguments. ' +
        'This is required for tenant binding and security enforcement.',
        'TENANT_BINDING_MISSING'
      );
    }

    // Similar to createNote
    const taskId = `task_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    
    // ✅ MUST persist before returning success (per review feedback)
    // Do not return success unless data is actually persisted
    await this.dynamoClient.send(new PutCommand({
      TableName: process.env.INTERNAL_TASKS_TABLE_NAME || 'cc-native-internal-tasks',
      Item: {
        task_id: taskId,
        title: args.title,
        description: args.description,
        account_id: args.account_id,
        tenant_id: args.tenant_id,
        created_at: new Date().toISOString(),
      },
    }));
    
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
                system: 'INTERNAL',
                object_type: 'Task',
                object_id: taskId,
              },
            ],
          }),
        }],
      },
    };
  }
}
```

---

## 3. CRM Adapter

### File: `src/adapters/crm/CrmConnectorAdapter.ts`

**Purpose:** CRM adapter (initial implementation)

**Implementation:**

```typescript
import { IConnectorAdapter } from '../IConnectorAdapter';
import { MCPToolInvocation, MCPResponse } from '../../../types/MCPTypes';
import { IdempotencyService } from '../../services/execution/IdempotencyService';
import { ConnectorConfigService } from '../../services/execution/ConnectorConfigService';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { Logger } from '../../services/core/Logger';
import { ValidationError, ConfigurationError } from '../../../types/ExecutionErrors';
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
    // Note: Gateway identity should include tenant_id claim - validate it matches args.tenant_id
    if (invocation.identity?.tenantId && invocation.identity.tenantId !== args.tenant_id) {
      throw new ValidationError(
        `Tenant mismatch: identity tenant_id (${invocation.identity.tenantId}) does not match tool argument tenant_id (${args.tenant_id}). ` +
        'This may indicate a security issue or misconfiguration.'
      );
    }
    
    // Check external write dedupe (adapter-level idempotency)
    // ✅ PHASE 4.3 ENHANCEMENT: checkExternalWriteDedupe now returns external_object_refs[] array
    // This matches Phase 4.2 contract and avoids reconstruction from single object_id
    // ✅ IdempotencyService has no constructor parameters (static utility methods)
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
    
    throw new Error(`Unknown tool: ${name}`);
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
    // Gateway uses AgentCore Identity (or equivalent) to mint/attach OAuth accessToken
    // This is OUTBOUND OAuth (adapter → Salesforce), not inbound JWT authorizer
    // Contract: Gateway provides OAuth accessToken via invocation.identity.accessToken
    // Token should be bound to tenant_id/account_id claims for security
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
    // Security: Hardcoded instance URL is an anti-pattern - wrong tenant host = data leak
    // Must come from tenant-scoped connector config store (DynamoDB/Secrets Manager)
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
    // Salesforce create responses may return 'id' (lowercase) or 'Id' (uppercase) depending on endpoint
    // Validate presence and handle both cases
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
    // This matches Phase 4.2 contract and stores full object reference information
    const idempotencyService = new IdempotencyService();
    const externalObjectRefs = [
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
```

---

## 4. Lambda Handlers for Adapters

### Purpose

Gateway invokes Lambda functions directly. Lambda handlers convert Gateway events to `MCPToolInvocation` format and call adapter `execute()` methods.

### File: `src/handlers/phase4/internal-adapter-handler.ts`

**Purpose:** Lambda handler for Internal adapter (called by Gateway)

**Implementation:**

```typescript
import { Handler, Context } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { InternalConnectorAdapter } from '../../../adapters/internal/InternalConnectorAdapter';
import { MCPToolInvocation, MCPResponse } from '../../../types/MCPTypes';
import { Logger } from '../../../services/core/Logger';

const logger = new Logger('InternalAdapterHandler');
// ✅ FIX: Use AWS SDK v3 constructor pattern (not .from({}))
const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const adapter = new InternalConnectorAdapter(dynamoClient, logger);

export const handler: Handler = async (event: any, context: Context): Promise<MCPResponse> => {
  // ✅ Extract MCP context from Lambda context (per article pattern)
  // Gateway injects MCP metadata into context.client_context.custom
  const customContext = context.client_context?.custom || {};
  const toolNameWithPrefix = customContext.bedrockAgentCoreToolName || '';
  const gatewayId = customContext.bedrockAgentCoreGatewayId || '';
  const targetId = customContext.bedrockAgentCoreTargetId || '';
  const mcpMessageId = customContext.bedrockAgentCoreMcpMessageId || '';
  
  // ✅ Extract actual tool name (remove target prefix, preserve namespace)
  // Format: target_name___tool_name (e.g., "internal-adapter___internal.create_note" or "internal-adapter___create_note")
  // Important: Tool name may already be namespaced (e.g., "internal.create_note") or not (e.g., "create_note")
  // Adapter expects namespaced format (e.g., "internal.create_note"), so preserve namespace if present
  const delimiter = '___';
  let toolName: string;
  if (toolNameWithPrefix.includes(delimiter)) {
    const suffix = toolNameWithPrefix.split(delimiter)[1];
    // If suffix already contains namespace (has '.'), use as-is
    // Otherwise, prefix with adapter namespace (e.g., "internal." for internal adapter)
    toolName = suffix.includes('.') ? suffix : `internal.${suffix}`;
  } else {
    // No prefix found, assume it's already the full tool name or add namespace
    toolName = toolNameWithPrefix.includes('.') ? toolNameWithPrefix : `internal.${toolNameWithPrefix}`;
  }
  
  // ✅ Convert Gateway Lambda event to MCPToolInvocation format
  // Event contains inputSchema data (e.g., { content: "...", tenant_id: "...", account_id: "..." })
  const invocation: MCPToolInvocation = {
    jsonrpc: '2.0',
    id: mcpMessageId || `gateway-${Date.now()}`,
    method: 'tools/call',
    params: {
      name: toolName, // e.g., "internal.create_note" (namespaced)
      arguments: event, // Event data matches inputSchema
    },
    // ✅ Extract identity context if available (for tenant binding validation)
    identity: customContext.bedrockAgentCoreIdentity ? {
      accessToken: customContext.bedrockAgentCoreIdentity.accessToken,
      tenantId: customContext.bedrockAgentCoreIdentity.tenantId,
      userId: customContext.bedrockAgentCoreIdentity.userId,
    } : undefined,
  };
  
  logger.info('Gateway Lambda invocation', {
    toolName,
    gatewayId,
    targetId,
    mcpMessageId,
    eventKeys: Object.keys(event),
  });
  
  // ✅ Call adapter execute() method
  return await adapter.execute(invocation);
};
```

### File: `src/handlers/phase4/crm-adapter-handler.ts`

**Purpose:** Lambda handler for CRM adapter (called by Gateway)

**Implementation:**

```typescript
import { Handler, Context } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { CrmConnectorAdapter } from '../../../adapters/crm/CrmConnectorAdapter';
import { MCPToolInvocation, MCPResponse } from '../../../types/MCPTypes';
import { Logger } from '../../../services/core/Logger';

const logger = new Logger('CrmAdapterHandler');
// ✅ FIX: Use AWS SDK v3 constructor pattern (not .from({}))
const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const secretsClient = new SecretsManagerClient({});
const dedupeTableName = process.env.EXTERNAL_WRITE_DEDUPE_TABLE_NAME!;
const configTableName = process.env.CONNECTOR_CONFIG_TABLE_NAME!;

const adapter = new CrmConnectorAdapter(
  dynamoClient,
  dedupeTableName,
  configTableName,
  secretsClient,
  logger
);

export const handler: Handler = async (event: any, context: Context): Promise<MCPResponse> => {
  // ✅ Extract MCP context from Lambda context (same pattern as internal adapter)
  const customContext = context.client_context?.custom || {};
  const toolNameWithPrefix = customContext.bedrockAgentCoreToolName || '';
  const mcpMessageId = customContext.bedrockAgentCoreMcpMessageId || '';
  
  // ✅ Extract actual tool name (remove target prefix, preserve namespace)
  // Format: target_name___tool_name (e.g., "crm-adapter___crm.create_task" or "crm-adapter___create_task")
  // Important: Tool name may already be namespaced (e.g., "crm.create_task") or not (e.g., "create_task")
  // Adapter expects namespaced format (e.g., "crm.create_task"), so preserve namespace if present
  const delimiter = '___';
  let toolName: string;
  if (toolNameWithPrefix.includes(delimiter)) {
    const suffix = toolNameWithPrefix.split(delimiter)[1];
    // If suffix already contains namespace (has '.'), use as-is
    // Otherwise, prefix with adapter namespace (e.g., "crm." for CRM adapter)
    toolName = suffix.includes('.') ? suffix : `crm.${suffix}`;
  } else {
    // No prefix found, assume it's already the full tool name or add namespace
    toolName = toolNameWithPrefix.includes('.') ? toolNameWithPrefix : `crm.${toolNameWithPrefix}`;
  }
  
  // ✅ Convert Gateway Lambda event to MCPToolInvocation format
  const invocation: MCPToolInvocation = {
    jsonrpc: '2.0',
    id: mcpMessageId || `gateway-${Date.now()}`,
    method: 'tools/call',
    params: {
      name: toolName, // e.g., "crm.create_task" (namespaced)
      arguments: event, // Event data matches inputSchema (includes tenant_id, account_id, etc.)
    },
    // ✅ Extract identity context (OAuth token for outbound calls, tenant binding validation)
    identity: customContext.bedrockAgentCoreIdentity ? {
      accessToken: customContext.bedrockAgentCoreIdentity.accessToken,
      tenantId: customContext.bedrockAgentCoreIdentity.tenantId,
      userId: customContext.bedrockAgentCoreIdentity.userId,
    } : undefined,
  };
  
  logger.info('Gateway Lambda invocation', {
    toolName,
    gatewayId: customContext.bedrockAgentCoreGatewayId,
    targetId: customContext.bedrockAgentCoreTargetId,
    mcpMessageId,
    hasIdentity: !!invocation.identity,
  });
  
  // ✅ Call adapter execute() method
  return await adapter.execute(invocation);
};
```

**Key Points:**
- Gateway injects MCP metadata into `context.client_context.custom`
- Tool name format: `target_name___tool_name` (e.g., `internal-adapter___internal.create_note`)
- **Important:** Tool name parsing preserves namespace (e.g., `internal.create_note` not just `create_note`)
  - If suffix already contains `.`, use as-is (already namespaced)
  - Otherwise, prefix with adapter namespace (e.g., `internal.` or `crm.`)
- Event data matches the `inputSchema` defined in Gateway target configuration
- Adapters receive `MCPToolInvocation` format (consistent interface)
- Lambda handlers are thin wrappers that convert Gateway events → adapter interface

---

## 5. AgentCore Gateway Setup

### File: `src/stacks/constructs/ExecutionInfrastructure.ts` (Phase 4.3 Additions)

**Purpose:** Add AgentCore Gateway configuration (fully automated via CDK)

**Approach:** Use CDK L1 constructs (`bedrockagentcore.CfnGateway` and `bedrockagentcore.CfnGatewayTarget`) to automate Gateway creation and target registration. No manual setup required.

**Phase 4.3 Additions:**

```typescript
// ✅ Imports at module top (not inside methods)
import * as bedrockagentcore from 'aws-cdk-lib/aws-bedrockagentcore';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as cdk from 'aws-cdk-lib';

// ✅ MCP Version: Define as class-level constant for reuse
// Verify supported MCP versions in your account/region and pin one for stability
// Check AWS documentation for current supported versions
const MCP_SUPPORTED_VERSION = '2025-03-26'; // TODO: Verify this version is supported in your region

// Add to ExecutionInfrastructureProps (already exists)
export interface ExecutionInfrastructureProps {
  // ... existing props ...
  readonly userPool?: cognito.IUserPool; // For JWT auth (already exists)
  // ✅ NOTE: gatewayUrl is currently in props (Phase 4.2), but will be removed in Phase 4.3
  // After Gateway is created in Phase 4.3, use executionGateway.attrGatewayUrl instead
  // readonly gatewayUrl?: string; // Remove this after Phase 4.3 Gateway setup
}

// Add to ExecutionInfrastructure class
// ✅ Use L1 CDK construct type (not AwsCustomResource)
public readonly executionGateway: bedrockagentcore.CfnGateway;
public readonly gatewayUrl: string; // Output: Gateway URL for ToolMapper handler

/**
 * Create AgentCore Gateway (automated via CDK)
 * 
 * Uses L1 CDK constructs (`bedrockagentcore.CfnGateway`) for native CloudFormation integration.
 * This approach is consistent with AWS official samples and production deployments.
 */
private createAgentCoreGateway(props: ExecutionInfrastructureProps): void {
  // Create IAM role for Gateway
  // ✅ Service principal: bedrock-agentcore.amazonaws.com (matches AWS samples and article patterns)
  const gatewayRole = new iam.Role(this, 'ExecutionGatewayRole', {
    assumedBy: new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com'),
    description: 'Execution role for AgentCore Gateway',
  });

  // ✅ Gateway Role IAM Policy: Grant permissions for Gateway operations
  // ✅ ZERO TRUST: Restrict to specific adapter Lambda ARNs (known at deploy time)
  // Note: Adapter Lambdas will be created before Gateway, so we can reference them directly
  // Store Lambda function references as class properties for ARN access
  // 
  // This policy will be updated after adapter Lambdas are created (see createAdapterLambdas method)
  // For now, define the policy structure - actual ARNs will be added when Lambdas exist
  // 
  // Pattern: Create adapter Lambdas first, then add their ARNs to Gateway role policy
  // Example implementation:
  // const gatewayInvokePolicy = new iam.PolicyStatement({
  //   sid: 'GatewayInvokeLambda',
  //   effect: iam.Effect.ALLOW,
  //   actions: ['lambda:InvokeFunction'],
  //   resources: [
  //     internalAdapterLambda.functionArn,
  //     crmAdapterLambda.functionArn,
  //   ],
  // });
  // gatewayRole.addToPolicy(gatewayInvokePolicy);

  // ✅ Optional: If Gateway needs to call Bedrock models directly
  // gatewayRole.addToPolicy(new iam.PolicyStatement({
  //   sid: 'GatewayInvokeBedrock',
  //   effect: iam.Effect.ALLOW,
  //   actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
  //   resources: ['arn:aws:bedrock:*::foundation-model/*'],
  // }));

  // ✅ UPDATED: Use L1 CDK constructs (consistent with AWS samples)
  // 
  // **Why L1 CDK Constructs (`bedrockagentcore.CfnGateway`)?**
  // 
  // 1. **AWS Samples Use This Approach**
  //    - Official AWS samples (`amazon-bedrock-agentcore-samples/05-blueprints/*/infrastructure/agent-stack/lib/constructs/gateway-construct.ts`)
  //      use `bedrockagentcore.CfnGateway` and `bedrockagentcore.CfnGatewayTarget`
  //    - This proves the CloudFormation resource type (`AWS::BedrockAgentCore::Gateway`) is available
  //    - CDK L1 constructs are the recommended approach for AgentCore Gateway
  // 
  // 2. **Native CloudFormation Integration**
  //    - L1 constructs map directly to CloudFormation resource types
  //    - No Lambda overhead (unlike AwsCustomResource)
  //    - Better integration with CDK's dependency management and outputs
  // 
  // 3. **Type Safety & IntelliSense**
  //    - CDK L1 constructs provide TypeScript types for properties
  //    - Better IDE support and compile-time validation
  //    - Easier to discover available properties and their types
  // 
  // 4. **Consistency with AWS Patterns**
  //    - Matches the approach used in official AWS blueprints
  //    - Easier for other developers familiar with AWS samples
  //    - Follows AWS best practices for CDK infrastructure
  
  // ✅ Use L1 CDK constructs (matching AWS samples)
  // Note: Import should be at module top in actual implementation:
  // import * as bedrockagentcore from 'aws-cdk-lib/aws-bedrockagentcore';
  
  // ✅ MCP Version: Use class-level constant (defined at module top)
  
  // ✅ KMS encryption: Gateways require encryption (AWS-managed or customer-managed KMS key)
  // Per article: Gateways encrypt configuration data, runtime data, and identity/auth data
  // For Phase 4.3, use AWS-managed key (default). For production, consider customer-managed key.
  // const kmsKey = new kms.Key(this, 'GatewayKmsKey', {
  //   description: 'KMS key for AgentCore Gateway encryption',
  //   enableKeyRotation: true,
  // });
  
  this.executionGateway = new bedrockagentcore.CfnGateway(this, 'ExecutionGateway', {
    name: 'cc-native-execution-gateway',
    roleArn: gatewayRole.roleArn,
    protocolType: 'MCP',
    protocolConfiguration: {
      mcp: {
        supportedVersions: [MCP_SUPPORTED_VERSION],
        // ✅ Optional: Enable search functionality (per article)
        // searchEnabled: true, // Enables x_amz_bedrock_agentcore_search tool for natural language tool discovery
      }
    },
    authorizerType: 'CUSTOM_JWT',
    authorizerConfiguration: {
      customJwtAuthorizer: {
        allowedClients: props.userPool ? [props.userPool.userPoolClientId] : [],
        discoveryUrl: props.userPool?.userPoolProviderUrl || '',
      },
    },
    // ✅ Optional: Exception level for debugging (per article)
    // exceptionLevel: 'DEBUG', // Options: 'INFO', 'DEBUG', 'WARN', 'ERROR'
    // ✅ Optional: Customer-managed KMS key (for production compliance)
    // kmsKeyArn: kmsKey.keyArn,
    description: 'AgentCore Gateway for cc-native execution layer with MCP protocol and JWT inbound auth'
  });

  // Get Gateway attributes (matching AWS samples pattern)
  this.gatewayArn = this.executionGateway.attrGatewayArn;
  this.gatewayId = this.executionGateway.attrGatewayIdentifier;
  this.gatewayUrl = this.executionGateway.attrGatewayUrl;

  // ✅ Error Handling: Validate Gateway creation prerequisites before deployment
  // Add explicit validation in CDK synthesis phase to fail fast with clear error messages:
  if (!props.userPool) {
    throw new Error(
      'Cognito User Pool is required for Gateway CUSTOM_JWT authorizer. ' +
      'Provide userPool in ExecutionInfrastructureProps or use AWS_IAM authorizer instead.'
    );
  }
  
  if (!props.userPool.userPoolClientId) {
    throw new Error(
      'Cognito User Pool Client ID is required for Gateway CUSTOM_JWT authorizer. ' +
      'Ensure userPool has at least one app client configured.'
    );
  }
  
  // ✅ Error Handling: Gateway creation failure scenarios
  // CDK L1 constructs automatically handle CloudFormation errors, but common failure scenarios include:
  // 
  // 1. **IAM Role Permissions Insufficient**
  //    - Gateway role lacks bedrock-agentcore:CreateGateway permission
  //    - Gateway role lacks bedrock:InvokeModel permission (if Gateway needs to call Bedrock)
  //    - Error: "AccessDenied" or "UnauthorizedOperation"
  //    - Fix: Ensure gatewayRole has required IAM policies attached
  // 
  // 2. **KMS Key Access Denied**
  //    - If using customer-managed KMS key, Gateway role needs kms:Decrypt, kms:DescribeKey
  //    - Error: "AccessDeniedException" from KMS
  //    - Fix: Add KMS permissions to gatewayRole
  // 
  // 3. **Invalid Authorizer Configuration**
  //    - Invalid Cognito discovery URL format
  //    - Cognito User Pool doesn't exist or wrong region
  //    - Invalid client ID (not found in User Pool)
  //    - Error: "InvalidParameterException" or "ResourceNotFoundException"
  //    - Fix: Validate userPool and userPoolClientId before Gateway creation
  // 
  // 4. **Unsupported MCP Version**
  //    - MCP version not available in target region
  //    - Error: "InvalidParameterException" with message about unsupported version
  //    - Fix: Verify MCP_SUPPORTED_VERSION is available in your region (check AWS docs)
  // 
  // 5. **Service Quota Limits**
  //    - Too many Gateways in account/region (default limit may apply)
  //    - Error: "LimitExceededException"
  //    - Fix: Request quota increase or delete unused Gateways
  // 
  // 6. **Gateway Name Conflicts**
  //    - Gateway name already exists (if names must be unique)
  //    - Error: "ConflictException" or "ResourceAlreadyExistsException"
  //    - Fix: Use unique Gateway name or delete existing Gateway
  // 
  // CloudFormation will surface these errors during stack deployment with detailed error messages.
  // For programmatic error handling post-deployment, use Gateway status polling (see Section 14).
}

/**
 * Register Lambda adapter as Gateway target (automated via CDK)
 * 
 * @param adapterLambda - Lambda function for the adapter
 * @param toolName - Full tool name (e.g., "internal.create_note" or "crm.create_task")
 * @param toolSchema - Single tool definition object with structure:
 *   {
 *     name: string,              // Tool name (e.g., "create_note")
 *     description: string,        // Tool description
 *     inputSchema: {              // JSON Schema for input parameters
 *       type: "object",
 *       properties: { ... },
 *       required: [ ... ]
 *     },
 *     outputSchema?: { ... }     // Optional JSON Schema for output
 *   }
 */
private registerGatewayTarget(
  adapterLambda: lambda.Function,
  toolName: string,
  toolSchema: {
    name: string;
    description: string;
    inputSchema: Record<string, any>;
    outputSchema?: Record<string, any>;
  }
): void {
  // ✅ Validate tool schema structure before passing to Gateway
  if (!toolSchema.name || !toolSchema.description || !toolSchema.inputSchema) {
    throw new Error(
      `Invalid tool schema for ${toolName}: must include name, description, and inputSchema. ` +
      `Received: ${JSON.stringify(Object.keys(toolSchema))}`
    );
  }

  // ✅ UPDATED: Use L1 CDK construct (consistent with AWS samples)
  // Get Gateway ID from L1 construct
  const gatewayId = (this.executionGateway as bedrockagentcore.CfnGateway).attrGatewayIdentifier;

  // Create Gateway Target using L1 construct (matching AWS samples pattern)
  // Note: Based on AWS samples, Lambda targets use targetConfiguration.mcp.lambda structure
  // ✅ inlinePayload expects an ARRAY of tool definitions (per AWS samples)
  // Even though we're registering one tool per target, wrap in array
  const gatewayTarget = new bedrockagentcore.CfnGatewayTarget(this, `GatewayTarget-${toolName}`, {
    gatewayIdentifier: gatewayId,
    name: toolName.toLowerCase().replace(/[^a-z0-9-]/g, '-'), // Sanitize tool name for Gateway
    description: `Gateway target for ${toolName}`,
    targetConfiguration: {
      mcp: {
        lambda: {
          lambdaArn: adapterLambda.functionArn,
          toolSchema: {
            inlinePayload: [toolSchema], // ✅ Array of tool definitions (required by Gateway)
          },
        },
      },
    },
  });

  // Ensure target is created after gateway
  gatewayTarget.addDependency(this.executionGateway);

  // Grant Lambda invoke permission to Gateway
  adapterLambda.addPermission('AllowGatewayInvoke', {
    principal: new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com'),
    sourceArn: (this.executionGateway as bedrockagentcore.CfnGateway).attrGatewayArn,
  });

  // ✅ ZERO TRUST: Update Gateway role policy to include this adapter's ARN
  // Add adapter Lambda ARN to Gateway role's invoke policy (scoped permissions)
  // This ensures Gateway can only invoke known adapter Lambdas, not arbitrary functions
  // Implementation: Store adapter Lambda ARNs and add them to Gateway role policy after all adapters are created
  // Example:
  // gatewayRole.addToPolicy(new iam.PolicyStatement({
  //   sid: 'GatewayInvokeLambda',
  //   effect: iam.Effect.ALLOW,
  //   actions: ['lambda:InvokeFunction'],
  //   resources: [
  //     internalAdapterLambda.functionArn,
  //     crmAdapterLambda.functionArn,
  //     // Add more adapter ARNs as they are registered
  //   ],
  // }));

  // ✅ Error Handling: Gateway target registration failures
  // Common failure scenarios:
  // 
  // 1. **Invalid Lambda ARN**
  //    - Lambda function doesn't exist or wrong region
  //    - Lambda ARN format is invalid
  //    - Error: "ResourceNotFoundException" or "InvalidParameterException"
  //    - Fix: Ensure adapterLambda.functionArn is valid and function exists
  // 
  // 2. **Invalid Tool Schema Format**
  //    - Tool schema doesn't match required structure (missing name, invalid inputSchema, etc.)
  //    - Error: "InvalidParameterException" with schema validation details
  //    - Fix: Validate toolSchema structure matches Gateway requirements
  // 
  // 3. **Gateway Not in READY State**
  //    - Gateway is still CREATING or in FAILED state
  //    - Error: "InvalidStateException" or "ResourceNotFoundException"
  //    - Fix: Ensure Gateway is READY before creating targets (addDependency handles this)
  // 
  // 4. **IAM Permissions Insufficient**
  //    - Gateway role lacks lambda:InvokeFunction permission for target Lambda
  //    - Error: "AccessDeniedException" when Gateway tries to invoke Lambda
  //    - Fix: Ensure gatewayRole has lambda:InvokeFunction permission (should be in gatewayRole policy)
  // 
  // 5. **Target Name Conflicts**
  //    - Target name already exists in Gateway (if names must be unique)
  //    - Error: "ConflictException" or "ResourceAlreadyExistsException"
  //    - Fix: Use unique target names or delete existing target
  // 
  // CloudFormation will surface these errors during stack deployment.
  // addDependency() ensures target is created after gateway (handles #3).
  // Validate toolSchema structure before passing to registerGatewayTarget().
}
```

**Usage in Constructor:**

```typescript
constructor(scope: Construct, id: string, props: ExecutionInfrastructureProps) {
  // ... existing code ...

  // Phase 4.3: Create Gateway (automated)
  this.createAgentCoreGateway(props);
  
  // Update ToolMapper handler to use Gateway URL from construct
  // Instead of props.gatewayUrl, use this.gatewayUrl
  // ... update createToolMapperHandler to use this.gatewayUrl ...
  
  // Phase 4.3: Register adapter Lambdas as Gateway targets
  // Example: Construct tool schema from ActionTypeRegistry or define inline
  // const internalNoteToolSchema = {
  //   name: 'create_note',
  //   description: 'Create an internal note in the system',
  //   inputSchema: {
  //     type: 'object',
  //     properties: {
  //       content: { type: 'string', description: 'Note content' },
  //       tenant_id: { type: 'string' },
  //       account_id: { type: 'string' },
  //     },
  //     required: ['content', 'tenant_id', 'account_id'],
  //   },
  // };
  // this.registerGatewayTarget(internalAdapterLambda, 'internal.create_note', internalNoteToolSchema);
  // 
  // const crmTaskToolSchema = {
  //   name: 'create_task',
  //   description: 'Create a task in CRM system',
  //   inputSchema: {
  //     type: 'object',
  //     properties: {
  //       title: { type: 'string', description: 'Task title' },
  //       tenant_id: { type: 'string' },
  //       account_id: { type: 'string' },
  //       idempotency_key: { type: 'string' },
  //       action_intent_id: { type: 'string' },
  //     },
  //     required: ['title', 'tenant_id', 'account_id', 'idempotency_key', 'action_intent_id'],
  //   },
  // };
  // this.registerGatewayTarget(crmAdapterLambda, 'crm.create_task', crmTaskToolSchema);
}
```

**Note:** Gateway creation and target registration are fully automated via CDK. No manual setup required.

**Approach:** Uses L1 CDK constructs (`bedrockagentcore.CfnGateway` and `bedrockagentcore.CfnGatewayTarget`) as the canonical approach, consistent with AWS official samples (`amazon-bedrock-agentcore-samples/05-blueprints/*/infrastructure/agent-stack/lib/constructs/gateway-construct.ts`).

**Benefits:**
- Native CloudFormation integration (no Lambda overhead)
- Type safety and IntelliSense support
- Consistent with AWS best practices and official samples
- Better dependency management and outputs

---

## 6. ActionTypeRegistry Seed Data

### File: `src/scripts/seed-action-type-registry.ts`

**Purpose:** Seed initial ActionTypeRegistry entries using TypeScript service

**Note:** Use `ActionTypeRegistryService.registerMapping()` method instead of raw DynamoDB commands to ensure:
- Correct key structure (`sk: "REGISTRY_VERSION#1"` not `"VERSION#v1.0"`)
- Auto-incremented `registry_version` (numeric, not string)
- Consistency with actual service implementation

**Script:**

```typescript
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { ActionTypeRegistryService } from '../services/execution/ActionTypeRegistryService';
import { Logger } from '../services/core/Logger';
import { getAWSClientConfig } from '../utils/aws-client-config';

const logger = new Logger('SeedActionTypeRegistry');
const region = process.env.AWS_REGION || 'us-west-2';
const clientConfig = getAWSClientConfig(region);
const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient(clientConfig), {
  marshallOptions: { removeUndefinedValues: true },
});

const service = new ActionTypeRegistryService(
  dynamoClient,
  process.env.ACTION_TYPE_REGISTRY_TABLE_NAME || 'cc-native-action-type-registry',
  logger
);

async function seed() {
  // CREATE_CRM_TASK → crm.create_task
  await service.registerMapping({
    action_type: 'CREATE_CRM_TASK',
    tool_name: 'crm.create_task',
    tool_schema_version: 'v1.0',
    required_scopes: ['salesforce_api'],
    risk_class: 'LOW',
    compensation_strategy: 'MANUAL_ONLY', // ✅ MUST-FIX: Set to MANUAL_ONLY until rollback implemented
    parameter_mapping: {
      title: {
        toolParam: 'title',
        transform: 'PASSTHROUGH',
        required: true,
      },
      priority: {
        toolParam: 'priority',
        transform: 'UPPERCASE',
        required: false,
      },
    },
  });

  // CREATE_INTERNAL_NOTE → internal.create_note
  await service.registerMapping({
    action_type: 'CREATE_INTERNAL_NOTE',
    tool_name: 'internal.create_note',
    tool_schema_version: 'v1.0',
    required_scopes: [],
    risk_class: 'MINIMAL',
    compensation_strategy: 'AUTOMATIC',
    parameter_mapping: {
      content: {
        toolParam: 'content',
        transform: 'PASSTHROUGH',
        required: true,
      },
    },
  });

  logger.info('ActionTypeRegistry seeded successfully');
}

seed().catch((error) => {
  logger.error('Failed to seed ActionTypeRegistry', { error });
  process.exit(1);
});
```

**Usage:**
```bash
# Set environment variables
export AWS_REGION=us-west-2
export ACTION_TYPE_REGISTRY_TABLE_NAME=cc-native-action-type-registry

# Run seed script
npx ts-node src/scripts/seed-action-type-registry.ts
```

---

## 7. Gateway Target Registration

**Status:** ✅ **AUTOMATED** - Handled in `registerGatewayTarget()` method above

**Note:** Gateway target registration is now fully automated via CDK L1 constructs (`bedrockagentcore.CfnGatewayTarget`). The `registerGatewayTarget()` method in Section 5 handles this automatically when adapter Lambdas are created.

**No manual scripts needed** - target registration happens during CDK deployment.

---

## 8. IdempotencyService Enhancement

### Phase 4.3 Enhancement: Return `external_object_refs[]` Array

**Purpose:** Align `IdempotencyService` with Phase 4.2 contract by returning/accepting `external_object_refs[]` arrays instead of single `external_object_id` strings.

**Current State (Phase 4.2):**
- `ExternalWriteDedupe` interface uses `external_object_id: string` (single ID)
- `IdempotencyService.checkExternalWriteDedupe()` returns `string | null`
- `IdempotencyService.recordExternalWriteDedupe()` accepts `externalObjectId: string`
- `ActionOutcomeV1.external_object_refs` already uses array format (defined inline in `ExecutionTypes.ts`)

**Required Changes:**

1. **Extract `ExternalObjectRef` type** (`src/types/ExecutionTypes.ts`):
   ```typescript
   // ✅ Extract shared type from ActionOutcomeV1.external_object_refs
   export interface ExternalObjectRef {
     system: 'CRM' | 'CALENDAR' | 'INTERNAL';
     object_type: string; // e.g., "Task", "Event", "Note"
     object_id: string; // External system ID
     object_url?: string; // Link to external object (if available)
   }
   ```
   **Note:** This type structure already exists inline in `ActionOutcomeV1.external_object_refs` (line 83-88 in `ExecutionTypes.ts`). Extract it to a shared type for reuse.

2. **Update `ExternalWriteDedupe` type** (`src/types/ExecutionTypes.ts`):
   ```typescript
   export interface ExternalWriteDedupe {
     // ... existing fields ...
     // ✅ ENHANCED: Store full external_object_refs array instead of single string
     external_object_refs: ExternalObjectRef[]; // Replaces: external_object_id: string;
     // ... rest of fields ...
   }
   ```
   **Note:** This is a breaking change. Existing items in DynamoDB will need migration (see Migration section below).

2. **Update `checkExternalWriteDedupe()` method** (`src/services/execution/IdempotencyService.ts`):
   ```typescript
   async checkExternalWriteDedupe(
     dynamoClient: DynamoDBDocumentClient,
     tableName: string,
     idempotencyKey: string
   ): Promise<ExternalObjectRef[] | null> { // ✅ Returns array instead of string | null
     // ... implementation fetches external_object_refs from ExternalWriteDedupe item ...
     return item.external_object_refs || null;
   }
   ```

3. **Update `recordExternalWriteDedupe()` method** (`src/services/execution/IdempotencyService.ts`):
   ```typescript
   async recordExternalWriteDedupe(
     dynamoClient: DynamoDBDocumentClient,
     tableName: string,
     idempotencyKey: string,
     externalObjectRefs: ExternalObjectRef[], // ✅ Accepts array instead of string
     actionIntentId: string,
     toolName: string
   ): Promise<void> {
     // ... implementation stores external_object_refs array ...
   }
   ```

4. **Update collision detection logic:**
   - Compare arrays (deep equality) instead of single strings
   - Handle cases where arrays have same objects but different order (normalize before comparison)

**Benefits:**
- ✅ Matches Phase 4.2 contract (`external_object_refs[]` is the stable format)
- ✅ Avoids reconstruction of arrays from single object IDs
- ✅ Preserves full object reference information (system, object_type, object_id, object_url)
- ✅ Enables future enhancements (multiple objects per write, relationships, etc.)

**Migration Strategy:**
- **Option A (Recommended):** Clean migration - all existing items are TTL'd (7 days), so wait for natural expiration
- **Option B:** Write migration script to convert `external_object_id` → `external_object_refs[]` for existing items
- **Option C:** Backwards compatibility - `checkExternalWriteDedupe()` handles both formats during transition:
  ```typescript
  // Handle both old format (external_object_id) and new format (external_object_refs)
  if (item.external_object_refs) {
    return item.external_object_refs; // New format
  } else if (item.external_object_id) {
    // Convert old format to new format (best-effort reconstruction)
    return [{
      system: 'CRM', // Default - may not be accurate for all old records
      object_type: 'Unknown', // Lost information
      object_id: item.external_object_id,
    }];
  }
  return null;
  ```
- New writes use `external_object_refs[]` array exclusively

---

## 9. Testing

### Integration Tests

**Files to Create:**
- `src/tests/integration/execution/connector-adapters.test.ts` - Adapter execution flow
- `src/tests/integration/execution/gateway-integration.test.ts` - Gateway → Adapter flow

---

## 10. Security & Zero Trust Controls

### A. Per-Tool Egress Control (VPC Isolation)

**Purpose:** Adapters are the only components touching public internet (SaaS APIs). Isolate them in dedicated VPC with egress controls.

**Phase 4.3 Requirement:** Connectors VPC is **required** for Phase 4.3 (not optional). This is the Phase A baseline for "many tools hitting internet" with proper egress governance.

**Implementation:**
- Create "Connectors VPC" with **explicit public and private subnets**
- VPC endpoints for AWS services (DynamoDB Gateway, S3 Gateway, Secrets Manager Interface, KMS Interface, CloudWatch Logs Interface, STS Interface)
- NAT Gateway for outbound internet access (requires public subnets)
- Per-connector security groups with explicit egress control
- VPC Flow Logs for audit

**CDK Pattern:**
```typescript
// In ExecutionInfrastructure or separate ConnectorInfrastructure construct
// ✅ REQUIRED: Explicit PUBLIC and PRIVATE subnets (NAT Gateway needs public subnets)
const connectorsVpc = new ec2.Vpc(this, 'ConnectorsVpc', {
  maxAzs: 2,
  natGateways: 1,
  subnetConfiguration: [
    {
      cidrMask: 24,
      name: 'ConnectorPublic',
      subnetType: ec2.SubnetType.PUBLIC, // Required for NAT Gateway
    },
    {
      cidrMask: 24,
      name: 'ConnectorPrivate',
      subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, // Lambdas go here
    },
  ],
});

// VPC endpoints for AWS services
// ✅ MUST-FIX: DynamoDB uses Gateway endpoint (not Interface endpoint)
new ec2.GatewayVpcEndpoint(this, 'DynamoDBEndpoint', {
  vpc: connectorsVpc,
  service: ec2.GatewayVpcEndpointAwsService.DYNAMODB,
});

// S3 also uses Gateway endpoint
new ec2.GatewayVpcEndpoint(this, 'S3Endpoint', {
  vpc: connectorsVpc,
  service: ec2.GatewayVpcEndpointAwsService.S3,
});

// Interface endpoints for other services (Secrets Manager, KMS, CloudWatch Logs, STS)
// ✅ REQUIRED: CloudWatch Logs endpoint (Lambdas in VPC need this for logging)
new ec2.InterfaceVpcEndpoint(this, 'CloudWatchLogsEndpoint', {
  vpc: connectorsVpc,
  service: ec2.InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS,
});

// ✅ REQUIRED: STS endpoint (if using assumed roles or temporary credentials)
new ec2.InterfaceVpcEndpoint(this, 'STSEndpoint', {
  vpc: connectorsVpc,
  service: ec2.InterfaceVpcEndpointAwsService.STS,
});

new ec2.InterfaceVpcEndpoint(this, 'SecretsManagerEndpoint', {
  vpc: connectorsVpc,
  service: ec2.InterfaceVpcEndpointAwsService.SECRETS_MANAGER,
});

new ec2.InterfaceVpcEndpoint(this, 'KMSEndpoint', {
  vpc: connectorsVpc,
  service: ec2.InterfaceVpcEndpointAwsService.KMS,
});

// Security group per connector
const crmAdapterSecurityGroup = new ec2.SecurityGroup(this, 'CrmAdapterSecurityGroup', {
  vpc: connectorsVpc,
  description: 'Security group for CRM adapter',
  allowAllOutbound: false, // Explicit egress control
});

// ✅ Attach adapter Lambdas to VPC
// In createInternalAdapterHandler() and createCrmAdapterHandler():
const internalAdapterLambda = new lambdaNodejs.NodejsFunction(this, 'InternalAdapterHandler', {
  // ... other config ...
  vpc: connectorsVpc,
  vpcSubnets: {
    subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, // Use private subnets
  },
  securityGroups: [internalAdapterSecurityGroup],
  // Note: VPC endpoints handle AWS service calls (no internet needed for DynamoDB, Secrets, etc.)
  // NAT Gateway handles outbound internet for SaaS API calls
});

const crmAdapterLambda = new lambdaNodejs.NodejsFunction(this, 'CrmAdapterHandler', {
  // ... other config ...
  vpc: connectorsVpc,
  vpcSubnets: {
    subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, // Use private subnets
  },
  securityGroups: [crmAdapterSecurityGroup],
});
```

**Note:** See `PHASE_4_ARCHITECTURE.md` for phased VPC strategy. Phase 4.3 implements **Phase A baseline** (Connectors VPC with private subnets, NAT Gateway, VPC endpoints). Phase C (isolated VPC for high-risk connectors) is future work.

### B. Per-Tool IAM Role + Least Privilege

**Purpose:** Each adapter Lambda should have minimal permissions - only what it needs.

**Implementation:**
- Separate IAM role per adapter
- Grant only required DynamoDB tables (dedupe + internal tables)
- No cross-connector permissions
- KMS decrypt only for connector-specific secrets
- No ability to invoke other Lambdas (unless explicitly needed)

**CDK Pattern:**
```typescript
const crmAdapterRole = new iam.Role(this, 'CrmAdapterRole', {
  assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
});

// Grant only required tables
this.externalWriteDedupeTable.grantReadWriteData(crmAdapterRole);
// Do NOT grant access to other connector tables

// Grant Secrets Manager access (connector-specific secret)
crmAdapterRole.addToPolicy(new iam.PolicyStatement({
  actions: ['secretsmanager:GetSecretValue'],
  resources: [`arn:aws:secretsmanager:*:*:secret:tenant/*/connector/salesforce-*`],
}));
```

### C. Tenant Binding Enforcement

**Purpose:** Prevent cross-tenant calls even if tool is invoked incorrectly.

**Implementation:**
- Validate `tenant_id` and `account_id` are present in tool arguments
- Validate `tenant_id` matches identity context (if identity carries tenant claims)
- Fail fast with `ValidationError` if mismatch

**Adapter Pattern:**
```typescript
// In adapter execute() method
if (!args.tenant_id || !args.account_id) {
  throw new ValidationError('Missing required parameters: tenant_id and account_id');
}

// Validate tenant binding
if (invocation.identity?.tenantId && invocation.identity.tenantId !== args.tenant_id) {
  throw new ValidationError(`Tenant mismatch: identity tenant_id does not match tool argument tenant_id`);
}
```

---

## 11. Connector Configuration Service

### File: `src/services/execution/ConnectorConfigService.ts` (New)

**Purpose:** Retrieve tenant-scoped connector configuration (instance URLs, API endpoints, etc.)

**Implementation:**

```typescript
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { Logger } from '../core/Logger';

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
```

**Usage in Adapter:**
```typescript
const configService = new ConnectorConfigService(...);
const config = await configService.getConnectorConfig(tenantId, accountId, 'salesforce');
const instanceUrl = config?.instanceUrl;
if (!instanceUrl) {
  throw new ConfigurationError('Salesforce instance URL not configured for tenant');
}
```

---

## 12. Implementation Checklist

**Prerequisites (Phase 4.1/4.2 - Already Complete):**
- [x] `ExecutionInfrastructure.ts` with DynamoDB tables, Lambda handlers, Step Functions
- [x] `MCPTypes.ts` with `MCPToolInvocation` and `MCPResponse` interfaces
- [x] `ActionOutcomeV1.external_object_refs` array type (inline definition in `ExecutionTypes.ts`)
- [x] `tool-mapper-handler.ts` passes `action_intent_id` in tool arguments

**Phase 4.3 Implementation Tasks:**
- [ ] **Extract `ExternalObjectRef` type** (`src/types/ExecutionTypes.ts`):
  - [ ] Extract shared type from `ActionOutcomeV1.external_object_refs` inline definition
  - [ ] Update `ActionOutcomeV1` to use extracted type
  - [ ] Update `ToolInvocationResponse` to use extracted type
- [ ] **Enhance `IdempotencyService`** (Phase 4.3):
  - [ ] Update `ExternalWriteDedupe` type to use `external_object_refs: ExternalObjectRef[]` instead of `external_object_id: string`
  - [ ] Update `checkExternalWriteDedupe()` to return `ExternalObjectRef[] | null`
  - [ ] Update `recordExternalWriteDedupe()` to accept `externalObjectRefs: ExternalObjectRef[]` parameter
  - [ ] Update collision detection to compare arrays (deep equality)
  - [ ] Add backwards compatibility for existing `external_object_id` items (optional, see Migration section)
  - [ ] Update unit tests to reflect new signatures
- [ ] Create `src/adapters/IConnectorAdapter.ts`
- [ ] Create `src/adapters/internal/InternalConnectorAdapter.ts` (with persistence implementation, using `ValidationError`)
- [ ] Create `src/adapters/crm/CrmConnectorAdapter.ts` (with tenant-scoped config, validation, OAuth token handling)
- [ ] Create `src/handlers/phase4/internal-adapter-handler.ts` (Lambda handler that converts Gateway events to MCPToolInvocation)
- [ ] Create `src/handlers/phase4/crm-adapter-handler.ts` (Lambda handler that converts Gateway events to MCPToolInvocation)
- [ ] Create `src/services/execution/ConnectorConfigService.ts` (tenant-scoped config retrieval, account-specific secrets only)
- [ ] **Add Gateway setup to `ExecutionInfrastructure.ts`**:
  - [ ] Add `executionGateway: bedrockagentcore.CfnGateway` property
  - [ ] Add `gatewayUrl: string` property (output)
  - [ ] Implement `createAgentCoreGateway()` method (L1 CDK construct)
  - [ ] Add Gateway IAM role with `lambda:InvokeFunction` permissions
  - [ ] Add error handling for Gateway creation failures (validate prerequisites, handle CloudFormation errors)
  - [ ] Add CloudWatch metrics and alarms for Gateway health monitoring
- [ ] **Create Lambda functions for adapters** (in `ExecutionInfrastructure.ts`):
  - [ ] Create `internalAdapterHandler` Lambda function
  - [ ] Create `crmAdapterHandler` Lambda function
  - [ ] **Attach Lambdas to Connectors VPC**:
    - [ ] Set `vpc: connectorsVpc`
    - [ ] Set `vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }`
    - [ ] Set `securityGroups: [perConnectorSecurityGroup]`
  - [ ] Configure per-connector IAM roles (least privilege)
  - [ ] Grant DynamoDB, Secrets Manager permissions as needed
- [ ] **Register adapters as Gateway targets** (in `ExecutionInfrastructure.ts`):
  - [ ] Implement `registerGatewayTarget()` method (L1 CDK construct)
  - [ ] Register internal adapter as Gateway target
  - [ ] Register CRM adapter as Gateway target
  - [ ] Add error handling for target registration failures (validate Lambda ARN, schema format)
- [ ] **Update `ExecutionInfrastructureProps`**:
  - [ ] Ensure `userPool?: cognito.IUserPool` is available (for Gateway JWT auth)
  - [ ] Remove `gatewayUrl?: string` from props (now generated from Gateway)
- [ ] **Update `tool-mapper-handler.ts`**:
  - [ ] Use `executionGateway.attrGatewayUrl` instead of `props.gatewayUrl`
- [ ] Seed initial ActionTypeRegistry entries using TypeScript service (with MANUAL_ONLY compensation)
- [ ] **Set up Connectors VPC (REQUIRED for Phase 4.3)**:
  - [ ] Create VPC with explicit PUBLIC and PRIVATE_WITH_EGRESS subnets
  - [ ] Create NAT Gateway (requires public subnets)
  - [ ] Create VPC endpoints (DynamoDB Gateway, S3 Gateway, Secrets Manager Interface, KMS Interface, CloudWatch Logs Interface, STS Interface)
  - [ ] Create per-connector security groups with `allowAllOutbound: false`
  - [ ] Attach adapter Lambdas to VPC with `vpcSubnets: PRIVATE_WITH_EGRESS` and per-connector security groups
  - [ ] Enable VPC Flow Logs for audit
- [ ] Configure per-connector IAM roles (least privilege)

**Must-Fix Validation Checklist:**
- [ ] ✅ Validate `idempotency_key` presence in adapter (fail fast if missing)
- [ ] ✅ Validate `action_intent_id` presence in adapter (fail fast if missing)
- [ ] ✅ Validate `tenant_id` and `account_id` presence (security: tenant binding)
- [ ] ✅ Validate tenant binding (identity.tenantId matches args.tenant_id)
- [ ] ✅ Get Salesforce instance URL from tenant-scoped config (NOT hardcoded)
- [ ] ✅ Handle Salesforce response shape correctly (Id vs id)
- [ ] ✅ Implement internal adapter persistence before returning success
- [ ] ✅ Set CRM compensation strategy to MANUAL_ONLY (until rollback implemented)
- [ ] ✅ Use single deterministic Gateway setup approach (CDK L1 constructs - `bedrockagentcore.CfnGateway`)

---

## 13. Critical Must-Fix Issues (Review Feedback)

**These issues must be fixed before Phase 4.3 implementation:**

1. ✅ **CRM adapter Salesforce response handling** - Handle both `Id` and `id` fields, validate presence
2. ✅ **Hardcoded Salesforce instance URL** - Use tenant-scoped connector config (NOT hardcoded)
3. ✅ **OAuth token validation** - Clarify Gateway Identity contract, validate token presence
4. ✅ **Idempotency key validation** - Fail fast if missing (contract violation)
5. ✅ **ActionIntentId validation** - Fail fast if missing (required for dedupe)
6. ✅ **Internal adapter persistence** - Must persist before returning success
7. ✅ **Gateway setup approach** - Use single deterministic approach (CDK L1 constructs - `bedrockagentcore.CfnGateway`)
8. ✅ **CRM compensation strategy** - Set to MANUAL_ONLY until rollback implemented
9. ✅ **Tenant binding enforcement** - Validate tenant_id matches identity context

**All issues addressed in plan above.**

---

## 14. Gateway Deployment Notes

### Gateway Status Polling

**Note:** CloudFormation (via CDK) waits for Gateway resource creation to complete, but Gateway status may transition through states (`CREATING` → `READY`). For programmatic status checks (e.g., in tests or scripts), explicitly poll until `READY`:

```typescript
// Gateway status values: 'CREATING' | 'READY' | 'UPDATING' | 'UPDATE_UNSUCCESSFUL' | 'FAILED'
// Poll until READY (don't assume CloudFormation wait is sufficient)
let status = 'CREATING';
while (status !== 'READY') {
  const gatewayStatus = await agentcoreClient.getGateway({ gatewayIdentifier: gatewayId });
  status = gatewayStatus.status;
  if (status === 'READY') {
    break;
  } else if (status === 'FAILED' || status === 'UPDATE_UNSUCCESSFUL') {
    throw new Error(`Gateway deployment failed with status: ${status}`);
  }
  await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds before next check
}
```

### KMS Encryption

**Per article:** Gateways require KMS encryption for:
- Configuration data (target configurations, schemas, routing info)
- Runtime data (request/response payloads, session data, cached responses)
- Identity/auth data (credential provider secrets, API keys, OAuth credentials)

**Default:** AWS-managed KMS key (no action needed)
**Production:** Consider customer-managed KMS key for compliance, data sovereignty, and audit requirements.

### Monitoring Setup

**Per article:** CloudWatch GenAI Observability requires:
1. Enable CloudWatch Transaction Search (X-Ray Transaction Search) at account/organization level
2. Configure X-Ray resource policy to grant `logs:PutLogEvents` permission
3. Set X-Ray trace segment destination to CloudWatch Logs
4. Enable log delivery and tracing for each Gateway (currently requires AWS Console for final setup)

**Note:** Full monitoring setup is deferred to Phase 4.4 (Observability & Safety).

### CloudWatch Metrics for Gateway Usage

**Purpose:** Track Gateway health, usage patterns, and performance for operational visibility.

**Implementation in CDK:**

```typescript
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';

// ✅ Gateway invocation metrics (automatic via CloudWatch GenAI Observability)
// These metrics are automatically published by AgentCore Gateway:
// - Gateway invocations (count)
// - Gateway invocation latency (p50, p95, p99)
// - Gateway errors (4xx, 5xx)
// - Gateway target invocations per target

// ✅ Custom CloudWatch Dashboard for Gateway health
const gatewayDashboard = new cloudwatch.Dashboard(this, 'GatewayDashboard', {
  dashboardName: 'AgentCore-Gateway-Health',
});

// Gateway invocation count
gatewayDashboard.addWidgets(
  new cloudwatch.GraphWidget({
    title: 'Gateway Invocations',
    left: [
      new cloudwatch.Metric({
        namespace: 'AWS/BedrockAgentCore',
        metricName: 'GatewayInvocations',
        dimensionsMap: {
          GatewayId: this.gatewayId,
        },
        statistic: 'Sum',
        period: cdk.Duration.minutes(5),
      }),
    ],
  })
);

// Gateway error rate
gatewayDashboard.addWidgets(
  new cloudwatch.GraphWidget({
    title: 'Gateway Error Rate',
    left: [
      new cloudwatch.Metric({
        namespace: 'AWS/BedrockAgentCore',
        metricName: 'GatewayErrors',
        dimensionsMap: {
          GatewayId: this.gatewayId,
        },
        statistic: 'Sum',
        period: cdk.Duration.minutes(5),
      }),
    ],
  })
);

// Gateway latency (p95)
gatewayDashboard.addWidgets(
  new cloudwatch.GraphWidget({
    title: 'Gateway Latency (p95)',
    left: [
      new cloudwatch.Metric({
        namespace: 'AWS/BedrockAgentCore',
        metricName: 'GatewayLatency',
        dimensionsMap: {
          GatewayId: this.gatewayId,
        },
        statistic: 'p95',
        period: cdk.Duration.minutes(5),
      }),
    ],
  })
);

// ✅ CloudWatch Alarms for Gateway health
// Alarm on high error rate (> 5% of invocations)
const highErrorRateAlarm = new cloudwatch.Alarm(this, 'GatewayHighErrorRate', {
  metric: new cloudwatch.Metric({
    namespace: 'AWS/BedrockAgentCore',
    metricName: 'GatewayErrorRate',
    dimensionsMap: {
      GatewayId: this.gatewayId,
    },
    statistic: 'Average',
    period: cdk.Duration.minutes(5),
  }),
  threshold: 0.05, // 5% error rate
  evaluationPeriods: 2,
  alarmDescription: 'Gateway error rate exceeds 5%',
  treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
});

// Alarm on high latency (p95 > 5 seconds)
const highLatencyAlarm = new cloudwatch.Alarm(this, 'GatewayHighLatency', {
  metric: new cloudwatch.Metric({
    namespace: 'AWS/BedrockAgentCore',
    metricName: 'GatewayLatency',
    dimensionsMap: {
      GatewayId: this.gatewayId,
    },
    statistic: 'p95',
    period: cdk.Duration.minutes(5),
  }),
  threshold: 5000, // 5 seconds in milliseconds
  evaluationPeriods: 2,
  alarmDescription: 'Gateway p95 latency exceeds 5 seconds',
  treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
});

// Alarm on Gateway unavailability (no invocations for extended period)
const gatewayUnavailableAlarm = new cloudwatch.Alarm(this, 'GatewayUnavailable', {
  metric: new cloudwatch.Metric({
    namespace: 'AWS/BedrockAgentCore',
    metricName: 'GatewayInvocations',
    dimensionsMap: {
      GatewayId: this.gatewayId,
    },
    statistic: 'Sum',
    period: cdk.Duration.minutes(15),
  }),
  threshold: 0,
  evaluationPeriods: 1,
  comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
  alarmDescription: 'Gateway has no invocations for 15 minutes (possible outage)',
  treatMissingData: cloudwatch.TreatMissingData.BREACHING,
});

// ✅ Target-level metrics (per adapter)
// Track invocations per target for capacity planning
// Note: These metrics are automatically published by Gateway for each target
// Access via dimensions: { GatewayId: gatewayId, TargetId: targetId }
```

**Key Metrics to Monitor:**

1. **Gateway Invocations** (`GatewayInvocations`)
   - Total number of tool invocations through Gateway
   - Use for capacity planning and usage trends

2. **Gateway Error Rate** (`GatewayErrorRate` or `GatewayErrors` / `GatewayInvocations`)
   - Percentage of failed invocations
   - Alert if > 5% (indicates systemic issues)

3. **Gateway Latency** (`GatewayLatency`)
   - p50, p95, p99 percentiles
   - Alert if p95 > 5 seconds (indicates performance degradation)

4. **Target Invocations** (`TargetInvocations`)
   - Per-target invocation counts
   - Use to identify hot targets and capacity needs

5. **Gateway Availability**
   - Monitor for extended periods of zero invocations
   - May indicate Gateway outage or routing issues

**Integration with Phase 4.4:**
- Full observability setup (X-Ray tracing, log delivery) deferred to Phase 4.4
- These metrics provide operational visibility for Phase 4.3
- Alarms can trigger SNS notifications or Step Functions for automated response

---

## 15. Next Steps

After Phase 4.3 completion:
- ✅ Connector adapters ready
- ⏳ Proceed to Phase 4.4 (Safety & Outcomes) - Kill switches, signal emission, execution status API, alarms

---

**See:** `PHASE_4_CODE_LEVEL_PLAN.md` for complete Phase 4 overview and cross-references.
