# Phase 4 — Code-Level Implementation Plan

**Status:** 🟡 **PLANNING**  
**Created:** 2026-01-26  
**Last Updated:** 2026-01-26  
**Note:** All corrections from initial review have been incorporated into sub-phase documents (Phase 4.1, 4.2, 4.3, 4.4, 4.5)

---

## Overview

This document provides a high-level overview and cross-reference for Phase 4: Bounded Execution & AI-Native Action Fulfillment. **Detailed implementation plans are split into sub-phase documents for easier review and updates.**

**Key Architectural Refinements:**
1. ExecutionAttempt record (exactly-once guarantee)
2. Dual-layer idempotency (orchestrator + adapter)
3. Versioned ActionTypeRegistry (deterministic tool mapping)
4. Split validation (preflight + runtime guards)
5. Structured ActionOutcomeV1 contract
6. ToolInvoker Lambda (MCP Gateway client)

---

## Sub-Phase Documents

For detailed implementation plans, see:
- **Phase 4.1:** `PHASE_4_1_CODE_LEVEL_PLAN.md` - Foundation (Type definitions, Services, Initial handlers)
- **Phase 4.2:** `PHASE_4_2_CODE_LEVEL_PLAN.md` - Orchestration (Step Functions, Tool handlers, Compensation)
- **Phase 4.3:** `PHASE_4_3_CODE_LEVEL_PLAN.md` - Connectors (Adapter interface, Internal/CRM adapters, Gateway setup)
- **Phase 4.4:** `PHASE_4_4_CODE_LEVEL_PLAN.md` - Safety & Outcomes (Signal emission, Status API, Alarms)
- **Phase 4.5:** `PHASE_4_5_CODE_LEVEL_PLAN.md` - Testing & Polish (Unit/Integration/E2E tests, Documentation)

**Note:** This main document serves as a reference and overview. All detailed code-level plans are in the sub-phase documents above.

**Important:** Code examples in this document are for reference only. For the most up-to-date and detailed implementation code, see the sub-phase documents:
- Phase 4.1: `PHASE_4_1_CODE_LEVEL_PLAN.md`
- Phase 4.2: `PHASE_4_2_CODE_LEVEL_PLAN.md`
- Phase 4.3: `PHASE_4_3_CODE_LEVEL_PLAN.md`
- Phase 4.4: `PHASE_4_4_CODE_LEVEL_PLAN.md`
- Phase 4.5: `PHASE_4_5_CODE_LEVEL_PLAN.md`

**Region Handling Pattern (consistent with Phase 3):**
- In CDK: `const region = props.region || cdk.Stack.of(this).region;`
- In Lambda environment variables: **Do NOT set AWS_REGION** - it's automatically provided by Lambda runtime
- In Lambda handler code: Use `process.env.AWS_REGION` directly (validate with `requireEnv()` helper)

---

## Prerequisites (Before Starting Implementation)

**Critical:** The following changes must be made to existing code before Phase 4 implementation begins:

### 1. ActionIntentService.getIntent() Visibility

**File:** `src/services/decision/ActionIntentService.ts`

**Change:** Make `getIntent()` method public (currently private)

```typescript
// Change from:
private async getIntent(intentId: string, tenantId: string, accountId: string): Promise<ActionIntentV1 | null>

// To:
public async getIntent(intentId: string, tenantId: string, accountId: string): Promise<ActionIntentV1 | null>
```

**Reason:** Phase 4 execution handlers need to fetch ActionIntentV1 records.

**See:** `PHASE_4_1_CODE_LEVEL_PLAN.md` - Section 5 (Prerequisites) for details.

### 2. LedgerEventType Enum Updates

**File:** `src/types/LedgerTypes.ts`

**Change:** Add Phase 4 execution event types

```typescript
export enum LedgerEventType {
  // ... existing values ...
  // Phase 4: Execution Layer events
  EXECUTION_STARTED = 'EXECUTION_STARTED',
  ACTION_EXECUTED = 'ACTION_EXECUTED',
  ACTION_FAILED = 'ACTION_FAILED',
}
```

**Reason:** Execution handlers need to log execution lifecycle events to the ledger.

**See:** `PHASE_4_1_CODE_LEVEL_PLAN.md` - Section 5 (Prerequisites) for details.

### 3. SignalType Enum Updates

**File:** `src/types/SignalTypes.ts`

**Change:** Add execution outcome signal types and supporting configuration

1. Add new SignalType values:
   ```typescript
   ACTION_EXECUTED = 'ACTION_EXECUTED',
   ACTION_FAILED = 'ACTION_FAILED',
   ```

2. Add window key derivation logic to `WINDOW_KEY_DERIVATION` mapping
3. Add TTL configuration to `DEFAULT_SIGNAL_TTL` mapping

**Reason:** Phase 4.4 signal emission needs these signal types to feed execution outcomes back into the perception layer.

**See:** `PHASE_4_1_CODE_LEVEL_PLAN.md` - Section 5 (Prerequisites) and `PHASE_4_4_CODE_LEVEL_PLAN.md` - Section 1 for complete details.

---

## Implementation Order

### Phase 4.1: Foundation (Week 1-2)
1. Type definitions
2. DynamoDB tables (CDK)
3. ExecutionAttempt service
4. ActionTypeRegistry service
5. Execution starter handler
6. Execution validator handler

### Phase 4.2: Orchestration (Week 2-3)
7. Step Functions state machine (CDK)
8. Tool mapper handler
9. ToolInvoker Lambda (MCP Gateway client)
10. Execution recorder handler

### Phase 4.3: Connectors (Week 3-5)
11. Connector adapter interface
12. Internal systems adapter
13. CRM adapter (initial)
14. AgentCore Gateway setup (CDK)

### Phase 4.4: Safety & Outcomes (Week 5-6)
15. Kill switch service
16. Outcome recording service
17. Signal emission
18. Execution status API

### Phase 4.5: Testing & Polish (Week 6-7)
19. Unit tests
20. Integration tests
21. End-to-end tests
22. Documentation

---

## Quick Reference: Component Locations

### Type Definitions
**Location:** `PHASE_4_1_CODE_LEVEL_PLAN.md` - Section 1
- `src/types/ExecutionTypes.ts`
- `src/types/MCPTypes.ts`
- `src/types/LedgerTypes.ts` (updates)

### Service Layer
**Location:** `PHASE_4_1_CODE_LEVEL_PLAN.md` - Section 2
- `src/services/execution/ExecutionAttemptService.ts`
- `src/services/execution/ActionTypeRegistryService.ts`
- `src/services/execution/IdempotencyService.ts`
- `src/services/execution/ExecutionOutcomeService.ts`
- `src/services/execution/KillSwitchService.ts`

### Lambda Handlers
**Location:** 
- Phase 4.1: `PHASE_4_1_CODE_LEVEL_PLAN.md` - Section 3 (execution-starter, execution-validator)
- Phase 4.2: `PHASE_4_2_CODE_LEVEL_PLAN.md` - Section 1 (tool-mapper, tool-invoker, execution-recorder, compensation)
- Phase 4.4: `PHASE_4_4_CODE_LEVEL_PLAN.md` - Section 2 (execution-status-api)

### CDK Infrastructure
**Location:**
- Phase 4.1: `PHASE_4_1_CODE_LEVEL_PLAN.md` - Section 4 (Tables, Phase 4.1 handlers)
- Phase 4.2: `PHASE_4_2_CODE_LEVEL_PLAN.md` - Section 2 (Step Functions, EventBridge, Phase 4.2 handlers)
- Phase 4.3: `PHASE_4_3_CODE_LEVEL_PLAN.md` - Section 4 (AgentCore Gateway)
- Phase 4.4: `PHASE_4_4_CODE_LEVEL_PLAN.md` - Section 3 (CloudWatch alarms, API Gateway)

### Connector Adapters
**Location:** `PHASE_4_3_CODE_LEVEL_PLAN.md` - Sections 1-3
- `src/adapters/IConnectorAdapter.ts`
- `src/adapters/internal/InternalConnectorAdapter.ts`
- `src/adapters/crm/CrmConnectorAdapter.ts`

### Testing
**Location:** `PHASE_4_5_CODE_LEVEL_PLAN.md` - Sections 1-3
- Unit tests
- Integration tests
- End-to-end tests

---

## Detailed Implementation Plans

**Note:** The following sections provide a complete reference. For focused implementation, use the sub-phase documents listed above.

---

## 1. Type Definitions

### File: `src/types/ExecutionTypes.ts`

**Purpose:** Type definitions for execution layer

**Types to Define:**

```typescript
/**
 * ExecutionAttempt - Execution locking record
 * Prevents double-execution from Step Functions retries or EventBridge duplicates
 */
export interface ExecutionAttempt {
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
  
  // Metadata
  tenant_id: string;
  account_id: string;
  trace_id: string;
  
  // TTL (for cleanup of stuck RUNNING states)
  ttl?: number; // started_at + 1 hour (epoch seconds)
}

/**
 * ActionOutcomeV1 - Structured execution outcome
 * Normalized for analytics, debugging, future learning
 */
export interface ActionOutcomeV1 {
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
  
  // Metadata
  tenant_id: string;
  account_id: string;
  trace_id: string;
  
  // TTL
  ttl?: number; // completed_at + 90 days (epoch seconds)
}

/**
 * ActionTypeRegistry - Versioned tool mapping
 * Ensures old ActionIntents remain executable or fail cleanly
 */
export interface ActionTypeRegistry {
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

/**
 * ExternalWriteDedupe - Adapter-level idempotency
 * Used when external API doesn't support idempotency headers
 */
export interface ExternalWriteDedupe {
  // Composite keys
  pk: string; // IDEMPOTENCY_KEY#hash(...)
  sk: string; // TIMESTAMP#timestamp
  
  // Dedupe metadata
  idempotency_key: string;
  external_object_id: string; // Result from external API
  action_intent_id: string;
  tool_name: string;
  
  // Timestamps
  created_at: string; // ISO timestamp
  
  // TTL
  ttl?: number; // created_at + 7 days (epoch seconds)
}

/**
 * ToolInvocationRequest - ToolInvoker Lambda input
 */
export interface ToolInvocationRequest {
  gateway_url: string;
  tool_name: string;
  tool_arguments: Record<string, any>;
  idempotency_key: string; // Passed to adapter for dual-layer idempotency
  jwt_token: string;
  action_intent_id: string;
  tenant_id: string;
  account_id: string;
  trace_id: string;
}

/**
 * ToolInvocationResponse - ToolInvoker Lambda output
 */
export interface ToolInvocationResponse {
  success: boolean;
  external_object_refs?: Array<{
    system: string;
    object_type: string;
    object_id: string;
    object_url?: string;
  }>;
  tool_run_ref: string; // Gateway invocation reference
  raw_response_artifact_ref?: string; // S3 pointer if large
  error_code?: string;
  error_class?: 'AUTH' | 'RATE_LIMIT' | 'VALIDATION' | 'DOWNSTREAM' | 'TIMEOUT' | 'UNKNOWN';
  error_message?: string;
}

/**
 * ExecutionStatus - API response for execution status
 */
export interface ExecutionStatus {
  action_intent_id: string;
  status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'EXPIRED';
  started_at?: string;
  completed_at?: string;
  external_object_refs?: ActionOutcomeV1['external_object_refs'];
  error_message?: string;
  error_class?: ActionOutcomeV1['error_class'];
  attempt_count?: number;
}

/**
 * KillSwitchConfig - Execution safety controls
 */
export interface KillSwitchConfig {
  tenant_id: string;
  execution_enabled: boolean;
  disabled_action_types: string[]; // Action types disabled for this tenant
  global_emergency_stop?: boolean; // Environment-level override
}
```

