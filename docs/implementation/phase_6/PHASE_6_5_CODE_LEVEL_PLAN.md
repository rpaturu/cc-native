# Phase 6.5 — Cross-Plan Conflict Resolution — Code-Level Plan

**Status:** 🟢 **COMPLETE**  
**Created:** 2026-01-28  
**Last Updated:** 2026-01-28  
**Parent:** [PHASE_6_CODE_LEVEL_PLAN.md](PHASE_6_CODE_LEVEL_PLAN.md)  
**Canonical contract:** [PHASE_6_IMPLEMENTATION_PLAN.md](PHASE_6_IMPLEMENTATION_PLAN.md) EPIC 6.5, Stories 6.5.1–6.5.2  
**Prerequisites:** Phase 6.1 (Policy Gate, PlanPolicyGateInput.existing_active_plan_ids, CONFLICT_ACTIVE_PLAN); Phase 6.2 (plan types); Phase 6.3 (orchestrator); Phase 6.4 (Plans API). PlanPolicyGateService.evaluateCanActivate and callers (resume, orchestrator) may already supply existing ACTIVE plan IDs; 6.5 formalizes and audits the invariant.

---

## Overview

Phase 6.5 enforces the **conflict-resolution invariant**: at most **one ACTIVE plan per (tenant_id, account_id, plan_type)**. When a second plan would become ACTIVE for the same scope, the system **rejects** (returns clear reason); queueing is out of scope. Violations are deterministic and auditable.

**Deliverables:**
- **Invariant:** One ACTIVE plan per (tenant_id, account_id, plan_type). Reject APPROVED→ACTIVE and PAUSED→ACTIVE when another ACTIVE plan exists for that scope.
- **Policy Gate:** Already returns `can_activate: false` with reason `CONFLICT_ACTIVE_PLAN` when `existing_active_plan_ids` (excluding current plan) is non-empty. No change to Policy Gate logic; ensure callers **always** pass correct `existing_active_plan_ids`.
- **Callers:** plan-lifecycle-api-handler (resume) and PlanOrchestratorService (activate) must supply `existing_active_plan_ids` from repo; on `can_activate: false` with CONFLICT_ACTIVE_PLAN, reject (**409 Conflict** for resume; skip activate for orchestrator) and write Plan Ledger event for audit.
- **Audit (baseline):** Plan Ledger event when conflict rejection occurs (e.g. `PLAN_ACTIVATION_REJECTED`); payload includes conflicting_plan_ids and caller. Completes explainability story (6.4: "why did this stop?" → 6.5: "why didn’t this activate?").

**Optional (Story 6.5.2):** Extended rules (e.g. one ACTIVE per account globally, priority, preemption) only after 6.5.1 is stable; can be minimal or deferred.

---

## 1. Invariant (Architecture)

**Rule:** For a given (tenant_id, account_id, plan_type), at most one plan may be in status **ACTIVE** at any time.

**Enforcement:**
- **Approval → ACTIVE:** Orchestrator (or manual approve+activate flow) calls Policy Gate with `existing_active_plan_ids` = list of ACTIVE plan IDs for (tenant, account, plan_type). If another ACTIVE exists, Policy Gate returns `can_activate: false`, reason `CONFLICT_ACTIVE_PLAN`; orchestrator does **not** call transition(ACTIVE).
- **Paused → ACTIVE (resume):** plan-lifecycle-api-handler calls `PlanRepositoryService.listActivePlansForAccountAndType(tenantId, accountId, plan.plan_type)` (or equivalent) and passes `existing_active_plan_ids` to the gate. Policy Gate returns `can_activate: false` when conflict; handler returns **409 Conflict** with `{ error: 'Conflict', reasons: result.reasons }` and does **not** call transition(ACTIVE).

**Reject, do not queue:** Phase 6 baseline is reject with reason. No queueing of a second plan; violations are deterministic and logged.

---

## 2. PlanPolicyGateService (Existing)

**File:** `src/services/plan/PlanPolicyGateService.ts`

**Current behavior (6.1):**
- `evaluateCanActivate(input: PlanPolicyGateInput)` uses `existing_active_plan_ids` (default `[]`).
- Other active = `(existing_active_plan_ids || []).filter(id => id !== plan.plan_id)`.
- If `otherActive.length > 0`, push reason `CONFLICT_ACTIVE_PLAN` and return `can_activate: false`.

**6.5:** No change to Policy Gate logic. Ensure:
- Reason message is clear (e.g. "Another ACTIVE plan exists for same account and plan type: &lt;ids&gt;").
- Callers never omit `existing_active_plan_ids` when evaluating APPROVED→ACTIVE or PAUSED→ACTIVE for the same (tenant, account, plan_type).
- **Self-conflict:** The gate filters `existing_active_plan_ids.filter(id => id !== plan.plan_id)` so the plan’s own id does not cause a false conflict. Orchestrator may include the plan’s own id in the list; filtering makes it harmless.

---

