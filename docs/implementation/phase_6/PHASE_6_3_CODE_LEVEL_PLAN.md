# Phase 6.3 — Plan Orchestration Over Time: Code-Level Plan

**Status:** 🟢 **IMPLEMENTED**  
**Created:** 2026-01-28  
**Last Updated:** 2026-01-28 (review: attempt mechanism §3a, per-run bound K, step status §3b, retry→pause, SKIPPED=terminal)  
**Parent:** [PHASE_6_CODE_LEVEL_PLAN.md](PHASE_6_CODE_LEVEL_PLAN.md)  
**Canonical contract:** [PHASE_6_IMPLEMENTATION_PLAN.md](PHASE_6_IMPLEMENTATION_PLAN.md) EPIC 6.3, Stories 6.3.1–6.3.3  
**Prerequisites:** Phase 6.1 complete (schema, lifecycle, Policy Gate, ledger, API); Phase 6.2 complete (RENEWAL_DEFENSE, proposal generator). Phase 3/4 execution spine (action intents, execution, outcomes).

---

## Overview

Phase 6.3 introduces the **Plan Orchestrator** and **Plan State Evaluator**: plans that are APPROVED transition to ACTIVE when the Policy Gate returns `can_activate=true` and the scheduler picks them up; steps are executed via **Phase 3/4 only** (create action intent → approval if needed → execution → outcome); completion and expiry are evaluated by the State Evaluator; termination semantics are auditable in the Plan Ledger.

**Deliverables:**
- Plan State Evaluator: objective conditions, expiry; emit COMPLETED / EXPIRED / no change; completion reason to Plan Ledger
- Plan Orchestrator: APPROVED→ACTIVE (Policy Gate + scheduler); step execution via Phase 3/4; idempotency `(plan_id, step_id, attempt)`; retry limit N per step; adaptation (pause/retry/abort/skip)
- Scheduling: baseline = EventBridge scheduled poll + idempotency/locking (DynamoDB conditional writes or equivalent)
- Step execution state store (retry count, attempt key) — separate from plan document; ledger for step events (STEP_STARTED, STEP_COMPLETED, STEP_SKIPPED, STEP_FAILED)

**Dependencies:** Phase 6.1 (PlanRepositoryService, PlanLifecycleService, PlanPolicyGateService, PlanLedgerService); Phase 6.2 (plan type config, RENEWAL_DEFENSE); Phase 3 (ActionIntentService, decision path); Phase 4 (execution starter, Execution Status API, outcome storage).

**Out of scope for 6.3:** Event-driven triggers (step-completed); multiple plan types beyond RENEWAL_DEFENSE; new execution surface (orchestrator uses Phase 4 only). **Orchestrator is intentionally non-LLM** (deterministic advance and react).

---

## Implementation Tasks

1. Plan State Evaluator: types, service (evaluate objective + expiry; return COMPLETED | EXPIRED | no change; completion reason); RENEWAL_DEFENSE: SKIPPED counts as terminal success
2. Step execution state: store for `(plan_id, step_id, attempt)`; **single authoritative mechanism for attempt** (§3a: atomic next_attempt or equivalent); retry count from config; idempotency key; **step status transition table** (§3b) enforced in service
3. Plan Orchestrator service: **per-run bound K** (e.g. 10 plans per run); pick APPROVED plans (limit K) → Policy Gate → APPROVED→ACTIVE; pick ACTIVE plans (limit K), next PENDING step; obtain attempt (§3a); invoke Phase 3/4; on outcome consult State Evaluator; update plan/step status per §3b and ledger; retry exhaustion → **pause plan** (baseline)
4. Integration with Phase 3/4: create action intent from plan step (tenant, account, action_type, plan_id, step_id, attempt); trigger execution; poll or subscribe for outcome
5. Orchestrator Lambda handler: invoked by EventBridge schedule; idempotent run (lock or conditional write); runCycle enforces K plans per run
6. CDK: EventBridge rule (e.g. every 5–15 min), Lambda (orchestrator), env (table names, **ORCHESTRATOR_MAX_PLANS_PER_RUN**, retry limit, plan type config)
7. Unit tests: State Evaluator (all branches); Orchestrator (pick, activate, step dispatch, retry limit, pause on exhaustion); handler (schedule, idempotency)

