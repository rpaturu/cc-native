# Phase 5.2 Test Plan — Decision Triggering & Scheduling

**Status:** 🟢 **COMPLETE** (all unit + optional handler + integration tests implemented)  
**Created:** 2026-01-28  
**Parent:** [PHASE_5_2_CODE_LEVEL_PLAN.md](../PHASE_5_2_CODE_LEVEL_PLAN.md)

---

## Executive Summary

This document outlines the testing strategy for Phase 5.2 (Decision Triggering & Scheduling). The plan prioritizes **unit tests for CostGate, RunState, and IdempotencyStore services** and treats **handler and integration tests** as optional or env-gated.

**Testing philosophy:**  
Test CostGate determinism and RunState/IdempotencyStore atomicity in isolation (unit); validate handler flow and EventBridge/Scheduler behavior when dependencies are available (integration).

### Implementation Status

**✅ Unit tests – DecisionCostGateService: COMPLETE**

- **Test file:** `src/tests/unit/decision/DecisionCostGateService.test.ts`
- **Tests:** 7 (ALLOW, SKIP budget/cooldown/saturation/unknown trigger, DEFER with defer_until_epoch, determinism)
- **Status:** All passing ✅

**✅ Unit tests – DecisionIdempotencyStoreService: COMPLETE**

- **Test file:** `src/tests/unit/decision/DecisionIdempotencyStoreService.test.ts`
- **Tests:** 5 (tryReserve true/false on ConditionalCheckFailed, throw on other error, exists true/false)
- **Status:** All passing ✅

**✅ Unit tests – DecisionRunStateService: COMPLETE**

- **Test file:** `src/tests/unit/decision/DecisionRunStateService.test.ts`
- **Tests:** 5 (getState null/item, tryAcquireAdmissionLock acquired / ConditionalCheckFailed / throw)
- **Status:** All passing ✅

**✅ Unit tests – Handlers: COMPLETE**

- **decision-cost-gate-handler:** `src/tests/unit/handlers/phase5/decision-cost-gate-handler.test.ts` — 12 tests (invalid event, duplicate idempotency, CostGate SKIP/DEFER/ALLOW, unknown trigger, error handling).
- **decision-deferred-requeue-handler:** `src/tests/unit/handlers/phase5/decision-deferred-requeue-handler.test.ts` — 6 tests (invalid event, valid CreateSchedule payload, error handling).

**✅ Integration tests: IMPLEMENTED (env-gated)**

- **decision-scheduling:** `src/tests/integration/decision/decision-scheduling.test.ts` — Run when `DECISION_RUN_STATE_TABLE_NAME` and `IDEMPOTENCY_STORE_TABLE_NAME` are set (e.g. after ./deploy writes .env). Tests IdempotencyStore tryReserve/duplicate/exists; RunState getState/tryAcquireAdmissionLock/cooldown.

---

## Testing Strategy Overview

### 1. Unit tests (now)

- **DecisionCostGateService:** Pure policy; ALLOW / DEFER / SKIP with reason and defer_until_epoch / retry_after_seconds; determinism (same input → same output).
- **DecisionRunStateService:** getState; tryAcquireAdmissionLock with conditional update (acquired vs ConditionalCheckFailedException); mocked DynamoDB.
- **DecisionIdempotencyStoreService:** tryReserve (conditional put; true when reserved, false when duplicate); exists; mocked DynamoDB.
- **decision-cost-gate-handler:** Invoke with RUN_DECISION envelope; assert IdempotencyStore duplicate → no Phase 3; CostGate SKIP/DEFER/ALLOW behavior; error handling (500 safe body). Use `(event, context, callback)` or wrapper; mock services and EventBridge.
- **decision-deferred-requeue-handler:** Invoke with RUN_DECISION_DEFERRED; assert CreateSchedule called with correct defer_until_epoch and payload; mock Scheduler.

### 2. Integration tests (optional)

- Publish RUN_DECISION to EventBridge; CostGate handler runs; when CostGate returns SKIP or DEFER, Phase 3 (DECISION_EVALUATION_REQUESTED) is not published; when DEFER, RUN_DECISION_DEFERRED is published and requeue Lambda creates one-time schedule. Requires deployed stack or local EventBridge + DynamoDB + Scheduler.

### 3. Out of scope for 5.2

- End-to-end Phase 3 invocation from RUN_DECISION (covered by Phase 3 tests).
- Load or chaos tests.
- EventBridge Scheduler producer (who emits RUN_DECISION on cadence) — separate scheduler/config.

