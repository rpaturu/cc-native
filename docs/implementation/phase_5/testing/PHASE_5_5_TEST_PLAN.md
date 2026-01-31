# Phase 5.5 Test Plan — Learning & Evaluation

**Status:** 🟢 **COMPLETE** (unit tests for normalization, registry, calibration, shadow gate; coverage gaps closed)  
**Created:** 2026-01-28  
**Last Updated:** 2026-01-28  
**Parent:** [PHASE_5_5_CODE_LEVEL_PLAN.md](../PHASE_5_5_CODE_LEVEL_PLAN.md)

---

## Executive Summary

This document outlines the testing strategy for Phase 5.5 (Learning & Evaluation). The plan covers **unit tests for OutcomeNormalizationService, RankingWeightsRegistryService, RankingCalibrationService, ShadowModeService, and LearningTypes**, with a target of **~100% coverage** for Phase 5.5 code (types/learning, services/learning).

**Testing philosophy:**  
Test outcome taxonomy mapping and normalization in isolation (unit); test registry get/set/promote/rollback with mocked DynamoDB and optional ledger; test calibration weight computation and CANDIDATE registration; test Shadow Mode gate (sample size, threshold, metric). No integration tests for Phase 5.5 in this plan (normalization pipeline and calibration jobs can be env-gated later).

### Implementation Status

**✅ Unit tests – OutcomeNormalizationService: COMPLETE**

- **Test file:** `src/tests/unit/learning/OutcomeNormalizationService.test.ts`
- **Tests:** 8 (normalizeFromExecutionOutcome: SUCCEEDED no edits → EXECUTION_SUCCEEDED; SUCCEEDED with edited_fields → IDEA_EDITED; SUCCEEDED with empty edited_fields → EXECUTION_SUCCEEDED; FAILED → EXECUTION_FAILED; CANCELLED/RETRYING → EXECUTION_FAILED; confidence_score and metadata. normalizeFromRejection: IDEA_REJECTED, no action_intent_id)
- **Status:** All passing ✅

**✅ Unit tests – RankingWeightsRegistryService: COMPLETE**

- **Test file:** `src/tests/unit/learning/RankingWeightsRegistryService.test.ts`
- **Tests:** 16 (getRegistry null/item; resolveActiveVersion tenant/GLOBAL fallback/both null; getWeights stores+retrieves/null; putWeights; setCandidate no existing (PutCommand)/existing (UpdateCommand); promoteCandidateToActive with ledger/without ledger; promote throws no candidate/null registry; rollback with ledger/without ledger; rollback throws no registry)
- **Status:** All passing ✅

**✅ Unit tests – RankingCalibrationService: COMPLETE**

- **Test file:** `src/tests/unit/learning/RankingCalibrationService.test.ts`
- **Tests:** 3 (runCalibration computes weights and setCandidate; empty outcomes; baseline_version_compared_to and evaluation_summary in result)
- **Status:** All passing ✅

**✅ Unit tests – ShadowModeService: COMPLETE**

- **Test file:** `src/tests/unit/learning/ShadowModeService.test.ts`
- **Tests:** 6 (fails when sample size below minimum; passes when metric_value >= threshold and sample sufficient; fails when metric_value < threshold; empty scores; passes when metric_value equals threshold (boundary); reason string contains metric_name)
- **Status:** All passing ✅

**⏸ Integration tests: OPTIONAL (not implemented)**

- **Normalization pipeline:** Consume ActionOutcome/approval events, call OutcomeNormalizationService, persist NormalizedOutcomeV1; optional NORMALIZATION_MISSING ledger. Can be added when learning table/stream exists.
- **Calibration job:** Read normalized outcomes, run RankingCalibrationService, then ShadowModeService.evaluateGate; on pass, registry.promoteCandidateToActive. Env-gated.

---

## Test Coverage (reified)

Concrete file paths, test counts, and test names. Run `npm test -- --testPathPattern=learning` for Phase 5.5 unit tests.

### Unit tests — 32 tests across 4 files

| File | Tests | Test names |
|------|-------|------------|
| `src/tests/unit/learning/OutcomeNormalizationService.test.ts` | 8 | SUCCEEDED no edits → EXECUTION_SUCCEEDED; SUCCEEDED with edited_fields → IDEA_EDITED; SUCCEEDED empty edited_fields → EXECUTION_SUCCEEDED; FAILED → EXECUTION_FAILED; CANCELLED/RETRYING → EXECUTION_FAILED; confidence_score and metadata; normalizeFromRejection IDEA_REJECTED |
| `src/tests/unit/learning/RankingWeightsRegistryService.test.ts` | 16 | getRegistry null/item; resolveActiveVersion tenant/GLOBAL fallback/both null; getWeights stores+retrieves/null; putWeights; setCandidate no existing/existing; promote with/without ledger; promote throws no candidate/null registry; rollback with/without ledger; rollback throws no registry |
| `src/tests/unit/learning/RankingCalibrationService.test.ts` | 3 | runCalibration computes weights and setCandidate; empty outcomes; baseline_version_compared_to and evaluation_summary in result |
| `src/tests/unit/learning/ShadowModeService.test.ts` | 6 | sample below minimum; pass when metric >= threshold; fail when metric < threshold; empty scores; boundary (metric at or above threshold); reason contains metric_name |

