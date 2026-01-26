# Phase 4 Architecture: Bounded Execution & AI-Native Action Fulfillment

**Status:** 🟡 **ARCHITECTURE DEFINED**  
**Created:** 2026-01-26  
**Last Updated:** 2026-01-26

---

## Executive Summary

Phase 4 implements **bounded execution** of approved `ActionIntentV1` objects through **Amazon Bedrock AgentCore Gateway** using the **MCP (Model Context Protocol)**. The architecture ensures execution is **deterministic, auditable, and reversible** without introducing new decision-making or LLM judgment.

**Key Principle:**
> **Execution never re-decides. It only fulfills.**

---

## Architecture Overview

### High-Level Flow

```
Phase 3: Approved ActionIntent
  ↓
EventBridge: ACTION_APPROVED
  ↓
Step Functions: Execution Orchestration
  ↓
AgentCore Gateway: MCP Protocol (tools/call)
  ↓
Lambda Connector Adapter: Tool Execution
  ↓
External System: CRM, Calendar, Internal
  ↓
Execution Result: Recorded & Audited
```

### Core Components

1. **Step Functions State Machine** - Orchestrates execution lifecycle
2. **AgentCore Gateway** - Unified MCP tool execution plane
3. **Lambda Connector Adapters** - Execute actual connector logic
4. **AgentCore Identity** - OAuth credential management
5. **Execution State Store** - DynamoDB execution records
6. **SQS Queues** - Per-connector throttling (optional)

---

## Component Architecture

### 1. Step Functions State Machine (Orchestration Layer)

**Purpose:** Orchestrate execution lifecycle with retry, compensation, and outcome recording

**State Machine Definition:**
```json
{
  "Comment": "Action Intent Execution Orchestrator",
  "StartAt": "ValidateExecution",
  "States": {
    "ValidateExecution": {
      "Type": "Task",
      "Resource": "arn:aws:states:::lambda:invoke",
      "Parameters": {
        "FunctionName": "cc-native-execution-validator",
        "Payload": {
          "action_intent_id": "$.action_intent_id"
        }
      },
      "Next": "MapActionToTool"
    },
    "MapActionToTool": {
      "Type": "Task",
      "Resource": "arn:aws:states:::lambda:invoke",
      "Parameters": {
        "FunctionName": "cc-native-tool-mapper",
        "Payload": {
          "action_type": "$.action_type",
          "parameters": "$.parameters"
        }
      },
      "Next": "InvokeToolViaGateway"
    },
    "InvokeToolViaGateway": {
      "Type": "Task",
      "Resource": "arn:aws:states:::lambda:invoke",
      "Parameters": {
        "FunctionName": "cc-native-mcp-gateway-client",
        "Payload": {
          "gateway_url": "$.gateway_url",
          "tool_name": "$.tool_name",
          "tool_arguments": "$.tool_arguments",
          "jwt_token": "$.jwt_token"
        }
      },
      "Retry": [
        {
          "ErrorEquals": ["TransientError"],
          "IntervalSeconds": 2,
          "MaxAttempts": 3,
          "BackoffRate": 2.0
        }
      ],
      "Catch": [
        {
          "ErrorEquals": ["PermanentError"],
          "Next": "CompensateAction"
        },
        {
          "ErrorEquals": ["States.ALL"],
          "Next": "RecordFailure"
        }
      ],
      "Next": "RecordOutcome"
    },
    "CompensateAction": {
      "Type": "Task",
      "Resource": "arn:aws:states:::lambda:invoke",
      "Parameters": {
        "FunctionName": "cc-native-compensation-handler",
        "Payload": {
          "action_intent_id": "$.action_intent_id",
          "execution_result": "$.execution_result"
        }
      },
      "Next": "RecordOutcome"
    },
    "RecordOutcome": {
      "Type": "Task",
      "Resource": "arn:aws:states:::lambda:invoke",
      "Parameters": {
        "FunctionName": "cc-native-execution-recorder",
        "Payload": {
          "action_intent_id": "$.action_intent_id",
          "status": "$.status",
          "external_object_ids": "$.external_object_ids",
          "error": "$.error"
        }
      },
      "End": true
    },
    "RecordFailure": {
      "Type": "Task",
      "Resource": "arn:aws:states:::lambda:invoke",
      "Parameters": {
        "FunctionName": "cc-native-execution-recorder",
        "Payload": {
          "action_intent_id": "$.action_intent_id",
          "status": "FAILED",
          "error": "$.Error"
        }
      },
      "End": true
    }
  }
}
```