---

## 1. Plan State Evaluator — Types and Contract

### File: `src/types/plan/PlanStateEvaluatorTypes.ts` (new)

**EvaluateResult** — what the evaluator returns (orchestrator does not embed completion/expiry logic).

```typescript
export type PlanStateEvaluatorResult =
  | { action: 'COMPLETE'; completion_reason: 'objective_met' | 'all_steps_done'; completed_at: string }
  | { action: 'EXPIRE'; expired_at: string }
  | { action: 'NO_CHANGE' };
```

**Input** — plan + optional world state for objective (6.3 baseline can be plan-only: all steps DONE ⇒ all_steps_done; now > expires_at ⇒ EXPIRE).

```typescript
export interface PlanStateEvaluatorInput {
  plan: RevenuePlanV1;
  /** Optional: for objective_met evaluation (e.g. renewal closed); 6.3 may use plan-only. */
  context?: Record<string, unknown>;
}
```

**Contract:** Deterministic: same plan + context → same result. Orchestrator **calls** evaluator; completion/expiry logic lives only in the evaluator.

---

## 2. Plan State Evaluator — Service

### File: `src/services/plan/PlanStateEvaluatorService.ts` (new)

**Responsibilities:**
- Evaluate expiry: if `now >= plan.expires_at` → return EXPIRE with expired_at.
- Evaluate completion: if all steps in terminal success state (DONE) → return COMPLETE with completion_reason `all_steps_done`; if objective condition is met (per plan type; 6.3 baseline may be “all steps done” only) → `objective_met`.
- Otherwise return NO_CHANGE.

**Methods:**
- `evaluate(input: PlanStateEvaluatorInput): Promise<PlanStateEvaluatorResult>`
  - Read plan.expires_at; if now >= expires_at → EXPIRE.
  - Read plan.steps; if every step status is DONE or SKIPPED (terminal success per plan type) → COMPLETE, completion_reason `all_steps_done`. **RENEWAL_DEFENSE (6.3): SKIPPED counts as terminal success** for completion (all steps DONE or SKIPPED ⇒ all_steps_done). Optionally check objective_met per plan type (6.3 baseline: same as all_steps_done).
  - Else → NO_CHANGE.

**Dependencies:** None (pure function of plan + optional context). No DB read/write inside evaluator.

**Ledger:** Evaluator does **not** write to Plan Ledger. Orchestrator calls evaluator; if result is COMPLETE or EXPIRE, orchestrator calls PlanLifecycleService.transition and PlanLedgerService.append (PLAN_COMPLETED / PLAN_EXPIRED).

---

## 3. Step Execution State (Retry Count and Idempotency)

Retry count is **not** stored on the plan document (6.1). It is stored in **orchestrator execution state**.

**Option A — Dedicated table: PlanStepExecutionState (or equivalent)**  
- Partition key: `plan_id` (or `pk = PLAN#<plan_id>`), Sort key: `sk = STEP#<step_id>#ATTEMPT#<attempt>`.
- Attributes: plan_id, step_id, attempt, status (STARTED | SUCCEEDED | FAILED | SKIPPED), started_at, completed_at?, outcome_id? (link to Phase 4 outcome), retry_count (number of attempts for this step).
- Idempotency: PutItem with ConditionExpression `attribute_not_exists(sk)` so (plan_id, step_id, attempt) is unique; duplicate invocations do not double-execute.

