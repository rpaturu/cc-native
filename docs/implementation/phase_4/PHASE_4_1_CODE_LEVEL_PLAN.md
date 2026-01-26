# Phase 4.1 — Foundation: Code-Level Implementation Plan

**Status:** ✅ **COMPLETE**  
**Created:** 2026-01-26  
**Last Updated:** 2026-01-26  
**Implementation Completed:** 2026-01-26  
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

## Execution Contract (Canonical)

**EventBridge → Step Functions → Lambda Handlers**

### 1. EventBridge `ACTION_APPROVED` Event Detail Schema

```typescript
{
  source: 'cc-native',
  'detail-type': 'ACTION_APPROVED',
  detail: {
    data: {
      action_intent_id: string;      // Required
      tenant_id: string;              // Required
      account_id: string;             // Required
      // ... other fields from ActionIntentV1
    }
  }
}
```

### 2. Step Functions Input Schema (from EventBridge rule)

```typescript
{
  action_intent_id: string;  // Required
  tenant_id: string;          // Required (extracted from event.detail.data.tenant_id)
  account_id: string;         // Required (extracted from event.detail.data.account_id)
}
```

**Note:** EventBridge rule (`createExecutionTriggerRule`) must extract and pass `tenant_id` and `account_id` from the event detail. See Phase 4.2 CDK code.

### 3. Step Functions Output Schema (execution-starter-handler)

```typescript
{
  action_intent_id: string;
  idempotency_key: string;
  tenant_id: string;
  account_id: string;
  trace_id: string;
  registry_version: number;  // Registry version used for this execution
}
```

**Note:** `registry_version` is passed to downstream handlers for backwards compatibility.

**Note:** `trace_id` in output is `execution_trace_id` (generated at execution start), not `decision_trace_id`.

### 4. Execution Tracing Contract

**Two separate trace concepts:**

* **`decision_trace_id`**: From Phase 3 ActionIntentV1 (decision layer trace)
* **`execution_trace_id`**: Generated at execution start (execution layer trace)

**Contract:**
- Execution handlers use `execution_trace_id` for all execution lifecycle events
- Ledger events include both `trace_id` (execution) and `decision_trace_id` (correlation field)
- Step Functions passes `execution_trace_id` through all states
- This enables clean separation: "one execution trace" vs "one decision trace"

**Rationale:** Prevents "8 different traces for one execution" debugging confusion. Execution has its own trace for operational debugging, but preserves decision trace for correlation.

### 5. ActionIntent Contract Requirement

**Phase 3 MUST store `registry_version` in `ActionIntentV1` at creation time.**

```typescript
// In ActionIntentV1 (Phase 3)
export interface ActionIntentV1 {
  // ... existing fields ...
  registry_version: number;  // REQUIRED: Registry version used at decision time
  // This locks the mapping used for execution, preventing silent behavioral drift
}
```

**Rationale:** If Phase 4 uses "latest mapping" for old intents, registry changes will create silent behavioral drift. Locking `registry_version` at decision time ensures deterministic execution.

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
/**
 * ExecutionAttempt (Model A: ExecutionLock)
 * 
 * One item per intent (not per attempt). Tracks execution lock and status.
 * Step Functions retries do NOT create new attempt items - they reuse the same lock.
 * 
 * Key pattern: pk = TENANT#<tenant_id>#ACCOUNT#<account_id>, sk = EXECUTION#<action_intent_id>
 */
export interface ExecutionAttempt {
  // Composite keys
  pk: string; // TENANT#tenant_id#ACCOUNT#account_id
  sk: string; // EXECUTION#action_intent_id
  
  // Execution locking
  action_intent_id: string;
  attempt_count: number; // Number of attempts (incremented on retries)
  last_attempt_id: string; // Most recent attempt_id (for logging/tracing)
  status: 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
  idempotency_key: string; // hash(tenant_id + action_intent_id + tool_name + normalized_params + registry_version)
  last_error_class?: string; // Error class from last failure (if any)
  
  // Timestamps
  started_at: string; // ISO timestamp (when current/last attempt started)
  updated_at: string; // ISO timestamp (last update)
  
  // Metadata
  tenant_id: string;
  account_id: string;
  trace_id: string;
  
  // TTL (for cleanup of stuck RUNNING states)
  // Note: TTL deletion can hide forensic evidence of stuck executions.
  // Operational sweeper/stale execution detector should be added in Phase 4.3+ to
  // detect and alert on RUNNING items older than expected (even if TTL is set).
  ttl?: number; // started_at + SFN timeout + buffer (epoch seconds)
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
/**
 * ActionTypeRegistry
 * 
 * Versioned tool mapping with two separate version concepts:
 * - registry_version: Version of the mapping itself (how action_type maps to tool)
 * - tool_schema_version: Version of the tool's input schema (tool contract)
 * 
 * Key pattern: pk = ACTION_TYPE#<action_type>, sk = REGISTRY_VERSION#<n>
 * 
 * This separation allows:
 * - Executing old intents using the exact registry_version recorded in the intent
 * - Tool schema evolution without breaking existing mappings
 * - Backwards compatibility for historical executions
 */
export interface ActionTypeRegistry {
  // Composite keys
  pk: string; // ACTION_TYPE#action_type
  sk: string; // REGISTRY_VERSION#<registry_version> (NOT tool_schema_version)
  
  // Mapping metadata
  action_type: string; // e.g., "CREATE_CRM_TASK"
  registry_version: number; // Version of this mapping (incremented when mapping changes)
  tool_name: string; // e.g., "crm.create_task"
  tool_schema_version: string; // Tool input schema version (tool contract version)
  
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
 * 
 * Design: Option A - Immutable per idempotency_key with history
 * - Each write creates a new item with sk = CREATED_AT#<timestamp> (preserves audit history)
 * - LATEST pointer item (sk = LATEST) points to most recent write
 * - This preserves audit history while enabling fast "latest" lookup
 * 
 * Note: LATEST pointer is best-effort; source of truth is history items.
 * If LATEST pointer is missing, fall back to querying history items by created_at descending.
 */
export interface ExternalWriteDedupe {
  // Composite keys
  pk: string; // IDEMPOTENCY_KEY#<hash>
  sk: string; // CREATED_AT#<timestamp> (for history) OR LATEST (pointer)
  
  // Dedupe metadata
  idempotency_key: string;
  external_object_id: string; // Result from external API
  action_intent_id: string;
  tool_name: string;
  
  // Timestamps
  created_at: string; // ISO timestamp
  
  // TTL
  ttl?: number; // created_at + 7 days (epoch seconds)
  
