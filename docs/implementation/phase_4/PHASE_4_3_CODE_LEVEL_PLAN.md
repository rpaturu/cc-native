# Phase 4.3 — Connectors: Code-Level Implementation Plan

**Status:** 🟡 **PLANNING**  
**Created:** 2026-01-26  
**Last Updated:** 2026-01-26  
**Reviewed & Updated:** 2026-01-26 (aligned with Phase 4.1/4.2 implementation)  
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
      const error = new Error('Missing required fields: tenant_id and account_id must be present in tool arguments');
      error.name = 'ValidationError';
      throw error;
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
      const error = new Error('Missing required fields: tenant_id and account_id must be present in tool arguments');
      error.name = 'ValidationError';
      throw error;
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
    // Note: checkExternalWriteDedupe currently returns string (external_object_id)
    // Future enhancement: Return external_object_refs[] array for consistency
    // ✅ IdempotencyService has no constructor parameters (static utility methods)
    const idempotencyService = new IdempotencyService();
    const existingObjectId = await idempotencyService.checkExternalWriteDedupe(
      this.dynamoClient,
      this.dedupeTableName,
      idempotencyKey
    );
    
    if (existingObjectId) {
      // Already executed, return existing result
      // Note: We reconstruct external_object_refs from single object_id
      // Future: Dedupe service should return full external_object_refs[] array
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
                  object_id: existingObjectId,
                },
              ],
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
          // ✅ Note: Idempotency-Key header is best-effort (Salesforce may or may not support it)
          // Dedupe in DynamoDB (external_write_dedupe table) is authoritative - do not rely on Salesforce idempotency
          'Idempotency-Key': idempotencyKey,
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
    // ✅ IdempotencyService has no constructor parameters (static utility methods)
    const idempotencyService = new IdempotencyService();
    await idempotencyService.recordExternalWriteDedupe(
      this.dynamoClient,
      this.dedupeTableName,
      idempotencyKey,
      taskId,
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

## 4. AgentCore Gateway Setup

### File: `src/stacks/constructs/ExecutionInfrastructure.ts` (Phase 4.3 Additions)

**Purpose:** Add AgentCore Gateway configuration (fully automated via CDK)

**Approach:** Use CDK L1 construct (`CfnResource`) or `AwsCustomResource` to automate Gateway creation and target registration. No manual setup required.

**Phase 4.3 Additions:**

```typescript
import * as customResources from 'aws-cdk-lib/custom-resources';
import * as cr from 'aws-cdk-lib/custom-resources';

// Add to ExecutionInfrastructureProps (already exists)
export interface ExecutionInfrastructureProps {
  // ... existing props ...
  readonly userPool?: cognito.IUserPool; // For JWT auth (already exists)
}

// Add to ExecutionInfrastructure class
public readonly executionGateway: cdk.CfnResource | customResources.AwsCustomResource;
public readonly gatewayUrl: string; // Output: Gateway URL for ToolMapper handler

/**
 * Create AgentCore Gateway (automated via CDK)
 * 
 * Strategy: Try L1 CfnResource first (if CloudFormation supports it),
 * otherwise use AwsCustomResource (Lambda-backed) to call AWS SDK APIs.
 */
private createAgentCoreGateway(props: ExecutionInfrastructureProps): void {
  // Create IAM role for Gateway (if needed)
  const gatewayRole = new iam.Role(this, 'ExecutionGatewayRole', {
    assumedBy: new iam.ServicePrincipal('bedrock.amazonaws.com'),
    description: 'Role for AgentCore Gateway execution',
  });

  // ✅ MUST-FIX: Use single deterministic approach (AwsCustomResource-only)
  // Option A (Recommended): Use AwsCustomResource with built-in provider
  // AwsCustomResource provisions its own provider Lambda internally - no need for cr.Provider
  // 
  // Note: Verify service/action names against AWS SDK v3 client for @aws-sdk/client-bedrock-agentcore
  // If service name doesn't match, use Option B (custom provider Lambda) instead
  
  const gatewayCustomResource = new customResources.AwsCustomResource(this, 'ExecutionGateway', {
    onCreate: {
      service: 'BedrockAgentCore', // ⚠️ Verify this matches AWS SDK v3 service name
      action: 'createGateway',     // ⚠️ Verify this matches AWS SDK v3 action name
      parameters: {
        Name: 'cc-native-execution-gateway',
        ProtocolType: 'MCP',
        AuthorizerType: 'CUSTOM_JWT',
        AuthorizerConfiguration: {
          CustomJWTAuthorizer: {
            AllowedClients: props.userPool ? [props.userPool.userPoolClientId] : [],
            DiscoveryUrl: props.userPool?.userPoolProviderUrl || '',
          },
        },
        RoleArn: gatewayRole.roleArn,
      },
      physicalResourceId: cr.PhysicalResourceId.fromResponse('GatewayId'),
    },
    onUpdate: {
      service: 'BedrockAgentCore',
      action: 'updateGateway',
      parameters: {
        GatewayId: cr.PhysicalResourceId.fromResponse('GatewayId'),
        // ... update parameters (name, authorizer config, etc.)
      },
    },
    onDelete: {
      service: 'BedrockAgentCore',
      action: 'deleteGateway',
      parameters: {
        GatewayId: cr.PhysicalResourceId.fromResponse('GatewayId'),
      },
    },
    policy: cr.AwsCustomResourcePolicy.fromSdkCalls({
      resources: cr.AwsCustomResourcePolicy.ANY_RESOURCE,
    }),
    // ✅ No provider parameter - AwsCustomResource uses its own built-in provider
  });

  this.executionGateway = gatewayCustomResource;
  // Get Gateway URL from custom resource response
  this.gatewayUrl = gatewayCustomResource.getResponseField('GatewayUrl').toString();

  // Alternative Option B: If AwsCustomResource service name doesn't match AWS SDK, use custom provider:
  /*
  const gatewayProvider = new cr.Provider(this, 'GatewayProvider', {
    onEventHandler: new lambdaNodejs.NodejsFunction(this, 'GatewayHandler', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: 'src/lambdas/gateway-setup-handler.ts', // Custom Lambda that calls AWS SDK directly
      timeout: cdk.Duration.minutes(5),
      environment: {
        USER_POOL_CLIENT_ID: props.userPool?.userPoolClientId || '',
        USER_POOL_PROVIDER_URL: props.userPool?.userPoolProviderUrl || '',
        GATEWAY_ROLE_ARN: gatewayRole.roleArn,
      },
    }),
  });

  gatewayProvider.onEventHandler.addToRolePolicy(
    new iam.PolicyStatement({
      actions: [
        'bedrock-agentcore:CreateGateway',
        'bedrock-agentcore:GetGateway',
        'bedrock-agentcore:UpdateGateway',
        'bedrock-agentcore:DeleteGateway',
      ],
      resources: ['*'],
    })
  );

  const gatewayCustomResource = new cr.CustomResource(this, 'ExecutionGateway', {
    serviceToken: gatewayProvider.serviceToken,
    properties: {
      Name: 'cc-native-execution-gateway',
      ProtocolType: 'MCP',
      AuthorizerType: 'CUSTOM_JWT',
    },
  });

  this.executionGateway = gatewayCustomResource;
  this.gatewayUrl = gatewayCustomResource.getAtt('GatewayUrl').toString();
  */

  // Alternative: If CloudFormation resource type is confirmed available in your region, use L1 construct:
  /*
  this.executionGateway = new cdk.CfnResource(this, 'ExecutionGatewayL1', {
    type: 'AWS::BedrockAgentCore::Gateway',
    properties: {
      Name: 'cc-native-execution-gateway',
      ProtocolType: 'MCP',
      AuthorizerType: 'CUSTOM_JWT',
      AuthorizerConfiguration: {
        CustomJWTAuthorizer: {
          AllowedClients: props.userPool ? [props.userPool.userPoolClientId] : [],
          DiscoveryUrl: props.userPool?.userPoolProviderUrl || '',
        },
      },
      RoleArn: gatewayRole.roleArn,
    },
  });
  this.gatewayUrl = this.executionGateway.getAtt('GatewayUrl').toString();
  */
}

/**
 * Register Lambda adapter as Gateway target (automated via CDK)
 */
private registerGatewayTarget(
  adapterLambda: lambda.Function,
  toolName: string,
  toolSchema: Record<string, any>
): void {
  // Get Gateway ID (works for both CfnResource and AwsCustomResource)
  const gatewayId = this.executionGateway instanceof cdk.CfnResource
    ? this.executionGateway.getAtt('GatewayId').toString()
    : (this.executionGateway as customResources.AwsCustomResource).getResponseField('GatewayId');

  // ✅ MUST-FIX: Use AwsCustomResource-only approach (no separate Provider)
  // AwsCustomResource provisions its own provider Lambda internally
  // Note: Verify service/action names against AWS SDK v3 client for @aws-sdk/client-bedrock-agentcore
  
  new customResources.AwsCustomResource(this, `GatewayTarget-${toolName}`, {
    onCreate: {
      service: 'BedrockAgentCore', // ⚠️ Verify this matches AWS SDK v3 service name
      action: 'createGatewayTarget', // ⚠️ Verify this matches AWS SDK v3 action name
      parameters: {
        GatewayId: gatewayId,
        TargetConfiguration: {
          Lambda: {
            FunctionArn: adapterLambda.functionArn,
          },
        },
        ToolSchema: toolSchema,
      },
      physicalResourceId: cr.PhysicalResourceId.fromResponse('TargetId'),
    },
    onUpdate: {
      service: 'BedrockAgentCore',
      action: 'updateGatewayTarget',
      parameters: {
        GatewayId: gatewayId,
        TargetId: cr.PhysicalResourceId.fromResponse('TargetId'),
        ToolSchema: toolSchema,
      },
    },
    onDelete: {
      service: 'BedrockAgentCore',
      action: 'deleteGatewayTarget',
      parameters: {
        GatewayId: gatewayId,
        TargetId: cr.PhysicalResourceId.fromResponse('TargetId'),
      },
    },
    policy: cr.AwsCustomResourcePolicy.fromSdkCalls({
      resources: cr.AwsCustomResourcePolicy.ANY_RESOURCE,
    }),
    // ✅ No provider parameter - AwsCustomResource uses its own built-in provider
  });

  // Grant Lambda invoke permission to Gateway (if needed)
  adapterLambda.addPermission('AllowGatewayInvoke', {
    principal: new iam.ServicePrincipal('bedrock.amazonaws.com'),
    sourceArn: `arn:aws:bedrock-agentcore:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:gateway/${gatewayId}/*`,
  });
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
  // this.registerGatewayTarget(internalAdapterLambda, 'internal.create_note', toolSchema);
  // this.registerGatewayTarget(crmAdapterLambda, 'crm.create_task', toolSchema);
}
```

**Note:** Gateway creation and target registration are fully automated via CDK. No manual setup required.

**Approach:** Uses `AwsCustomResource` as the canonical approach (more reliable across regions). 

**⚠️ Important:** Verify service/action names (`BedrockAgentCore`, `createGateway`, etc.) match AWS SDK v3 client for `@aws-sdk/client-bedrock-agentcore`. If service names don't match, use Option B (custom provider Lambda) instead. See `amazon-bedrock-agentcore-samples` in parent folder for reference examples.

**Alternative:** If `AWS::BedrockAgentCore::Gateway` CloudFormation resource type is confirmed available in your region, you can use L1 `CfnResource` instead (commented alternative above).

---

## 5. ActionTypeRegistry Seed Data

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

## 6. Gateway Target Registration

**Status:** ✅ **AUTOMATED** - Handled in `createAgentCoreGateway()` method above

**Note:** Gateway target registration is now fully automated via CDK `AwsCustomResource`. The `registerGatewayTarget()` method in Section 4 handles this automatically when adapter Lambdas are created.

**No manual scripts needed** - target registration happens during CDK deployment.

---

## 7. Testing

### Integration Tests

**Files to Create:**
- `src/tests/integration/execution/connector-adapters.test.ts` - Adapter execution flow
- `src/tests/integration/execution/gateway-integration.test.ts` - Gateway → Adapter flow

---

## 8. Security & Zero Trust Controls

### A. Per-Tool Egress Control (VPC Isolation)

**Purpose:** Adapters are the only components touching public internet (SaaS APIs). Isolate them in dedicated VPC with egress controls.

**Implementation:**
- Create "Connectors VPC" with private subnets
- VPC endpoints for AWS services (DynamoDB, Secrets Manager, KMS)
- NAT Gateway for outbound internet access
- AWS Network Firewall or proxy for egress allow-listing
- Per-connector security groups
- VPC Flow Logs for audit

**CDK Pattern:**
```typescript
// In ExecutionInfrastructure or separate ConnectorInfrastructure construct
const connectorsVpc = new ec2.Vpc(this, 'ConnectorsVpc', {
  maxAzs: 2,
  natGateways: 1,
  subnetConfiguration: [
    {
      cidrMask: 24,
      name: 'ConnectorPrivate',
      subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
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
new ec2.InterfaceVpcEndpoint(this, 'SecretsManagerEndpoint', {
  vpc: connectorsVpc,
  service: ec2.InterfaceVpcEndpointAwsService.SECRETS_MANAGER,
});

// Security group per connector
const crmAdapterSecurityGroup = new ec2.SecurityGroup(this, 'CrmAdapterSecurityGroup', {
  vpc: connectorsVpc,
  description: 'Security group for CRM adapter',
  allowAllOutbound: false, // Explicit egress control
});
```

**Note:** See `PHASE_4_ARCHITECTURE.md` for phased VPC strategy (Phase A: public, Phase B: shared VPC, Phase C: isolated VPC).

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

## 9. Connector Configuration Service

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
      // If account-specific secret not found, try tenant-global fallback (optional)
      // Only if connector config is intentionally tenant-global, not account-specific
      // try {
      //   const tenantSecret = await this.secretsClient.send(new GetSecretValueCommand({
      //     SecretId: `tenant/${tenantId}/connector/${connectorType}`,
      //   }));
      //   const tenantData = JSON.parse(tenantSecret.SecretString || '{}');
      //   config.apiKey = tenantData.apiKey;
      // } catch (fallbackError) {
      //   // No fallback secret found
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

## 10. Implementation Checklist

- [ ] Create `src/adapters/IConnectorAdapter.ts`
- [ ] Create `src/adapters/internal/InternalConnectorAdapter.ts` (with persistence implementation)
- [ ] Create `src/adapters/crm/CrmConnectorAdapter.ts` (with tenant-scoped config, validation)
- [ ] Create `src/services/execution/ConnectorConfigService.ts` (tenant-scoped config retrieval)
- [ ] Set up AgentCore Gateway (automated via CDK AwsCustomResource - canonical approach)
- [ ] Create Lambda functions for adapters (with per-connector IAM roles)
- [ ] Register adapters as Gateway targets (automated via CDK AwsCustomResource)
- [ ] ✅ ToolMapper handler updated to pass `action_intent_id` in tool arguments (already fixed)
- [ ] Seed initial ActionTypeRegistry entries using TypeScript service (with MANUAL_ONLY compensation)
- [ ] Set up Connectors VPC (Phase B) with egress controls
- [ ] Configure per-connector security groups and IAM roles

**Must-Fix Validation Checklist:**
- [ ] ✅ Validate `idempotency_key` presence in adapter (fail fast if missing)
- [ ] ✅ Validate `action_intent_id` presence in adapter (fail fast if missing)
- [ ] ✅ Validate `tenant_id` and `account_id` presence (security: tenant binding)
- [ ] ✅ Validate tenant binding (identity.tenantId matches args.tenant_id)
- [ ] ✅ Get Salesforce instance URL from tenant-scoped config (NOT hardcoded)
- [ ] ✅ Handle Salesforce response shape correctly (Id vs id)
- [ ] ✅ Implement internal adapter persistence before returning success
- [ ] ✅ Set CRM compensation strategy to MANUAL_ONLY (until rollback implemented)
- [ ] ✅ Use single deterministic Gateway setup approach (AwsCustomResource)

---

## 11. Critical Must-Fix Issues (Review Feedback)

**These issues must be fixed before Phase 4.3 implementation:**

1. ✅ **CRM adapter Salesforce response handling** - Handle both `Id` and `id` fields, validate presence
2. ✅ **Hardcoded Salesforce instance URL** - Use tenant-scoped connector config (NOT hardcoded)
3. ✅ **OAuth token validation** - Clarify Gateway Identity contract, validate token presence
4. ✅ **Idempotency key validation** - Fail fast if missing (contract violation)
5. ✅ **ActionIntentId validation** - Fail fast if missing (required for dedupe)
6. ✅ **Internal adapter persistence** - Must persist before returning success
7. ✅ **Gateway setup approach** - Use single deterministic approach (AwsCustomResource)
8. ✅ **CRM compensation strategy** - Set to MANUAL_ONLY until rollback implemented
9. ✅ **Tenant binding enforcement** - Validate tenant_id matches identity context

**All issues addressed in plan above.**

---

## 12. Next Steps

After Phase 4.3 completion:
- ✅ Connector adapters ready
- ⏳ Proceed to Phase 4.4 (Safety & Outcomes) - Kill switches, signal emission, execution status API, alarms

---

**See:** `PHASE_4_CODE_LEVEL_PLAN.md` for complete Phase 4 overview and cross-references.
