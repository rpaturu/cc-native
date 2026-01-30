# Phase 5.1 — Autonomy Modes & Policy: Code-Level Plan

**Status:** 🟡 **PLANNING**  
**Created:** 2026-01-28  
**Last Updated:** 2026-01-28  
**Parent:** [PHASE_5_CODE_LEVEL_PLAN.md](PHASE_5_CODE_LEVEL_PLAN.md)

---

## Overview

Phase 5.1 establishes autonomy control surfaces:

- **AutonomyModeConfigV1** — per-tenant, per-action-type execution modes (PROPOSE_ONLY, APPROVAL_REQUIRED, AUTO_EXECUTE, DISABLED)
- **AutoApprovalPolicyV1** — deterministic policy evaluator (after Phase 3, before Phase 4); rich output (decision, reason, explanation, policy_version)
- **Autonomy Budget** — max autonomous actions per account/day and per action type; enforced after AUTO_EXECUTE, before Phase 4

**Dependencies:** Phase 3 (ActionIntentV1 with confidence score); Phase 4 (execution path).

---

## Implementation Tasks

1. Type definitions (AutonomyTypes)
2. DynamoDB tables (autonomy config, autonomy budget state)
3. AutonomyModeService
4. AutoApprovalPolicyEngine (Lambda/OPA)
5. AutonomyBudgetService
6. Admin API for autonomy config and budget

---

## 1. Type Definitions

### File: `src/types/autonomy/AutonomyTypes.ts` (new)

**AutonomyModeConfigV1**

```typescript
export type AutonomyMode = 'PROPOSE_ONLY' | 'APPROVAL_REQUIRED' | 'AUTO_EXECUTE' | 'DISABLED';

export interface AutonomyModeConfigV1 {
  pk: string;   // TENANT#<tenant_id> or TENANT#<tenant_id>#ACCOUNT#<account_id>
  sk: string;   // AUTONOMY#<action_type> or AUTONOMY#DEFAULT
  tenant_id: string;
  account_id?: string;  // optional; omit for tenant-wide default
  action_type?: string; // optional; omit for default for account/tenant
  mode: AutonomyMode;
  updated_at: string;   // ISO
  updated_by?: string;   // audit
  policy_version: string; // e.g. "AutonomyModeConfigV1"
}
```

**AutoApprovalPolicyResultV1** (rich output; required for BLOCK/REQUIRE_APPROVAL)

```typescript
export type AutoApprovalDecision = 'AUTO_EXECUTE' | 'REQUIRE_APPROVAL' | 'BLOCK';

export interface AutoApprovalPolicyResultV1 {
  decision: AutoApprovalDecision;
  reason?: string;       // e.g. EXTERNAL_CONTACT, RISK_LEVEL_HIGH, TENANT_POLICY
  explanation: string;  // human-readable; required for BLOCK/REQUIRE_APPROVAL
  policy_version: string; // e.g. "AutoApprovalPolicyV1"
  policy_clause?: string; // which rule produced the result
}
```

**AutoApprovalPolicyInputV1** (inputs to policy evaluator)

```typescript
export interface AutoApprovalPolicyInputV1 {
  action_type: string;
  confidence_score: number;  // from Phase 3; not learned in Phase 5
  risk_level: string;         // from Phase 3 / tenant
  lifecycle_state?: string;
  tenant_id: string;
  account_id: string;
  autonomy_mode: AutonomyMode; // from AutonomyModeConfigV1
}
```

**AutonomyBudgetV1** (config) and **AutonomyBudgetStateV1** (runtime state)

```typescript
export interface AutonomyBudgetV1 {
  pk: string;   // TENANT#<tenant_id>#ACCOUNT#<account_id>
  sk: string;   // BUDGET#CONFIG or BUDGET#ACTION_TYPE#<action_type>
  tenant_id: string;
  account_id: string;
  max_autonomous_per_day: number;
  max_per_action_type?: Record<string, number>;
  decay_if_unused?: boolean;  // optional decay
  updated_at: string;
}

export interface AutonomyBudgetStateV1 {
  pk: string;   // TENANT#<tenant_id>#ACCOUNT#<account_id>
  sk: string;   // BUDGET_STATE#<date_YYYYMMDD> or BUDGET_STATE#<date>#<action_type>
  tenant_id: string;
  account_id: string;
  date_key: string;     // YYYY-MM-DD
  action_type?: string;
  count: number;
  updated_at: string;
}
```

---

## 2. DynamoDB Tables (CDK)

