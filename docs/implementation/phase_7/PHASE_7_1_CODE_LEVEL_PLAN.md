# Phase 7.1 — Validators Layer: Code-Level Plan

**Status:** 🟢 **COMPLETE**  
**Created:** 2026-01-31  
**Parent:** [PHASE_7_CODE_LEVEL_PLAN.md](PHASE_7_CODE_LEVEL_PLAN.md)  
**Canonical contract:** [PHASE_7_IMPLEMENTATION_PLAN.md](PHASE_7_IMPLEMENTATION_PLAN.md) EPIC 7.1, Stories 7.1.1–7.1.5  
**Contracts addendum:** [PHASE_7_CONTRACTS_ADDENDUM.md](PHASE_7_CONTRACTS_ADDENDUM.md) §§1–4 (Freshness, Grounding, Contradiction, Validator execution)  
**Prerequisites:** Phase 6.1–6.5 complete (Plan Ledger, PlanPolicyGateService, PlanOrchestratorService, plan-lifecycle API).

---

## Overview

Phase 7.1 introduces the **ValidatorGateway** and four baseline validators (Freshness, Grounding, Contradiction, Compliance/Field Guard). Validators run at four choke points; all results are recorded to the Plan Ledger (no short-circuit on BLOCK). No changes to Plan Orchestrator logic—ValidatorGateway is invoked from existing paths.

**Deliverables:**
- Validator types (ValidatorResult, ValidatorContext, choke point, evidence reference shape)
- ValidatorGatewayService: run all validators in fixed order; aggregate; append every result to Plan Ledger
- FreshnessValidator (hard_ttl/soft_ttl; single evaluation time from context)
- GroundingValidator (action-level; evidence reference shape: source_type+source_id, ledger_event_id, record_locator)
- ContradictionValidator (canonical snapshot input; field allowlist; null/unknown = not contradictory unless compliance)
- ComplianceValidator (tenant/config allow/deny; no heuristic logic)
- Plan Ledger extension: validator event types and payloads
- Integration: call ValidatorGateway from plan approval path, orchestrator (before step), execution (before writeback, before expensive read)

**Dependencies:** Phase 6 Plan Ledger (append-only); PlanLifecycleService, PlanPolicyGateService; execution path and orchestrator entry points for choke-point invocation.

**Out of scope for 7.1:** Budgets (7.2); sentence-level grounding; validators that mutate state, retry, or fetch new data.

---

## Implementation Tasks

1. Type definitions: ValidatorResult, ValidatorContext, ValidatorChokePoint, evidence reference shape, Plan Ledger validator event payloads
2. ValidatorGatewayService: run validators in fixed order; run all, record all (no short-circuit); aggregate; append to Plan Ledger
3. FreshnessValidator: addendum §1 (hard_ttl, soft_ttl, single evaluation time)
4. GroundingValidator: addendum §2 (action-level, evidence reference shape)
5. ContradictionValidator: addendum §3 (canonical snapshot, field allowlist, null/unknown semantics)
6. ComplianceValidator: tenant/config allow/deny lists
7. Plan Ledger: extend PlanLedgerEventType and data payload for VALIDATOR_RUN
8. Choke-point integration: plan approval API; orchestrator before step; execution before writeback and before expensive read
9. Config: TTL per source (hard_ttl, soft_ttl); contradiction field allowlist; compliance allow/deny (file or table)
10. Unit tests: each validator (all branches per addendum); ValidatorGateway (run-all, aggregate, ledger); choke-point invocation

---

## 1. Type Definitions

### File: `src/types/governance/ValidatorTypes.ts` (new)

**ValidatorChokePoint** — where validation runs (explicit; no ad-hoc placement).

```typescript
export type ValidatorChokePoint =
  | 'BEFORE_PLAN_APPROVAL'
  | 'BEFORE_STEP_EXECUTION'
  | 'BEFORE_EXTERNAL_WRITEBACK'
  | 'BEFORE_EXPENSIVE_READ';
```

**ValidatorResultKind** — ALLOW | WARN | BLOCK only.

