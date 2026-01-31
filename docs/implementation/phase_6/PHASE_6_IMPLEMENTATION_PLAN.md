# Phase 6 — Implementation Plan

*Autonomous Revenue Orchestration — coordination across time, accounts, and goals*

**This document is the canonical Phase 6 implementation contract.** All implementation and sub-phase docs (code-level plan, test plans) must align with it; Architecture Invariants (§1.1) are non-negotiable.

**Status:** 🟡 **PLANNED**  
**Created:** 2026-01-29  
**Last Updated:** 2026-01-30  
**Parent:** [PHASE_6_OUTLINE.md](PHASE_6_OUTLINE.md)  
**Progress:** Outline and implementation plan drafted; code-level plans and test plans to follow.

**Prerequisites:**  
Phase 0–5 completed and certified:
- Perception, situation graph, decision synthesis (Phases 1–3)
- Bounded execution via AgentCore (Phase 4)
- Always-on autonomy, policy gates, learning loop (Phase 5)
- Zero-trust networking, IAM, and audit

---

## 0) Phase 6 Objective

Phase 6 transforms the system from **single-account, single-action decisions** into **multi-step, goal-oriented orchestration** across the deal lifecycle:

- goal-level planning ("protect renewal", "expand footprint", "create pipeline")
- sequencing actions across days/weeks
- dependency awareness (don't do B until A succeeds)
- outcome-driven plan adaptation

**Core principle:** Plan ≠ Action. Plans are strategic, time-extended, and adaptive; actions remain tactical and immediate. Phase 6 does **not** add more autonomy—it adds **coordination**.

> Phase 6 is where the system stays on course.

---

## 1) Core Principles (Do Not Violate)

1. **Plans are proposals until approved** — No plan step executes without approval and policy gate.
2. **Plans use existing Phase 4 execution** — No new execution surface; plans schedule actions through the same spine.
3. **Plan lifecycle is explicit** — DRAFT → APPROVED → ACTIVE → PAUSED → COMPLETED | ABORTED | EXPIRED; no zombie plans.
4. **One conflict-resolution invariant** — At least one deterministic rule (e.g. one ACTIVE plan per account per `plan_type`) before coding.
5. **Plan ownership and authority are explicit** — Who can approve, who can modify, what happens on ownership change; no new ambiguity surface.
6. **Cross-account orchestration is out of scope** — Single-account plans only; territory-level planning is a future phase.

---

## 1.1) Architecture Invariants (from Outline)

| Invariant | Source | Implementation |
|-----------|--------|----------------|
| **Plan lifecycle** | Outline § Plan Lifecycle & Termination Semantics | RevenuePlanV1 has `plan_status`; state machine enforced in orchestrator and API. |
| **APPROVED → ACTIVE** | §2.2 Plan Lifecycle | Transition only when Plan Policy Gate returns **can_activate=true** and orchestrator scheduler picks it up. |
| **Plan completion** | Outline § Plan Completion Semantics | Plan State Evaluator evaluates objective condition and required steps; completion reason (objective_met vs. all_steps_done) in Plan Ledger. |
| **Adaptation boundaries** | Outline § Adaptation Boundaries | May pause, retry, abort, skip steps; retry limit N per step (per plan type); exceeding requires pause/abort; may not add new action types without re-approval (DRAFT + re-approve). |
| **Risk accumulation** | Outline § Risk Accumulation Rule | Plan inherits highest-risk step classification; enforced at approval and step change. |
| **Plan ownership** | Outline § Plan Ownership & Authority | Approve/modify rules and ownership-change behavior defined in 6.1 and enforced in API + orchestrator. |
| **Conflict resolution** | Outline § Conflict Resolution | One ACTIVE plan per account per `plan_type`; **reject** on violation (Phase 6 baseline). |
| **Idempotency** | §2.6 Plan Orchestrator | Each plan-step execution idempotent via `(plan_id, step_id, attempt)` key; **step_id** is stable UUID, independent of ordering. |
| **Out of scope** | Outline § Out of Scope | No cross-account or territory-level planning; validation and docs state boundary. |

---

## 1.2) Zero Trust (Mandatory)

Phase 6 **preserves** the zero-trust posture. All Phase 6 work must comply with:

- **Reference:** [Phase 2 Zero Trust Implementation Plan](../phase_2/ZERO_TRUST_IMPLEMENTATION_PLAN.md) — unchanged.
- **New resources:** Any new Lambda, API, DynamoDB table, or IAM role: least privilege, tenant-scoped where applicable, audit logging.
- **Plan Ledger:** First-class audit; entries append-only (no mutation or deletion of historical plan events); no plan state change without ledger entry where required.
- **No bypass of Phase 4:** Plan Orchestrator invokes Phase 4 execution paths only; no new execution back door.

---

## 2) New Capabilities Introduced

### 2.1 RevenuePlanV1 (schema)

- **plan_id** — Unique identifier.
- **plan_type** — e.g. RENEWAL_DEFENSE (single type in 6.2; extend later).
- **account_id**, **tenant_id** — Scope.
- **objective** — Human-readable goal (e.g. "Secure renewal before day -30").
- **plan_status** — DRAFT | APPROVED | ACTIVE | PAUSED | COMPLETED | ABORTED | EXPIRED.
- **steps** — Ordered list of steps; each step: **step_id** (stable UUID, identity independent of ordering), action_type, status (PENDING | PENDING_APPROVAL | AUTO_EXECUTED | DONE | SKIPPED | FAILED), optional dependencies, constraints.
- **constraints** — e.g. no_external_contact_without_approval.
- **expires_at** — Evaluated deadline for EXPIRED; stored for audit even if computed from plan_type.
- **created_at**, **updated_at**, **approved_at**, **completed_at** (or aborted_at, expired_at).
- **approved_by** (optional) — For audit.

Stored in DynamoDB (e.g. `cc-native-revenue-plans` or equivalent); access scoped by tenant/account.

---

### 2.2 Plan Lifecycle & Termination

- **DRAFT** — Editable; not executable.
- **APPROVED** — Human (or policy) approved; not yet running. An APPROVED plan transitions to ACTIVE only when **Plan Policy Gate returns can_activate=true** (conflict invariant satisfied, preconditions met) and the orchestrator scheduler picks it up. Until then it remains APPROVED.
- **Preconditions** = required approvals (e.g. for high-risk steps) + required external dependencies + required data availability; defined once so implementation does not drift per engineer.
- **ACTIVE** — Orchestrator is advancing steps over time.
- **PAUSED** — Human or policy suspended; can resume or abort.
- **COMPLETED** — All steps done or objective met; plan closed.
- **ABORTED** — Terminated early; plan closed.
- **EXPIRED** — Time-bound window passed; plan closed.

Termination semantics (why did this stop?) must be auditable (Plan Ledger).

---

### 2.2.1 Plan Completion Semantics

What *formally* completes a plan must be explicit so implementations do not diverge.

- **COMPLETED** when: the **objective condition** evaluates true (e.g. "renewal secured by day -30"), **OR** **all required steps** succeed (per plan type and policy).
- **Objective evaluation** is deterministic and logged; condition is defined per plan type (e.g. RENEWAL_DEFENSE: renewal closed or commitment signed before day -30).
- **Completion reason** is written to the Plan Ledger: `objective_met` vs. `all_steps_done`, plus timestamp and context.
- Plan State Evaluator (see §2.5) performs this evaluation; orchestrator does not embed completion logic inline.

---

### 2.3 Plan Proposal Generator (LLM-assisted, bounded)

- **Input:** Posture, signals, history, tenant goals.
- **Output:** `RevenuePlanV1` in **DRAFT** (proposal only).
- **Cannot auto-approve plans** — governance; approval is always human or explicit policy.
- Policy-gated: output is not executable until approved and validated by Plan Policy Gate.
- Auditable: proposal creation and inputs logged.

---

### 2.4 Plan Policy Gate

Validates before a plan can move to APPROVED or before next step runs. For APPROVED→ACTIVE, returns **can_activate: boolean + reasons[]** (canonical evaluator); orchestrator activates only if `can_activate=true`. Validates:

- Allowed plan types (tenant/config).
- Step ordering and dependencies.
- **Risk accumulation rule (Phase 6 baseline):** Plans inherit the **highest-risk step classification** (e.g. if any step is HIGH_RISK, the plan is treated as high-risk for approval and human-touch rules). Evaluated at approval time and when steps change; violations block approval or require elevated authority.
- Human-touch points (e.g. external contact requires approval).
- **Conflict-resolution invariant** — Only one ACTIVE plan per account per `plan_type`; **reject** if invariant violated. Queueing is out of scope for Phase 6.

---

### 2.5 Plan State Evaluator

- **Role:** Evaluate objective conditions, check expiry windows, emit plan-level state transitions (COMPLETED, EXPIRED, or no change).
- **Why separate:** Keeps orchestration logic from entangling with business semantics; "when is this plan done?" and "when did it expire?" live in one place.
- Can be trivial at first (e.g. single function or small service called by orchestrator).
- **Outputs:** COMPLETED (objective met or all required steps done), EXPIRED (time window passed), or no change; **completion reason** (objective_met vs. all_steps_done) written to Plan Ledger.
- Orchestrator **consults** Plan State Evaluator for objective and expiry; does not embed completion/expiry logic inline.

---

### 2.6 Plan Orchestrator

- Advances plan steps **over time** (scheduled or event-driven).
- For each step: either emit Phase 3/4 action (using existing execution spine) or mark skipped/failed.
- **Adaptation boundaries (Phase 6 baseline):** May **pause, retry, or abort** steps — but **may not add new action types without re-approval**. May skip a step (with reason) or retry a failed step (within policy). **Retry limit per step** (configured per plan type): Each step may retry up to N times; exceeding retries requires pause or abort — prevents infinite retry loops and zombie ACTIVE plans. Adding new steps or action types to an APPROVED or ACTIVE plan requires transitioning back to DRAFT and re-approval.
- Reacts to outcomes:
  - success → advance to next step; consult Plan State Evaluator; update plan state.
  - failure → adapt (retry, skip, or halt) or transition plan to ABORTED/PAUSED per policy.
- **Idempotency:** Each plan-step execution must be idempotent via `(plan_id, step_id, attempt)` key; makes Step Functions / Lambdas / retries safe by contract.
- Uses **existing Phase 4 execution paths only**; no new execution surface.
- Writes plan state changes and reasons to Plan Ledger.

---

### 2.7 Plan Ledger

- **Append-only:** Plan Ledger entries are append-only; no mutation or deletion of historical plan events. Required for audit credibility, compliance, and investor diligence.
- First-class audit for plans:
  - why this plan existed (trigger, objective, inputs).
  - why steps were added/removed or reordered.
  - what changed the course (outcomes, pauses, aborts).
- Can be implemented as dedicated table or extension of existing ledger with `plan_id` and event type; queryable for "why did this plan stop?" and compliance.

---

### 2.8 Plan Ownership & Authority

- **Who can approve a plan** — Same as high-risk action approval, or explicit plan-approver role; defined in 6.1 and enforced in API.
- **Who can modify steps** — Only in DRAFT? Or APPROVED before ACTIVE? Explicit rule in 6.1; enforced in API.
- **Ownership change** — If account/seller ownership changes, plans either auto-expire or transfer; rule defined in 6.1 and enforced in orchestrator/API.

---

## 3) Epics & Stories

---

## EPIC 6.1 — RevenuePlan Schema + Policy

### Story 6.1.1 — RevenuePlanV1 schema and storage
- Define RevenuePlanV1 type (plan_id, plan_type, account_id, tenant_id, objective, plan_status, steps, constraints, **expires_at**, timestamps, approved_by).
- Define step schema (**step_id** stable UUID per step, action_type, status, dependencies, constraints). Step identity is stable and independent of array order.
- DynamoDB table (or equivalent) for plans; tenant/account scoped; indexes for status and account.

**Acceptance**
- Schema supports lifecycle states and at least one plan type (RENEWAL_DEFENSE).
- All access is tenant/account scoped; no cross-tenant reads.

---

### Story 6.1.2 — Plan lifecycle state machine
- Enforce valid transitions: DRAFT → APPROVED → ACTIVE → PAUSED → COMPLETED | ABORTED | EXPIRED; PAUSED → ACTIVE or ABORTED; etc.
- Reject invalid transitions in API and orchestrator.

**Acceptance**
- No zombie plans (every plan reaches a terminal state or has a defined path to one).
- State transitions are auditable (Plan Ledger or equivalent).

---

### Story 6.1.3 — Plan Policy Gate (validation only)
- Validate: allowed plan types, step ordering, **risk accumulation rule** (plan inherits highest-risk step classification; blocks approval or requires elevated authority if violated), human-touch points.
- **Conflict-resolution invariant:** Only one ACTIVE plan per account per `plan_type`; **reject** if violated. Queueing out of scope for Phase 6.
- For APPROVED→ACTIVE: return **can_activate: boolean + reasons[]**; orchestrator activates only when `can_activate=true`.
- No execution in this story—validation only; called when plan is approved or when step is about to run.

**Acceptance**
- Same inputs → same validation result (deterministic).
- Risk rule and conflict invariant are enforced; violations rejected with clear reason; logged for audit.

---

### Story 6.1.4 — Plan ownership and authority rules
- Document and implement: who can approve, who can modify steps, and what happens on ownership change.
- Expose in API (e.g. approve plan, pause plan, abort plan); enforce permissions.

**Acceptance**
- Approval and modification require correct authority; ownership-change rule is explicit and enforced.

---

## EPIC 6.2 — Single Plan Type (Renewal Defense)

### Story 6.2.1 — RENEWAL_DEFENSE plan type
- Define RENEWAL_DEFENSE as the first (and initially only) plan type.
- Define allowed steps (e.g. REQUEST_RENEWAL_MEETING, PREP_RENEWAL_BRIEF, ESCALATE_SUPPORT_RISK) and optional ordering/dependencies.
- Seed or config for tenant so Plan Policy Gate knows allowed types and steps.

**Acceptance**
- Only RENEWAL_DEFENSE is accepted in 6.2; other plan types rejected or deferred to later phase.
- Step set is documented and policy-gated.

---

### Story 6.2.2 — Plan Proposal Generator (DRAFT only)
- Input: posture, signals, history, tenant goals (for one account).
- Output: RevenuePlanV1 in DRAFT with plan_type RENEWAL_DEFENSE and suggested steps.
- LLM-assisted, bounded (prompt + schema); output is proposal only; no execution.
- Log proposal creation and key inputs for audit.

**Acceptance**
- Proposals are valid DRAFT plans; no step runs until plan is approved and orchestration starts (6.3).
- Proposal generation is auditable.

---

## EPIC 6.3 — Plan Orchestration Over Time

### Story 6.3.1 — Plan Orchestrator (core)
- When plan is APPROVED, transition to ACTIVE only when **Plan Policy Gate returns can_activate=true** and orchestrator scheduler picks it up; then begin step execution.
- For each step: invoke existing Phase 3/4 path (create action intent, approval if needed, execution); wait for outcome.
- **Adaptation boundaries:** May pause, retry, or abort steps; may skip step (with reason). **Retry limit:** each step retries up to N times (configurable per plan type); exceeding requires pause or abort. May **not** add new action types or new steps without transitioning plan to DRAFT and re-approval.
- On outcome: success → advance; consult Plan State Evaluator for completion/expiry; failure → adapt or halt per policy; update plan state and Plan Ledger.
- Support PAUSED: orchestrator stops advancing until resumed or aborted.

**Acceptance**
- Only Phase 4 execution paths are used; no new execution surface.
- APPROVED→ACTIVE follows the three conditions; retry limit enforced per step; adaptation never adds new steps/action types without re-approval; plan state and step status stay consistent with outcomes; all transitions auditable.

---

### Story 6.3.2 — Scheduling and triggers
- **Baseline:** Orchestrator runs on a **scheduled poll** (e.g. EventBridge rule every X minutes) + strict idempotency/locking. Event-driven (e.g. step-completed) is optional later.
- **Idempotency:** Each plan-step execution is keyed by `(plan_id, step_id, attempt)` (step_id = stable UUID); ensure only one effective execution per key (locking or idempotency).

**Acceptance**
- Plans advance over time without manual steps; duplicate step execution is prevented; step execution is idempotent by `(plan_id, step_id, attempt)`.

---

### Story 6.3.3 — Plan State Evaluator and termination semantics (COMPLETED, ABORTED, EXPIRED)
- **Plan State Evaluator:** Evaluate objective conditions and expiry windows; emit COMPLETED (objective_met or all_steps_done), EXPIRED, or no change; write completion reason to Plan Ledger. Orchestrator calls Evaluator; completion/expiry logic is not embedded in orchestrator.
- COMPLETED: when objective condition evaluates true OR all required steps succeed; set completed_at; completion reason (objective_met vs. all_steps_done) in Plan Ledger.
- ABORTED: human or policy or failure; set aborted_at; reason in Plan Ledger.
- EXPIRED: time-bound window passed; set expired_at; reason in Plan Ledger.

**Acceptance**
- Completion semantics are deterministic and logged; every plan reaches a terminal state or has a defined path; "why did this stop?" is answerable from Plan Ledger.

---

## EPIC 6.4 — UI: Active Plans

**UI is implemented in cc-dealmind;** cc-native provides APIs and data.

### Story 6.4.1 — Plans API (list, get, approve, pause, abort)
- List plans by tenant/account (filter by status).
- Get plan by plan_id (full detail + steps).
- Approve plan (transition DRAFT → APPROVED) with authority check.
- Pause/Resume plan (ACTIVE ↔ PAUSED).
- Abort plan (→ ABORTED) with reason.
- All mutations enforce policy and ownership; all write to Plan Ledger where required.

**Acceptance**
- UI (cc-dealmind) can list, open, approve, pause, and abort plans; data from cc-native APIs.
- All actions are permission-checked and auditable.

---

### Story 6.4.2 — Active Plans surface (cc-dealmind)
- "Active Plans" view: list ACTIVE (and optionally PAUSED) plans per account/tenant.
- Drill into plan: objective, steps, status, history (from Plan Ledger or equivalent).
- Actions: Pause, Resume, Abort (call cc-native APIs).

**Acceptance**
- Sellers and admins can see what plans are running and control them (pause/abort) without code changes.

---

## EPIC 6.5 — Cross-Plan Conflict Resolution

### Story 6.5.1 — Conflict-resolution invariant (enforcement)
- Enforce the baseline invariant (one ACTIVE plan per account per `plan_type`) in Plan Policy Gate and orchestrator.
- **Phase 6 baseline: reject** when a new plan would violate (return clear reason). Queueing is out of scope for Phase 6; violations are rejected deterministically.
- Log violations and decisions for audit.

**Acceptance**
- Invariant is always enforced; no two ACTIVE plans per account per plan_type.
- Violations are rejected with reason; behavior is deterministic and auditable.

---

### Story 6.5.2 — Conflict resolution (extended)
- Optional: extend to multiple plan types with clear rules (e.g. priority field, preemption).
- Document and implement so that multiple agents or multiple plans on same account do not conflict arbitrarily.
- Only after 6.5.1 is stable; can be minimal (e.g. "only one ACTIVE plan per account globally") or refined.

**Acceptance**
- One deterministic rule is always in effect; extended rules (if any) are documented and testable.

---

## 4) Phase 6 Definition of Done

Phase 6 is complete when:

- RevenuePlanV1 schema exists and is stored with explicit lifecycle.
- At least one plan type (RENEWAL_DEFENSE) is supported end-to-end: proposal → approval → orchestration → completion/abort/expiry.
- Plan Policy Gate validates plans, enforces risk accumulation rule (highest-risk step), and enforces one conflict-resolution invariant (one ACTIVE per account per plan_type).
- Plan State Evaluator evaluates objective conditions and expiry; completion reason (objective_met vs. all_steps_done) written to Plan Ledger.
- Plan Orchestrator advances steps over time using only Phase 4 execution paths; adaptation never adds new steps/action types without re-approval.
- Plan Ledger (or equivalent) is append-only and answers "why did this plan exist?" and "why did it stop?".
- Plan ownership and authority are explicit and enforced.
- UI (cc-dealmind) can list, view, approve, pause, and abort plans.
- Cross-account and territory-level planning remain out of scope and are documented as such.

---

## 5) What Is Out of Scope (Phase 6)

- **Cross-account optimization** — No territory-level or multi-account plan optimization in Phase 6.
- **Territory-level planning** — Single-account plans only; future phase.
- **Multiple plan types at once** — Only RENEWAL_DEFENSE in 6.2; add more in a later phase after 6.3–6.5 are stable.

---

## 6) What Comes After Phase 6

Possible future phases:

- Additional plan types (expand footprint, create pipeline).
- Cross-account or territory-level orchestration (with explicit scope and invariants).
- Richer conflict resolution (priority, preemption, resource contention).
- Plan templates and reuse.

These are **intentionally deferred**.

---

## One-line framing

> Phase 5 lets the system act. Phase 6 lets the system stay on course.

---

## References

- **Phase 6 outline:** [PHASE_6_OUTLINE.md](PHASE_6_OUTLINE.md)
- **Phase 5 completion:** [../phase_5/PHASE_5_CODE_LEVEL_PLAN.md](../phase_5/PHASE_5_CODE_LEVEL_PLAN.md)
- **Phase 4 execution spine:** [../phase_4/PHASE_4_CODE_LEVEL_PLAN.md](../phase_4/PHASE_4_CODE_LEVEL_PLAN.md)
- **Phase 2 zero trust:** [../phase_2/ZERO_TRUST_IMPLEMENTATION_PLAN.md](../phase_2/ZERO_TRUST_IMPLEMENTATION_PLAN.md)
