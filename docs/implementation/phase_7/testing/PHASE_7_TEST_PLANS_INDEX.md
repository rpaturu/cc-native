# Phase 7 Test Plans — Index and 100% Coverage Summary

**Status:** 🟢 **COMPLETE**  
**Created:** 2026-01-31  
**Parent:** [../PHASE_7_CODE_LEVEL_PLAN.md](../PHASE_7_CODE_LEVEL_PLAN.md)  
**Purpose:** Single entry point for Phase 7.x test plans; combined coverage gate and 100% coverage checklist across 7.1–7.4.

---

## Test Plans

| Phase | Document | Scope | 100% Coverage Target |
|-------|----------|--------|----------------------|
| **7.1** | [PHASE_7_1_TEST_PLAN.md](PHASE_7_1_TEST_PLAN.md) | Validators Layer | ValidatorTypes, FreshnessValidator, GroundingValidator, ContradictionValidator, ComplianceValidator, ValidatorGatewayService, config fail-fast, Plan Ledger validator payloads, choke-point invocation code |
| **7.2** | [PHASE_7_2_TEST_PLAN.md](PHASE_7_2_TEST_PLAN.md) | Budgets and Cost Classes | BudgetTypes, getBudgetConfigs, BudgetUsageStore, BudgetService, instrumentation; no-applicable-config, BudgetPeriod, amount default |
| **7.3** | [PHASE_7_3_TEST_PLAN.md](PHASE_7_3_TEST_PLAN.md) | Observability and Dashboards | Metrics emission (GovernanceMetrics, emission from ValidatorGateway/BudgetService/PlanLifecycleService/PlanOrchestratorService); batching; best-effort; top-offenders mode |
| **7.4** | [PHASE_7_4_TEST_PLAN.md](PHASE_7_4_TEST_PLAN.md) | Outcomes Capture | OutcomeTypes, OutcomesCaptureService (append, validation, idempotency, repair, table-unavailable/no-fallback); integration tests required |
| **E2E** | [PHASE_7_E2E_TEST_PLAN.md](PHASE_7_E2E_TEST_PLAN.md) | Phase 7 E2E (post-deploy) | Plan Ledger ✅ passing; planned: Validator run, Budget reserve, Outcomes capture |

---

## Combined Coverage Gate (All Phase 7.x)

**Requirement:** 100% statement and branch coverage for every Phase 7 module listed below. No branch or statement in these modules may be uncovered.

### 7.1 — Validators

```bash
npm test -- --coverage \
  --collectCoverageFrom='src/types/governance/ValidatorTypes.ts' \
  --collectCoverageFrom='src/services/governance/ValidatorGatewayService.ts' \
  --collectCoverageFrom='src/services/governance/validators/*.ts' \
  --collectCoverageFrom='src/config/freshnessTtlConfig.ts' \
  --collectCoverageFrom='src/config/contradictionFieldConfig.ts' \
  --testPathPattern=governance
```

**Modules:** ValidatorTypes, ValidatorGatewayService, FreshnessValidator, GroundingValidator, ContradictionValidator, ComplianceValidator; config when branched; choke-point invocation code (plan-lifecycle-api-handler, orchestrator, execution path).

### 7.2 — Budgets

```bash
npm test -- --coverage \
  --collectCoverageFrom='src/types/governance/BudgetTypes.ts' \
  --collectCoverageFrom='src/services/governance/BudgetService.ts' \
  --collectCoverageFrom='src/config/budgetConfig.ts' \
  --collectCoverageFrom='src/**/BudgetUsageStore*.ts' \
  --testPathPattern=governance
```

**Modules:** BudgetTypes, BudgetService, budget config, BudgetUsageStore; instrumentation (BLOCK/WARN/ALLOW branches).

### 7.3 — Observability

```bash
npm test -- --coverage \
  --collectCoverageFrom='src/**/GovernanceMetrics*.ts' \
  --collectCoverageFrom='src/**/metrics/**/*.ts' \
  --testPathPattern=observability
```

**Modules:** Metrics emission code (GovernanceMetrics, emission from ValidatorGateway, BudgetService, PlanLifecycleService, PlanOrchestratorService). Dashboard and runbook: smoke/manual only.

### 7.4 — Outcomes

```bash
npm test -- --coverage \
  --collectCoverageFrom='src/types/governance/OutcomeTypes.ts' \
  --collectCoverageFrom='src/services/governance/OutcomesCaptureService.ts' \
  --testPathPattern=OutcomesCaptureService|OutcomeTypes
```

