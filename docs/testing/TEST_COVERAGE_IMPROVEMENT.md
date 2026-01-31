# How to Improve Test Coverage

Current overall coverage (from latest `npx jest --coverage --testPathIgnorePatterns=integration`): **Statements ~65%**, **Branches ~50%**, **Functions ~71%**, **Lines ~65%** (after excluding `scripts`, `custom-resources`, `tests`, `stacks`).  
Coverage is collected from `src/**/*.ts` (excluding `*.d.ts`, `index.ts`, `stacks/**`, `scripts/**`, `custom-resources/**`, `tests/**`).

**Phase 3 coverage gaps (handlers + DecisionSynthesisService) are implemented** — see `docs/implementation/phase_3/testing/PHASE_3_COVERAGE_GAPS_PLAN.md` (checklist completed).

**Phase 1 perception handlers (connector-poll, signal-detection, lifecycle-inference) unit tests are implemented** — see `docs/testing/COVERAGE_TEST_PLAN.md`; `handlers/perception` coverage is ~98%.

---

## Where to start implementing tests

**Start here (in order):**

1. ~~**Perception handlers (Phase 1, 0% coverage)**~~ — **Done.** connector-poll, signal-detection, lifecycle-inference.  
   - **Source:** `src/handlers/perception/connector-poll-handler.ts`, `signal-detection-handler.ts`, `lifecycle-inference-handler.ts`  
   - **Test files:** `src/tests/unit/handlers/perception/connector-poll-handler.test.ts`, `signal-detection-handler.test.ts`, `lifecycle-inference-handler.test.ts`  
   - See `docs/testing/COVERAGE_TEST_PLAN.md`.

2. **Phase 2 handlers (0% coverage)** — graph-materializer, synthesis-engine.  
   - **Source:** `src/handlers/phase2/graph-materializer-handler.ts`, `synthesis-engine-handler.ts`  
   - **Add test files:** `src/tests/unit/handlers/phase2/graph-materializer-handler.test.ts`, `synthesis-engine-handler.test.ts`  
   - Mock GraphService / SynthesisEngine.

3. **Phase 4 handlers with 0% coverage** — compensation, execution-failure-recorder, execution-recorder, tool-mapper.  
   - **Source:** `src/handlers/phase4/compensation-handler.ts`, `execution-failure-recorder-handler.ts`, `execution-recorder-handler.ts`, `tool-mapper-handler.ts`  
   - **Add test files:** `src/tests/unit/handlers/phase4/compensation-handler.test.ts` (or under `execution/` to match existing), `execution-failure-recorder-handler.test.ts`, `execution-recorder-handler.test.ts`, `tool-mapper-handler.test.ts`  
   - Note: `compensation-handler.test.ts` exists under `execution/` but may not be wiring the handler; add or move tests to cover the handler.

4. **Perception detectors (0% except AccountActivationDetector)** — DiscoveryStall, Engagement, RenewalWindow, StakeholderGap, SupportRisk, UsageTrend.  
   - **Add test files:** `src/tests/unit/perception/detectors/DiscoveryStallDetector.test.ts`, `EngagementDetector.test.ts`, etc. (one file or suite per detector).

5. **Graph/Neptune services (0%)** — GraphService, GraphMaterializer, NeptuneConnection. Mock Neptune in tests or exclude from coverage (see section 3).

6. **Perception connectors (0%)** — CRMConnector, SupportConnector, UsageAnalyticsConnector. Mock external calls.

Use existing handler tests as a template (e.g. `execution-starter-handler.test.ts`, `auto-approval-gate-handler.test.ts`, `phase3/decision-api-handler.test.ts`): createHandler + injected mocks, event validation, happy path, error paths.

---

## Prioritized list from latest coverage run

Run: `npx jest --coverage --testPathIgnorePatterns=integration`. Then open `coverage/lcov-report/index.html` for per-file uncovered lines.

### 0% coverage — implement tests first

