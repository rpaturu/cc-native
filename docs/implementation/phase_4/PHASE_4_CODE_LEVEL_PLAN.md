# Phase 4 — Code-Level Implementation Plan

**Status:** 🟡 **PLANNING**  
**Created:** 2026-01-26  
**Last Updated:** 2026-01-26

---

## Overview

This document provides a detailed, file-by-file implementation plan for Phase 4: Bounded Execution & AI-Native Action Fulfillment. It follows the architectural refinements from `PHASE_4_ARCHITECTURE.md` and maintains consistency with Phase 3 patterns.

**Key Architectural Refinements:**
1. ExecutionAttempt record (exactly-once guarantee)
2. Dual-layer idempotency (orchestrator + adapter)
3. Versioned ActionTypeRegistry (deterministic tool mapping)
4. Split validation (preflight + runtime guards)
5. Structured ActionOutcomeV1 contract
6. ToolInvoker Lambda (MCP Gateway client)

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
export class ExecutionAttemptService {
  constructor(
    private dynamoClient: DynamoDBDocumentClient,
    private tableName: string,
    private logger: Logger
  ) {}

  /**
   * Start execution attempt (conditional write for idempotency)
   * Returns attempt if created, throws if already exists
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
    
    const attempt: ExecutionAttempt = {
      pk: `TENANT#${tenantId}#ACCOUNT#${accountId}`,
      sk: `EXECUTION#${actionIntentId}`,
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
      // Conditional write: only succeed if execution doesn't exist OR is terminal
      await this.dynamoClient.send(new PutCommand({
        TableName: this.tableName,
        Item: attempt,
        ConditionExpression: 
          'attribute_not_exists(action_intent_id) OR status IN (:succeeded, :failed, :cancelled)',
        ExpressionAttributeValues: {
          ':succeeded': 'SUCCEEDED',
          ':failed': 'FAILED',
          ':cancelled': 'CANCELLED',
        },
      }));
      
      return attempt;
    } catch (error: any) {
      if (error.name === 'ConditionalCheckFailedException') {
        // Execution already exists and is RUNNING
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
      // Get latest version (query by action_type, sort by created_at desc)
      const result = await this.dynamoClient.send(new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'pk = :pk',
        ExpressionAttributeValues: {
          ':pk': `ACTION_TYPE#${actionType}`,
        },
        ScanIndexForward: false, // Descending order
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
        sk: `TIMESTAMP#${Date.now()}`, // Use current timestamp for SK (query latest)
      },
    }));
    
    if (result.Item) {
      return (result.Item as ExternalWriteDedupe).external_object_id;
    }
    
    return null;
  }

  /**
   * Record external write dedupe (adapter-level idempotency)
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
      sk: `TIMESTAMP#${Date.now()}`,
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
export class KillSwitchService {
  constructor(
    private dynamoClient: DynamoDBDocumentClient,
    private configTableName: string, // Tenant config table
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
   */
  async getKillSwitchConfig(tenantId: string): Promise<KillSwitchConfig> {
    const result = await this.dynamoClient.send(new GetCommand({
      TableName: this.configTableName,
      Key: {
        pk: `TENANT#${tenantId}`,
        sk: 'KILL_SWITCH_CONFIG',
      },
    }));
    
    if (result.Item) {
      return result.Item as KillSwitchConfig;
    }
    
    // Default: execution enabled, no disabled action types
    return {
      tenant_id: tenantId,
      execution_enabled: true,
      disabled_action_types: [],
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
 */
export const handler: Handler = async (event: { action_intent_id: string }) => {
  const { action_intent_id } = event;
  const traceId = traceService.generateTraceId();
  
  logger.info('Execution starter invoked', { action_intent_id, traceId });
  
  try {
    // 1. Fetch ActionIntentV1
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

const actionTypeRegistryService = new ActionTypeRegistryService(
  dynamoClient,
  process.env.ACTION_TYPE_REGISTRY_TABLE_NAME || 'cc-native-action-type-registry',
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
    
    // 5. Get Gateway URL and JWT token (from environment/config)
    const gatewayUrl = process.env.AGENTCORE_GATEWAY_URL || '';
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
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { getAWSClientConfig } from '../../utils/aws-client-config';
import axios, { AxiosError } from 'axios';

const logger = new Logger('ToolInvokerHandler');
const traceService = new TraceService(logger);

// Initialize AWS clients
const region = process.env.AWS_REGION || 'us-west-2';
const clientConfig = getAWSClientConfig(region);
const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient(clientConfig), {
  marshallOptions: { removeUndefinedValues: true },
});

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
        throw error;
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
  
  throw lastError;
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

// Initialize AWS clients
const region = process.env.AWS_REGION || 'us-west-2';
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
    
    // 4. Return outcome
    return {
      outcome,
    };
  } catch (error: any) {
    logger.error('Execution recording failed', { action_intent_id, error });
    throw error;
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
import { Construct } from 'constructs';

export interface ExecutionInfrastructureProps {
  readonly eventBus: events.EventBus;
  readonly ledgerTable: dynamodb.Table;
  readonly actionIntentTable: dynamodb.Table;
  readonly tenantsTable: dynamodb.Table;
  readonly userPool?: cognito.IUserPool; // For JWT auth
  readonly region?: string;
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
  
  // Step Functions
  public readonly executionStateMachine: stepfunctions.StateMachine;
  
  // EventBridge Rule
  public readonly executionTriggerRule: events.Rule;

  constructor(scope: Construct, id: string, props: ExecutionInfrastructureProps) {
    super(scope, id);

    // 1. Create DynamoDB Tables
    this.executionAttemptsTable = this.createExecutionAttemptsTable();
    this.executionOutcomesTable = this.createExecutionOutcomesTable();
    this.actionTypeRegistryTable = this.createActionTypeRegistryTable();
    this.externalWriteDedupeTable = this.createExternalWriteDedupeTable();
    
    // 2. Create Lambda Functions
    this.executionStarterHandler = this.createExecutionStarterHandler(props);
    this.executionValidatorHandler = this.createExecutionValidatorHandler(props);
    this.toolMapperHandler = this.createToolMapperHandler(props);
    this.toolInvokerHandler = this.createToolInvokerHandler(props);
    this.executionRecorderHandler = this.createExecutionRecorderHandler(props);
    
    // 3. Create Step Functions State Machine
    this.executionStateMachine = this.createExecutionStateMachine();
    
    // 4. Create EventBridge Rule (ACTION_APPROVED → Step Functions)
    this.executionTriggerRule = this.createExecutionTriggerRule(props);
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
    return new dynamodb.Table(this, 'ActionTypeRegistryTable', {
      tableName: 'cc-native-action-type-registry',
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
    });
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
        AWS_REGION: props.region || 'us-west-2',
      },
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
        AWS_REGION: props.region || 'us-west-2',
      },
    });
    
    // Grant VPC permissions (if Gateway requires VPC)
    // Grant S3 permissions (for raw response artifacts)
    
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
        AWS_REGION: props.region || 'us-west-2',
      },
    });
    
    // Grant permissions
    this.executionOutcomesTable.grantWriteData(handler);
    this.executionAttemptsTable.grantWriteData(handler);
    props.ledgerTable.grantWriteData(handler);
    
    return handler;
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
      errors: ['States.TaskFailed'],
      interval: cdk.Duration.seconds(2),
      maxAttempts: 3,
      backoffRate: 2.0,
    });
    
    // RECORD_OUTCOME
    const recordOutcome = new stepfunctionsTasks.LambdaInvoke(this, 'RecordOutcome', {
      lambdaFunction: this.executionRecorderHandler,
      outputPath: '$',
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
    rule.addTarget(new eventsTargets.SfnStateMachine(this.executionStateMachine, {
      input: events.RuleTargetInput.fromObject({
        action_intent_id: events.EventField.fromPath('$.detail.data.action_intent_id'),
        tenant_id: events.EventField.fromPath('$.detail.data.tenant_id'),
        account_id: events.EventField.fromPath('$.detail.data.account_id'),
      }),
    }));
    
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
    const { name, arguments: args } = invocation.params;
    
    if (name === 'internal.create_note') {
      return await this.createNote(args);
    }
    
    if (name === 'internal.create_task') {
      return await this.createTask(args);
    }
    
    throw new Error(`Unknown tool: ${name}`);
  }

  async validate(parameters: Record<string, any>): Promise<{ valid: boolean; error?: string }> {
    // Basic validation
    return { valid: true };
  }

  private async createNote(args: Record<string, any>): Promise<MCPResponse> {
    // Create internal note in DynamoDB
    const noteId = `note_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    
    // TODO: Write to internal notes table
    
    return {
      jsonrpc: '2.0',
      id: invocation.id,
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

  private async createTask(args: Record<string, any>): Promise<MCPResponse> {
    // Similar to createNote
    // ...
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
- [ ] Create `src/services/execution/ExecutionAttemptService.ts`
- [ ] Create `src/services/execution/ActionTypeRegistryService.ts`
- [ ] Create `src/services/execution/IdempotencyService.ts`
- [ ] Create `src/services/execution/ExecutionOutcomeService.ts`
- [ ] Create `src/services/execution/KillSwitchService.ts`
- [ ] Create `src/handlers/phase4/execution-starter-handler.ts`
- [ ] Create `src/handlers/phase4/execution-validator-handler.ts`
- [ ] Create DynamoDB tables in CDK
- [ ] Unit tests for services

### Phase 4.2: Orchestration
- [ ] Create `src/handlers/phase4/tool-mapper-handler.ts`
- [ ] Create `src/handlers/phase4/tool-invoker-handler.ts`
- [ ] Create `src/handlers/phase4/execution-recorder-handler.ts`
- [ ] Create Step Functions state machine in CDK
- [ ] Create EventBridge rule (ACTION_APPROVED → Step Functions)
- [ ] Integration tests for orchestration

### Phase 4.3: Connectors
- [ ] Create `src/adapters/IConnectorAdapter.ts`
- [ ] Create `src/adapters/internal/InternalConnectorAdapter.ts`
- [ ] Create `src/adapters/crm/CrmConnectorAdapter.ts`
- [ ] Set up AgentCore Gateway (CDK)
- [ ] Register adapters as Gateway targets
- [ ] Integration tests for connectors

### Phase 4.4: Safety & Outcomes
- [ ] Implement kill switch checks
- [ ] Implement signal emission
- [ ] Create execution status API handler
- [ ] Add CloudWatch alarms
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
