/**
 * Autonomy Types - Phase 5.1
 *
 * Autonomy modes, auto-approval policy, and autonomy budget.
 */

export type AutonomyMode =
  | 'PROPOSE_ONLY'
  | 'APPROVAL_REQUIRED'
  | 'AUTO_EXECUTE'
  | 'DISABLED';

export interface AutonomyModeConfigV1 {
  pk: string; // TENANT#<tenant_id> or TENANT#<tenant_id>#ACCOUNT#<account_id>
  sk: string; // AUTONOMY#<action_type> or AUTONOMY#DEFAULT
  tenant_id: string;
  account_id?: string; // optional; omit for tenant-wide default
  action_type?: string; // optional; omit for default for account/tenant
  mode: AutonomyMode;
  updated_at: string; // ISO
  updated_by?: string; // audit
  policy_version: string; // e.g. "AutonomyModeConfigV1"
}

export type AutoApprovalDecision =
  | 'AUTO_EXECUTE'
  | 'REQUIRE_APPROVAL'
  | 'BLOCK';

export interface AutoApprovalPolicyResultV1 {
  decision: AutoApprovalDecision;
  reason?: string; // e.g. EXTERNAL_CONTACT, RISK_LEVEL_HIGH, TENANT_POLICY
  explanation: string; // human-readable; required for BLOCK/REQUIRE_APPROVAL
  policy_version: string; // e.g. "AutoApprovalPolicyV1"
  policy_clause?: string; // which rule produced the result
}

export interface AutoApprovalPolicyInputV1 {
  action_type: string;
  confidence_score: number; // from Phase 3; 0–1
  risk_level: string; // canonical: LOW, MEDIUM, HIGH, MINIMAL
  lifecycle_state?: string;
  tenant_id: string;
  account_id: string;
  autonomy_mode: AutonomyMode;
}

export interface AutonomyBudgetV1 {
  pk: string; // TENANT#<tenant_id>#ACCOUNT#<account_id>
  sk: string; // BUDGET#CONFIG or BUDGET#ACTION_TYPE#<action_type>
  tenant_id: string;
  account_id: string;
  max_autonomous_per_day: number;
  max_per_action_type?: Record<string, number>;
  decay_if_unused?: boolean;
  updated_at: string;
}

export interface AutonomyBudgetStateV1 {
  pk: string; // TENANT#<tenant_id>#ACCOUNT#<account_id>
  sk: string; // BUDGET_STATE#<date_YYYYMMDD> or BUDGET_STATE#<date>#<action_type>
  tenant_id: string;
  account_id: string;
  date_key: string; // YYYY-MM-DD
  action_type?: string;
  count: number;
  updated_at: string;
}

/** Phase 5.4: Allowlist of action_type values that may auto-execute (hard stop before policy/budget). */
export interface AutoExecuteAllowListV1 {
  pk: string; // TENANT#<tenant_id> or TENANT#<tenant_id>#ACCOUNT#<account_id>
  sk: string; // ALLOWLIST#AUTO_EXEC
  tenant_id: string;
  account_id?: string;
  action_types: string[]; // action_type values allowed for auto-execute
  updated_at: string;
}

/** Phase 5.4: Auto-exec state for idempotency (no double budget consume under retries). */
export type AutoExecStateStatus = 'RESERVED' | 'PUBLISHED';

export interface AutoExecStateV1 {
  pk: string; // AUTO_EXEC_STATE
  sk: string; // <action_intent_id>
  action_intent_id: string;
  status: AutoExecStateStatus;
  updated_at: string;
  ttl: number; // epoch seconds; 30–90 days for audit
}