| File | Path | Add test file |
|------|------|----------------|
| connector-poll-handler | `handlers/perception/connector-poll-handler.ts` | `tests/unit/handlers/perception/connector-poll-handler.test.ts` |
| lifecycle-inference-handler | `handlers/perception/lifecycle-inference-handler.ts` | `tests/unit/handlers/perception/lifecycle-inference-handler.test.ts` |
| signal-detection-handler | `handlers/perception/signal-detection-handler.ts` | `tests/unit/handlers/perception/signal-detection-handler.test.ts` |
| graph-materializer-handler | `handlers/phase2/graph-materializer-handler.ts` | `tests/unit/handlers/phase2/graph-materializer-handler.test.ts` |
| synthesis-engine-handler | `handlers/phase2/synthesis-engine-handler.ts` | `tests/unit/handlers/phase2/synthesis-engine-handler.test.ts` |
| compensation-handler | `handlers/phase4/compensation-handler.ts` | Extend `tests/unit/execution/compensation-handler.test.ts` or add handler test |
| execution-failure-recorder-handler | `handlers/phase4/execution-failure-recorder-handler.ts` | `tests/unit/execution/execution-failure-recorder-handler.test.ts` (exists; verify it imports handler) |
| execution-recorder-handler | `handlers/phase4/execution-recorder-handler.ts` | `tests/unit/execution/execution-recorder-handler.test.ts` (exists; verify handler coverage) |
| tool-mapper-handler | `handlers/phase4/tool-mapper-handler.ts` | `tests/unit/execution/tool-mapper-handler.test.ts` (exists; verify handler coverage) |
| GraphService | `services/graph/GraphService.ts` | `tests/unit/graph/GraphService.test.ts` (mock Neptune) |
| GraphMaterializer | `services/graph/GraphMaterializer.ts` | `tests/unit/graph/GraphMaterializer.test.ts` |
| NeptuneConnection | `services/graph/NeptuneConnection.ts` | `tests/unit/graph/NeptuneConnection.test.ts` |
| BaseConnector | `services/perception/BaseConnector.ts` | Test via concrete connector tests or thin adapter |
| IConnector | `services/perception/IConnector.ts` | Same as BaseConnector |
| CRMConnector | `services/perception/connectors/CRMConnector.ts` | `tests/unit/perception/connectors/CRMConnector.test.ts` |
| SupportConnector | `services/perception/connectors/SupportConnector.ts` | `tests/unit/perception/connectors/SupportConnector.test.ts` |
| UsageAnalyticsConnector | `services/perception/connectors/UsageAnalyticsConnector.ts` | `tests/unit/perception/connectors/UsageAnalyticsConnector.test.ts` |
| DiscoveryStallDetector | `services/perception/detectors/DiscoveryStallDetector.ts` | `tests/unit/perception/detectors/DiscoveryStallDetector.test.ts` |
| EngagementDetector | `services/perception/detectors/EngagementDetector.ts` | `tests/unit/perception/detectors/EngagementDetector.test.ts` |
| RenewalWindowDetector | `services/perception/detectors/RenewalWindowDetector.ts` | `tests/unit/perception/detectors/RenewalWindowDetector.test.ts` |
| StakeholderGapDetector | `services/perception/detectors/StakeholderGapDetector.ts` | `tests/unit/perception/detectors/StakeholderGapDetector.test.ts` |
| SupportRiskDetector | `services/perception/detectors/SupportRiskDetector.ts` | `tests/unit/perception/detectors/SupportRiskDetector.test.ts` |
| UsageTrendDetector | `services/perception/detectors/UsageTrendDetector.ts` | `tests/unit/perception/detectors/UsageTrendDetector.test.ts` |
| ExecutionTypes | `types/ExecutionTypes.ts` | Type-only; exclude or add smoke test |

### Low coverage — add cases to existing tests

| File | % Stmts | % Branch | Uncovered focus |
|------|---------|----------|-----------------|
| tool-invoker-handler | 34 | 21 | Lines 43–50, 122–198, 242, 271–582, 618–620, 634–638, 662–676, 687–697, 701–704 |
| SignalService | 43 | 25 | 77, 87–91, 107, 197, 216–292, 323–351, 388–416, 431–464, 479, 494, 536–619 |
| auto-approval-gate-handler | 51 | 41 | 91–92, 112–226 |
| SnapshotService | 47 | 29 | 182–305 |
| EvidenceService | 54 | 21 | 136–298, 323–325, 332–338, 342–345, 379 |
| SynthesisEngine | 65 | 40 | 151–154, 264–269, 289–295, 324–332, 367–375, 410–434, 486–536 |
| IdentityService | 69 | 40 | 83–88, 124–129, 140, 171–179, 188–193, 204, 219–268, 318–323, 373–378, 414–435, 484, 509–518, 547–552 |
| WorldStateService | 73 | 49 | 152, 196–198, 210–229, 244, 251–259, 326–331, 350–351, 359–365, 384 |
| SchemaRegistryService | 60 | 27 | 53–60, 84, 102, 112–120, 153–157, 177–258 |

