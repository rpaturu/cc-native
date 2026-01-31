# Phase 5.4 — Autonomous Execution: Code-Level Plan

**Status:** 🟢 **COMPLETE** (implementation done; unit tests; gate wired in CDK)  
**Created:** 2026-01-28  
**Last Updated:** 2026-01-28  
**Parent:** [PHASE_5_CODE_LEVEL_PLAN.md](PHASE_5_CODE_LEVEL_PLAN.md)

---

## Overview

Phase 5.4 implements the **auto-execute pipeline**: when AutoApprovalPolicy returns AUTO_EXECUTE and AutonomyBudget allows, the system flows directly into Phase 4 execution **without** human approval.

- **Placement:** After Phase 3 decision, after AutoApprovalPolicyV1 (AUTO_EXECUTE), after AutonomyBudgetService.checkAndConsume(true).
- **Constraint:** Only **allowlisted** action types auto-execute (enforced in code via AutoExecuteAllowListV1); auto-execution events are clearly labeled in UI and ledger via `approval_source` and `auto_executed`.
- **Idempotency:** Gate handler is idempotent on `action_intent_id`; budget is consumed only once per intent; no double charge under retries (see § Atomicity below). Phase 4 execution-level deduplication unchanged.

**Dependencies:** Phase 5.1 (policy + budget); Phase 3 (ActionIntentV1); Phase 4 (execution path, EventBridge ACTION_APPROVED, Step Functions).

**Implemented in 5.1 (for 5.4 use):** `src/services/autonomy/AutonomyModeService.ts`, `AutoApprovalPolicyEngine.ts`, `AutonomyBudgetService.ts` (API: `checkAndConsume(tenantId, accountId, actionType)`), `src/types/autonomy/AutonomyTypes.ts`. Phase 4: `src/handlers/phase4/execution-starter-handler.ts`, `execution-recorder-handler.ts`; `src/services/execution/ExecutionOutcomeService.ts`; `src/types/ExecutionTypes.ts` (ActionOutcomeV1).

---

## Implementation Tasks

1. Allowlist enforcement (AutoExecuteAllowListV1; gate handler checks before policy/budget)
2. Auto-execute pipeline (policy AUTO_EXECUTE + budget check → Phase 4; skip human approval path)
3. Idempotency + no double budget consume under retries (AUTO_EXEC_STATE or equivalent)
4. Event/outcome: `approval_source` + `auto_executed`; budget-fail → REQUIRE_APPROVAL

---

## 1. Contract: When to Auto-Execute

**Preconditions (all must hold, in order):**

1. Phase 3 has produced ActionIntentV1 (with confidence score, risk_level, action_type).
2. **Allowlist:** `action_type` is in AutoExecuteAllowListV1 for tenant (or account). If not → **REQUIRE_APPROVAL** (reason: `ACTION_TYPE_NOT_ALLOWLISTED`); do not call policy/budget.
3. AutonomyModeConfigV1 for tenant/account/action_type allows AUTO_EXECUTE (or tenant default).
4. AutoApprovalPolicyEngine.evaluate(...) returns decision === AUTO_EXECUTE with reason/explanation.
5. AutonomyBudgetService.checkAndConsume(tenant_id, account_id, action_type) returns true (budget available and consumed). **If false → REQUIRE_APPROVAL** (never silent defer); do not consume budget on failure to start Phase 4.

**Then:** Emit ACTION_APPROVED with **`approval_source: 'POLICY'`** and `auto_executed: true`, and trigger Phase 4. Mark the execution in ledger and outcome so UI can show "Autopilot did X". (Use `'POLICY'` as the canonical value; `auto_executed: true` conveys "autopilot executed.")

**Budget failure behavior (required):** Budget check fails → route to **REQUIRE_APPROVAL** (human approval path). Never silent defer. Aligns with trust model: autonomy is bounded; non-autonomy is still helpful.

---

## 2. Integration Points

**Phase 3 → Phase 5.4 gate (order matters):**

