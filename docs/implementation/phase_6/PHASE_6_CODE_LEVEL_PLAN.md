# Phase 6 — Code-Level Implementation Plan

*Autonomous Revenue Orchestration — coordination across time, accounts, and goals*

**Status:** 🟡 **PLANNED**  
**Created:** 2026-01-30  
**Last Updated:** 2026-01-30  
**Parent:** [PHASE_6_OUTLINE.md](PHASE_6_OUTLINE.md) | [PHASE_6_IMPLEMENTATION_PLAN.md](PHASE_6_IMPLEMENTATION_PLAN.md)  
**Prerequisites:** Phase 0–5 complete. End-to-end spine: **Perception → Decide → Approve → Execute → Outcome → Ledger → Learning**.

**Note:** Test plans (e.g. `testing/PHASE_6_x_TEST_PLAN.md`) to be created per sub-phase. This plan is the code-level reference; sub-phase docs provide detailed file paths, type shapes, and handler contracts.

---

## Document purpose

This is the **parent** code-level plan. It provides overview, sub-phase list, implementation order, and quick reference. **Detailed implementation** (file paths, type shapes, service methods, handler contracts, CDK resources) lives in sub-phase documents **PHASE_6_1** through **PHASE_6_5**. Create sub-phase plans as each epic is started.

**Source-of-truth roles:** **Implementation Plan** = epic/story + acceptance contract; **Code-Level Plan** = file paths, handler contracts, CDK resources, DB schema, idempotency/locking specifics; **Architecture Invariants table** (in Implementation Plan) = non-negotiable constraints that sub-phase docs must not weaken.

---

## Overview

Phase 6 adds **goal-level coordination** without new execution surface: plans are first-class, lifecycle-explicit, policy-gated, and orchestrated over time using **Phase 4 execution only**.

**Key Architectural Additions:**
1. **RevenuePlanV1** — time-bounded, goal-oriented plan schema; lifecycle DRAFT → APPROVED → ACTIVE → PAUSED → COMPLETED | ABORTED | EXPIRED; **expires_at** for audit. Step identity is stable via **step_id** (UUID), independent of ordering.
2. **Plan Policy Gate** — validates plan types, step ordering, risk accumulation (plan inherits highest-risk step), human-touch points, conflict invariant (one ACTIVE per account per `plan_type`; **reject** on violation). Returns **can_activate: boolean + reasons[]**; orchestrator activates only if Policy Gate returns `can_activate=true`. **Queueing is out of scope for Phase 6; violations are rejected deterministically.**
3. **Plan State Evaluator** — evaluates objective conditions and expiry; emits COMPLETED (objective_met / all_steps_done), EXPIRED, or no change; completion reason in Plan Ledger; orchestrator consults, does not embed.
4. **Plan Orchestrator** — advances steps over time; idempotency via `(plan_id, step_id, attempt)`; retry limit N per step; adaptation: pause/retry/abort/skip only (no new action types without re-approval); Phase 4 execution only. **Intentionally non-LLM** (deterministic advance and react).
5. **Plan Ledger** — append-only audit: why plan existed, why it stopped, what changed the course.
6. **Plan Proposal Generator** — LLM-assisted, bounded; output DRAFT only; policy-gated. **Cannot auto-approve plans** (governance).

---

## Sub-Phase Documents

For detailed code-level plans, see:

| Sub-Phase | Document | Scope |
|-----------|----------|--------|
| **6.1** | `PHASE_6_1_CODE_LEVEL_PLAN.md` | RevenuePlan schema, lifecycle state machine, Plan Policy Gate, ownership/authority |
| **6.2** | `PHASE_6_2_CODE_LEVEL_PLAN.md` | Single plan type (RENEWAL_DEFENSE), allowed steps, Plan Proposal Generator (DRAFT) |
| **6.3** | `PHASE_6_3_CODE_LEVEL_PLAN.md` | Plan Orchestrator, scheduling/triggers, Plan State Evaluator, termination semantics |
| **6.4** | `PHASE_6_4_CODE_LEVEL_PLAN.md` | Plans API (list, get, approve, pause, abort); Active Plans UI (cc-dealmind) |
| **6.5** | `PHASE_6_5_CODE_LEVEL_PLAN.md` | Conflict-resolution invariant (reject on violation); optional extended rules |

**Implementation order:** 6.1 → 6.2 → 6.3 → 6.4 → 6.5. Do not introduce multiple plan types at once.

---

## Core principles, Zero Trust & integration

**Core principles (from Implementation Plan §1):**  
Plans are proposals until approved; plans use **existing Phase 4 execution** (no new execution surface); plan lifecycle is explicit; one conflict-resolution invariant (reject); plan ownership and authority explicit; cross-account out of scope. Sub-phase plans must implement these.

**Zero Trust:**  
Phase 6 preserves [Phase 2 Zero Trust](../phase_2/ZERO_TRUST_IMPLEMENTATION_PLAN.md). All new Lambda, API, DynamoDB, IAM: least privilege, tenant-scoped where applicable, audit logging. Plan Ledger append-only; no bypass of Phase 4.

**Integration with Phase 4 & 5:**  
- Plan Orchestrator invokes Phase 4 execution paths only (create action intent → approval if needed → execution → outcome).  
- Phase 3 Decision / Phase 4 Execution Status remain the spine; plans schedule **calls into** that spine.  
- Autonomy policies (Phase 5) apply to plan-step actions as to any other action; no special-case execution path for plans.

**Repo boundary:**  
Active Plans **UI** (list plans, drill into plan, pause/resume/abort) is in **cc-dealmind**. **cc-native** provides all Plans APIs (list, get, approve, pause, abort, plan ledger query).

