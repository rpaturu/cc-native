# Project-Wide Test Coverage Review

**Generated from:** `npm test -- --coverage --testPathIgnorePatterns=integration`  
**Scope:** All `src/**/*.ts` except `*.d.ts`, `index.ts`, `stacks/**`, `scripts/**`, `custom-resources/**`, `tests/**`.

**Phase coverage test plans (by area):**
- [Phase 1 — Perception](../implementation/phase_1/testing/PHASE_1_COVERAGE_TEST_PLAN.md) (LifecycleStateService, SignalService)
- [Phase 2 — World-model & Synthesis](../implementation/phase_2/testing/PHASE_2_COVERAGE_TEST_PLAN.md) (EvidenceService, SnapshotService, SynthesisEngine, etc.)
- [Phase 4 — Tool invoker & schemas](../implementation/phase_4/testing/PHASE_4_COVERAGE_TEST_PLAN.md) (tool-invoker-handler, execution-state-schemas)
- [Phase 5 — Core services](../implementation/phase_5/testing/PHASE_5_COVERAGE_TEST_PLAN.md) (IdentityService, TenantService, TraceService, Logger)

---

## Overall Metrics

| Metric     | Coverage   | Count        |
|-----------|------------|--------------|
| Statements| **81.99%** | 5482 / 6686  |
| Branches  | **66.67%** | 2134 / 3202  |
| Functions | **83.07%**  | 653 / 786    |
| Lines     | **82.12%** | 5344 / 6505  |

**Unit tests:** 119 suites · 1264 tests (`npm test` / `--testPathIgnorePatterns=integration`)  
**Integration tests:** 16 suites · 66 tests (post-deploy: `npx jest --testPathPattern=tests/integration`; includes Phase 6.3 plan-orchestrator, Phase 6.4 plans-api). **Phase 6.4 (Plans API GET + CDK): complete.**

---

## Coverage by Area (Phase / Domain)

### High coverage (≈90%+ statements)

- **Phase 6 (plan):** handlers 97.92%, plan services 94.38%, types/plan 100%.  
  Single notable gap: `PlanStepToActionIntentAdapter.ts` **33.33%** (adapter not directly unit-tested).
- **Autonomy:** services/autonomy **100%** statements.
- **Connector:** services/connector **100%** statements.
- **Learning:** services/learning **100%** statements.
- **Config / constants:** config, constants **100%**.
- **Adapters:** adapters/crm 98.11%, adapters/internal 100%.
- **Phase 3 handlers:** 99.03% statements (some branch/function gaps).
- **Phase 5 handlers:** 94.31% statements.

### Moderate coverage (≈70–90% statements)

- **Phase 2 handlers:** 91.45% (graph-materializer 100%, synthesis-engine 86.48%).
- **Phase 4 handlers:** 82.92% (execution-state-schemas **95.83%**; tool-invoker-handler **61.15%** is the main drag).
- **Decision services:** 93.89% (DecisionContextAssembler, DecisionSynthesisService, PolicyGateService have uncovered branches/lines).
- **Execution services:** 93.6% (IdempotencyService, ExecutionAttemptService, ExecutionOutcomeService have small gaps).
- **Events:** 93.58%.
- **Perception:** 81.34% overall; detectors 86.52%; LifecycleStateService **91.76%** (improved); SignalService has more uncovered lines.
- **Core services:** 77.58% (IdentityService **68.98%**, TenantService **89.47%** (improved), TraceService 84%, Logger 92.85%).
- **Methodology:** 81.58%.
- **Ledger:** 85.71%.
- **Types (root):** 82.84%.
- **Utils:** 81.25%.

### Low coverage (&lt;70% statements)

- **World-model:** **70.14%** (EvidenceService 53.98%, SchemaRegistryService 60.49%, SnapshotService **94.44%** (improved), WorldStateService 73.43%).
- **Synthesis:** **74.23%** (SynthesisEngine **66.66%**, ConditionEvaluator 72.5%, RulesetLoader 81.08%, AccountPostureStateService 87.87%).
- **Phase 4 tool-invoker-handler:** **71.9%** statements, 57.14% branches (improved; resilience path, MCP parse/retry, 403/timeout covered).