---

## 1. Highest impact: add unit tests where there are none

These **handlers and services** have **no or minimal unit test coverage** and are strong candidates to raise coverage and regression safety.

### Handlers (0% unit coverage)

| Handler | Path | Notes |
|--------|------|--------|
| ~~decision-api-handler~~ | `handlers/phase3/decision-api-handler.ts` | ✅ Unit tests in `phase3/decision-api-handler.test.ts` |
| ~~decision-evaluation-handler~~ | `handlers/phase3/decision-evaluation-handler.ts` | ✅ Unit tests in `phase3/decision-evaluation-handler.test.ts` |
| ~~decision-trigger-handler~~ | `handlers/phase3/decision-trigger-handler.ts` | ✅ Unit tests in `phase3/decision-trigger-handler.test.ts` |
| ~~budget-reset-handler~~ | `handlers/phase3/budget-reset-handler.ts` | ✅ Unit tests in `phase3/budget-reset-handler.test.ts` |
| graph-materializer-handler | `handlers/phase2/graph-materializer-handler.ts` | Graph build; depends on GraphService |
| synthesis-engine-handler | `handlers/phase2/synthesis-engine-handler.ts` | Synthesis; depends on SynthesisEngine |
| ~~connector-poll-handler~~ | `handlers/perception/connector-poll-handler.ts` | ✅ Unit tests in `perception/connector-poll-handler.test.ts` |
| ~~signal-detection-handler~~ | `handlers/perception/signal-detection-handler.ts` | ✅ Unit tests in `perception/signal-detection-handler.test.ts` |
| ~~lifecycle-inference-handler~~ | `handlers/perception/lifecycle-inference-handler.ts` | ✅ Unit tests in `perception/lifecycle-inference-handler.test.ts` |
| compensation-handler | `handlers/phase4/compensation-handler.ts` | Test exists under execution/; ensure handler is covered |
| execution-failure-recorder-handler | `handlers/phase4/execution-failure-recorder-handler.ts` | Add or extend unit test for handler |
| execution-recorder-handler | `handlers/phase4/execution-recorder-handler.ts` | Add or extend unit test for handler |
| tool-mapper-handler | `handlers/phase4/tool-mapper-handler.ts` | Add or extend unit test for handler |

### Services (0% or very low unit coverage)

| Service | Path | Notes |
|---------|------|--------|
| ~~DecisionSynthesisService~~ | `services/decision/DecisionSynthesisService.ts` | ✅ Unit tests in `decision/DecisionSynthesisService.test.ts` |
| GraphService | `services/graph/GraphService.ts` | Neptune/graph; mock in tests or exclude |
| GraphMaterializer | `services/graph/GraphMaterializer.ts` | Graph materialization |
| NeptuneConnection | `services/graph/NeptuneConnection.ts` | Neptune client; mock in tests |
| BaseConnector / IConnector | `services/perception/BaseConnector.ts`, `IConnector.ts` | Abstract; test via concrete connectors or thin adapter tests |
| CRMConnector, SupportConnector, UsageAnalyticsConnector | `services/perception/connectors/*.ts` | Connectors; mock external calls |
| DiscoveryStallDetector, EngagementDetector, RenewalWindowDetector, StakeholderGapDetector, SupportRiskDetector, UsageTrendDetector | `services/perception/detectors/*.ts` | Detectors; pure logic, good for unit tests |

