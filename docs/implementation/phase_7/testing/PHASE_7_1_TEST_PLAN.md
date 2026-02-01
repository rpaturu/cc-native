# Phase 7.1 Test Plan — Validators Layer

**Status:** 🟢 **COMPLETE**  
**Created:** 2026-01-31  
**Parent:** [../PHASE_7_1_CODE_LEVEL_PLAN.md](../PHASE_7_1_CODE_LEVEL_PLAN.md)  
**Canonical contract:** [../PHASE_7_IMPLEMENTATION_PLAN.md](../PHASE_7_IMPLEMENTATION_PLAN.md) EPIC 7.1, Stories 7.1.1–7.1.5  
**Contracts addendum:** [../PHASE_7_CONTRACTS_ADDENDUM.md](../PHASE_7_CONTRACTS_ADDENDUM.md) §§1–4  
**Reference:** [../../phase_6/testing/PHASE_6_1_TEST_PLAN.md](../../phase_6/testing/PHASE_6_1_TEST_PLAN.md) — structure and coverage pattern

**All tests in this plan are required for definition of done. No test is optional.**

---

## Gap Analysis (vs 100% Coverage)

| Item | Plan § | Status | Notes |
|------|--------|--------|--------|
| **ValidatorTypes.test.ts** | §1 | 🔲 Pending | Types: ValidatorChokePoint, ValidatorResultKind, ValidatorResult, ValidatorContext, EvidenceReference, ValidatorGatewayResult; idempotency key shape. |
| **FreshnessValidator.test.ts** | §3 | 🔲 Pending | age > hard_ttl → BLOCK; (soft_ttl, hard_ttl] → WARN; ≤ soft_ttl → ALLOW; no data_sources → NOT_APPLICABLE; details canonical shape; evaluation_time_utc_ms only. |
| **GroundingValidator.test.ts** | §4 | 🔲 Pending | evidence exists, length ≥ 1, valid shapes → ALLOW; no step_or_proposal → NOT_APPLICABLE; missing/invalid → WARN/BLOCK per config; whitelist. |
| **ContradictionValidator.test.ts** | §5 | 🔲 Pending | eq, no_backward, date_window rules; NOT_APPLICABLE; null/unknown not contradictory; configured fields only. |
| **ComplianceValidator.test.ts** | §6 | 🔲 Pending | restricted field / prohibited action → BLOCK; neither step nor writeback → NOT_APPLICABLE; else ALLOW. |
| **ValidatorGatewayService.test.ts** | §2 | 🔲 Pending | run all four; all results in ledger; no short-circuit; aggregate; summary write; LEDGER_WRITE_FAILED on summary failure. |
| **Choke-point integration tests** | §8 | 🔲 Pending | PlanLedgerService mock; BLOCK prevents approval/step/writeback/read; gateway does not decide pause/abort. |
| **Replay / determinism** | §10 | 🔲 Pending | Same ValidatorContext twice → identical ValidatorGatewayResult and per-validator results. |
| **Config fail-fast** | §9 | 🔲 Pending | Required config missing (e.g. no TTL when data_sources present) → validator/gateway fails; no default allow fallback. |
| **PlanLedgerTypes (validator events)** | §7 | 🔲 Pending | VALIDATOR_RUN, VALIDATOR_RUN_SUMMARY in PlanLedgerEventType; payload shape asserted in ledger tests. |
| **Evidence path (evidence vs evidence_refs)** | §4 | 🔲 Pending | GroundingValidator: canonical field (evidence or evidence_refs per implementation); assert documented path. |

---

## Executive Summary

This document defines **100% test coverage** requirements for Phase 7.1 (Validators Layer: ValidatorGateway, Freshness, Grounding, Contradiction, Compliance validators). Every validator branch per contracts addendum, ValidatorGateway run-all/aggregate/ledger behavior, choke-point integration, and determinism must be covered by unit tests.

**Coverage target:** **100% statement and branch coverage** for Phase 7.1 code paths: ValidatorTypes, FreshnessValidator, GroundingValidator, ContradictionValidator, ComplianceValidator, ValidatorGatewayService, config loading (freshnessTtlConfig, contradictionFieldConfig, compliance, grounding) when used, Plan Ledger validator event payloads (PlanLedgerTypes VALIDATOR_RUN / VALIDATOR_RUN_SUMMARY), and choke-point invocation sites (plan approval, orchestrator before step, execution before writeback, before expensive read). No branch or statement in these modules may be uncovered.

