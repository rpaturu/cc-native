# Coverage Test Plan

This plan drives implementation of unit tests to improve coverage from **~62% statements / ~48% branches** toward higher targets. It is derived from `TEST_COVERAGE_IMPROVEMENT.md` and the latest `npx jest --coverage --testPathIgnorePatterns=integration` run.

**Reference:** `docs/testing/TEST_COVERAGE_IMPROVEMENT.md` (prioritized list and uncovered line ranges).

---

## Scope and order

| Phase | Scope | Test files to add/extend | Priority |
|-------|--------|---------------------------|----------|
| **1** | Phase 1 perception handlers (0% → covered) | `handlers/perception/connector-poll-handler.test.ts`, `signal-detection-handler.test.ts`, `lifecycle-inference-handler.test.ts` | P0 |
| **2** | Phase 2 handlers (0% → covered) ✅ | `handlers/phase2/graph-materializer-handler.test.ts`, `synthesis-engine-handler.test.ts` | P1 |
| **3** | Phase 4 handlers (0% or partial) ✅ | `handlers/phase4/execution-recorder-handler.test.ts`, `execution-failure-recorder-handler.test.ts`, `tool-mapper-handler.test.ts`, `compensation-handler.test.ts` (handler-invoking) | P1 |
| **4** | Perception detectors (0% → covered) ✅ | `perception/detectors/DiscoveryStallDetector.test.ts`, `EngagementDetector.test.ts`, `RenewalWindowDetector.test.ts`, `StakeholderGapDetector.test.ts`, `SupportRiskDetector.test.ts`, `UsageTrendDetector.test.ts` + `detector-test-helpers.ts` | P2 |
| **5** | Graph/Neptune services (0%) | `graph/GraphService.test.ts`, `GraphMaterializer.test.ts`, `NeptuneConnection.test.ts` with mocked Neptune, or exclude from coverage | P3 |
| **6** | Perception connectors (0%) | `perception/connectors/CRMConnector.test.ts`, `SupportConnector.test.ts`, `UsageAnalyticsConnector.test.ts` with mocked external calls | P3 |
| **7** | Low-coverage files (add cases) | More cases in SignalService, tool-invoker-handler, auto-approval-gate-handler, SnapshotService, EvidenceService, SynthesisEngine, IdentityService, WorldStateService, SchemaRegistryService | P2 |

---

## Phase 1: Perception handlers (P0) — implementation checklist

### 1.1 connector-poll-handler ✅

- **Source:** `src/handlers/perception/connector-poll-handler.ts`
- **Test file:** `src/tests/unit/handlers/perception/connector-poll-handler.test.ts`
- **Strategy:** Mock EvidenceService, EventPublisher, S3Client; mock CRMConnector, UsageAnalyticsConnector, SupportConnector to return instances with `connect`, `poll`, `disconnect` (poll returns `EvidenceSnapshotRef[]`).
- **Cases:**
  - [x] Happy path: `connectorType: 'CRM'` → connector connect/poll/disconnect called, EventPublisher.publish('CONNECTOR_POLL_COMPLETED') called, returns 200 + body with success, snapshotCount, traceId.
  - [x] Happy path: `connectorType: 'USAGE_ANALYTICS'` and `'SUPPORT'` → same pattern.
  - [x] Uses `event.traceId` when provided.
  - [x] Unknown connector type → publishes CONNECTOR_POLL_FAILED then throws.
  - [x] Connector.poll throws → handler publishes CONNECTOR_POLL_FAILED then rethrows.
  - [x] When publish of CONNECTOR_POLL_FAILED throws → handler rethrows original error.

### 1.2 signal-detection-handler ✅

- **Source:** `src/handlers/perception/signal-detection-handler.ts`
- **Test file:** `src/tests/unit/handlers/perception/signal-detection-handler.test.ts`
- **Strategy:** Mock S3Client, LedgerService, SuppressionEngine, LifecycleStateService, SignalService, EventPublisher; mock all detector classes to return instances with `detect()` returning [] or sample signals.
- **Cases:**
  - [x] Happy path: empty `event.snapshots` → no detector runs, returns 200, signalsCreated: 0.
  - [x] Happy path: one snapshot, one detector returns one signal → SignalService.createSignal called, returns 200 with signalsCreated: 1.
  - [x] Idempotency: createSignal throws ConditionalCheckFailedException or message includes ConditionalCheckFailed → handler continues.
  - [x] Detector throws → handler logs error, continues with other detectors.
  - [x] Non-idempotency error from createSignal → caught by detector catch, handler returns 200 with signalsCreated: 0.
  - [x] Uses event.traceId when provided.

### 1.3 lifecycle-inference-handler ✅

