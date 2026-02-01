/**
 * Phase 7.4 — Outcomes capture types (discriminated union, idempotency, source).
 * See PHASE_7_4_CODE_LEVEL_PLAN.md §1.
 */

export type OutcomeSource = 'HUMAN' | 'POLICY' | 'ORCHESTRATOR' | 'CONNECTOR' | 'DOWNSTREAM';

const PLAN_LINKED_EVENT_TYPES = [
  'ACTION_APPROVED',
  'ACTION_REJECTED',
  'SELLER_EDIT',
  'EXECUTION_SUCCESS',
  'EXECUTION_FAILURE',
  'PLAN_COMPLETED',
  'PLAN_ABORTED',
  'PLAN_EXPIRED',
] as const;
export type PlanLinkedEventType = (typeof PLAN_LINKED_EVENT_TYPES)[number];

export interface PlanLinkedOutcomeEvent {
  outcome_id: string;
  tenant_id: string;
  account_id?: string;
  plan_id: string;
  step_id?: string;
  event_type: PlanLinkedEventType;
  source: OutcomeSource;
  timestamp_utc_ms: number;
  ledger_entry_id?: string;
  data: Record<string, unknown>;
}

export interface DownstreamOutcomeEvent {
  outcome_id: string;
  tenant_id: string;
  account_id: string;
  plan_id?: string;
  event_type: 'DOWNSTREAM_WIN' | 'DOWNSTREAM_LOSS';
  source: 'DOWNSTREAM';
  timestamp_utc_ms: number;
  ledger_entry_id?: string;
  data: Record<string, unknown>;
}

export type OutcomeEvent = PlanLinkedOutcomeEvent | DownstreamOutcomeEvent;

export interface PlanLinkedOutcomeCaptureInput {
  tenant_id: string;
  account_id?: string;
  plan_id: string;
  step_id?: string;
  event_type: PlanLinkedEventType;
  source: OutcomeSource;
  ledger_entry_id?: string;
  data: Record<string, unknown>;
}

export interface DownstreamOutcomeCaptureInput {
  tenant_id: string;
  account_id: string;
  plan_id?: string;
  event_type: 'DOWNSTREAM_WIN' | 'DOWNSTREAM_LOSS';
  source: 'DOWNSTREAM';
  data: Record<string, unknown>;
}

export type OutcomeCaptureInput = PlanLinkedOutcomeCaptureInput | DownstreamOutcomeCaptureInput;

export interface DuplicateOutcome {
  duplicate: true;
  outcome_id: string;
}
