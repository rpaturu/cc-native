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
2. Internal systems adapter
3. CRM adapter (initial)
4. AgentCore Gateway setup (CDK)
5. Register adapters as Gateway targets
6. Update ToolMapper handler to pass `action_intent_id` in tool arguments
7. Seed initial ActionTypeRegistry entries

**Note:** Task 6 (ToolMapper update) is required for adapters to record external write dedupe. The ToolMapper handler should add `action_intent_id` to `tool_arguments` before passing to ToolInvoker. See Phase 4.2 ToolMapper handler for current implementation.

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
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { Logger } from '../../services/core/Logger';

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
    // Create internal note in DynamoDB
    const noteId = `note_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    
    // TODO: Write to internal notes table
    // Example:
    // await this.dynamoClient.send(new PutCommand({
    //   TableName: process.env.INTERNAL_NOTES_TABLE_NAME || 'cc-native-internal-notes',
    //   Item: {
    //     note_id: noteId,
    //     content: args.content,
    //     account_id: args.account_id,
    //     tenant_id: args.tenant_id,
    //     created_at: new Date().toISOString(),
    //   },
    // }));
    
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
    // Similar to createNote
    const taskId = `task_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    
    // TODO: Write to internal tasks table
    // Example:
    // await this.dynamoClient.send(new PutCommand({
    //   TableName: process.env.INTERNAL_TASKS_TABLE_NAME || 'cc-native-internal-tasks',
    //   Item: {
    //     task_id: taskId,
    //     title: args.title,
    //     description: args.description,
    //     account_id: args.account_id,
    //     tenant_id: args.tenant_id,
    //     created_at: new Date().toISOString(),
    //   },
    // }));
    
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
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { Logger } from '../../services/core/Logger';
import axios from 'axios';

export class CrmConnectorAdapter implements IConnectorAdapter {
  constructor(
    private dynamoClient: DynamoDBDocumentClient,
    private dedupeTableName: string,
    private logger: Logger
  ) {}

