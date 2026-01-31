# Phase 5.7 Test Plan — Reliability Hardening

**Status:** 🟢 **COMPLETE** (unit tests for circuit breaker, concurrency, SLO metrics, resilience wrapper, replay route; target 100% coverage)  
**Created:** 2026-01-28  
**Last Updated:** 2026-01-28  
**Parent:** [PHASE_5_7_CODE_LEVEL_PLAN.md](../PHASE_5_7_CODE_LEVEL_PLAN.md)

---

## Executive Summary

This document outlines the testing strategy for Phase 5.7 (Reliability Hardening: circuit breakers, per-tool SLOs, resilience wrapper, replay tooling, runbook). The plan covers **unit tests for CircuitBreakerService, ConnectorConcurrencyService, ToolSloMetricsService, InvokeWithResilience, postReplayExecution (replay route), and autonomy-control-center-routes (replay)**. Target: **100% coverage** for Phase 5.7 code (types/phase5 CircuitBreakerTypes, services/connector, replay path in autonomy-control-center-routes).

**Testing philosophy:**  
Test circuit breaker state machine (allowRequest, recordSuccess, recordFailure, getState) with mocked DynamoDB; test concurrency tryAcquire/release with mocked DDB; test SLO metrics emit with mocked CloudWatch; test invokeWithResilience success, DEFER, and FAIL_FAST paths with mocked services; test postReplayExecution validation, 404, and 202 with ledger + PutEvents. No integration tests required for this plan (optional: tenant isolation harness, circuit breaker E2E).

### Implementation Status

**✅ Unit tests – CircuitBreakerService: COMPLETE**

- **Test file:** `src/tests/unit/services/connector/CircuitBreakerService.test.ts`
- **Tests:** allowRequest (no state; CLOSED; OPEN before cooldown); recordSuccess (HALF_OPEN → CLOSED); recordFailure (no state, threshold 1 → OPEN); getState (null; item exists).
- **Status:** All passing ✅

**✅ Unit tests – ConnectorConcurrencyService: COMPLETE**

- **Test file:** `src/tests/unit/services/connector/ConnectorConcurrencyService.test.ts`
- **Tests:** tryAcquire (acquired; not acquired at limit / ConditionalCheckFailed; rethrow other error); release (normal; double-release best-effort no throw; rethrow other error).
- **Status:** All passing ✅

**✅ Unit tests – ToolSloMetricsService: COMPLETE**

- **Test file:** `src/tests/unit/services/connector/ToolSloMetricsService.test.ts`
- **Tests:** emit (success with tool_latency_ms and tool_success; error with tool_error and tenant_id dimension; CloudWatch failure logs warn and does not throw).
- **Status:** All passing ✅

**✅ Unit tests – InvokeWithResilience: COMPLETE**

- **Test file:** `src/tests/unit/services/connector/InvokeWithResilience.test.ts`
- **Tests:** connectorIdFromToolName (internal, crm, calendar, unknown); invokeWithResilience success; DEFER when circuit not allowed (phase5_perception); CircuitBreakerOpenError when OPEN (phase4_execution); DEFER when concurrency not acquired; recordFailure + emit error + release + rethrow when fn throws.
- **Status:** All passing ✅

**✅ Unit tests – postReplayExecution (replay route): COMPLETE**

- **Test file:** `src/tests/unit/handlers/phase5/replay-route.test.ts`
- **Tests:** 400 when body missing required fields; 404 when intent not found; 202 and REPLAY_REQUESTED + putReplayEvent when intent exists.
- **Status:** All passing ✅

**✅ Unit tests – autonomy-control-center-routes (replay): COMPLETE**

- **Test file:** `src/tests/unit/handlers/phase5/autonomy-control-center-routes.test.ts` (includes postReplayExecution)
- **Status:** All passing ✅

---

## Test Coverage (reified)

Concrete file paths and coverage targets. Run tests with `--testPathPattern` for Phase 5.7 unit tests.

### Phase 5.7 scope (collectCoverageFrom)

| Layer | Path | Target |
|-------|------|--------|
| Types | `src/types/phase5/CircuitBreakerTypes.ts` | 100% |
| Services | `src/services/connector/CircuitBreakerService.ts` | 100% |
| Services | `src/services/connector/ConnectorConcurrencyService.ts` | 100% |
| Services | `src/services/connector/ToolSloMetricsService.ts` | 100% |
| Services | `src/services/connector/InvokeWithResilience.ts` | 100% |
| Routes | `src/handlers/phase5/autonomy-control-center-routes.ts` (postReplayExecution) | 100% |

### Coverage summary (achieved)

| Layer | Statements | Branches | Functions | Lines |
|-------|------------|----------|-----------|-------|
| Phase 5.7 types + services/connector + replay route | **98.45%** | **84.14%** | **100%** | **98.4%** |

- **autonomy-control-center-routes.ts:** 100% all.
- **CircuitBreakerTypes.ts:** 100% all.
- **CircuitBreakerService.ts:** 96% stmts, 79% branch, 100% funcs, 96% lines (uncovered: logger line, one branch).
- **ConnectorConcurrencyService.ts:** 100% stmts, 91% branch, 100% funcs, 100% lines.
- **InvokeWithResilience.ts:** 100% stmts, 71% branch, 100% funcs, 100% lines (uncovered: optional retryAfterSeconds fallback, connectorIdFromToolName fallback).
- **ToolSloMetricsService.ts:** 100% stmts, 90% branch, 100% funcs, 100% lines (uncovered: catch branch when error is not Error instance).

All **49** Phase 5.7 unit tests pass.

### Unit tests — test counts (aligned with 5.x)

