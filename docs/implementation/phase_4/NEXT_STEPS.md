# Phase 4 Next Steps - Consolidated Roadmap

**Last Updated:** 2026-01-27  
**Current Status:** Phase 4.3 Complete (84% test coverage)  
**Next Milestone:** Phase 4.4 Implementation

---

## Overview

Phase 4.3 (Connectors) is **complete** with:
- ✅ All adapters, handlers, and services implemented
- ✅ Gateway setup and VPC infrastructure deployed
- ✅ Unit tests complete (5 files, 66 tests)
- ✅ Test coverage: 84% (16/19 test files)

**Remaining work:**
- 2 optional handler tests (Phase 4.1) - increases coverage to 95%
- Phase 4.4 implementation (Safety & Outcomes)
- Integration tests (deferred from Phase 4.3)

---

## Immediate Next Steps (Prioritized)

### Option A: Complete Test Coverage First (Recommended)

**Priority:** Medium  
**Duration:** 1-2 days  
**Impact:** Increases test coverage from 84% → 95% (18/19 test files)

#### Tasks:
1. **Create `execution-starter-handler.test.ts`**
   - Handler validation (EventBridge event structure)
   - Event processing (ACTION_APPROVED → ExecutionAttempt creation)
   - Integration with ExecutionAttemptService
   - Error handling (invalid events, missing fields)
   - **Reference:** Similar to `tool-mapper-handler.test.ts` pattern

2. **Create `execution-validator-handler.test.ts`**
   - Handler validation (preflight checks)
   - ActionIntent validation (status, expiration, required fields)
   - Integration with ActionIntentService
   - Error handling (expired intents, invalid states)
   - **Reference:** Similar to `execution-validator-handler.ts` implementation

**Benefits:**
- Higher test coverage before moving to Phase 4.4
- Validates Phase 4.1 foundation handlers
- Low risk, high value

**Files to Review:**
- `src/handlers/phase4/execution-starter-handler.ts`
- `src/handlers/phase4/execution-validator-handler.ts`
- `src/tests/unit/handlers/phase4/tool-mapper-handler.test.ts` (reference pattern)

---

### Option B: Proceed to Phase 4.4 Implementation

**Priority:** High  
**Duration:** 2-3 weeks  
**Impact:** Completes Phase 4 execution layer

#### Phase 4.4: Safety & Outcomes

**1. Signal Emission (Week 1)**
- **File:** `src/handlers/phase4/execution-recorder-handler.ts` (update)
- **Tasks:**
  - Add SignalService integration
  - Emit `ACTION_EXECUTED` signal on success
  - Emit `ACTION_FAILED` signal on failure
  - Include action_intent_id, external_object_refs, error details
- **Dependencies:** SignalService, SignalType enum (ACTION_EXECUTED, ACTION_FAILED)
- **Reference:** `PHASE_4_4_CODE_LEVEL_PLAN.md` Section 1

**2. Execution Status API Handler (Week 1-2)**
- **File:** `src/handlers/phase4/execution-status-api-handler.ts` (new)
- **Tasks:**
  - Create API Gateway endpoint (or Lambda Function URL)
  - Query execution status by `action_intent_id`
  - Return execution state, outcomes, errors
  - Integrate with ExecutionAttemptService, ExecutionOutcomeService
- **Dependencies:** API Gateway or Function URL, execution services
- **Reference:** `PHASE_4_4_CODE_LEVEL_PLAN.md` Section 2

**3. CloudWatch Alarms (Week 2)**
- **File:** `src/stacks/constructs/ExecutionInfrastructure.ts` (update)
- **Tasks:**
  - Add alarms for execution failure rates
  - Monitor Gateway invocation errors
  - Alert on error thresholds (>5% failure rate)
  - SNS notifications for critical failures
- **Dependencies:** CloudWatch metrics, SNS topics
- **Reference:** `PHASE_4_4_CODE_LEVEL_PLAN.md` Section 3

**4. End-to-End Tests (Week 3)**
- **Files:** `src/tests/integration/execution/*.test.ts` (new)
- **Tasks:**
  - Full execution lifecycle tests
  - ACTION_APPROVED → Step Functions → Gateway → Adapter → Outcome
  - Signal emission verification
  - Status API verification
- **Dependencies:** Deployed infrastructure, test data

---

## Integration Tests (After Phase 4.4)

**Priority:** Medium  
**Duration:** 1 week  
**Dependencies:** Phase 4.4 complete, deployed Gateway

#### Tasks:
1. **Gateway → Adapter Integration Tests**
   - Real Gateway invocations
   - Real Lambda functions (deployed)
   - VPC connectivity verification
   - Secrets Manager access tests

2. **Full Execution Lifecycle Tests**
   - Step Functions → ToolInvoker → Gateway → Adapter
   - External system integration (mocked Salesforce)
   - Compensation scenarios (rollback for reversible actions)

**Reference:** `PHASE_4_3_TEST_PLAN.md` Section "Integration Tests"

