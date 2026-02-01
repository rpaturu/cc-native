# Phase 7.3 Test Plan — Observability and Dashboards

**Status:** 🟢 **COMPLETE**  
**Created:** 2026-01-31  
**Parent:** [../PHASE_7_3_CODE_LEVEL_PLAN.md](../PHASE_7_3_CODE_LEVEL_PLAN.md)  
**Canonical contract:** [../PHASE_7_IMPLEMENTATION_PLAN.md](../PHASE_7_IMPLEMENTATION_PLAN.md) EPIC 7.3, Stories 7.3.1–7.3.2  
**Reference:** [../../phase_6/testing/PHASE_6_1_TEST_PLAN.md](../../phase_6/testing/PHASE_6_1_TEST_PLAN.md) — structure and coverage pattern

**All tests in this plan are required for definition of done. No test is optional.**

---

## Gap Analysis (vs 100% Coverage)

| Item | Plan § | Status | Notes |
|------|--------|--------|--------|
| **Metrics emission (validator)** | §1, §2 | 🔲 Pending | ValidatorResultCount from VALIDATOR_RUN only; ValidatorRunSummaryCount from VALIDATOR_RUN_SUMMARY only; namespace, dimensions, value. |
| **Metrics emission (budget)** | §1, §2 | 🔲 Pending | BudgetResultCount on all budget events; BudgetUsage/BudgetHardCap only on BUDGET_RESERVE; no TenantId/AccountId by default. |
| **GovernanceBlocks / GovernanceWarns** | §1, §2 | 🔲 Pending | Source=VALIDATOR from VALIDATOR_RUN_SUMMARY; Source=BUDGET from BUDGET_BLOCK/BUDGET_WARN. |
| **Plan / orchestrator metrics** | §1, §2 | 🔲 Pending | PlanOutcomes/PlanStatusCount; OrchestratorRuns, PlansAdvancedPerRun, OrchestratorErrors. |
| **Best-effort / no execution impact** | §2 | 🔲 Pending | PutMetricData failure does not change execution outcome; no block, no indefinite retry. |
| **No double-counting** | §2 | 🔲 Pending | Validator counts from VALIDATOR_RUN only; aggregate from VALIDATOR_RUN_SUMMARY only. |
| **Batching** | §2, §7 | 🔲 Pending | Up to 20 metrics per PutMetricData; no one-call-per-validator-result under load. |
| **Dashboard** | §3 | 🔲 Pending | Smoke or manual: dashboard renders and shows data. |
| **Runbook** | §5 | 🔲 Pending | Manual: query keys (plan_id, event_type, validation_run_id, operation_id) return correct events. |

---

## Executive Summary

This document defines **test coverage** requirements for Phase 7.3 (Observability and Dashboards). Phase 7.3 adds metrics emission, dashboards, and alerting hooks only—no new business logic. Tests focus on: correct metric namespace and names; dimensions and values; no double-counting; emission from the correct ledger events only; batching behavior; and best-effort semantics (metrics failure must not change execution outcome). Dashboard and runbook coverage are smoke/manual.

**Coverage target:** **100% statement and branch coverage** for metrics emission code paths (GovernanceMetrics, emission from ValidatorGateway/BudgetService/PlanLifecycleService/PlanOrchestratorService). Unit (or integration) tests for every emission point: validator metrics, budget metrics, GovernanceBlocks/GovernanceWarns, plan and orchestrator metrics; batching; best-effort. Dashboard and runbook: smoke or manual checklist. No branch or statement in metrics emission code may be uncovered.

---

## 1. Metric Namespace and Names

**File:** `src/tests/unit/observability/GovernanceMetrics.test.ts` (or equivalent)

**Mock:** CloudWatch PutMetricData (or metrics client). Assert **namespace** and **metric names** only.

### Namespace

| Scenario | Expected | Test |
|----------|----------|------|
| Canonical namespace | **CCNative/Governance** only | Assert every PutMetricData call uses namespace `CCNative/Governance`; no alternate namespaces (e.g. CCNative/Phase7). |

