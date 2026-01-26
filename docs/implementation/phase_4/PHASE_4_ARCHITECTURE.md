# Phase 4 Architecture: Bounded Execution & AI-Native Action Fulfillment

**Status:** 🟡 **ARCHITECTURE DEFINED**  
**Created:** 2026-01-26  
**Last Updated:** 2026-01-26

---

## Executive Summary

Phase 4 implements **bounded execution** of approved `ActionIntentV1` objects through **Amazon Bedrock AgentCore Gateway** using the **MCP (Model Context Protocol)**. The architecture ensures execution is **deterministic, auditable, and reversible** without introducing new decision-making or LLM judgment.

**Key Principle:**
> **Execution never re-decides. It only fulfills.**

**Non-Goals:**
- Phase 4 does not optimize, rank, or learn from execution outcomes
- Phase 4 does not auto-adjust based on execution data
- Phase 4 does not hide failures from users
- Phase 4 does not introduce new decision-making or LLM judgment

**Design Philosophy:**
> Execution is **observational and procedural, not adaptive**. We retry for reliability, but we never hide outcomes. Trust beats smoothness.

---

## Architecture Overview

### High-Level Flow

```
Phase 3: Approved ActionIntent
  ↓ (idempotent execution key: action_intent_id)
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

**Idempotency Design:**
- Execution key: `action_intent_id` (enforced at Step Functions and DynamoDB levels)
- Adapters do not invent their own execution identity
- Same intent cannot execute twice, even across retries

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
  "StartAt": "StartExecution",
  "States": {
    "StartExecution": {
      "Type": "Task",
      "Resource": "arn:aws:states:::lambda:invoke",
      "Parameters": {
        "FunctionName": "cc-native-execution-starter",
        "Payload": {
          "action_intent_id": "$.action_intent_id"
        }
      },
      "Next": "ValidatePreflight"
    },
    "ValidatePreflight": {
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
    "InvokeTool": {
      "Type": "Task",
      "Resource": "arn:aws:states:::lambda:invoke",
      "Parameters": {
        "FunctionName": "cc-native-tool-invoker",
        "Payload": {
          "gateway_url": "$.gateway_url",
          "tool_name": "$.tool_name",
          "tool_arguments": "$.tool_arguments",
          "idempotency_key": "$.idempotency_key",
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

1. **StartExecution** (NEW - Execution Attempt Locking)
   - Create `ExecutionAttempt` record in DynamoDB with conditional write
   - `action_intent_id` + `attempt_id` + `status = RUNNING`
   - Generate `idempotency_key = hash(tenant_id + action_intent_id + tool_name + normalized_params + version)`
   - Emit ledger event: `EXECUTION_STARTED`
   - If execution already exists → fail with "already executing" reason
   - **Purpose:** Exactly-once execution guarantee (prevents double-execution from Step Functions retries or EventBridge duplicates)

2. **ValidatePreflight** (Split from ValidateExecution)
   - Fetch `ActionIntentV1` from DynamoDB
   - Check expiration (`expires_at_epoch`)
   - Check kill switches (tenant execution enabled, action type not disabled)
   - Check required parameters present
   - Check budget/rate limits if applicable
   - If invalid → fail with reason

3. **MapActionToTool** (Deterministic + Versioned)
   - Lookup in `ActionTypeRegistry` (DynamoDB table or AppConfig)
   - Map `ActionIntentV1.action_type` → MCP tool name + schema version
   - Map `ActionIntentV1.parameters` → tool arguments (using schema version)
   - Extract: `tool_name`, `tool_schema_version`, `required_scopes`, `risk_class`, `compensation_strategy`
   - Example: `CREATE_CRM_TASK` → `crm.create_task` (v1.0)
   - **Purpose:** Versioned mapping ensures old ActionIntents remain executable or fail cleanly

4. **InvokeTool** (ToolInvoker Lambda → Gateway)
   - ToolInvoker Lambda makes MCP protocol call to AgentCore Gateway
   - Centralizes MCP protocol handling, auth/JWT signing, retries, timeouts, logging
   - Passes `idempotency_key` to adapter for dual-layer idempotency
   - Handles retries for transient failures (with backoff)
   - Parses MCP response
   - Captures `ToolRunRef` + raw response pointer (S3 if large)
   - **Purpose:** Clean separation, swap Gateway endpoints without touching state machine

5. **Runtime Guards** (Implicit in InvokeTool retry logic)
   - Timeout enforcement
   - Circuit breaker per connector
   - Backoff discipline
   - "Stop retrying" classification for 4xx errors (permanent failures)

6. **CompensateAction**
   - Rollback if action is reversible (based on `compensation_strategy` from registry)
   - Call compensation tool via Gateway
   - Handle compensation failures

7. **RecordOutcome** (Structured Outcome Contract)
   - Write `ActionOutcomeV1` (structured) to DynamoDB
   - Store raw response artifact pointer (S3) if needed
   - Outcome fields:
     - `status: SUCCEEDED | FAILED | RETRYING | CANCELLED`
     - `external_object_refs[]` (e.g., CRM task ID)
     - `error_code` + `error_class` (AUTH, RATE_LIMIT, VALIDATION, DOWNSTREAM)
     - `attempt_count`
     - `completed_at`
     - `tool_run_ref` (traceable to gateway invocation)
   - Emit ledger event: `ACTION_EXECUTED` or `ACTION_FAILED`
   - Emit signal for Phase 1 perception layer
   - **Purpose:** Normalized outcomes for future learning, analytics, debugging

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

### ExecutionAttempt (DynamoDB) - Execution Locking

```typescript
interface ExecutionAttempt {
  // Composite keys
  pk: string; // TENANT#tenant_id#ACCOUNT#account_id
  sk: string; // EXECUTION#action_intent_id
  
