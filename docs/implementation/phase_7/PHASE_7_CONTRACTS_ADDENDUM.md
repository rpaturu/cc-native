# Phase 7 — Contracts Addendum

*Explicit contracts for validators, snapshots, and budgets — lock these before implementation*

**Status:** 🟢 **COMPLETE**  
**Created:** 2026-01-31  
**Parent:** [PHASE_7_IMPLEMENTATION_PLAN.md](PHASE_7_IMPLEMENTATION_PLAN.md)  
**Purpose:** Canonical definitions for Phase 7 validator and budget behavior. Implementation must conform to these contracts; no heuristic or adaptive behavior.

---

## 1. Freshness Validator: WARN vs BLOCK thresholds

**Contract (explicit):**

| Condition | Result |
|-----------|--------|
| `age > hard_ttl` | **BLOCK** |
| `age > soft_ttl` and `age ≤ hard_ttl` | **WARN** |
| `age ≤ soft_ttl` | **ALLOW** |

- **age** = time since last update of the underlying data (per source). **Time source:** use UTC epoch milliseconds (or ISO8601) consistently; **age** is computed from a **single evaluation time** passed into the gateway (not `Date.now()` or equivalent inside each validator). This avoids time skew and makes replay deterministic.
- **hard_ttl**, **soft_ttl** = config per source (e.g. per tenant, per data source type).
- Even if `soft_ttl == hard_ttl` initially, the distinction is encoded in the contract so implementations do not conflate WARN and BLOCK.
- Example: CRM opportunity, hard_ttl = 14 days, soft_ttl = 7 days → age 10 days → WARN; age 47 days → BLOCK.

**Out of scope for Phase 7:** Adaptive thresholds, confidence scoring, auto-refresh.

---

## 2. Grounding Validator: scope at action-level

**Contract (explicit):**

- Grounding is defined at **action-level**, not at natural-language or sentence level.
- **Every executable action or writeback must include ≥1 evidence reference** from canonical memory or trusted state.
- **Evidence reference** must be one of:
  - `{source_type, source_id}` (e.g. `canonical.crm.opportunity`, `opp:123`)
  - `{ledger_event_id}` referencing a prior canonical write
  - `{record_locator}` (system + object + id + optional field list)
- Free-form strings do **not** qualify as evidence references; this prevents "grounding" with meaningless identifiers.
- "Claim" = an actionable element (plan step, action intent, writeback payload) that must be tied to evidence.
- Do **not** require sentence-level or phrase-level grounding in Phase 7 — that leads to heuristic interpretation.

**Concrete:**

- Input: plan step (or proposal) and available evidence references (canonical state, memory).
- Check: Does the action/writeback reference at least one evidence item in one of the above shapes that exists in the provided evidence set?
- Missing or invalid reference → WARN or BLOCK per config; no free-form rationales without at least one valid source reference.

**Out of scope for Phase 7:** NLU-level "claim" extraction, confidence-weighted grounding, auto-enrichment.

---

## 3. Contradiction Validator: canonical snapshot timing

**Contract (explicit):**

- **Canonical snapshot** = the same snapshot already passed into Phase 6 planning for the same decision context.
- Validator receives this snapshot as input; it does **not** re-read or fetch newer data during validation.
- No re-reads during validation → preserves determinism and avoids "validator fetched newer data" violations.
- Contradiction is evaluated against this single snapshot; scope remains Phase 6–trusted canonical state sources only (not speculative signals).

**Contradiction match rules (Phase 7–safe):**

- Contradiction applies only to a **defined field allowlist** (e.g. renewal status, stage, close date, amount, primary contact). Config per tenant/plan type; no open-ended "any field" checks.
- Treat `null` / `unknown` in snapshot or step as **not contradictory** unless a separate compliance rule explicitly blocks null/unknown for that field.
- Strict equality or defined semantics per field (e.g. "stage may not move backward"); no heuristic "close enough" matching.

**Concrete:**

- Input: plan step (or proposal) + **the canonical state snapshot used for planning** (e.g. renewal status, key fields at planning time).
- Check: Does the step contradict any **allowlisted** field or fact in that snapshot per the rules above?
- Snapshot is fixed at validation time; no additional reads.

**Out of scope for Phase 7:** Live re-queries, "latest" state fetches inside the validator, speculative or non-canonical sources, open-ended field checks.

---

## 4. Validator execution and reporting semantics

**Contract (explicit):**

- Validators are **logically** order-independent (no validator relies on another validator’s output).
- The gateway runs validators in a **fixed order** for consistency and reporting.
- **Run all validators and record all results**, even if one returns BLOCK.
  - Do **not** short-circuit: do not skip remaining validators when a BLOCK is encountered.
  - Every validator result is written to the Plan Ledger.
- Aggregate result: if **any** validator returns BLOCK → aggregate = BLOCK; otherwise if any WARN → aggregate = WARN; else ALLOW.
- Explainability: operators can see "blocked for freshness *and* non-compliant" (and any other failures) in one pass.

**Out of scope for Phase 7:** Conditional validator execution, retries on WARN, auto-downgrade of actions.

---

## 5. Budget scope and precedence

**Contract (explicit):**

- Budgets can be scoped by: tenant, account, plan, tool, day/month.
- Multiple caps may apply (e.g. tenant hard cap, tool hard cap, plan soft cap).

**Precedence rules:**

| Condition | Result |
|-----------|--------|
| **Any** applicable **hard** cap exceeded | **BLOCK** |
| No hard cap exceeded, but **any** applicable **soft** cap exceeded | **WARN** |
| No hard or soft cap exceeded | **ALLOW** |

- BLOCK if *any* applicable hard cap is exceeded.
- WARN if *any* applicable soft cap is exceeded and no hard cap is exceeded.
- Matches validator aggregation semantics: strictest outcome wins; explainability via ledger (which cap(s) were hit).

**Usage accounting (determinism):**

- **Phase 7 recommendation: reserve-before-execute.** When an operation is about to run (e.g. expensive read, LLM call), BudgetService reserves the usage (increments reserved/consumed for the scope) **before** execution, and the reservation is written to the ledger. This matches "budget as enforcement" and avoids inconsistent behavior on failures/retries (increment-after-success would require rollback on failure and complicates idempotency).
- Do **not** leave accounting point unspecified — implementers must use a single, documented rule (reserve-before-execute for Phase 7).

**Out of scope for Phase 7:** Priority ordering of caps, adaptive caps, cross-tenant optimization, increment-after-success without explicit rollback contract.

---

## Summary table

| Contract | Key rule |
|----------|----------|
| Freshness | hard_ttl → BLOCK; soft_ttl → WARN; ≤ soft_ttl → ALLOW; age from single evaluation time (UTC); no Date.now() in validator |
| Grounding | Action-level; ≥1 evidence reference in defined shape (source_type+source_id, ledger_event_id, record_locator) |
| Contradiction | Same snapshot as Phase 6 planning; no re-reads; defined field allowlist; null/unknown = not contradictory unless compliance |
| Validator execution | Run all validators; record all results; no short-circuit on BLOCK |
| Budget precedence | Any hard cap exceeded → BLOCK; any soft cap exceeded (no hard) → WARN; reserve-before-execute (ledger reservation) |

---

## References

- **Phase 7 outline:** [PHASE_7_OUTLINE.md](PHASE_7_OUTLINE.md)
- **Phase 7 implementation plan:** [PHASE_7_IMPLEMENTATION_PLAN.md](PHASE_7_IMPLEMENTATION_PLAN.md)