1. **Allowlist (first):** Check action_type against AutoExecuteAllowListV1. If not allowlisted → REQUIRE_APPROVAL, reason `ACTION_TYPE_NOT_ALLOWLISTED`; stop.
2. Resolve autonomy mode (5.1).
3. Call AutoApprovalPolicyEngine (5.1). If not AUTO_EXECUTE → REQUIRE_APPROVAL.
4. **Idempotency guard:** Check AUTO_EXEC_STATE for this action_intent_id (see § Atomicity below). **If PUBLISHED** → skip consume and skip publish; return success (idempotent). **If RESERVED** → skip consume (do not double-consume); **retry publish** idempotently; on success set state to PUBLISHED.
5. Call AutonomyBudgetService.checkAndConsume (5.1). **If false → REQUIRE_APPROVAL** (do not consume; never silent defer).
6. Record AUTO_EXEC_STATE for this action_intent_id as RESERVED.
7. Publish ACTION_APPROVED to EventBridge with `approval_source: 'POLICY'` and `auto_executed: true`. On success, set state to PUBLISHED. If publish fails → retry sees RESERVED (step 4), retries publish only (no double-consume).

**Phase 4:**

- Execution path is **unchanged**. Phase 4 accepts ACTION_APPROVED and executes. ExecutionRecorder persists `approval_source` and `auto_executed` when the intent was auto-approved, so ledger and Status API can expose "Autopilot did X".

**Idempotency:**

- **Gate:** Idempotent on `action_intent_id` via AUTO_EXEC_STATE. **PUBLISHED** → skip consume and skip publish. **RESERVED** → skip consume (no double-consume); retry publish until success, then mark PUBLISHED. Retry after publish failure never double-consumes.
- **Phase 4:** Unchanged; execution-level deduplication (ExecutionAttempt, idempotency keys) as today. No second idempotency layer for auto-execute.

---

## 3. Type / Event Shape Additions

**ACTION_APPROVED event detail (EventBridge):**

- Extend `Detail.data` with:
  - **`approval_source: 'HUMAN' | 'POLICY'`** — categorical; required for analytics and future expansions (e.g. manager approval). Human approval path sets `'HUMAN'`; auto-approval gate sets **`'POLICY'`** (frozen; do not use `'AUTO'`).
  - **`auto_executed?: boolean`** — convenience boolean (true when approval_source is `'POLICY'`).
- Current shape: `data: { action_intent_id, tenant_id, account_id }` (see `decision-api-handler.ts`). Add both fields when the auto-approval gate triggers Phase 4; human path adds `approval_source: 'HUMAN'`, `auto_executed: false` (or omit).
- Execution-starter and execution-recorder must accept and pass through both so the outcome record can persist them.

**Outcome type (Phase 4):**

- **ActionOutcomeV1** in `src/types/ExecutionTypes.ts`: add optional **`approval_source?: 'HUMAN' | 'POLICY'`** and **`auto_executed?: boolean`**. ExecutionRecorder must persist both when present. **Immutable once written** (history does not rewrite).

---

## 4. Atomicity: No Double Budget Consume Under Retries

**Required contract:**

- Gate handler is **idempotent on `action_intent_id`**.
- Budget is consumed only when the intent is **not** already in AUTO_EXEC_STATE (RESERVED or PUBLISHED).
- If EventBridge publish fails after budget consume, a **retry** must see existing state and **not** call checkAndConsume again.

**Minimal approach:**

- **AUTO_EXEC_STATE** store (DDB or existing idempotency table): key `AUTO_EXEC_STATE#<action_intent_id>`, status `RESERVED` | `PUBLISHED`. **TTL: 30–90 days** (for incident debug and audit; do not retain forever).
  - **First run:** Check state; if absent, call checkAndConsume; if true, write RESERVED; then publish; on success write PUBLISHED.
  - **On retry:** **If PUBLISHED** → skip checkAndConsume and skip publish; return success. **If RESERVED** → skip checkAndConsume (no double-consume); **retry publish** idempotently until it succeeds; on success write PUBLISHED. RESERVED thus allows republish; PUBLISHED means done.
- Alternatively: conditional update on budget state keyed by (date, action_type) plus a separate idempotency store keyed by action_intent_id, so "consume" is only applied when idempotency key does not exist.

**Do not consume budget if Phase 4 fails to start** (e.g. publish fails). Consume only after commit to publish (or use RESERVED + PUBLISHED so retry does not double-consume).

---

## 5. Allowlist Enforcement (Required)

