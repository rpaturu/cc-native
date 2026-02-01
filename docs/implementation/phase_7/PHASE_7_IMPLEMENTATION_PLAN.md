# Phase 7 — Implementation Plan

*Trust, Quality, and Cost Governance — controlling, validating, and bounding autonomous behavior*

**This document is the canonical Phase 7 implementation contract.** All implementation and sub-phase docs (code-level plans, test plans) must align with it; Architecture Invariants (§1.1) are non-negotiable.

**Status:** 🟢 **COMPLETE**  
**Created:** 2026-01-31  
**Parent:** [PHASE_7_OUTLINE.md](PHASE_7_OUTLINE.md)  
**Progress:** Not started.

**Prerequisites:**  
Phase 6 complete and certified:
- Plans, Orchestrator, UI, Conflicts, E2E
- Plan Ledger append-only and operational
- Zero-trust networking, IAM, and audit

**Contracts (before coding):**  
For canonical validator and budget behavior, use **[PHASE_7_CONTRACTS_ADDENDUM.md](PHASE_7_CONTRACTS_ADDENDUM.md)** — Freshness WARN/BLOCK thresholds, Grounding scope (action-level), Contradiction snapshot timing, Validator run-all semantics, Budget precedence.

---

## 0) Phase 7 Objective

Phase 7 transforms the system from **unbounded autonomy** into **governed autonomy** that CIO, CISO, and CFO can sign off on:

- deterministic validators that block or warn at defined choke points
- budget enforcement for tools, LLM calls, and data sources
- quality signals (freshness, grounding, contradiction) before actions run
- operational dashboards and explainability (why allowed, why blocked, why warned)

**Core principle:** Phase 7 is *not* about adding new behaviors. It is about **controlling, validating, and bounding the behaviors you already have**. Validators are runtime truth, not policy; they answer "Is this safe *right now*?" not "Is this allowed in principle?"

> Phase 6 lets the system stay on course. Phase 7 lets the business trust it at scale.

---

## 1) Core Principles (Do Not Violate)

1. **Validators are runtime truth, not policy** — Phase 6 policies answer "Is this allowed in principle?"; Phase 7 validators answer "Is this safe right now, with the data and budget we have?"
2. **Validators do not mutate state** — No retries, no fetch-new-data, no additional tool calls; block/warn only.
3. **WARN never alters execution flow** — WARN may only annotate the ledger and UI.
4. **BLOCK is a deterministic stop** — No retries unless explicitly initiated by a human or policy outside Phase 7.
5. **BudgetService is invoked, not a scheduler** — Invoked by existing execution and tool-call paths; does not schedule, defer, or re-order work.
6. **Phase 6 orchestration semantics do not change** — No changes to Plan Orchestrator logic itself; governance layers wrap existing paths.
7. **No ML, adaptive thresholds, or auto-remediation** — Phase 7 remains certifiable and enterprise-governable.

---

## 1.1) Architecture Invariants (from Outline)

| Invariant | Source | Implementation |
|-----------|--------|----------------|
| **No validator state mutation** | Outline § Invariants | Validators may not mutate state, trigger retries, fetch new data, or request additional tool calls. |
| **Block/warn only** | Outline § Invariants | Validators may only block/warn — never "fix"; no just-in-time enrichment. |
| **WARN semantics** | Outline § Invariants | WARN must never alter execution flow; it may only annotate the ledger and UI. |
| **BLOCK semantics** | Outline § Invariants | BLOCK must result in a deterministic stop of the current operation, with no retries unless explicitly initiated by a human or policy outside Phase 7. |
| **Budget determinism** | Outline § Invariants | Budget checks must be deterministic; BudgetService invoked by existing paths; does not schedule, defer, or re-order. |
| **Ledger append-only** | Outline § Invariants | Ledger remains append-only; every validator and budget decision written for audit. |
| **Phase 6 semantics unchanged** | Outline § Invariants | No changes to Plan Orchestrator logic; Phase 6 plan lifecycle, conflict resolution, and execution paths unchanged. |
| **Validator execution points** | Outline § Validator Execution Points | Validators run only at: before plan approval, before step execution, before external writebacks, before expensive reads. |
| **Order semantics** | Outline § Core Concept | Validators are logically order-independent (no reliance on prior validator output); gateway may execute in fixed order for consistency and reporting. |
| **Out of scope** | Outline § Out of Scope | No retraining, self-improving agents, cross-tenant optimization, priority queues, heuristic safety. |

---

## 1.2) Zero Trust (Mandatory)

Phase 7 **preserves** the zero-trust posture. All Phase 7 work must comply with:

- **Reference:** [Phase 2 Zero Trust Implementation Plan](../phase_2/ZERO_TRUST_IMPLEMENTATION_PLAN.md) — unchanged.
- **New resources:** Any new Lambda, API, DynamoDB table, or IAM role: least privilege, tenant-scoped where applicable, audit logging.
- **Plan Ledger:** Validator and budget decisions are first-class audit entries; append-only; no mutation or deletion of historical events.
- **No bypass of Phase 6:** ValidatorGateway and BudgetService are invoked from existing orchestration and execution paths only; no new execution back door.

---

## 2) New Capabilities Introduced

### 2.1 ValidatorGateway

- **Role:** Run validators at defined choke points; aggregate results; emit ledger events.
- **Execution:** Runs validators in a fixed order for consistency and reporting; validators remain logically order-independent (no reliance on prior validator output). **Run all validators and record all results** — do not short-circuit when one returns BLOCK; every validator result is written to the Plan Ledger. See [PHASE_7_CONTRACTS_ADDENDUM.md](PHASE_7_CONTRACTS_ADDENDUM.md) §4.
- **Input:** Context for the choke point (e.g. plan snapshot, step, data source, cost class).
- **Output:** Aggregated result **ALLOW | WARN | BLOCK** with structured reasons; if any validator returns BLOCK, aggregate is BLOCK; else if any WARN, aggregate is WARN; else ALLOW.
- **Side effects:** None; only writes to Plan Ledger (append).
- **Choke points:** Before plan approval; before step execution; before external writebacks; before expensive reads.

---

### 2.2 Validators (baseline set)

Each validator is deterministic, explainable, side-effect free, and returns **ALLOW | WARN | BLOCK** with structured reason and details.

1. **Freshness Validator**
   - **Contract:** `age > hard_ttl` → BLOCK; `age > soft_ttl` and `age ≤ hard_ttl` → WARN; `age ≤ soft_ttl` → ALLOW. Per-source config (hard_ttl, soft_ttl); even if soft_ttl == hard_ttl initially, encode the distinction. See [PHASE_7_CONTRACTS_ADDENDUM.md](PHASE_7_CONTRACTS_ADDENDUM.md) §1.
   - Input: data source identifier, last-updated timestamp (or equivalent), TTL config per source.
   - Emits: `{ "validator": "freshness", "result": "BLOCK" | "WARN" | "ALLOW", "reason": string, "details": object }`.

2. **Grounding Validator**
   - **Contract:** Action-level only. Every executable action or writeback must include ≥1 evidence reference from canonical memory or trusted state. Do not require sentence-level grounding. See [PHASE_7_CONTRACTS_ADDENDUM.md](PHASE_7_CONTRACTS_ADDENDUM.md) §2.
   - Input: plan step (or proposal) and available evidence references (canonical state, memory).
   - No free-form rationales without at least one source reference.

3. **Contradiction Validator**
   - **Contract:** Canonical snapshot = the same snapshot already passed into Phase 6 planning; no re-reads during validation. See [PHASE_7_CONTRACTS_ADDENDUM.md](PHASE_7_CONTRACTS_ADDENDUM.md) §3.
   - Detects conflicts with that canonical state snapshot.
   - Scoped to Phase 6–trusted canonical state sources only (not speculative signals).
   - Input: plan step (or proposal) + the canonical state snapshot used for planning.

4. **Compliance / Field Guard Validator**
   - Prevents restricted fields, PII, or tenant-prohibited actions.
   - Tenant/config-driven allow/deny lists.

Every validator decision is written to the Plan Ledger.

---

### 2.3 BudgetService

- **Role:** Track usage; enforce caps; return ALLOW/WARN/BLOCK for cost-sensitive operations.
- **Invocation:** Invoked by existing execution and tool-call paths (e.g. before expensive read, before LLM call); does not schedule, defer, or re-order work.
- **Cost classes (baseline):** CHEAP (cached reads, lightweight signals), MEDIUM (standard API calls), EXPENSIVE (scraping, enrichment, large LLM calls).
- **Scoping:** Budgets scoped by tenant, account, plan, tool, day/month. Multiple caps may apply.
- **Precedence:** BLOCK if *any* applicable hard cap is exceeded; WARN if *any* applicable soft cap is exceeded and no hard cap is exceeded; else ALLOW. See [PHASE_7_CONTRACTS_ADDENDUM.md](PHASE_7_CONTRACTS_ADDENDUM.md) §5.
- **Output:** All decisions logged to ledger.
- **Deterministic:** Same inputs and current usage → same result.