## 3. PlanRepositoryService — Conflict Lookup (Consistent)

**File:** `src/services/plan/PlanRepositoryService.ts`

**Requirement:** Both resume and orchestrator must use the **same** source of truth for "ACTIVE plan IDs for (tenant_id, account_id, plan_type)" so behavior cannot drift (e.g. different limits, pagination, partial results).

**Option A (recommended):** Add one method used by both callers:

- **listActivePlansForAccountAndType(tenantId, accountId, planType): Promise&lt;string[]&gt;** (returns `plan_id[]`)  
  Returns all plan_id values for plans in status ACTIVE with that (tenant_id, account_id, plan_type). May be implemented as listPlansByTenantAndStatus(tenantId, 'ACTIVE', limit) then filter by account_id and plan_type; use a sufficiently high limit or paginate until exhausted so no conflict is missed.

**Option B (if no new method):** Document a **hard requirement**: orchestrator’s getActivePlanIdsForAccount (or equivalent) must either paginate until it finds a conflict or exhausts results, or use a fixed limit high enough that missing an ACTIVE plan for the same scope is impossible in practice. Resume may keep using existsActivePlanForAccountAndType only if it is defined to be consistent with that behavior (e.g. same underlying query and limit).

**6.5:** Prefer Option A. Resume and orchestrator both call `listActivePlansForAccountAndType` and pass the returned array (excluding the current plan’s id when building Policy Gate input) so the gate sees the same set of "other" ACTIVE plans. Existing `existsActivePlanForAccountAndType` can remain for backward compatibility or be implemented in terms of listActivePlansForAccountAndType (e.g. return { exists: ids.length > 0, planId: ids[0] }).

---

## 4. plan-lifecycle-api-handler — Resume (Existing / Verify)

**File:** `src/handlers/phase6/plan-lifecycle-api-handler.ts`

**Current behavior (6.1):** Resume loads plan; if not PAUSED returns 400; obtains existing ACTIVE plan IDs (e.g. via existsActivePlanForAccountAndType or listActivePlansForAccountAndType); calls gate.evaluateCanActivate; if !can_activate returns error; else calls transition(ACTIVE).

**6.5 (tightened):**
- **Conflict lookup:** Use `repo.listActivePlansForAccountAndType(tenantId, accountId, plan.plan_type)` (or existing existsActivePlanForAccountAndType if kept and consistent). Pass returned IDs as `existing_active_plan_ids` to the gate.
- **Response when conflict:** Return **409 Conflict** (not 400) with body `{ error: 'Conflict', reasons: result.reasons }`. Gives clients a stable, semantic signal.
- **Audit:** When rejecting due to CONFLICT_ACTIVE_PLAN, write Plan Ledger event (see §6) **before** returning 409. Do **not** call transition(ACTIVE).

---

## 5. PlanOrchestratorService — Activate (Existing / Verify)

**File:** `src/services/plan/PlanOrchestratorService.ts`

**Current behavior (6.3):**
- For each APPROVED plan, call `gate.evaluateCanActivate({ plan, tenant_id, account_id, existing_active_plan_ids: await this.getActivePlanIdsForAccount(tenantId, plan.account_id, plan.plan_type), preconditions_met: true })`.
- `getActivePlanIdsForAccount` returns plan_id list for ACTIVE plans with same account_id and plan_type.
- If `can.can_activate` then `lifecycle.transition(plan, 'ACTIVE')`; else skip (no transition).

**6.5:** When evaluateCanActivate returns `can_activate: false` with CONFLICT_ACTIVE_PLAN, orchestrator must **not** call transition(ACTIVE). Orchestrator **must** append PLAN_ACTIVATION_REJECTED to the Plan Ledger when activation is skipped due to conflict (plan_id, account_id, plan_type, conflicting_plan_ids, caller `orchestrator`). This ensures the UI can explain both resume and orchestrator rejections from the ledger.

---

## 6. Audit — Plan Ledger (6.5 Baseline)

**Requirement:** When a transition to ACTIVE is **rejected** due to CONFLICT_ACTIVE_PLAN, the decision must be auditable. Given 6.4’s explainability story ("why did this plan stop?"), conflict rejection should be visible in the same place: **Plan Ledger**.

**Baseline for 6.5:**
- **Event type:** e.g. `PLAN_ACTIVATION_REJECTED` (or `CONFLICT_REJECTED`). Append-only; no mutation or deletion.
- **Payload:** plan_id (the plan that was **not** activated), account_id, tenant_id, plan_type, **conflicting_plan_ids** (list of ACTIVE plan IDs for same scope), **caller** (e.g. `resume` | `orchestrator`), timestamp, and optionally reason code `CONFLICT_ACTIVE_PLAN`.
- **conflicting_plan_ids ordering:** Returned in **stable order** (e.g. sorted ascending by plan_id, or by created_at if available). Deterministic ordering improves UI and test assertions.
- **Emitter:** plan-lifecycle-api-handler (resume) and PlanOrchestratorService (orchestrator) **both must** write this event when they reject/skip activation due to CONFLICT_ACTIVE_PLAN.

