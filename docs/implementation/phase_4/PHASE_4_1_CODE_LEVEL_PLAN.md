# Phase 4.1 — Foundation: Code-Level Implementation Plan

**Status:** 🟡 **PLANNING**  
**Created:** 2026-01-26  
**Last Updated:** 2026-01-26  
**Parent Document:** `PHASE_4_CODE_LEVEL_PLAN.md`

---

## Overview

Phase 4.1 establishes the foundation for execution infrastructure:
- Type definitions for execution layer
- Core services for execution management
- Initial handlers for execution lifecycle
- DynamoDB tables for execution state

**Duration:** Week 1-2  
**Dependencies:** Phase 3 complete (ActionIntentV1 available)

---

## Implementation Tasks

1. Type definitions
2. DynamoDB tables (CDK)
3. ExecutionAttempt service
4. ActionTypeRegistry service
5. Idempotency service
6. ExecutionOutcome service
7. KillSwitch service
8. Execution starter handler
9. Execution validator handler

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
  sk: string; // LATEST (fixed SK pattern)
  
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

// Additional schemas for other types...
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

## 2. Service Layer

### File: `src/services/execution/ExecutionAttemptService.ts`

**Purpose:** Manage execution attempt locking (exactly-once guarantee)

**Methods:**

```typescript
import { DynamoDBDocumentClient, PutCommand, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { Logger } from '../core/Logger';
import { ExecutionAttempt } from '../../types/ExecutionTypes';

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
import { DynamoDBDocumentClient, GetCommand, QueryCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { Logger } from '../core/Logger';
import { ActionTypeRegistry } from '../../types/ExecutionTypes';

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
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { ExternalWriteDedupe } from '../../types/ExecutionTypes';

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
import { Logger } from '../core/Logger';
import { ActionOutcomeV1 } from '../../types/ExecutionTypes';

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
   * List outcomes for account
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

// Initialize AWS clients
const region = process.env.AWS_REGION || 'us-west-2';
const clientConfig = getAWSClientConfig(region);
const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient(clientConfig), {
  marshallOptions: { removeUndefinedValues: true },
});

// Initialize services
const executionAttemptService = new ExecutionAttemptService(
  dynamoClient,
  process.env.EXECUTION_ATTEMPTS_TABLE_NAME || 'cc-native-execution-attempts',
  logger
);

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

const idempotencyService = new IdempotencyService();

const ledgerService = new LedgerService(
  logger,
  process.env.LEDGER_TABLE_NAME || 'cc-native-ledger',
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

// Initialize AWS clients
const region = process.env.AWS_REGION || 'us-west-2';
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

const killSwitchService = new KillSwitchService(
  dynamoClient,
  process.env.TENANTS_TABLE_NAME || 'cc-native-tenants',
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

---

## 4. CDK Infrastructure (Partial)

### File: `src/stacks/constructs/ExecutionInfrastructure.ts` (Phase 4.1 Partial)

**Purpose:** CDK construct for Phase 4.1 foundation (tables, initial handlers)

**Phase 4.1 Components:**

```typescript
import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';

export interface ExecutionInfrastructureProps {
  readonly eventBus: events.EventBus;
  readonly ledgerTable: dynamodb.Table;
  readonly actionIntentTable: dynamodb.Table;
  readonly tenantsTable: dynamodb.Table;
  readonly region?: string;
}

export class ExecutionInfrastructure extends Construct {
  // DynamoDB Tables (Phase 4.1)
  public readonly executionAttemptsTable: dynamodb.Table;
  public readonly executionOutcomesTable: dynamodb.Table;
  public readonly actionTypeRegistryTable: dynamodb.Table;
  public readonly externalWriteDedupeTable: dynamodb.Table;
  
  // Lambda Functions (Phase 4.1)
  public readonly executionStarterHandler: lambda.Function;
  public readonly executionValidatorHandler: lambda.Function;
  
  // Dead Letter Queues (Phase 4.1)
  public readonly executionStarterDlq: sqs.Queue;
  public readonly executionValidatorDlq: sqs.Queue;

  constructor(scope: Construct, id: string, props: ExecutionInfrastructureProps) {
    super(scope, id);

    // 1. Create DynamoDB Tables
    this.executionAttemptsTable = this.createExecutionAttemptsTable();
    this.executionOutcomesTable = this.createExecutionOutcomesTable();
    this.actionTypeRegistryTable = this.createActionTypeRegistryTable();
    this.externalWriteDedupeTable = this.createExternalWriteDedupeTable();
    
    // 2. Create Dead Letter Queues
    this.executionStarterDlq = this.createDlq('ExecutionStarterDlq', 'cc-native-execution-starter-handler-dlq');
    this.executionValidatorDlq = this.createDlq('ExecutionValidatorDlq', 'cc-native-execution-validator-handler-dlq');
    
    // 3. Create Lambda Functions (Phase 4.1 only)
    this.executionStarterHandler = this.createExecutionStarterHandler(props);
    this.executionValidatorHandler = this.createExecutionValidatorHandler(props);
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
        AWS_REGION: props.region || 'us-west-2',
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
        AWS_REGION: props.region || 'us-west-2',
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
}
```

---

## 5. Prerequisites

### Update Existing Files

**File: `src/services/decision/ActionIntentService.ts`**

**Change Required:** Make `getIntent()` method public

```typescript
// Change from:
private async getIntent(intentId: string, tenantId: string, accountId: string): Promise<ActionIntentV1 | null>

// To:
public async getIntent(intentId: string, tenantId: string, accountId: string): Promise<ActionIntentV1 | null>
```

**File: `src/types/LedgerTypes.ts`**

**Change Required:** Add new LedgerEventType values

```typescript
export enum LedgerEventType {
  // ... existing values ...
  EXECUTION_STARTED = 'EXECUTION_STARTED',
  ACTION_EXECUTED = 'ACTION_EXECUTED',
  ACTION_FAILED = 'ACTION_FAILED',
}
```

---

## 6. Testing

### Unit Tests

**Files to Create:**
- `src/tests/unit/execution/ExecutionAttemptService.test.ts`
- `src/tests/unit/execution/ActionTypeRegistryService.test.ts`
- `src/tests/unit/execution/IdempotencyService.test.ts`
- `src/tests/unit/execution/ExecutionOutcomeService.test.ts`
- `src/tests/unit/execution/KillSwitchService.test.ts`
- `src/tests/unit/handlers/phase4/execution-starter-handler.test.ts`
- `src/tests/unit/handlers/phase4/execution-validator-handler.test.ts`

---

## 7. Implementation Checklist

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
- [ ] Create DLQs for Phase 4.1 handlers
- [ ] Unit tests for all services
- [ ] Unit tests for Phase 4.1 handlers

---

## 8. Next Steps

After Phase 4.1 completion:
- ✅ Foundation services and handlers ready
- ⏳ Proceed to Phase 4.2 (Orchestration) - Step Functions, tool mapper, tool invoker, execution recorder

---

**See:** `PHASE_4_CODE_LEVEL_PLAN.md` for complete Phase 4 overview and cross-references.