- **Type:** `AutoExecuteAllowListV1` — config or DDB; per tenant (or tenant+account); list of `action_type` values that may auto-execute.
- **Enforcement:** In the **auto-approval gate handler**, **before** calling AutonomyModeService / AutoApprovalPolicyEngine / AutonomyBudgetService. If `action_type` is not in the allowlist → **REQUIRE_APPROVAL**, reason **`ACTION_TYPE_NOT_ALLOWLISTED`**; log and return. Cheap early reject; policy can be permissive by mistake, allowlist is the hard stop for blast radius.

---

## 6. File / Component Ownership

- **Allowlist:** Type and store (e.g. `src/types/autonomy/AutonomyTypes.ts` + DDB config table or existing autonomy config). Resolve in gate handler before policy/budget.
- **Gate:** New Lambda (e.g. `src/handlers/phase5/auto-approval-gate-handler.ts`): allowlist check → mode → policy → budget (with idempotency so no double consume) → publish ACTION_APPROVED with `approval_source: 'POLICY'`, `auto_executed: true`; on budget or policy fail → REQUIRE_APPROVAL.
- **Phase 4:** Execution-starter and execution-recorder accept `approval_source` and `auto_executed` from event/context; pass through to ExecutionOutcomeService. Outcome type: `src/types/ExecutionTypes.ts` (ActionOutcomeV1) — add optional `approval_source?: 'HUMAN' | 'POLICY'`, `auto_executed?: boolean` (immutable once written).
- **Recorder/Outcome:** `src/handlers/phase4/execution-recorder-handler.ts` and `ExecutionOutcomeService.recordOutcome` persist both fields in the outcome record.

---

## 7. Additional Improvements (Recommended)

- **Outcome/ledger schema:** `approval_source` and `auto_executed` are **immutable once written**; part of the "history does not rewrite" contract.
- **Gate in Step Functions:** If Phase 3 already sits in Step Functions, consider implementing the gate as a **Step Functions branch** (resolve mode → evaluate policy → budget check → publish event). This makes the flow replayable, observable, and consistent with Phase 4 spine tooling. Not required — Lambda gate is fine.

---

## 8. Test Strategy (placeholder)

Unit tests: allowlist reject (ACTION_TYPE_NOT_ALLOWLISTED); policy AUTO_EXECUTE + budget true → Phase 4 triggered; policy BLOCK or budget false → REQUIRE_APPROVAL; idempotency (retry after RESERVED/PUBLISHED does not double-consume). Integration test: auto-execute path from intent to outcome with `approval_source` and `auto_executed` (optional). Formal test plan after implementation.

---

## Implementation Complete (2026-01-28)

- **Types:** AutoExecuteAllowListV1, AutoExecStateV1 (AutonomyTypes); approval_source, auto_executed on ActionOutcomeV1 (ExecutionTypes); optional confidence_score, risk_level on ActionIntentV1 (DecisionTypes).
- **Services:** AutoExecuteAllowListService, AutoExecStateService (allowlist + AUTO_EXEC_STATE in autonomy config table).
- **Handler:** `src/handlers/phase5/auto-approval-gate-handler.ts` (allowlist → mode → policy → idempotency guard → budget → RESERVED → publish → PUBLISHED).
- **Phase 4 pass-through:** decision-api-handler (approve path) sets approval_source HUMAN, auto_executed false; EventBridge → Step Functions input includes approval_source, auto_executed; execution-starter and execution-recorder pass through; ExecutionOutcomeService persists both.
- **Infrastructure:** AutonomyInfrastructure creates auto-approval-gate Lambda when actionIntentTable + eventBus provided; autonomy config table TTL enabled for AUTO_EXEC_STATE.
- **Tests:** Unit tests for AutoExecuteAllowListService, AutoExecStateService, auto-approval-gate-handler (missing input, intent not found, allowlist reject).

**Trigger:** Gate is invoked with `{ action_intent_id, tenant_id, account_id }`. Caller (e.g. Phase 3 or orchestration) is responsible for creating the intent and invoking the gate; EventBridge rule or API can be added separately.

---

## References

- Parent: [PHASE_5_CODE_LEVEL_PLAN.md](PHASE_5_CODE_LEVEL_PLAN.md)
- Implementation Plan: [PHASE_5_IMPLEMENTATION_PLAN.md](PHASE_5_IMPLEMENTATION_PLAN.md) EPIC 5.4, Story 5.4.1
- Phase 4 execution: `../phase_4/PHASE_4_2_CODE_LEVEL_PLAN.md`, `PHASE_4_CODE_LEVEL_PLAN.md`