### Validator metric names

| Metric name | Emitted from | Test |
|-------------|--------------|------|
| **ValidatorResultCount** | VALIDATOR_RUN only (per-validator result) | Emit path: when appending each VALIDATOR_RUN; assert metric name `ValidatorResultCount`. |
| **ValidatorRunSummaryCount** (or equivalent) | VALIDATOR_RUN_SUMMARY only | Emit path: when appending VALIDATOR_RUN_SUMMARY; assert metric name; do **not** emit ValidatorResultCount from summary. |

### Budget metric names

| Metric name | Emitted from | Test |
|-------------|--------------|------|
| **BudgetResultCount** | BUDGET_RESERVE, BUDGET_BLOCK, BUDGET_WARN | Assert metric name `BudgetResultCount` on all three event types. |
| **BudgetUsage** | BUDGET_RESERVE only | Assert emitted only when handling BUDGET_RESERVE; value = usage_after. |
| **BudgetHardCap** | BUDGET_RESERVE only | Assert emitted only when handling BUDGET_RESERVE; value = cap. Do **not** emit on BUDGET_BLOCK or BUDGET_WARN. |

### GovernanceImpact metric names

| Metric name | Emitted from | Test |
|-------------|--------------|------|
| **GovernanceBlocks** | VALIDATOR_RUN_SUMMARY (aggregate=BLOCK), BUDGET_BLOCK | Assert dimension **Source=VALIDATOR** from summary; **Source=BUDGET** from BUDGET_BLOCK. |
| **GovernanceWarns** | VALIDATOR_RUN_SUMMARY (aggregate=WARN), BUDGET_WARN | Assert dimension **Source=VALIDATOR** from summary; **Source=BUDGET** from BUDGET_WARN. |

### Plan / orchestrator metric names

| Metric name | Emitted from | Test |
|-------------|--------------|------|
| PlanOutcomes / PlanStatusCount | PLAN_COMPLETED, PLAN_PAUSED, PLAN_ABORTED, PLAN_EXPIRED | Assert metric name and dimension Status. |
| OrchestratorRuns, PlansAdvancedPerRun, OrchestratorErrors | PlanOrchestratorService end of run | Assert metric names and values. |

**Coverage:** Namespace; every metric name; emission source (which ledger event or code path) documented and asserted.

---

## 2. Dimensions and Values

**File:** Same as §1.

**Mock:** PutMetricData; capture dimensions and value per call.

### ValidatorResultCount

| Dimension | Expected | Test |
|-----------|----------|------|
| ValidatorName | freshness, grounding, contradiction, compliance | Assert dimension ValidatorName matches validator that produced VALIDATOR_RUN. |
| Result | ALLOW, WARN, BLOCK | Assert dimension Result matches result in ledger payload. |
| Value | 1 per emission | Assert value === 1. |
| Default: no TenantId/AccountId | Omit by default | Assert default payload does not include TenantId or AccountId dimensions. |
| Top-offenders mode (optional) | TenantId dimension only for BLOCK (and optionally WARN); allowlist or sampling | If implemented: assert TenantId emitted only for BLOCK events and only for configured allowlist tenants or sampling rate; never AccountId by default. |

### ValidatorRunSummaryCount

| Dimension | Expected | Test |
|-----------|----------|------|
| Aggregate | ALLOW, WARN, BLOCK | Assert dimension Aggregate matches aggregate in VALIDATOR_RUN_SUMMARY. |
| Value | 1 per run | Assert value === 1. |

### BudgetResultCount

| Dimension | Expected | Test |
|-----------|----------|------|
| CostClass | CHEAP, MEDIUM, EXPENSIVE | Assert dimension CostClass. |
| Result | ALLOW, WARN, BLOCK | Assert dimension Result. |
| Value | 1 per event | Assert value === 1. |
| Default: no TenantId/AccountId | Omit by default | Assert no TenantId/AccountId in dimensions. |

### GovernanceBlocks / GovernanceWarns

