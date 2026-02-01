/**
 * Phase 7.1 — Validator types (ValidatorGateway, choke points, evidence reference).
 * See PHASE_7_1_CODE_LEVEL_PLAN.md §1.
 */

import type { RevenuePlanV1 } from '../plan/PlanTypes';

export type ValidatorChokePoint =
  | 'BEFORE_PLAN_APPROVAL'
  | 'BEFORE_STEP_EXECUTION'
  | 'BEFORE_EXTERNAL_WRITEBACK'
  | 'BEFORE_EXPENSIVE_READ';

export type ValidatorResultKind = 'ALLOW' | 'WARN' | 'BLOCK';

export interface ValidatorResult {
  validator: string;
  result: ValidatorResultKind;
  reason?: string;
  details?: Record<string, unknown>;
}

export interface RecordLocator {
  system: string;
  object: string;
  id: string;
  fields?: string[];
}

export type EvidenceReference =
  | { source_type: string; source_id: string }
  | { ledger_event_id: string }
  | { record_locator: RecordLocator };

export interface ExecutablePayload {
  evidence: EvidenceReference[];
  [key: string]: unknown;
}

export interface ValidatorContext {
  choke_point: ValidatorChokePoint;
  evaluation_time_utc_ms: number;
  validation_run_id: string;
  snapshot_id?: string;
  target_id: string;
  tenant_id: string;
  account_id?: string;
  plan_id?: string;
  step_id?: string;
  plan?: RevenuePlanV1;
  step_or_proposal?: ExecutablePayload;
  canonical_snapshot?: Record<string, unknown>;
  evidence_references?: EvidenceReference[];
  data_sources?: { source_id: string; last_updated_utc_ms: number }[];
  writeback_payload?: Record<string, unknown>;
}

export interface ValidatorGatewayResult {
  aggregate: ValidatorResultKind;
  results: ValidatorResult[];
}

export interface IValidator {
  validate(context: ValidatorContext): ValidatorResult;
}