  async execute(invocation: MCPToolInvocation): Promise<MCPResponse> {
    const { name, arguments: args } = invocation.params;
    const invocationId = invocation.id; // ✅ id is at top level, not in params
    const idempotencyKey = args.idempotency_key;
    
    // Check external write dedupe (adapter-level idempotency)
    const idempotencyService = new IdempotencyService();
    const existingObjectId = await idempotencyService.checkExternalWriteDedupe(
      this.dynamoClient,
      this.dedupeTableName,
      idempotencyKey
    );
    
    if (existingObjectId) {
      // Already executed, return existing result
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
    // Get OAuth token (from Gateway identity)
    // Note: Gateway provides OAuth token via invocation.identity.accessToken
    const oauthToken = invocation.identity?.accessToken;
    if (!oauthToken) {
      throw new Error('OAuth token missing from Gateway identity. Ensure Gateway is configured with JWT authorizer.');
    }
    
    // Call Salesforce REST API
    const response = await axios.post(
      'https://your-instance.salesforce.com/services/data/v58.0/sobjects/Task/',
      {
        Subject: args.title,
        Priority: args.priority || 'Normal',
        // ... other fields
      },
      {
        headers: {
          'Authorization': `Bearer ${oauthToken}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey, // If Salesforce supports it
        },
      }
    );
    
    const taskId = response.data.Id;
    
    // Record external write dedupe
    // Note: action_intent_id should be passed in tool arguments from ToolMapper handler
    const actionIntentId = args.action_intent_id;
    if (!actionIntentId) {
      this.logger.warn('action_intent_id missing from tool arguments', {
        tool_name: 'crm.create_task',
        idempotency_key: idempotencyKey,
      });
    }
    
    const idempotencyService = new IdempotencyService();
    await idempotencyService.recordExternalWriteDedupe(
      this.dynamoClient,
      this.dedupeTableName,
      idempotencyKey,
      taskId,
      actionIntentId || 'unknown', // Fallback if missing
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
                object_url: `https://your-instance.salesforce.com/${taskId}`,
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

**Purpose:** Add AgentCore Gateway configuration

**Phase 4.3 Additions:**

```typescript
// Add to ExecutionInfrastructureProps
export interface ExecutionInfrastructureProps {
  // ... existing props ...
  readonly userPool?: cognito.IUserPool; // For JWT auth
}

// Add to ExecutionInfrastructure class
// Note: AgentCore Gateway CDK construct may not exist yet
// If not available, use L1 CfnResource or AWS SDK calls
// This is expected - Gateway setup will be finalized when CDK constructs are available

/**
 * Create AgentCore Gateway (if CDK construct exists)
 * Otherwise, use L1 construct or manual API calls
 */
private createAgentCoreGateway(props: ExecutionInfrastructureProps): void {
  // Option 1: If CDK construct exists
  // import * as bedrockAgentCore from '@aws-cdk/aws-bedrock-agentcore-alpha';
  // 
  // const executionGateway = new bedrockAgentCore.Gateway(this, 'ExecutionGateway', {
  //   name: 'cc-native-execution-gateway',
  //   protocolType: 'MCP',
  //   authorizerType: 'CUSTOM_JWT',
  //   authorizerConfiguration: {
  //     customJWTAuthorizer: {
  //       allowedClients: [props.userPool?.userPoolClientId || ''],
  //       discoveryUrl: props.userPool?.userPoolProviderUrl || '',
  //     },
  //   },
  //   roleArn: executionGatewayRole.roleArn,
  // });

  // Option 2: Use L1 CfnResource (if construct doesn't exist)
  // const gateway = new cdk.CfnResource(this, 'ExecutionGateway', {
  //   type: 'AWS::Bedrock::AgentCore::Gateway',
  //   properties: {
  //     Name: 'cc-native-execution-gateway',
  //     ProtocolType: 'MCP',
  //     AuthorizerType: 'CUSTOM_JWT',
  //     // ... other properties
  //   },
  // });

  // Option 3: Manual setup via AWS SDK (post-deployment script)
  // See: scripts/phase_4/setup-agentcore-gateway.sh
}

/**
 * Register Lambda adapter as Gateway target
 */
private registerGatewayTarget(
  gatewayId: string,
  adapterLambda: lambda.Function,
  toolName: string,
  toolSchema: Record<string, any>
): void {
  // Use AWS SDK or CDK custom resource to register target
  // See: scripts/phase_4/register-gateway-target.sh
}
```

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
    compensation_strategy: 'AUTOMATIC',
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

### File: `scripts/phase_4/register-gateway-target.sh`

**Purpose:** Register Lambda adapters as Gateway targets

**Script:**

```bash
#!/bin/bash
# Register Lambda adapter as AgentCore Gateway target

GATEWAY_ID=${AGENTCORE_GATEWAY_ID}
LAMBDA_ARN=${LAMBDA_FUNCTION_ARN}
TOOL_NAME=${TOOL_NAME}  # e.g., "crm.create_task"

# Use AWS SDK to register target
# Note: Actual API calls depend on AgentCore Gateway API availability
aws bedrock-agentcore create-gateway-target \
  --gateway-id $GATEWAY_ID \
  --target-configuration '{
    "lambda": {
      "functionArn": "'$LAMBDA_ARN'"
    }
  }' \
  --tool-schema '{
    "name": "'$TOOL_NAME'",
    "description": "...",
    "inputSchema": {...}
  }'

echo "Gateway target registered: $TOOL_NAME"
```

---

## 7. Testing

### Integration Tests

**Files to Create:**
- `src/tests/integration/execution/connector-adapters.test.ts` - Adapter execution flow
- `src/tests/integration/execution/gateway-integration.test.ts` - Gateway → Adapter flow

---

## 8. Implementation Checklist

- [ ] Create `src/adapters/IConnectorAdapter.ts`
- [ ] Create `src/adapters/internal/InternalConnectorAdapter.ts`
- [ ] Create `src/adapters/crm/CrmConnectorAdapter.ts`
- [ ] Set up AgentCore Gateway (CDK or L1 construct)
- [ ] Create Lambda functions for adapters (registered as Gateway targets)
- [ ] Register adapters as Gateway targets
- [ ] Update ToolMapper handler to pass `action_intent_id` in tool arguments (see note in Phase 4.3 plan)
- [ ] Seed initial ActionTypeRegistry entries using TypeScript service
- [ ] Integration tests for connectors

**Note:** Ensure adapters:
- Use `invocation.id` (not `invocation.params.id`)
- Use `invocation.identity?.accessToken` for OAuth token
- Return `external_object_refs` array format (preferred per Phase 4.2 contract)
- Include `action_intent_id` in tool arguments for idempotency recording

---

## 9. Next Steps

After Phase 4.3 completion:
- ✅ Connector adapters ready
- ⏳ Proceed to Phase 4.4 (Safety & Outcomes) - Kill switches, signal emission, execution status API, alarms

---

**See:** `PHASE_4_CODE_LEVEL_PLAN.md` for complete Phase 4 overview and cross-references.