---

### 2.4 Cost Classes and Budget Enforcement

- **CHEAP** — Cached reads, lightweight signals; typically no hard cap for Phase 7 baseline.
- **MEDIUM** — Standard API calls; configurable per-tenant/day or similar.
- **EXPENSIVE** — Scraping, enrichment, large LLM calls; hard cap (e.g. 50 EXPENSIVE reads/day/tenant) and optional WARN threshold.

Budget violations: BLOCK (hard cap), WARN (soft threshold). All budget decisions logged to the ledger.

---

### 2.5 Metrics and Dashboards

- **Validator block rate** (by validator type).
- **Budget consumption** (by cost class, tenant, account).
- **Plan success vs pause vs abort** (existing + validator/budget attribution where applicable).
- **Orchestrator throughput** (unchanged from Phase 6).
- **Average time-in-plan** (unchanged).
- **% plans requiring human intervention** (unchanged).

Implementation: CloudWatch (or equivalent) metrics; alerting hooks. No new execution logic; observability only.

---

### 2.6 Outcomes Capture (Phase 7.4 — scaffolding only)

- **Role:** Capture outcomes so learning is possible later; **does not train models**.
- **Captured:** Approved vs rejected actions, seller edits, execution success/failure, plan completion reason, downstream outcomes (win/loss later).
- **Storage:** Outcomes table (or equivalent) + Ledger for audit.
- **Behavior:** No change to decision or execution logic; write-only capture.

---

## 3) Epics & Stories

---

## EPIC 7.1 — Validators Layer (Gateway + Baseline Validators)

### Story 7.1.1 — ValidatorGateway and execution points

- Implement ValidatorGateway: run validators in a fixed order; **run all validators and record all results** (no short-circuit on BLOCK); aggregate results (ANY BLOCK → BLOCK); emit ledger events. See addendum §4.
- Integrate at choke points: before plan approval; before step execution; before external writebacks; before expensive reads.
- Validators are logically order-independent; gateway executes in fixed order for consistency and reporting.
- No state mutation; no retries, no fetch-new-data, no additional tool calls from validators.

**Acceptance**

- ValidatorGateway runs at all four choke points; **every** validator result written to Plan Ledger; aggregate result written; no short-circuit.
- No change to Plan Orchestrator logic; gateway is invoked from existing paths only.

---

### Story 7.1.2 — Freshness Validator

- Implement Freshness Validator per addendum §1: `age > hard_ttl` → BLOCK; `age > soft_ttl` and `age ≤ hard_ttl` → WARN; `age ≤ soft_ttl` → ALLOW. Per-source config (hard_ttl, soft_ttl).
- Input: data source identifier, last-updated timestamp (or equivalent), TTL config per source (hard_ttl, soft_ttl).
- Output: ALLOW | WARN | BLOCK with reason (e.g. DATA_STALE) and details (source, age_days).
- Deterministic, side-effect free; result written to ledger via ValidatorGateway.

**Acceptance**

- Contract from addendum §1 enforced; reason and details in ledger; no execution when BLOCK.

---

### Story 7.1.3 — Grounding Validator

- Implement Grounding Validator per addendum §2: action-level only; every executable action or writeback must include ≥1 evidence reference from canonical memory or trusted state; no sentence-level grounding.
- Input: plan step (or proposal) and available evidence references (canonical state, memory).
- Output: ALLOW | WARN | BLOCK with reason and details.
- Deterministic, side-effect free.

**Acceptance**

- Action without ≥1 evidence reference results in WARN or BLOCK per config; result in ledger; no state mutation.

---

### Story 7.1.4 — Contradiction Validator

- Implement Contradiction Validator per addendum §3: canonical snapshot = the same snapshot passed into Phase 6 planning; no re-reads during validation.
- Input: plan step (or proposal) + the canonical state snapshot used for planning (e.g. renewal status, key fields).
- Output: ALLOW | WARN | BLOCK with reason and details.
- Deterministic, side-effect free; scope limited to Phase 6–trusted sources.

**Acceptance**

- Contradictions with that snapshot result in BLOCK or WARN; reason in ledger; no re-reads during validation.

---

### Story 7.1.5 — Compliance / Field Guard Validator

- Implement Compliance / Field Guard Validator: prevent restricted fields, PII, or tenant-prohibited actions.
- Tenant/config-driven allow/deny lists; no heuristic logic.
- Output: ALLOW | WARN | BLOCK with reason and details.
- Deterministic, side-effect free.

**Acceptance**

- Restricted field or tenant-prohibited action results in BLOCK; reason in ledger; config-driven only.