---

## Optional Improvements

### Test Performance Optimization

**Priority:** Low  
**Duration:** 1-2 days  
**Impact:** Reduces test time from ~27s to ~10-15s

**Tasks:**
- Share CDK App/Stack instances across tests
- Reduce duplicate bundling during test runs
- Cache synthesized templates where possible

**Reference:** Terminal output shows repeated bundling of same assets

---

### Documentation Updates

**Priority:** Low  
**Duration:** 1 day

**Tasks:**
- Update architecture docs with Phase 4.3 completion
- Document Gateway setup patterns
- Document connector adapter patterns
- Add troubleshooting guide for Gateway deployment

---

## Recommended Execution Order

### Path 1: Complete Coverage First (Conservative)

**Week 1:**
- ✅ Complete missing handler tests (execution-starter, execution-validator)
- ✅ Coverage: 84% → 95%
- ✅ Validate Phase 4.1 foundation

**Week 2-4:**
- ✅ Phase 4.4 implementation (signals, status API, alarms)
- ✅ End-to-end tests

**Week 5:**
- ✅ Integration tests (Gateway → Adapter flow)

**Benefits:**
- Higher confidence before Phase 4.4
- Cleaner test suite
- Easier to maintain

---

### Path 2: Proceed to Phase 4.4 (Aggressive)

**Week 1-2:**
- ✅ Phase 4.4 implementation (signals, status API)
- ✅ CloudWatch alarms

**Week 3:**
- ✅ End-to-end tests
- ✅ Integration tests

**Week 4:**
- ✅ Complete missing handler tests (if time permits)
- ✅ Documentation updates

**Benefits:**
- Faster feature delivery
- Phase 4.4 provides more value than additional tests
- Can add tests later

---

## Decision Matrix

| Factor | Option A (Tests First) | Option B (Phase 4.4) |
|--------|------------------------|----------------------|
| **Time to Value** | 1-2 days | 2-3 weeks |
| **Risk** | Low | Medium |
| **Coverage** | 84% → 95% | Stays at 84% |
| **Feature Delivery** | Delayed | Faster |
| **Maintenance** | Easier | Same |

**Recommendation:** **Option A (Tests First)** if you have 1-2 days available. Otherwise, proceed with **Option B (Phase 4.4)** and add tests later.

---

## Quick Start: Missing Handler Tests

### execution-starter-handler.test.ts

**Location:** `src/tests/unit/handlers/phase4/execution-starter-handler.test.ts`

**Test Cases:**
1. ✅ Valid EventBridge event → creates ExecutionAttempt
2. ✅ Invalid event structure → throws error
3. ✅ Missing action_intent_id → throws ValidationError
4. ✅ Duplicate execution attempt → throws ExecutionAlreadyInProgressError
5. ✅ Integration with ExecutionAttemptService

**Reference Files:**
- `src/handlers/phase4/execution-starter-handler.ts`
- `src/tests/unit/handlers/phase4/tool-mapper-handler.test.ts` (pattern)
- `src/services/execution/ExecutionAttemptService.ts`

---

### execution-validator-handler.test.ts

**Location:** `src/tests/unit/handlers/phase4/execution-validator-handler.test.ts`

**Test Cases:**
1. ✅ Valid ActionIntent → passes validation
2. ✅ Expired ActionIntent → throws ValidationError
3. ✅ Invalid ActionIntent status → throws ValidationError
4. ✅ Missing required fields → throws ValidationError
5. ✅ Integration with ActionIntentService

**Reference Files:**
- `src/handlers/phase4/execution-validator-handler.ts`
- `src/tests/unit/handlers/phase4/tool-mapper-handler.test.ts` (pattern)
- `src/services/decision/ActionIntentService.ts`

---

## Phase 4.4 Quick Start

**Reference Document:** `PHASE_4_4_CODE_LEVEL_PLAN.md`

**First Task:** Signal Emission
1. Read `PHASE_4_4_CODE_LEVEL_PLAN.md` Section 1
2. Update `execution-recorder-handler.ts`
3. Add SignalService integration
4. Test signal emission

**Second Task:** Execution Status API
1. Read `PHASE_4_4_CODE_LEVEL_PLAN.md` Section 2
2. Create `execution-status-api-handler.ts`
3. Add API Gateway or Function URL
4. Test status queries

---

## Summary

**Current State:**
- ✅ Phase 4.3 Complete (84% test coverage)
- ✅ All adapters, handlers, Gateway deployed
- ✅ Unit tests passing (475 tests, 42 suites)

**Next Actions:**
1. **Immediate:** Choose Option A (tests) or Option B (Phase 4.4)
2. **Short-term:** Complete chosen path (1-4 weeks)
3. **Medium-term:** Integration tests, performance optimization
4. **Long-term:** Phase 5+ features

**Recommendation:** Start with Option A (missing handler tests) if you have 1-2 days. Otherwise, proceed with Option B (Phase 4.4) for faster feature delivery.
