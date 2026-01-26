/**
 * Execution Types - Phase 4: Bounded Execution & AI-Native Action Fulfillment
 * 
 * Defines canonical execution types for action intent execution.
 * Uses Zod for runtime validation (fail-closed validation).
 */

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
export interface ExecutionAttempt {
  // Composite keys
  pk: string; // TENANT#tenant_id#ACCOUNT#account_id
  sk: string; // EXECUTION#action_intent_id
  // GSI attributes
  gsi1pk?: string; // ACTION_INTENT#<action_intent_id> (for querying by action_intent_id)
  gsi1sk?: string; // UPDATED_AT#<timestamp>
  gsi2pk?: string; // TENANT#<tenant_id> (for tenant-level operational queries)
  gsi2sk?: string; // UPDATED_AT#<timestamp> or STATUS#<status>#UPDATED_AT#<timestamp>
  
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
  trace_id: string; // execution_trace_id (not decision_trace_id)
  
  // TTL (for cleanup of stuck RUNNING states)
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
  // GSI attributes
  gsi1pk?: string; // ACTION_INTENT#<action_intent_id> (for querying by action_intent_id)
  gsi1sk?: string; // COMPLETED_AT#<timestamp>
  gsi2pk?: string; // TENANT#<tenant_id> (for tenant-level operational queries)
  gsi2sk?: string; // COMPLETED_AT#<timestamp> or STATUS#<status>#COMPLETED_AT#<timestamp>
  
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
  registry_version: number; // Registry version used for this execution
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

/**
 * Validation Schemas (Zod)
 */

export const ExecutionAttemptSchema = z.object({
  pk: z.string(),
  sk: z.string(),
  gsi1pk: z.string().optional(),
  gsi1sk: z.string().optional(),
  action_intent_id: z.string(),
  attempt_count: z.number(),
  last_attempt_id: z.string(),
  status: z.enum(['RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED']),
  idempotency_key: z.string(),
  started_at: z.string(),
  last_error_class: z.string().optional(),
  updated_at: z.string(),
  tenant_id: z.string(),
  account_id: z.string(),
  trace_id: z.string(),
  ttl: z.number().optional(),
}).strict();

export const ActionOutcomeV1Schema = z.object({
  pk: z.string(),
  sk: z.string(),
  gsi1pk: z.string().optional(),
  gsi1sk: z.string().optional(),
  gsi2pk: z.string().optional(),
  gsi2sk: z.string().optional(),
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
  registry_version: z.number(),
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