```typescript
export type ValidatorResultKind = 'ALLOW' | 'WARN' | 'BLOCK';
```

**ValidatorResult** — per-validator output (deterministic, side-effect free).

```typescript
export interface ValidatorResult {
  validator: string;           // e.g. 'freshness' | 'grounding' | 'contradiction' | 'compliance'
  result: ValidatorResultKind;
  reason?: string;             // e.g. DATA_STALE, MISSING_EVIDENCE, CONTRADICTION, RESTRICTED_FIELD, NOT_APPLICABLE
  details?: Record<string, unknown>;  // Freshness: evaluated_sources, worst_result, worst_source_id (§3 canonical)
}
```

**ValidatorContext** — input passed into ValidatorGateway; must include **evaluation_time_utc_ms** (single evaluation time for Freshness; addendum §1) and **idempotency fields** so duplicate invocations do not produce divergent results.

```typescript
export interface ValidatorContext {
  choke_point: ValidatorChokePoint;
  evaluation_time_utc_ms: number;   // UTC epoch ms; same for all validators in this run (no Date.now() in validators)
  /** Stable id for this validation run; caller supplies at entry point. Idempotency key component. */
  validation_run_id: string;
  /** Hash or version of canonical_snapshot used in Phase 6; enables idempotent replay. */
  snapshot_id?: string;
  /** Required. plan_id | step_id | writeback_id | expensive_read_id; identifies the target of validation. Idempotency key component. */
  target_id: string;
  tenant_id: string;
  account_id?: string;
  plan_id?: string;
  step_id?: string;
  /** Plan snapshot (for plan approval or step execution). */
  plan?: import('../plan/PlanTypes').RevenuePlanV1;
  /** Step or proposal being validated (for step/writeback). Must include evidence/evidence_refs per Grounding contract. */
  step_or_proposal?: ExecutablePayload;
  /** Canonical state snapshot used for Phase 6 planning (for Contradiction); no re-reads. */
  canonical_snapshot?: Record<string, unknown>;
  /** Evidence references available (for Grounding whitelist check). */
  evidence_references?: EvidenceReference[];
  /** Data source id + last-updated for Freshness. */
  data_sources?: { source_id: string; last_updated_utc_ms: number }[];
  /** Payload for writeback (for Compliance/field guard). */
  writeback_payload?: Record<string, unknown>;
}

/** Executable action or writeback; must carry evidence refs for Grounding. */
export interface ExecutablePayload {
  /** Required: ≥1 evidence reference in allowed shape. Field name is canonical. */
  evidence: EvidenceReference[];
  [key: string]: unknown;
}
```

**Idempotency key:** `(tenant_id, choke_point, target_id, snapshot_id?, validation_run_id)`. **target_id is required** for all choke points (plan_id, step_id, writeback_id, or expensive_read_id as applicable) to avoid accidental collisions. Caller must pass a stable `validation_run_id` at the entry point. Do not use `evaluation_time_utc_ms` as the idempotency key. **ValidatorContext is defined once in §1 only; no other definition in this document.**

**EvidenceReference** — addendum §2; one of three shapes only (no free-form strings).

```typescript
export type EvidenceReference =
  | { source_type: string; source_id: string }           // e.g. canonical.crm.opportunity, opp:123
  | { ledger_event_id: string }
  | { record_locator: RecordLocator };

export interface RecordLocator {
  system: string;
  object: string;
  id: string;
  fields?: string[];
}
```

**ValidatorGatewayResult** — aggregate + per-validator results (all recorded; addendum §4).

```typescript
export interface ValidatorGatewayResult {
  aggregate: ValidatorResultKind;   // BLOCK if any BLOCK; else WARN if any WARN; else ALLOW
  results: ValidatorResult[];      // one per validator run (all run, no short-circuit)
}
```

---

## 2. ValidatorGatewayService

### File: `src/services/governance/ValidatorGatewayService.ts` (new)

**Contract (addendum §4):** Run all validators in a **fixed order**; do **not** short-circuit when one returns BLOCK; append **every** validator result to Plan Ledger; then compute aggregate.

