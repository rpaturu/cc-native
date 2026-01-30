# Phase 5.6 — Autonomy Control Center: Code-Level Plan

**Status:** 🟡 **PLANNING**  
**Created:** 2026-01-28  
**Last Updated:** 2026-01-28  
**Parent:** [PHASE_5_CODE_LEVEL_PLAN.md](PHASE_5_CODE_LEVEL_PLAN.md)

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

**Autonomy config**

- `GET /autonomy/config?tenant_id=...&account_id=...` — list configs (mode per action type / default).
- `PUT /autonomy/config` — create/update AutonomyModeConfigV1 (admin).
- `GET /autonomy/config/:id` — get one config (optional).

**Autonomy budget**

- `GET /autonomy/budget?tenant_id=...&account_id=...` — get budget config and current state (e.g. remaining today).
- `PUT /autonomy/budget` — create/update AutonomyBudgetV1 (admin).

**Kill switches**

- Use Phase 4 KillSwitchService; expose `GET /autonomy/kill-switches` (or equivalent) for global/tenant state.
- `PUT /autonomy/kill-switches` (admin) to toggle; audit logged.

**Audit export**

- `GET /autonomy/audit?tenant_id=...&from=...&to=...` — export audit events (ledger, config changes, auto-execute events) for compliance. Pagination and format (JSON/CSV) as needed.

**Ledger-first APIs**

- `GET /autonomy/ledger/explanation?execution_id=...` (or by action_intent_id + account_id) — returns:
  - **Why did the system do this?** — trigger, policy decision, reason/explanation.
  - **What did it know at the time?** — snapshot of context (signals, posture, intent) at decision/execution time if available.
  - **Which policy allowed it?** — policy_version, policy_clause, AutoApprovalPolicyResultV1 fields.
- Data from Ledger (Phase 4) + execution outcomes + AutoApprovalPolicyResultV1 stored at execution time.

---

## 2. Data Shapes (API responses)

**Ledger explanation response (example)**

```typescript
export interface LedgerExplanationV1 {
  execution_id: string;       // or action_intent_id
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
}
```

---

## 3. Auth & Access

- **Admin APIs** (config, budget, kill switches, audit export): admin-only (Cognito group or API key).
- **Ledger explanation:** Scoped by tenant_id/account_id; caller must be authorized for that account (e.g. seller or admin).
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

## References

- Parent: [PHASE_5_CODE_LEVEL_PLAN.md](PHASE_5_CODE_LEVEL_PLAN.md)
- Implementation Plan: [PHASE_5_IMPLEMENTATION_PLAN.md](PHASE_5_IMPLEMENTATION_PLAN.md) EPIC 5.6
- Phase 4 Status API: `../phase_4/PHASE_4_4_CODE_LEVEL_PLAN.md`
- Phase 4 KillSwitch: `../phase_4/PHASE_4_1_CODE_LEVEL_PLAN.md` (KillSwitchService)