---

## 1. Type Definitions — ValidatorTypes

**File:** `src/tests/unit/governance/ValidatorTypes.test.ts`

**Scope:** Type invariants and shape validation only (no runtime logic). Required: assert type shape or runtime validation when present.

### ValidatorChokePoint

| Scenario | Expected | Test |
|----------|----------|------|
| All choke point literals | BEFORE_PLAN_APPROVAL, BEFORE_STEP_EXECUTION, BEFORE_EXTERNAL_WRITEBACK, BEFORE_EXPENSIVE_READ | Assert union includes exactly these four (or fixture passes type check). |

### ValidatorResult / ValidatorResultKind

| Scenario | Expected | Test |
|----------|----------|------|
| Result kinds | ALLOW, WARN, BLOCK only | Assert ValidatorResult.result is one of these. |
| Optional reason, details | reason?, details? | Valid result with and without reason/details. |

### ValidatorContext

| Scenario | Expected | Test |
|----------|----------|------|
| Required fields | choke_point, evaluation_time_utc_ms, validation_run_id, target_id, tenant_id | Assert context without any required field fails (if validated) or fixture shape documented. |
| Idempotency key | (tenant_id, choke_point, target_id, snapshot_id?, validation_run_id) | Document in test or assert key derivation. |

### EvidenceReference / RecordLocator

| Scenario | Expected | Test |
|----------|----------|------|
| Three shapes | source_type+source_id; ledger_event_id; record_locator | Assert each shape is valid EvidenceReference. |
| Invalid shape | Free-form string not valid | Reject or fail type check. |

### ValidatorGatewayResult

| Scenario | Expected | Test |
|----------|----------|------|
| aggregate | ValidatorResultKind | BLOCK if any BLOCK; else WARN if any WARN; else ALLOW. |
| results | ValidatorResult[] | One per validator; all four present when all run. |

**Coverage:** Critical type invariants so refactors don’t break contracts; required runtime validation when present.

---

## 2. FreshnessValidator — 100% Branch Coverage

**File:** `src/tests/unit/governance/validators/FreshnessValidator.test.ts`

**Mock:** TTL config (from context or injected config service). No Date.now() inside validator; use context.evaluation_time_utc_ms only.

### Per addendum §1

| Scenario | Expected | Test |
|----------|----------|------|
| age > hard_ttl | BLOCK | data_sources with last_updated such that age_ms > hard_ttl_ms; assert result === 'BLOCK'. |
| age in (soft_ttl, hard_ttl] | WARN | age > soft_ttl and age ≤ hard_ttl; assert result === 'WARN'. |
| age ≤ soft_ttl | ALLOW | age_ms ≤ soft_ttl_ms; assert result === 'ALLOW'. |
| context.data_sources missing or empty | ALLOW, reason NOT_APPLICABLE | No data_sources or []; assert result === 'ALLOW', reason === 'NOT_APPLICABLE'. |
| Multiple sources | Worst result wins | One source BLOCK → aggregate BLOCK; one WARN, rest ALLOW → WARN; all ALLOW → ALLOW. |

### Details shape (canonical only)

| Scenario | Expected | Test |
|----------|----------|------|
| details when applicable | evaluated_sources, worst_result, worst_source_id? | Assert details.evaluated_sources array; each item has source_id, age_ms, soft_ttl_ms, hard_ttl_ms, result; details.worst_result; details.worst_source_id when applicable. |
| No legacy shape | Do not use { source, age_days } alone | Assert no undocumented top-level keys. |

### Determinism

| Scenario | Expected | Test |
|----------|----------|------|
| Same context twice | Same ValidatorResult | validate(context) twice; assert deep equality of results. |
| No Date.now() | Result depends only on evaluation_time_utc_ms | Change evaluation_time_utc_ms → different result; same evaluation_time_utc_ms → same result. |

**Coverage:** Every branch per addendum §1; details canonical shape; multiple sources; NOT_APPLICABLE; determinism.

---

## 3. GroundingValidator — 100% Branch Coverage