**Suggested order:**  
1) **Phase 1 perception handlers** (connector-poll, signal-detection, lifecycle-inference) — add `handlers/perception/*.test.ts`.  
2) **Phase 2 handlers** (graph-materializer, synthesis-engine) — mock GraphService / SynthesisEngine.  
3) **Phase 4 handlers** (compensation, execution-failure-recorder, execution-recorder, tool-mapper) — extend or add handler-level tests.  
4) **Detectors** — one test file per detector in `tests/unit/perception/detectors/`.  
5) **Graph/Neptune** — add tests with mocked Neptune or exclude from coverage (see section 3).  
6) **Connectors** — one test per connector with mocked external calls.

---

## 2. Increase coverage in already-tested files

Many files already have tests but sit at **medium coverage** (e.g. 40–80% statements). To improve:

- **SignalService** (~43%): Add cases for missing branches (error paths, edge cases in aggregation/validation). See “Prioritized list from latest coverage run” for uncovered line ranges.
- **EvidenceService, SnapshotService, WorldStateService, SchemaRegistryService**: Add tests for uncovered branches (see coverage report “Uncovered Line #” or `coverage/lcov-report/index.html`).
- **SynthesisEngine, ConditionEvaluator, RulesetLoader**: Add tests for failure paths and edge rules.
- **tool-invoker-handler** (~34%): Large handler; add tests for tool invocation paths and error branches.
- **auto-approval-gate-handler** (~51%): Add tests for branches 112–226.
- **DecisionTypes / ActionIntentService**: Cover optional fields and validation branches.
- **ExecutionTypes, PostureTypes, SignalTypes**: Type-only or mostly type files; add smoke tests that import and use types or exclude from coverage.

Run coverage and open `coverage/lcov-report/index.html` (or the text summary) and sort by “Uncovered Lines” to target specific branches.

---

## 3. Reduce noise and focus coverage on “core” code

**Current state:** The following exclusions are **already applied** in `jest.config.js`: `src/scripts/**`, `src/custom-resources/**`, `src/tests/**`, plus `*.d.ts`, `index.ts`, `stacks/**`. No change needed for those.

If you want to raise **reported** coverage further by excluding hard-to-test or type-only code:

- **Optional exclusions** to add to `collectCoverageFrom` in `jest.config.js`:
  - `src/types/**` (or only include types that export runtime behavior)
  - Optionally `src/services/graph/**` until you add Neptune mocks

Example (current config already has the first block; add one or both of the optional lines if desired):

```js
collectCoverageFrom: [
  'src/**/*.ts',
  '!src/**/*.d.ts',
  '!src/index.ts',
  '!src/stacks/**',
  '!src/scripts/**',
  '!src/custom-resources/**',
  '!src/tests/**',
  // '!src/types/**',           // optional: type-only files
  // '!src/services/graph/**',  // optional: until Neptune is mocked
],
```

Re-run coverage after any exclusions; statement/line coverage for the remaining files will go up.

---

## 4. Enforce a minimum with coverage thresholds

**Current state:** `coverageThreshold` is **not** set in `jest.config.js`, so the build does not fail when coverage drops.

To fail the build if coverage drops below a target, add to `jest.config.js`:

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

Start with values at or slightly below current (e.g. 40–50%) so the build doesn’t fail immediately, then raise them as you add tests.

---

## 5. Quick wins summary

| Action | Effect |
|--------|--------|
| Add unit tests for Phase 1 perception handlers (connector-poll, signal-detection, lifecycle-inference) | +Phase 1 perception path coverage (currently 0%) |
| Add unit tests for Phase 2 handlers (graph-materializer, synthesis-engine) | +graph/synthesis handler coverage |
| Add unit tests for Phase 4 handlers (compensation, execution-failure-recorder, execution-recorder, tool-mapper) | +execution path coverage |
| Add unit tests for detectors (one file per detector in `perception/detectors/`) | +branch coverage in perception (most at 0%) |
| Add cases for SignalService, tool-invoker-handler, auto-approval-gate-handler | +high-impact file coverage |
| Optionally exclude `src/types/**` or `src/services/graph/**` from coverage | Higher reported % on core code |
| Set `coverageThreshold` and raise gradually | Prevents coverage regression |

Use the **per-file coverage report** (`npx jest --coverage --testPathIgnorePatterns=integration`, then open `coverage/lcov-report/index.html`) to see exact uncovered lines and branches and to prioritize which of the above to do first.
