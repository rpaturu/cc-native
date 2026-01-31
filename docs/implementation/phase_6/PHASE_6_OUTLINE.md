# Phase 6 — Autonomous Revenue Orchestration (Outline)

*Coordination across time, accounts, and goals*

**Status:** 🟡 **PLANNED**  
**Created:** 2026-01-28  
**Last Updated:** 2026-01-30  
**Prerequisites:** Phase 5 complete. End-to-end spine: **Perception → Decide → Approve → Execute → Outcome → Ledger → Learning**.  
**Parent:** This outline; code-level and implementation plans to follow.

---

## Where you are now (objective state)

You have fully solved:

1. **Truth** – deterministic signals, lifecycle, posture
2. **Memory** – situation graph + artifacts
3. **Judgment** – decision synthesis with confidence and rationale
4. **Governance** – policy gates, zero trust, audit
5. **Action** – bounded execution via AgentCore
6. **Compounding** – always-on decisions + learning (shadow-safe)

This is no longer an "agent experiment."  
It's a **production-grade autonomous decision system**.

---

## The correct next phase: Phase 6 — Autonomous Revenue Orchestration

> Phase 6 is *not* "more autonomy."  
> It is **coordination across time, accounts, and goals**.

---

## Phase 6 Objective (precise)

Move from **single-account, single-action decisions** to **multi-step, goal-oriented orchestration** across the deal lifecycle—while preserving every invariant you've already earned.

---

## What Phase 6 adds (and what it does NOT)

### Adds