### File: `src/types/MCPTypes.ts`

**Purpose:** MCP (Model Context Protocol) type definitions for tool invocation

**Types to Define:**

```typescript
/**
 * MCP (Model Context Protocol) Types
 * JSON-RPC 2.0 based protocol for tool invocation
 */

/**
 * MCP Tool Invocation (Gateway → Lambda Adapter)
 */
export interface MCPToolInvocation {
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
    userId?: string;
  };
}

/**
 * MCP Tool Response (Lambda Adapter → Gateway)
 */
export interface MCPResponse {
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

/**
 * MCP Tools List Response
 */
export interface MCPToolsListResponse {
  jsonrpc: '2.0';
  id: string;
  result: {
    tools: Array<{
      name: string;
      description: string;
      inputSchema: Record<string, any>; // JSON Schema
    }>;
  };
}
```

**Note:** These types are used by connector adapters to receive MCP invocations from AgentCore Gateway and return MCP responses.

---

### File: `src/types/LedgerTypes.ts` (Update)

**Purpose:** Add missing LedgerEventType values for Phase 4

**Add to existing enum:**

```typescript
export enum LedgerEventType {
  // ... existing values ...
  EXECUTION_STARTED = 'EXECUTION_STARTED',
  ACTION_EXECUTED = 'ACTION_EXECUTED',
  ACTION_FAILED = 'ACTION_FAILED',
}
```

**Note:** These new event types are used by execution handlers to record execution lifecycle events in the ledger.

---

**Validation Schemas (Zod):**

```typescript
import { z } from 'zod';

export const ExecutionAttemptSchema = z.object({
  pk: z.string(),
  sk: z.string(),
  action_intent_id: z.string(),
  attempt_id: z.string(),
  status: z.enum(['RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED']),
  idempotency_key: z.string(),
  started_at: z.string(),
  tenant_id: z.string(),
  account_id: z.string(),
  trace_id: z.string(),
  ttl: z.number().optional(),
}).strict();

export const ActionOutcomeV1Schema = z.object({
  pk: z.string(),
  sk: z.string(),
  action_intent_id: z.string(),
  status: z.enum(['SUCCEEDED', 'FAILED', 'RETRYING', 'CANCELLED']),
  external_object_refs: z.array(z.object({
    system: z.enum(['CRM', 'CALENDAR', 'INTERNAL']),
    object_type: z.string(),
    object_id: z.string(),
    object_url: z.string().optional(),
  })),
  error_code: z.string().optional(),
  error_class: z.enum(['AUTH', 'RATE_LIMIT', 'VALIDATION', 'DOWNSTREAM', 'TIMEOUT', 'UNKNOWN']).optional(),
  error_message: z.string().optional(),
  attempt_count: z.number(),
  tool_name: z.string(),
  tool_schema_version: z.string(),
  tool_run_ref: z.string(),
  raw_response_artifact_ref: z.string().optional(),
  started_at: z.string(),
  completed_at: z.string(),
  compensation_status: z.enum(['NONE', 'PENDING', 'COMPLETED', 'FAILED']),
  compensation_error: z.string().optional(),
  tenant_id: z.string(),
  account_id: z.string(),
  trace_id: z.string(),
  ttl: z.number().optional(),
}).strict();

// ... additional schemas for other types
```

---

## 2. Service Layer

### File: `src/services/execution/ExecutionAttemptService.ts`

**Purpose:** Manage execution attempt locking (exactly-once guarantee)

**Methods:**

```typescript
import { DynamoDBDocumentClient, PutCommand, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

export class ExecutionAttemptService {
  constructor(
    private dynamoClient: DynamoDBDocumentClient,
    private tableName: string,
    private logger: Logger
  ) {}

  /**
   * Start execution attempt (conditional write for idempotency)
   * Returns attempt if created, throws if already exists
   * 
   * Note: DynamoDB doesn't support OR in ConditionExpression, so we check existing state first
   */
  async startAttempt(
    actionIntentId: string,
    tenantId: string,
    accountId: string,
    traceId: string,
    idempotencyKey: string
  ): Promise<ExecutionAttempt> {
    const attemptId = `attempt_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const startedAt = new Date().toISOString();
    const ttl = Math.floor(Date.now() / 1000) + 3600; // 1 hour TTL
    
    const pk = `TENANT#${tenantId}#ACCOUNT#${accountId}`;
    const sk = `EXECUTION#${actionIntentId}`;
    
    // First, check if execution already exists
    const existing = await this.getAttempt(actionIntentId, tenantId, accountId);
    
    if (existing) {
      // Check if status is terminal
      if (!['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(existing.status)) {
        throw new Error(`Execution already in progress for action_intent_id: ${actionIntentId}`);
      }
      // If terminal, allow new attempt (or update existing with new attempt_id)
    }
    
    const attempt: ExecutionAttempt = {
      pk,
      sk,
      action_intent_id: actionIntentId,
      attempt_id: attemptId,
      status: 'RUNNING',
      idempotency_key: idempotencyKey,
      started_at: startedAt,
      tenant_id: tenantId,
      account_id: accountId,
      trace_id: traceId,
      ttl,
    };
    
    try {
      // Conditional write: only succeed if execution doesn't exist
      await this.dynamoClient.send(new PutCommand({
        TableName: this.tableName,
        Item: attempt,
        ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)',
      }));
      
      return attempt;
    } catch (error: any) {
      if (error.name === 'ConditionalCheckFailedException') {
        // Race condition: another execution started between check and put
        throw new Error(`Execution already in progress for action_intent_id: ${actionIntentId}`);
      }
      throw error;
    }
  }

  /**
   * Update attempt status (terminal states only)
   */
  async updateStatus(
    actionIntentId: string,
    tenantId: string,
    accountId: string,
    status: 'SUCCEEDED' | 'FAILED' | 'CANCELLED'
  ): Promise<void> {
    await this.dynamoClient.send(new UpdateCommand({
      TableName: this.tableName,
      Key: {
        pk: `TENANT#${tenantId}#ACCOUNT#${accountId}`,
        sk: `EXECUTION#${actionIntentId}`,
      },
      UpdateExpression: 'SET #status = :status',
      ExpressionAttributeNames: {
        '#status': 'status',
      },
      ExpressionAttributeValues: {
        ':status': status,
      },
    }));
  }

  /**
   * Get attempt by action_intent_id
   */
  async getAttempt(
    actionIntentId: string,
    tenantId: string,
    accountId: string
  ): Promise<ExecutionAttempt | null> {
    const result = await this.dynamoClient.send(new GetCommand({
      TableName: this.tableName,
      Key: {
        pk: `TENANT#${tenantId}#ACCOUNT#${accountId}`,
        sk: `EXECUTION#${actionIntentId}`,
      },
    }));
    
    return result.Item as ExecutionAttempt | null;
  }
}
```

### File: `src/services/execution/ActionTypeRegistryService.ts`

**Purpose:** Manage versioned tool mapping (deterministic, supports schema evolution)

**Methods:**

```typescript
export class ActionTypeRegistryService {
  constructor(
    private dynamoClient: DynamoDBDocumentClient,
    private tableName: string,
    private logger: Logger
  ) {}