**File:** `src/tests/unit/governance/validators/GroundingValidator.test.ts`

**Mock:** Config (grounding_missing_action: 'WARN' | 'BLOCK'). No DB read inside validator.

### Per addendum §2

| Scenario | Expected | Test |
|----------|----------|------|
| step_or_proposal missing | ALLOW, reason NOT_APPLICABLE | context.step_or_proposal undefined; assert result === 'ALLOW', reason === 'NOT_APPLICABLE'. |
| evidence exists, length ≥ 1, all valid shapes | ALLOW | step_or_proposal.evidence = [valid ref, valid ref]; assert result === 'ALLOW'. (If implementation uses evidence_refs, assert same for step_or_proposal.evidence_refs.) |
| evidence missing | WARN or BLOCK per config | step_or_proposal without evidence or evidence undefined; assert result per grounding_missing_action. |
| evidence empty array | WARN or BLOCK per config | step_or_proposal.evidence = []; assert result per config. |
| evidence invalid shape (free-form string) | WARN or BLOCK per config | evidence = [{ invalid: 'string' }]; assert result WARN or BLOCK. |
| Whitelist: ref not in context.evidence_references | Per config (optional) | If whitelist enforced, ref not in whitelist → WARN/BLOCK; else skip test. |

### EvidenceReference shapes

| Shape | Test |
|-------|------|
| { source_type, source_id } | Assert accepted when evidence has this shape. |
| { ledger_event_id } | Assert accepted. |
| { record_locator: { system, object, id, fields? } } | Assert accepted. |

**Coverage:** NOT_APPLICABLE; valid evidence ALLOW; missing/empty/invalid WARN/BLOCK per config; all three evidence shapes; optional whitelist.

---

## 4. ContradictionValidator — 100% Branch Coverage

**File:** `src/tests/unit/governance/validators/ContradictionValidator.test.ts`

**Mock:** ContradictionFieldConfig[] (eq, no_backward, date_window). No re-read; snapshot from context only.

### Per addendum §3

| Scenario | Expected | Test |
|----------|----------|------|
| step_or_proposal or canonical_snapshot missing | ALLOW, reason NOT_APPLICABLE | Omit one or both; assert result === 'ALLOW', reason === 'NOT_APPLICABLE'. |
| rule eq: step equals snapshot | ALLOW | Same value for field; assert ALLOW. |
| rule eq: step differs from snapshot | BLOCK or WARN per config | reason CONTRADICTION; details { field, snapshot_value, step_value }. |
| rule no_backward: step not earlier in ordering | ALLOW | step stage later or same in ordering; assert ALLOW. |
| rule no_backward: step earlier in ordering | BLOCK/WARN | reason CONTRADICTION; details with field and values. |
| rule date_window: delta within max_days_delta | ALLOW | Step date within bound of snapshot date; assert ALLOW. |
| rule date_window: delta exceeds max_days_delta | BLOCK/WARN | reason CONTRADICTION; details. |
| null/unknown for field | Not contradictory | snapshot or step has null/undefined for configured field; assert ALLOW (or not BLOCK). |
| Non-configured field | Ignored | Step has different value for non-configured field; assert no CONTRADICTION for that field. |

**Coverage:** NOT_APPLICABLE; eq; no_backward; date_window; null/unknown; configured fields only; no re-read (snapshot from context).

---

## 5. ComplianceValidator — 100% Branch Coverage

**File:** `src/tests/unit/governance/validators/ComplianceValidator.test.ts`

**Mock:** Tenant config (restricted_fields[], prohibited_action_types[]). No heuristic logic.

### Scenarios

| Scenario | Expected | Test |
|----------|----------|------|
| Neither step_or_proposal nor writeback_payload present | ALLOW, reason NOT_APPLICABLE | Both missing; assert result === 'ALLOW', reason === 'NOT_APPLICABLE'. |
| step or writeback contains restricted field | BLOCK, reason RESTRICTED_FIELD, details { field_or_action } | restricted_fields includes 'field_x'; step has field_x; assert BLOCK, reason, details. |
| step or writeback has prohibited action type | BLOCK, reason PROHIBITED_ACTION, details | prohibited_action_types includes 'ACTION_Y'; step action_type === 'ACTION_Y'; assert BLOCK. |
| No restricted field, no prohibited action | ALLOW | Valid step and writeback; assert ALLOW. |