**State Responsibilities:**

1. **ValidateExecution**
   - Fetch `ActionIntentV1` from DynamoDB
   - Check expiration (`expires_at_epoch`)
   - Check kill switches (tenant execution enabled, action type not disabled)
   - Check idempotency (execution not already started)
   - If invalid → fail with reason

2. **MapActionToTool**
   - Map `ActionIntentV1.action_type` → MCP tool name
   - Map `ActionIntentV1.parameters` → tool arguments
   - Example: `CREATE_CRM_TASK` → `crm.create_task`

3. **InvokeToolViaGateway**
   - Make MCP protocol call to AgentCore Gateway
   - Handle retries for transient failures
   - Parse MCP response
   - Extract external object IDs

4. **CompensateAction**
   - Rollback if action is reversible
   - Call compensation tool via Gateway
   - Handle compensation failures

5. **RecordOutcome**
   - Write `ExecutionRecord` to DynamoDB
   - Emit ledger event: `ACTION_EXECUTED` or `ACTION_FAILED`
   - Emit signal for Phase 1 perception layer

---

### 2. AgentCore Gateway (MCP Tool Execution Plane)

**Purpose:** Unified interface for tool discovery, invocation, and authentication

**Gateway Configuration:**
- **Protocol Type:** MCP (Model Context Protocol)
- **Authorizer Type:** CUSTOM_JWT (Cognito User Pool)
- **Gateway URL:** `https://bedrock-agentcore.{region}.amazonaws.com/gateways/{gatewayId}/invocations`
- **Target Types:** Lambda functions, OpenAPI specs, MCP servers

**Gateway Creation (CDK/API):**
```typescript
// Gateway configuration
const gateway = new bedrockAgentCore.Gateway(this, 'ExecutionGateway', {
  name: 'cc-native-execution-gateway',
  protocolType: 'MCP',
  authorizerType: 'CUSTOM_JWT',
  authorizerConfiguration: {
    customJWTAuthorizer: {
      allowedClients: [cognitoUserPoolClient.userPoolClientId],
      discoveryUrl: cognitoUserPool.userPoolProviderUrl,
    },
  },
  roleArn: executionGatewayRole.roleArn,
});
```

**Target Registration:**
- Lambda functions registered as Gateway targets
- Each target has OAuth credential provider (AgentCore Identity)
- Tool schema defined in target configuration
- Tools automatically discovered via `SynchronizeGatewayTargets` API

**MCP Protocol Operations:**

1. **tools/list** - Discover available tools
   ```json
   {
     "jsonrpc": "2.0",
     "id": "list-tools-1",
     "method": "tools/list",
     "params": {}
   }
   ```

2. **tools/call** - Invoke a tool
   ```json
   {
     "jsonrpc": "2.0",
     "id": "invoke-tool-1",
     "method": "tools/call",
     "params": {
       "name": "crm.create_task",
       "arguments": {
         "title": "Follow up on renewal",
         "priority": "HIGH"
       }
     }
   }
   ```

3. **x_amz_bedrock_agentcore_search** - Semantic tool search
   ```json
   {
     "jsonrpc": "2.0",
     "id": "search-tools-1",
     "method": "tools/call",
     "params": {
       "name": "x_amz_bedrock_agentcore_search",
       "arguments": {
         "query": "create task in CRM"
       }
     }
   }
   ```