  /**
   * Get tool mapping for action type and schema version
   * Falls back to latest version if schema_version not specified
   * 
   * Note: Requires GSI with created_at as sort key for latest version lookup
   */
  async getToolMapping(
    actionType: string,
    schemaVersion?: string
  ): Promise<ActionTypeRegistry | null> {
    if (schemaVersion) {
      // Get specific version
      const result = await this.dynamoClient.send(new GetCommand({
        TableName: this.tableName,
        Key: {
          pk: `ACTION_TYPE#${actionType}`,
          sk: `VERSION#${schemaVersion}`,
        },
      }));
      
      return result.Item as ActionTypeRegistry | null;
    } else {
      // Get latest version (query GSI by created_at desc)
      const result = await this.dynamoClient.send(new QueryCommand({
        TableName: this.tableName,
        IndexName: 'created-at-index', // GSI with created_at as sort key
        KeyConditionExpression: 'pk = :pk',
        ExpressionAttributeValues: {
          ':pk': `ACTION_TYPE#${actionType}`,
        },
        ScanIndexForward: false, // Descending order (newest first)
        Limit: 1,
      }));
      
      return result.Items?.[0] as ActionTypeRegistry | null;
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
        throw new Error(`Required parameter missing: ${actionParam}`);
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
  async registerMapping(mapping: Omit<ActionTypeRegistry, 'pk' | 'sk' | 'created_at'>): Promise<void> {
    const now = new Date().toISOString();
    
    const registry: ActionTypeRegistry = {
      ...mapping,
      pk: `ACTION_TYPE#${mapping.action_type}`,
      sk: `VERSION#${mapping.tool_schema_version}`,
      created_at: now,
    };
    
    await this.dynamoClient.send(new PutCommand({
      TableName: this.tableName,
      Item: registry,
    }));
  }
}
```

### File: `src/services/execution/IdempotencyService.ts`

**Purpose:** Generate and manage idempotency keys (dual-layer idempotency)

**Methods:**

```typescript
import { createHash } from 'crypto';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

export class IdempotencyService {
  /**
   * Generate idempotency key for execution
   * Format: hash(tenant_id + action_intent_id + tool_name + normalized_params + version)
   */
  generateIdempotencyKey(
    tenantId: string,
    actionIntentId: string,
    toolName: string,
    normalizedParams: Record<string, any>,
    schemaVersion: string
  ): string {
    // Normalize parameters (sort keys, stringify)
    const normalized = JSON.stringify(
      normalizedParams,
      Object.keys(normalizedParams).sort()
    );
    
    const input = `${tenantId}:${actionIntentId}:${toolName}:${normalized}:${schemaVersion}`;
    return createHash('sha256').update(input, 'utf8').digest('hex');
  }

  /**
   * Check if external write already happened (adapter-level idempotency)
   * Uses fixed SK pattern 'LATEST' for idempotency key lookup
   */
  async checkExternalWriteDedupe(
    dynamoClient: DynamoDBDocumentClient,
    tableName: string,
    idempotencyKey: string
  ): Promise<string | null> {
    const result = await dynamoClient.send(new GetCommand({
      TableName: tableName,
      Key: {
        pk: `IDEMPOTENCY_KEY#${idempotencyKey}`,
        sk: 'LATEST', // Fixed SK pattern (overwrites previous)
      },
    }));
    
    if (result.Item) {
      return (result.Item as ExternalWriteDedupe).external_object_id;
    }
    
    return null;
  }

  /**
   * Record external write dedupe (adapter-level idempotency)
   * Uses fixed SK pattern 'LATEST' to overwrite previous entries
   */
  async recordExternalWriteDedupe(
    dynamoClient: DynamoDBDocumentClient,
    tableName: string,
    idempotencyKey: string,
    externalObjectId: string,
    actionIntentId: string,
    toolName: string
  ): Promise<void> {
    const now = new Date().toISOString();
    const ttl = Math.floor(Date.now() / 1000) + 604800; // 7 days
    
    const dedupe: ExternalWriteDedupe = {
      pk: `IDEMPOTENCY_KEY#${idempotencyKey}`,
      sk: 'LATEST', // Fixed SK pattern (overwrites previous)
      idempotency_key: idempotencyKey,
      external_object_id: externalObjectId,
      action_intent_id: actionIntentId,
      tool_name: toolName,
      created_at: now,
      ttl,
    };
    
    await dynamoClient.send(new PutCommand({
      TableName: tableName,
      Item: dedupe,
    }));
  }
}
```

### File: `src/services/execution/ExecutionOutcomeService.ts`

**Purpose:** Record structured execution outcomes

**Methods:**

```typescript
import { DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

export class ExecutionOutcomeService {
  constructor(
    private dynamoClient: DynamoDBDocumentClient,
    private tableName: string,
    private logger: Logger
  ) {}

  /**
   * Record execution outcome
   */
  async recordOutcome(
    outcome: Omit<ActionOutcomeV1, 'pk' | 'sk' | 'ttl'>
  ): Promise<ActionOutcomeV1> {
    const ttl = Math.floor(new Date(outcome.completed_at).getTime() / 1000) + 7776000; // 90 days
    
    const fullOutcome: ActionOutcomeV1 = {
      ...outcome,
      pk: `TENANT#${outcome.tenant_id}#ACCOUNT#${outcome.account_id}`,
      sk: `OUTCOME#${outcome.action_intent_id}`,
      ttl,
    };
    
    await this.dynamoClient.send(new PutCommand({
      TableName: this.tableName,
      Item: fullOutcome,
    }));
    
    return fullOutcome;
  }

  /**
   * Get outcome by action_intent_id
   */
  async getOutcome(
    actionIntentId: string,
    tenantId: string,
    accountId: string
  ): Promise<ActionOutcomeV1 | null> {
    const result = await this.dynamoClient.send(new GetCommand({
      TableName: this.tableName,
      Key: {
        pk: `TENANT#${tenantId}#ACCOUNT#${accountId}`,
        sk: `OUTCOME#${actionIntentId}`,
      },
    }));
    
    return result.Item as ActionOutcomeV1 | null;
  }

  /**
   * List outcomes for account (with GSI)
   */
  async listOutcomes(
    tenantId: string,
    accountId: string,
    limit: number = 50
  ): Promise<ActionOutcomeV1[]> {
    const result = await this.dynamoClient.send(new QueryCommand({
      TableName: this.tableName,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: {
        ':pk': `TENANT#${tenantId}#ACCOUNT#${accountId}`,
      },
      Limit: limit,
    }));
    
    return (result.Items || []) as ActionOutcomeV1[];
  }
}
```

### File: `src/services/execution/KillSwitchService.ts`

**Purpose:** Manage execution safety controls (kill switches)

**Methods:**

```typescript
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';

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
```

---

## 3. Lambda Handlers

### File: `src/handlers/phase4/execution-starter-handler.ts`

**Purpose:** Start execution attempt (exactly-once guarantee)

**Handler:**

```typescript
import { Handler } from 'aws-lambda';
import { Logger } from '../../services/core/Logger';
import { TraceService } from '../../services/core/TraceService';
import { ExecutionAttemptService } from '../../services/execution/ExecutionAttemptService';
import { ActionIntentService } from '../../services/decision/ActionIntentService';
import { IdempotencyService } from '../../services/execution/IdempotencyService';
import { ActionTypeRegistryService } from '../../services/execution/ActionTypeRegistryService';
import { LedgerService } from '../../services/ledger/LedgerService';
import { LedgerEventType } from '../../types/LedgerTypes';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { getAWSClientConfig } from '../../utils/aws-client-config';

const logger = new Logger('ExecutionStarterHandler');
const traceService = new TraceService(logger);

/**
 * Helper to validate required environment variables with descriptive errors
 */
function requireEnv(name: string, handlerName: string): string {
  const value = process.env[name];
  if (!value) {
    const error = new Error(
      `[${handlerName}] Missing required environment variable: ${name}. ` +
      `This variable must be set in the Lambda function configuration. ` +
      `Check CDK stack definition for ExecutionInfrastructure construct.`
    );
    error.name = 'ConfigurationError';
    throw error;
  }
  return value;
}

// Note: AWS_REGION is automatically set by Lambda runtime (not set in CDK environment variables)
// Validate it exists (should always be present, but fail fast if somehow missing)
const region = requireEnv('AWS_REGION', 'ExecutionStarterHandler');

// Validate required environment variables with better error handling
const executionAttemptsTableName = requireEnv('EXECUTION_ATTEMPTS_TABLE_NAME', 'ExecutionStarterHandler');
const actionIntentTableName = requireEnv('ACTION_INTENT_TABLE_NAME', 'ExecutionStarterHandler');
const actionTypeRegistryTableName = requireEnv('ACTION_TYPE_REGISTRY_TABLE_NAME', 'ExecutionStarterHandler');
const ledgerTableName = requireEnv('LEDGER_TABLE_NAME', 'ExecutionStarterHandler');

// Initialize AWS clients
const clientConfig = getAWSClientConfig(region);
const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient(clientConfig), {
  marshallOptions: { removeUndefinedValues: true },
});

// Initialize services
const executionAttemptService = new ExecutionAttemptService(
  dynamoClient,
  executionAttemptsTableName,
  logger
);

const actionIntentService = new ActionIntentService(
  dynamoClient,
  actionIntentTableName,
  logger
);

const actionTypeRegistryService = new ActionTypeRegistryService(
  dynamoClient,
  actionTypeRegistryTableName,
  logger
);

const idempotencyService = new IdempotencyService();

const ledgerService = new LedgerService(
  logger,
  ledgerTableName,
  region
);

/**
 * Step Functions input: { action_intent_id }
 * Step Functions output: { action_intent_id, idempotency_key, tenant_id, account_id, trace_id }
 * 
 * Note: ActionIntentService.getIntent() must be public (not private) for this handler to work.
 * Update ActionIntentService.ts to make getIntent() public.
 */
export const handler: Handler = async (event: { action_intent_id: string }) => {
  const { action_intent_id } = event;
  const traceId = traceService.generateTraceId();
  
  logger.info('Execution starter invoked', { action_intent_id, traceId });
  
  try {
    // 1. Fetch ActionIntentV1
    // Note: getIntent() must be public in ActionIntentService
    // If it's private, either make it public or add a public wrapper method
    const intent = await actionIntentService.getIntent(
      action_intent_id,
      event.tenant_id || '', // Will be populated from intent
      event.account_id || ''
    );
    
    if (!intent) {
      throw new Error(`ActionIntent not found: ${action_intent_id}`);
    }
    
    // 2. Get tool mapping (for idempotency key generation)
    const toolMapping = await actionTypeRegistryService.getToolMapping(
      intent.action_type,
      intent.parameters_schema_version
    );
    
    if (!toolMapping) {
      throw new Error(`Tool mapping not found for action_type: ${intent.action_type}`);
    }
    
    // 3. Generate idempotency key
    const normalizedParams = actionTypeRegistryService.mapParametersToToolArguments(
      toolMapping,
      intent.parameters
    );
    
    const idempotencyKey = idempotencyService.generateIdempotencyKey(
      intent.tenant_id,
      action_intent_id,
      toolMapping.tool_name,
      normalizedParams,
      toolMapping.tool_schema_version
    );
    
    // 4. Start execution attempt (conditional write for exactly-once)
    const attempt = await executionAttemptService.startAttempt(
      action_intent_id,
      intent.tenant_id,
      intent.account_id,
      intent.trace_id,
      idempotencyKey
    );
    
    // 5. Emit ledger event
    await ledgerService.append({
      eventType: LedgerEventType.EXECUTION_STARTED,
      tenantId: intent.tenant_id,
      accountId: intent.account_id,
      traceId: intent.trace_id,
      data: {
        action_intent_id,
        attempt_id: attempt.attempt_id,
        idempotency_key: idempotencyKey,
      },
    });
    
    // 6. Return for Step Functions
    return {
      action_intent_id,
      idempotency_key: idempotencyKey,
      tenant_id: intent.tenant_id,
      account_id: intent.account_id,
      trace_id: intent.trace_id,
    };
  } catch (error: any) {
    logger.error('Execution starter failed', { action_intent_id, error });
    
    // If already executing, return error for Step Functions to handle
    if (error.message.includes('already in progress')) {
      throw new Error(`Execution already in progress: ${action_intent_id}`);
    }
    
    throw error;
  }
};
```

### File: `src/handlers/phase4/execution-validator-handler.ts`

**Purpose:** Validate preflight checks (expiration, kill switches, params, budget)

**Handler:**

```typescript
import { Handler } from 'aws-lambda';
import { Logger } from '../../services/core/Logger';
import { TraceService } from '../../services/core/TraceService';
import { ActionIntentService } from '../../services/decision/ActionIntentService';
import { KillSwitchService } from '../../services/execution/KillSwitchService';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { getAWSClientConfig } from '../../utils/aws-client-config';

const logger = new Logger('ExecutionValidatorHandler');
const traceService = new TraceService(logger);

/**
 * Helper to validate required environment variables with descriptive errors
 */
function requireEnv(name: string, handlerName: string): string {
  const value = process.env[name];
  if (!value) {
    const error = new Error(
      `[${handlerName}] Missing required environment variable: ${name}. ` +
      `This variable must be set in the Lambda function configuration. ` +
      `Check CDK stack definition for ExecutionInfrastructure construct.`
    );
    error.name = 'ConfigurationError';
    throw error;
  }
  return value;
}

// Note: AWS_REGION is automatically set by Lambda runtime (not set in CDK environment variables)
// Validate it exists (should always be present, but fail fast if somehow missing)
const region = requireEnv('AWS_REGION', 'ExecutionValidatorHandler');
const actionIntentTableName = requireEnv('ACTION_INTENT_TABLE_NAME', 'ExecutionValidatorHandler');
const tenantsTableName = requireEnv('TENANTS_TABLE_NAME', 'ExecutionValidatorHandler');

const clientConfig = getAWSClientConfig(region);
const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient(clientConfig), {
  marshallOptions: { removeUndefinedValues: true },
});

// Initialize services
const actionIntentService = new ActionIntentService(
  dynamoClient,
  actionIntentTableName,
  logger
);

const killSwitchService = new KillSwitchService(
  dynamoClient,
  tenantsTableName,
  logger
);

/**
 * Step Functions input: { action_intent_id, tenant_id, account_id }
 * Step Functions output: { valid: true, action_intent: {...} } or throws error
 */
export const handler: Handler = async (event: {
  action_intent_id: string;
  tenant_id: string;
  account_id: string;
}) => {
  const { action_intent_id, tenant_id, account_id } = event;
  const traceId = traceService.generateTraceId();
  
  logger.info('Execution validator invoked', { action_intent_id, tenant_id, account_id, traceId });
  
  try {
    // 1. Fetch ActionIntentV1
    const intent = await actionIntentService.getIntent(action_intent_id, tenant_id, account_id);
    
    if (!intent) {
      throw new Error(`ActionIntent not found: ${action_intent_id}`);
    }
    
    // 2. Check expiration
    const now = Math.floor(Date.now() / 1000);
    if (intent.expires_at_epoch <= now) {
      throw new Error(`ActionIntent expired: ${action_intent_id} (expires_at_epoch: ${intent.expires_at_epoch}, now: ${now})`);
    }
    
    // 3. Check kill switches
    const executionEnabled = await killSwitchService.isExecutionEnabled(tenant_id, intent.action_type);
    if (!executionEnabled) {
      throw new Error(`Execution disabled for tenant: ${tenant_id}, action_type: ${intent.action_type}`);
    }
    
    // 4. Check required parameters (basic validation)
    // Detailed parameter validation happens in tool mapper
    
    // 5. Return valid
    return {
      valid: true,
      action_intent: intent,
    };
  } catch (error: any) {
    logger.error('Execution validation failed', { action_intent_id, error });
    throw error;
  }
};
```

### File: `src/handlers/phase4/tool-mapper-handler.ts`

**Purpose:** Map action type to tool (versioned registry lookup)

**Handler:**

```typescript
import { Handler } from 'aws-lambda';
import { Logger } from '../../services/core/Logger';
import { TraceService } from '../../services/core/TraceService';
import { ActionIntentService } from '../../services/decision/ActionIntentService';
import { ActionTypeRegistryService } from '../../services/execution/ActionTypeRegistryService';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { getAWSClientConfig } from '../../utils/aws-client-config';

const logger = new Logger('ToolMapperHandler');
const traceService = new TraceService(logger);

/**
 * Helper to validate required environment variables with descriptive errors
 */
function requireEnv(name: string, handlerName: string): string {
  const value = process.env[name];
  if (!value) {
    const error = new Error(
      `[${handlerName}] Missing required environment variable: ${name}. ` +
      `This variable must be set in the Lambda function configuration. ` +
      `Check CDK stack definition for ExecutionInfrastructure construct.`
    );
    error.name = 'ConfigurationError';
    throw error;
  }
  return value;
}

// Note: AWS_REGION is automatically set by Lambda runtime (not set in CDK environment variables)
// Validate it exists (should always be present, but fail fast if somehow missing)
const region = requireEnv('AWS_REGION', 'ToolMapperHandler');
const actionIntentTableName = requireEnv('ACTION_INTENT_TABLE_NAME', 'ToolMapperHandler');
const actionTypeRegistryTableName = requireEnv('ACTION_TYPE_REGISTRY_TABLE_NAME', 'ToolMapperHandler');
const gatewayUrl = requireEnv('AGENTCORE_GATEWAY_URL', 'ToolMapperHandler');

const clientConfig = getAWSClientConfig(region);
const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient(clientConfig), {
  marshallOptions: { removeUndefinedValues: true },
});