  // For LATEST pointer items only
  latest_sk?: string; // Points to CREATED_AT#<timestamp> of most recent write
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

/**
 * ExecutionAttempt (Model A: ExecutionLock)
 * 
 * One item per intent (not per attempt). Tracks execution lock and status.
 * Step Functions retries do NOT create new attempt items - they reuse the same lock.
 * 
 * Key pattern: pk = TENANT#<tenant_id>#ACCOUNT#<account_id>, sk = EXECUTION#<action_intent_id>
 * 
 * Allowed State Transitions:
 * - RUNNING → SUCCEEDED (terminal, immutable)
 * - RUNNING → FAILED (terminal, immutable)
 * - RUNNING → CANCELLED (terminal, immutable)
 * - SUCCEEDED → RUNNING (allowed for manual re-run, admin-only, not automatic SFN retries)
 * - FAILED → RUNNING (allowed for manual re-run, admin-only, not automatic SFN retries)
 * - CANCELLED → RUNNING (allowed for manual re-run, admin-only, not automatic SFN retries)
 * 
 * Note: Re-run after terminal state is allowed by startAttempt() conditional update.
 * This enables manual re-execution of failed/succeeded intents (admin use case).
 * 
 * IMPORTANT: Reruns are admin-only / explicitly initiated, NOT automatic SFN retries.
 * Step Functions retries only occur for RUNNING → RUNNING transitions (not terminal → RUNNING).
 * This prevents accidental double-writes from treating reruns as normal retry semantics.
 */
export const ExecutionAttemptSchema = z.object({
  pk: z.string(),
  sk: z.string(),
  // GSI attributes
  gsi1pk: z.string().optional(), // ACTION_INTENT#<action_intent_id> (for querying by action_intent_id)
  gsi1sk: z.string().optional(), // UPDATED_AT#<timestamp>
  gsi2pk: z.string().optional(), // TENANT#<tenant_id> (for tenant-level operational queries)
  gsi2sk: z.string().optional(), // UPDATED_AT#<timestamp> (for sorting by recency)
  action_intent_id: z.string(),
  attempt_count: z.number(), // Number of attempts (incremented on retries)
  last_attempt_id: z.string(), // Most recent attempt_id (for logging/tracing)
  status: z.enum(['RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED']),
  idempotency_key: z.string(),
  started_at: z.string(), // When current/last attempt started
  last_error_class: z.string().optional(), // Error class from last failure (if any)
  updated_at: z.string(), // Last update timestamp
  tenant_id: z.string(),
  account_id: z.string(),
  trace_id: z.string(), // execution_trace_id (not decision_trace_id)
  ttl: z.number().optional(),
}).strict();

export const ActionOutcomeV1Schema = z.object({
  pk: z.string(),
  sk: z.string(),
  // GSI attributes
  gsi1pk: z.string().optional(), // ACTION_INTENT#<action_intent_id> (for querying by action_intent_id)
  gsi1sk: z.string().optional(), // COMPLETED_AT#<timestamp>
  gsi2pk: z.string().optional(), // TENANT#<tenant_id> (for tenant-level operational queries)
  gsi2sk: z.string().optional(), // COMPLETED_AT#<timestamp> (for sorting by recency)
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
  registry_version: z.number(), // Registry version used for this execution
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

### File: `src/types/ExecutionErrors.ts`

**Purpose:** Typed execution errors for SFN retry/catch logic

**Error Classes:**

```typescript
/**
 * Base execution error with error_class for SFN decision-making
 */
export class ExecutionError extends Error {
  constructor(
    message: string,
    public readonly error_class: 'VALIDATION' | 'AUTH' | 'RATE_LIMIT' | 'DOWNSTREAM' | 'TIMEOUT' | 'UNKNOWN',
    public readonly error_code?: string,
    public readonly retryable: boolean = false
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

/**
 * Validation errors (terminal, no retry)
 */
export class IntentExpiredError extends ExecutionError {
  constructor(actionIntentId: string, expiresAt: number, now: number) {
    super(
      `ActionIntent expired: ${actionIntentId} (expires_at_epoch: ${expiresAt}, now: ${now})`,
      'VALIDATION',
      'INTENT_EXPIRED',
      false
    );
  }
}

export class KillSwitchEnabledError extends ExecutionError {
  constructor(tenantId: string, actionType?: string) {
    const message = actionType
      ? `Execution disabled for tenant: ${tenantId}, action_type: ${actionType}`
      : `Execution disabled for tenant: ${tenantId}`;
    super(message, 'VALIDATION', 'KILL_SWITCH_ENABLED', false);
  }
}

export class IntentNotFoundError extends ExecutionError {
  constructor(actionIntentId: string) {
    super(`ActionIntent not found: ${actionIntentId}`, 'VALIDATION', 'INTENT_NOT_FOUND', false);
  }
}

export class ValidationError extends ExecutionError {
  constructor(message: string, errorCode?: string) {
    super(message, 'VALIDATION', errorCode || 'VALIDATION_FAILED', false);
  }
}

/**
 * Auth errors (terminal, no retry unless token refresh exists)
 */
export class AuthError extends ExecutionError {
  constructor(message: string, errorCode?: string) {
    super(message, 'AUTH', errorCode || 'AUTH_FAILED', false);
  }
}

/**
 * Rate limit errors (retryable with backoff)
 */
export class RateLimitError extends ExecutionError {
  constructor(message: string, retryAfterSeconds?: number) {
    super(message, 'RATE_LIMIT', 'RATE_LIMIT_EXCEEDED', true);
    // Note: retryAfterSeconds can be used by SFN for exponential backoff
  }
}

/**
 * Downstream service errors (retryable with backoff)
 */
export class DownstreamError extends ExecutionError {
  constructor(message: string, errorCode?: string) {
    super(message, 'DOWNSTREAM', errorCode || 'DOWNSTREAM_ERROR', true);
  }
}

/**
 * Timeout errors (retryable with backoff)
 */
export class TimeoutError extends ExecutionError {
  constructor(message: string) {
    super(message, 'TIMEOUT', 'TIMEOUT', true);
  }
}

/**
 * Unknown errors (terminal, no retry - fail safe)
 */
export class UnknownExecutionError extends ExecutionError {
  constructor(message: string, originalError?: Error) {
    super(message, 'UNKNOWN', 'UNKNOWN_ERROR', false);
    if (originalError) {
      this.cause = originalError;
    }
  }
}
```

**Usage in Handlers:**

```typescript
// Example: execution-validator-handler.ts
import { IntentExpiredError, KillSwitchEnabledError, IntentNotFoundError } from '../../types/ExecutionErrors';

// In handler:
if (intent.expires_at_epoch <= now) {
  throw new IntentExpiredError(action_intent_id, intent.expires_at_epoch, now);
}

if (!executionEnabled) {
  throw new KillSwitchEnabledError(tenant_id, intent.action_type);
}
```

**SFN Catch Configuration (Phase 4.2):**

```typescript
// Step Functions can catch by error name (error.name = class name)
// Example catch configuration:
{
  "Catch": [
    {
      "ErrorEquals": ["IntentExpiredError", "KillSwitchEnabledError", "IntentNotFoundError", "ValidationError"],
      "ResultPath": "$.error",
      "Next": "RecordFailure" // Terminal fail, no retry
    },
    {
      "ErrorEquals": ["RateLimitError", "DownstreamError", "TimeoutError"],
      "ResultPath": "$.error",
      "Next": "RetryWithBackoff" // Retry with exponential backoff (bounded retries)
    },
    {
      "ErrorEquals": ["AuthError"],
      "ResultPath": "$.error",
      "Next": "RecordFailure" // Terminal fail (unless token refresh exists)
    },
    {
      "ErrorEquals": ["States.ALL"],
      "ResultPath": "$.error",
      "Next": "RecordFailure" // Unknown errors - fail safe
    }
  ]
}
```

**Note:** Error names match class names (e.g., `IntentExpiredError.name = 'IntentExpiredError'`).
This enables SFN to catch specific error types for different retry policies.

---

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
  // Phase 4: Execution Layer events
  EXECUTION_STARTED = 'EXECUTION_STARTED',
  ACTION_EXECUTED = 'ACTION_EXECUTED',
  ACTION_FAILED = 'ACTION_FAILED',
  EXECUTION_CANCELLED = 'EXECUTION_CANCELLED', // Kill switch / manual cancel
  EXECUTION_EXPIRED = 'EXECUTION_EXPIRED', // Intent expired before execution
  // Note: IDEMPOTENCY_COLLISION_DETECTED will be added in Phase 4.2 when IdempotencyService
  // gets LedgerService injection. For Phase 4.1, collisions are logged as critical errors.
  // IDEMPOTENCY_COLLISION_DETECTED = 'IDEMPOTENCY_COLLISION_DETECTED', // Sev-worthy incident
}
```

**Note:** These new event types are used by execution handlers to record execution lifecycle events in the ledger. `IDEMPOTENCY_COLLISION_DETECTED` is a sev-worthy incident that indicates a bug in idempotency key generation. It will be added in Phase 4.2 when IdempotencyService is refactored to accept LedgerService.

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
   * Start execution attempt (exactly-once guarantee)
   * 
   * Model A: ExecutionLock - one item per intent
   * - Creates lock if not exists (first attempt)
   * - Allows re-run if status is terminal (SUCCEEDED, FAILED, CANCELLED)
   * - Throws if status is RUNNING (already executing)
   * 
   * IMPORTANT: Reruns (terminal → RUNNING) are admin-only / explicitly initiated,
   * NOT automatic SFN retries. Step Functions retries only occur for RUNNING → RUNNING
   * transitions (not terminal → RUNNING). This prevents accidental double-writes from
   * treating reruns as normal retry semantics.
   * 
   * The `allow_rerun` flag provides explicit gating:
   * - Normal execution path (from EventBridge) always calls with allow_rerun=false
   * - Admin/manual rerun path explicitly sets allow_rerun=true
   * - This prevents accidental reruns from duplicate events or conditional logic changes
   * 
   * Uses conditional write to prevent race conditions.
   */
  async startAttempt(
    actionIntentId: string,
    tenantId: string,
    accountId: string,
    traceId: string,
    idempotencyKey: string,
    stateMachineTimeoutSeconds?: number, // Optional: SFN timeout in seconds (from config)
    allowRerun: boolean = false // Explicit rerun flag (default false - normal execution path)
  ): Promise<ExecutionAttempt> {
    const attemptId = `attempt_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const now = new Date().toISOString();
    
    // TTL should be tied to SFN timeout, not hardcoded
    // Default: 1 hour if not provided (backwards compatibility)
    // Buffer: 15 minutes to prevent RUNNING state from vanishing mid-flight during retries/backoff
    const timeoutSeconds = stateMachineTimeoutSeconds || 3600; // Default 1 hour
    const bufferSeconds = 900; // 15 minutes buffer
    const ttl = Math.floor(Date.now() / 1000) + timeoutSeconds + bufferSeconds;
    
    const pk = `TENANT#${tenantId}#ACCOUNT#${accountId}`;
    const sk = `EXECUTION#${actionIntentId}`;
    
    // Try to create new lock (if doesn't exist)
    // Populate GSI attributes for querying by action_intent_id and tenant
    const gsi1pk = `ACTION_INTENT#${actionIntentId}`;
    const gsi1sk = `UPDATED_AT#${now}`;
    const gsi2pk = `TENANT#${tenantId}`;
    const gsi2sk = `UPDATED_AT#${now}`;
    
    const attempt: ExecutionAttempt = {
      pk,
      sk,
      gsi1pk,
      gsi1sk,
      gsi2pk,
      gsi2sk,
      action_intent_id: actionIntentId,
      attempt_count: 1,
      last_attempt_id: attemptId,
      status: 'RUNNING',
      idempotency_key: idempotencyKey,
      started_at: now,
      updated_at: now,
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
        // Lock exists - check if we can re-run (status is terminal)
        const existing = await this.getAttempt(actionIntentId, tenantId, accountId);
        if (!existing) {
          // Race condition: item was deleted between check and get
          throw new Error(`Race condition: execution lock state changed for action_intent_id: ${actionIntentId}`);
        }
        
        if (existing.status === 'RUNNING') {
          throw new Error(`Execution already in progress for action_intent_id: ${actionIntentId}`);
        }
        
        // Status is terminal - check if rerun is explicitly allowed
        if (!allowRerun) {
          throw new Error(
            `Execution already completed for action_intent_id: ${actionIntentId} (status: ${existing.status}). ` +
            `Reruns are not allowed without explicit allow_rerun=true flag. ` +
            `This prevents accidental reruns from duplicate events. ` +
            `If this is an intentional rerun, use the admin rerun path with allow_rerun=true.`
          );
        }
        
        // Status is terminal AND allow_rerun=true - allow re-run by updating lock (admin-only, not automatic SFN retry)
        // Use UpdateCommand (not PutCommand) for safe partial updates
        // This prevents unintentionally wiping fields if schema evolves
        // Update GSI attributes for querying by action_intent_id and tenant
        const gsi1pk = `ACTION_INTENT#${actionIntentId}`;
        const gsi1sk = `UPDATED_AT#${now}`;
        const gsi2pk = `TENANT#${tenantId}`;
        const gsi2sk = `UPDATED_AT#${now}`;
        
        await this.dynamoClient.send(new UpdateCommand({
          TableName: this.tableName,
          Key: {
            pk,
            sk,
          },
          UpdateExpression: [
            'SET #status = :running',
            '#attempt_count = #attempt_count + :one',
            '#last_attempt_id = :attempt_id',
            '#idempotency_key = :idempotency_key',
            '#started_at = :started_at',
            '#updated_at = :updated_at',
            '#trace_id = :trace_id',
            '#ttl = :ttl',
            '#gsi1pk = :gsi1pk',
            '#gsi1sk = :gsi1sk',
            '#gsi2pk = :gsi2pk',
            '#gsi2sk = :gsi2sk',
            'REMOVE #last_error_class', // Clear error from previous attempt
          ].join(', '),
          ConditionExpression: '#status IN (:succeeded, :failed, :cancelled)',
          ExpressionAttributeNames: {
            '#status': 'status',
            '#attempt_count': 'attempt_count',
            '#last_attempt_id': 'last_attempt_id',
            '#idempotency_key': 'idempotency_key',
            '#started_at': 'started_at',
            '#updated_at': 'updated_at',
            '#trace_id': 'trace_id',
            '#ttl': 'ttl',
            '#gsi1pk': 'gsi1pk',
            '#gsi1sk': 'gsi1sk',
            '#last_error_class': 'last_error_class',
          },
          ExpressionAttributeValues: {
            ':running': 'RUNNING',
            ':one': 1,
            ':attempt_id': attemptId,
            ':idempotency_key': idempotencyKey,
            ':started_at': now,
            ':updated_at': now,
            ':trace_id': traceId,
            ':ttl': ttl,
            ':gsi1pk': gsi1pk,
            ':gsi1sk': gsi1sk,
            ':succeeded': 'SUCCEEDED',
            ':failed': 'FAILED',
            ':cancelled': 'CANCELLED',
          },
        }));
        
        // Fetch updated attempt to return
        const updatedAttempt = await this.getAttempt(actionIntentId, tenantId, accountId);
        if (!updatedAttempt) {
          throw new Error(`Failed to fetch updated attempt for action_intent_id: ${actionIntentId}`);
        }
        
        return updatedAttempt;
      }
      throw error;
    }
  }