**Table: AutonomyConfig**  
- **Partition key:** `pk` (string)  
- **Sort key:** `sk` (string)  
- **TTL:** optional on config items (no TTL on config; state may have TTL for daily rollups)  
- **GSI:** optional by tenant_id for admin listing  

**Table: AutonomyBudgetState** (or same table with sk prefix BUDGET_STATE#)  
- **Partition key:** `pk` (string)  
- **Sort key:** `sk` (string)  
- **TTL:** optional for old date keys (e.g. 90 days)  
- Used to enforce max_autonomous_per_day and max_per_action_type; increment on auto-execute, reset/decay per config.

**Location:** CDK in `src/stacks/` or Phase 5 construct; table names via env (e.g. `AUTONOMY_CONFIG_TABLE_NAME`, `AUTONOMY_BUDGET_STATE_TABLE_NAME`).

---

## 3. Services

### AutonomyModeService

**File:** `src/services/autonomy/AutonomyModeService.ts`

- `getMode(tenantId: string, accountId: string, actionType: string): Promise<AutonomyMode>` — resolve effective mode (account override → tenant default → global default).
- `putConfig(item: AutonomyModeConfigV1): Promise<void>` — write config; ledger event for audit.
- `listConfigs(tenantId: string, accountId?: string): Promise<AutonomyModeConfigV1[]>`.

### AutoApprovalPolicyEngine

**File:** `src/services/autonomy/AutoApprovalPolicyEngine.ts` (or Lambda/OPA wrapper)

- `evaluate(input: AutoApprovalPolicyInputV1): Promise<AutoApprovalPolicyResultV1>` — deterministic; same input → same output.
- Policy must return **reason** and **explanation** for BLOCK and REQUIRE_APPROVAL.
- Policy is versioned and kill-switchable (e.g. feature flag or policy version routing).

### AutonomyBudgetService

**File:** `src/services/autonomy/AutonomyBudgetService.ts`

- `checkAndConsume(tenantId: string, accountId: string, actionType: string): Promise<boolean>` — check config limits and current day state; if under limit, increment and return true; else false. Enforced **after** policy returns AUTO_EXECUTE, **before** Phase 4 execution.
- `getConfig(tenantId: string, accountId: string): Promise<AutonomyBudgetV1 | null>`.
- `putConfig(config: AutonomyBudgetV1): Promise<void>`.
- Optional: decay logic for unused budget (per config).

---

## 4. Handlers / API

### Auto-approval policy evaluator (Lambda or in-process)

- **Input:** AutoApprovalPolicyInputV1 (action_type, confidence_score, risk_level, tenant_id, account_id, autonomy_mode).
- **Output:** AutoApprovalPolicyResultV1 (decision, reason, explanation, policy_version).
- **Invocation:** After Phase 3 decision, before Phase 4 execution (called by orchestration layer that routes to approval vs auto-execute).

### Admin API (autonomy config and budget)

- **Endpoints:** CRUD for autonomy mode config; CRUD for autonomy budget config; list by tenant/account.
- **Auth:** Admin-only (e.g. Cognito group or API key).
- **Location:** API Gateway + Lambda in cc-native; UI in cc-dealmind consumes these APIs.

---

## 5. Contract: Placement in Execution Flow

- **After** Phase 3 produces ActionIntentV1 (with confidence score).
- **Before** Phase 4 execution:
  1. Resolve AutonomyModeConfigV1 for tenant/account/action_type.
  2. Call AutoApprovalPolicyEngine.evaluate(AutoApprovalPolicyInputV1).
  3. If decision === BLOCK or REQUIRE_APPROVAL → route to human approval or block; store reason + explanation for UI/audit.
  4. If decision === AUTO_EXECUTE → call AutonomyBudgetService.checkAndConsume; if false, treat as REQUIRE_APPROVAL or defer; if true, proceed to Phase 4 execution (skip human approval path).

---

## 6. Test Strategy (placeholder)

Unit tests for AutonomyModeService, AutoApprovalPolicyEngine, AutonomyBudgetService. Integration tests for policy + budget enforcement with real DDB (optional; skip with env flag). Formal test plan created after implementation.

---

## References

- Parent: [PHASE_5_CODE_LEVEL_PLAN.md](PHASE_5_CODE_LEVEL_PLAN.md)
- Implementation Plan: [PHASE_5_IMPLEMENTATION_PLAN.md](PHASE_5_IMPLEMENTATION_PLAN.md) EPIC 5.1, Stories 5.1.1–5.1.3