  // Execution locking
  action_intent_id: string;
  attempt_id: string; // Unique per attempt (for retries)
  status: 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
  idempotency_key: string; // hash(tenant_id + action_intent_id + tool_name + normalized_params + version)
  
  // Timestamps
  started_at: string; // ISO timestamp
  
  // TTL (for cleanup of stuck RUNNING states)
  ttl?: number; // started_at + 1 hour (epoch seconds)
}
```

### ActionOutcomeV1 (DynamoDB) - Structured Outcome

```typescript
interface ActionOutcomeV1 {
  // Composite keys
  pk: string; // TENANT#tenant_id#ACCOUNT#account_id
  sk: string; // OUTCOME#action_intent_id
  
  // Outcome metadata
  action_intent_id: string;
  status: 'SUCCEEDED' | 'FAILED' | 'RETRYING' | 'CANCELLED';
  
  // External system references
  external_object_refs: Array<{
    system: 'CRM' | 'CALENDAR' | 'INTERNAL';
    object_type: string; // e.g., "Task", "Event", "Note"
    object_id: string; // External system ID
    object_url?: string; // Link to external object (if available)
  }>;
  
  // Error classification
  error_code?: string; // e.g., "AUTH_FAILED", "RATE_LIMIT", "VALIDATION_ERROR"
  error_class?: 'AUTH' | 'RATE_LIMIT' | 'VALIDATION' | 'DOWNSTREAM' | 'TIMEOUT' | 'UNKNOWN';
  error_message?: string;
  
  // Execution metadata
  attempt_count: number;
  tool_name: string; // e.g., "crm.create_task"
  tool_schema_version: string; // e.g., "v1.0"
  tool_run_ref: string; // Reference to Gateway invocation (for traceability)
  raw_response_artifact_ref?: string; // S3 pointer if response is large
  
  // Timestamps
  started_at: string; // ISO timestamp
  completed_at: string; // ISO timestamp
  
  // Compensation
  compensation_status: 'NONE' | 'PENDING' | 'COMPLETED' | 'FAILED';
  compensation_error?: string;
  
  // TTL
  ttl?: number; // completed_at + 90 days (epoch seconds)
}
```

### ActionTypeRegistry (DynamoDB) - Versioned Tool Mapping

```typescript
interface ActionTypeRegistry {
  // Composite keys
  pk: string; // ACTION_TYPE#action_type
  sk: string; // VERSION#schema_version
  
  // Mapping metadata
  action_type: string; // e.g., "CREATE_CRM_TASK"
  tool_name: string; // e.g., "crm.create_task"
  tool_schema_version: string; // e.g., "v1.0"
  