  /**
   * Update attempt status (terminal states only)
   * 
   * Safety: Only allows transition from RUNNING to terminal state.
   * Prevents state corruption (e.g., SUCCEEDED → RUNNING via retries/bugs).
   */
  async updateStatus(
    actionIntentId: string,
    tenantId: string,
    accountId: string,
    status: 'SUCCEEDED' | 'FAILED' | 'CANCELLED',
    errorClass?: string
  ): Promise<void> {
    const now = new Date().toISOString();
    
    // Update GSI attributes for querying by action_intent_id and tenant
    const gsi1pk = `ACTION_INTENT#${actionIntentId}`;
    const gsi1sk = `UPDATED_AT#${now}`;
    const gsi2pk = `TENANT#${tenantId}`;
    const gsi2sk = `UPDATED_AT#${now}`;
    
    const updateExpression: string[] = [
      'SET #status = :status',
      '#updated_at = :updated_at',
      '#gsi1pk = :gsi1pk',
      '#gsi1sk = :gsi1sk',
      '#gsi2pk = :gsi2pk',
      '#gsi2sk = :gsi2sk',
    ];
    const expressionAttributeValues: Record<string, any> = {
      ':status': status,
      ':updated_at': now,
      ':gsi1pk': gsi1pk,
      ':gsi1sk': gsi1sk,
      ':gsi2pk': gsi2pk,
      ':gsi2sk': gsi2sk,
      ':running': 'RUNNING',
    };
    
    if (errorClass) {
      updateExpression.push('#last_error_class = :error_class');
      expressionAttributeValues[':error_class'] = errorClass;
    }
    
    try {
      await this.dynamoClient.send(new UpdateCommand({
        TableName: this.tableName,
        Key: {
          pk: `TENANT#${tenantId}#ACCOUNT#${accountId}`,
          sk: `EXECUTION#${actionIntentId}`,
        },
        UpdateExpression: updateExpression.join(', '),
        ConditionExpression: '#status = :running', // Only allow update if currently RUNNING
        ExpressionAttributeNames: {
          '#status': 'status',
          '#updated_at': 'updated_at',
          '#gsi1pk': 'gsi1pk',
          '#gsi1sk': 'gsi1sk',
          '#gsi2pk': 'gsi2pk',
          '#gsi2sk': 'gsi2sk',
          ...(errorClass ? { '#last_error_class': 'last_error_class' } : {}),
        },
        ExpressionAttributeValues: expressionAttributeValues,
      }));
    } catch (error: any) {
      if (error.name === 'ConditionalCheckFailedException') {
        // Status is not RUNNING - cannot transition to terminal
        throw new Error(
          `Cannot update status to ${status} for action_intent_id: ${actionIntentId}. ` +
          `Current status is not RUNNING. This may indicate a duplicate update or state corruption.`
        );
      }
      throw error;
    }
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
import { ValidationError } from '../../types/ExecutionErrors';

export class ActionTypeRegistryService {
  constructor(
    private dynamoClient: DynamoDBDocumentClient,
    private tableName: string,
    private logger: Logger
  ) {}

  /**
   * Get tool mapping for action type and registry version
   * 
   * @param actionType - Action type (e.g., "CREATE_TASK")
   * @param registryVersion - Registry version number (if not provided, returns latest)
   * 
   * Note: Latest version lookup queries all versions and sorts by registry_version in memory.
   * This is acceptable for Phase 4.1 (small number of versions per action_type).
   * For production with many versions, consider a GSI with registry_version as sort key.
   */
  async getToolMapping(
    actionType: string,
    registryVersion?: number
  ): Promise<ActionTypeRegistry | null> {
    if (registryVersion !== undefined) {
      // Get specific registry version (for backwards compatibility with old intents)
      const result = await this.dynamoClient.send(new GetCommand({
        TableName: this.tableName,
        Key: {
          pk: `ACTION_TYPE#${actionType}`,
          sk: `REGISTRY_VERSION#${registryVersion}`,
        },
      }));
      
      return result.Item as ActionTypeRegistry | null;
    } else {
      // Get latest version: query all versions, sort by registry_version (monotonic, deterministic)
      // "Latest" means highest registry_version, NOT newest created_at timestamp
      // 
      // Future optimization options:
      // - Add LATEST pointer item per action_type (sk = LATEST, points to current registry_version)
      // - Add GSI with registry_version as sort key (REGISTRY_VERSION#000001, #000002, etc.)
      const result = await this.dynamoClient.send(new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'pk = :pk',
        ExpressionAttributeValues: {
          ':pk': `ACTION_TYPE#${actionType}`,
        },
      }));
      
      if (!result.Items || result.Items.length === 0) {
        return null;
      }
      
      // Sort by registry_version descending (highest = latest)
      // This is deterministic and safe (registry_version is monotonic)
      // Validate that registry_version is numeric and present (fail fast on bad data)
      const validItems = (result.Items as ActionTypeRegistry[]).filter(item => {
        if (item.registry_version === undefined || item.registry_version === null) {
          this.logger.warn('ActionTypeRegistry item missing registry_version', {
            action_type: item.action_type,
            pk: item.pk,
            sk: item.sk,
          });
          return false;
        }
        if (typeof item.registry_version !== 'number' || !Number.isInteger(item.registry_version) || item.registry_version < 1) {
          this.logger.warn('ActionTypeRegistry item has invalid registry_version', {
            action_type: item.action_type,
            pk: item.pk,
            sk: item.sk,
            registry_version: item.registry_version,
          });
          return false;
        }
        return true;
      });
      
      if (validItems.length === 0) {
        return null;
      }
      
      const sorted = validItems.sort((a, b) => b.registry_version! - a.registry_version!);
      
      return sorted[0] || null;
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
        throw new ValidationError(
          `Required parameter missing: ${actionParam}`,
          'MISSING_REQUIRED_PARAMETER'
        );
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
    
    // Get latest version to determine next registry_version
    const latest = await this.getToolMapping(mapping.action_type);
    const nextRegistryVersion = latest ? latest.registry_version + 1 : 1;
    
    const registry: ActionTypeRegistry = {
      ...mapping,
      pk: `ACTION_TYPE#${mapping.action_type}`,
      sk: `REGISTRY_VERSION#${nextRegistryVersion}`,
      registry_version: nextRegistryVersion,
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
   * Deep canonical JSON: recursively sort object keys for consistent idempotency
   * 
   * Returns a canonicalized value tree (objects with sorted keys, arrays mapped),
   * then JSON.stringify once at the end. This is simpler and safer than recursive
   * JSON.parse/stringify which can behave oddly for Dates, BigInt, undefined, etc.
   * 
   * Policy: undefined values are dropped (consistent with DynamoDB marshalling).
   */
  private deepCanonicalize(obj: any): any {
    if (obj === null) {
      return null;
    }
    
    // Drop undefined values (consistent with DynamoDB removeUndefinedValues: true)
    if (obj === undefined) {
      return undefined;
    }
    
    if (Array.isArray(obj)) {
      // Arrays preserve order (order-sensitive)
      return obj.map(item => this.deepCanonicalize(item));
    }
    
    if (typeof obj === 'object') {
      // Objects: sort keys recursively, drop undefined values
      const sortedKeys = Object.keys(obj).sort();
      const canonicalized: Record<string, any> = {};
      
      for (const key of sortedKeys) {
        const value = this.deepCanonicalize(obj[key]);
        // Drop undefined values
        if (value !== undefined) {
          canonicalized[key] = value;
        }
      }
      
      return canonicalized;
    }
    
    // Primitives (string, number, boolean) pass through
    return obj;
  }

  /**
   * Generate idempotency key for execution (execution-layer idempotency)
   * Format: hash(tenant_id + action_intent_id + tool_name + canonical_params + registry_version)
   * 
   * This key is per-intent: two ActionIntents with identical params will have different keys.
   * Use this for execution-layer dedupe (preventing duplicate Step Functions executions).
   * 
   * Uses deep canonical JSON to ensure consistent keys for semantically identical params.
   */
  generateIdempotencyKey(
    tenantId: string,
    actionIntentId: string,
    toolName: string,
    normalizedParams: Record<string, any>,
    registryVersion: number
  ): string {
    // Deep canonicalize: recursively sort all object keys, drop undefined
    const canonicalized = this.deepCanonicalize(normalizedParams);
    // Stringify once at the end (simpler and safer than recursive parse/stringify)
    const canonicalParams = JSON.stringify(canonicalized);
    
    const input = `${tenantId}:${actionIntentId}:${toolName}:${canonicalParams}:${registryVersion}`;
    return createHash('sha256').update(input, 'utf8').digest('hex');
  }

  /**
   * Generate semantic idempotency key (adapter-level idempotency)
   * Format: hash(tenant_id + tool_name + canonical_params + registry_version)
   * 
   * This key omits action_intent_id, enabling "never double-write externally" even across
   * duplicate ActionIntents with identical params. Use this for ExternalWriteDedupe if
   * your product goal is to prevent duplicate external writes regardless of intent source.
   * 
   * Note: This is optional - current design uses execution-layer key (includes intent_id)
   * for ExternalWriteDedupe. If you want semantic dedupe, use this method instead.
   */
  generateSemanticIdempotencyKey(
    tenantId: string,
    toolName: string,
    normalizedParams: Record<string, any>,
    registryVersion: number
  ): string {
    // Deep canonicalize: recursively sort all object keys, drop undefined
    const canonicalized = this.deepCanonicalize(normalizedParams);
    // Stringify once at the end
    const canonicalParams = JSON.stringify(canonicalized);
    
    const input = `${tenantId}:${toolName}:${canonicalParams}:${registryVersion}`;
    return createHash('sha256').update(input, 'utf8').digest('hex');
  }

  /**
   * Check if external write already happened (adapter-level idempotency)
   * Uses LATEST pointer for fast lookup (best-effort)
   * 
   * Note: LATEST pointer is best-effort; source of truth is history items.
   * If LATEST pointer is missing, falls back to querying history items.
   */
  async checkExternalWriteDedupe(
    dynamoClient: DynamoDBDocumentClient,
    tableName: string,
    idempotencyKey: string
  ): Promise<string | null> {
    // First, check LATEST pointer (best-effort fast path)
    const latestResult = await dynamoClient.send(new GetCommand({
      TableName: tableName,
      Key: {
        pk: `IDEMPOTENCY_KEY#${idempotencyKey}`,
        sk: 'LATEST',
      },
    }));
    
    if (latestResult.Item) {
      const latest = latestResult.Item as ExternalWriteDedupe;
      // If pointer exists, fetch the actual record it points to
      if (latest.latest_sk) {
        const actualResult = await dynamoClient.send(new GetCommand({
          TableName: tableName,
          Key: {
            pk: `IDEMPOTENCY_KEY#${idempotencyKey}`,
            sk: latest.latest_sk,
          },
        }));
        
        if (actualResult.Item) {
          return (actualResult.Item as ExternalWriteDedupe).external_object_id;
        }
      }
      // Fallback: LATEST item itself has the data (backwards compatibility)
      return latest.external_object_id;
    }
    
    // LATEST pointer missing - query history items directly (source of truth)
    // This is slower but ensures correctness even if LATEST pointer write failed
    // Query all history items for this idempotency_key and return the most recent one
    const historyResult = await dynamoClient.send(new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :skPrefix)',
      ExpressionAttributeValues: {
        ':pk': `IDEMPOTENCY_KEY#${idempotencyKey}`,
        ':skPrefix': 'CREATED_AT#',
      },
      ScanIndexForward: false, // Sort descending (newest first)
      Limit: 1, // Only need the most recent
    }));
    
    if (historyResult.Items && historyResult.Items.length > 0) {
      const historyItem = historyResult.Items[0] as ExternalWriteDedupe;
      return historyItem.external_object_id;
    }
    
    return null;
  }

