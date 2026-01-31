# Phase 2 Coverage Test Plan — World-Model & Synthesis

**Status:** 🟡 In progress  
**Parent:** [PROJECT_TEST_COVERAGE_REVIEW.md](../../../testing/PROJECT_TEST_COVERAGE_REVIEW.md)  
**Scope:** Raise unit coverage for Phase 2 world-model and synthesis services with current gaps.

---

## Current gaps (from PROJECT_TEST_COVERAGE_REVIEW)

### World-model (59.7% overall)

| Component | Stmts | Branch | Uncovered focus |
|-----------|-------|--------|-----------------|
| **EvidenceService** | 53.98 | 21.33 | 136–298, 323–325, 332–333, 337–338, 342–345, 379 |
| **SchemaRegistryService** | 60.49 | 26.66 | 53–60, 84, 102, 112–120, 153–157, 177–258 |
| **SnapshotService** | 46.66 | 28.57 | 182–305 |
| **WorldStateService** | 73.43 | 49.01 | 152, 196–198, 210–229, 244, 251–259, 326–331, 350–351, 359–360, 364–365, 384 |

### Synthesis (73.55% overall)

| Component | Stmts | Branch | Uncovered focus |
|-----------|-------|--------|-----------------|
| **SynthesisEngine** | 64.81 | 40 | 151–154, 264–269, 289–295, 324–332, 367–375, 410–434, 486–536 |
| **ConditionEvaluator** | 72.5 | 52.63 | 141–166, 180, 188–194, 221–222, 240, 264 |
| **RulesetLoader** | 81.08 | 55.76 | 166–167, 176, 259, 263, 267, 282, 286, 291, 297, 301, 307, 314, 325 |
| **AccountPostureStateService** | 87.87 | 100 | 63–64, 150–151 |

### Handler

| Component | Stmts | Branch | Uncovered focus |
|-----------|-------|--------|-----------------|
| **synthesis-engine-handler** | 86.48 | 65.85 | 206, 299–315, 325–341, 356–374 |

---

## Test cases to add (by component)

### 1. EvidenceService

**Test file:** `src/tests/unit/world-model/EvidenceService.test.ts`  
**Focus:** Lines 136–298 (main logic), 323–325, 332–333, 337–338, 342–345, 379. Add tests for: fetch/aggregate paths, error branches, pagination, S3 read paths.

### 2. SchemaRegistryService

**Test file:** `src/tests/unit/world-model/SchemaRegistryService.test.ts`  
**Focus:** Lines 53–60, 84, 102, 112–120, 153–157, 177–258. Add tests for: getSchema variants, validation branches, cache miss paths.

### 3. SnapshotService

**Test file:** `src/tests/unit/world-model/SnapshotService.test.ts`  
**Focus:** Lines 182–305 (large block). Add tests for: getSnapshot, list, write paths, error handling.

### 4. WorldStateService

**Test file:** `src/tests/unit/world-model/WorldStateService.test.ts`  
**Focus:** Lines 152, 196–198, 210–229, 244, 251–259, 326–331, 350–351, 359–360, 364–365, 384. Add tests for: getWorldState branches, merge/update paths.

### 5. SynthesisEngine

**Test file:** `src/tests/unit/synthesis/SynthesisEngine.test.ts`  
**Focus:** Lines 151–154, 264–269, 289–295, 324–332, 367–375, 410–434, 486–536. Add tests for: synthesize branches, rule application, error paths.

### 6. ConditionEvaluator

**Test file:** `src/tests/unit/synthesis/ConditionEvaluator.test.ts`  
**Focus:** Lines 141–166, 180, 188–194, 221–222, 240, 264. Add tests for: condition types, operator branches, edge values.

### 7. RulesetLoader

**Test file:** `src/tests/unit/synthesis/RulesetLoader.test.ts`  
**Focus:** Lines 166–167, 176, 259, 263, 267, 282, 286, 291, 297, 301, 307, 314, 325. Add tests for: load paths, parse error branches, cache.

### 8. AccountPostureStateService

**Test file:** `src/tests/unit/synthesis/AccountPostureStateService.test.ts`  
**Focus:** Lines 63–64, 150–151. Add tests that hit optional/edge branches.

### 9. synthesis-engine-handler

**Test file:** `src/tests/unit/handlers/phase2/synthesis-engine-handler.test.ts`  
**Focus:** Lines 206, 299–315, 325–341, 356–374. Add tests for: status branches (IN_PROGRESS, NOT_FOUND), error paths, response shaping.

---

## Verification

```bash
npm test -- --coverage --testPathIgnorePatterns=integration
```

Target: world-model ≥70% statements; synthesis ≥80% statements; synthesis-engine-handler ≥90% statements.
