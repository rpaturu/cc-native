/**
 * Phase 6.1 — Plan Ledger event schema (append-only).
 * See PHASE_6_1_CODE_LEVEL_PLAN.md §3.
 */

export type PlanLedgerEventType =
  | 'PLAN_CREATED'
  | 'PLAN_UPDATED'
  | 'PLAN_APPROVED'
  | 'PLAN_ACTIVATED'
  | 'PLAN_PAUSED'
  | 'PLAN_RESUMED'
  | 'PLAN_ABORTED'
  | 'PLAN_COMPLETED'
  | 'PLAN_EXPIRED'
  | 'STEP_STARTED'
  | 'STEP_COMPLETED'
  | 'STEP_SKIPPED'
  | 'STEP_FAILED';

export interface PlanLedgerEntry {
  entry_id: string;
  plan_id: string;
  tenant_id: string;
  account_id: string;
  event_type: PlanLedgerEventType;
  timestamp: string;
  data: Record<string, unknown>;
}