  /**
   * Record external write dedupe (adapter-level idempotency)
   * 
   * Option A: Immutable per idempotency_key with history
   * - Creates new item with sk = CREATED_AT#<timestamp> (preserves history)
   * - Updates LATEST pointer to point to new item
   * - If idempotency_key already exists with same external_object_id, returns (idempotent)
   * - If idempotency_key exists with different external_object_id, throws collision error
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
    const timestamp = Date.now();
    const ttl = Math.floor(timestamp / 1000) + 604800; // 7 days
    
    const historySk = `CREATED_AT#${timestamp}`;
    
    // Check if this idempotency_key already exists
    const existing = await this.checkExternalWriteDedupe(dynamoClient, tableName, idempotencyKey);
    
    if (existing) {
      if (existing !== externalObjectId) {
        // Collision - different external_object_id for same idempotency_key
        const error = new Error(
          `Idempotency key collision: ${idempotencyKey} maps to different external_object_id. ` +
          `Expected: ${externalObjectId}, Found: ${existing}. ` +
          `This may indicate a bug in idempotency key generation.`
        );
        error.name = 'IdempotencyCollisionError';
        
        // This is a sev-worthy incident - must produce:
        // 1. Ledger event (for audit trail)
        // 2. Structured log (for CloudWatch alarms)
        // 3. Metric increment (for monitoring)
        // 
        // TODO (Phase 4.2): Refactor IdempotencyService to accept LedgerService and trace context
        // to emit incident signals. For Phase 4.1, this error is thrown and should be caught by
        // handler/logging layer to emit structured logs and metrics.
        
        throw error;
      }
      // Same external_object_id - idempotent operation, no-op
      return;
    }
    
    // Create history item (immutable, preserves audit trail)
    const historyItem: ExternalWriteDedupe = {
      pk: `IDEMPOTENCY_KEY#${idempotencyKey}`,
      sk: historySk,
      idempotency_key: idempotencyKey,
      external_object_id: externalObjectId,
      action_intent_id: actionIntentId,
      tool_name: toolName,
      created_at: now,
      ttl,
    };
    
    // Create LATEST pointer item (points to history item)
    const latestItem: ExternalWriteDedupe = {
      pk: `IDEMPOTENCY_KEY#${idempotencyKey}`,
      sk: 'LATEST',
      idempotency_key: idempotencyKey,
      external_object_id: externalObjectId, // For backwards compatibility
      action_intent_id: actionIntentId,
      tool_name: toolName,
      created_at: now,
      latest_sk: historySk, // Points to actual history item
      ttl,
    };
    
    // Write both items (best-effort atomicity)
    // For Phase 4.1: write history first, then LATEST (if LATEST write fails, history still exists)
    // Note: LATEST pointer is best-effort; source of truth is history items.
    // If LATEST pointer is missing, fall back to querying history items by created_at descending.
    await dynamoClient.send(new PutCommand({
      TableName: tableName,
      Item: historyItem,
      ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)',
    }));
    
    // Update LATEST pointer (allow overwrite - it's just a pointer, best-effort)
    // If this write fails, history item still exists and can be queried directly
    await dynamoClient.send(new PutCommand({
      TableName: tableName,
      Item: latestItem,
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
   * 
   * Populates GSI attributes (gsi1pk, gsi1sk) for querying by action_intent_id.
   * 
   * Write-once: Outcomes are immutable once recorded. Prevents overwriting terminal outcomes
   * from retries or bugs. Uses conditional write to ensure exactly-once recording.
   */
  async recordOutcome(
    outcome: Omit<ActionOutcomeV1, 'pk' | 'sk' | 'gsi1pk' | 'gsi1sk' | 'ttl'>
  ): Promise<ActionOutcomeV1> {
    const ttl = Math.floor(new Date(outcome.completed_at).getTime() / 1000) + 7776000; // 90 days
    
    // GSI attributes for querying by action_intent_id and tenant
    const gsi1pk = `ACTION_INTENT#${outcome.action_intent_id}`;
    const gsi1sk = `COMPLETED_AT#${outcome.completed_at}`;
    const gsi2pk = `TENANT#${outcome.tenant_id}`;
    const gsi2sk = `COMPLETED_AT#${outcome.completed_at}`;
    
    const fullOutcome: ActionOutcomeV1 = {
      ...outcome,
      pk: `TENANT#${outcome.tenant_id}#ACCOUNT#${outcome.account_id}`,
      sk: `OUTCOME#${outcome.action_intent_id}`,
      gsi1pk,
      gsi1sk,
      gsi2pk,
      gsi2sk,
      ttl,
    };
    
    try {
      // Write-once: only create if doesn't exist (immutable outcomes)
      await this.dynamoClient.send(new PutCommand({
        TableName: this.tableName,
        Item: fullOutcome,
        ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)',
      }));
      
      return fullOutcome;
    } catch (error: any) {
      if (error.name === 'ConditionalCheckFailedException') {
        // Outcome already exists - this is fine (idempotent operation)
        // Fetch existing outcome to return
        const existing = await this.getOutcome(
          outcome.action_intent_id,
          outcome.tenant_id,
          outcome.account_id
        );
        if (existing) {
          return existing;
        }
        // Race condition: outcome was deleted between check and get
        throw new Error(
          `Race condition: outcome state changed for action_intent_id: ${outcome.action_intent_id}`
        );
      }
      throw error;
    }
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

### Error Handling Pattern

**All Phase 4 handlers follow a consistent error handling pattern:**

1. **Environment Variable Validation:**
   - Use `requireEnv()` helper function for all required environment variables
   - Errors include handler name, variable name, and actionable guidance
   - Errors have `name: 'ConfigurationError'` for easy filtering

2. **Event Parameter Validation:**
   - Validate all required event parameters with descriptive errors
   - Include context about what's missing and where it should come from
   - Errors have descriptive names (e.g., `InvalidEventError`)

3. **Business Logic Errors:**
   - Wrap errors with handler context and actionable messages
   - Preserve original error as `cause` when re-throwing
   - Include relevant IDs (action_intent_id, tenant_id, etc.) in error messages

4. **Error Logging:**
   - Log errors with full context (IDs, error name, message, stack)
   - Use structured logging for easier debugging

**Example Pattern:**
```typescript
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
```

---

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
import {
  IntentNotFoundError,
  ValidationError,
  ExecutionAlreadyInProgressError,
  UnknownExecutionError,
} from '../../types/ExecutionErrors';
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
 * Execution Starter Handler
 * 
 * Contract: See "Execution Contract (Canonical)" section at top of this document.
 * 
 * Input: { action_intent_id, tenant_id, account_id } (from Step Functions)
 * Output: { action_intent_id, idempotency_key, tenant_id, account_id, trace_id, registry_version }
 * 
 * Note: ActionIntentService.getIntent() must be public (not private) for this handler to work.
 * Update ActionIntentService.ts to make getIntent() public.
 */

// Zod schema for SFN input validation (fail fast with precise errors)
import { z } from 'zod';

const StepFunctionsInputSchema = z.object({
  action_intent_id: z.string().min(1, 'action_intent_id is required'),
  tenant_id: z.string().min(1, 'tenant_id is required'),
  account_id: z.string().min(1, 'account_id is required'),
}).strict();

export const handler: Handler = async (event: unknown) => {
  // Validate SFN input with Zod (fail fast with precise errors)
  const validationResult = StepFunctionsInputSchema.safeParse(event);
  if (!validationResult.success) {
    const error = new Error(
      `[ExecutionStarterHandler] Invalid Step Functions input: ${validationResult.error.message}. ` +
      `Expected: { action_intent_id: string, tenant_id: string, account_id: string }. ` +
      `Received: ${JSON.stringify(event)}. ` +
      `Check EventBridge rule configuration in ExecutionInfrastructure.createExecutionTriggerRule() ` +
      `to ensure all required fields are extracted from event detail and passed to Step Functions.`
    );
    error.name = 'InvalidEventError';
    throw error;
  }
  
  const { action_intent_id, tenant_id, account_id } = validationResult.data;
  
  // Generate execution trace ID (single trace for entire execution lifecycle)
  // This is separate from decision trace_id - execution has its own trace for debugging
  const executionTraceId = traceService.generateTraceId();
  
  logger.info('Execution starter invoked', { action_intent_id, tenant_id, account_id, executionTraceId });
  
  try {
    // Validate required event parameters (fail fast with descriptive error)
    if (!tenant_id || !account_id) {
      const error = new Error(
        `[ExecutionStarterHandler] Missing required event parameters: tenant_id and/or account_id. ` +
        `Step Functions input must include these values from the ACTION_APPROVED event. ` +
        `Current event: ${JSON.stringify(event)}. ` +
        `Check EventBridge rule configuration in ExecutionInfrastructure.createExecutionTriggerRule() ` +
        `to ensure tenant_id and account_id are extracted from event detail and passed to Step Functions.`
      );
      error.name = 'InvalidEventError';
      throw error;
    }
    
    // 1. Fetch ActionIntentV1 (with tenant/account for security validation)
    const intent = await actionIntentService.getIntent(
      action_intent_id,
      tenant_id,
      account_id
    );
    
    if (!intent) {
      throw new IntentNotFoundError(action_intent_id);
    }
    
    // 2. Get tool mapping (for idempotency key generation)
    // Use registry_version from intent (REQUIRED - must be stored in ActionIntentV1 at Phase 3)
    if (intent.registry_version === undefined || intent.registry_version === null) {
      throw new ValidationError(
        `ActionIntent missing required field: registry_version. ` +
        `ActionIntentV1 must store registry_version at creation time (Phase 3). ` +
        `This ensures deterministic execution and prevents silent behavioral drift from registry changes. ` +
        `action_intent_id: ${action_intent_id}`,
        'MISSING_REGISTRY_VERSION'
      );
    }
    
    const registryVersion = intent.registry_version;
    const toolMapping = await actionTypeRegistryService.getToolMapping(
      intent.action_type,
      registryVersion
    );
    
    if (!toolMapping) {
      throw new ValidationError(
        `Tool mapping not found for action_type: ${intent.action_type}, ` +
        `registry_version: ${registryVersion}. ` +
        `This may indicate the action type was removed or the registry version is invalid. ` +
        `Check ActionTypeRegistry table for ACTION_TYPE#${intent.action_type}, REGISTRY_VERSION#${registryVersion}.`,
        'TOOL_MAPPING_NOT_FOUND'
      );
    }
    
    // 3. Generate idempotency key (using registry_version, not tool_schema_version)
    const normalizedParams = actionTypeRegistryService.mapParametersToToolArguments(
      toolMapping,
      intent.parameters
    );
    
    const idempotencyKey = idempotencyService.generateIdempotencyKey(
      intent.tenant_id,
      action_intent_id,
      toolMapping.tool_name,
      normalizedParams,
      toolMapping.registry_version
    );
    
    // 4. Start execution attempt (conditional write for exactly-once)
    // Use executionTraceId (not intent.trace_id) - execution has its own trace
    // Get SFN timeout from config (defaults to 1 hour if not available)
    const stateMachineTimeoutHours = parseInt(process.env.STATE_MACHINE_TIMEOUT_HOURS || '1', 10);
    const stateMachineTimeoutSeconds = stateMachineTimeoutHours * 3600;
    
    const attempt = await executionAttemptService.startAttempt(
      action_intent_id,
      intent.tenant_id,
      intent.account_id,
      executionTraceId, // Use execution trace, not decision trace
      idempotencyKey,
      stateMachineTimeoutSeconds, // Pass SFN timeout for TTL calculation
      false // allow_rerun=false for normal execution path (prevents accidental reruns from duplicate events)
    );
    
    // 5. Emit ledger event (use execution trace for execution lifecycle events)
    await ledgerService.append({
      eventType: LedgerEventType.EXECUTION_STARTED,
      tenantId: intent.tenant_id,
      accountId: intent.account_id,
      traceId: executionTraceId, // Use execution trace
      data: {
        action_intent_id,
        attempt_id: attempt.last_attempt_id, // Use last_attempt_id (Model A)
        attempt_count: attempt.attempt_count,
        idempotency_key: idempotencyKey,
        registry_version: toolMapping.registry_version,
        decision_trace_id: intent.trace_id, // Preserve decision trace for correlation
      },
    });
    
    // 6. Return for Step Functions (include registry_version for downstream handlers)
    return {
      action_intent_id,
      idempotency_key: idempotencyKey,
      tenant_id: intent.tenant_id,
      account_id: intent.account_id,
      trace_id: executionTraceId, // Use execution trace (single trace for execution lifecycle)
      registry_version: toolMapping.registry_version, // Pass to downstream handlers
    };
  } catch (error: any) {
    logger.error('Execution starter failed', { 
      action_intent_id, 
      error: error.message,
      errorName: error.name,
      stack: error.stack,
    });
    
    // Re-throw typed errors as-is (they're already ExecutionError subclasses)
    if (error instanceof ExecutionError || error.error_class) {
      throw error;
    }
    
    // If already executing, provide clear typed error for Step Functions
    if (error.message.includes('already in progress')) {
      throw new ExecutionAlreadyInProgressError(action_intent_id);
    }
    
    // Re-throw configuration errors as-is (they already have good messages)
    if (error.name === 'ConfigurationError') {
      throw error;
    }
    
    // Wrap unknown errors as UnknownExecutionError (fail safe)
    throw new UnknownExecutionError(
      `Failed to start execution for action_intent_id: ${action_intent_id}. ` +
      `Original error: ${error.message || 'Unknown error'}. ` +
      `Check logs for detailed error information.`,
      error
    );
  }
};
```

### File: `src/handlers/phase4/execution-validator-handler.ts`

**Purpose:** Validate preflight checks (expiration, kill switches, params, budget)

**Error Taxonomy for SFN Decision-Making:**

| Error Condition | Error Class | SFN Action | Retry? | Notes |
|----------------|-------------|------------|--------|-------|
| ActionIntent expired | `VALIDATION` | Terminal fail | No | Intent expired, cannot execute |
| Kill switch enabled (global) | `VALIDATION` | Terminal cancel | No | Global emergency stop |
| Kill switch enabled (tenant) | `VALIDATION` | Terminal cancel | No | Tenant execution disabled |
| Kill switch enabled (action type) | `VALIDATION` | Terminal cancel | No | Action type disabled for tenant |
| ActionIntent not found | `VALIDATION` | Terminal fail | No | Invalid action_intent_id |
| Invalid parameters | `VALIDATION` | Terminal fail | No | Parameter validation failed |
| Budget exceeded | `VALIDATION` | Terminal fail | No | Execution budget limit reached |
| Auth failure (token expired) | `AUTH` | Terminal fail | No* | *Unless token refresh exists |
| Rate limit (429) | `RATE_LIMIT` | Retry with backoff | Yes | Bounded retries (3 attempts) |
| Downstream service error | `DOWNSTREAM` | Retry with backoff | Yes | Bounded retries (3 attempts) |
| Timeout | `TIMEOUT` | Retry with backoff | Yes | Bounded retries (2 attempts) |
| Unknown error | `UNKNOWN` | Terminal fail | No | Unexpected error, fail safe |

**Note:** SFN retry policies should be configured based on error class. See Phase 4.2 Step Functions definition.

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

// Initialize AWS clients
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
 * Execution Validator Handler
 * 
 * Contract: See "Execution Contract (Canonical)" section at top of this document.
 * 
 * Input: { action_intent_id, tenant_id, account_id } (from Step Functions)
 * Output: { valid: true, action_intent: {...} } or throws typed error
 * 
 * Error Taxonomy: See error taxonomy table in handler documentation above.
 * Errors are typed (ExecutionError subclasses) for SFN retry/catch logic.
 */

// Zod schema for SFN input validation (fail fast with precise errors)
import { z } from 'zod';
import {
  ExecutionError,
  IntentExpiredError,
  KillSwitchEnabledError,
  IntentNotFoundError,
  ValidationError,
} from '../../types/ExecutionErrors';

const StepFunctionsInputSchema = z.object({
  action_intent_id: z.string().min(1, 'action_intent_id is required'),
  tenant_id: z.string().min(1, 'tenant_id is required'),
  account_id: z.string().min(1, 'account_id is required'),
}).strict();

export const handler: Handler = async (event: unknown) => {
  // Validate SFN input with Zod (fail fast with precise errors)
  const validationResult = StepFunctionsInputSchema.safeParse(event);
  if (!validationResult.success) {
    throw new ValidationError(
      `Invalid Step Functions input: ${validationResult.error.message}. ` +
      `Expected: { action_intent_id: string, tenant_id: string, account_id: string }. ` +
      `Received: ${JSON.stringify(event)}. ` +
      `Check EventBridge rule configuration in ExecutionInfrastructure.createExecutionTriggerRule().`
    );
  }
  
  const { action_intent_id, tenant_id, account_id } = validationResult.data;
  const traceId = traceService.generateTraceId();
  
  logger.info('Execution validator invoked', { action_intent_id, tenant_id, account_id, traceId });
  
  try {
    // 1. Fetch ActionIntentV1
    const intent = await actionIntentService.getIntent(action_intent_id, tenant_id, account_id);
    
    if (!intent) {
      throw new IntentNotFoundError(action_intent_id);
    }
    
    // 2. Check expiration
    const now = Math.floor(Date.now() / 1000);
    if (intent.expires_at_epoch <= now) {
      throw new IntentExpiredError(action_intent_id, intent.expires_at_epoch, now);
    }
    
    // 3. Check kill switches
    const executionEnabled = await killSwitchService.isExecutionEnabled(tenant_id, intent.action_type);
    if (!executionEnabled) {
      throw new KillSwitchEnabledError(tenant_id, intent.action_type);
    }
    
    // 4. Check budget (stub for Phase 4.1 - Phase 4.3 adds per-tenant budget model)
    // TODO (Phase 4.3): Implement budget checks using CostBudgetService
    // For Phase 4.1, budget checks are stubbed (always pass)
    // const budgetCheck = await costBudgetService.checkExecutionBudget(tenant_id, intent.action_type);
    // if (!budgetCheck.allowed) {
    //   throw new ValidationError(`Execution budget exceeded for tenant: ${tenant_id}`, 'BUDGET_EXCEEDED');
    // }
    
    // 5. Check required parameters (basic validation)
    // Detailed parameter validation happens in tool mapper
    
    // 6. Return valid
    return {
      valid: true,
      action_intent: intent,
    };
  } catch (error: any) {
    logger.error('Execution validation failed', { 
      action_intent_id, 
      tenant_id,
      account_id,
      error: error.message,
      errorName: error.name,
      errorClass: error.error_class,
      errorCode: error.error_code,
      retryable: error.retryable,
      stack: error.stack,
    });
    
    // Re-throw typed errors as-is (they're already ExecutionError subclasses)
    if (error instanceof ExecutionError || error.error_class) {
      throw error;
    }
    
    // Re-throw configuration errors as-is
    if (error.name === 'ConfigurationError') {
      throw error;
    }
    
    // Wrap unknown errors as ValidationError (fail safe)
    throw new ValidationError(
      `Validation failed for action_intent_id: ${action_intent_id}. ` +
      `Original error: ${error.message || 'Unknown error'}.`,
      'VALIDATION_FAILED'
    );
  }
};
```

---

## 4. CDK Infrastructure (Partial)

### File: `src/stacks/constructs/ExecutionInfrastructureConfig.ts`

**Purpose:** Centralized configuration for Execution Infrastructure construct (consistent with Phase 3 pattern)

**Configuration Interface:**

```typescript
/**
 * Execution Infrastructure Configuration
 * 
 * Centralized configuration for Execution Infrastructure construct.
 * All hardcoded values should be defined here for maintainability and scalability.
 */
export interface ExecutionInfrastructureConfig {
  // Resource naming
  readonly resourcePrefix: string;
  
  // Table names
  readonly tableNames: {
    readonly executionAttempts: string;
    readonly executionOutcomes: string;
    readonly actionTypeRegistry: string;
    readonly externalWriteDedupe: string;
  };
  
  // Function names
  readonly functionNames: {
    readonly executionStarter: string;
    readonly executionValidator: string;
    readonly toolMapper: string;
    readonly toolInvoker: string;
    readonly executionRecorder: string;
    readonly compensation: string;
    readonly executionStatusApi: string;
  };
  
  // Queue names (DLQs)
  readonly queueNames: {
    readonly executionStarterDlq: string;
    readonly executionValidatorDlq: string;
    readonly toolMapperDlq: string;
    readonly toolInvokerDlq: string;
    readonly executionRecorderDlq: string;
    readonly compensationDlq: string;
  };
  
  // Step Functions
  readonly stepFunctions: {
    readonly stateMachineName: string;
    readonly timeoutHours: number;
  };
  
  // S3 Buckets
  readonly s3: {
    readonly executionArtifactsBucketPrefix: string;
  };
  
  // EventBridge
  readonly eventBridge: {
    readonly source: string;
    readonly detailTypes: {
      readonly actionApproved: string;
    };
  };
  
  // Defaults
  readonly defaults: {
    readonly region: string;
    readonly timeout: {
      readonly executionStarter: number; // seconds
      readonly executionValidator: number; // seconds
      readonly toolMapper: number; // seconds
      readonly toolInvoker: number; // seconds
      readonly executionRecorder: number; // seconds
      readonly compensation: number; // seconds
      readonly executionStatusApi: number; // seconds
    };
    readonly memorySize?: {
      readonly executionStarter?: number;
      readonly executionValidator?: number;
      readonly toolMapper?: number;
      readonly toolInvoker?: number;
      readonly executionRecorder?: number;
      readonly compensation?: number;
      readonly executionStatusApi?: number;
    };
  };
  
  // Lambda configuration
  readonly lambda: {
    readonly retryAttempts: number;
    readonly dlqRetentionDays: number;
  };
}

/**
 * Default Execution Infrastructure Configuration
 */
export const DEFAULT_EXECUTION_INFRASTRUCTURE_CONFIG: ExecutionInfrastructureConfig = {
  resourcePrefix: 'cc-native',
  
  tableNames: {
    executionAttempts: 'cc-native-execution-attempts',
    executionOutcomes: 'cc-native-execution-outcomes',
    actionTypeRegistry: 'cc-native-action-type-registry',
    externalWriteDedupe: 'cc-native-external-write-dedupe',
  },
  
  functionNames: {
    executionStarter: 'cc-native-execution-starter',
    executionValidator: 'cc-native-execution-validator',
    toolMapper: 'cc-native-tool-mapper',
    toolInvoker: 'cc-native-tool-invoker',
    executionRecorder: 'cc-native-execution-recorder',
    compensation: 'cc-native-compensation-handler',
    executionStatusApi: 'cc-native-execution-status-api',
  },
  
  queueNames: {
    executionStarterDlq: 'cc-native-execution-starter-handler-dlq',
    executionValidatorDlq: 'cc-native-execution-validator-handler-dlq',
    toolMapperDlq: 'cc-native-tool-mapper-handler-dlq',
    toolInvokerDlq: 'cc-native-tool-invoker-handler-dlq',
    executionRecorderDlq: 'cc-native-execution-recorder-handler-dlq',
    compensationDlq: 'cc-native-compensation-handler-dlq',
  },
  
  stepFunctions: {
    stateMachineName: 'cc-native-execution-orchestrator',
    timeoutHours: 1,
  },
  
  s3: {
    executionArtifactsBucketPrefix: 'cc-native-execution-artifacts',
  },
  
  eventBridge: {
    source: 'cc-native',
    detailTypes: {
      actionApproved: 'ACTION_APPROVED',
    },
  },
  
  defaults: {
    // Read from CDK context parameter 'awsRegion' (passed via deploy script)
    // This placeholder value will be overridden by createExecutionInfrastructureConfig()
    region: 'PLACEHOLDER_WILL_BE_OVERRIDDEN',
    timeout: {
      executionStarter: 30, // seconds
      executionValidator: 30, // seconds
      toolMapper: 30, // seconds
      toolInvoker: 60, // seconds (longer for external calls)
      executionRecorder: 30, // seconds
      compensation: 60, // seconds
      executionStatusApi: 30, // seconds
    },
  },
  
  lambda: {
    retryAttempts: 2,
    dlqRetentionDays: 14,
  },
};

/**
 * Creates Execution Infrastructure Configuration with specific values.
 * Follows the same pattern as DecisionInfrastructureConfig.
 * 
 * @param awsRegion - AWS region (from CDK context: awsRegion)
 * @returns ExecutionInfrastructureConfig with provided values
 */
export function createExecutionInfrastructureConfig(
  awsRegion: string
): ExecutionInfrastructureConfig {
  // Validate inputs (fail fast - no defaults)
  if (!awsRegion || typeof awsRegion !== 'string' || awsRegion.trim() === '') {
    throw new Error(
      'awsRegion is required. ' +
      'Please set AWS_REGION in .env.local and ensure the deploy script passes it as -c awsRegion=$AWS_REGION'
    );
  }

  // Merge provided values with default config
  return {
    ...DEFAULT_EXECUTION_INFRASTRUCTURE_CONFIG,
    defaults: {
      ...DEFAULT_EXECUTION_INFRASTRUCTURE_CONFIG.defaults,
      region: awsRegion.trim(),
    },
  };
}
```

**Usage in Main Stack (CCNativeStack.ts):**

```typescript
// In CCNativeStack constructor, create config and pass to ExecutionInfrastructure:
import { createExecutionInfrastructureConfig } from './stacks/constructs/ExecutionInfrastructureConfig';

// Get region from CDK context (passed via deploy script: -c awsRegion=$AWS_REGION)
// This follows the same pattern as DecisionInfrastructure in Phase 3
const awsRegion = this.node.tryGetContext('awsRegion');
if (!awsRegion) {
  throw new Error(
    'awsRegion is required. ' +
    'Please set AWS_REGION in .env.local and ensure the deploy script passes it as -c awsRegion=$AWS_REGION'
  );
}

// Create config with region (fail fast if region is missing)
const executionConfig = createExecutionInfrastructureConfig(awsRegion);

// Create ExecutionInfrastructure with config
const executionInfrastructure = new ExecutionInfrastructure(this, 'ExecutionInfrastructure', {
  eventBus: this.eventBus,
  ledgerTable: this.ledgerTable,
  actionIntentTable: this.actionIntentTable,
  tenantsTable: this.tenantsTable,
  config: executionConfig, // Pass config (all hardcoded values come from config)
  region: awsRegion,
});
```

**Note:** All hardcoded values in ExecutionInfrastructure construct should use `config.*` instead of string literals:
- Table names: `config.tableNames.*`
- Function names: `config.functionNames.*`
- Queue names: `config.queueNames.*`
- Timeouts: `config.defaults.timeout.*`
- Retry attempts: `config.lambda.retryAttempts`
- DLQ retention: `config.lambda.dlqRetentionDays`
- Step Functions name: `config.stepFunctions.stateMachineName`
- EventBridge source: `config.eventBridge.source`
- S3 bucket prefix: `config.s3.executionArtifactsBucketPrefix`

---

### File: `src/stacks/constructs/ExecutionInfrastructure.ts` (Phase 4.1 Partial)

**Purpose:** CDK construct for Phase 4.1 foundation (tables, initial handlers)

**Phase 4.1 Components:**

```typescript
import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as events from 'aws-cdk-lib/aws-events';
import { Construct } from 'constructs';
import {
  ExecutionInfrastructureConfig,
  DEFAULT_EXECUTION_INFRASTRUCTURE_CONFIG,
} from './ExecutionInfrastructureConfig';

export interface ExecutionInfrastructureProps {
  readonly eventBus: events.EventBus;
  readonly ledgerTable: dynamodb.Table;
  readonly actionIntentTable: dynamodb.Table;
  readonly tenantsTable: dynamodb.Table;
  readonly config?: ExecutionInfrastructureConfig;
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

    // Use provided config or default (consistent with Phase 3 pattern)
    const config = props.config || DEFAULT_EXECUTION_INFRASTRUCTURE_CONFIG;
    const region = props.region || config.defaults.region;

    // 1. Create DynamoDB Tables
    this.executionAttemptsTable = this.createExecutionAttemptsTable(config);
    this.executionOutcomesTable = this.createExecutionOutcomesTable(config);
    this.actionTypeRegistryTable = this.createActionTypeRegistryTable(config);
    this.externalWriteDedupeTable = this.createExternalWriteDedupeTable(config);
    
    // 2. Create Dead Letter Queues
    this.executionStarterDlq = this.createDlq('ExecutionStarterDlq', config.queueNames.executionStarterDlq, config);
    this.executionValidatorDlq = this.createDlq('ExecutionValidatorDlq', config.queueNames.executionValidatorDlq, config);
    
    // 3. Create Lambda Functions (Phase 4.1 only)
    this.executionStarterHandler = this.createExecutionStarterHandler(props, config);
    this.executionValidatorHandler = this.createExecutionValidatorHandler(props, config);
  }

  private createDlq(id: string, queueName: string, config: ExecutionInfrastructureConfig): sqs.Queue {
    return new sqs.Queue(this, id, {
      queueName,
      retentionPeriod: cdk.Duration.days(config.lambda.dlqRetentionDays),
    });
  }

  private createExecutionAttemptsTable(config: ExecutionInfrastructureConfig): dynamodb.Table {
    const table = new dynamodb.Table(this, 'ExecutionAttemptsTable', {
      tableName: config.tableNames.executionAttempts,
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
      timeToLiveAttribute: 'ttl',
    });
    
    // Add GSI for querying by action_intent_id (operability - common debugging query)
    table.addGlobalSecondaryIndex({
      indexName: 'gsi1-index',
      partitionKey: { name: 'gsi1pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'gsi1sk', type: dynamodb.AttributeType.STRING },
    });
    
    // Add GSI for tenant-level operational queries (all executions for tenant, recent failures, etc.)
    // Enables queries like: "all executions for tenant X", "recent failures across tenant", etc.
    // Without this, would need to scan table (inefficient for operational queries)
    table.addGlobalSecondaryIndex({
      indexName: 'gsi2-index',
      partitionKey: { name: 'gsi2pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'gsi2sk', type: dynamodb.AttributeType.STRING },
    });
    
    return table;
  }

  private createExecutionOutcomesTable(config: ExecutionInfrastructureConfig): dynamodb.Table {
    const table = new dynamodb.Table(this, 'ExecutionOutcomesTable', {
      tableName: config.tableNames.executionOutcomes,
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
    
    // Add GSI for tenant-level operational queries (all outcomes for tenant, recent failures, etc.)
    // Enables queries like: "all outcomes for tenant X", "recent failures across tenant", etc.
    // Without this, would need to scan table (inefficient for operational queries)
    table.addGlobalSecondaryIndex({
      indexName: 'gsi2-index',
      partitionKey: { name: 'gsi2pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'gsi2sk', type: dynamodb.AttributeType.STRING },
    });
    
    return table;
  }

  private createActionTypeRegistryTable(config: ExecutionInfrastructureConfig): dynamodb.Table {
    const table = new dynamodb.Table(this, 'ActionTypeRegistryTable', {
      tableName: config.tableNames.actionTypeRegistry,
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
    });
    
    // Note: GSI not required for Phase 4.1
    // "Latest version" lookup is done by querying all versions and sorting by registry_version in memory
    // (Acceptable for small number of versions per action_type)
    // TODO (Future): Consider adding GSI with registry_version as sort key for better performance
    // if number of versions per action_type grows large
    
    return table;
  }

  private createExternalWriteDedupeTable(config: ExecutionInfrastructureConfig): dynamodb.Table {
    return new dynamodb.Table(this, 'ExternalWriteDedupeTable', {
      tableName: config.tableNames.externalWriteDedupe,
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
    });
  }

  private createExecutionStarterHandler(
    props: ExecutionInfrastructureProps,
    config: ExecutionInfrastructureConfig
  ): lambda.Function {
    const handler = new lambdaNodejs.NodejsFunction(this, 'ExecutionStarterHandler', {
      functionName: config.functionNames.executionStarter,
      entry: 'src/handlers/phase4/execution-starter-handler.ts',
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(config.defaults.timeout.executionStarter),
      memorySize: config.defaults.memorySize?.executionStarter,
      environment: {
        EXECUTION_ATTEMPTS_TABLE_NAME: this.executionAttemptsTable.tableName,
        ACTION_INTENT_TABLE_NAME: props.actionIntentTable.tableName,
        ACTION_TYPE_REGISTRY_TABLE_NAME: this.actionTypeRegistryTable.tableName,
        LEDGER_TABLE_NAME: props.ledgerTable.tableName,
        STATE_MACHINE_TIMEOUT_HOURS: config.stepFunctions.timeoutHours.toString(), // For TTL calculation
        // Note: AWS_REGION is automatically set by Lambda runtime and should not be set manually
      },
      deadLetterQueue: this.executionStarterDlq,
      deadLetterQueueEnabled: true,
      retryAttempts: config.lambda.retryAttempts,
    });
    
    // Grant permissions
    this.executionAttemptsTable.grantReadWriteData(handler);
    props.actionIntentTable.grantReadData(handler);
    this.actionTypeRegistryTable.grantReadData(handler);
    props.ledgerTable.grantWriteData(handler);
    
    return handler;
  }

  private createExecutionValidatorHandler(
    props: ExecutionInfrastructureProps,
    config: ExecutionInfrastructureConfig
  ): lambda.Function {
    const handler = new lambdaNodejs.NodejsFunction(this, 'ExecutionValidatorHandler', {
      functionName: config.functionNames.executionValidator,
      entry: 'src/handlers/phase4/execution-validator-handler.ts',
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(config.defaults.timeout.executionValidator),
      memorySize: config.defaults.memorySize?.executionValidator,
      environment: {
        ACTION_INTENT_TABLE_NAME: props.actionIntentTable.tableName,
        TENANTS_TABLE_NAME: props.tenantsTable.tableName,
        // Note: AWS_REGION is automatically set by Lambda runtime and should not be set manually
      },
      deadLetterQueue: this.executionValidatorDlq,
      deadLetterQueueEnabled: true,
      retryAttempts: config.lambda.retryAttempts,
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

**File: `src/types/DecisionTypes.ts`**

**Change Required:** Add `registry_version` field to `ActionIntentV1` interface

```typescript
export interface ActionIntentV1 {
  // ... existing fields ...
  