**Authentication Flow:**
- **Inbound:** JWT token from Cognito (validated by Gateway)
- **Outbound:** OAuth token from AgentCore Identity (for external systems)
- Gateway manages both authentication layers

---

### 3. Lambda Connector Adapters (Tool Execution Layer)

**Purpose:** Execute actual connector logic for external systems

**Adapter Pattern:**
- Each connector = one Lambda function
- Lambda registered as Gateway target
- Lambda receives MCP tool invocation from Gateway
- Lambda handles external API calls
- Lambda returns MCP response format

**Example: CRM Connector Adapter**

```typescript
// Lambda handler for CRM connector
export const handler = async (event: MCPToolInvocation): Promise<MCPResponse> => {
  // Extract tool name and arguments from MCP invocation
  const { name, arguments: args } = event.params;
  
  // Get OAuth token (provided by Gateway via AgentCore Identity)
  const oauthToken = event.identity?.accessToken;
  
  // Map tool name to CRM operation
  if (name === 'crm.create_task') {
    const result = await createCrmTask({
      title: args.title,
      priority: args.priority,
      accountId: args.account_id,
      oauthToken,
    });
    
    // Return MCP response format
    return {
      jsonrpc: '2.0',
      id: event.id,
      result: {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            external_object_id: result.taskId,
            metadata: result.metadata,
          }),
        }],
      },
    };
  }
  
  throw new Error(`Unknown tool: ${name}`);
};
```

**Connector Types:**

1. **CRM Adapter** (`crm.create_task`, `crm.update_field`, `crm.create_opportunity`)
   - External systems: Salesforce, HubSpot, etc.
   - OAuth authentication via AgentCore Identity
   - Returns external object IDs

2. **Calendar Adapter** (`calendar.draft_event`)
   - External systems: Google Calendar, Outlook
   - OAuth authentication
   - Creates draft events (not sent)

3. **Internal Adapter** (`internal.create_note`, `internal.create_task`)
   - Internal DynamoDB writes
   - No external API calls
   - Reversible operations

**Tool Registration:**
- Lambda registered as Gateway target via `create_gateway_target` API
- Tool schema defined in target configuration
- OAuth credential provider configured for outbound auth

---

### 4. AgentCore Identity (OAuth Credential Management)

**Purpose:** Manage OAuth credentials for external system authentication

**Credential Provider Configuration:**
```typescript
// Create OAuth credential provider
const credentialProvider = new bedrockAgentCore.OAuth2CredentialProvider(this, 'CrmCredentialProvider', {
  name: 'crm-oauth-provider',
  credentialProviderVendor: 'CustomOauth2',
  oauth2ProviderConfig: {
    customOauth2ProviderConfig: {
      oauthDiscovery: {
        discoveryUrl: 'https://login.salesforce.com/.well-known/openid-configuration',
      },
      clientId: 'salesforce_client_id',
      clientSecret: 'salesforce_client_secret', // Stored in Secrets Manager
    },
  },
});
```

**How It Works:**
- Gateway uses credential provider to get OAuth tokens
- Tokens refreshed automatically by AgentCore Identity
- Per-tenant credential management (if needed)
- Tokens passed to Lambda adapters via Gateway

**Per-Tenant vs Shared:**
- **Option A:** One credential provider per tenant (more isolation)
- **Option B:** Shared provider with tenant-scoped tokens (simpler)
- **Recommendation:** Start with shared, evolve to per-tenant if needed

---

### 5. Execution State Store (DynamoDB)

**Purpose:** Persist execution state for queryability and audit