// Initialize services
const actionIntentService = new ActionIntentService(
  dynamoClient,
  actionIntentTableName,
  logger
);

const actionTypeRegistryService = new ActionTypeRegistryService(
  dynamoClient,
  actionTypeRegistryTableName,
  logger
);

/**
 * Step Functions input: { action_intent_id, tenant_id, account_id }
 * Step Functions output: { gateway_url, tool_name, tool_arguments, tool_schema_version, idempotency_key, jwt_token }
 */
export const handler: Handler = async (event: {
  action_intent_id: string;
  tenant_id: string;
  account_id: string;
  idempotency_key: string;
}) => {
  const { action_intent_id, tenant_id, account_id, idempotency_key } = event;
  const traceId = traceService.generateTraceId();
  
  logger.info('Tool mapper invoked', { action_intent_id, tenant_id, account_id, traceId });
  
  try {
    // 1. Fetch ActionIntentV1
    const intent = await actionIntentService.getIntent(action_intent_id, tenant_id, account_id);
    
    if (!intent) {
      throw new Error(`ActionIntent not found: ${action_intent_id}`);
    }
    
    // 2. Get tool mapping from registry
    const toolMapping = await actionTypeRegistryService.getToolMapping(
      intent.action_type,
      intent.parameters_schema_version
    );
    
    if (!toolMapping) {
      throw new Error(`Tool mapping not found for action_type: ${intent.action_type}, schema_version: ${intent.parameters_schema_version}`);
    }
    
    // 3. Map parameters to tool arguments
    const toolArguments = actionTypeRegistryService.mapParametersToToolArguments(
      toolMapping,
      intent.parameters
    );
    
    // 4. Add idempotency_key to tool arguments (for adapter-level idempotency)
    toolArguments.idempotency_key = idempotency_key;
    
    // 5. Get JWT token (from environment/config)
    // Note: gatewayUrl is already validated and available from module scope
    const jwtToken = await getJwtToken(tenant_id); // Implement JWT token retrieval (Cognito)
    
    // 6. Return for Step Functions
    return {
      gateway_url: gatewayUrl,
      tool_name: toolMapping.tool_name,
      tool_arguments: toolArguments,
      tool_schema_version: toolMapping.tool_schema_version,
      idempotency_key: idempotency_key,
      jwt_token: jwtToken,
      action_intent_id,
      tenant_id,
      account_id,
      trace_id: intent.trace_id,
    };
  } catch (error: any) {
    logger.error('Tool mapping failed', { action_intent_id, error });
    throw error;
  }
};

/**
 * Get JWT token for Gateway authentication (Cognito)
 */
async function getJwtToken(tenantId: string): Promise<string> {
  // TODO: Implement Cognito JWT token retrieval
  // Use Cognito Identity Pool or User Pool client credentials
  throw new Error('JWT token retrieval not implemented');
}
```

### File: `src/handlers/phase4/tool-invoker-handler.ts`

**Purpose:** MCP Gateway client (centralizes MCP protocol, auth, retries, timeouts)

**Handler:**

```typescript
import { Handler } from 'aws-lambda';
import { Logger } from '../../services/core/Logger';
import { TraceService } from '../../services/core/TraceService';
import { ToolInvocationRequest, ToolInvocationResponse } from '../../types/ExecutionTypes';
import axios, { AxiosError } from 'axios';

const logger = new Logger('ToolInvokerHandler');
const traceService = new TraceService(logger);

// Note: No DynamoDB client needed - this handler only calls Gateway via HTTP

/**
 * Step Functions input: ToolInvocationRequest
 * Step Functions output: ToolInvocationResponse
 */