- goal-level planning ("protect renewal", "expand footprint", "create pipeline")
- sequencing actions across days/weeks
- dependency awareness (don't do B until A succeeds)
- conflict resolution (multiple agents, same account)
- outcome-driven plan adaptation

### Does NOT add

- unconstrained agents
- free-form planning without policy
- removal of human control
- black-box learning

---

## Core Concept: Plan ≠ Action

Phase 6 introduces a new primitive:

### `RevenuePlanV1`

A **time-bounded, goal-oriented plan** composed of approved action types.

Example:

```json
{
  "plan_type": "RENEWAL_DEFENSE",
  "account_id": "acme",
  "objective": "Secure renewal before day -30",
  "steps": [
    { "action_type": "REQUEST_RENEWAL_MEETING", "status": "DONE" },
    { "action_type": "PREP_RENEWAL_BRIEF", "status": "AUTO_EXECUTED" },
    { "action_type": "ESCALATE_SUPPORT_RISK", "status": "PENDING_APPROVAL" }
  ],
  "constraints": {
    "no_external_contact_without_approval": true
  }
}
```

Each step has a stable **step_id** (UUID), independent of ordering; plan includes **expires_at** for audit.

---

## Plan Lifecycle & Termination Semantics

The **plan itself** has an explicit lifecycle (steps have their own statuses; the plan has a global state):

```text
DRAFT → APPROVED → ACTIVE → PAUSED → COMPLETED | ABORTED | EXPIRED
```

- **DRAFT** – Proposal only; not yet approved; can be edited or discarded.
- **APPROVED** – Human (or policy) approved; ready to run; no step execution yet.
- **ACTIVE** – Orchestrator is executing steps over time.
- **PAUSED** – Human or policy suspended; can be resumed or aborted.
- **COMPLETED** – All steps done (or objective met); plan closed.
- **ABORTED** – Terminated early (human, policy, or failure); plan closed.
- **EXPIRED** – Time-bound window passed without completion; plan closed.

**Why this matters:** Prevents zombie plans, allows human suspension, supports audit (“why did this stop?”), and enables clean handoff across quarters.

---

## Plan Completion Semantics

What *formally* completes a plan must be explicit so engineers do not hardcode inconsistent behavior.

- **COMPLETED** when:
  - the **objective condition** evaluates true (e.g. "renewal secured by day -30"), **OR**
  - **all required steps** succeed (per plan type and policy).
- **Objective evaluation** is deterministic and logged; the condition is defined per plan type (e.g. RENEWAL_DEFENSE: renewal closed or commitment signed before day -30).
- **Completion reason** is written to the Plan Ledger (objective_met vs. all_steps_done, plus timestamp and any context).

Without this, completion behavior will diverge across implementations.

---

## Adaptation Boundaries

"Outcome-driven plan adaptation" must have a clear boundary so the system stays safe and auditable.

- **Phase 6 baseline:** Adaptation may **pause, retry, or abort** steps — but **may not add new action types without re-approval**.
- The system may:
  - skip a step (with reason),
  - retry a failed step (within policy),
  - pause or abort the plan.
- The system may **not** (in Phase 6): add new steps or new action types to an APPROVED or ACTIVE plan without transitioning the plan back to DRAFT and requiring re-approval.
- This keeps Phase 6 deterministic and prevents scope creep inside "adaptation."

---

## Risk Accumulation Rule

Plan Policy Gate mentions "risk accumulation" — it must be grounded in one simple rule.

- **Baseline (Phase 6):** **Plans inherit the highest-risk step classification** (e.g. if any step is HIGH_RISK, the plan is treated as high-risk for approval and human-touch rules).
- Alternative (if needed later): Total plan risk ≤ max single-action risk × N, or a similar cap.
- The rule is evaluated at approval time and when steps change; violations block approval or require elevated authority.
- Prevents a sequence of "low-risk" steps from collectively exceeding acceptable risk without explicit check.

---

## Plan Ownership & Authority

Before implementation, the following must be explicit (even if the answer is “same as actions”):

- **Who can approve a plan** – Same authority as approving high-risk actions, or explicitly scoped (e.g. plan approver role).
- **Who can modify steps** – Only before ACTIVE? Only certain roles? Stated explicitly to avoid a new ambiguity surface.
- **Ownership change** – Whether plans auto-expire or transfer when account/seller ownership changes; define the rule.

Phase 6 must not introduce a new, underspecified authority surface.

---

## Conflict Resolution: One Hard Invariant (chosen)

Phase 6 requires **one** deterministic conflict rule — not a menu of options. Engineers must implement exactly this.

**Chosen invariant (Phase 6 baseline):**

> **Only one ACTIVE plan per account per `plan_type`.**

- Example: one ACTIVE RENEWAL_DEFENSE plan per account at a time; a second RENEWAL_DEFENSE for the same account must wait or be rejected until the first leaves ACTIVE.
- **Why this one:** Deterministic, easy to reason about, compatible with later priority systems, prevents plan races.
- Phase 6.5 may elaborate (e.g. priority, preemption); Phase 6 enforces this rule in the Plan Policy Gate and orchestrator.
- Violations: reject new plan with clear reason; log for audit. Queueing is out of scope for Phase 6.

---

## Out of Scope (Phase 6)

**Explicitly out of scope:** Cross-account optimization and territory-level planning. Those are a future phase.

This keeps Phase 6 implementable and prevents scope creep. Investors may assume “orchestration” means territory-level; stating the boundary protects the design.

---

## Phase 6 Architecture Additions (minimal, deliberate)

### 1. Plan Proposal Generator (LLM-assisted, bounded)

- **Input:** posture, signals, history, tenant goals
- **Output:** `RevenuePlanV1` (proposal only)
- Still policy-gated, still auditable

### 2. Plan Policy Gate

- Validate:
  - allowed plan types
  - step ordering
  - **risk accumulation** (per § Risk Accumulation Rule: e.g. plan inherits highest-risk step classification)
  - human-touch points
  - **conflict invariant:** only one ACTIVE plan per account per `plan_type`

### 3. Plan State Evaluator

- **Role:** Evaluate objective conditions, check expiry windows, emit plan-level state transitions.
- **Why separate:** Prevents orchestration logic from becoming entangled with business semantics; keeps "when is this plan done?" and "when did it expire?" in one place.
- Can be trivial at first (e.g. single function or small service called by orchestrator).
- Outputs: COMPLETED (objective met or all steps done), EXPIRED (time window passed), or no change; reason written to Plan Ledger.

### 4. Plan Orchestrator

- Executes steps **over time**
- Reacts to outcomes (per § Adaptation Boundaries): success → advance; failure → pause, retry, or abort; **no adding new action types without re-approval**
- Uses existing Phase 4 execution paths
- Consults Plan State Evaluator for objective and expiry; does not embed completion/expiry logic inline

### 5. Plan Ledger

- First-class audit:
  - why this plan existed
  - why steps were added/removed
  - what changed the course

---

## Why Phase 6 matters (investor framing)

You can now say:

> "Most AI systems recommend actions.  
> Our system **runs revenue motions end-to-end**, adapting as reality changes—under policy, with audit, and under continuous human and policy oversight."

That's the difference between:

- **AI assist**
- **AI-native revenue operations**

---

## Recommended order of attack (don't rush)

1. **Phase 6.1 — RevenuePlan schema + policy**
2. **Phase 6.2 — Single plan type** (Renewal Defense is ideal)
3. **Phase 6.3 — Plan orchestration over time**
4. **Phase 6.4 — UI: 'Active Plans'**
5. **Phase 6.5 — Cross-plan conflict resolution**

Do *not* introduce multiple plan types at once.

---

## One-line internal framing

> **Phase 5 lets the system act.  
> Phase 6 lets the system stay on course.**

---

## One-line assessment (internal)

> Phase 6 is correctly framed as orchestration, not intelligence — it's the natural continuation of a system that already knows the truth and can act safely.

---

## References

- **Phase 5 completion:** [../phase_5/PHASE_5_CODE_LEVEL_PLAN.md](../phase_5/PHASE_5_CODE_LEVEL_PLAN.md)
- **Phase 4 execution spine:** [../phase_4/PHASE_4_CODE_LEVEL_PLAN.md](../phase_4/PHASE_4_CODE_LEVEL_PLAN.md)
