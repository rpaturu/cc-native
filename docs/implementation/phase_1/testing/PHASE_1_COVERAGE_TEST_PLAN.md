# Phase 1 Coverage Test Plan — Perception Services

**Status:** 🟡 In progress  
**Parent:** [PROJECT_TEST_COVERAGE_REVIEW.md](../../../testing/PROJECT_TEST_COVERAGE_REVIEW.md)  
**Scope:** Raise unit coverage for Phase 1 perception services with current gaps.

---

## Current gaps (from PROJECT_TEST_COVERAGE_REVIEW)

| Component | Stmts | Branch | Uncovered focus |
|-----------|-------|--------|-----------------|
| **LifecycleStateService** | 81.17 | 70.21 | 95–100, 155–160, 181, 191, 218, 224–226, 246–248, 320–325, 347–352 |
| **SignalService** | 80.46 | 63.21 | 87–91, 107, 197, 229, 251, 288–292, 346–351, 412–413, 459–464, 542, 583, 606–619 |

---

## 1. LifecycleStateService

**Test file:** `src/tests/unit/perception/LifecycleStateService.test.ts`  
**Source:** `src/services/perception/LifecycleStateService.ts`

### Test cases to add

- **Lines 95–100:** Branches in `inferLifecycleState` or similar (e.g. evidence-based inference paths).
- **Lines 155–160:** Alternative path in state inference or recordTransition.
- **Lines 181, 191, 218, 224–226:** Edge branches (null/empty inputs, boundary conditions).
- **Lines 246–248, 320–325, 347–352:** Remaining branches in getAccountState / recordTransition / applySuppression paths.

**Strategy:** Inspect source at listed lines; add tests that supply inputs that hit each branch (e.g. empty snapshots, missing account state, specific lifecycle values).

---

## 2. SignalService

**Test file:** `src/tests/unit/perception/SignalService.test.ts`  
**Source:** `src/services/perception/SignalService.ts`

### Test cases to add

- **Lines 87–91, 107:** Early returns or validation branches.
- **Lines 197, 229, 251:** Branches in createSignal / list / get paths.
- **Lines 288–292, 346–351:** Conditional logic (filters, pagination, error handling).
- **Lines 412–413, 459–464:** Optional fields or error branches.
- **Lines 542, 583, 606–619:** Idempotency, deduplication, or batch paths.

**Strategy:** Use existing test file; add cases that pass inputs triggering uncovered branches (see `coverage/lcov-report/index.html` for exact line context).

---

## Verification

```bash
npm test -- --coverage --testPathIgnorePatterns=integration
```

Open `coverage/lcov-report/index.html` and confirm LifecycleStateService and SignalService statement/branch coverage increase. Target: ≥90% statements for both.