---

## Unit Tests — Detailed Plan

### 1. DecisionCostGateService (✅ DONE)

**File:** `src/tests/unit/decision/DecisionCostGateService.test.ts`

| Scenario | Result | Notes |
|----------|--------|--------|
| No cooldown, budget remaining | ALLOW | evaluated_at set |
| budget_remaining === 0 | SKIP | reason: BUDGET_EXHAUSTED |
| recency within cooldown | DEFER | reason: COOLDOWN, defer_until_epoch, retry_after_seconds |
| recency beyond cooldown | ALLOW | |
| action_saturation_score >= 1 | SKIP | reason: MARGINAL_VALUE_LOW |
| getRegistryEntry returns null | SKIP | reason: UNKNOWN_TRIGGER_TYPE |
| Same input twice | Same output | Determinism |

**Coverage:** All result paths and required reason/explanation for SKIP and DEFER.

---

### 2. DecisionIdempotencyStoreService (✅ DONE)

**File:** `src/tests/unit/decision/DecisionIdempotencyStoreService.test.ts`

**Mock:** DynamoDBDocumentClient (PutCommand, GetCommand) via `__mocks__/aws-sdk-clients`.

| Method | Test cases |
|--------|------------|
| **tryReserve(idempotencyKey)** | (1) Put succeeds → returns true. (2) ConditionalCheckFailedException → returns false (duplicate). (3) Other error → throws. |
| **exists(idempotencyKey)** | (1) Item present → true. (2) Item absent → false. |

**Fixtures:** pk = IDEMPOTENCY#<key>, sk = METADATA, ttl.

---

### 3. DecisionRunStateService (✅ DONE)

**File:** `src/tests/unit/decision/DecisionRunStateService.test.ts`

**Mock:** DynamoDBDocumentClient (GetCommand, UpdateCommand) via `__mocks__/aws-sdk-clients`.

| Method | Test cases |
|--------|------------|
| **getState(tenantId, accountId)** | (1) No item → null. (2) Item present → DecisionRunStateV1. |
| **tryAcquireAdmissionLock(tenantId, accountId, triggerType, registryEntry)** | (1) Update succeeds → acquired: true. (2) ConditionalCheckFailedException → acquired: false, reason: COOLDOWN. (3) Other error → throws. |

**Fixtures:** pk = TENANT#id#ACCOUNT#id, sk = RUN_STATE#GLOBAL, last_allowed_at_epoch, run_count_this_hour.

---

### 4. decision-cost-gate-handler (✅ DONE)

**File:** `src/tests/unit/handlers/phase5/decision-cost-gate-handler.test.ts`

**Mock:** DecisionIdempotencyStoreService, DecisionRunStateService, DecisionCostGateService, EventBridge PutEventsCommand (or EventPublisher). Invoke handler with `(event, context, callback)` or wrapper that returns the result.

| Scenario | Assertion |
|----------|-----------|
| Invalid event (missing detail fields) | Handler returns without throwing; no Phase 3 publish. |
| tryReserve returns false (duplicate) | No DECISION_EVALUATION_REQUESTED; no RUN_DECISION_DEFERRED; log DUPLICATE_IDEMPOTENCY_KEY. |
| tryAcquireAdmissionLock returns !acquired after CostGate ALLOW | RUN_DECISION_DEFERRED published with defer_until_epoch. |
| CostGate returns ALLOW, lock acquired | DECISION_EVALUATION_REQUESTED published with tenant_id, account_id, trigger_type. |
| CostGate returns DEFER | RUN_DECISION_DEFERRED published with defer_until_epoch, retry_after_seconds, original_idempotency_key. |
| CostGate returns SKIP | No DECISION_EVALUATION_REQUESTED; no RUN_DECISION_DEFERRED. |
| Handler throws (e.g. DDB error) | Error propagated; 500 safe body if API contract (or rethrow for Lambda). |

---

### 5. decision-deferred-requeue-handler (✅ DONE)

**File:** `src/tests/unit/handlers/phase5/decision-deferred-requeue-handler.test.ts` (to create)

**Mock:** SchedulerClient CreateScheduleCommand. Invoke handler with RUN_DECISION_DEFERRED envelope.

| Scenario | Assertion |
|----------|-----------|
| Invalid event (missing detail fields) | Handler returns without throwing; no CreateSchedule. |
| Valid RUN_DECISION_DEFERRED | CreateSchedule called with ScheduleExpression at(defer_until_epoch), Target.Arn = cost-gate Lambda, Target.Input = RUN_DECISION payload with new idempotency_key (hash of original + retry). |
| CreateSchedule fails | Error propagated. |