---

## EPIC 7.2 — Budgets and Cost Classes

### Story 7.2.1 — Cost classes and budget schema

- Define cost classes: CHEAP, MEDIUM, EXPENSIVE (per outline).
- Define budget schema: scope (tenant, account, plan, tool), period (day/month), cap and optional WARN threshold per cost class.
- Storage: config or table; tenant-scoped; no cross-tenant reads.

**Acceptance**

- Cost classes and budget config are defined and stored; BudgetService can read them for enforcement.

---

### Story 7.2.2 — BudgetService (track, enforce, ledger)

- Implement BudgetService per addendum §5: BLOCK if *any* applicable hard cap is exceeded; WARN if *any* applicable soft cap is exceeded and no hard cap is exceeded; else ALLOW.
- Track usage per scope and cost class; enforce caps; return ALLOW/WARN/BLOCK.
- Invoked by existing execution and tool-call paths (e.g. before expensive read, before LLM call); does not schedule, defer, or re-order work.
- All budget decisions logged to Plan Ledger.
- Deterministic: same current usage and caps → same result.

**Acceptance**

- Precedence from addendum §5 enforced; all outcomes logged; no change to orchestrator scheduling.

---

### Story 7.2.3 — Instrument execution paths for cost class and BudgetService

- Tag operations with cost class (CHEAP/MEDIUM/EXPENSIVE) at execution path (e.g. tool adapter, LLM gateway).
- Invoke BudgetService before EXPENSIVE (and optionally MEDIUM) operations; respect BLOCK (do not proceed); WARN annotates ledger/UI only.
- No new execution paths; instrumentation only.

**Acceptance**

- Expensive operations are gated by BudgetService; BLOCK prevents execution; WARN does not alter flow; usage tracked accurately.

---

## EPIC 7.3 — Observability and Dashboards

### Story 7.3.1 — Validator and budget metrics

- Emit metrics: validator block rate by validator type; budget consumption by cost class (and tenant/account where applicable); plan success/pause/abort (existing plus validator/budget attribution if needed).
- CloudWatch (or equivalent); no new business logic.

**Acceptance**

- Operators can see validator block rates and budget consumption; metrics available for dashboards and alerts.

---

### Story 7.3.2 — Dashboards and alerting hooks

- Dashboards: validator block rate (by type), budget consumption (by cost class), plan success vs pause vs abort, orchestrator throughput, average time-in-plan, % plans requiring human intervention.
- Alerting hooks: e.g. block rate above threshold, budget approaching cap; runbooks or docs for "why was this blocked?" (ledger + UI).

**Acceptance**

- Operators can answer "Is autonomy helping or hurting us?" and "Why was this action blocked or warned?" from dashboards and ledger/UI.

---

## EPIC 7.4 — Outcomes Capture (Scaffolding)

### Story 7.4.1 — Outcomes capture (no training)

- Capture: approved vs rejected actions, seller edits, execution success/failure, plan completion reason, downstream outcomes (win/loss later) where available.
- Store in Outcomes table (or equivalent) and Ledger for audit.
- No change to decision or execution logic; write-only capture. No model retraining or self-improvement.

**Acceptance**

- Outcomes are captured and stored; Phase 7 does not train models or change behavior based on outcomes; substrate for Phase 8+ learning only.

---

## 4) Phase 7 Definition of Done

Phase 7 is complete when:

- ValidatorGateway exists and runs at all four choke points (before plan approval, before step execution, before external writebacks, before expensive reads).
- Baseline validators (Freshness, Grounding, Contradiction, Compliance/Field Guard) are implemented and integrated; they can deterministically block unsafe actions.
- BudgetService is implemented; budget overruns are prevented at runtime (BLOCK at cap); WARN and BLOCK logged to ledger.
- Cost classes (CHEAP, MEDIUM, EXPENSIVE) are defined and instrumented; execution paths invoke BudgetService where required; BudgetService does not schedule, defer, or re-order work.
- Operators can explain *why* actions were blocked or warned (ledger + UI).
- Dashboards and metrics: validator block rate, budget consumption, plan success/pause/abort, orchestrator throughput, time-in-plan, % human intervention.
- Outcomes capture (scaffolding): approved/rejected actions, seller edits, execution outcomes, plan completion reason stored for future learning; no training in Phase 7.
- No Phase 6 orchestration semantics changed; Plan Ledger remains append-only; all Phase 7 invariants (§1.1) hold.

---

## 5) What Is Out of Scope (Phase 7)