**Option B — Extend Plan Ledger or use existing idempotency store**  
- Use ledger only for audit; idempotency key `(plan_id, step_id, attempt)` in Phase 4 idempotency store or a small “plan step attempts” table.
- Retry count: derived from ledger (count STEP_STARTED for step_id) or stored in a separate row per (plan_id, step_id) with attempt_count.

**Recommendation for 6.3:** Option A — small table or GSI on existing table keyed by (plan_id, step_id) for “current attempt” and retry count; plus idempotency key (plan_id, step_id, attempt) to prevent duplicate step execution. Exact schema in CDK section below.

**Retry limit:** Per plan type (e.g. from planTypeConfig). Default N (e.g. 3). If attempt for step would exceed N → do not start step; orchestrator marks step FAILED and **pauses plan** (6.3 baseline; abort is API-driven). Write STEP_FAILED to ledger with reason (e.g. retry_limit_exceeded).

---

### 3a. Step Attempt Number — Single Authoritative Mechanism (Required)

Attempt numbers must be generated **atomically** to avoid duplicate attempt values or double execution when scheduler invocations race.

**Option A (recommended):**

- Maintain a **per-step counter row** keyed by `(plan_id, step_id)` with attribute `next_attempt` (number).
- To start a new step execution: call **UpdateItem** with `UpdateExpression: 'ADD next_attempt :one'`, `:one = 1`, and `ReturnValues: 'UPDATED_NEW'`. Use the **returned** value as `attempt`.
- Then write the idempotency row with `(plan_id, step_id, attempt)` and ConditionExpression `attribute_not_exists(sk)` so the same attempt is not written twice. If PutItem fails (condition not met), another runner already claimed this attempt — do not execute.
- **Retry count** for policy (compare to N) = `attempt - 1` for in-flight, or count of STEP_STARTED for this step_id in ledger; or store `attempt` on the counter row after each ADD.

**Option B (acceptable):**

- Derive `attempt = count(existing STEP_STARTED for step_id in ledger) + 1`, guarded by a **transaction** or conditional write so only one writer wins. Document the exact transaction boundary.

**Implementation must choose one** and enforce it in the step execution state service (or equivalent). Do not leave attempt derivation to ad-hoc logic.

---

### 3b. Step Status Transition Table (Required)

Step status changes must follow a **hard state machine** enforced in the plan/step execution service (not in the handler). Allowed transitions:

| From    | To      | Allowed | Notes |
|---------|---------|--------|-------|
| PENDING | PENDING_APPROVAL / AUTO_EXECUTED | ✅ | When orchestrator starts step (Phase 4 may use PENDING_APPROVAL or AUTO_EXECUTED per approval path). |
| PENDING | STARTED (orchestrator view) | ✅ | Internal “step execution began”; plan document uses PlanStepStatus (PENDING → DONE/FAILED/SKIPPED). |
| *       | DONE    | ✅ | Step succeeded (from STARTED / in-flight). |
| *       | FAILED  | ✅ | Step failed or retry limit exceeded. |
| *       | SKIPPED | ✅ | Explicit skip (policy or human). |
| DONE    | *       | ❌ | Terminal; no further transitions. |
| FAILED  | (new attempt) | ✅ | Only by starting a **new attempt** (new attempt number); not same row. |
| SKIPPED | *       | ❌ | Terminal. |

**Note:** Plan document step status is `PlanStepStatus` (6.1: PENDING, PENDING_APPROVAL, AUTO_EXECUTED, DONE, SKIPPED, FAILED). Orchestrator updates the **plan** step status to DONE/FAILED/SKIPPED when outcome is known. The table above applies to the **step execution state** and/or plan step status transitions enforced in code. Reject any transition not in the allowed set.

**Implementer note:** In-flight status is represented in **PlanStepExecutionState**; the plan document may remain PENDING, PENDING_APPROVAL, or AUTO_EXECUTED until outcome is known. Do not add a “STARTED” value to the plan schema (6.1).

---