export const handler: Handler<ToolInvocationRequest, ToolInvocationResponse> = async (event) => {
  const { gateway_url, tool_name, tool_arguments, idempotency_key, jwt_token, action_intent_id, tenant_id, account_id, trace_id } = event;
  
  logger.info('Tool invoker invoked', { action_intent_id, tool_name, trace_id });
  
  try {
    // 1. Make MCP protocol call to AgentCore Gateway
    const mcpRequest = {
      jsonrpc: '2.0',
      id: `invoke-${Date.now()}`,
      method: 'tools/call',
      params: {
        name: tool_name,
        arguments: tool_arguments,
      },
    };
    
    const toolRunRef = `gateway_invocation_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    
    // 2. Call Gateway with retry logic
    const response = await invokeWithRetry(
      gateway_url,
      mcpRequest,
      jwt_token,
      toolRunRef,
      action_intent_id
    );
    
    // 3. Parse MCP response
    const parsedResponse = parseMCPResponse(response);
    
    // 4. Extract external object refs
    const externalObjectRefs = extractExternalObjectRefs(parsedResponse);
    
    // 5. Classify errors (if any)
    const errorClassification = classifyError(parsedResponse);
    
    // 6. Return structured response
    return {
      success: parsedResponse.success,
      external_object_refs: externalObjectRefs,
      tool_run_ref: toolRunRef,
      raw_response_artifact_ref: parsedResponse.raw_response_artifact_ref,
      error_code: errorClassification?.error_code,
      error_class: errorClassification?.error_class,
      error_message: errorClassification?.error_message,
    };
  } catch (error: any) {
    logger.error('Tool invocation failed', { action_intent_id, tool_name, error });
    
    // Classify error
    const errorClassification = classifyErrorFromException(error);
    
    return {
      success: false,
      tool_run_ref: `gateway_invocation_failed_${Date.now()}`,
      error_code: errorClassification.error_code,
      error_class: errorClassification.error_class,
      error_message: errorClassification.error_message,
    };
  }
};

/**
 * Invoke Gateway with retry logic (exponential backoff)
 */
async function invokeWithRetry(
  gatewayUrl: string,
  mcpRequest: any,
  jwtToken: string,
  toolRunRef: string,
  actionIntentId: string,
  maxRetries: number = 3
): Promise<any> {
  let lastError: any;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await axios.post(
        gatewayUrl,
        mcpRequest,
        {
          headers: {
            'Authorization': `Bearer ${jwtToken}`,
            'Content-Type': 'application/json',
          },
          timeout: 30000, // 30 seconds
        }
      );
      
      return response.data;
    } catch (error: any) {
      lastError = error;
      
      // Check if error is retryable
      if (!isRetryableError(error) || attempt === maxRetries) {
        // Throw with Step Functions-compatible error type
        if (error.response?.status >= 400 && error.response?.status < 500) {
          throw new Error('PermanentError: ' + error.message);
        }
        throw new Error('TransientError: ' + error.message);
      }
      
      // Exponential backoff
      const delay = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
      await new Promise(resolve => setTimeout(resolve, delay));
      
      logger.warn('Tool invocation retry', {
        action_intent_id: actionIntentId,
        attempt: attempt + 1,
        maxRetries,
        error: error.message,
      });
    }
  }
  
  // Throw with appropriate error type for Step Functions
  if (lastError.response?.status >= 400 && lastError.response?.status < 500) {
    throw new Error('PermanentError: ' + lastError.message);
  }
  throw new Error('TransientError: ' + lastError.message);
}

/**
 * Check if error is retryable (transient)
 */
function isRetryableError(error: any): boolean {
  if (error instanceof AxiosError) {
    // 5xx errors are retryable
    if (error.response?.status && error.response.status >= 500) {
      return true;
    }
    
    // Network errors are retryable
    if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
      return true;
    }
  }
  
  return false;
}

/**
 * Parse MCP response
 */
function parseMCPResponse(response: any): any {
  if (response.error) {
    return {
      success: false,
      error: response.error,
    };
  }
  
  if (response.result?.content) {
    // Extract text content
    const textContent = response.result.content.find((c: any) => c.type === 'text');
    if (textContent) {
      try {
        const parsed = JSON.parse(textContent.text);
        return {
          success: parsed.success !== false,
          ...parsed,
        };
      } catch (e) {
        return {
          success: false,
          error: 'Failed to parse MCP response',
        };
      }
    }
  }
  
  return {
    success: false,
    error: 'Invalid MCP response format',
  };
}

/**
 * Extract external object refs from parsed response
 */
function extractExternalObjectRefs(parsedResponse: any): ToolInvocationResponse['external_object_refs'] {
  if (!parsedResponse.success || !parsedResponse.external_object_id) {
    return undefined;
  }
  
  // Infer system from tool name or response
  const system = inferSystemFromTool(parsedResponse.tool_name);
  
  return [{
    system,
    object_type: parsedResponse.object_type || 'Unknown',
    object_id: parsedResponse.external_object_id,
    object_url: parsedResponse.object_url,
  }];
}

/**
 * Infer system from tool name
 */
function inferSystemFromTool(toolName: string): 'CRM' | 'CALENDAR' | 'INTERNAL' {
  if (toolName.startsWith('crm.')) {
    return 'CRM';
  }
  if (toolName.startsWith('calendar.')) {
    return 'CALENDAR';
  }
  return 'INTERNAL';
}

/**
 * Classify error from MCP response
 */
function classifyError(parsedResponse: any): {
  error_code?: string;
  error_class?: ToolInvocationResponse['error_class'];
  error_message?: string;
} {
  if (parsedResponse.success) {
    return {};
  }
  
  const error = parsedResponse.error || parsedResponse;
  const errorMessage = error.message || error.error || 'Unknown error';
  
  // Classify by error message patterns
  if (errorMessage.includes('authentication') || errorMessage.includes('unauthorized')) {
    return {
      error_code: 'AUTH_FAILED',
      error_class: 'AUTH',
      error_message: errorMessage,
    };
  }
  
  if (errorMessage.includes('rate limit') || errorMessage.includes('throttle')) {
    return {
      error_code: 'RATE_LIMIT',
      error_class: 'RATE_LIMIT',
      error_message: errorMessage,
    };
  }
  
  if (errorMessage.includes('validation') || errorMessage.includes('invalid')) {
    return {
      error_code: 'VALIDATION_ERROR',
      error_class: 'VALIDATION',
      error_message: errorMessage,
    };
  }
  
  if (errorMessage.includes('timeout')) {
    return {
      error_code: 'TIMEOUT',
      error_class: 'TIMEOUT',
      error_message: errorMessage,
    };
  }
  
  return {
    error_code: 'UNKNOWN_ERROR',
    error_class: 'UNKNOWN',
    error_message: errorMessage,
  };
}

/**
 * Classify error from exception
 */
function classifyErrorFromException(error: any): {
  error_code: string;
  error_class: ToolInvocationResponse['error_class'];
  error_message: string;
} {
  return classifyError({ success: false, error: error.message || String(error) });
}
```

### File: `src/handlers/phase4/execution-recorder-handler.ts`

**Purpose:** Record structured execution outcome

**Handler:**

```typescript
import { Handler } from 'aws-lambda';
import { Logger } from '../../services/core/Logger';
import { TraceService } from '../../services/core/TraceService';
import { ExecutionOutcomeService } from '../../services/execution/ExecutionOutcomeService';
import { ExecutionAttemptService } from '../../services/execution/ExecutionAttemptService';
import { LedgerService } from '../../services/ledger/LedgerService';
import { LedgerEventType } from '../../types/LedgerTypes';
import { ToolInvocationResponse } from '../../types/ExecutionTypes';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { getAWSClientConfig } from '../../utils/aws-client-config';

const logger = new Logger('ExecutionRecorderHandler');
const traceService = new TraceService(logger);

// Note: AWS_REGION is automatically set by Lambda runtime (not set in CDK environment variables)
// Validate it exists (should always be present, but fail fast if somehow missing)
const region = requireEnv('AWS_REGION', 'ExecutionValidatorHandler');
const clientConfig = getAWSClientConfig(region);
const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient(clientConfig), {
  marshallOptions: { removeUndefinedValues: true },
});

// Initialize services
const executionOutcomeService = new ExecutionOutcomeService(
  dynamoClient,
  process.env.EXECUTION_OUTCOMES_TABLE_NAME || 'cc-native-execution-outcomes',
  logger
);

const executionAttemptService = new ExecutionAttemptService(
  dynamoClient,
  process.env.EXECUTION_ATTEMPTS_TABLE_NAME || 'cc-native-execution-attempts',
  logger
);

const ledgerService = new LedgerService(
  logger,
  process.env.LEDGER_TABLE_NAME || 'cc-native-ledger',
  region
);

/**
 * Step Functions input: {
 *   action_intent_id,
 *   tenant_id,
 *   account_id,
 *   trace_id,
 *   tool_invocation_response: ToolInvocationResponse,
 *   tool_name,
 *   tool_schema_version,
 *   attempt_count,
 *   started_at
 * }
 */
export const handler: Handler = async (event: {
  action_intent_id: string;
  tenant_id: string;
  account_id: string;
  trace_id: string;
  tool_invocation_response: ToolInvocationResponse;
  tool_name: string;
  tool_schema_version: string;
  attempt_count: number;
  started_at: string;
}) => {
  const {
    action_intent_id,
    tenant_id,
    account_id,
    trace_id,
    tool_invocation_response,
    tool_name,
    tool_schema_version,
    attempt_count,
    started_at,
  } = event;
  
  logger.info('Execution recorder invoked', { action_intent_id, trace_id });
  
  try {
    const completedAt = new Date().toISOString();
    const status = tool_invocation_response.success ? 'SUCCEEDED' : 'FAILED';
    
    // 1. Record outcome
    const outcome = await executionOutcomeService.recordOutcome({
      action_intent_id,
      status,
      external_object_refs: tool_invocation_response.external_object_refs || [],
      error_code: tool_invocation_response.error_code,
      error_class: tool_invocation_response.error_class,
      error_message: tool_invocation_response.error_message,
      attempt_count,
      tool_name,
      tool_schema_version,
      tool_run_ref: tool_invocation_response.tool_run_ref,
      raw_response_artifact_ref: tool_invocation_response.raw_response_artifact_ref,
      started_at,
      completed_at: completedAt,
      compensation_status: 'NONE', // Compensation handled separately
      tenant_id,
      account_id,
      trace_id,
    });
    
    // 2. Update execution attempt status
    await executionAttemptService.updateStatus(
      action_intent_id,
      tenant_id,
      account_id,
      status
    );
    
    // 3. Emit ledger event
    const ledgerEventType = status === 'SUCCEEDED' 
      ? LedgerEventType.ACTION_EXECUTED 
      : LedgerEventType.ACTION_FAILED;
    
    await ledgerService.append({
      eventType: ledgerEventType,
      tenantId: tenant_id,
      accountId: account_id,
      traceId: trace_id,
      data: {
        action_intent_id,
        status,
        external_object_refs: outcome.external_object_refs,
        error_code: outcome.error_code,
        error_class: outcome.error_class,
        attempt_count,
      },
    });
    
    // 4. Emit signal for Phase 1 perception layer
    // Note: SignalService initialization should be added to handler
    // import { SignalService } from '../../services/perception/SignalService';
    // import { SignalType } from '../../types/SignalTypes';
    // 
    // const signalService = new SignalService({
    //   logger,
    //   signalsTableName: process.env.SIGNALS_TABLE_NAME || 'cc-native-signals',
    //   accountsTableName: process.env.ACCOUNTS_TABLE_NAME || 'cc-native-accounts',
    //   // ... other dependencies
    // });
    // 
    // await signalService.createSignal({
    //   signalType: status === 'SUCCEEDED' ? SignalType.ACTION_EXECUTED : SignalType.ACTION_FAILED,
    //   accountId: account_id,
    //   tenantId: tenant_id,
    //   data: {
    //     action_intent_id,
    //     status,
    //     external_object_refs: outcome.external_object_refs,
    //   },
    // });
    
    // 4. Return outcome
    return {
      outcome,
    };
  } catch (error: any) {
    logger.error('Execution recording failed', { action_intent_id, error });
    
    // Return structured error for Step Functions
    throw new Error(JSON.stringify({
      errorType: error.name || 'Error',
      errorMessage: error.message,
      action_intent_id,
    }));
  }
};
```

### File: `src/handlers/phase4/compensation-handler.ts`

**Purpose:** Handle compensation (rollback) for failed executions

**Handler:**

```typescript
import { Handler } from 'aws-lambda';
import { Logger } from '../../services/core/Logger';
import { TraceService } from '../../services/core/TraceService';
import { ActionIntentService } from '../../services/decision/ActionIntentService';
import { ActionTypeRegistryService } from '../../services/execution/ActionTypeRegistryService';
import { ExecutionOutcomeService } from '../../services/execution/ExecutionOutcomeService';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { getAWSClientConfig } from '../../utils/aws-client-config';

const logger = new Logger('CompensationHandler');
const traceService = new TraceService(logger);

// Note: AWS_REGION is automatically set by Lambda runtime (not set in CDK environment variables)
// Validate it exists (should always be present, but fail fast if somehow missing)
const region = requireEnv('AWS_REGION', 'ExecutionValidatorHandler');
const clientConfig = getAWSClientConfig(region);
const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient(clientConfig), {
  marshallOptions: { removeUndefinedValues: true },
});

// Initialize services
const actionIntentService = new ActionIntentService(
  dynamoClient,
  process.env.ACTION_INTENT_TABLE_NAME || 'cc-native-action-intents',
  logger
);

const actionTypeRegistryService = new ActionTypeRegistryService(
  dynamoClient,
  process.env.ACTION_TYPE_REGISTRY_TABLE_NAME || 'cc-native-action-type-registry',
  logger
);

const executionOutcomeService = new ExecutionOutcomeService(
  dynamoClient,
  process.env.EXECUTION_OUTCOMES_TABLE_NAME || 'cc-native-execution-outcomes',
  logger
);

/**
 * Step Functions input: {
 *   action_intent_id,
 *   tenant_id,
 *   account_id,
 *   execution_result: ToolInvocationResponse
 * }
 */
export const handler: Handler = async (event: {
  action_intent_id: string;
  tenant_id: string;
  account_id: string;
  execution_result: any;
}) => {
  const { action_intent_id, tenant_id, account_id, execution_result } = event;
  const traceId = traceService.generateTraceId();
  
  logger.info('Compensation handler invoked', { action_intent_id, traceId });
  
  try {
    // 1. Fetch ActionIntentV1
    const intent = await actionIntentService.getIntent(action_intent_id, tenant_id, account_id);
    
    if (!intent) {
      throw new Error(`ActionIntent not found: ${action_intent_id}`);
    }
    
    // 2. Get tool mapping to determine compensation strategy
    const toolMapping = await actionTypeRegistryService.getToolMapping(
      intent.action_type,
      intent.parameters_schema_version
    );
    
    if (!toolMapping) {
      throw new Error(`Tool mapping not found for action_type: ${intent.action_type}`);
    }
    
    // 3. Check if compensation is supported
    if (toolMapping.compensation_strategy === 'NONE') {
      logger.warn('Compensation not supported for this action type', {
        action_intent_id,
        action_type: intent.action_type,
      });
      return {
        compensation_status: 'NONE',
        reason: 'Compensation not supported for this action type',
      };
    }
    
    // 4. Get external object refs from execution result
    const externalObjectRefs = execution_result.external_object_refs || [];
    
    if (externalObjectRefs.length === 0) {
      logger.info('No external objects to compensate', { action_intent_id });
      return {
        compensation_status: 'COMPLETED',
        reason: 'No external objects created',
      };
    }
    
    // 5. Call compensation tool via Gateway (if automatic)
    // TODO: Implement compensation tool invocation via Gateway
    // For now, mark as pending manual compensation
    if (toolMapping.compensation_strategy === 'AUTOMATIC') {
      // TODO: Invoke compensation tool via Gateway
      logger.info('Automatic compensation not yet implemented', {
        action_intent_id,
        external_object_refs: externalObjectRefs,
      });
      
      return {
        compensation_status: 'PENDING',
        reason: 'Automatic compensation not yet implemented',
      };
    }
    
    // Manual compensation
    return {
      compensation_status: 'PENDING',
      reason: 'Requires manual compensation',
    };
  } catch (error: any) {
    logger.error('Compensation failed', { action_intent_id, error });
    
    return {
      compensation_status: 'FAILED',
      compensation_error: error.message,
    };
  }
};
```

---

## 4. CDK Infrastructure

### File: `src/stacks/constructs/ExecutionInfrastructure.ts`

**Purpose:** CDK construct for Phase 4 execution infrastructure

**Structure:**

```typescript
import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as eventsTargets from 'aws-cdk-lib/aws-events-targets';
import * as stepfunctions from 'aws-cdk-lib/aws-stepfunctions';
import * as stepfunctionsTasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import { Construct } from 'constructs';

export interface ExecutionInfrastructureProps {
  readonly eventBus: events.EventBus;
  readonly ledgerTable: dynamodb.Table;
  readonly actionIntentTable: dynamodb.Table;
  readonly tenantsTable: dynamodb.Table;
  readonly userPool?: cognito.IUserPool; // For JWT auth
  readonly region?: string;
  readonly artifactsBucket?: s3.IBucket; // For raw response artifacts (optional, can reuse existing)
}

export class ExecutionInfrastructure extends Construct {
  // DynamoDB Tables
  public readonly executionAttemptsTable: dynamodb.Table;
  public readonly executionOutcomesTable: dynamodb.Table;
  public readonly actionTypeRegistryTable: dynamodb.Table;
  public readonly externalWriteDedupeTable: dynamodb.Table;
  
  // Lambda Functions
  public readonly executionStarterHandler: lambda.Function;
  public readonly executionValidatorHandler: lambda.Function;
  public readonly toolMapperHandler: lambda.Function;
  public readonly toolInvokerHandler: lambda.Function;
  public readonly executionRecorderHandler: lambda.Function;
  public readonly compensationHandler: lambda.Function;
  
  // Dead Letter Queues
  public readonly executionStarterDlq: sqs.Queue;
  public readonly executionValidatorDlq: sqs.Queue;
  public readonly toolMapperDlq: sqs.Queue;
  public readonly toolInvokerDlq: sqs.Queue;
  public readonly executionRecorderDlq: sqs.Queue;
  public readonly compensationDlq: sqs.Queue;
  
  // Step Functions
  public readonly executionStateMachine: stepfunctions.StateMachine;
  
  // EventBridge Rule
  public readonly executionTriggerRule: events.Rule;
  
  // S3 Bucket (for raw response artifacts)
  public readonly executionArtifactsBucket?: s3.IBucket;

  constructor(scope: Construct, id: string, props: ExecutionInfrastructureProps) {
    super(scope, id);

    // Get region from props or stack (consistent with Phase 3 pattern)
    const region = props.region || cdk.Stack.of(this).region;

    // 1. Create DynamoDB Tables
    this.executionAttemptsTable = this.createExecutionAttemptsTable();
    this.executionOutcomesTable = this.createExecutionOutcomesTable();
    this.actionTypeRegistryTable = this.createActionTypeRegistryTable();
    this.externalWriteDedupeTable = this.createExternalWriteDedupeTable();
    
    // 2. Create Dead Letter Queues
    this.executionStarterDlq = this.createDlq('ExecutionStarterDlq', 'cc-native-execution-starter-handler-dlq');
    this.executionValidatorDlq = this.createDlq('ExecutionValidatorDlq', 'cc-native-execution-validator-handler-dlq');
    this.toolMapperDlq = this.createDlq('ToolMapperDlq', 'cc-native-tool-mapper-handler-dlq');
    this.toolInvokerDlq = this.createDlq('ToolInvokerDlq', 'cc-native-tool-invoker-handler-dlq');
    this.executionRecorderDlq = this.createDlq('ExecutionRecorderDlq', 'cc-native-execution-recorder-handler-dlq');
    this.compensationDlq = this.createDlq('CompensationDlq', 'cc-native-compensation-handler-dlq');
    
    // 3. Create Lambda Functions
    this.executionStarterHandler = this.createExecutionStarterHandler(props);
    this.executionValidatorHandler = this.createExecutionValidatorHandler(props);
    this.toolMapperHandler = this.createToolMapperHandler(props);
    this.toolInvokerHandler = this.createToolInvokerHandler(props);
    this.executionRecorderHandler = this.createExecutionRecorderHandler(props);
    this.compensationHandler = this.createCompensationHandler(props);
    
    // 4. Create S3 Bucket (if not provided)
    if (!props.artifactsBucket) {
      this.executionArtifactsBucket = new s3.Bucket(this, 'ExecutionArtifactsBucket', {
        bucketName: `cc-native-execution-artifacts-${cdk.Aws.ACCOUNT_ID}-${cdk.Aws.REGION}`,
        versioned: true,
        encryption: s3.BucketEncryption.S3_MANAGED,
      });
    } else {
      this.executionArtifactsBucket = props.artifactsBucket;
    }
    
    // 5. Create Step Functions State Machine
    this.executionStateMachine = this.createExecutionStateMachine();
    
    // 6. Create EventBridge Rule (ACTION_APPROVED → Step Functions)
    this.executionTriggerRule = this.createExecutionTriggerRule(props);
    
    // 7. Create CloudWatch alarms
    this.createCloudWatchAlarms();
  }

  private createDlq(id: string, queueName: string): sqs.Queue {
    return new sqs.Queue(this, id, {
      queueName,
      retentionPeriod: cdk.Duration.days(14),
    });
  }

  private createExecutionAttemptsTable(): dynamodb.Table {
    return new dynamodb.Table(this, 'ExecutionAttemptsTable', {
      tableName: 'cc-native-execution-attempts',
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
      timeToLiveAttribute: 'ttl',
    });
  }

  private createExecutionOutcomesTable(): dynamodb.Table {
    const table = new dynamodb.Table(this, 'ExecutionOutcomesTable', {
      tableName: 'cc-native-execution-outcomes',
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
      timeToLiveAttribute: 'ttl',
    });
    
    // Add GSI for querying by action_intent_id
    table.addGlobalSecondaryIndex({
      indexName: 'gsi1-index',
      partitionKey: { name: 'gsi1pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'gsi1sk', type: dynamodb.AttributeType.STRING },
    });
    
    return table;
  }

  private createActionTypeRegistryTable(): dynamodb.Table {
    const table = new dynamodb.Table(this, 'ActionTypeRegistryTable', {
      tableName: 'cc-native-action-type-registry',
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
    });
    
    // Add GSI for querying latest version by created_at
    table.addGlobalSecondaryIndex({
      indexName: 'created-at-index',
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'created_at', type: dynamodb.AttributeType.STRING },
    });
    
    return table;
  }

  private createExternalWriteDedupeTable(): dynamodb.Table {
    return new dynamodb.Table(this, 'ExternalWriteDedupeTable', {
      tableName: 'cc-native-external-write-dedupe',
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
    });
  }

  private createExecutionStarterHandler(props: ExecutionInfrastructureProps): lambda.Function {
    const handler = new lambdaNodejs.NodejsFunction(this, 'ExecutionStarterHandler', {
      functionName: 'cc-native-execution-starter',
      entry: 'src/handlers/phase4/execution-starter-handler.ts',
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(30),
      environment: {
        EXECUTION_ATTEMPTS_TABLE_NAME: this.executionAttemptsTable.tableName,
        ACTION_INTENT_TABLE_NAME: props.actionIntentTable.tableName,
        ACTION_TYPE_REGISTRY_TABLE_NAME: this.actionTypeRegistryTable.tableName,
        LEDGER_TABLE_NAME: props.ledgerTable.tableName,
        // Note: AWS_REGION is automatically set by Lambda runtime and should not be set manually
      },
      deadLetterQueue: this.executionStarterDlq,
      deadLetterQueueEnabled: true,
      retryAttempts: 2,
    });
    
    // Grant permissions
    this.executionAttemptsTable.grantReadWriteData(handler);
    props.actionIntentTable.grantReadData(handler);
    this.actionTypeRegistryTable.grantReadData(handler);
    props.ledgerTable.grantWriteData(handler);
    
    return handler;
  }

  private createExecutionValidatorHandler(props: ExecutionInfrastructureProps): lambda.Function {
    const handler = new lambdaNodejs.NodejsFunction(this, 'ExecutionValidatorHandler', {
      functionName: 'cc-native-execution-validator',
      entry: 'src/handlers/phase4/execution-validator-handler.ts',
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(30),
      environment: {
        ACTION_INTENT_TABLE_NAME: props.actionIntentTable.tableName,
        TENANTS_TABLE_NAME: props.tenantsTable.tableName,
        // Note: AWS_REGION is automatically set by Lambda runtime and should not be set manually
      },
      deadLetterQueue: this.executionValidatorDlq,
      deadLetterQueueEnabled: true,
      retryAttempts: 2,
    });
    
    // Grant permissions
    props.actionIntentTable.grantReadData(handler);
    props.tenantsTable.grantReadData(handler);
    
    return handler;
  }

  private createToolMapperHandler(props: ExecutionInfrastructureProps): lambda.Function {
    const handler = new lambdaNodejs.NodejsFunction(this, 'ToolMapperHandler', {
      functionName: 'cc-native-tool-mapper',
      entry: 'src/handlers/phase4/tool-mapper-handler.ts',
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(30),
      environment: {
        ACTION_INTENT_TABLE_NAME: props.actionIntentTable.tableName,
        ACTION_TYPE_REGISTRY_TABLE_NAME: this.actionTypeRegistryTable.tableName,
        AGENTCORE_GATEWAY_URL: process.env.AGENTCORE_GATEWAY_URL || '', // TODO: Get from Gateway construct
        // Note: AWS_REGION is automatically set by Lambda runtime and should not be set manually
      },
      deadLetterQueue: this.toolMapperDlq,
      deadLetterQueueEnabled: true,
      retryAttempts: 2,
    });
    
    // Grant permissions
    props.actionIntentTable.grantReadData(handler);
    this.actionTypeRegistryTable.grantReadData(handler);
    
    // Grant Cognito permissions for JWT token (if userPool provided)
    if (props.userPool) {
      handler.addToRolePolicy(new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['cognito-idp:GetUser', 'cognito-idp:InitiateAuth'],
        resources: [props.userPool.userPoolArn],
      }));
    }
    
    return handler;
  }

  private createToolInvokerHandler(props: ExecutionInfrastructureProps): lambda.Function {
    const handler = new lambdaNodejs.NodejsFunction(this, 'ToolInvokerHandler', {
      functionName: 'cc-native-tool-invoker',
      entry: 'src/handlers/phase4/tool-invoker-handler.ts',
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(60), // Longer timeout for external calls
      environment: {
        EXECUTION_ARTIFACTS_BUCKET: this.executionArtifactsBucket?.bucketName || '',
        // Note: AWS_REGION is automatically set by Lambda runtime and should not be set manually
      },
      deadLetterQueue: this.toolInvokerDlq,
      deadLetterQueueEnabled: true,
      retryAttempts: 2,
    });
    
    // Grant S3 permissions (for raw response artifacts)
    if (this.executionArtifactsBucket) {
      this.executionArtifactsBucket.grantWrite(handler);
    }
    
    // Grant VPC permissions (if Gateway requires VPC)
    // Note: Add VPC configuration if Gateway is in VPC
    
    return handler;
  }

  private createExecutionRecorderHandler(props: ExecutionInfrastructureProps): lambda.Function {
    const handler = new lambdaNodejs.NodejsFunction(this, 'ExecutionRecorderHandler', {
      functionName: 'cc-native-execution-recorder',
      entry: 'src/handlers/phase4/execution-recorder-handler.ts',
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(30),
      environment: {
        EXECUTION_OUTCOMES_TABLE_NAME: this.executionOutcomesTable.tableName,
        EXECUTION_ATTEMPTS_TABLE_NAME: this.executionAttemptsTable.tableName,
        LEDGER_TABLE_NAME: props.ledgerTable.tableName,
        SIGNALS_TABLE_NAME: process.env.SIGNALS_TABLE_NAME || 'cc-native-signals',
        ACCOUNTS_TABLE_NAME: process.env.ACCOUNTS_TABLE_NAME || 'cc-native-accounts',
        EVENT_BUS_NAME: props.eventBus.eventBusName,
        // Note: AWS_REGION is automatically set by Lambda runtime and should not be set manually
      },
      deadLetterQueue: this.executionRecorderDlq,
      deadLetterQueueEnabled: true,
      retryAttempts: 2,
    });
    
    // Grant permissions
    this.executionOutcomesTable.grantWriteData(handler);
    this.executionAttemptsTable.grantWriteData(handler);
    props.ledgerTable.grantWriteData(handler);
    props.eventBus.grantPutEventsTo(handler);
    
    return handler;
  }

  private createCompensationHandler(props: ExecutionInfrastructureProps): lambda.Function {
    const handler = new lambdaNodejs.NodejsFunction(this, 'CompensationHandler', {
      functionName: 'cc-native-compensation-handler',
      entry: 'src/handlers/phase4/compensation-handler.ts',
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(60),
      environment: {
        ACTION_INTENT_TABLE_NAME: props.actionIntentTable.tableName,
        ACTION_TYPE_REGISTRY_TABLE_NAME: this.actionTypeRegistryTable.tableName,
        EXECUTION_OUTCOMES_TABLE_NAME: this.executionOutcomesTable.tableName,
        EXTERNAL_WRITE_DEDUPE_TABLE_NAME: this.externalWriteDedupeTable.tableName,
        // Note: AWS_REGION is automatically set by Lambda runtime and should not be set manually
      },
      deadLetterQueue: this.compensationDlq,
      deadLetterQueueEnabled: true,
      retryAttempts: 2,
    });
    
    // Grant permissions
    props.actionIntentTable.grantReadData(handler);
    this.actionTypeRegistryTable.grantReadData(handler);
    this.executionOutcomesTable.grantReadWriteData(handler);
    this.externalWriteDedupeTable.grantReadData(handler);
    
    return handler;
  }

  /**
   * Create CloudWatch alarms for execution monitoring
   */
  private createCloudWatchAlarms(): void {
    // Alarm for execution failures
    new cloudwatch.Alarm(this, 'ExecutionFailureAlarm', {
      metric: this.executionStateMachine.metricFailed(),
      threshold: 5,
      evaluationPeriods: 1,
      alarmDescription: 'Alert when execution failures exceed threshold',
    });
    
    // Alarm for execution duration
    new cloudwatch.Alarm(this, 'ExecutionDurationAlarm', {
      metric: this.executionStateMachine.metricExecutionTime(),
      threshold: 300000, // 5 minutes
      evaluationPeriods: 1,
      alarmDescription: 'Alert when execution duration exceeds threshold',
    });
  }

  private createExecutionStateMachine(): stepfunctions.StateMachine {
    // Define state machine (see Step Functions definition below)
    const definition = this.buildStateMachineDefinition();
    
    return new stepfunctions.StateMachine(this, 'ExecutionStateMachine', {
      stateMachineName: 'cc-native-execution-orchestrator',
      definition,
      timeout: cdk.Duration.hours(1),
    });
  }

  private buildStateMachineDefinition(): stepfunctions.IChainable {
    // START_EXECUTION
    const startExecution = new stepfunctionsTasks.LambdaInvoke(this, 'StartExecution', {
      lambdaFunction: this.executionStarterHandler,
      outputPath: '$',
    });
    
    // VALIDATE_PREFLIGHT
    const validatePreflight = new stepfunctionsTasks.LambdaInvoke(this, 'ValidatePreflight', {
      lambdaFunction: this.executionValidatorHandler,
      outputPath: '$',
    });
    
    // MAP_ACTION_TO_TOOL
    const mapActionToTool = new stepfunctionsTasks.LambdaInvoke(this, 'MapActionToTool', {
      lambdaFunction: this.toolMapperHandler,
      outputPath: '$',
    });
    
    // INVOKE_TOOL (with retry)
    const invokeTool = new stepfunctionsTasks.LambdaInvoke(this, 'InvokeTool', {
      lambdaFunction: this.toolInvokerHandler,
      outputPath: '$',
      retryOnServiceExceptions: true,
    }).addRetry({
      errors: ['TransientError'],
      interval: cdk.Duration.seconds(2),
      maxAttempts: 3,
      backoffRate: 2.0,
    });
    
    // COMPENSATE_ACTION (for permanent errors)
    const compensateAction = new stepfunctionsTasks.LambdaInvoke(this, 'CompensateAction', {
      lambdaFunction: this.compensationHandler,
      outputPath: '$',
    });
    
    // RECORD_OUTCOME
    const recordOutcome = new stepfunctionsTasks.LambdaInvoke(this, 'RecordOutcome', {
      lambdaFunction: this.executionRecorderHandler,
      outputPath: '$',
    });
    
    // RECORD_FAILURE (for errors in early states)
    const recordFailure = new stepfunctionsTasks.LambdaInvoke(this, 'RecordFailure', {
      lambdaFunction: this.executionRecorderHandler,
      outputPath: '$',
    });
    
    // Add error handling
    startExecution.addCatch(recordFailure, {
      errors: ['States.ALL'],
      resultPath: '$.error',
    });
    
    validatePreflight.addCatch(recordFailure, {
      errors: ['States.ALL'],
      resultPath: '$.error',
    });
    
    mapActionToTool.addCatch(recordFailure, {
      errors: ['States.ALL'],
      resultPath: '$.error',
    });
    
    invokeTool.addCatch(compensateAction, {
      errors: ['PermanentError'],
      resultPath: '$.error',
    });
    
    invokeTool.addCatch(recordFailure, {
      errors: ['States.ALL'],
      resultPath: '$.error',
    });
    
    // Build chain
    return startExecution
      .next(validatePreflight)
      .next(mapActionToTool)
      .next(invokeTool)
      .next(recordOutcome);
  }

  private createExecutionTriggerRule(props: ExecutionInfrastructureProps): events.Rule {
    const rule = new events.Rule(this, 'ExecutionTriggerRule', {
      eventBus: props.eventBus,
      eventPattern: {
        source: ['cc-native'],
        detailType: ['ACTION_APPROVED'],
      },
    });
    
    // Trigger Step Functions with action_intent_id
    // Note: Execution name uses action_intent_id for idempotency (Step Functions enforces uniqueness)
    rule.addTarget(new eventsTargets.SfnStateMachine(this.executionStateMachine, {
      input: events.RuleTargetInput.fromObject({
        action_intent_id: events.EventField.fromPath('$.detail.data.action_intent_id'),
        tenant_id: events.EventField.fromPath('$.detail.data.tenant_id'),
        account_id: events.EventField.fromPath('$.detail.data.account_id'),
      }),
    }));
    
    // Grant Step Functions permission to be invoked by EventBridge
    this.executionStateMachine.grantStartExecution(new iam.ServicePrincipal('events.amazonaws.com'));
    
    return rule;
  }
}
```

---

## 5. Step Functions State Machine Definition

**File:** `src/stacks/constructs/ExecutionInfrastructure.ts` (in `buildStateMachineDefinition` method)

**State Machine JSON (for reference):**

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
      "Next": "ValidatePreflight",
      "Retry": [
        {
          "ErrorEquals": ["States.TaskFailed"],
          "IntervalSeconds": 1,
          "MaxAttempts": 0
        }
      ],
      "Catch": [
        {
          "ErrorEquals": ["States.ALL"],
          "Next": "RecordFailure",
          "ResultPath": "$.error"
        }
      ]
    },
    "ValidatePreflight": {
      "Type": "Task",
      "Resource": "arn:aws:states:::lambda:invoke",
      "Parameters": {
        "FunctionName": "cc-native-execution-validator",
        "Payload": {
          "action_intent_id": "$.action_intent_id",
          "tenant_id": "$.tenant_id",
          "account_id": "$.account_id"
        }
      },
      "Next": "MapActionToTool",
      "Catch": [
        {
          "ErrorEquals": ["States.ALL"],
          "Next": "RecordFailure",
          "ResultPath": "$.error"
        }
      ]
    },
    "MapActionToTool": {
      "Type": "Task",
      "Resource": "arn:aws:states:::lambda:invoke",
      "Parameters": {
        "FunctionName": "cc-native-tool-mapper",
        "Payload": {
          "action_intent_id": "$.action_intent_id",
          "tenant_id": "$.tenant_id",
          "account_id": "$.account_id",
          "idempotency_key": "$.idempotency_key"
        }
      },
      "Next": "InvokeTool",
      "Catch": [
        {
          "ErrorEquals": ["States.ALL"],
          "Next": "RecordFailure",
          "ResultPath": "$.error"
        }
      ]
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
          "jwt_token": "$.jwt_token",
          "action_intent_id": "$.action_intent_id",
          "tenant_id": "$.tenant_id",
          "account_id": "$.account_id",
          "trace_id": "$.trace_id"
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
          "Next": "RecordFailure",
          "ResultPath": "$.error"
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
          "tenant_id": "$.tenant_id",
          "account_id": "$.account_id",
          "trace_id": "$.trace_id",
          "tool_invocation_response": "$.tool_invocation_response",
          "tool_name": "$.tool_name",
          "tool_schema_version": "$.tool_schema_version",
          "attempt_count": "$.attempt_count",
          "started_at": "$.started_at"
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
          "tenant_id": "$.tenant_id",
          "account_id": "$.account_id",
          "trace_id": "$.trace_id",
          "status": "FAILED",
          "error": "$.error"
        }
      },
      "End": true
    }
  }
}
```

---

## 6. Connector Adapters (Initial)

### File: `src/adapters/IConnectorAdapter.ts`

**Purpose:** Connector adapter interface

**Interface:**

```typescript
import { MCPToolInvocation, MCPResponse } from '../../types/MCPTypes';