**Table Schema:**
```
Table: cc-native-execution-records

PK: TENANT#tenant_id#ACCOUNT#account_id
SK: EXECUTION#action_intent_id

Attributes:
  - action_intent_id: string (GSI key)
  - step_functions_execution_arn: string
  - status: PENDING | EXECUTING | SUCCEEDED | FAILED | EXPIRED | COMPENSATED
  - connector_type: CRM | CALENDAR | INTERNAL
  - tool_name: string (e.g., "crm.create_task")
  - started_at: ISO timestamp
  - completed_at: ISO timestamp
  - retry_count: number
  - external_object_ids: {
      crm_task_id?: string,
      calendar_event_id?: string,
      internal_note_id?: string
    }
  - error_message?: string
  - error_type?: TRANSIENT | PERMANENT
  - compensation_status: NONE | PENDING | COMPLETED | FAILED
  - compensation_error?: string
```

**GSI:**
- `gsi1-index`: PK = `EXECUTION#action_intent_id`, SK = `status#timestamp`
  - For querying execution by action_intent_id

**TTL:**
- `completed_at + 90 days` (archive old executions)

---

### 6. SQS Queues (Optional Throttling Layer)

**Purpose:** Per-connector rate limiting

**Queues:**
- `crm-execution-queue` (10 messages/second)
- `calendar-execution-queue` (5 messages/second)
- `internal-execution-queue` (100 messages/second)

**Integration Pattern:**
- **Option A:** Step Functions → SQS → Lambda (decoupled)
- **Option B:** Step Functions → Lambda directly (simpler, throttling in Lambda)

**Recommendation:** Start with Option B (direct invocation), add SQS if throttling becomes critical

---

## Execution Flow (Detailed)