**Idempotency:** ValidatorGateway executions are idempotent per `(tenant_id, choke_point, target_id, snapshot_id, validation_run_id)` (see ValidatorContext). Caller must supply stable `validation_run_id` at entry point. Duplicate invocations with the same identity must not produce divergent aggregate results. See parent [PHASE_7_CODE_LEVEL_PLAN.md](PHASE_7_CODE_LEVEL_PLAN.md) § Implementation contract clarifications.

**Fixed order (recommended):** Freshness → Grounding → Contradiction → Compliance. Document in code; same order for every choke point for consistency and reporting.

**Applicable validators per choke point:** The gateway runs **all four** validators at every choke point. When a validator's **required inputs are missing** (e.g. no data_sources at BEFORE_EXPENSIVE_READ for Freshness, no step_or_proposal for Grounding), that validator returns **ALLOW with reason `NOT_APPLICABLE`** (and optional details). This preserves run-all semantics while preventing false WARN/BLOCK due to missing context. Applicability by choke point:
- **BEFORE_PLAN_APPROVAL:** all four applicable (plan, snapshot, evidence, data_sources, writeback context available).
- **BEFORE_STEP_EXECUTION:** all four applicable.
- **BEFORE_EXTERNAL_WRITEBACK:** Grounding + Compliance always; Contradiction if snapshot/step present; Freshness if writeback references data sources.
- **BEFORE_EXPENSIVE_READ:** Freshness always (data_sources); Grounding/Contradiction typically N/A (no step_or_proposal); Compliance N/A unless operation type is checked.

**Methods:**

- `run(context: ValidatorContext): Promise<ValidatorGatewayResult>`
  1. Run FreshnessValidator.validate(context) → result1; append result1 to Plan Ledger (VALIDATOR_RUN payload with validator name + result + reason + details).
  2. Run GroundingValidator.validate(context) → result2; append result2 to Plan Ledger.
  3. Run ContradictionValidator.validate(context) → result3; append result3 to Plan Ledger.
  4. Run ComplianceValidator.validate(context) → result4; append result4 to Plan Ledger.
  5. Aggregate: if any result === 'BLOCK' → aggregate = 'BLOCK'; else if any === 'WARN' → aggregate = 'WARN'; else aggregate = 'ALLOW'.
  6. **Summary write (required):** Append one final ledger entry for this run: VALIDATOR_RUN_SUMMARY with choke_point, evaluation_time_utc_ms, aggregate, all results (or reference entry_ids). If the summary cannot be appended (e.g. Plan Ledger write fails): set aggregate = 'BLOCK'; append to results a synthetic entry `{ validator: 'gateway', result: 'BLOCK', reason: 'LEDGER_WRITE_FAILED', details: {} }`; return ValidatorGatewayResult with that aggregate and results—so audit integrity failure is visible and governance remains enforceable.
  7. Return ValidatorGatewayResult.

**Dependencies:** FreshnessValidator, GroundingValidator, ContradictionValidator, ComplianceValidator (inject or import); PlanLedgerService. No state mutation; no retries; no fetch-new-data.

**Ledger writes:** For each validator, one append (per-validator result). Then **one required** append for the run summary (VALIDATOR_RUN_SUMMARY). Summary write is best-effort-but-required: if it fails, treat as BLOCK (LEDGER_WRITE_FAILED) so operators never lose the aggregate decision record. **Replay / duplicate entries:** If the same validation_run_id is replayed, the gateway may append duplicate VALIDATOR_RUN events; consumers must correlate using validation_run_id and rely on the latest VALIDATOR_RUN_SUMMARY for the aggregate decision. (Alternatively implement strict dedupe in ledger—either way, document the chosen behavior.)

---

## 3. Freshness Validator

### File: `src/services/governance/validators/FreshnessValidator.ts` (new)

