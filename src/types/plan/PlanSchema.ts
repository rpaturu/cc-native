/**
 * Phase 6.1 — Runtime schemas for plan types (validation only).
 * Used by tests and optional validation; does not replace PlanTypes.ts.
 */

import { z } from 'zod';

export const PlanStatusSchema = z.enum([
  'DRAFT',
  'APPROVED',
  'ACTIVE',
  'PAUSED',
  'COMPLETED',
  'ABORTED',
  'EXPIRED',
]);

export const PlanStepStatusSchema = z.enum([
  'PENDING',
  'PENDING_APPROVAL',
  'AUTO_EXECUTED',
  'DONE',
  'SKIPPED',
  'FAILED',
]);

/** step_id required; no retry_count (not in PlanStepV1). */
export const PlanStepV1Schema = z.object({
  step_id: z.string(),
  action_type: z.string(),
  status: PlanStepStatusSchema,
  sequence: z.number().optional(),
  dependencies: z.array(z.string()).optional(),
  constraints: z.record(z.unknown()).optional(),
});

export const RevenuePlanV1Schema = z.object({
  plan_id: z.string(),
  plan_type: z.string(),
  account_id: z.string(),
  tenant_id: z.string(),
  objective: z.string(),
  plan_status: PlanStatusSchema,
  steps: z.array(PlanStepV1Schema),
  constraints: z.record(z.unknown()).optional(),
  expires_at: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  approved_at: z.string().optional(),
  approved_by: z.string().optional(),
  completed_at: z.string().optional(),
  aborted_at: z.string().optional(),
  expired_at: z.string().optional(),
  completion_reason: z.enum(['objective_met', 'all_steps_done']).optional(),
});

export const PlanLedgerEventTypeSchema = z.enum([
  'PLAN_CREATED',
  'PLAN_UPDATED',
  'PLAN_APPROVED',
  'PLAN_ACTIVATED',
  'PLAN_PAUSED',
  'PLAN_RESUMED',
  'PLAN_ABORTED',
  'PLAN_COMPLETED',
  'PLAN_EXPIRED',
  'STEP_STARTED',
  'STEP_COMPLETED',
  'STEP_SKIPPED',
  'STEP_FAILED',
]);

export const PlanLedgerEntrySchema = z.object({
  entry_id: z.string(),
  plan_id: z.string(),
  tenant_id: z.string(),
  account_id: z.string(),
  event_type: PlanLedgerEventTypeSchema,
  timestamp: z.string(),
  data: z.record(z.unknown()),
});

/** preconditions_met required (not optional). */
export const PlanPolicyGateInputSchema = z.object({
  plan: RevenuePlanV1Schema,
  tenant_id: z.string(),
  account_id: z.string(),
  existing_active_plan_ids: z.array(z.string()).optional(),
  preconditions_met: z.boolean(),
});