### Coverage summary (Phase 5.5)

| Layer | Statements | Branches | Functions | Lines |
|-------|------------|----------|-----------|-------|
| types/learning + services/learning | 100% (98/98) | 95.83% (23/24) | 100% (18/18) | 100% (93/93) |

One branch uncovered: optional `baselineMetricValue` in `ShadowModeService.evaluateGate` (accepted but not used in implementation).

### Gaps closed (additional test cases)

- **OutcomeNormalizationService:** CANCELLED and RETRYING → EXECUTION_FAILED; edited_fields empty array → EXECUTION_SUCCEEDED.
- **RankingWeightsRegistryService:** setCandidate when no existing registry (PutCommand) and when existing (UpdateCommand); resolveActiveVersion when both tenant and GLOBAL null; promoteCandidateToActive when registry null (throws); promote/rollback without ledgerService (no append); rollback when no registry (throws); getWeights when item not found (null).
- **RankingCalibrationService:** Input with baseline_version_compared_to and evaluation_summary → present in result.
- **ShadowModeService:** Boundary: metric_value exactly equals threshold (passed); reason string contains metric_name.

### Gaps / future tests (optional)

- **LearningTypes:** Type-only; no runtime branches. Coverage via usage in services.
- **Normalization pipeline handler:** When implemented, unit test handler with mocked OutcomeNormalizationService and store.
- **Calibration job handler:** When implemented, unit test with mocked registry, calibration service, shadow service.
- **Integration:** Normalization from real ActionOutcome/ledger; calibration job with real DDB registry (env-gated).

---

## Testing Strategy Overview

### 1. Unit tests (implemented)

- **OutcomeNormalizationService:** Pure logic; no I/O. normalizeFromExecutionOutcome (taxonomy from status + edited_fields); normalizeFromRejection (IDEA_REJECTED). All OutcomeTaxonomyV1 branches: EXECUTION_SUCCEEDED, EXECUTION_FAILED, IDEA_EDITED, IDEA_REJECTED; status SUCCEEDED, FAILED, RETRYING, CANCELLED.
- **RankingWeightsRegistryService:** Mocked DynamoDBDocumentClient; optional LedgerService. getRegistry, resolveActiveVersion (tenant → GLOBAL → null), getWeights, putWeights, setCandidate (create vs update), promoteCandidateToActive (with/without ledger; throws when no candidate or null registry), rollback (with/without ledger; throws when no registry).
- **RankingCalibrationService:** Mocked IRankingWeightsRegistry. runCalibration builds weights from outcomes (by taxonomy, action_type), putWeights, setCandidate; optional baseline_version_compared_to, evaluation_summary.
- **ShadowModeService:** evaluateGate(scores, params). Branches: sample_size < minimum → fail; metric_value >= threshold → pass; metric_value < threshold → fail; empty scores; boundary (metric === threshold).

### 2. Phase 3/4 integration (covered by existing tests)

- **Phase 4** ActionOutcome and ledger events feed normalization (contract; handler not in 5.5 scope).
- **Phase 3** approval/rejection events feed IDEA_REJECTED / IDEA_EDITED (contract).
- **Production ranking** reads only ACTIVE from registry (RankingWeightsRegistryService.resolveActiveVersion + getWeights).

### 3. Out of scope for 5.5 test plan

- End-to-end learning pipeline (normalization → store → calibration job → shadow gate → promote).
- Control Center APIs (Phase 5.6).
- Load or chaos tests.

---

## Execution

- **Unit tests (default):** `npm test` — excludes integration; Phase 5.5 unit tests run with the rest of the suite.
- **Phase 5.5 unit tests only:** `npm test -- --testPathPattern=learning`
- **Coverage for Phase 5.5:** `npx jest --coverage --testPathIgnorePatterns=integration --collectCoverageFrom='src/types/learning/**/*.ts' --collectCoverageFrom='src/services/learning/**/*.ts' --testPathPattern=learning` — emits coverage for learning types and services.

---

## References

- **Code-level plan:** [PHASE_5_5_CODE_LEVEL_PLAN.md](../PHASE_5_5_CODE_LEVEL_PLAN.md)
- **Coverage plan:** [COVERAGE_TEST_PLAN.md](../../../testing/COVERAGE_TEST_PLAN.md)
- **Implementation plan:** [PHASE_5_IMPLEMENTATION_PLAN.md](../PHASE_5_IMPLEMENTATION_PLAN.md) EPIC 5.5
