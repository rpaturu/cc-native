# Phase 7.2 Test Plan — Budgets and Cost Classes

**Status:** 🟢 **COMPLETE**  
**Created:** 2026-01-31  
**Parent:** [../PHASE_7_2_CODE_LEVEL_PLAN.md](../PHASE_7_2_CODE_LEVEL_PLAN.md)  
**Canonical contract:** [../PHASE_7_IMPLEMENTATION_PLAN.md](../PHASE_7_IMPLEMENTATION_PLAN.md) EPIC 7.2, Stories 7.2.1–7.2.3  
**Contracts addendum:** [../PHASE_7_CONTRACTS_ADDENDUM.md](../PHASE_7_CONTRACTS_ADDENDUM.md) §5  
**Reference:** [../../phase_6/testing/PHASE_6_1_TEST_PLAN.md](../../phase_6/testing/PHASE_6_1_TEST_PLAN.md) — structure and coverage pattern

**All tests in this plan are required for definition of done. No test is optional.**

---

## Gap Analysis (vs 100% Coverage)

| Item | Plan § | Status | Notes |
|------|--------|--------|--------|
| **BudgetTypes.test.ts** | §1 | 🔲 Pending | CostClass, BudgetScope, BudgetPeriod, BudgetConfig, BudgetServiceResult, ReserveRequest; operation_id idempotency. |
| **Budget config / getBudgetConfigs** | §2 | 🔲 Pending | Applicable config matching (all non-null scope fields match); precedence (most-specific → least-specific); effective hard/soft cap. |
| **BudgetUsageStore** | §3 | 🔲 Pending | One conditional update per reserve; condition failure → no increment; getUsage; period_key isolation; reserved_count only; dedupe by operation_id. |
| **BudgetService** | §4 | 🔲 Pending | reserve: dedupe, applicable configs, atomic reserve, BLOCK/WARN/ALLOW; ledger BUDGET_RESERVE, BUDGET_BLOCK, BUDGET_WARN; WARN uses usage_after_reserve. |
| **Plan Ledger budget events** | §5 | 🔲 Pending | BUDGET_RESERVE, BUDGET_BLOCK, BUDGET_WARN payloads (usage_before, usage_after, cap_hard, cap_soft, matched_configs). |
| **Instrumentation** | §6 | 🔲 Pending | BLOCK → operation not called; WARN/ALLOW → operation called; operation_id and scope passed correctly. |
| **BudgetPeriod / no config applies** | §1, §2 | 🔲 Pending | BudgetPeriod DAY | MONTH in types; no applicable config → fail or BLOCK with reason NO_APPLICABLE_CONFIG (no unbounded allow). |
| **ReserveRequest amount default** | §1 | 🔲 Pending | amount? default 1; BudgetServiceResult.details always cap_hard (and cap_soft when applicable). |

---

## Executive Summary

This document defines **100% test coverage** requirements for Phase 7.2 (Budgets and Cost Classes: CostClass, BudgetScope, BudgetConfig, BudgetService reserve-before-execute, BudgetUsageStore, Plan Ledger budget events, instrumentation). Every config-matching branch, atomic reserve path, dedupe path, ledger event, and instrumentation branch must be covered by unit tests.

**Coverage target:** **100% statement and branch coverage** for Phase 7.2 modules: BudgetTypes, budget config (getBudgetConfigs), BudgetUsageStore (or equivalent), BudgetService, and instrumentation call sites (tool adapters / execution path). No branch or statement in these modules may be uncovered.

---

## 1. Type Definitions — BudgetTypes

**File:** `src/tests/unit/governance/BudgetTypes.test.ts`

**Scope:** Type invariants and shape validation only (no runtime logic).

### CostClass / BudgetPeriod

| Scenario | Expected | Test |
|----------|----------|------|
| All cost classes | CHEAP, MEDIUM, EXPENSIVE | Assert union includes exactly these three (or fixture passes type check). |
| BudgetPeriod | DAY, MONTH | Assert union includes exactly these two; period_key format (e.g. YYYY-MM-DD for DAY, YYYY-MM for MONTH). |

### BudgetScope / BudgetConfig / ReserveRequest