// Note: MCPTypes.ts must be created first (see Type Definitions section)

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
    const { name, arguments: args, id } = invocation.params;
    
    if (name === 'internal.create_note') {
      return await this.createNote(args, id);
    }
    
    if (name === 'internal.create_task') {
      return await this.createTask(args, id);
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
    
    return {
      jsonrpc: '2.0',
      id: invocationId, // Use parameter instead of invocation.id (fix scope issue)
      result: {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            external_object_id: noteId,
            object_type: 'Note',
          }),
        }],
      },
    };
  }

  private async createTask(args: Record<string, any>, invocationId: string): Promise<MCPResponse> {
    // Similar to createNote
    const taskId = `task_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    
    // TODO: Write to internal tasks table
    
    return {
      jsonrpc: '2.0',
      id: invocationId,
      result: {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            external_object_id: taskId,
            object_type: 'Task',
          }),
        }],
      },
    };
  }
}
```

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
        id: invocation.id,
        result: {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              external_object_id: existingObjectId,
              object_type: 'Task',
            }),
          }],
        },
      };
    }
    
    if (name === 'crm.create_task') {
      return await this.createTask(args, idempotencyKey);
    }
    
    throw new Error(`Unknown tool: ${name}`);
  }

  async validate(parameters: Record<string, any>): Promise<{ valid: boolean; error?: string }> {
    if (!parameters.title) {
      return { valid: false, error: 'title is required' };
    }
    return { valid: true };
  }

  private async createTask(args: Record<string, any>, idempotencyKey: string): Promise<MCPResponse> {
    // Get OAuth token (from Gateway context)
    const oauthToken = args.oauth_token; // Provided by Gateway
    
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
    const idempotencyService = new IdempotencyService();
    await idempotencyService.recordExternalWriteDedupe(
      this.dynamoClient,
      this.dedupeTableName,
      idempotencyKey,
      taskId,
      args.action_intent_id,
      'crm.create_task'
    );
    
    return {
      jsonrpc: '2.0',
      id: invocation.id,
      result: {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            external_object_id: taskId,
            object_type: 'Task',
            object_url: `https://your-instance.salesforce.com/${taskId}`,
          }),
        }],
      },
    };
  }
}
```

---

## 7. Testing Approach

### Unit Tests

**Files:**
- `src/tests/unit/execution/ExecutionAttemptService.test.ts`
- `src/tests/unit/execution/ActionTypeRegistryService.test.ts`
- `src/tests/unit/execution/IdempotencyService.test.ts`
- `src/tests/unit/execution/ExecutionOutcomeService.test.ts`
- `src/tests/unit/handlers/phase4/execution-starter-handler.test.ts`
- `src/tests/unit/handlers/phase4/execution-validator-handler.test.ts`
- `src/tests/unit/handlers/phase4/tool-mapper-handler.test.ts`
- `src/tests/unit/handlers/phase4/tool-invoker-handler.test.ts`
- `src/tests/unit/handlers/phase4/execution-recorder-handler.test.ts`

### Integration Tests

**Files:**
- `src/tests/integration/execution/execution-flow.test.ts` - End-to-end execution flow
- `src/tests/integration/execution/idempotency.test.ts` - Dual-layer idempotency
- `src/tests/integration/execution/kill-switches.test.ts` - Kill switch behavior

### Test Scripts

**File: `scripts/phase_4/test-phase4-execution.sh`**

```bash
#!/bin/bash
# Test Phase 4 execution flow