| Dimension | Expected | Test |
|-----------|----------|------|
| Source | VALIDATOR or BUDGET | Assert Source=VALIDATOR when emitted from VALIDATOR_RUN_SUMMARY; Source=BUDGET when from BUDGET_BLOCK/BUDGET_WARN. |
| Value | 1 per event | Assert value === 1. |

### Reason not a dimension

| Scenario | Expected | Test |
|----------|----------|------|
| Reason (e.g. DATA_STALE, HARD_CAP_EXCEEDED) | Not a CloudWatch dimension | Assert no Reason dimension in any PutMetricData payload; reason stays in ledger/logs only. |

**Coverage:** All standardized dimensions per plan §1; value 1 where specified; no high-cardinality dimensions by default.

---

## 3. No Double-Counting

**File:** Same as §1; or ValidatorGatewayService / BudgetService tests with metrics mock.

| Scenario | Expected | Test |
|----------|----------|------|
| Per-validator counts | Emitted only when appending **VALIDATOR_RUN** | Invoke ValidatorGateway (4 validators); assert PutMetricData called 4 times with ValidatorResultCount (one per validator); do **not** emit ValidatorResultCount from VALIDATOR_RUN_SUMMARY path. |
| Aggregate run counts | Emitted only when appending **VALIDATOR_RUN_SUMMARY** | Assert ValidatorRunSummaryCount (or GovernanceBlocks/GovernanceWarns) emitted exactly once per run from summary append only; no duplicate counts from per-validator appends. |
| BudgetUsage / BudgetHardCap | Only on BUDGET_RESERVE | Invoke BudgetService: reserve (ALLOW), block (BLOCK), warn (WARN); assert BudgetUsage and BudgetHardCap emitted only for the reserve (ALLOW) event; not for BUDGET_BLOCK or BUDGET_WARN. |

**Coverage:** One source per metric; no double-counting across VALIDATOR_RUN vs VALIDATOR_RUN_SUMMARY; BudgetUsage/BudgetHardCap only on BUDGET_RESERVE.

---

## 4. Best-Effort: Metrics Must Not Change Execution Outcome

**File:** `src/tests/unit/observability/GovernanceMetricsBestEffort.test.ts` or extend emission-point tests.

**Mock:** PutMetricData to reject (e.g. throw or return error).

| Scenario | Expected | Test |
|----------|----------|------|
| PutMetricData fails (validator path) | ValidatorGateway still returns ValidatorGatewayResult; ledger still appended; no throw to caller | Mock PutMetricData to reject; call ValidatorGateway.run(context); assert gateway returns result and ledger append occurred; no exception propagated. |
| PutMetricData fails (budget path) | BudgetService still returns BudgetServiceResult; ledger still appended; no throw to caller | Mock PutMetricData to reject; call BudgetService.reserve(request); assert reserve returns result and ledger append occurred; no exception propagated. |
| No block, no indefinite retry | Emission is best-effort; no retry loop that blocks execution | Assert metrics emission path does not retry indefinitely; single attempt or bounded retry only; failure is swallowed or logged. |

**Coverage:** Execution outcome unchanged when metrics fail; no governance coupling to observability.

---

## 5. Batching Behavior

**File:** `src/tests/unit/observability/GovernanceMetricsBatching.test.ts` or same as §1.

**Mock:** PutMetricData; capture number of calls and number of metrics per call.

| Scenario | Expected | Test |
|----------|----------|------|
| Under load: one validator run (4 validators + summary) | Metrics batched; not 5 separate PutMetricData calls (one per validator + one summary) | Invoke ValidatorGateway.run() once; assert PutMetricData called with batched payload (e.g. up to 20 metrics per call); total metrics = 4 ValidatorResultCount + 1 ValidatorRunSummaryCount (or equivalent); call count ≤ 1 if batch size allows. |
| Batch size limit | PutMetricData accepts up to 20 metrics per call; buffer and flush in batches | If emitting more than 20 metrics in one logical run, assert multiple PutMetricData calls with at most 20 metrics each; no single call with > 20 metrics. |
| No one-call-per-validator-result | Code does not emit one API call per validator result | Assert that for a run with 4 validators + summary, the implementation uses a single batched call (or minimal calls), not 5 separate calls. |