**Contract (addendum §1):** `age > hard_ttl` → BLOCK; `age > soft_ttl` and `age ≤ hard_ttl` → WARN; `age ≤ soft_ttl` → ALLOW. **age** = time since last update; use **context.evaluation_time_utc_ms** as "now" (do not call Date.now() inside validator). TTL config per source (hard_ttl_ms, soft_ttl_ms or days converted to ms).

**Method:** `validate(context: ValidatorContext): ValidatorResult`

- Input: context.data_sources (source_id, last_updated_utc_ms), context.evaluation_time_utc_ms, TTL config (from config or context).
- For each data source: age_ms = evaluation_time_utc_ms - last_updated_utc_ms. Compare to hard_ttl_ms and soft_ttl_ms for that source; per-source result = ALLOW | WARN | BLOCK per addendum §1.
- **Details (canonical shape only):** Return `details` with **this shape only** (do not use legacy `{ source, age_days }` alone—ops/dashboards rely on full shape):
  - `evaluated_sources: Array<{ source_id: string; age_ms: number; soft_ttl_ms: number; hard_ttl_ms: number; result: 'ALLOW' | 'WARN' | 'BLOCK' }>`
  - `worst_result: 'ALLOW' | 'WARN' | 'BLOCK'` (strictest across sources)
  - `worst_source_id?: string` (one source that produced worst_result)
- If context.data_sources is missing or empty → return ALLOW with reason `NOT_APPLICABLE` (Freshness not applicable at this choke point).
- If any source has age > hard_ttl → result = 'BLOCK'; else if any age > soft_ttl → result = 'WARN'; else result = 'ALLOW'.
- Deterministic; side-effect free; no DB read inside validator. TTL config: from ValidatorContext or from a config service passed in (no fetch inside validate()).

**Config:** File `src/config/freshnessTtlConfig.ts` or table keyed by (tenant_id, source_id). Shape: `{ source_id: string; hard_ttl_ms: number; soft_ttl_ms: number }[]`. Defaults if missing: e.g. hard_ttl 14 days, soft_ttl 7 days for CRM.

---

## 4. Grounding Validator

### File: `src/services/governance/validators/GroundingValidator.ts` (new)

**Contract (addendum §2):** Action-level only. Every executable action or writeback must include ≥1 evidence reference in defined shape (source_type+source_id, ledger_event_id, record_locator). Free-form strings do not qualify.

**Standardized field:** Executable objects (step_or_proposal) must carry evidence on a **single canonical field**: `evidence: EvidenceReference[]` (or `evidence_refs`; document one and use consistently). Grounding check: (1) `step_or_proposal.evidence` exists and has length ≥ 1; (2) each entry matches one of the three EvidenceReference shapes; (3) optional: each reference is present in `context.evidence_references` (whitelist). If step_or_proposal is untyped, require a documented path (e.g. `step_or_proposal.evidence` or `step_or_proposal.evidence_refs`).

**Method:** `validate(context: ValidatorContext): ValidatorResult`

- Input: context.step_or_proposal (ExecutablePayload with `evidence`), context.evidence_references (whitelist of valid refs).
- If context.step_or_proposal is missing → return ALLOW with reason `NOT_APPLICABLE` (Grounding not applicable at this choke point).
- Check: Does step_or_proposal.evidence exist, length ≥ 1, and each element match one of the three EvidenceReference shapes? If whitelist is used: each ref in step_or_proposal.evidence must appear in context.evidence_references (by structure match).
- If no valid evidence reference (missing field, empty, or invalid shape) → return WARN or BLOCK per config (config.grounding_missing_action = 'WARN' | 'BLOCK').
- Else return ALLOW.
- Deterministic; side-effect free; no DB read inside validator.

**Config:** Per tenant: grounding_missing_action = 'WARN' | 'BLOCK'. Default BLOCK for Phase 7 baseline.

---

## 5. Contradiction Validator

### File: `src/services/governance/validators/ContradictionValidator.ts` (new)

**Contract (addendum §3):** Canonical snapshot = same snapshot passed into Phase 6 planning; no re-reads. Contradiction applies only to a **defined field allowlist** with **typed per-field semantics**. Treat null/unknown as not contradictory unless compliance explicitly blocks.

