# Phase 5.6 — Autonomy Control Center: Code-Level Plan

**Status:** ✅ **COMPLETE**  
**Created:** 2026-01-28  
**Last Updated:** 2026-01-28 (implementation complete; CDK wired)  
**Parent:** [PHASE_5_CODE_LEVEL_PLAN.md](PHASE_5_CODE_LEVEL_PLAN.md)

---

## Executive summary (enterprise review)

5.6 is the **trust layer**: APIs that power the Control Center UI. Directionally approved; the following tighten it for production.

**Before freezing 5.6, do these three:**

1. **AuthZ contract** — Derive `tenant_id` from JWT claims; enforce account-level access via RBAC/AccountAccessService; **never trust** `tenant_id`/`account_id` from query or body for authorization (use only for lookup after scope is validated).
2. **Audit export** — Use **async export** for large ranges (POST → export_id, job → S3, GET status + presigned URL). If keeping sync GET, cap window (e.g. max 7 days), paginate, and document.
3. **Canonical identifier strategy** for ledger explanation — Primary key: `execution_id`; secondary: `action_intent_id` (resolves to latest execution). Require `tenant_id` and `account_id` for auth scoping (do not infer from execution_id alone).

Additional tightening: config change ledger + optional optimistic concurrency; “remaining today” computation contract; pagination on all list endpoints; ledger explanation fields (approval_source, auto_executed, policy refs). See §6 and §1–§3 below.

**Reviewed:** Enterprise-tight; **approved for implementation** (production-ready). Optional tightenings §7 (non-blocking).

---

## Overview

Phase 5.6 delivers **APIs in cc-native** that the **Autonomy Control Center UI (cc-dealmind)** consumes:

- Autonomy mode config (CRUD, list)
- Autonomy budget (config, state)
- Kill switches (Phase 4; expose via API if not already)
- Audit export
- **Ledger-first APIs** — "Why did the system do this?", "What did it know at the time?", "Which policy allowed it?"

**Repo boundary:** UI (seller timeline, admin config, kill switches, audit export) is implemented in **cc-dealmind**. **cc-native** provides all APIs below.

**Mode 4 (Autonomous schedules) gating:** Daily digest, explicit opt-in, kill-switch visibility are hard requirements; APIs must support opt-in and digest triggers; UI in cc-dealmind.

---

## Implementation Tasks

1. APIs: autonomy config, autonomy budget, kill switches, audit export
2. Ledger-first APIs (why / what did it know / which policy)

---

## 1. API Endpoints (cc-native)

**Base path:** e.g. `/autonomy` or under existing API Gateway.

**Pagination contract (all list endpoints):** `limit` (max page size), `next_token` (opaque), deterministic ordering (e.g. by time desc). Document max `limit` and behaviour when omitted.

**Autonomy config**

- `GET /autonomy/config` — list configs (mode per action type / default). **Scoping:** `tenant_id` and `account_id` derived from auth (see §3); optional query filters. Pagination: `limit`, `next_token`.
- `PUT /autonomy/config` — create/update AutonomyModeConfigV1 (admin). **Contract:** conditional write with `updated_at` / `if_match` (optimistic concurrency) to prevent overwrites; all config changes produce a ledger record; optional `effective_at`, `changed_by` for audit.
- `GET /autonomy/config/:id` — get one config (optional). Scoped by resolved tenant/account.

**Autonomy budget**

- `GET /autonomy/budget` — get budget config and current state. **“Remaining today” contract:** time basis **UTC**; remaining = config cap − consumed state for current UTC date; if no config exists, return defaults (e.g. remaining 0 or documented default). Scoping: tenant/account from auth.
- `PUT /autonomy/budget` — create/update AutonomyBudgetV1 (admin). Ledger record on change; optional optimistic concurrency.

**Kill switches**

- `GET /autonomy/kill-switches` — global/tenant state (Phase 4 KillSwitchService). Scoping: tenant from auth.
- `PUT /autonomy/kill-switches` (admin) — toggle; audit logged.

