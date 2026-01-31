# Phase 6 — Test Coverage Review

**Created:** 2026-01-30  
**Purpose:** Compare Phase 6 (100% coverage target) vs older phases; list remaining gaps for Phase 6.

---

## 1. Summary

- **Phase 6** (plan services, handlers/phase6, types/plan, planTypeConfig) is **explicitly targeted at 100%** coverage per test plans 6.1–6.4. Current Phase-6-scoped coverage is **~95–97% statements/lines**, with a few files and branches below 100%.
- **Older phases** (2–5, perception, synthesis, world-model, execution, decision, etc.) were **not** defined with a 100% coverage target; their test plans focus on critical paths and key branches. Full-project coverage is **~80% statements, ~65% branch**, with several modules in the 40–75% range.

---

## 2. Phase 6 Coverage (100% Target)

**Scope:** `src/services/plan/**`, `src/handlers/phase6/**`, `src/types/plan/*`, `src/config/planTypeConfig.ts`.

| File | Stmts | Branch | Funcs | Lines | Notes |
|------|-------|--------|-------|-------|--------|
| **planTypeConfig.ts** | 100 | 100 | 100 | 100 | ✅ |
| **types/plan** (PlanSchema, PlanTypeConfig) | 100 | 100 | 100 | 100 | ✅ |
| **PlanLedgerService.ts** | 100 | 100 | 100 | 100 | ✅ |
| **PlanStateEvaluatorService.ts** | 100 | 85.71 | 100 | 100 | Branch: line 27 (optional branch) |
| **PlanStepExecutionStateService.ts** | 100 | 95.23 | 100 | 100 | Branch: line 130 (error name check) |
| **PlanLifecycleService.ts** | 100 | 86.11 | 100 | 100 | Branch: 35, 89, 103, 105, 108 (ledger/data branches) |
| **PlanPolicyGateService.ts** | 100 | 83.33 | 100 | 100 | Branch: 53-54, 100, 129-130, 145-146 |
| **plan-lifecycle-api-handler.ts** | 96.99 | 82.66 | 100 | 100 | Uncovered: 29-60 (buildServices), 157, 202, 231, 260, 277, 289, 316 |
| **plan-orchestrator-handler.ts** | 100 | 66.66 | 100 | 100 | Branch: 40, 47-99 (buildOrchestrator) |
| **PlanOrchestratorService.ts** | 96.7 | 83.92 | 81.81 | 96.42 | 255, 290-291 (private helpers); 81.81% funcs = private methods |
| **PlanProposalGeneratorService.ts** | 95.83 | 72.72 | 100 | 95.65 | Line 49 (one branch) |
| **PlanRepositoryService.ts** | 87.01 | 72.72 | 88.23 | 91.54 | 180-185 (updatePlanStatus optional fields) |
| **PlanStepToActionIntentAdapter.ts** | **33.33** | **0** | **33.33** | **33.33** | **Gap:** Adapter not unit tested; orchestrator mocks it. Need `PlanStepToActionIntentAdapter.test.ts`. |

**Phase 6 aggregate (scoped run):** ~95.75% Stmts, ~81.93% Branch, ~92.59% Funcs, ~97% Lines.

---

## 3. Phase 6 Gaps to Reach 100%