**Field semantics (typed config):** Per-field rules are deterministic and tenant-configurable. Use a typed map, not ad-hoc rules.

```typescript
type ContradictionFieldRule =
  | { kind: 'eq' }                                    // strict equality; step must equal snapshot
  | { kind: 'no_backward'; ordering: string[] }       // e.g. stage: ordering = ['lead','qualified','closed']; step must not be earlier in ordering
  | { kind: 'date_window'; max_days_delta: number };  // date fields: step date within max_days_delta of snapshot

interface ContradictionFieldConfig {
  field: string;   // e.g. 'stage', 'renewal_status', 'close_date'
  rule: ContradictionFieldRule;
}
```

**Method:** `validate(context: ValidatorContext): ValidatorResult`

- Input: context.step_or_proposal, context.canonical_snapshot, contradiction config (array of ContradictionFieldConfig).
- If context.step_or_proposal or context.canonical_snapshot is missing → return ALLOW with reason `NOT_APPLICABLE` (Contradiction not applicable at this choke point).
- Only consider configured fields. For each field in config present in both snapshot and step: apply rule (eq → strict equality; no_backward → step not earlier in ordering; date_window → delta within bound). If snapshot or step has null/unknown for that field → not contradictory.
- If any contradiction → return BLOCK or WARN per config; reason CONTRADICTION; details { field, snapshot_value, step_value }.
- Else return ALLOW.
- Deterministic; side-effect free; no re-read; snapshot is that passed in only.

**Config:** File `src/config/contradictionFieldConfig.ts` or table. Shape: `ContradictionFieldConfig[]` (e.g. `{ field: 'stage', rule: { kind: 'no_backward', ordering: ['lead','qualified','closed'] } }`).

---

## 6. Compliance / Field Guard Validator

### File: `src/services/governance/validators/ComplianceValidator.ts` (new)

**Contract:** Prevent restricted fields, PII, or tenant-prohibited actions. Tenant/config-driven allow/deny lists; no heuristic logic.

**Method:** `validate(context: ValidatorContext): ValidatorResult`

- Input: context.step_or_proposal, context.writeback_payload, tenant allow/deny list (restricted fields, prohibited action types).
- If neither step_or_proposal nor writeback_payload is present for this choke point → return ALLOW with reason `NOT_APPLICABLE` (Compliance not applicable).
- If step or writeback contains restricted field or prohibited action → return { validator: 'compliance', result: 'BLOCK', reason: 'RESTRICTED_FIELD' | 'PROHIBITED_ACTION', details: { field_or_action } }.
- Else return ALLOW.
- Deterministic; side-effect free; config-driven only.

**Config:** Tenant-scoped: restricted_fields (string[]), prohibited_action_types (string[]). From config file or table.

---

## 7. Plan Ledger Extension (Validator Events)

### File: `src/types/plan/PlanLedgerTypes.ts` (extend)

**Add to PlanLedgerEventType:**

```typescript
  | 'VALIDATOR_RUN'           // one entry per validator in run (validator name, result, reason, details)
  | 'VALIDATOR_RUN_SUMMARY';   // aggregate result + reference to run (choke_point, evaluation_time_utc_ms, aggregate, results[])
```

**Payload for VALIDATOR_RUN (data):** Every per-validator event must carry idempotency and audit fields so reconstruction is deterministic.

- validation_run_id: string
- target_id: string
- snapshot_id?: string
- choke_point: ValidatorChokePoint
- evaluation_time_utc_ms: number
- validator: string
- result: 'ALLOW' | 'WARN' | 'BLOCK'
- reason?: string
- details?: Record<string, unknown>
- tenant_id, account_id?, plan_id?, step_id? (as applicable)

**Payload for VALIDATOR_RUN_SUMMARY (data):** Same idempotency fields for correlation.

- validation_run_id: string
- target_id: string
- snapshot_id?: string
- choke_point: ValidatorChokePoint
- evaluation_time_utc_ms: number
- aggregate: 'ALLOW' | 'WARN' | 'BLOCK'
- results: ValidatorResult[] (or entry_ids for each VALIDATOR_RUN)
- tenant_id, account_id?, plan_id?, step_id? (as applicable)