### Zero coverage

- **services/graph:** GraphMaterializer, GraphService, NeptuneConnection — **0%** (no unit tests; Neptune-bound).
- **services/perception:** BaseConnector.ts, IConnector.ts — **0%** (interfaces/base; concrete connectors below).
- **services/perception/connectors:** CRMConnector, SupportConnector, UsageAnalyticsConnector — **0%**.
- **types/ExecutionTypes.ts:** **0%** statements (type-only file).

---

## File-Level Summary (Uncovered Lines)

### Handlers

| File | Stmts | Branch | Uncovered focus |
|------|-------|--------|------------------|
| plan-lifecycle-api-handler.ts | 96.99 | 82.66 | 29–60 (buildServices), 157, 202, 231, 260, 277, 289, 316 |
| plan-orchestrator-handler.ts | 100 | 66.66 | 40, 47–99 (buildOrchestrator) |
| synthesis-engine-handler.ts | 86.48 | 65.85 | 206, 299–315, 325–341, 356–374 |
| tool-invoker-handler.ts | **71.9** | **57.14** | 132, 177–211, 312–315, 335, 353, 359, 362, 376–397, 478–482, 512, 528–529, 551, 554, 571, 600, 616, 675–679, 703–705, 709–717, 728–730, 736–738, 742–745 |
| execution-state-schemas.ts | 66.66 | 64.28 | 19–22 |
| execution-status-api-handler.ts | 90.59 | 81.15 | 34–40, 49–53, 126, 263, 376–384 |
| autonomy-admin-api-handler.ts | 89.01 | 79.25 | 252–289, 362, 394 |
| heat-scoring-handler.ts | 91.83 | 76 | 49–51, 92–93 (50% functions) |

### Services

| File | Stmts | Branch | Uncovered focus |
|------|-------|--------|------------------|
| **PlanStepToActionIntentAdapter.ts** | **33.33** | **0** | 33–35 (buildProposal), 54–56 (createIntentFromPlanStep) |
| PlanRepositoryService.ts | 87.01 | 72.72 | 180–185 (updateStepStatus path) |
| IdentityService.ts | 68.98 | 40 | Many branches: 83–88, 124–129, 140, 171–179, 188–193, 204, 219–224, 229–268, 318–323, 373–378, 414–415, 418–419, 422–423, 426–427, 434–435, 484, 509–510, 513–514, 517–518, 547–552 |
| TenantService.ts | 89.47 | 66.66 | 114–116, 120–122 |
| DecisionContextAssembler.ts | 81.81 | 63.63 | 119, 131–132, 187, 190 |
| DecisionSynthesisService.ts | 88.88 | 68.75 | 152–161, 223 |
| LedgerService.ts | 85.71 | 67.64 | 123–124, 151–155, 173–183 |
| SynthesisEngine.ts | **64.81** | **40** | 151–154, 264–269, 289–295, 324–332, 367–375, 410–434, 486–536 |
| EvidenceService.ts | **53.98** | **21.33** | 136–298, 323–325, 332–333, 337–338, 342–345, 379 |
| SchemaRegistryService.ts | 60.49 | 26.66 | 53–60, 84, 102, 112–120, 153–157, 177–258 |
| SnapshotService.ts | **94.44** | 69.04 | 252–253, 257–259 |
| WorldStateService.ts | 73.43 | 49.01 | 152, 196–198, 210–229, 244, 251–259, 326–331, 350–351, 359–360, 364–365, 384 |
| SignalService.ts | 80.46 | 63.21 | 87–91, 107, 197, 229, 251, 288–292, 346–351, 412–413, 459–464, 542, 583, 606–619 |
| LifecycleStateService.ts | 81.17 | 70.21 | 95–100, 155–160, 181, 191, 218, 224–226, 246–248, 320–325, 347–352 |
| EngagementDetector.ts | **63.63** | 55.17 | 90, 99–125, 143–152 |
| MethodologyService.ts | 80.72 | 48 | 134–142, 195–229, 272–276, 312–317 |
| AssessmentService.ts | 82.29 | 55.88 | 150–154, 192, 197–202, 228, 297, 327, 350–375 |
| AssessmentComputationService.ts | 81.61 | 69.62 | 196, 213, 229, 252–257, 278, 296, 322, 358, 368–373, 381–385, 394 |