**Coverage:** Batching implemented; max 20 metrics per PutMetricData; unbounded per-event calls avoided.

---

## 6. Emission Points (Integration with 7.1 / 7.2)

**File:** Extend ValidatorGatewayService.test.ts and BudgetService.test.ts with metrics mock; or dedicated observability integration test.

| Emission point | Trigger | Assertion |
|----------------|---------|-----------|
| ValidatorGatewayService (on each VALIDATOR_RUN append) | ValidatorGateway.run() | After each validator result appended, PutMetricData (or batch buffer) receives ValidatorResultCount with ValidatorName + Result. |
| ValidatorGatewayService (on VALIDATOR_RUN_SUMMARY append) | Same run | After summary appended, PutMetricData receives ValidatorRunSummaryCount (Aggregate) and/or GovernanceBlocks/GovernanceWarns (Source=VALIDATOR). |
| BudgetService (on BUDGET_RESERVE / BUDGET_BLOCK / BUDGET_WARN append) | BudgetService.reserve() | BudgetResultCount (CostClass + Result) on all three; BudgetUsage and BudgetHardCap only on BUDGET_RESERVE. |
| PlanLifecycleService (on PLAN_* transitions) | PlanLifecycleService.transition() | PlanOutcomes/PlanStatusCount with Status dimension when PLAN_COMPLETED, PLAN_PAUSED, PLAN_ABORTED, PLAN_EXPIRED. |
| PlanOrchestratorService (end of run) | Orchestrator run completion | OrchestratorRuns (1), PlansAdvancedPerRun, OrchestratorErrors. |

**Coverage:** Every emission point in plan §2 has a test that triggers it and asserts metric name, dimensions, and value (or batch inclusion).

---

## 7. Dashboard — Smoke / Manual

**File:** Not automated; checklist or manual test doc.

| Scenario | Expected | Test |
|----------|----------|------|
| Dashboard deploys | CDK deploy creates CloudWatch Dashboard | Deploy stack; assert dashboard exists in account. |
| Dashboard renders | Widgets load without error | Open dashboard in console; no blank or error widgets. |
| Data after events | After emitting validator and budget events, dashboard shows data | Run a few ValidatorGateway and BudgetService flows; refresh dashboard; assert GovernanceImpact, validator block rate, budget consumption widgets show non-zero where expected. |
| Widget list | GovernanceImpact, validator block rate, budget consumption, budget blocks/warns, plan outcomes, orchestrator throughput | Checklist: each widget from plan §3 present and wired to correct metrics. |

**Coverage:** Smoke or manual sign-off; no automated UI test required for 7.3 baseline.

---

## 8. Runbook — Manual Follow-Through

**File:** Runbook doc in repo or wiki; manual test checklist.

| Scenario | Expected | Test |
|----------|----------|------|
| "Why was this action blocked?" | Query Plan Ledger by plan_id; filter event_type IN (VALIDATOR_RUN_SUMMARY, VALIDATOR_RUN, BUDGET_BLOCK, BUDGET_WARN); sort by timestamp; group by validation_run_id / operation_id | Trigger a BLOCK (validator or budget); follow runbook: query by plan_id, filter event types, sort by time; assert returned events include validation_run_id / operation_id and data.payload with validator name, result, reason, details (or budget usage_before, cap_hard, matched_configs). |
| "Why was this action warned?" | Same query; filter for result = WARN (VALIDATOR_RUN, VALIDATOR_RUN_SUMMARY, BUDGET_WARN) | Same flow; filter WARN; assert correct events. |
| GET /plans/:planId/ledger | Returns validator and budget events with validation_run_id and operation_id in payload | If API exists (Phase 6.4), assert ledger response includes validator/budget event types and payload fields for runbook navigation. |

**Coverage:** Manual follow-through; runbook steps documented and verified once; query keys (plan_id, event_type, validation_run_id, operation_id) correct.

---

## 9. Test Structure and Locations