| File | Tests | Focus |
|------|-------|--------|
| `CircuitBreakerService.test.ts` | 10 | allowRequest, recordSuccess, recordFailure, getState |
| `ConnectorConcurrencyService.test.ts` | 6 | tryAcquire, release |
| `ToolSloMetricsService.test.ts` | 5 | emit success, error, CloudWatch failure |
| `InvokeWithResilience.test.ts` | 11 | connectorIdFromToolName, success, DEFER, FAIL_FAST, throw path |
| `replay-route.test.ts` | 8 | postReplayExecution 400/404/202 |
| `autonomy-control-center-routes.test.ts` | 9 | includes postReplayExecution |
| **Total (5.7 unit)** | **49** | |

### Coverage confirmation (run and confirm in chat)

- **Command:**  
  `npx jest --coverage --testPathIgnorePatterns=integration --collectCoverageFrom='src/types/phase5/CircuitBreakerTypes.ts' --collectCoverageFrom='src/services/connector/*.ts' --collectCoverageFrom='src/handlers/phase5/autonomy-control-center-routes.ts' --testPathPattern="(CircuitBreakerService|ConnectorConcurrency|ToolSloMetrics|InvokeWithResilience|replay-route|autonomy-control-center-routes)"`
- **Expected:** 6 suites, 49 tests pass; Phase 5.7 scope coverage **98.45%** statements, **84.14%** branches, **100%** functions, **98.4%** lines. Uncovered: CircuitBreakerService lines 87, 101, 256 (logger/branch); ConnectorConcurrencyService branch 32; InvokeWithResilience lines 48–55, 63, 103 (fallbacks); ToolSloMetricsService line 76 (non-Error catch). Target 100% for all; current gaps are defensive/edge paths.

---

## Testing Strategy Overview

### 1. Unit tests (implemented)

- **CircuitBreakerService:** Mock DynamoDBDocumentClient. allowRequest: no state → allowed; CLOSED → allowed; OPEN before cooldown → not allowed + retryAfterSeconds; OPEN past cooldown → tryTransitionOpenToHalfOpen (conditional write). recordSuccess: HALF_OPEN → Put CLOSED; CLOSED → Update failure_count zero. recordFailure: no state → Put CLOSED count 1, then openCircuit if threshold; HALF_OPEN → openCircuit; CLOSED → increment or open. getState: GetCommand; null vs item.
- **ConnectorConcurrencyService:** Mock DynamoDB. tryAcquire: UpdateCommand with condition in_flight_count < max → acquired; ConditionalCheckFailed → not acquired. release: UpdateCommand decrement; ConditionalCheckFailed → no throw (best-effort).
- **ToolSloMetricsService:** Mock CloudWatchClient. emit: success (tool_success + tool_latency_ms); error (tool_error + tenant_id); PutMetricData throw → warn log.
- **InvokeWithResilience:** Mock circuitBreaker, concurrency, metrics. Success path (allow + acquire + fn + recordSuccess + emit + release). DEFER when allow.allowed false (phase5). Throw CircuitBreakerOpenError when allow.allowed false (phase4). DEFER when tryAcquire not acquired. When fn throws: recordFailure, emit error, release, rethrow. connectorIdFromToolName: internal.*, crm.*, calendar.*, unknown.
- **postReplayExecution:** Mock ActionIntentService (getIntent), LedgerService (append), putReplayEvent. 400 missing fields; 404 intent null; 202 intent exists → append REPLAY_REQUESTED, putReplayEvent(detail).

### 2. Integration tests (optional)

- Circuit breaker E2E: trigger N failures, assert OPEN, wait cooldown, assert one probe.
- Replay E2E: POST /autonomy/replay → EventBridge → state machine → REPLAY_STARTED/COMPLETED.
- Tenant isolation harness: run one execution for Tenant A, verify DDB/ledger scope (script placeholder in scripts/phase_5/verify-tenant-isolation.sh).

### 3. Out of scope for 5.7 test plan

- CDK (resilience table, replay rule) — covered by stack tests if any.
- Tool-invoker-handler resilience path (covered by existing tool-invoker-handler tests when RESILIENCE_TABLE_NAME set; optional explicit test).
- Execution starter/recorder replay branches — covered by existing execution-starter-handler and execution-recorder-handler unit tests (replay_reason/requested_by/is_replay).

---

## Execution

- **Phase 5.7 unit tests only:**  
  `npm test -- --testPathPattern="(CircuitBreakerService|ConnectorConcurrency|ToolSloMetrics|InvokeWithResilience|replay-route|autonomy-control-center-routes)" --testPathIgnorePatterns=integration`

- **Coverage for Phase 5.7:**  
  `npx jest --coverage --testPathIgnorePatterns=integration --collectCoverageFrom='src/types/phase5/CircuitBreakerTypes.ts' --collectCoverageFrom='src/services/connector/*.ts' --collectCoverageFrom='src/handlers/phase5/autonomy-control-center-routes.ts' --testPathPattern="(CircuitBreakerService|ConnectorConcurrency|ToolSloMetrics|InvokeWithResilience|replay-route|autonomy-control-center-routes)"`

---

## References

- **Code-level plan:** [PHASE_5_7_CODE_LEVEL_PLAN.md](../PHASE_5_7_CODE_LEVEL_PLAN.md)
- **Coverage plan:** [PROJECT_TEST_COVERAGE_REVIEW.md](../../../testing/PROJECT_TEST_COVERAGE_REVIEW.md)
- **Phase 5.6 test plan:** [PHASE_5_6_TEST_PLAN.md](./PHASE_5_6_TEST_PLAN.md)
