# How to Improve Test Coverage

Current overall coverage (approximate): **Statements ~62%**, **Branches ~48%**, **Functions ~69%**, **Lines ~62%** (after excluding `scripts`, `custom-resources`, `tests`).  
Coverage is collected from `src/**/*.ts` (excluding `*.d.ts`, `index.ts`, `stacks/**`, `scripts/**`, `custom-resources/**`, `tests/**`).

**Phase 3 coverage gaps (handlers + DecisionSynthesisService) are implemented** — see `docs/implementation/phase_3/testing/PHASE_3_COVERAGE_GAPS_PLAN.md` (checklist completed).

---

## Where to start implementing tests

**Start here (in order):**

1. **`budget-reset-handler`** — Small, single-purpose handler; quick win and establishes the Phase 3 handler test pattern.  
   - **Source:** `src/handlers/phase3/budget-reset-handler.ts`  
   - **Add test file:** `src/tests/unit/handlers/phase3/budget-reset-handler.test.ts`

2. **Phase 3 handlers (critical path)** — decision-api, decision-evaluation, decision-trigger.  
   - **Source:** `src/handlers/phase3/decision-api-handler.ts`, `decision-evaluation-handler.ts`, `decision-trigger-handler.ts`  
   - **Add test files:** `src/tests/unit/handlers/phase3/decision-api-handler.test.ts`, `decision-evaluation-handler.test.ts`, `decision-trigger-handler.test.ts`  
   - Mock: EventPublisher, ActionIntentService, LedgerService, DecisionRunStateService, etc., as needed per handler.

3. **DecisionSynthesisService** — Single service used by decision-evaluation; high impact.  
   - **Source:** `src/services/decision/DecisionSynthesisService.ts`  
   - **Add test file:** `src/tests/unit/decision/DecisionSynthesisService.test.ts`

4. **Perception handlers** — connector-poll, signal-detection, lifecycle-inference (one test file per handler).  
5. **Detectors** — One test file per detector in `src/tests/unit/perception/detectors/` (or one suite per detector).  
6. **Phase 2 handlers** — graph-materializer, synthesis-engine (mock GraphService / SynthesisEngine).

Use existing handler tests as a template (e.g. `execution-starter-handler.test.ts`, `auto-approval-gate-handler.test.ts`): createHandler + injected mocks, event validation, happy path, error paths.

---

## 1. Highest impact: add unit tests where there are none

These **handlers and services** have **no dedicated unit tests** and are strong candidates to raise coverage and regression safety.

### Handlers (0% unit coverage)

| Handler | Path | Notes |
|--------|------|--------|
| ~~decision-api-handler~~ | `handlers/phase3/decision-api-handler.ts` | ✅ Unit tests in `phase3/decision-api-handler.test.ts` |
| ~~decision-evaluation-handler~~ | `handlers/phase3/decision-evaluation-handler.ts` | ✅ Unit tests in `phase3/decision-evaluation-handler.test.ts` |
| ~~decision-trigger-handler~~ | `handlers/phase3/decision-trigger-handler.ts` | ✅ Unit tests in `phase3/decision-trigger-handler.test.ts` |
| ~~budget-reset-handler~~ | `handlers/phase3/budget-reset-handler.ts` | ✅ Unit tests in `phase3/budget-reset-handler.test.ts` |
| graph-materializer-handler | `handlers/phase2/graph-materializer-handler.ts` | Graph build; depends on GraphService |
| synthesis-engine-handler | `handlers/phase2/synthesis-engine-handler.ts` | Synthesis; depends on SynthesisEngine |
| connector-poll-handler | `handlers/perception/connector-poll-handler.ts` | Connector poll; perception path |
| signal-detection-handler | `handlers/perception/signal-detection-handler.ts` | Signal detection; perception path |
| lifecycle-inference-handler | `handlers/perception/lifecycle-inference-handler.ts` | Lifecycle inference; perception path |

### Services (0% or very low unit coverage)