**Audit export (enterprise-safe pattern)**

- **Async (recommended):**  
  - `POST /autonomy/audit/exports` — body: `{ tenant_id?, account_id?, from, to, format?: "json" | "csv" }`. **Scoping:** tenant/account from auth; ignore body values that conflict with claims. Returns `export_id`. **Max range per export** (e.g. 90 days) even when async; document limit. **Rate limiting:** per-tenant export cap (e.g. N per hour) to prevent abuse.  
  - Async job writes to S3 (CSV/JSON). **Format contracts:** document CSV column schema version and default ordering (e.g. time desc).  
  - `GET /autonomy/audit/exports/:export_id` — returns `status` (PENDING | COMPLETED | FAILED) and, when COMPLETED, presigned download URL (or proxy via cc-native). Scoped so caller can only access their own exports.
- **Sync (if kept):** `GET /autonomy/audit?from=...&to=...` — **capped window** (e.g. max 7 days); **paginated** (`limit`, `next_token`); format query. Document cap and pagination.

**Ledger explanation (canonical identifier strategy)**

- **Primary key:** `execution_id` (if available from Phase 4 execution/outcome model).  
- **Secondary:** `action_intent_id` — resolves to **latest** execution_id for that intent; use when UI has only intent id.  
- **Auth scoping:** Require **tenant_id and account_id** for access; **do not** infer tenant/account from execution_id alone (prevents cross-tenant leakage). Resolve tenant/account from JWT (see §3); then allow lookup by execution_id or (action_intent_id + account_id in scope).

- `GET /autonomy/ledger/explanation?execution_id=...`  
  **Or** `GET /autonomy/ledger/explanation?action_intent_id=...` (resolves to latest execution for that intent within caller’s scope).  
  Query params: exactly one of `execution_id` or `action_intent_id`; tenant/account **not** accepted from query (derived from auth).  
  Returns:
  - **Why** — trigger, policy decision (AUTO_EXECUTE | REQUIRE_APPROVAL | BLOCK), reason/explanation.
  - **What it knew** — snapshot of context (signals, posture, intent) at decision/execution time if available.
  - **Which policy** — policy_version, policy_clause, AutoApprovalPolicyResultV1 fields; **approval_source** (HUMAN | POLICY), **auto_executed**; reference IDs to policy result and cost gate decision if stored.

---

## 2. Data Shapes (API responses)

**Ledger explanation response (example)**

```typescript
export interface LedgerExplanationV1 {
  execution_id: string;       // canonical; or resolved from action_intent_id
  action_intent_id?: string;  // when lookup was by action_intent_id
  account_id: string;
  tenant_id: string;
  why: {
    trigger_type?: string;
    policy_decision: string;  // AUTO_EXECUTE | REQUIRE_APPROVAL | BLOCK
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
  // Phase 5.4 / 5.6: "why did it do this?" legibility
  approval_source?: 'HUMAN' | 'POLICY';
  auto_executed?: boolean;
  policy_result_ref?: string;   // reference to policy evaluation artifact if stored
  cost_gate_decision_ref?: string;  // reference to cost/budget gate decision if stored
}
```

**Audit export job (async)**

- `POST /autonomy/audit/exports` response: `{ export_id: string; status: 'PENDING'; message?: string }`.
- `GET /autonomy/audit/exports/:export_id` response: `{ export_id: string; status: 'PENDING' | 'COMPLETED' | 'FAILED'; presigned_url?: string; expires_at?: string; error_message?: string }`.

---

## 3. Auth & Access (enterprise AuthZ contract)

**Contract (must implement):**