  // Tool configuration
  required_scopes: string[]; // OAuth scopes required
  risk_class: 'MINIMAL' | 'LOW' | 'MEDIUM' | 'HIGH';
  compensation_strategy: 'AUTOMATIC' | 'MANUAL' | 'NONE';
  
  // Parameter mapping
  parameter_mapping: {
    [actionParam: string]: {
      toolParam: string;
      transform?: 'PASSTHROUGH' | 'UPPERCASE' | 'LOWERCASE' | 'CUSTOM';
      required: boolean;
    };
  };
  
  // Metadata
  created_at: string;
  deprecated_at?: string; // If deprecated, old ActionIntents may still use this version
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

### Dual-Layer Idempotency (Defense in Depth)

**Layer 1: Orchestrator Level (ExecutionAttempt)**
- **Purpose:** Prevent duplicate Step Functions executions
- **Mechanism:** DynamoDB conditional write on `ExecutionAttempt`
  - Condition: `attribute_not_exists(action_intent_id) OR status IN [SUCCEEDED, FAILED, CANCELLED]`
  - If execution already RUNNING → fail with "already executing"
- **Enforced at:** `START_EXECUTION` state
- **Why:** Step Functions can retry; EventBridge can deliver twice

**Layer 2: Adapter Level (External Write Dedupe)**
- **Purpose:** Prevent duplicate external API calls
- **Mechanism:** 
  - Generate: `idempotency_key = hash(tenant_id + action_intent_id + tool_name + normalized_params + version)`
  - Use as: External API idempotency header (if supported) OR DynamoDB `external_write_dedupe` table key
- **Enforced at:** Connector adapter Lambda
- **Why:** External APIs may not support idempotency; adapter must handle it

**Idempotency Key Generation:**
```typescript
function generateIdempotencyKey(
  tenantId: string,
  actionIntentId: string,
  toolName: string,
  normalizedParams: Record<string, any>,
  schemaVersion: string
): string {
  const normalized = JSON.stringify(normalizedParams, Object.keys(normalizedParams).sort());
  const input = `${tenantId}:${actionIntentId}:${toolName}:${normalized}:${schemaVersion}`;
  return createHash('sha256').update(input, 'utf8').digest('hex');
}
```

**Additional Safeguards:**
- Step Functions execution name: `exec-{action_intent_id}` (enforces uniqueness)
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
| Gateway Client | ToolInvoker Lambda | Centralizes MCP protocol, allows endpoint swapping |
| Connector Pattern | Lambda per connector | Isolation, independent scaling, per-connector IAM |
| Execution Trigger | EventBridge event | Immediate, event-driven, matches Phase 3 pattern |
| Execution Locking | ExecutionAttempt table | Exactly-once guarantee (prevents double-execution) |
| Idempotency | Dual-layer (orchestrator + adapter) | Defense in depth against duplicates |
| Tool Mapping | ActionTypeRegistry (versioned) | Deterministic, supports schema evolution |
| Validation | Split (preflight + runtime guards) | Clear separation of concerns |
| Outcome Storage | ActionOutcomeV1 (structured) | Normalized for analytics, debugging, future learning |
| State Storage | DynamoDB + Step Functions | Queryability + orchestration state |
| Throttling | SQS (optional) | Per-connector rate limiting, decoupling |
| Network | Public subnets (initially) | Most SaaS APIs are public HTTPS |
| Compensation | Automatic (reversible) | Faster recovery, better UX |
| Kill Switches | DynamoDB + AppConfig | Per-tenant + global controls |

---

## Readiness Checklist

Phase 4 is ready to implement when you can say "yes" to all of these:

- [ ] Every execution can be replayed deterministically
- [ ] Every external write has a clear compensating action *or* a documented irreversibility
- [ ] Every failure ends in a visible terminal state
- [ ] No code path calls an LLM after approval
- [ ] Kill switches work without redeploy

**Note:** These are design invariants, not implementation tasks. The architecture must support all five.

**Design Philosophy:**
> Phase 4 should feel **boring, procedural, and conservative**. That's a feature. When this phase is done well, Phase 5 becomes *possible* — not dangerous.

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