This completes the visibility story: UI can answer "why didn’t this plan activate?" from the ledger without log digging.

**Optional:** Structured log at info/warn in addition to Ledger (same fields).

---

## 7. Implementation Tasks (Checklist)

1. **Policy Gate:** No change. evaluateCanActivate returns CONFLICT_ACTIVE_PLAN when existing_active_plan_ids (excluding current plan) is non-empty; message is clear. Filter `id !== plan.plan_id` prevents self-conflict.
2. **PlanRepositoryService:** Add `listActivePlansForAccountAndType(tenantId, accountId, planType): Promise<string[]>` (or document hard limit/pagination requirement). Resume and orchestrator both use it for conflict lookup.
3. **Resume handler:** Use listActivePlansForAccountAndType (or consistent method); pass existing_active_plan_ids to gate. When !can_activate with CONFLICT_ACTIVE_PLAN: write Plan Ledger event PLAN_ACTIVATION_REJECTED; return **409 Conflict** with `{ error: 'Conflict', reasons: result.reasons }`; do not call transition(ACTIVE).
4. **Orchestrator:** Use same listActivePlansForAccountAndType (or getActivePlanIdsForAccount backed by it). When can_activate is false: write Plan Ledger event PLAN_ACTIVATION_REJECTED; do not call transition(ACTIVE).
5. **Plan Ledger:** Emit PLAN_ACTIVATION_REJECTED (or CONFLICT_REJECTED) with payload: plan_id, account_id, tenant_id, plan_type, conflicting_plan_ids, caller, timestamp.
6. **Tests:** Unit tests for resume **409** and reasons; orchestrator skip-activate; Policy Gate CONFLICT_ACTIVE_PLAN. Integration test: assert 409 and CONFLICT_ACTIVE_PLAN. See PHASE_6_5_TEST_PLAN.md.

---

## 8. Test Strategy

- **Unit:** PlanPolicyGateService — CONFLICT_ACTIVE_PLAN when existing_active_plan_ids has other plan(s) (already covered). plan-lifecycle-api-handler — resume: when conflict lookup returns other plan(s), evaluateCanActivate returns can_activate false with CONFLICT_ACTIVE_PLAN, assert **409 Conflict** and reasons, transition NOT called. PlanOrchestratorService — when getActivePlanIdsForAccount returns other plan IDs, evaluateCanActivate returns can_activate false, transition(ACTIVE) NOT called.
- **Integration (optional):** Seed two APPROVED plans same account+plan_type; run orchestrator once to activate first; run again and assert second is not activated; or call resume for second plan (after pausing first) and assert **409 Conflict** when first is ACTIVE.

---

## 9. Implementation Complete (Summary)

- **PlanRepositoryService:** `listActivePlansForAccountAndType(tenantId, accountId, planType)` implemented; returns sorted `plan_id[]`. `existsActivePlanForAccountAndType` uses it.
- **Plan Ledger:** `PLAN_ACTIVATION_REJECTED` added to ledger types; payload includes `conflicting_plan_ids` (sorted), `caller` (`resume` | `orchestrator`), `reason_code: 'CONFLICT_ACTIVE_PLAN'`.
- **Resume handler:** Uses `repo.listActivePlansForAccountAndType`; on conflict returns **409 Conflict** with `body.error === 'Conflict'`; appends PLAN_ACTIVATION_REJECTED before returning.
- **Orchestrator:** Uses `repo.listActivePlansForAccountAndType` in runCycle; on `can_activate: false` with CONFLICT_ACTIVE_PLAN appends PLAN_ACTIVATION_REJECTED; does not call transition(ACTIVE).
- **Tests:** Unit tests (resume 409/ledger, orchestrator skip/ledger, Policy Gate self-conflict); integration test `conflict-resolution.test.ts` asserts 409 and CONFLICT_ACTIVE_PLAN. See [PHASE_6_5_TEST_PLAN.md](testing/PHASE_6_5_TEST_PLAN.md).

---

## 10. References

- Parent: [PHASE_6_CODE_LEVEL_PLAN.md](PHASE_6_CODE_LEVEL_PLAN.md)
- Canonical contract: [PHASE_6_IMPLEMENTATION_PLAN.md](PHASE_6_IMPLEMENTATION_PLAN.md) EPIC 6.5
- Policy Gate types: `src/types/plan/PlanPolicyGateTypes.ts` (PlanPolicyGateInput.existing_active_plan_ids, PlanPolicyGateReasonCode.CONFLICT_ACTIVE_PLAN)
- Phase 6.1 Policy Gate: [PHASE_6_1_CODE_LEVEL_PLAN.md](PHASE_6_1_CODE_LEVEL_PLAN.md) §2
- Phase 6.3 orchestrator: [PHASE_6_3_CODE_LEVEL_PLAN.md](PHASE_6_3_CODE_LEVEL_PLAN.md)