| Scenario | Expected | Test |
|----------|----------|------|
| BudgetScope | tenant_id required; account_id?, plan_id?, tool_id? optional | Fixture or assert shape. |
| BudgetConfig | scope, period, hard_cap (Partial Record CostClass→number), soft_cap? | Assert hard_cap and soft_cap keyed by CostClass. |
| ReserveRequest | scope, cost_class, period_key, operation_id required; amount? default 1 | Assert operation_id required for idempotency; assert amount defaults to 1 when omitted. |

### Idempotency (dedupe)

| Scenario | Expected | Test |
|----------|----------|------|
| Same (scope, period_key, cost_class, operation_id) | Original outcome returned; no double increment | Document in test; BudgetService tests assert dedupe behavior. |

**Coverage:** Critical type invariants so refactors don’t break contracts.

---

## 2. Budget Config — Applicable Config Matching

**File:** `src/tests/unit/governance/BudgetConfig.test.ts` or `BudgetService.test.ts` (config section)

**Mock:** Config store or getBudgetConfigs returning array of BudgetConfig.

### Applicable config (canonical)

| Scenario | Expected | Test |
|----------|----------|------|
| Config scope matches request scope (all non-null fields match) | Config applies | Config { tenant_id, account_id }; request { tenant_id, account_id, plan_id }; assert config included. |
| Config has field request doesn’t match | Config does not apply | Config { tenant_id, tool_id: 'T1' }; request { tenant_id, tool_id: 'T2' }; assert config excluded. |
| Request has superset of config scope | Config applies | Config { tenant_id }; request { tenant_id, account_id }; assert config included. |

### Precedence and effective caps

| Scenario | Expected | Test |
|----------|----------|------|
| Order most-specific → least-specific | Deterministic evaluation | Multiple applicable configs; assert order (e.g. tool+plan+account+tenant → tenant-only). |
| Effective hard cap | Minimum of all applicable hard_caps for cost_class | Two configs: hard_cap EXPENSIVE 50 and 30; assert effective hard cap = 30. |
| Effective soft cap | Minimum of all applicable soft_caps for cost_class | Same; assert effective soft cap is minimum. |
| No config applies | Fail or BLOCK with reason NO_APPLICABLE_CONFIG; no unbounded allow | Request scope matches no config; assert BudgetService fails or returns BLOCK with reason NO_APPLICABLE_CONFIG (per plan §2 fail-fast). |

**Coverage:** Every branch of applicable-config logic; precedence; effective hard/soft cap; no config applies.

---

## 3. Budget Usage Store — 100% Coverage

**File:** `src/tests/unit/governance/BudgetUsageStore.test.ts` (or internal to BudgetService tests)

**Mock:** DynamoDBDocumentClient or equivalent (UpdateItem with ConditionExpression). **No read-then-write;** one conditional update per reserve.

### reserve (atomic)

| Scenario | Expected | Test |
|----------|----------|------|
| Conditional update: reserved_count + amount ≤ hard_cap | success true; usage_after = reserved_count + amount | Mock UpdateItem success; assert reserve returns success, usage_after correct. |
| Condition fails (reserved_count + amount > hard_cap) | success false; no increment | Mock condition failure (ConditionalCheckFailedException or equivalent); assert reserve returns success false; **no** second write. |
| attribute_not_exists for new row | New period_key/cost_class row initialized correctly | First reserve for scope+period_key+cost_class; assert ADD reserved_count :amount and condition attribute_not_exists(sk) or equivalent. |

### getUsage

| Scenario | Expected | Test |
|----------|----------|------|
| Returns reserved_count per cost class | Record<CostClass, number> | Mock read; assert getUsage(scope, period_key) returns { EXPENSIVE: n, MEDIUM: m, CHEAP: k }. |
| Period key isolation | Different period_key → different usage | Reserve for DAY#2026-01-31; getUsage for DAY#2026-01-30 returns 0 or separate row. |

### Phase 7 baseline

| Scenario | Expected | Test |
|----------|----------|------|
| reserved_count only | No consumed_count; no decrement on failure | Assert store has only reserved_count (no consume/rollback API tested). |

**Coverage:** One conditional update per reserve; condition failure → no increment; getUsage; period_key isolation; reserved_count only.

---

## 4. BudgetService — 100% Coverage

**File:** `src/tests/unit/governance/BudgetService.test.ts`

**Mock:** getBudgetConfigs, BudgetUsageStore (getUsage, reserve), PlanLedgerService (append); idempotency store (operation_id → outcome).