# 1. Create ActionIntentV1
# 2. Approve action (triggers ACTION_APPROVED event)
# 3. Wait for Step Functions execution
# 4. Verify ExecutionAttempt record
# 5. Verify ActionOutcomeV1 record
# 6. Verify ledger events
```

---

## 8. Implementation Checklist

### Phase 4.1: Foundation
- [ ] Create `src/types/ExecutionTypes.ts`
- [ ] Create `src/types/MCPTypes.ts` (MCP protocol types)
- [ ] Update `src/types/LedgerTypes.ts` (add EXECUTION_STARTED, ACTION_EXECUTED, ACTION_FAILED)
- [ ] Update `src/services/decision/ActionIntentService.ts` (make getIntent() public)
- [ ] Create `src/services/execution/ExecutionAttemptService.ts`
- [ ] Create `src/services/execution/ActionTypeRegistryService.ts`
- [ ] Create `src/services/execution/IdempotencyService.ts`
- [ ] Create `src/services/execution/ExecutionOutcomeService.ts`
- [ ] Create `src/services/execution/KillSwitchService.ts`
- [ ] Create `src/handlers/phase4/execution-starter-handler.ts`
- [ ] Create `src/handlers/phase4/execution-validator-handler.ts`
- [ ] Create DynamoDB tables in CDK (with GSI for ActionTypeRegistry)
- [ ] Unit tests for services

### Phase 4.2: Orchestration
- [ ] Create `src/handlers/phase4/tool-mapper-handler.ts`
- [ ] Create `src/handlers/phase4/tool-invoker-handler.ts`
- [ ] Create `src/handlers/phase4/execution-recorder-handler.ts`
- [ ] Create `src/handlers/phase4/compensation-handler.ts`
- [ ] Create Step Functions state machine in CDK (with error handling)
- [ ] Create EventBridge rule (ACTION_APPROVED → Step Functions)
- [ ] Add DLQs for all Lambda functions
- [ ] Integration tests for orchestration

### Phase 4.3: Connectors
- [ ] Create `src/adapters/IConnectorAdapter.ts`
- [ ] Create `src/adapters/internal/InternalConnectorAdapter.ts`
- [ ] Create `src/adapters/crm/CrmConnectorAdapter.ts`
- [ ] Set up AgentCore Gateway (CDK or L1 construct)
- [ ] Register adapters as Gateway targets
- [ ] Seed initial ActionTypeRegistry entries
- [ ] Integration tests for connectors

### Phase 4.4: Safety & Outcomes
- [ ] Implement kill switch checks
- [ ] Implement signal emission (in execution-recorder-handler)
- [ ] Create execution status API handler (`src/handlers/phase4/execution-status-api-handler.ts`)
- [ ] Add CloudWatch alarms (in CDK)
- [ ] Add S3 bucket for raw response artifacts
- [ ] End-to-end tests

### Phase 4.5: Testing & Polish
- [ ] Complete unit test coverage
- [ ] Complete integration test coverage
- [ ] End-to-end test suite
- [ ] Update documentation
- [ ] Performance testing
- [ ] Security audit

---

## 9. Next Steps

1. ✅ Architecture defined
2. ✅ Code-level plan created
3. ⏳ Begin Phase 4.1 implementation (Foundation)
4. ⏳ Set up initial ActionTypeRegistry entries
5. ⏳ Implement first connector adapter (Internal)

---

**Ready to begin implementation?** Start with Phase 4.1 (Foundation) to establish the execution infrastructure.