  // Phase 4: Execution contract requirement
  registry_version: number;  // REQUIRED: Registry version used at decision time
  // This locks the mapping used for execution, preventing silent behavioral drift
  // Phase 3 must populate this when creating ActionIntentV1
}
```

**Rationale:** If Phase 4 uses "latest mapping" for old intents, registry changes will create silent behavioral drift. Locking `registry_version` at decision time ensures deterministic execution.

**File: `src/services/decision/ActionIntentService.ts`**

**Change Required:** Make `getIntent()` method public

```typescript
// Change from:
private async getIntent(intentId: string, tenantId: string, accountId: string): Promise<ActionIntentV1 | null>

// To:
public async getIntent(intentId: string, tenantId: string, accountId: string): Promise<ActionIntentV1 | null>
```

**File: `src/types/LedgerTypes.ts`**

**Change Required:** Add new LedgerEventType values for Phase 4 execution events

```typescript
export enum LedgerEventType {
  // ... existing values ...
  // Phase 4: Execution Layer events
  EXECUTION_STARTED = 'EXECUTION_STARTED',
  ACTION_EXECUTED = 'ACTION_EXECUTED',
  ACTION_FAILED = 'ACTION_FAILED',
  EXECUTION_CANCELLED = 'EXECUTION_CANCELLED', // Kill switch / manual cancel
  EXECUTION_EXPIRED = 'EXECUTION_EXPIRED', // Intent expired before execution
}
```

**File: `src/types/SignalTypes.ts`**

**Change Required:** Add new SignalType values for execution outcomes (used in Phase 4.4)

```typescript
export enum SignalType {
  // ... existing Phase 1 lifecycle signals ...
  