---

## Implementation Order

### Phase 6.1 — RevenuePlan Schema + Policy
1. Type definitions (RevenuePlanV1, plan step schema with **step_id** (stable UUID) per step, plan_status enum, **expires_at**)
2. DynamoDB table: revenue-plans (tenant/account scoped; indexes for status, account)
3. Plan lifecycle state machine (valid transitions; reject invalid in API and orchestrator)
4. Plan Policy Gate (validation only): allowed types, step ordering, risk accumulation rule, conflict invariant (reject); returns **can_activate** (boolean + reasons[]) for APPROVED→ACTIVE
5. Plan ownership and authority rules; expose approve/pause/abort in API with permission checks
6. Plan Ledger (append-only table or extension of existing ledger with plan_id, event type)

### Phase 6.2 — Single Plan Type (Renewal Defense)
7. RENEWAL_DEFENSE plan type and allowed steps (e.g. REQUEST_RENEWAL_MEETING, PREP_RENEWAL_BRIEF, ESCALATE_SUPPORT_RISK); config/seed for Policy Gate
8. Plan Proposal Generator: input (posture, signals, history, tenant goals); output RevenuePlanV1 DRAFT; LLM-assisted, bounded; audit log

### Phase 6.3 — Plan Orchestration Over Time
9. Plan State Evaluator: objective conditions, expiry windows; output COMPLETED / EXPIRED / no change; completion reason to Plan Ledger
10. Plan Orchestrator: APPROVED→ACTIVE only when Policy Gate returns **can_activate=true** and scheduler picks up; step execution via Phase 3/4; idempotency `(plan_id, step_id, attempt)` (step_id = stable UUID); retry limit N; adaptation boundaries
11. Scheduling and triggers: **baseline = scheduled poll** (e.g. EventBridge rule every X minutes) + strict idempotency/locking. Locking may be implemented via DynamoDB conditional writes or equivalent. Event-driven (e.g. step-completed) optional later. Single effective execution per step key.

### Phase 6.4 — UI: Active Plans
12. Plans API: list (tenant/account, filter by status), get (plan_id), approve, pause, resume, abort; all mutations policy-checked and ledger-written
13. Active Plans surface in cc-dealmind: list ACTIVE/PAUSED, drill into plan, Pause/Resume/Abort

### Phase 6.5 — Cross-Plan Conflict Resolution
14. Enforce conflict invariant in Plan Policy Gate and orchestrator: reject with reason when second ACTIVE plan same account + plan_type; log for audit
15. Optional: extended rules (e.g. priority, preemption) only after 6.5.1 stable

---

## Quick Reference: Component Locations

### Type Definitions
- **6.1:** `PHASE_6_1_CODE_LEVEL_PLAN.md` — RevenuePlanV1, plan step schema (**step_id** stable UUID per step), PlanStatus, PlanLedgerEvent (or equivalent)
- **6.2:** `PHASE_6_2_CODE_LEVEL_PLAN.md` — RENEWAL_DEFENSE plan type, allowed step types, proposal input/output

### Services
- **6.1:** PlanRepositoryService (or equivalent), PlanLifecycleService, PlanPolicyGateService, PlanLedgerService
- **6.2:** PlanProposalGeneratorService (LLM-assisted, bounded)
- **6.3:** PlanStateEvaluatorService, PlanOrchestratorService; integration with Phase 3/4 (ActionIntentService, execution path)

### Lambda Handlers / APIs
- **6.1:** Plan lifecycle API (approve, pause, abort); Plan Policy Gate (validation only, called by API and orchestrator)
- **6.3:** Plan Orchestrator handler (baseline: scheduled poll); Plan State Evaluator (called by orchestrator)
- **6.4:** Plans API (list, get, approve, pause, resume, abort); plan ledger query for “why did this stop?”

### CDK / Infrastructure
- **6.1:** DynamoDB table(s): revenue-plans; Plan Ledger (append-only); API routes for plan mutations
- **6.3:** EventBridge scheduled rule (poll) for orchestrator; Lambda for orchestrator and state evaluator
- **6.4:** API Gateway routes for Plans API (cc-native); UI in cc-dealmind consumes these

---

## Prerequisites (Before Starting Phase 6)

- Phase 4 complete (execution spine, Execution Status API, ledger, outcome storage).
- Phase 5 complete (autonomy modes, policy gates, learning loop); plan-step actions flow through same approval/auto-execute rules.
- Phase 3 Decision API produces ActionIntentV1; Phase 4 executes and records outcomes. Plans will **invoke** Phase 3/4, not replace them.

**See:** `PHASE_6_IMPLEMENTATION_PLAN.md` §1 Core Principles, §1.1 Architecture Invariants (all must be implemented).

---

## References

- **Phase 6 Outline:** [PHASE_6_OUTLINE.md](PHASE_6_OUTLINE.md)
- **Phase 6 Implementation Plan (epics & stories):** [PHASE_6_IMPLEMENTATION_PLAN.md](PHASE_6_IMPLEMENTATION_PLAN.md)
- **Phase 5 completion:** [../phase_5/PHASE_5_CODE_LEVEL_PLAN.md](../phase_5/PHASE_5_CODE_LEVEL_PLAN.md)
- **Phase 4 execution spine:** [../phase_4/PHASE_4_CODE_LEVEL_PLAN.md](../phase_4/PHASE_4_CODE_LEVEL_PLAN.md)
- **Phase 2 Zero Trust:** [../phase_2/ZERO_TRUST_IMPLEMENTATION_PLAN.md](../phase_2/ZERO_TRUST_IMPLEMENTATION_PLAN.md)