### Complete Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│ Phase 3: Approval Handler                                   │
│ - Creates ActionIntentV1 in DynamoDB                        │
│ - action_intent_id: "ai_1769391044183_k96frs"               │
│ - action_type: "CREATE_CRM_TASK"                            │
│ - parameters: { title: "...", priority: "HIGH" }            │
└────────────────────┬──────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ EventBridge: ACTION_APPROVED                                │
│ {                                                            │
│   "eventType": "ACTION_APPROVED",                           │
│   "data": {                                                  │
│     "action_intent_id": "ai_...",                           │
│     "tenant_id": "...",                                     │
│     "account_id": "..."                                     │
│   }                                                          │
│ }                                                            │
└────────────────────┬──────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ Step Functions Rule (EventBridge → Step Functions)          │
│ - Triggers state machine                                     │
│ - Execution name: "exec-{action_intent_id}" (idempotency)   │
└────────────────────┬──────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ Step Functions: VALIDATE                                     │
│ Lambda: cc-native-execution-validator                       │
│ - Fetch ActionIntentV1 from DynamoDB                        │
│ - Check: expires_at_epoch > now()                           │
│ - Check: tenant.execution_enabled = true                     │
│ - Check: action_type not in disabled_action_types[]         │
│ - Check: ExecutionRecord not exists (idempotency)           │
│ - Return: { valid: true, action_intent: {...} }             │
└────────────────────┬──────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ Step Functions: MAP_ACTION_TO_TOOL                          │
│ Lambda: cc-native-tool-mapper                                │
│ - Map action_type → tool name:                               │
│   "CREATE_CRM_TASK" → "crm.create_task"                     │
│ - Map parameters → tool arguments:                          │
│   { title, priority } → { title, priority }                  │
│ - Get Gateway URL from config                               │
│ - Get JWT token (Cognito)                                   │
│ - Return: {                                                  │
│     gateway_url: "...",                                     │
│     tool_name: "crm.create_task",                          │
│     tool_arguments: { title: "...", priority: "HIGH" },     │
│     jwt_token: "..."                                        │
│   }                                                          │
└────────────────────┬──────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ Step Functions: INVOKE_TOOL_VIA_GATEWAY                     │
│ Lambda: cc-native-mcp-gateway-client                        │
│                                                              │
│ MCP Request:                                                 │
│ POST {gateway_url}                                           │
│ Headers: { "Authorization": "Bearer {jwt_token}" }         │
│ Body: {                                                      │
│   "jsonrpc": "2.0",                                         │
│   "id": "invoke-1",                                         │
│   "method": "tools/call",                                   │
│   "params": {                                               │
│     "name": "crm.create_task",                             │
│     "arguments": { title: "...", priority: "HIGH" }         │
│   }                                                          │
│ }                                                            │
│                                                              │
│ ┌────────────────────────────────────────────────────────┐ │
│ │ AgentCore Gateway                                      │ │
│ │ - Validates JWT token (Cognito)                        │ │
│ │ - Routes to registered Lambda target                   │ │
│ │ - Gets OAuth token via AgentCore Identity              │ │
│ │ - Invokes Lambda with MCP protocol                     │ │
│ └────────────────────┬───────────────────────────────────┘ │
│                      │                                      │
│                      ▼                                      │
│ ┌────────────────────────────────────────────────────────┐ │
│ │ Lambda: CrmConnectorAdapter                            │ │
│ │ - Receives MCP tool invocation                         │ │
│ │ - Extracts: name="crm.create_task", arguments={...}   │ │
│ │ - Gets OAuth token (from Gateway context)              │ │
│ │ - Calls Salesforce REST API:                          │ │
│ │   POST /services/data/v58.0/sobjects/Task/            │ │
│ │   { Subject: "...", Priority: "High" }                 │ │
│ │ - Returns: { Id: "task_12345" }                        │ │
│ │ - Returns MCP response:                                │ │
│ │   {                                                     │ │
│ │     "jsonrpc": "2.0",                                  │ │
│ │     "id": "invoke-1",                                  │ │
│ │     "result": {                                        │ │
│ │       "content": [{                                    │ │
│ │         "type": "text",                                │ │
│ │         "text": "{\"success\": true,                  │ │
│ │                    \"external_object_id\": \"task_12345\"}" │
│ │       }]                                                │ │
│ │     }                                                   │ │
│ │   }                                                     │ │
│ └────────────────────┬───────────────────────────────────┘ │
│                      │                                      │
│                      ▼                                      │
│ MCP Response returned to Step Functions                     │
└────────────────────┬──────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ Step Functions: HANDLE_RESULT                                │
│ - Parse MCP response                                         │
│ - Extract: success, external_object_id                      │
│ - If success → RECORD_OUTCOME                               │
│ - If transient failure (5xx, timeout) → RETRY (with backoff) │
│ - If permanent failure (4xx) → COMPENSATE → RECORD_OUTCOME  │
└────────────────────┬──────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ Step Functions: RECORD_OUTCOME                              │
│ Lambda: cc-native-execution-recorder                        │
│ - Write ExecutionRecord to DynamoDB:                        │
│   {                                                          │
│     action_intent_id: "ai_...",                             │
│     status: "SUCCEEDED",                                    │
│     external_object_ids: { crm_task_id: "task_12345" },    │
│     completed_at: "2026-01-26T01:30:44.184Z"                │
│   }                                                          │
│ - Emit ledger event: ACTION_EXECUTED                        │
│ - Emit signal: ACTION_EXECUTED (for Phase 1 perception)    │
└─────────────────────────────────────────────────────────────┘
```

---

## Data Models

### ExecutionRecord (DynamoDB)

```typescript
interface ExecutionRecord {
  // Composite keys
  pk: string; // TENANT#tenant_id#ACCOUNT#account_id
  sk: string; // EXECUTION#action_intent_id
  
  // Execution metadata
  action_intent_id: string;
  step_functions_execution_arn: string;
  status: 'PENDING' | 'EXECUTING' | 'SUCCEEDED' | 'FAILED' | 'EXPIRED' | 'COMPENSATED';
  connector_type: 'CRM' | 'CALENDAR' | 'INTERNAL';
  tool_name: string; // e.g., "crm.create_task"
  
  // Timestamps
  started_at: string; // ISO timestamp
  completed_at?: string; // ISO timestamp
  
  // Retry tracking
  retry_count: number;
  
  // External system IDs
  external_object_ids: {
    crm_task_id?: string;
    calendar_event_id?: string;
    internal_note_id?: string;
  };
  