**Coverage:** NOT_APPLICABLE; RESTRICTED_FIELD; PROHIBITED_ACTION; ALLOW path.

---

## 5a. Config Fail-Fast (100% Coverage)

**File:** Validator tests or `GovernanceConfig.test.ts` (optional).

**Contract (plan §9):** If required config is missing (e.g. no TTL config for Freshness when data_sources present), validator or gateway fails; do not fall back to default allow.

| Scenario | Expected | Test |
|----------|----------|------|
| Freshness: data_sources present but no TTL config | Validator or gateway fails (throw or reject); no ALLOW fallback | Pass data_sources; mock getTTLConfig to return null/empty; assert FreshnessValidator or gateway rejects. |
| Grounding: grounding_missing_action config missing | Defined behavior (fail or default BLOCK per plan) | Assert no silent ALLOW when config absent. |
| Contradiction / Compliance: config missing when required | Fail-fast; no silent allow | Assert reject when config required but absent. |

**Coverage:** Every config-load branch; no silent default allow when config is required.

---

## 6. ValidatorGatewayService — 100% Coverage

**File:** `src/tests/unit/governance/ValidatorGatewayService.test.ts`

**Mock:** FreshnessValidator, GroundingValidator, ContradictionValidator, ComplianceValidator; PlanLedgerService (append).

### Run-all and order

| Scenario | Expected | Test |
|----------|----------|------|
| All four validators run | Each validate(context) called once, in order: Freshness → Grounding → Contradiction → Compliance | Assert mock calls in order; no short-circuit. |
| One validator returns BLOCK | All four still run; aggregate === 'BLOCK' | One validator returns BLOCK; assert all four called; result.aggregate === 'BLOCK'. |
| All ALLOW | aggregate === 'ALLOW' | All return ALLOW; assert aggregate === 'ALLOW'. |
| Mix WARN and ALLOW | aggregate === 'WARN' | No BLOCK; at least one WARN; assert aggregate === 'WARN'. |

### Ledger

| Scenario | Expected | Test |
|----------|----------|------|
| Per-validator result appended | Four VALIDATOR_RUN appends (one per validator) | Assert PlanLedgerService.append called 4 times with event_type VALIDATOR_RUN; payload has validator, result, reason?, details?. |
| Summary append | One VALIDATOR_RUN_SUMMARY after the four | Assert fifth append with event_type VALIDATOR_RUN_SUMMARY; payload has choke_point, evaluation_time_utc_ms, aggregate, results (or entry refs). |
| Summary append fails | aggregate === 'BLOCK'; results include synthetic { validator: 'gateway', result: 'BLOCK', reason: 'LEDGER_WRITE_FAILED' } | Mock append to reject on 5th call; assert gateway returns BLOCK and results include LEDGER_WRITE_FAILED entry. |

### Applicability (NOT_APPLICABLE)

| Scenario | Expected | Test |
|----------|----------|------|
| Missing inputs for a validator | That validator returns ALLOW, reason NOT_APPLICABLE | e.g. no data_sources → Freshness returns NOT_APPLICABLE; gateway still runs all four; aggregate may still be BLOCK from another. |

**Coverage:** Fixed order; run all; no short-circuit; aggregate BLOCK > WARN > ALLOW; four VALIDATOR_RUN + one VALIDATOR_RUN_SUMMARY; summary failure → BLOCK and synthetic result.

---

## 7. Plan Ledger Extension — Validator Event Payloads

**File:** Same as ValidatorGatewayService tests or `PlanLedgerEvents.test.ts` (validator section).

For each VALIDATOR_RUN and VALIDATOR_RUN_SUMMARY append, assert payload shape:

### VALIDATOR_RUN (data)

- validation_run_id, target_id, snapshot_id?, choke_point, evaluation_time_utc_ms
- validator, result ('ALLOW'|'WARN'|'BLOCK'), reason?, details?
- tenant_id, account_id?, plan_id?, step_id? (as applicable)

### VALIDATOR_RUN_SUMMARY (data)

- validation_run_id, target_id, snapshot_id?, choke_point, evaluation_time_utc_ms
- aggregate, results (ValidatorResult[] or entry_ids)
- tenant_id, account_id?, plan_id?, step_id?

