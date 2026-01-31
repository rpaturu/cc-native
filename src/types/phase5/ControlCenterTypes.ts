/**
 * Phase 5.6 — Control Center API types (ledger explanation, audit export).
 */

/** Ledger explanation response: why / what it knew / which policy. */
export interface LedgerExplanationV1 {
  execution_id: string;
  action_intent_id?: string;
  account_id: string;
  tenant_id: string;
  why: {
    trigger_type?: string;
    policy_decision: string;
    reason?: string;
    explanation: string;
  };
  what_it_knew?: {
    signals_snapshot?: unknown;
    posture_snapshot?: unknown;
    intent_snapshot?: unknown;
  };
  which_policy: {
    policy_version: string;
    policy_clause?: string;
  };
  approval_source?: 'HUMAN' | 'POLICY';
  auto_executed?: boolean;
  policy_result_ref?: string;
  cost_gate_decision_ref?: string;
}

/** POST /autonomy/audit/exports request body. */
export interface AuditExportCreateRequest {
  from: string;
  to: string;
  format?: 'json' | 'csv';
  account_id?: string;
}

/** POST /autonomy/audit/exports response. */
export interface AuditExportCreateResponse {
  export_id: string;
  status: 'PENDING';
  message?: string;
}

/** GET /autonomy/audit/exports/:id response. */
export interface AuditExportStatusResponse {
  export_id: string;
  status: 'PENDING' | 'COMPLETED' | 'FAILED';
  presigned_url?: string;
  expires_at?: string;
  error_message?: string;
}