- **Source:** `src/handlers/perception/lifecycle-inference-handler.ts`
- **Test file:** `src/tests/unit/handlers/perception/lifecycle-inference-handler.test.ts`
- **Strategy:** Mock LedgerService, SuppressionEngine, LifecycleStateService, SignalService, EventPublisher.
- **Cases:**
  - [x] AccountState not found → getAccountState returns null → returns 200 with message 'AccountState not found, skipping inference'.
  - [x] No transition: getAccountState returns state, inferLifecycleState returns same as previousState → recordTransition not called, returns 200 with transitionOccurred: false.
  - [x] Transition: inferLifecycleState differs from previousState → recordTransition, applySuppression, logSuppressionEntries called; returns 200 with transitionOccurred: true.
  - [x] Uses event.traceId when provided.
  - [x] getAccountState throws → handler rethrows.

---

## Phase 2: Phase 2 handlers (P1) ✅

- **graph-materializer-handler:** ✅ `src/tests/unit/handlers/phase2/graph-materializer-handler.test.ts` — mock NeptuneConnection, GraphMaterializer; validation, NEPTUNE_CLUSTER_ENDPOINT required, happy path, rethrow.
- **synthesis-engine-handler:** ✅ `src/tests/unit/handlers/phase2/synthesis-engine-handler.test.ts` — mock documentClient.send (status COMPLETED/IN_PROGRESS/NOT_FOUND), SynthesisEngine, AccountPostureStateService, LedgerService, Neptune; status not COMPLETED skip, happy path, missing fields, synthesize throw, traceId/time.

---

## Phase 3: Phase 4 handler coverage (P1) ✅

- **Implemented:** Handler-invoking unit tests under `handlers/phase4/`:
  - `execution-recorder-handler.test.ts` — validation, success path (recordOutcome, updateStatus, append, createExecutionSignal), FAILED status, rethrow.
  - `execution-failure-recorder-handler.test.ts` — validation, success path, ActionIntent not found, attempt not found.
  - `tool-mapper-handler.test.ts` — validation, success path (getIntent, getToolMapping, mapParametersToToolArguments), intent not found, tool mapping not found.
  - `compensation-handler.test.ts` — intent not found (returns FAILED), NONE/COMPLETED/PENDING (AUTOMATIC/MANUAL).
- **Coverage:** Phase 4 handlers 0% → **~75%** statements (compensation ~91%, execution-failure-recorder ~89%, execution-recorder ~91%, tool-mapper ~94%).
- **Note:** Env vars for Phase 4 handlers are set in `src/tests/setup/jest-setup.ts` so handler modules can load.

---

## Phase 4: Perception detectors (P2) ✅

- **Implemented:** One test file per detector under `tests/unit/perception/detectors/`:
  - `detector-test-helpers.ts` — createEvidenceSnapshotRef, createMockS3Client (SHA256-safe).
  - `DiscoveryStallDetector.test.ts`, `EngagementDetector.test.ts`, `RenewalWindowDetector.test.ts`, `StakeholderGapDetector.test.ts`, `SupportRiskDetector.test.ts`, `UsageTrendDetector.test.ts`.
- **Coverage:** services/perception/detectors 18% → **86.52%** statements.

## Phase 5–7

- See `TEST_COVERAGE_IMPROVEMENT.md` for graph, connector, and low-coverage file details.

---

## How to run

```bash
npx jest --coverage --testPathIgnorePatterns=integration
```

Open `coverage/lcov-report/index.html` for per-file uncovered lines.

---

## Results

**After Phase 1 (P0):**
- **handlers/perception:** 0% → **98.4% statements**, 62.5% branch, 100% functions.
- **New test files:** `perception/connector-poll-handler.test.ts` (7), `signal-detection-handler.test.ts` (7), `lifecycle-inference-handler.test.ts` (5).

**After Phase 2 (P1):**
- **handlers/phase2:** 0% → **91.45% statements**, 64.28% branch, 100% functions (graph-materializer 100%, synthesis-engine 86.48%).
- **New test files:** `phase2/graph-materializer-handler.test.ts` (6), `phase2/synthesis-engine-handler.test.ts` (6).
- **All files:** ~65.2% → **67.15% statements**, 51.76% branch, 71.4% functions, 67.29% lines.

**Phase 3 (Phase 4 handlers):** ✅ Handler-invoking tests added in `handlers/phase4/`; phase4 coverage ~75% statements (compensation, execution-failure-recorder, execution-recorder, tool-mapper all >88%).

**Phase 4 (detectors):** ✅ Six detector test files in `perception/detectors/`; services/perception/detectors 18% → **86.52%** statements.

**All files (after Phase 3+4):** **75.23%** statements, 58.3% branch, 77.43% functions, 75.33% lines. Test Suites: 96 passed.