**Coverage:** Every validator event type emitted with correct payload per code-level plan §7.

---

## 8. Choke-Point Integration

**File:** `src/tests/unit/governance/ValidatorChokePointIntegration.test.ts` or extend plan-lifecycle-api-handler / orchestrator / execution tests.

**Mock:** PlanLedgerService; ValidatorGatewayService.run returns BLOCK or WARN or ALLOW.

### BEFORE_PLAN_APPROVAL

| Scenario | Expected | Test |
|----------|----------|------|
| aggregate BLOCK | Approval denied; 4xx with reasons from result.results; PlanLifecycleService.transition not called | Mock gateway returns BLOCK; assert approval handler returns 4xx; transition not called. |
| aggregate WARN | Proceed with approval; ledger + UI annotated; transition called | Mock gateway returns WARN; assert approval succeeds; ledger append called. |
| aggregate ALLOW | Proceed; transition called | Assert approval succeeds. |
| Context built correctly | choke_point BEFORE_PLAN_APPROVAL, target_id=plan_id, evaluation_time_utc_ms and validation_run_id set once at entry | Assert context passed to gateway has required fields. |

### BEFORE_STEP_EXECUTION

| Scenario | Expected | Test |
|----------|----------|------|
| aggregate BLOCK | Step not executed; Phase 6 policy handles (e.g. mark step failed, pause plan); ValidatorGateway does not pause/abort | Mock gateway BLOCK; assert step execution not invoked; orchestrator/policy handles outcome. |
| aggregate WARN | Proceed with step; ledger annotated | Assert step runs; WARN recorded. |

### BEFORE_EXTERNAL_WRITEBACK

| Scenario | Expected | Test |
|----------|----------|------|
| aggregate BLOCK | Connector not called; deterministic failure to caller; Phase 6/execution path handles step outcome | Mock gateway BLOCK; assert writeback adapter not called. |
| aggregate WARN | Proceed; writeback called | Assert writeback invoked. |

### BEFORE_EXPENSIVE_READ

| Scenario | Expected | Test |
|----------|----------|------|
| aggregate BLOCK | Expensive read not performed; deterministic failure/skip to caller | Mock gateway BLOCK; assert expensive read not called. |
| aggregate WARN | Proceed; read performed | Assert read invoked. |

**Coverage:** Each choke point: BLOCK prevents operation; WARN does not block; gateway does not decide pause/abort (Phase 6 does).

---

## 9. Replay / Determinism

**File:** `src/tests/unit/governance/ValidatorGatewayService.test.ts` or dedicated determinism describe block.

| Scenario | Expected | Test |
|----------|----------|------|
| Same ValidatorContext twice | Same ValidatorGatewayResult and same per-validator results | Run gateway.run(context) twice with identical context (same evaluation_time_utc_ms, snapshot_id, inputs); assert deep equality of results. |
| Validators do not call Date.now() | Result unchanged when wall clock changes | (Optional) If test harness can mock time, run with two different "now" values but same evaluation_time_utc_ms; assert same result. |

**Coverage:** Idempotency key (tenant_id, choke_point, target_id, snapshot_id?, validation_run_id); same inputs ⇒ same outputs.

---

## 10. Test Structure and Locations

```
src/tests/
├── unit/
│   ├── governance/
│   │   ├── ValidatorTypes.test.ts
│   │   ├── ValidatorGatewayService.test.ts
│   │   ├── ValidatorChokePointIntegration.test.ts   (or in handlers/orchestrator)
│   │   └── validators/
│   │       ├── FreshnessValidator.test.ts
│   │       ├── GroundingValidator.test.ts
│   │       ├── ContradictionValidator.test.ts
│   │       └── ComplianceValidator.test.ts
├── fixtures/
│   └── governance/
│       ├── validator-context.json
│       ├── evidence-reference-shapes.json
│       └── contradiction-field-config.json
└── integration/
    └── governance/
        └── validator-gateway.test.ts   (optional, env-gated)
```

---

## 11. Running Tests and Coverage Gates

### Unit tests (required)

```bash
npm test -- --testPathPattern=governance
npm test -- --testPathPattern="FreshnessValidator|GroundingValidator|ContradictionValidator|ComplianceValidator|ValidatorGatewayService"
```