**Storage:** Same Plan Ledger table (append-only). Partition/sort key unchanged; query by plan_id or tenant_id for "why was this blocked?"

---

## 8. Choke-Point Integration

**Contract:** ValidatorGateway **does not decide** pause/abort or plan state transitions—it only blocks the operation and records why. Phase 6 logic (orchestrator, lifecycle, execution path) decides what happens after BLOCK (e.g. pause plan, mark step failed, return 4xx).

**WARN semantics (invariant):** **WARN never blocks or alters execution; only annotates ledger + UI.** WARN is not a policy gate. For all choke points: if aggregate is WARN, proceed with the operation and record the WARN in ledger and UI; do not treat WARN as "needs approval" or "block until reviewed."

| Choke point | BLOCK behavior | Who decides post-BLOCK |
|-------------|----------------|------------------------|
| **BEFORE_PLAN_APPROVAL** | Deny approval; no state transition. Return HTTP 4xx with reasons from result.results. | API handler; PlanLifecycleService does not transition. |
| **BEFORE_STEP_EXECUTION** | Do **not** run step; write ledger. Delegate plan/step state to **existing Phase 6 policy** (e.g. mark step failed, pause plan per orchestrator policy). | PlanOrchestratorService / Phase 6 policy; ValidatorGateway does not pause/abort. |
| **BEFORE_EXTERNAL_WRITEBACK** | Do not call connector; return deterministic failure to caller. Phase 6 / execution path handles step outcome (retry, fail, pause). | Execution path; ValidatorGateway does not mutate. |
| **BEFORE_EXPENSIVE_READ** | Do not perform operation; return deterministic failure/skip to caller. Phase 6 handles continuation. | Execution path; ValidatorGateway does not throttle/schedule. |

**Before plan approval:**  
Build ValidatorContext (choke_point: BEFORE_PLAN_APPROVAL, validation_run_id, **target_id=plan_id** (required), snapshot_id, plan, canonical_snapshot, evidence_references, data_sources, evaluation_time_utc_ms at start of request). Call ValidatorGatewayService.run(context). If result.aggregate === 'BLOCK', do not approve; return 400 with reasons from result.results. If WARN, proceed (WARN never blocks); annotate ledger + UI only.

**Before step execution:**  
Build ValidatorContext (choke_point: BEFORE_STEP_EXECUTION, validation_run_id, **target_id=step_id** (required), snapshot_id, step, plan, canonical_snapshot, evidence_references, data_sources, evaluation_time_utc_ms at cycle start). Call ValidatorGatewayService.run(context). If aggregate === 'BLOCK', do not execute step; **delegate** to Phase 6 policy (e.g. mark step failed, pause plan per existing orchestrator rules)—ValidatorGateway only blocks and records. If WARN, proceed; annotate ledger + UI only.

**Before external writeback:**  
Build ValidatorContext (choke_point: BEFORE_EXTERNAL_WRITEBACK, validation_run_id, **target_id=writeback_id** (required), writeback_payload, step_or_proposal, evidence_references, evaluation_time_utc_ms). Call ValidatorGatewayService.run(context). If BLOCK, do not write; return deterministic failure to caller; Phase 6/execution path handles step outcome. If WARN, proceed; annotate ledger + UI only.

**Before expensive read:**  
Any operation tagged with **CostClass.EXPENSIVE** must invoke ValidatorGateway at choke_point BEFORE_EXPENSIVE_READ. Build ValidatorContext (choke_point: BEFORE_EXPENSIVE_READ, validation_run_id, **target_id=expensive_read_id** (required), data_sources, evaluation_time_utc_ms). If BLOCK, do not perform operation; return deterministic failure/skip to caller; Phase 6 handles continuation. If WARN, proceed; annotate ledger + UI only.

**Evaluation time and idempotency:** Caller must set `evaluation_time_utc_ms` and `validation_run_id` once per request/cycle and pass the same values into context. Validators must not call Date.now() themselves. Use validation_run_id (not evaluation_time_utc_ms) as part of idempotency key.