- **Derive `tenant_id` from JWT claims.** Prefer a **single claim key** (e.g. `custom:tenant_id`) to reduce implementation ambiguity; if using issuer/audience mapping, document it. Do **not** use `tenant_id` from query string or body for authorization.
- **Enforce account-level access:** Caller identity resolves to a set of permitted accounts (seller’s territory/accounts) **or** admin role. Use an **AccountAccessService** (or existing RBAC) to decide whether the caller may access a given `(tenant_id, account_id)`.
- **API behaviour:** Resolve tenant and permitted account set from claims; for list/get, **ignore** user-supplied tenant/account if it conflicts with claims (only return data within scope). For ledger explanation, require lookup by execution_id or action_intent_id; tenant/account are **never** accepted from query — they are derived from auth so the caller only sees data they are allowed to see.
- **Admin APIs** (config, budget, kill switches, audit export): admin-only (Cognito group or API key). Admin may act on any tenant/account within their scope; still log `changed_by` and scope.
- **Ledger explanation:** Scoped by resolved tenant and permitted accounts; caller must be authorized for the account that owns the execution/intent.
- **CORS:** Configure for cc-dealmind origin.

---

## 4. CDK / Infrastructure

- **API Gateway:** Routes under `/autonomy` (or chosen prefix); authorizer (Cognito or IAM); CORS.
- **Lambda:** Handlers for each endpoint (or one handler with router); call AutonomyModeService, AutonomyBudgetService, KillSwitchService, Ledger/outcome stores.
- **Phase 4:** Execution Status API may be extended for "Autopilot did X" timeline (same API or new endpoint); ensure outcome records include `auto_executed` and policy explanation refs.

---

## 5. Test Strategy (placeholder)

Unit tests for API handlers (config, budget, ledger explanation). Integration tests for Ledger explanation API with real ledger/outcome data (optional). Formal test plan after implementation.

---

## 6. Enterprise requirements (checklist)

**Before freezing 5.6:**

| # | Requirement | Section |
|---|-------------|---------|
| 1 | **AuthZ:** Derive tenant from JWT; enforce account access via RBAC/AccountAccessService; never trust query/body tenant/account for auth | §3 |
| 2 | **Audit export:** Async pattern (POST exports → job → S3; GET exports/:id → status + presigned URL); or sync with capped window + pagination | §1 |
| 3 | **Canonical identifiers:** Ledger explanation primary key execution_id; secondary action_intent_id → latest execution; require tenant+account from auth only | §1 |

**Recommended (medium priority):**

| # | Requirement | Section |
|---|-------------|---------|
| 4 | Config changes: ledger record + optional optimistic concurrency (updated_at / if_match) | §1 |
| 5 | “Remaining today”: UTC time basis; remaining = config − state; document defaults when no config | §1 |
| 6 | Ledger explanation: include approval_source, auto_executed, policy/cost gate refs | §2 |
| 7 | All list endpoints: limit, next_token, deterministic ordering | §1 |

---

## 7. Optional tightenings (non-blocking)

These improve clarity and safety; you can ship 5.6 without them and add later.

| # | Tightening | Notes |
|---|------------|--------|
| **A** | **Claim key for tenant_id** | Lock a single JWT claim key (e.g. `custom:tenant_id`) in implementation so all callers and docs use the same name; reduces ambiguity. §3 already prefers "single claim key." |
| **B** | **Export format contracts** | Document CSV column schema version, default ordering, and max range per export (even for async). §1 audit export now references these; add concrete schema version when implementing. |
| **C** | **Rate limiting on exports** | Per-tenant export cap (e.g. N exports per hour) to prevent abuse. §1 audit export now mentions rate limiting; wire in implementation. |

---

## References

- Parent: [PHASE_5_CODE_LEVEL_PLAN.md](PHASE_5_CODE_LEVEL_PLAN.md)
- Implementation Plan: [PHASE_5_IMPLEMENTATION_PLAN.md](PHASE_5_IMPLEMENTATION_PLAN.md) EPIC 5.6
- Phase 4 Status API: `../phase_4/PHASE_4_4_CODE_LEVEL_PLAN.md`
- Phase 4 KillSwitch: `../phase_4/PHASE_4_1_CODE_LEVEL_PLAN.md` (KillSwitchService)