### Types

| File | Stmts | Uncovered |
|------|-------|-----------|
| ExecutionTypes.ts | **0** | 8–286 (type-only) |
| PostureTypes.ts | 94.44 | 206, 214 |
| GraphTypes.ts | 70.96 | 195, 211–218, 236–254, 262, 266, 270 |
| DecisionTypes.ts | 85.45 | 248, 326–327, 341, 346, 352, 356, 559 |
| ExecutionErrors.ts | 87.09 | 85, 94, 104, 113 |

### Utils

| File | Stmts | Uncovered |
|------|-------|-----------|
| aws-client-config.ts | 74.46 | 33, 70, 83–86, 106–111, 124–132 |

---

## Phase vs Coverage (Intent)

- **Phase 6:** Aiming for **100%** on plan domain; currently ~95–97% except `PlanStepToActionIntentAdapter` (33%) and small handler/buildService branches.
- **Older phases (2–5):** No project-wide 100% target; coverage is **good** (80%+ overall) but with known gaps:
  - Phase 2: synthesis-engine and graph handler branches.
  - Phase 3: decision-evaluation-handler 50% functions; some branches.
  - Phase 4: tool-invoker-handler and execution-state-schemas are the largest gaps; other handlers 82–97%.
  - Phase 5: autonomy-admin-api, heat-scoring-handler have minor gaps.
- **Cross-cutting:** Graph (0%), perception connectors (0%), world-model and synthesis services (46–73%), core IdentityService/TenantService (68–80%) are the main drag on overall statements/branches.

---

## Recommendations

1. **Project-wide:** Keep current 80%+ statement coverage as baseline; use this doc and `coverage/lcov-report/index.html` for prioritization.
2. **Phase 6:** To reach 100% for plan code: add direct unit tests for `PlanStepToActionIntentAdapter`; add tests for `PlanRepositoryService.updateStepStatus`; cover `buildServices` / `buildOrchestrator` in lifecycle and orchestrator handlers (or extract and test in isolation).
3. **Largest impact (older phases):** Add tests for `tool-invoker-handler` (61%), `SynthesisEngine` (67%), `EvidenceService` (54%), and world-model/synthesis branches. SnapshotService and PostureTypes postureEquals are now well covered (94%+).
4. **Zero-coverage areas:** Decide policy for graph (Neptune), perception connectors, and type-only files (e.g. exclude from coverage or add minimal smoke tests).

---

## How to improve coverage

- **Per-file gaps:** Run `npm test -- --coverage --testPathIgnorePatterns=integration`, then open `coverage/lcov-report/index.html` for exact uncovered lines and branches. Use the tables above to prioritize files.
- **Templates:** Use existing handler tests (e.g. `execution-starter-handler.test.ts`, `auto-approval-gate-handler.test.ts`, `phase3/decision-api-handler.test.ts`) as templates: create handler with injected mocks, event validation, happy path, error paths.
- **Optional exclusions:** To raise reported coverage on “core” code, you can add to `collectCoverageFrom` in `jest.config.js`:
  - `!src/types/**` (type-only files)
  - `!src/services/graph/**` (until Neptune is mocked)
- **Coverage thresholds:** To fail the build when coverage drops, add to `jest.config.js`:
  ```js
  coverageThreshold: {
    global: {
      statements: 50,
      branches: 40,
      functions: 50,
      lines: 50,
    },
  },
  ```
  Set values at or slightly below current, then raise as you add tests.

---

*Last full run: unit — npm test -- --coverage --testPathIgnorePatterns=integration (119 suites, 1264 tests); integration — npx jest --testPathPattern=tests/integration (16 suites, 66 tests). Re-run and refresh this document when targeting coverage improvements.*