## 4. Plan Orchestrator — Service

### File: `src/services/plan/PlanOrchestratorService.ts` (new)

**Responsibilities:**
- **Activation:** List APPROVED plans (e.g. by tenant/status); for each, call PlanPolicyGateService.evaluateCanActivate; if can_activate, call PlanLifecycleService.transition(plan, 'ACTIVE'). Respect conflict invariant (one ACTIVE per account per plan_type — Gate already enforces).
- **Step advancement:** For each ACTIVE plan (and optionally PAUSED that are not processed), determine next step (first PENDING by sequence or dependency order). If none, call PlanStateEvaluatorService.evaluate; if COMPLETE/EXPIRE, transition plan and append ledger.
- **Step execution:** For next PENDING step: check retry count < N; if exceeded → fail step, STEP_FAILED to ledger; **pause plan** (6.3 baseline). Otherwise, obtain **attempt** via the single authoritative mechanism (§3a), then create **action intent** for (tenant_id, account_id, action_type from step, plan_id, step_id, attempt); invoke Phase 3/4 path (create intent → approval if needed → execution); record (plan_id, step_id, attempt) in step execution state; append STEP_STARTED to Plan Ledger.
- **Outcome handling:** When step outcome is known (Phase 4 Execution Status or outcome callback): update step status (DONE | FAILED | SKIPPED); append STEP_COMPLETED | STEP_FAILED | STEP_SKIPPED to Plan Ledger; call PlanStateEvaluatorService.evaluate(plan); if COMPLETE/EXPIRE, transition plan and append PLAN_COMPLETED/PLAN_EXPIRED; else advance to next step on next scheduler run (or optional event-driven).
- **PAUSED:** Do not advance steps for PAUSED plans; resume is via API (6.1).

**Methods (orchestrator service):**
- `runCycle(tenantId?: string): Promise<{ activated: number; stepsStarted: number; completed: number; expired: number }>`  
  - **Per-run bound:** Process at most **K plans per run** (configurable; e.g. K=10). Remaining plans are picked up on the next schedule. Apply to both APPROVED (activation) and ACTIVE (step advancement) lists so a single run cannot timeout or starve.  
  - Load APPROVED plans (optionally scoped by tenant), **limit K**. For each: evaluateCanActivate → transition to ACTIVE if true.  
  - Load ACTIVE plans, **limit K**. For each: get next PENDING step; if none, evaluate → COMPLETE/EXPIRE if applicable. If next step exists: check retry, obtain attempt (§3a), create action intent, invoke execution, record STEP_STARTED. Enforce step status transitions per §3b.  
  - Return counts for observability.

**Dependencies:** PlanRepositoryService, PlanLifecycleService, PlanPolicyGateService, PlanLedgerService, PlanStateEvaluatorService, plan type config (retry limit N), ActionIntentService (or Phase 3 API to create action intent), Phase 4 execution trigger (e.g. Execution Starter or Decision API), step execution state store.

**Phase 3/4 integration (detailed):**
- **Create action intent:** Orchestrator builds a minimal “proposal” or intent payload: tenant_id, account_id, action_type (from step.action_type), source: 'plan', plan_id, step_id, attempt. Call ActionIntentService.createFromPlanStep(...) or equivalent (Phase 3). That creates an action intent that flows through approval (if needed) and then Phase 4 execution.
- **Execution:** Phase 4 execution starter (or decision flow) runs as today; outcome is written to execution outcome store. Orchestrator either polls Execution Status API for (intent_id / plan_id+step_id) or is invoked by a callback when step completes (optional later).
- **No new execution surface:** All execution is Phase 4; orchestrator only creates intents and reacts to outcomes.

---

## 5. Orchestrator Lambda Handler

### File: `src/handlers/phase6/plan-orchestrator-handler.ts` (new)

**Trigger:** EventBridge scheduled rule (e.g. `rate(5 minutes)` or `cron(0/15 * * * ? *)`).