1. **PlanStepToActionIntentAdapter.ts** — **33% coverage.** Add `src/tests/unit/plan/PlanStepToActionIntentAdapter.test.ts`: test `createIntentFromPlanStep` with mocked ActionIntentService; assert proposal shape (action_type, why, action_ref) and `createIntent` call.
2. **PlanRepositoryService.ts** — 87% stmts, 91.54% lines. Cover lines 180-185 (updatePlanStatus optional attributes: completed_at, completion_reason, aborted_at, expired_at) with tests that trigger those branches.
3. **plan-lifecycle-api-handler.ts** — Uncovered 29-60 (buildServices), 157, 202, 231, 260, 277, 289, 316. Add tests that exercise buildServices path (e.g. 503 when env missing already present; optional: tests that hit CORS or internal branches if they affect behavior).
4. **plan-orchestrator-handler.ts** — 66% branch. Uncovered 40, 47-99 (buildOrchestrator). Handler tests mock PlanOrchestratorService; buildOrchestrator is only run when handler runs. Optional: integration-style test that invokes handler with real env so buildOrchestrator runs, or accept branch gap for constructor/build code.
5. **PlanOrchestratorService.ts** — 81.81% funcs (private methods getNextPendingStep, getActivePlanIdsForAccount). Already tested indirectly via runCycle/applyStepOutcome. No change unless we expose or test privates.
6. **PlanLifecycleService / PlanPolicyGateService / PlanStateEvaluatorService / PlanStepExecutionStateService** — Remaining uncovered branches are optional/edge (e.g. optional chaining, alternate branches). Add cases only if test plans require every branch.

---

## 4. Older Phases (No 100% Target)

These areas were not scoped to 100% in their test plans; coverage is acceptable per phase goals.

| Area | Stmts (approx) | Note |
|------|-----------------|------|
| **services/world-model** | ~60% | EvidenceService, SchemaRegistryService, SnapshotService, WorldStateService — lower coverage. |
| **services/synthesis** | ~73% | SynthesisEngine, ConditionEvaluator, RulesetLoader — partial. |
| **services/perception/connectors** | 0% | CRMConnector, SupportConnector, UsageAnalyticsConnector — no unit tests. |
| **handlers/phase4** | ~82% | tool-invoker-handler ~61%; execution-state-schemas, execution-failure-recorder lower. |
| **types** (some) | Mixed | ExecutionTypes 0% stmts; PostureTypes ~42%; DecisionTypes ~85%. |
| **perception detectors** | ~86% | EngagementDetector ~63%; others 80–97%. |

**Full project (jest default collectCoverageFrom):** **80.53%** Stmts, **65.18%** Branch, **81.8%** Funcs, **80.67%** Lines.

---

## 5. Recommendations

1. **Phase 6 only:** Treat 100% as the target for Phase 6 modules. Highest impact: add **PlanStepToActionIntentAdapter.test.ts** and **PlanRepositoryService** tests for updatePlanStatus optional fields; then address handler buildServices/buildOrchestrator branches if desired.
2. **Older phases:** Leave as-is for now; no project-wide 100% requirement. Improve coverage only when touching those areas or when a phase test plan is updated to require it.
3. **CI:** Add an optional coverage gate **only for Phase 6** (e.g. collectCoverageFrom plan + handlers/phase6 + types/plan + planTypeConfig, threshold 95% statements, 80% branch) so new plan code keeps coverage high without forcing older phases to 100%.

---

## 6. How to Run Coverage

**Phase 6 only (plan + handlers/phase6 + types/plan + config):**
```bash
npm test -- --coverage \
  --collectCoverageFrom="src/services/plan/**/*.ts" \
  --collectCoverageFrom="src/handlers/phase6/**/*.ts" \
  --collectCoverageFrom="src/types/plan/*.ts" \
  --collectCoverageFrom="src/config/planTypeConfig.ts" \
  --testPathPattern="plan|planTypeConfig|PlanProposal|PlanPolicyGate|plan-lifecycle-api|plan-orchestrator"
```

**Full project:**
```bash
npm test -- --coverage
```

---

## References

- [PHASE_6_1_TEST_PLAN.md](PHASE_6_1_TEST_PLAN.md) — 100% target 6.1
- [PHASE_6_2_TEST_PLAN.md](PHASE_6_2_TEST_PLAN.md) — 100% target 6.2
- [PHASE_6_3_TEST_PLAN.md](PHASE_6_3_TEST_PLAN.md) — 100% target 6.3
- [PHASE_6_4_TEST_PLAN.md](PHASE_6_4_TEST_PLAN.md) — 100% target 6.4 (GET routes)