- **Model retraining** — No training or model updates in Phase 7.
- **Self-improving agents** — No adaptive thresholds or auto-remediation.
- **Cross-tenant optimization** — No cross-tenant logic.
- **Priority queues or preemption** — No scheduling changes; BudgetService and validators do not re-order work.
- **Heuristic safety logic** — Deterministic, config-driven only.
- **Validators as "fixers"** — Block/warn only; no state mutation, no retries, no fetch-new-data from validators.

This keeps Phase 7 auditable and certifiable.

---

## 6) What Comes After Phase 7

Possible future phases:

- Phase 8+ learning (using Outcomes capture); model retraining or feedback loops only with explicit scope and governance.
- Richer validators (e.g. domain-specific) within same invariants.
- Cross-tenant or cost optimization with explicit scope and approval.

These are **intentionally deferred**.

---

## 7) Recommended Order of Attack

1. **Phase 7.1 — Validators (freshness + grounding first)** — ValidatorGateway + Freshness + Grounding, then Contradiction + Compliance.
2. **Phase 7.2 — Budgets + cost classes** — Cost classes and schema, then BudgetService, then instrument execution paths.
3. **Phase 7.3 — Dashboards + alerts** — Metrics, then dashboards and alerting hooks.
4. **Phase 7.4 — Outcomes capture** — Scaffolding only; no training.

Do not start with budgets before validators — quality first, then cost.

---

## One-line framing

> Phase 6 lets the system stay on course. Phase 7 lets the business trust it at scale.

---

## Cross-reference: Implementation Plan ↔ Outline

Use this to jump between the implementation plan and the outline. The **canonical** source for Phase 7 scope and invariants is [PHASE_7_OUTLINE.md](PHASE_7_OUTLINE.md).

| Implementation Plan | Outline (PHASE_7_OUTLINE.md) |
|---------------------|------------------------------|
| §0 Phase 7 Objective | Where you are now; Phase 7 Objective (precise); What Phase 7 adds |
| §1 Core Principles | Core Concept: Validators ≠ Policies; Invariants |
| §1.1 Architecture Invariants | Invariants; Validator Execution Points; Out of Scope |
| §2.1 ValidatorGateway | Phase 7 Architecture Additions → ValidatorGateway |
| §2.2 Validators (baseline) | Phase 7.1 — Validators Layer (Freshness, Grounding, Contradiction, Compliance) |
| §2.3 BudgetService | Phase 7.2 — Budgets and Cost Classes; Architecture → BudgetService |
| §2.4 Cost Classes | Phase 7.2 — Cost classes (baseline); Budget enforcement |
| §2.5 Metrics and Dashboards | Phase 7.3 — Observability & Dashboards |
| §2.6 Outcomes Capture | Phase 7.4 — Outcomes & Learning Scaffolding |
| §3 EPIC 7.1 | Phase 7.1 — Validators Layer |
| §3 EPIC 7.2 | Phase 7.2 — Budgets and Cost Classes |
| §3 EPIC 7.3 | Phase 7.3 — Observability & Dashboards |
| §3 EPIC 7.4 | Phase 7.4 — Outcomes capture |
| §4 Definition of Done | Phase 7 success criteria |
| §5 Out of Scope | Out of Scope (Phase 7) |
| §7 Order of attack | Recommended order of attack |

**Note:** The outline on disk includes tightened invariants (WARN/BLOCK semantics, validator no-mutation, BudgetService not a scheduler, contradiction scope, Phase 7 success criteria). When cross-referencing, use the current [PHASE_7_OUTLINE.md](PHASE_7_OUTLINE.md) file. **Validator and budget contracts:** use [PHASE_7_CONTRACTS_ADDENDUM.md](PHASE_7_CONTRACTS_ADDENDUM.md) before coding.

---

## References

- **Phase 7 outline:** [PHASE_7_OUTLINE.md](PHASE_7_OUTLINE.md)
- **Phase 7 contracts addendum:** [PHASE_7_CONTRACTS_ADDENDUM.md](PHASE_7_CONTRACTS_ADDENDUM.md)
- **Phase 6 implementation plan:** [../phase_6/PHASE_6_IMPLEMENTATION_PLAN.md](../phase_6/PHASE_6_IMPLEMENTATION_PLAN.md)
- **Phase 6 outline:** [../phase_6/PHASE_6_OUTLINE.md](../phase_6/PHASE_6_OUTLINE.md)
- **Phase 2 zero trust:** [../phase_2/ZERO_TRUST_IMPLEMENTATION_PLAN.md](../phase_2/ZERO_TRUST_IMPLEMENTATION_PLAN.md)