**Handler logic:**
- Optional: acquire a distributed lock (e.g. DynamoDB conditional write on a “orchestrator_lock” row) so only one instance runs at a time; release after run. If lock not acquired, exit (idempotent no-op). **If using a lock row, set a TTL** (e.g. 2× schedule interval) on the lock item so a crashed instance does not wedge orchestration.
- Call PlanOrchestratorService.runCycle() (optionally with tenant filter from env). **runCycle enforces a per-run plan cap K** (e.g. K=10); remaining plans are processed on the next schedule.
- Log metrics (activated, stepsStarted, completed, expired).
- Release lock if used.

**Idempotency:** Step-level idempotency is by (plan_id, step_id, attempt). The **attempt** value is produced only by the single authoritative mechanism (§3a) (e.g. atomic ADD next_attempt); then the idempotency row is written with ConditionExpression so duplicate runs do not double-execute.

**Environment:** REVENUE_PLANS_TABLE_NAME, PLAN_LEDGER_TABLE_NAME, PLAN_STEP_EXECUTION_TABLE_NAME (or equivalent), ACTION_INTENT_TABLE_NAME, **TENANTS_TABLE_NAME** (tenant IDs discovered at runtime from Tenants table; no deploy-time tenant ID), retry limit N, **ORCHESTRATOR_MAX_PLANS_PER_RUN** (K, e.g. 10).

---

## 6. Plan Type Config — Retry Limit

Extend `PlanTypeConfig` (or planTypeConfig.ts) with optional `max_retries_per_step?: number` (default 3). Orchestrator reads this per plan.plan_type and enforces before starting a step.

**File:** `src/types/plan/PlanTypeConfig.ts` — add `max_retries_per_step?: number` to interface.  
**File:** `src/config/planTypeConfig.ts` — set `max_retries_per_step: 3` for RENEWAL_DEFENSE.

---

## 7. DynamoDB — Step Execution State (Optional Table)

**Table: PlanStepExecution** (or name per CDK convention)

- **Partition key:** `pk` (string) — `PLAN#<plan_id>`
- **Sort key:** `sk` (string) — `STEP#<step_id>#ATTEMPT#<attempt>` (attempt = 1, 2, … per step; **attempt** from §3a only)
- **Attributes:** plan_id, step_id, attempt, status, started_at, completed_at?, outcome_id?, error_message?
- **Condition:** PutItem with `attribute_not_exists(sk)` for idempotency when starting a step (after obtaining attempt via §3a).

**Per-step counter for §3a (Option A):** Either a separate row per (plan_id, step_id) with `next_attempt` (number), e.g. `pk = PLAN#<plan_id>`, `sk = STEP#<step_id>#META`, attribute `next_attempt`; or a dedicated small table keyed by (plan_id, step_id) with UpdateItem ADD next_attempt. Use returned value as attempt before writing the execution row above.

---

## 8. CDK / Infrastructure

- **EventBridge rule:** Schedule (e.g. every 5 or 15 minutes) targeting Plan Orchestrator Lambda.
- **Lambda:** PlanOrchestratorHandler; env: REVENUE_PLANS_TABLE_NAME, PLAN_LEDGER_TABLE_NAME, PLAN_STEP_EXECUTION_TABLE_NAME (or equivalent), **ORCHESTRATOR_MAX_PLANS_PER_RUN** (K, e.g. 10), plan type config source, ActionIntent/Phase3 integration, Phase 4 execution status URL or callback config.
- **Optional:** PlanStepExecution table (or reuse existing idempotency/store).
- **IAM:** Lambda has read/write to RevenuePlans, PlanLedger, step execution store; invoke ActionIntent/Phase 4 or access to create intents and poll status (per existing Phase 3/4 IAM).

**Location:** Add to existing PlanInfrastructure construct or create PlanOrchestratorConstruct in `src/stacks/`.