### reserve(request)

| Scenario | Expected | Test |
|----------|----------|------|
| Dedupe: same (scope, period_key, cost_class, operation_id) already reserved | Return stored outcome (ALLOW/WARN/BLOCK); do not reserve again | First reserve returns ALLOW; second reserve with same operation_id returns same ALLOW; usage store reserve called once. |
| Any applicable hard cap exceeded (after reserve would exceed) | BLOCK; **no reserve** (atomic condition fails); append BUDGET_BLOCK; reason HARD_CAP_EXCEEDED; details usage_before, cap_hard, matched_configs | usage_before at cap; reserve would exceed; assert result BLOCK; usage store reserve not called or returns success false; ledger BUDGET_BLOCK. |
| Hard cap not exceeded; soft cap exceeded by usage_after | WARN; reserve succeeds; append BUDGET_WARN; details usage_before, usage_after, cap_soft, matched_configs | usage_after > soft_cap, usage_after ≤ hard_cap; assert result WARN; ledger BUDGET_WARN; **WARN uses usage_after_reserve**. |
| Both caps under | ALLOW; reserve succeeds; append BUDGET_RESERVE; details usage_before, usage_after, cap_hard, cap_soft?, matched_configs? | assert result ALLOW; ledger BUDGET_RESERVE. |
| Store outcome for dedupe | After successful reserve, store (scope, period_key, cost_class, operation_id) → outcome | Assert idempotency store updated with outcome. |

### Ledger payloads

| Event | Payload assertions |
|-------|---------------------|
| BUDGET_RESERVE | scope, period_key, cost_class, result ALLOW, usage_before, usage_after, **cap_hard** (always), cap_soft?, matched_configs?; assert details always includes cap_hard (per plan §1 for metrics). |
| BUDGET_BLOCK | result BLOCK, reason HARD_CAP_EXCEEDED, usage_before, **cap_hard**, matched_configs?; **no usage_after** (not reserved). |
| BUDGET_WARN | result WARN, reason SOFT_CAP_EXCEEDED, usage_before, usage_after (post-reserve), cap_soft, matched_configs?. |

### Determinism

| Scenario | Expected | Test |
|----------|----------|------|
| Same scope, period_key, cost_class, operation_id, caps | Same result | Run reserve twice with same request (first success); second is dedupe; assert same result. |

**Coverage:** Dedupe; BLOCK (no reserve); WARN (reserve then WARN); ALLOW (reserve); ledger payloads; WARN uses usage_after_reserve; determinism.

---

## 5. Plan Ledger Extension — Budget Event Payloads

**File:** Same as BudgetService tests or PlanLedgerEvents.test.ts (budget section).

For each BUDGET_RESERVE, BUDGET_BLOCK, BUDGET_WARN append, assert payload shape per code-level plan §5:

- scope (tenant_id, account_id?, plan_id?, tool_id?)
- period_key, cost_class, operation_id?
- result (ALLOW/WARN/BLOCK), reason?
- amount?, usage_before, usage_after?, cap_hard?, cap_soft?, matched_configs?

**Coverage:** Every budget event type emitted with correct payload.

---

## 6. Instrumentation — Execution Paths

**File:** `src/tests/unit/governance/BudgetInstrumentation.test.ts` or extend tool-adapter / execution-path tests.

**Mock:** BudgetService.reserve(request).

### Before EXPENSIVE (and optionally MEDIUM) operation

| Scenario | Expected | Test |
|----------|----------|------|
| reserve returns BLOCK | Operation **not** invoked; error or throttle returned; ledger already written by BudgetService | Mock reserve → BLOCK; assert LLM/tool/enrichment call not made. |
| reserve returns WARN | Operation invoked; WARN optionally surfaced in response/UI | Mock reserve → WARN; assert operation called. |
| reserve returns ALLOW | Operation invoked | Mock reserve → ALLOW; assert operation called. |
| ReserveRequest built correctly | scope from tenant/account/plan; cost_class; period_key from **single evaluation time at entry**; operation_id (e.g. request id or deterministic id) | Assert request passed to reserve has required fields; no Date.now() inside BudgetService. |

**Coverage:** BLOCK prevents call; WARN/ALLOW allow call; operation_id and scope and cost_class passed correctly.

---

## 7. Test Structure and Locations