```
src/tests/
├── unit/
│   └── observability/
│       ├── GovernanceMetrics.test.ts        (§1–§3, §5: namespace, names, dimensions, no double-count, batching)
│       ├── GovernanceMetricsBestEffort.test.ts  (§4)
│       └── GovernanceMetricsBatching.test.ts    (§5; or merged into GovernanceMetrics)
├── integration/
│   └── observability/
│       └── governance-metrics-emission.test.ts   (§6: emission points with real or mocked ledger)
└── docs/ or runbooks/
    └── phase7/
        └── PHASE_7_3_RUNBOOK.md                  (§8: query keys and steps)
```

**Fixtures:** Required: metric payload fixtures for expected namespace, names, dimensions (or document in test).

---

## 10. Running Tests and Coverage Gates

### Unit tests (required)

```bash
npm test -- --testPathPattern=observability
npm test -- --testPathPattern=GovernanceMetrics
```

### Coverage gate (Phase 7.3 observability code)

```bash
npm test -- --coverage \
  --collectCoverageFrom='src/**/GovernanceMetrics*.ts' \
  --collectCoverageFrom='src/**/metrics/**/*.ts' \
  --testPathPattern=observability
```

**Requirement:** **100% statement and branch coverage** for metrics emission code paths: `src/**/GovernanceMetrics*.ts`, `src/**/metrics/**/*.ts` (emission from ValidatorGateway, BudgetService, PlanLifecycleService, PlanOrchestratorService). Dashboard and runbook are manual/smoke; no coverage gate for CDK dashboard construct or runbook doc.

---

## 11. Success Criteria — Checklist

Phase 7.3 tests are complete when:

1. **Namespace:** All metrics use **CCNative/Governance**; no alternate namespaces.
2. **Validator metrics:** ValidatorResultCount emitted from VALIDATOR_RUN only; ValidatorRunSummaryCount (or equivalent) from VALIDATOR_RUN_SUMMARY only; dimensions ValidatorName, Result / Aggregate; value 1; no double-counting.
3. **Budget metrics:** BudgetResultCount on BUDGET_RESERVE, BUDGET_BLOCK, BUDGET_WARN; BudgetUsage and BudgetHardCap only on BUDGET_RESERVE; dimensions CostClass, Result; default no TenantId/AccountId.
4. **GovernanceBlocks / GovernanceWarns:** Source=VALIDATOR from VALIDATOR_RUN_SUMMARY; Source=BUDGET from BUDGET_BLOCK/BUDGET_WARN; value 1.
5. **Best-effort:** PutMetricData failure does not change execution outcome; no block, no indefinite retry.
6. **Batching:** Up to 20 metrics per PutMetricData call; no one-call-per-validator-result under load.
7. **Emission points:** ValidatorGateway, BudgetService, PlanLifecycleService, PlanOrchestratorService emission points covered by tests.
8. **Dashboard:** Smoke or manual sign-off that dashboard deploys and shows data.
9. **Runbook:** Manual follow-through once; query keys (plan_id, event_type, validation_run_id, operation_id) documented and correct.
10. **Coverage gate:** **100% statement and branch coverage** for metrics emission modules; CI passes before merge.
11. **CI:** Phase 7.3 unit tests run in CI and pass before merge.

---

## References

- [PHASE_7_3_CODE_LEVEL_PLAN.md](../PHASE_7_3_CODE_LEVEL_PLAN.md) — implementation plan (§1–§7)
- [PHASE_7_IMPLEMENTATION_PLAN.md](../PHASE_7_IMPLEMENTATION_PLAN.md) — EPIC 7.3 acceptance criteria
- [PHASE_7_1_TEST_PLAN.md](PHASE_7_1_TEST_PLAN.md) — validator events (source for metrics)
- [PHASE_7_2_TEST_PLAN.md](PHASE_7_2_TEST_PLAN.md) — budget events (source for metrics)
- [PHASE_6_1_TEST_PLAN.md](../../phase_6/testing/PHASE_6_1_TEST_PLAN.md) — structure reference