---

## 9. Plan Ledger — Step Events (6.1 extension)

Orchestrator (and only orchestrator) appends step-level events. Schema already in 6.1:

| Event type     | Emitted when           | data payload                          | Emitter     |
|----------------|------------------------|---------------------------------------|-------------|
| STEP_STARTED   | Step execution begins  | plan_id, step_id, action_type, attempt? | Orchestrator |
| STEP_COMPLETED | Step succeeds          | plan_id, step_id, outcome?            | Orchestrator |
| STEP_SKIPPED   | Step skipped           | plan_id, step_id, reason              | Orchestrator |
| STEP_FAILED    | Step fails             | plan_id, step_id, reason, attempt?    | Orchestrator |

PLAN_COMPLETED and PLAN_EXPIRED are emitted by PlanLifecycleService.transition when orchestrator calls transition after State Evaluator returns COMPLETE or EXPIRE.

---

## 10. Termination Semantics Summary

| Terminal state | When | Ledger event    | completion_reason / reason |
|----------------|------|-----------------|----------------------------|
| COMPLETED      | State Evaluator returns COMPLETE (objective_met or all_steps_done) | PLAN_COMPLETED | objective_met \| all_steps_done |
| EXPIRED        | State Evaluator returns EXPIRE (now >= expires_at)                | PLAN_EXPIRED   | expired_at                     |
| ABORTED        | Human/policy or orchestrator (e.g. retry limit exceeded, halt)      | PLAN_ABORTED   | reason, aborted_at             |

Orchestrator never transitions to DRAFT or APPROVED; it only activates APPROVED→ACTIVE and terminates ACTIVE→COMPLETED|EXPIRED|ABORTED or PAUSED→ABORTED (API handles PAUSED→ACTIVE resume).

---

## 11. Test Strategy

- **PlanStateEvaluatorService:** Unit tests: plan with all steps DONE → COMPLETE all_steps_done; now >= expires_at → EXPIRE; otherwise NO_CHANGE. Optional: objective_met when context indicates (if implemented).
- **PlanOrchestratorService:** Unit tests with mocks: APPROVED plan + can_activate true → transition to ACTIVE; next PENDING step → create action intent, STEP_STARTED; retry count >= N → do not start step, STEP_FAILED; State Evaluator COMPLETE → transition to COMPLETED, PLAN_COMPLETED.
- **plan-orchestrator-handler:** Unit test: EventBridge event → runCycle called; lock acquired/released (if used).
- **Integration (optional):** One ACTIVE plan, one step; orchestrator creates intent and Phase 4 executes; outcome leads to step DONE and PLAN_COMPLETED in ledger.

---

## 12. Contract: No New Execution Surface

- Plan Orchestrator invokes **Phase 3/4 paths only** (action intent creation, approval flow, execution, outcome). No new execution back door.
- Adaptation: pause, retry, abort, skip only; **no** adding new action types or steps without re-approval (DRAFT + approve).
- Orchestrator is **non-LLM**; all decisions are deterministic from plan state, Policy Gate, and State Evaluator.

---

## References

- Parent: [PHASE_6_CODE_LEVEL_PLAN.md](PHASE_6_CODE_LEVEL_PLAN.md)
- Canonical contract: [PHASE_6_IMPLEMENTATION_PLAN.md](PHASE_6_IMPLEMENTATION_PLAN.md) EPIC 6.3
- Phase 6.1: [PHASE_6_1_CODE_LEVEL_PLAN.md](PHASE_6_1_CODE_LEVEL_PLAN.md) (lifecycle, Policy Gate, ledger)
- Phase 6.2: [PHASE_6_2_CODE_LEVEL_PLAN.md](PHASE_6_2_CODE_LEVEL_PLAN.md) (plan type config, RENEWAL_DEFENSE)
- Phase 3/4: Decision and execution spine (ActionIntentService, execution starter, Execution Status API)