```
src/tests/
├── unit/
│   ├── governance/
│   │   ├── BudgetTypes.test.ts
│   │   ├── BudgetConfig.test.ts           (optional; or inside BudgetService)
│   │   ├── BudgetUsageStore.test.ts       (if separate store)
│   │   ├── BudgetService.test.ts
│   │   └── BudgetInstrumentation.test.ts  (or in tool-adapter / execution tests)
├── fixtures/
│   └── governance/
│       ├── budget-config.json
│       ├── reserve-request.json
│       └── budget-scope.json
└── integration/
    └── governance/
        └── budget-service.test.ts        (optional, env-gated; real DynamoDB)
```

---

## 8. Running Tests and Coverage Gates

### Unit tests (required)

```bash
npm test -- --testPathPattern=governance
npm test -- --testPathPattern="BudgetService|BudgetUsageStore|BudgetConfig|BudgetTypes"
```

### Coverage gate (100% for Phase 7.2 modules)

```bash
npm test -- --coverage \
  --collectCoverageFrom='src/types/governance/BudgetTypes.ts' \
  --collectCoverageFrom='src/services/governance/BudgetService.ts' \
  --collectCoverageFrom='src/config/budgetConfig.ts' \
  --collectCoverageFrom='src/**/BudgetUsageStore*.ts' \
  --testPathPattern=governance
```

**Requirement:** 100% statement and branch coverage for:

- `src/types/governance/BudgetTypes.ts` (if runtime-validated)
- `src/config/budgetConfig.ts` (or equivalent getBudgetConfigs)
- Budget usage store (single conditional update; no read-then-write)
- `src/services/governance/BudgetService.ts`
- Instrumentation call sites (BLOCK/WARN/ALLOW branches)

---

## 9. Success Criteria — 100% Coverage Checklist

Phase 7.2 tests are complete when:

1. **BudgetService:** Applicable config matching (all non-null scope fields match); any hard cap exceeded → BLOCK, **no reserve** (atomic condition fails); soft cap exceeded (no hard) → WARN, reserve; both under → ALLOW, reserve. **WARN uses usage_after_reserve.** Dedupe: same operation_id returns stored outcome, no double increment. Ledger: BUDGET_BLOCK, BUDGET_WARN, BUDGET_RESERVE with usage_before, usage_after, cap_hard, cap_soft, matched_configs. Deterministic: same inputs → same result.
2. **Usage store:** **One conditional update** per reserve (no read-then-write); condition failure → no increment; getUsage returns reserved_count; period_key isolation; reserved_count only (no consumed_count, no decrement on failure).
3. **Instrumentation:** Mock BudgetService; BLOCK → operation not called; WARN/ALLOW → operation called; operation_id in request; cost class and scope passed correctly.
4. **Coverage gate:** **100% statement and branch coverage** for Phase 7.2 budget modules (including no-applicable-config and amount default); CI passes before merge.

---

## 10. Integration Tests (Optional, Env-Gated)

**Condition:** Run only when budget tables and Plan Ledger are available (e.g. `RUN_PHASE7_2_INTEGRATION_TESTS=true`).

**File:** `src/tests/integration/governance/budget-service.test.ts`

| Scenario | Description |
|----------|-------------|
| BudgetService E2E | reserve with real config and usage store; assert BUDGET_RESERVE in Plan Ledger; second reserve same operation_id returns same outcome without double count; reserve until hard cap → BLOCK and no increment |
| Usage store E2E | reserve conditional update; getUsage; period_key isolation |
| Concurrency (optional) | Two concurrent reserves; only one succeeds when at cap (if test harness supports) |

---

## References

- [PHASE_7_2_CODE_LEVEL_PLAN.md](../PHASE_7_2_CODE_LEVEL_PLAN.md) — implementation plan (§1–§8)
- [PHASE_7_IMPLEMENTATION_PLAN.md](../PHASE_7_IMPLEMENTATION_PLAN.md) — EPIC 7.2 acceptance criteria
- [PHASE_7_CONTRACTS_ADDENDUM.md](../PHASE_7_CONTRACTS_ADDENDUM.md) — §5 Budget precedence, reserve-before-execute
- [PHASE_6_1_TEST_PLAN.md](../../phase_6/testing/PHASE_6_1_TEST_PLAN.md) — structure reference