---

## Integration Tests (Optional)

**Condition:** Run only when `RUN_PHASE5_2_INTEGRATION_TESTS=true`. Requires deployed stack or local EventBridge, DynamoDB (DecisionRunState, IdempotencyStore), and EventBridge Scheduler.

**File:** `src/tests/integration/decision/decision-scheduling.test.ts`

| Scenario | Description |
|----------|-------------|
| RUN_DECISION → CostGate SKIP | Publish RUN_DECISION; CostGate returns SKIP (e.g. budget 0); DECISION_EVALUATION_REQUESTED not published. |
| RUN_DECISION → CostGate DEFER | Publish RUN_DECISION; CostGate returns DEFER; RUN_DECISION_DEFERRED published; requeue Lambda creates one-time schedule (or verify schedule exists). |
| RUN_DECISION duplicate idempotency_key | Publish same RUN_DECISION twice (same idempotency_key); second run does not invoke Phase 3 (IdempotencyStore duplicate). |
| RUN_DECISION → ALLOW → Phase 3 requested | Publish RUN_DECISION with valid payload; CostGate ALLOW, lock acquired; DECISION_EVALUATION_REQUESTED published (optional: verify Phase 3 evaluation triggered). |

---

## Test Structure and Organization

### Directory structure

```
src/tests/
├── unit/
│   ├── decision/
│   │   ├── DecisionCostGateService.test.ts        ✅
│   │   ├── DecisionIdempotencyStoreService.test.ts ✅
│   │   └── DecisionRunStateService.test.ts        ✅
│   └── handlers/
│       └── phase5/
│           ├── decision-cost-gate-handler.test.ts  ✅
│           └── decision-deferred-requeue-handler.test.ts ✅
├── integration/
│   └── decision/
│       └── decision-scheduling.test.ts            ✅ (env-gated)
└── __mocks__/
    └── aws-sdk-clients.ts                           (shared mock)
```

---

## Running Tests

### Unit tests only (exclude integration)

```bash
npm test -- --testPathIgnorePatterns=integration
```

### Phase 5.2 decision unit tests only

```bash
npm test -- --testPathPattern=decision/DecisionCostGateService|decision/DecisionIdempotencyStoreService|decision/DecisionRunStateService
```

Or all decision folder:

```bash
npm test -- --testPathPattern="unit/decision"
```

### With coverage

```bash
npm test -- --coverage --testPathIgnorePatterns=integration
```

### Integration tests (when implemented and env set)

```bash
RUN_PHASE5_2_INTEGRATION_TESTS=true npm test -- --testPathPattern=integration/decision
```

---

## Success Criteria

### Phase 5.2 unit tests complete when

1. ✅ DecisionCostGateService: all result paths (ALLOW, DEFER, SKIP) and reason/explanation covered (7 tests).
2. ✅ DecisionIdempotencyStoreService: tryReserve and exists with mocked DynamoDB (5 tests).
3. ✅ DecisionRunStateService: getState and tryAcquireAdmissionLock (conditional update, acquired/failed/throw) with mocked DynamoDB (5 tests).
4. ✅ decision-cost-gate-handler: event parsing, duplicate skip, CostGate ALLOW/DEFER/SKIP flow, error handling (12 tests).
5. ✅ decision-deferred-requeue-handler: event parsing, CreateSchedule with correct payload and new idempotency key (6 tests).
6. All new tests run in existing CI (`npm test -- --testPathIgnorePatterns=integration`).

### Phase 5.2 integration tests (optional) complete when

1. ✅ IdempotencyStore tryReserve/duplicate/exists against real DDB (env-gated).
2. ✅ RunState getState/tryAcquireAdmissionLock/cooldown against real DDB (env-gated).
3. Run with `RUN_PHASE5_2_INTEGRATION_TESTS=true` and table env vars set.

---

## References

- [PHASE_5_2_CODE_LEVEL_PLAN.md](../PHASE_5_2_CODE_LEVEL_PLAN.md) — implementation plan (frozen)
- [PHASE_5_IMPLEMENTATION_PLAN.md](../PHASE_5_IMPLEMENTATION_PLAN.md) — EPIC 5.2
- [PHASE_5_1_TEST_PLAN.md](PHASE_5_1_TEST_PLAN.md) — structure and handler test pattern
