# Phase 7 — Trust, Quality, and Cost Governance

*Making autonomy safe, economical, and enterprise-operable*

**Status:** 🟢 **COMPLETE**
**Created:** 2026-01-31
**Prerequisites:** Phase 6 complete (Plans, Orchestrator, UI, Conflicts, E2E).
**Parent:** `IMPLEMENTATION_APPROACH.md` (updated to reflect Phase 6 reality).
**Progress:** Not started.

---

## Where you are now (objective state)

After Phase 6, the system can:

1. **Perceive** reality (signals, posture, memory)
2. **Decide** with policy and rationale
3. **Execute** deterministically
4. **Coordinate** actions over time via plans
5. **Resolve conflicts** safely
6. **Explain outcomes** via ledger + UI
7. **Prove correctness** with unit, integration, and E2E tests

This is **real autonomy**, not a demo.

The remaining risk is no longer *capability* — it is **scale and trust**.

---

## The correct next phase: Phase 7 — Trust, Quality, and Cost Governance

> Phase 7 is *not* about adding new behaviors.
> It is about **controlling, validating, and bounding the behaviors you already have**.

Phase 6 gave you coordination.
Phase 7 gives you **enterprise credibility**.

---

## Phase 7 Objective (precise)

Ensure that **every autonomous decision and action** is:

* **Correct** (grounded, consistent, compliant)
* **Fresh** (not acting on stale or invalid data)
* **Economical** (bounded by cost and usage budgets)
* **Explainable** (why allowed, why blocked, why warned)
* **Observable** (measurable at runtime, not postmortem)

Phase 7 turns autonomy into something a CIO, CISO, and CFO can all sign off on.

---

## What Phase 7 adds (and what it does NOT)

### Adds

* deterministic **validators** that can block or warn
* **budget enforcement** for tools, LLM calls, and data sources
* **cost classes** (cheap vs expensive reads)
* **quality signals** (freshness, grounding, contradiction)
* operational **dashboards and alerts**
* scaffolding for a future **learning loop**

### Does NOT add

* new plan types
* new orchestration power
* self-modifying plans
* opaque learning or model retraining
* heuristic or probabilistic safety

Phase 7 is **policy-first, not intelligence-first**.

---

## Core Concept: Validators ≠ Policies

Phase 6 policies answer:

> "Is this allowed in principle?"

Phase 7 validators answer:

> "Is this safe *right now*, with the data and budget we have?"

Validators are:

* deterministic
* explainable
* *logically* order-independent (no reliance on prior validator output); the gateway may execute them in a fixed order for consistency and reporting
* side-effect free

They return **ALLOW | WARN | BLOCK** with structured reasons.

---

## Validator Execution Points (explicit)

Validators must run at **defined choke points**, not "wherever convenient":

1. **Before plan approval**
2. **Before step execution**
3. **Before external writebacks**
4. **Before expensive reads**

Every validator decision is written to the **Plan Ledger**.

---

## Phase 7.1 — Validators Layer (baseline)

### Initial validator set (minimal, high value)

1. **Freshness Validator**

   * Blocks if underlying data exceeds TTL (per source)
   * Example: "CRM opportunity updated 47 days ago; TTL is 14 days"

2. **Grounding Validator**

   * Requires every claim/action to reference evidence already in memory
   * No free-form rationales without sources

3. **Contradiction Validator**

   * Detects conflicts with recent canonical state
   * Contradiction detection is scoped to canonical state sources already trusted by Phase 6 (not speculative signals)
   * Example: plan step contradicts latest renewal status

4. **Compliance / Field Guard Validator**

   * Prevents restricted fields, PII, or tenant-prohibited actions

Each validator emits:

```json
{
  "validator": "freshness",
  "result": "BLOCK",
  "reason": "DATA_STALE",
  "details": { "source": "CRM", "age_days": 47 }
}
```

---

## Phase 7.2 — Budgets and Cost Classes

Autonomy must be **economically bounded**, not just correct.

### Cost classes (baseline)

* **CHEAP** — cached reads, lightweight signals
* **MEDIUM** — standard API calls
* **EXPENSIVE** — scraping, enrichment, large LLM calls

### Budget enforcement

Budgets can be scoped by:

* tenant
* account
* plan
* tool
* day / month

Examples:

* "No more than 50 EXPENSIVE reads/day/tenant"
* "Tier-2 enrichment requires justification + WARN"

Budget violations:

* BLOCK (hard cap)
* WARN (soft threshold)

All budget decisions are logged to the ledger.

---

## Phase 7.3 — Observability & Dashboards

Phase 7 makes the system **operable**, not just correct.

### Core dashboards

* validator block rate (by type)
* budget consumption (by cost class)
* plan success vs pause vs abort
* orchestrator throughput
* average time-in-plan
* % plans requiring human intervention

This is how you answer:

> "Is autonomy helping or hurting us?"

---

## Phase 7.4 — Outcomes & Learning Scaffolding (no training yet)

This phase **does not train models**.

It only captures outcomes so learning is possible later.

Captured signals:

* approved vs rejected actions
* seller edits
* execution success/failure
* plan completion reason
* downstream outcomes (win/loss later)

Stored in:

* Outcomes table
* Ledger (for audit)

This creates the substrate for Phase 8+ learning without changing behavior now.

---

## Invariants (Phase 7 must not break these)

* No validator may mutate state
* Validators may not trigger retries, fetch new data, or request additional tool calls
* Validators may only block/warn — never "fix"
* WARN must never alter execution flow; it may only annotate the ledger and UI
* BLOCK must result in a deterministic stop of the current operation, with no retries unless explicitly initiated by a human or policy outside Phase 7
* Budget checks must be deterministic
* Ledger remains append-only
* Phase 6 orchestration semantics do not change

If Phase 7 breaks any Phase 6 invariant, it is invalid.

---

## Out of Scope (Phase 7)

* Model retraining
* Self-improving agents
* Cross-tenant optimization
* Priority queues or preemption
* Heuristic safety logic

This keeps Phase 7 auditable and certifiable.

---

## Phase 7 Architecture Additions (minimal)

1. **ValidatorGateway**

   * runs validators (in a fixed order for consistency and reporting; validators remain logically order-independent)
   * aggregates results
   * emits ledger events

2. **BudgetService**

   * tracks usage
   * enforces caps
   * returns ALLOW/WARN/BLOCK

3. **Metrics + Dashboards**

   * CloudWatch / equivalent
   * alerting hooks

No changes to Plan Orchestrator logic itself. BudgetService is invoked by existing execution and tool-call paths; it does not schedule, defer, or re-order work.

---

## Recommended order of attack

1. **Phase 7.1 — Validators (freshness + grounding first)**
2. **Phase 7.2 — Budgets + cost classes**
3. **Phase 7.3 — Dashboards + alerts**
4. **Phase 7.4 — Outcomes capture**

Do not start with budgets before validators — quality first, then cost.

---

## Phase 7 success criteria

Phase 7 is complete when:

* validators can deterministically block unsafe actions
* budget overruns are prevented at runtime
* operators can explain *why* actions were blocked or warned
* no Phase 6 orchestration semantics changed

---

## One-line internal framing

> **Phase 6 lets the system stay on course.
> Phase 7 lets the business trust it at scale.**

---

## One-line investor framing

> "We don't just automate revenue actions — we govern them with enterprise-grade trust, cost, and quality controls."

---
