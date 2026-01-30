# Phase 5.4 — Autonomous Execution: Code-Level Plan

**Status:** 🟡 **PLANNING**  
**Created:** 2026-01-28  
**Last Updated:** 2026-01-28  
**Parent:** [PHASE_5_CODE_LEVEL_PLAN.md](PHASE_5_CODE_LEVEL_PLAN.md)

---

## Overview

Phase 5.4 implements the **auto-execute pipeline**: when AutoApprovalPolicy returns AUTO_EXECUTE and AutonomyBudget allows, the system flows directly into Phase 4 execution **without** human approval.

- **Placement:** After Phase 3 decision, after AutoApprovalPolicyV1 (AUTO_EXECUTE), after AutonomyBudgetService.checkAndConsume(true).
- **Constraint:** Only whitelisted action types auto-execute; auto-execution events are clearly labeled in UI and ledger.
- **Idempotency:** Auto-executed actions must be idempotent or protected by execution-level deduplication (Phase 4 guarantees).

**Dependencies:** Phase 5.1 (policy + budget); Phase 3 (ActionIntentV1); Phase 4 (execution path, EventBridge ACTION_APPROVED, Step Functions).

---

## Implementation Tasks

1. Auto-execute pipeline (policy AUTO_EXECUTE + budget check → Phase 4; skip human approval path)
2. Idempotency / deduplication alignment with Phase 4

---

## 1. Contract: When to Auto-Execute

**Preconditions (all must hold):**

1. Phase 3 has produced ActionIntentV1 (with confidence score, risk_level, action_type).
2. AutonomyModeConfigV1 for tenant/account/action_type allows AUTO_EXECUTE (or tenant default).
3. AutoApprovalPolicyEngine.evaluate(...) returns decision === AUTO_EXECUTE with reason/explanation.
4. AutonomyBudgetService.checkAndConsume(tenant_id, account_id, action_type) returns true (budget available and consumed).

**Then:** Emit ACTION_APPROVED (or equivalent) and trigger Phase 4 execution **without** presenting to human approval UI. Mark the execution as **auto_executed: true** in ledger and in outcome so UI can show "Autopilot did X".

---

## 2. Integration Points

**Phase 3 → Phase 5.4 gate:**

- After Phase 3 creates ActionIntentV1, the orchestration layer (e.g. Step Functions or Lambda) must:
  1. Resolve autonomy mode (5.1).
  2. Call AutoApprovalPolicyEngine (5.1).
  3. If AUTO_EXECUTE, call AutonomyBudgetService.checkAndConsume (5.1).
  4. If all pass, trigger Phase 4 (e.g. put ACTION_APPROVED to EventBridge with a flag `auto_executed: true` or equivalent).

**Phase 4:**

- Execution path (Step Functions, execution-starter, tool-invoker, execution-recorder) is **unchanged**. Phase 4 already accepts ACTION_APPROVED and executes. The only difference is the **source** of approval (human vs policy+budget).
- ExecutionRecorder (or equivalent) must persist `auto_executed: true` when the intent was auto-approved, so ledger and Status API can expose "Autopilot did X".

**Idempotency:**

- Phase 4 already provides execution-level deduplication (ExecutionAttempt, idempotency keys). Auto-executed actions use the same path; no new idempotency layer. Sub-phase plan must **not** introduce duplicate execution for the same action_intent_id.

---

## 3. Type / Event Shape Additions

**ACTION_APPROVED (or equivalent) detail extension:**

- Add optional `auto_executed?: boolean` (true when approval came from policy+budget, not human).
- Downstream handlers (execution-recorder, status API) use this to label outcomes for UI and ledger.

**Ledger / Outcome:**

- ActionOutcomeV1 or ledger event should include `auto_executed: true` when applicable, so "Autopilot did X" timeline can filter or display it.

---

## 4. File / Component Ownership

- **Orchestration that gates auto-execute:** New or extended Lambda/Step (e.g. `auto-approval-gate-handler`) that runs after Phase 3 and calls 5.1 services, then either routes to human approval or triggers Phase 4 with `auto_executed: true`. Location: `src/handlers/phase5/` or equivalent.
- **Phase 4 changes:** Minimal: accept `auto_executed` on input; pass through to recorder/outcome. No change to execution logic itself.
- **Recorder/Outcome:** Persist `auto_executed` in outcome record and/or ledger (see Phase 4.4 outcome shape; add optional field).

---

## 5. Test Strategy (placeholder)

Unit tests for auto-execute gate (policy AUTO_EXECUTE + budget true → Phase 4 triggered; policy BLOCK or budget false → no Phase 4 or route to approval). Integration test: auto-execute path from intent to outcome with `auto_executed: true` (optional). Formal test plan after implementation.

---

## References

- Parent: [PHASE_5_CODE_LEVEL_PLAN.md](PHASE_5_CODE_LEVEL_PLAN.md)
- Implementation Plan: [PHASE_5_IMPLEMENTATION_PLAN.md](PHASE_5_IMPLEMENTATION_PLAN.md) EPIC 5.4, Story 5.4.1
- Phase 4 execution: `../phase_4/PHASE_4_2_CODE_LEVEL_PLAN.md`, `PHASE_4_CODE_LEVEL_PLAN.md`