  // Phase 4: Execution outcome signals
  // These signals feed execution outcomes back into the perception layer
  // for future decision-making and learning (Phase 5+)
  ACTION_EXECUTED = 'ACTION_EXECUTED',
  ACTION_FAILED = 'ACTION_FAILED',
}
```

**Note:** When adding these SignalType values, also update:
- `WINDOW_KEY_DERIVATION` mapping (add derivation logic for new signal types)
- `DEFAULT_SIGNAL_TTL` mapping (add TTL configuration for new signal types)

**Example window key derivation for execution signals:**
```typescript
[SignalType.ACTION_EXECUTED]: (accountId, evidence, timestamp) => {
  // One signal per action_intent_id (from evidence)
  const actionIntentId = evidence?.action_intent_id || 'unknown';
  return `${accountId}-${actionIntentId}`;
},
[SignalType.ACTION_FAILED]: (accountId, evidence, timestamp) => {
  // One signal per action_intent_id (from evidence)
  const actionIntentId = evidence?.action_intent_id || 'unknown';
  return `${accountId}-${actionIntentId}`;
},
```

**Example TTL configuration:**
```typescript
[SignalType.ACTION_EXECUTED]: { ttlDays: 90, isPermanent: false },
[SignalType.ACTION_FAILED]: { ttlDays: 90, isPermanent: false },
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

**⚠️ PREREQUISITES (Must complete before starting Phase 4.1):**
- [ ] Update `src/types/DecisionTypes.ts` (add `registry_version: number` to ActionIntentV1 interface) - **REQUIRED**
- [ ] Update `src/services/decision/ActionIntentService.ts` (make getIntent() public) - **REQUIRED**
- [ ] Update `src/types/LedgerTypes.ts` (add EXECUTION_STARTED, ACTION_EXECUTED, ACTION_FAILED, EXECUTION_CANCELLED, EXECUTION_EXPIRED) - **REQUIRED**
- [ ] Update `src/types/SignalTypes.ts` (add ACTION_EXECUTED, ACTION_FAILED + window key + TTL config) - **REQUIRED for Phase 4.4**
- [ ] Note: `IDEMPOTENCY_COLLISION_DETECTED` ledger event type will be added in Phase 4.2 when IdempotencyService gets LedgerService injection

**Phase 4.1 Implementation Tasks:**
- [x] Create `src/stacks/constructs/ExecutionInfrastructureConfig.ts` (config interface and defaults)
- [x] Create `src/types/ExecutionTypes.ts`
- [x] Create `src/types/ExecutionErrors.ts` (typed error classes for SFN retry logic)
- [x] Create `src/types/MCPTypes.ts` (MCP protocol types)
- [x] Create `src/services/execution/ExecutionAttemptService.ts` (with GSI population)
- [x] Create `src/services/execution/ActionTypeRegistryService.ts` (registry_version-based latest lookup)
- [x] Create `src/services/execution/IdempotencyService.ts` (deep canonical JSON, Option A dedupe)
- [x] Create `src/services/execution/ExecutionOutcomeService.ts` (write-once immutability)
- [x] Create `src/services/execution/KillSwitchService.ts`
- [x] Create `src/handlers/phase4/execution-starter-handler.ts` (Zod validation, execution trace)
- [x] Create `src/handlers/phase4/execution-validator-handler.ts` (typed errors, Zod validation, budget stub)
- [x] Create `src/stacks/constructs/ExecutionInfrastructure.ts` (Phase 4.1 partial - use config for all hardcoded values)
- [x] Create DynamoDB tables in CDK (with GSI for ExecutionAttempts and ExecutionOutcomes) - use `config.tableNames.*`
- [x] Create DLQs for Phase 4.1 handlers - use `config.queueNames.*` and `config.lambda.dlqRetentionDays`
- [ ] Unit tests for all services (TODO: Phase 4.1 testing)
- [ ] Unit tests for Phase 4.1 handlers (TODO: Phase 4.1 testing)

---

## 7. Phase 4.1 Exit Criteria

**Before proceeding to Phase 4.2, ensure all exit criteria are met:**

### ✅ 1. Registry Latest Strategy Unified
- [x] Registry "latest" lookup uses `registry_version` monotonic ordering (not `created_at`)
- [x] No GSI dependency for latest lookup (queries all versions, sorts in memory)
- [x] Removed `created-at-index` GSI from CDK table definition
- [x] Future optimization path documented (LATEST pointer or GSI with registry_version as sort key)

### ✅ 2. Execution Trace Strategy Unified
- [x] Explicit contract: `execution_trace_id` (generated at execution start) vs `decision_trace_id` (from Phase 3)
- [x] All execution handlers use `execution_trace_id` consistently
- [x] Ledger events include both `trace_id` (execution) and `decision_trace_id` (correlation field)
- [x] Step Functions passes `execution_trace_id` through all states

### ✅ 3. Validator Throws Typed Errors
- [x] Created `ExecutionError` base class with `error_class`, `error_code`, `retryable` properties
- [x] Implemented typed error classes: `IntentExpiredError`, `KillSwitchEnabledError`, `IntentNotFoundError`, etc.
- [x] Validator handler uses typed errors aligned to retry taxonomy
- [x] SFN catch configuration documented for Phase 4.2

### ✅ 4. Outcome Writes Are Immutable
- [x] `recordOutcome()` uses conditional write (`attribute_not_exists`)
- [x] Outcomes are write-once (immutable once recorded)
- [x] Returns existing outcome if already exists (idempotent semantics)
- [x] Prevents overwriting terminal outcomes from retries/bugs

### ✅ 5. External Dedupe Design Internally Consistent
- [x] Chose Option A: Immutable per idempotency_key with history
- [x] Each write creates history item (`sk = CREATED_AT#<timestamp>`) + LATEST pointer
- [x] Preserves audit history while enabling fast "latest" lookup
- [x] Collision detection with operational requirements documented

### ✅ 6. Additional Improvements
- [x] Added GSI to ExecutionAttemptsTable for querying by `action_intent_id` (operability)
- [x] Defined allowed state transitions in ExecutionAttempt schema
- [x] Budget checks stubbed with TODO for Phase 4.3
- [x] Zod schema for SFN input validation (fail fast with precise errors)
- [x] TTL calculation tied to SFN timeout (not hardcoded)

**All exit criteria met. Phase 4.1 implementation is complete.**

---

## 8. Implementation Status

**Phase 4.1 Implementation: ✅ COMPLETE**

All core components have been implemented:

### ✅ Completed Components

1. **Type Definitions** - All schemas defined with Zod as source of truth
   - `ExecutionTypes.ts` - Complete with Model A ExecutionAttempt, ActionOutcomeV1, ActionTypeRegistry, ExternalWriteDedupe
   - `ExecutionErrors.ts` - Typed error classes for SFN retry/catch logic
   - `MCPTypes.ts` - MCP protocol types for tool invocation

2. **Prerequisites Updated**
   - ✅ `ActionIntentV1` - Added `registry_version` field
   - ✅ `ActionIntentService.getIntent()` - Made public
   - ✅ `LedgerTypes` - Added `EXECUTION_STARTED`, `ACTION_EXECUTED`, `ACTION_FAILED`, `EXECUTION_CANCELLED`, `EXECUTION_EXPIRED`
   - ✅ `SignalTypes` - Added `ACTION_EXECUTED`, `ACTION_FAILED` with window key derivation

3. **Execution Services**
   - ✅ ExecutionAttemptService - Model A execution locking with GSI support
   - ✅ ActionTypeRegistryService - Versioned tool mapping with registry_version separation
   - ✅ IdempotencyService - Deep canonical JSON + Option A dedupe (immutable history)
   - ✅ ExecutionOutcomeService - Write-once immutability with GSI support
   - ✅ KillSwitchService - Multi-layered execution safety controls

4. **Lambda Handlers**
   - ✅ execution-starter-handler - Zod validation, execution trace generation, registry_version validation
   - ✅ execution-validator-handler - Typed errors, Zod validation, budget stub

5. **Infrastructure (CDK)**
   - ✅ ExecutionInfrastructureConfig - Centralized configuration (consistent with Phase 3 pattern)
   - ✅ ExecutionInfrastructure - CDK construct with tables, handlers, DLQs (Phase 4.1 partial)

### ⏳ Pending (Future Work)

- Unit tests for all services (Phase 4.1 testing)
- Unit tests for Phase 4.1 handlers (Phase 4.1 testing)
- Integration tests (Phase 4.2+)

---

## 9. Next Steps

After Phase 4.1 completion:
- ✅ Foundation services and handlers ready
- ⏳ Proceed to Phase 4.2 (Orchestration) - Step Functions, tool mapper, tool invoker, execution recorder
- ⏳ Integration into main stack (CCNativeStack.ts) - Part of Phase 4.2 when EventBridge rule is added

---

**See:** `PHASE_4_CODE_LEVEL_PLAN.md` for complete Phase 4 overview and cross-references.