### Coverage gate (100% for Phase 7.1 modules)

```bash
npm test -- --coverage \
  --collectCoverageFrom='src/types/governance/ValidatorTypes.ts' \
  --collectCoverageFrom='src/services/governance/ValidatorGatewayService.ts' \
  --collectCoverageFrom='src/services/governance/validators/*.ts' \
  --testPathPattern=governance
```

**Requirement:** 100% statement and branch coverage for:

- `src/types/governance/ValidatorTypes.ts` (if runtime-validated)
- `src/services/governance/ValidatorGatewayService.ts`
- `src/services/governance/validators/FreshnessValidator.ts`
- `src/services/governance/validators/GroundingValidator.ts`
- `src/services/governance/validators/ContradictionValidator.ts`
- `src/services/governance/validators/ComplianceValidator.ts`

Choke-point invocation code in plan-lifecycle-api-handler, orchestrator, and execution path must achieve **100% statement and branch coverage** via existing or extended handler/orchestrator tests (context build, gateway call, BLOCK/WARN/ALLOW branches).

**Config and Plan Ledger types:** Include `src/config/freshnessTtlConfig.ts`, `src/config/contradictionFieldConfig.ts`, and compliance/grounding config in coverage when they contain branches; include PlanLedgerTypes (validator event type union and payload shape) in assertion scope.

---

## 12. Success Criteria — 100% Coverage Checklist

Phase 7.1 tests are complete when:

1. **FreshnessValidator:** age > hard_ttl → BLOCK; age in (soft_ttl, hard_ttl] → WARN; age ≤ soft_ttl → ALLOW; no data_sources → ALLOW NOT_APPLICABLE; details canonical (evaluated_sources, worst_result, worst_source_id); context.evaluation_time_utc_ms only; multiple sources.
2. **GroundingValidator:** step_or_proposal.evidence exists, length ≥ 1, valid shapes → ALLOW; no step_or_proposal → NOT_APPLICABLE; missing/invalid → WARN/BLOCK per config; optional whitelist.
3. **ContradictionValidator:** eq, no_backward, date_window contradiction → BLOCK/WARN; no step_or_proposal or canonical_snapshot → NOT_APPLICABLE; null/unknown not contradictory; non-configured field ignored; no re-read.
4. **ComplianceValidator:** restricted field or prohibited action → BLOCK; neither step nor writeback → NOT_APPLICABLE; else ALLOW.
5. **ValidatorGatewayService:** Run all four validators; all four results in ledger; no short-circuit on BLOCK; aggregate BLOCK if any BLOCK, else WARN if any WARN, else ALLOW; summary write required—if summary append fails, return BLOCK with reason LEDGER_WRITE_FAILED.
6. **Choke-point integration:** Ledger receives VALIDATOR_RUN and VALIDATOR_RUN_SUMMARY with correct payloads; BLOCK prevents approval/step/writeback/read; ValidatorGateway does not decide pause/abort (Phase 6 policy does).
7. **Replay / determinism:** Same ValidatorContext ⇒ same ValidatorGatewayResult and same per-validator results; validators do not use Date.now().
8. **Coverage gate:** **100% statement and branch coverage** for Phase 7.1 validator and gateway modules (including config and Plan Ledger validator payloads); choke-point invocation code 100% covered; CI passes before merge.
9. **Config fail-fast:** When required config is missing (e.g. TTL when data_sources present), validator or gateway fails; no silent default allow.

---

## References

- [PHASE_7_1_CODE_LEVEL_PLAN.md](../PHASE_7_1_CODE_LEVEL_PLAN.md) — implementation plan (§1–§10)
- [PHASE_7_IMPLEMENTATION_PLAN.md](../PHASE_7_IMPLEMENTATION_PLAN.md) — EPIC 7.1 acceptance criteria
- [PHASE_7_CONTRACTS_ADDENDUM.md](../PHASE_7_CONTRACTS_ADDENDUM.md) — §§1–4 Freshness, Grounding, Contradiction, Validator execution
- [PHASE_6_1_TEST_PLAN.md](../../phase_6/testing/PHASE_6_1_TEST_PLAN.md) — structure reference