| Service | Path | Notes |
|---------|------|--------|
| ~~DecisionSynthesisService~~ | `services/decision/DecisionSynthesisService.ts` | ✅ Unit tests in `decision/DecisionSynthesisService.test.ts` |
| GraphService | `services/graph/GraphService.ts` | Neptune/graph; often 0% (external deps) |
| GraphMaterializer | `services/graph/GraphMaterializer.ts` | Graph materialization |
| NeptuneConnection | `services/graph/NeptuneConnection.ts` | Neptune client; mock in tests |
| BaseConnector / IConnector | `services/perception/BaseConnector.ts`, `IConnector.ts` | Abstract; test via concrete connectors or thin adapter tests |
| CRMConnector, SupportConnector, UsageAnalyticsConnector | `services/perception/connectors/*.ts` | Connectors; mock external calls |
| DiscoveryStallDetector, EngagementDetector, RenewalWindowDetector, StakeholderGapDetector, SupportRiskDetector, UsageTrendDetector | `services/perception/detectors/*.ts` | Detectors; pure logic, good for unit tests |

**Suggested order:**  
1) **Phase 3 handlers** (decision-api, decision-evaluation, decision-trigger, budget-reset) — critical user/API path.  
2) **DecisionSynthesisService** — single service, used by evaluation.  
3) **Perception handlers** (connector-poll, signal-detection, lifecycle-inference) — one test file per handler with mocks.  
4) **Phase 2 handlers** (graph-materializer, synthesis-engine) — mock GraphService / SynthesisEngine.  
5) **Detectors** — add one test file per detector (or one suite per detector) for branch coverage.  
6) **Graph/Neptune** — add tests with mocked Neptune if you want coverage; otherwise exclude from `collectCoverageFrom` (see below).

---

## 2. Increase coverage in already-tested files

Many files already have tests but sit at **medium coverage** (e.g. 40–80% statements). To improve:

- **SignalService** (~43%): Add cases for missing branches (error paths, edge cases in aggregation/validation).
- **EvidenceService, SnapshotService, WorldStateService**: Add tests for uncovered branches (see coverage report “Uncovered Line #”).
- **SynthesisEngine, ConditionEvaluator, RulesetLoader**: Add tests for failure paths and edge rules.
- **DecisionTypes / ActionIntentService**: Cover optional fields and validation branches.
- **ExecutionTypes, PostureTypes, SignalTypes**: Type-only files; coverage comes from usage. Either add trivial “smoke” tests that import and use types or exclude from coverage.

Run coverage and open `coverage/lcov-report/index.html` (or the text summary) and sort by “Uncovered Lines” to target specific branches.

---

## 3. Reduce noise and focus coverage on “core” code

If the goal is to raise **reported** coverage for business logic and handlers (and avoid dragging down the metric with hard-to-test or type-only code):

- **Exclude from `collectCoverageFrom`** in `jest.config.js`:
  - `src/scripts/**` (seed scripts)
  - `src/custom-resources/**` (custom CDK resources)
  - `src/types/**` (or only include types that export runtime behavior)
  - Optionally `src/services/graph/**` until you add Neptune mocks

Example (add to existing `collectCoverageFrom`):

```js
collectCoverageFrom: [
  'src/**/*.ts',
  '!src/**/*.d.ts',
  '!src/index.ts',
  '!src/stacks/**',
  '!src/scripts/**',
  '!src/custom-resources/**',
  '!src/tests/**',
],
```

- **Exclude integration test files from coverage** so they don’t show as 0%: they’re under `src/tests/integration/`. Adding `'!src/tests/**'` (as above) excludes all test code from collection, which is standard.

Re-run coverage after exclusions; statement/line coverage for the remaining files will go up.

---

## 4. Enforce a minimum with coverage thresholds

In `jest.config.js` you can fail the build if coverage drops below a target:

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
| Add unit tests for Phase 3 handlers (decision-api, decision-evaluation, decision-trigger, budget-reset) | +critical path coverage, fewer regressions |
| Add unit tests for DecisionSynthesisService | +one service fully covered |
| Add unit tests for perception handlers (connector-poll, signal-detection, lifecycle-inference) | +perception path coverage |
| Add unit tests for detectors (one file or suite per detector) | +branch coverage in perception |
| Exclude `src/scripts/**`, `src/custom-resources/**`, `src/tests/**` from coverage | Higher reported % on core code |
| Set `coverageThreshold` and raise gradually | Prevents coverage regression |

Use the **per-file coverage report** (`npx jest --coverage --testPathIgnorePatterns=integration`, then open `coverage/lcov-report/index.html`) to see exact uncovered lines and branches and to prioritize which of the above to do first.