---

## 9. Config and Environment

- **Freshness TTL:** `src/config/freshnessTtlConfig.ts` or env/config table: per source_id (or tenant+source), hard_ttl_ms, soft_ttl_ms.
- **Contradiction field config:** `src/config/contradictionFieldConfig.ts` or table: ContradictionFieldConfig[] (field + typed rule: eq | no_backward | date_window).
- **Compliance:** Tenant config: restricted_fields[], prohibited_action_types[] (file or table).
- **Grounding:** Tenant config: grounding_missing_action = 'WARN' | 'BLOCK'.

**Fail-fast:** If required config is missing (e.g. no TTL config for Freshness when data_sources present), validator or gateway fails; do not fall back to default allow. Environment variables: VALIDATOR_TTL_CONFIG_PATH, CONTRADICTION_FIELDS_CONFIG_PATH, etc., when config is file-based; fail if required config cannot be loaded.

---

## 10. Test Strategy (all required)

See **testing/PHASE_7_1_TEST_PLAN.md** when created. All of the following tests are **required** for definition of done. No test is optional.

- **Required — FreshnessValidator:** age > hard_ttl → BLOCK; age in (soft_ttl, hard_ttl] → WARN; age ≤ soft_ttl → ALLOW; no data_sources → ALLOW with reason NOT_APPLICABLE; details shape canonical (evaluated_sources, worst_result, worst_source_id) only; use context.evaluation_time_utc_ms only (no Date.now()); multiple sources. **Required.**
- **Required — GroundingValidator:** step_or_proposal.evidence exists, length ≥ 1, valid shapes → ALLOW; no step_or_proposal → ALLOW with reason NOT_APPLICABLE; missing or invalid shape → WARN/BLOCK per config; whitelist match against context.evidence_references when configured. **Required.**
- **Required — ContradictionValidator:** configured field + rule (eq, no_backward, date_window) contradiction → BLOCK/WARN; no step_or_proposal or canonical_snapshot → ALLOW with reason NOT_APPLICABLE; null/unknown → not contradictory; non-configured field ignored; no re-read. **Required.**
- **Required — ComplianceValidator:** restricted field or prohibited action → BLOCK; neither step nor writeback present → ALLOW with reason NOT_APPLICABLE; else ALLOW. **Required.**
- **Required — ValidatorGatewayService:** run all four validators; all four results in ledger; no short-circuit on BLOCK; aggregate BLOCK if any BLOCK, else WARN if any WARN, else ALLOW; summary write required—if summary append fails, return BLOCK with reason LEDGER_WRITE_FAILED. **Required.**
- **Required — Choke-point integration:** mock PlanLedgerService; verify ledger receives VALIDATOR_RUN and VALIDATOR_RUN_SUMMARY with correct payloads; verify BLOCK prevents approval/step/writeback/read; verify ValidatorGateway does not decide pause/abort (Phase 6 policy does). **Required.**
- **Required — Replay / determinism:** Same ValidatorContext (including evaluation_time_utc_ms, snapshot_id, same inputs) ⇒ same ValidatorGatewayResult and same per-validator results. Validators must not call Date.now() or use random/key-order-dependent logic that would change results. Add tests that run the same context twice and assert identical results. **Required.**

---

## References

- Parent: [PHASE_7_CODE_LEVEL_PLAN.md](PHASE_7_CODE_LEVEL_PLAN.md)
- Implementation Plan EPIC 7.1: [PHASE_7_IMPLEMENTATION_PLAN.md](PHASE_7_IMPLEMENTATION_PLAN.md)
- Contracts Addendum: [PHASE_7_CONTRACTS_ADDENDUM.md](PHASE_7_CONTRACTS_ADDENDUM.md) §§1–4
- Phase 6 Plan Ledger: [../phase_6/PHASE_6_1_CODE_LEVEL_PLAN.md](../phase_6/PHASE_6_1_CODE_LEVEL_PLAN.md) §3