  // Error handling
  error_message?: string;
  error_type?: 'TRANSIENT' | 'PERMANENT';
  
  // Compensation
  compensation_status: 'NONE' | 'PENDING' | 'COMPLETED' | 'FAILED';
  compensation_error?: string;
  
  // TTL
  ttl?: number; // completed_at + 90 days (epoch seconds)
}
```

### MCP Tool Invocation (Gateway → Lambda)

```typescript
interface MCPToolInvocation {
  jsonrpc: '2.0';
  id: string;
  method: 'tools/call';
  params: {
    name: string; // Tool name (e.g., "crm.create_task")
    arguments: Record<string, any>; // Tool parameters
  };
  identity?: {
    accessToken: string; // OAuth token from AgentCore Identity
    tenantId: string;
  };
}
```

### MCP Tool Response (Lambda → Gateway)

```typescript
interface MCPToolResponse {
  jsonrpc: '2.0';
  id: string;
  result?: {
    content: Array<{
      type: 'text';
      text: string; // JSON stringified result
    }>;
  };
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}
```

---

## Security Architecture

### Authentication Layers

1. **Inbound Authentication (Agent → Gateway)**
   - JWT token from Cognito User Pool
   - Validated by Gateway's CUSTOM_JWT authorizer
   - Token includes tenant_id, user_id

2. **Outbound Authentication (Gateway → External Systems)**
   - OAuth tokens from AgentCore Identity
   - Per-connector credential providers
   - Automatic token refresh

### Authorization

- **Tenant-level:** Execution enabled/disabled per tenant
- **Action-type-level:** Specific action types can be disabled
- **Global:** Emergency stop via AppConfig/Environment variable

### Network Isolation

- **Initial:** Public subnets (most SaaS APIs are public HTTPS)
- **Future:** VPC endpoints if specific connectors require it
- **Zero Trust:** All traffic encrypted (TLS), authenticated, audited

---

## Error Handling & Retry Strategy

### Error Classification

**Transient Errors (Retry):**
- HTTP 5xx (server errors)
- Timeouts
- Rate limiting (429)
- Network errors

**Permanent Errors (No Retry):**
- HTTP 4xx (client errors, validation failures)
- Authentication failures (401, 403)
- Invalid parameters

### Retry Logic

- **Exponential Backoff:** 1s, 2s, 4s, 8s
- **Max Retries:** From `ActionIntentV1.execution_policy.retry_count` (default: 3)
- **Retry Only:** Transient errors
- **Permanent Errors:** Fail immediately, trigger compensation

### Compensation Strategy

**Automatic Compensation (Reversible Actions):**
- Internal writes: Delete/update
- CRM task creation: Delete task (if API supports)
- Calendar drafts: Delete draft

**Manual Compensation (Complex Cases):**
- Multi-step actions
- Actions with side effects
- Phase 5+ enhancement

---

## Observability

### CloudWatch Metrics

- `ExecutionStarted` (count)
- `ExecutionSucceeded` (count)
- `ExecutionFailed` (count, by error type)
- `ExecutionDuration` (histogram: p50, p95, p99)
- `RetryCount` (distribution)
- `ConnectorLatency` (per connector type)
- `CompensationAttempted` (count)
- `CompensationSucceeded` (count)
- `CompensationFailed` (count)

### CloudWatch Logs

- Step Functions execution logs
- Lambda adapter logs (structured JSON)
- Gateway access logs (if available)
- All logs include: `action_intent_id`, `trace_id`, `tenant_id`

### X-Ray Tracing

- Trace execution flow: Step Functions → Gateway → Lambda → External API
- Identify bottlenecks
- Debug failures

---

## Idempotency Enforcement

### Defense in Depth

1. **Step Functions Execution Name**
   - Use `action_intent_id` as execution name
   - Step Functions enforces uniqueness

2. **DynamoDB Conditional Write**
   - ExecutionRecord write: `attribute_not_exists(action_intent_id)`
   - Prevents duplicate execution records

3. **Connector-Level Idempotency**
   - External APIs: Use idempotency keys where supported
   - Internal writes: Check existence before create

---

## Kill Switches & Safety Controls

### Per-Tenant Execution Toggle

**DynamoDB Tenant Config:**
```typescript
interface TenantExecutionConfig {
  tenant_id: string;
  execution_enabled: boolean;
  disabled_action_types: string[]; // e.g., ["SEND_EMAIL", "UPDATE_CRM"]
}
```

### Per-Action-Type Disablement

- Action types can be disabled globally or per-tenant
- Checked in `ValidateExecution` state

### Global Emergency Stop

- **AppConfig:** Feature flag for global execution stop
- **Environment Variable:** `EXECUTION_ENABLED=false`
- Checked before any execution starts

---

## Tool Registration Pattern

### Lambda as Gateway Target

**Registration Flow:**
1. Create Lambda function (connector adapter)
2. Create OAuth credential provider (AgentCore Identity)
3. Register Lambda as Gateway target via `create_gateway_target` API
4. Gateway synchronizes tools (implicit on create, explicit via API)

**Tool Schema Definition:**
- Tool name: `crm.create_task`
- Tool description: "Create a task in CRM system"
- Input schema: JSON Schema for parameters
- Output schema: JSON Schema for result

**CDK Pattern (if supported):**
```typescript
// Register Lambda as Gateway target
const crmTarget = new bedrockAgentCore.GatewayTarget(this, 'CrmTarget', {
  gateway: executionGateway,
  name: 'crm-connector',
  targetConfiguration: {
    lambda: {
      functionArn: crmConnectorAdapter.functionArn,
    },
  },
  credentialProviderConfigurations: [{
    credentialProviderType: 'OAUTH',
    credentialProvider: {
      oauthCredentialProvider: {
        providerArn: crmCredentialProvider.credentialProviderArn,
        scopes: ['salesforce_api'],
      },
    },
  }],
});
```

---

## Implementation Phases

### Phase 4.0 (Initial - Direct Pattern)
- Step Functions → Lambda directly (bypass Gateway)
- Simpler, faster to implement
- Direct control over execution

### Phase 4.1 (Evolution - Gateway Pattern)
- Register tools in AgentCore Gateway
- Route execution through Gateway
- Gain unified auth, governance, audit

**Migration Path:**
- Keep direct pattern working
- Add Gateway in parallel
- Gradually migrate connectors
- Switch routing when ready

---

## Key Architectural Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Orchestration | Step Functions | Built-in retry, compensation, state persistence |
| Tool Execution | AgentCore Gateway (MCP) | Unified auth, governance, matches architecture doc |
| Connector Pattern | Lambda per connector | Isolation, independent scaling, per-connector IAM |
| Execution Trigger | EventBridge event | Immediate, event-driven, matches Phase 3 pattern |
| State Storage | DynamoDB + Step Functions | Queryability + orchestration state |
| Throttling | SQS (optional) | Per-connector rate limiting, decoupling |
| Network | Public subnets (initially) | Most SaaS APIs are public HTTPS |
| Compensation | Automatic (reversible) | Faster recovery, better UX |
| Kill Switches | DynamoDB + AppConfig | Per-tenant + global controls |

---

## Next Steps

1. ✅ Architecture defined
2. ⏳ Verify CDK support for AgentCore Gateway
3. ⏳ Design MCP client Lambda for Step Functions
4. ⏳ Design tool registration pattern
5. ⏳ Design AgentCore Identity setup
6. ⏳ Create code-level implementation plan

---

## References

- [AgentCore Gateway MCP Architecture Blog](https://aws.amazon.com/blogs/machine-learning/transform-your-mcp-architecture-unite-mcp-servers-through-agentcore-gateway/)
- [AgentCore Gateway Developer Guide](https://docs.aws.amazon.com/bedrock/latest/userguide/agentcore-gateway.html)
- [MCP Protocol Specification](https://modelcontextprotocol.io/)
