# Lower Coverage Improvement Plan — Phase 5 Testing

**Status:** 🟢 Complete (tool-invoker validation, SignalService, auto-approval-gate)  
**Created:** 2026-01-30  
**Parent:** [PROJECT_TEST_COVERAGE_REVIEW.md](../../../testing/PROJECT_TEST_COVERAGE_REVIEW.md)

---

## Executive Summary

This plan targets **lower-coverage files** identified after Phase 1–4 coverage work. The goal is to add unit test cases (no new test files where sufficient structure exists) to raise statement and branch coverage for:

1. **tool-invoker-handler** (~34% stmts) — handler validation, success:false return path, parse/retry branches
2. **SignalService** (~43% stmts) — createExecutionSignal, getSignalsForAccount, updateSignalStatus happy path, checkTTLExpiry, replaySignalFromEvidence
3. **auto-approval-gate-handler** (~51% stmts) — CONFIG_MISSING, policy reject, already_published, RESERVED retry, BUDGET_EXCEEDED, ConditionalCheckFailed retry, happy path
4. **SnapshotService / EvidenceService** (optional) — if time permits

**Testing philosophy:** Extend existing test files with handler-invoking and service method cases; mock AWS and external deps. No integration tests in this plan.

---

## Scope and Priority

| Item | Source | Test file (extend or add) | Priority |
|------|--------|----------------------------|----------|
| tool-invoker-handler | `handlers/phase4/tool-invoker-handler.ts` | `tests/unit/execution/tool-invoker-handler.test.ts` | P0 |
| SignalService | `services/perception/SignalService.ts` | `tests/unit/perception/SignalService.test.ts` | P0 |
| auto-approval-gate-handler | `handlers/phase5/auto-approval-gate-handler.ts` | `tests/unit/handlers/phase5/auto-approval-gate-handler.test.ts` | P0 |
| SnapshotService | `services/world-model/SnapshotService.ts` | Add or extend in `tests/unit/world-model/` | P1 (optional) |
| EvidenceService | `services/world-model/EvidenceService.ts` | Add or extend in `tests/unit/world-model/` | P1 (optional) |

---

## Implementation Checklist

### 1. tool-invoker-handler (P0) ✅

- **Test file:** `src/tests/unit/execution/tool-invoker-handler.test.ts`
- **Strategy:** Existing tests cover schema validation and error classification in isolation; add handler-invoking cases that hit handler branches.
- **Cases:**
  - [x] Invalid Step Functions input (e.g. missing `gateway_url`) → handler throws Error with name `ValidationError`.
  - [ ] Valid input + gateway returns `success: false` (deferred: axios mock not applied to handler’s import in this setup; classifyError covered by unit tests).
  - [x] (Existing: JWT not thrown when env set; secret path used when COGNITO_SERVICE_USER_SECRET_ARN set.)

### 2. SignalService (P0) ✅

- **Test file:** `src/tests/unit/perception/SignalService.test.ts`
- **Strategy:** Mock DynamoDBDocumentClient.send; add cases for createExecutionSignal, getSignalsForAccount, updateSignalStatus (happy path + AccountState update), checkTTLExpiry, replaySignalFromEvidence; createSignal with missing config throws.
- **Cases:**
  - [x] createSignal when `accountsTableName` (or lifecycle/event/ledger) missing → throws with message "not configured for full lifecycle".
  - [x] createExecutionSignal: happy path (PutCommand) → returns signal.
  - [x] createExecutionSignal: ConditionalCheckFailedException → Get returns existing Item → returns existing signal (idempotent).
  - [x] getSignalsForAccount: returns Items; with filters.signalTypes → QueryCommand called.
  - [x] updateSignalStatus: ACTIVE → SUPPRESSED (Get → Update → removeSignalFromAccountState when applicable).
  - [x] checkTTLExpiry: signal not found → null; signal SUPPRESSED → return sig; signal expired (expiresAt in past) → updateSignalStatus called; not expired → return sig.
  - [x] replaySignalFromEvidence: missing lifecycleStateService or ledgerService → throws; signal not found → throws; detector returns matching signal → matches: true; detector returns no matching type → matches: false.

### 3. auto-approval-gate-handler (P0) ✅

- **Test file:** `src/tests/unit/handlers/phase5/auto-approval-gate-handler.test.ts`
- **Strategy:** Mock ActionIntentService, AutoExecuteAllowListService, AutonomyModeService, AutoApprovalPolicyEngine, AutoExecStateService, AutonomyBudgetService, EventBridge; set/unset env for CONFIG_MISSING.
- **Cases:**
  - [x] CONFIG_MISSING: unset AUTONOMY_CONFIG_TABLE_NAME, resetModules, require handler → returns REQUIRE_APPROVAL, reason CONFIG_MISSING.
  - [x] Policy reject: getIntent returns intent, allowlisted true, evaluateAutoApprovalPolicy returns decision !== 'AUTO_EXECUTE' → REQUIRE_APPROVAL with policy reason.
  - [x] Already published: getState returns { status: 'PUBLISHED' } → returns AUTO_EXECUTED, already_published: true.
  - [x] RESERVED retry: getState returns { status: 'RESERVED' } → PutEvents + setPublished → returns AUTO_EXECUTED.
  - [x] BUDGET_EXCEEDED: allowlisted, policy AUTO_EXECUTE, state null, checkAndConsume returns false → REQUIRE_APPROVAL, reason BUDGET_EXCEEDED.
  - [x] ConditionalCheckFailed on setReserved: setReserved throws ConditionalCheckFailedException, getState returns RESERVED → retry PutEvents + setPublished → AUTO_EXECUTED.
  - [x] Happy path: allowlisted, policy AUTO_EXECUTE, state null, checkAndConsume true, setReserved, PutEvents, setPublished → AUTO_EXECUTED.

### 4. SnapshotService / EvidenceService (P1, optional)

- Deferred unless time permits; see PROJECT_TEST_COVERAGE_REVIEW.md for uncovered line ranges.

---

## How to run

```bash
npx jest --coverage --testPathIgnorePatterns=integration
```

Per-file coverage: `coverage/lcov-report/index.html`.

---

## Results

| Item | Before (stmts) | After (stmts) |
|------|----------------|---------------|
| tool-invoker-handler | ~34% | Validation path covered; success:false deferred |
| SignalService | ~43% | 17 tests (createSignal config throw, createExecutionSignal, getSignalsForAccount, updateSignalStatus happy, checkTTLExpiry, replaySignalFromEvidence) |
| auto-approval-gate-handler | ~51% | 11 tests (CONFIG_MISSING, policy reject, already_published, RESERVED retry, BUDGET_EXCEEDED, ConditionalCheckFailed retry, happy path) |

Run `npx jest --coverage --testPathIgnorePatterns=integration` and open `coverage/lcov-report/index.html` for current per-file numbers.