**Modules:** OutcomeTypes (if runtime-validated), OutcomesCaptureService (including table-unavailable / no-fallback).

### Run All Phase 7 Unit Tests

```bash
npm test -- --testPathPattern="governance|observability"
```

---

## 100% Coverage Checklist (Cross-Phase)

Phase 7 is complete when **all** of the following are true:

### 7.1
- [ ] Every validator: all branches (ALLOW/WARN/BLOCK, NOT_APPLICABLE, details shape) covered.
- [ ] ValidatorGatewayService: run-all order, no short-circuit, aggregate, ledger (4 VALIDATOR_RUN + 1 VALIDATOR_RUN_SUMMARY), summary failure → BLOCK.
- [ ] Config fail-fast: required config missing → fail; no silent default allow.
- [ ] Choke-point integration: BLOCK prevents operation; WARN does not block; gateway does not decide pause/abort.
- [ ] Replay/determinism: same context → same result; no Date.now() in validators.
- [ ] Plan Ledger: VALIDATOR_RUN and VALIDATOR_RUN_SUMMARY payload shape asserted.
- [ ] **100% statement and branch** for 7.1 modules and choke-point code.

### 7.2
- [ ] BudgetService: dedupe, BLOCK (no reserve), WARN (usage_after_reserve), ALLOW; no applicable config → fail or BLOCK NO_APPLICABLE_CONFIG.
- [ ] BudgetUsageStore: one conditional update per reserve; condition failure → no increment.
- [ ] Ledger: BUDGET_RESERVE, BUDGET_BLOCK, BUDGET_WARN with cap_hard/cap_soft/details.
- [ ] Instrumentation: BLOCK → operation not called; WARN/ALLOW → operation called.
- [ ] **100% statement and branch** for 7.2 modules.

### 7.3
- [ ] Metrics: namespace CCNative/Governance; ValidatorResultCount (VALIDATOR_RUN only), ValidatorRunSummaryCount (VALIDATOR_RUN_SUMMARY only); BudgetResultCount, BudgetUsage/BudgetHardCap (BUDGET_RESERVE only); GovernanceBlocks/GovernanceWarns with Source; no double-counting.
- [ ] Best-effort: PutMetricData failure does not change execution outcome.
- [ ] Batching: up to 20 metrics per PutMetricData; no one-call-per-validator-result.
- [ ] Top-offenders mode (if implemented): TenantId dimension only for BLOCK, allowlist/sampling.
- [ ] **100% statement and branch** for metrics emission code.

### 7.4
- [ ] OutcomesCaptureService: append success (all event types, pk/sk/gsi1/gsi2); validation fail-fast; idempotency (dedupe first, DuplicateOutcome on collision); dedupe-then-outcome repair; non-key events (no dedupe); table unavailable → fail, no Plan Ledger fallback.
- [ ] OutcomeTypes: plan_id required plan-linked; account_id and data.opportunity_id required downstream; idempotency_key for key events.
- [ ] Integration: approval + completion; DOWNSTREAM_*; execution + seller edit; idempotency; repair E2E (if feasible).
- [ ] **100% statement and branch** for OutcomeTypes and OutcomesCaptureService.

### CI
- [ ] All Phase 7.x unit tests run in CI and pass before merge.
- [ ] Integration tests (7.2 optional env-gated; 7.4 required when OUTCOMES_TABLE_NAME set) pass when env present.

---

## References

- [PHASE_7_CODE_LEVEL_PLAN.md](../PHASE_7_CODE_LEVEL_PLAN.md) — parent
- [PHASE_7_IMPLEMENTATION_PLAN.md](../PHASE_7_IMPLEMENTATION_PLAN.md) — EPICs 7.1–7.4
- [PHASE_7_1_TEST_PLAN.md](PHASE_7_1_TEST_PLAN.md) | [PHASE_7_2_TEST_PLAN.md](PHASE_7_2_TEST_PLAN.md) | [PHASE_7_3_TEST_PLAN.md](PHASE_7_3_TEST_PLAN.md) | [PHASE_7_4_TEST_PLAN.md](PHASE_7_4_TEST_PLAN.md)
- [PHASE_7_E2E_TEST_PLAN.md](PHASE_7_E2E_TEST_PLAN.md) — post-deploy E2E scripts (Plan Ledger; planned: Validator run, Budget reserve, Outcomes capture)
