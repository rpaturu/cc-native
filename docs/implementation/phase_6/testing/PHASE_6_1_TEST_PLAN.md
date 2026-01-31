# Phase 6.1 Test Plan — RevenuePlan Schema + Policy

**Status:** 🟢 **COMPLETE**  
**Created:** 2026-01-30  
**Last Updated:** 2026-01-30  
**Sign-off:** Phase 6.1 unit tests implemented and passing (PlanLifecycleService, PlanPolicyGateService, PlanRepositoryService, PlanLedgerService, PlanTypes, plan-lifecycle-api-handler).  
**Parent:** [../PHASE_6_1_CODE_LEVEL_PLAN.md](../PHASE_6_1_CODE_LEVEL_PLAN.md)  
**Canonical contract:** [../PHASE_6_IMPLEMENTATION_PLAN.md](../PHASE_6_IMPLEMENTATION_PLAN.md) EPIC 6.1

---

## Gap Analysis (vs 100% Coverage)

| Item | Plan § | Status | Notes |
|------|--------|--------|--------|
| **PlanRepositoryService.test.ts** | §3 | ✅ Added | `src/tests/unit/plan/PlanRepositoryService.test.ts` — getPlan, putPlan (create/update DRAFT/reject non-DRAFT), updatePlanStatus, listPlansByTenantAndStatus, listPlansByTenantAndAccount, existsActivePlanForAccountAndType. |
| **plan-lifecycle-api-handler.test.ts** | §5 | ✅ Added | `src/tests/unit/handlers/phase6/plan-lifecycle-api-handler.test.ts` — approve, pause, resume (can_activate true/false), abort; auth; 404; 500. |
| **PlanLifecycleService** | §1 | ✅ Complete | All 9 allowed transitions; all disallowed (including terminal); same-status, null toStatus; ledger event asserted. |
| **PlanPolicyGateService** | §2 | ✅ Complete | validateForApproval: INVALID_PLAN_TYPE, STEP_ORDER_VIOLATION, RISK_ELEVATED, HUMAN_TOUCH_REQUIRED, valid; evaluateCanActivate: CONFLICT_ACTIVE_PLAN, PRECONDITIONS_UNMET, INVALID_PLAN_TYPE, valid; determinism. |
| **PlanLedgerService** | §4 | ✅ Complete | append (sk condition); getByPlanId (query, limit). |
| **PlanTypes.test.ts** | §7 | ✅ Added | `src/tests/unit/plan/PlanTypes.test.ts` — RevenuePlanV1, PlanStepV1 (step_id, no retry_count), PlanPolicyGateInput (preconditions_met required), PlanLedgerEntry (event_type, data). |
| **Fixtures plan/** | §8 | ✅ Added | `src/tests/fixtures/plan/` — revenue-plan-draft.json, revenue-plan-approved.json, revenue-plan-active.json, plan-policy-gate-input.json. |

---

## Executive Summary

This document defines the **100% test coverage** requirements for Phase 6.1 (RevenuePlan Schema + Policy). Every transition, every Policy Gate reason code, every service method, every API route, and every ledger event must be covered by unit tests. Integration tests (real DynamoDB) are optional and env-gated.

**Coverage target:** 100% for Phase 6.1 code paths (PlanLifecycleService, PlanPolicyGateService, PlanRepositoryService, PlanLedgerService, plan-lifecycle-api-handler, and types used by them).

---

## 1. PlanLifecycleService — 100% Transition Coverage

**File:** `src/tests/unit/plan/PlanLifecycleService.test.ts`

**Mock:** PlanRepositoryService (getPlan, updatePlanStatus), PlanLedgerService (append).

### Allowed transitions (must pass)

| From     | To        | Test description |
|----------|-----------|------------------|
| DRAFT    | APPROVED  | transition(plan, 'APPROVED') → updates repo, appends PLAN_APPROVED |
| APPROVED | ACTIVE    | transition(plan, 'ACTIVE') → updates repo, appends PLAN_ACTIVATED |
| ACTIVE   | PAUSED    | transition(plan, 'PAUSED', { reason }) → updates repo, appends PLAN_PAUSED with reason |
| ACTIVE   | COMPLETED | transition(plan, 'COMPLETED', { completion_reason, completed_at }) → updates repo, appends PLAN_COMPLETED |
| ACTIVE   | ABORTED   | transition(plan, 'ABORTED', { reason, aborted_at }) → updates repo, appends PLAN_ABORTED |
| ACTIVE   | EXPIRED   | transition(plan, 'EXPIRED', { expired_at }) → updates repo, appends PLAN_EXPIRED |
| PAUSED   | ACTIVE    | transition(plan, 'ACTIVE') → updates repo, appends PLAN_RESUMED |
| PAUSED   | ABORTED   | transition(plan, 'ABORTED', { reason }) → updates repo, appends PLAN_ABORTED |
| APPROVED | ABORTED   | transition(plan, 'ABORTED', { reason }) → updates repo, appends PLAN_ABORTED |

### Disallowed transitions (must reject / throw)

| From     | To        | Test description |
|----------|-----------|------------------|
| DRAFT    | ACTIVE    | transition(plan, 'ACTIVE') → reject |
| DRAFT    | PAUSED    | transition(plan, 'PAUSED') → reject |
| APPROVED | PAUSED    | transition(plan, 'PAUSED') → reject |
| APPROVED | COMPLETED | transition(plan, 'COMPLETED') → reject |
| ACTIVE   | DRAFT     | transition(plan, 'DRAFT') → reject |
| ACTIVE   | APPROVED  | transition(plan, 'APPROVED') → reject |
| PAUSED   | DRAFT     | transition(plan, 'DRAFT') → reject |
| PAUSED   | APPROVED  | transition(plan, 'APPROVED') → reject |
| COMPLETED| ACTIVE    | transition(plan, 'ACTIVE') → reject (terminal) |
| ABORTED  | ACTIVE    | transition(plan, 'ACTIVE') → reject (terminal) |
| EXPIRED  | ACTIVE    | transition(plan, 'ACTIVE') → reject (terminal) |

### Edge cases

- **Same status:** transition(plan, plan.plan_status) → reject (no-op not allowed).
- **Null/undefined toStatus:** reject or throw.
- **Plan not found:** if transition loads plan first and plan is null → reject.
- **Ledger append called:** for every allowed transition, assert PlanLedgerService.append called with correct event_type and data payload (per §3a).

**Coverage:** Every row in the transition matrix (§5a) and every edge case.

---

## 2. PlanPolicyGateService — 100% Reason Code and Determinism Coverage

**File:** `src/tests/unit/plan/PlanPolicyGateService.test.ts`

**Mock:** No DB; pure logic. Policy Gate does not perform DB reads.

### validateForApproval(plan, tenantId)

| Scenario | valid | Reason code(s) | Test |
|----------|--------|----------------|------|
| plan_type not in allowed list | false | INVALID_PLAN_TYPE | Assert reasons includes INVALID_PLAN_TYPE |
| Step dependencies invalid | false | STEP_ORDER_VIOLATION | Assert STEP_ORDER_VIOLATION |
| Plan has high-risk step, tenant requires elevated authority | false | RISK_ELEVATED | Assert RISK_ELEVATED |
| Human-touch required not satisfied | false | HUMAN_TOUCH_REQUIRED | Assert HUMAN_TOUCH_REQUIRED |
| All checks pass | true | (empty) | Assert valid === true, reasons.length === 0 |

### evaluateCanActivate(input: PlanPolicyGateInput)

| Scenario | can_activate | Reason code(s) | Test |
|----------|--------------|----------------|------|
| existing_active_plan_ids includes another plan_id (same account+type) | false | CONFLICT_ACTIVE_PLAN | Assert CONFLICT_ACTIVE_PLAN |
| preconditions_met === false | false | PRECONDITIONS_UNMET | Assert PRECONDITIONS_UNMET |
| plan_type not allowed (if checked here) | false | INVALID_PLAN_TYPE | Assert INVALID_PLAN_TYPE |
| No conflict, preconditions_met === true | true | (empty) | Assert can_activate === true, reasons.length === 0 |

### Determinism

- Same PlanPolicyGateInput → same PlanPolicyGateResult (run evaluateCanActivate twice with same input, assert deep equality).
- Same plan + tenantId for validateForApproval → same result (run twice, assert deep equality).

**Coverage:** Every reason code in PlanPolicyGateReasonCode; valid and invalid paths for both methods; determinism tests.

---

## 3. PlanRepositoryService — 100% Method and DRAFT-Only Coverage

**File:** `src/tests/unit/plan/PlanRepositoryService.test.ts`

**Mock:** DynamoDBDocumentClient (GetCommand, PutCommand, UpdateCommand, QueryCommand).

### getPlan(tenantId, accountId, planId)

- Returns plan when item exists and tenant/account match.
- Returns null when item does not exist.
- Returns null or reject when tenant/account do not match (no cross-tenant read).

### putPlan(plan)

- **Create (new plan_id):** PutCommand with correct pk/sk/gsi1pk/gsi1sk/gsi2pk/gsi2sk; succeeds.
- **Update existing DRAFT:** PutCommand when stored plan has plan_status === 'DRAFT'; succeeds.
- **Update existing non-DRAFT:** Reject when stored plan has plan_status !== 'DRAFT' (steps/constraints immutable). Assert no PutCommand or throw.

### updatePlanStatus(tenantId, accountId, planId, newStatus, options?)

- Conditional update with plan_status = :expected; Set plan_status, updated_at, gsi1pk/gsi1sk (and completed_at/aborted_at/expired_at/completion_reason when applicable).
- Reject or throw when conditional check fails (concurrent update).

### listPlansByTenantAndStatus(tenantId, status, limit?)

- Query GSI1 with gsi1pk = TENANT#tenantId#STATUS#status; returns array of RevenuePlanV1; limit applied.

### listPlansByTenantAndAccount(tenantId, accountId, limit?)

- Query GSI2 with gsi2pk = TENANT#tenantId, gsi2sk begins_with ACCOUNT#accountId#; returns array; limit applied.

### existsActivePlanForAccountAndType(tenantId, accountId, planType)

- Returns { exists: true, planId } when an ACTIVE plan exists for that account and plan_type.
- Returns { exists: false } when none. Filter by account_id and plan_type in item or query.

**Coverage:** Every method; create vs update in putPlan; DRAFT-only rejection for putPlan when status !== DRAFT.

---

## 4. PlanLedgerService — 100% Append and Query Coverage

**File:** `src/tests/unit/plan/PlanLedgerService.test.ts`

**Mock:** DynamoDBDocumentClient (PutCommand, QueryCommand).

### append(entry without entry_id and timestamp)

- Generates entry_id (UUID) and timestamp (ISO); PutCommand with pk = PLAN#plan_id, sk = EVENT#timestamp#entry_id.
- ConditionExpression: attribute_not_exists(sk) (or equivalent to prevent overwrite).
- Returns PlanLedgerEntry with entry_id and timestamp set.

### getByPlanId(planId, limit?)

- Query pk = PLAN#planId; sort by sk (ascending or descending per spec); limit applied; returns PlanLedgerEntry[].

**Coverage:** append condition (sk uniqueness); getByPlanId ordering and limit.

---

## 5. Plan Lifecycle API Handler — 100% Route and Response Coverage

**File:** `src/tests/unit/handlers/phase6/plan-lifecycle-api-handler.test.ts`

**Mock:** PlanRepositoryService, PlanPolicyGateService, PlanLifecycleService; auth (authorized / unauthorized).

### POST /plans/:planId/approve

- **200:** Plan in DRAFT; validateForApproval valid; transition(plan, 'APPROVED') called; ledger PLAN_APPROVED; response success.
- **400:** Plan in DRAFT but validateForApproval invalid; response includes reasons.
- **400/404:** Plan not found or plan not in DRAFT (e.g. already APPROVED).
- **401/403:** Unauthorized (no plan-approver); handler returns 403 or 401.

### POST /plans/:planId/pause

- **200:** Plan in ACTIVE; transition(plan, 'PAUSED', { reason }) called; ledger PLAN_PAUSED.
- **400/404:** Plan not found or plan not ACTIVE.
- **401/403:** Unauthorized.

### POST /plans/:planId/resume

- **200:** Plan in PAUSED; evaluateCanActivate returns can_activate=true; transition(plan, 'ACTIVE') called; ledger PLAN_RESUMED.
- **400:** Plan in PAUSED but evaluateCanActivate returns can_activate=false; response includes reasons; **PlanLifecycleService.transition is not called** (explicit assert: when can_activate=false, verify transition was never invoked — prevents accidental bypass).
- **404:** Plan not found or not PAUSED.
- **401/403:** Unauthorized.

### POST /plans/:planId/abort

- **200:** Plan in ACTIVE or PAUSED or APPROVED; transition(plan, 'ABORTED', { reason }) called; ledger PLAN_ABORTED.
- **400/404:** Plan not found or plan already terminal (COMPLETED/ABORTED/EXPIRED).
- **401/403:** Unauthorized.

### Other

- **404:** Unknown route or method.
- **500:** Service throws; handler returns 500; no stack or internal message in body.

**Coverage:** Every route; success and failure branches; auth rejection; 500 handling.

---

## 6. Ledger Event Schema — Payload and Emitter Coverage

**File:** Same as PlanLifecycleService tests; optionally separate `PlanLedgerEvents.test.ts` for payload contracts.

For each transition that emits a ledger event, assert:

- **PLAN_APPROVED:** data includes plan_id; approved_by/approved_at when provided.
- **PLAN_ACTIVATED:** data includes plan_id.
- **PLAN_PAUSED:** data includes plan_id; reason when provided.
- **PLAN_RESUMED:** data includes plan_id.
- **PLAN_ABORTED:** data includes plan_id, reason, aborted_at.
- **PLAN_COMPLETED:** data includes plan_id, completion_reason, completed_at.
- **PLAN_EXPIRED:** data includes plan_id, expired_at.

**PLAN_UPDATED:** Only emitted when plan_status = DRAFT (enforced in service or API test; assert no PLAN_UPDATED when status !== DRAFT).

**Coverage:** Every event type emitted by 6.1 code paths has correct data payload (per code-level plan §3a).

---

## 7. Type and Schema Tests (Optional but Recommended)

**File:** `src/tests/unit/plan/PlanTypes.test.ts` or inline in service tests

- RevenuePlanV1: valid object passes schema/validation; invalid (e.g. missing plan_id, invalid plan_status) fails.
- PlanStepV1: step_id required; no retry_count on schema (retry_count not in PlanStepV1).
- PlanPolicyGateInput: preconditions_met required (not optional).
- PlanLedgerEntry: event_type in PlanLedgerEventType union; data required.

**Coverage:** Critical type invariants so refactors don’t break contracts.

---

## 8. Test Structure and Locations

```
src/tests/
├── unit/
│   ├── plan/
│   │   ├── PlanLifecycleService.test.ts
│   │   ├── PlanPolicyGateService.test.ts
│   │   ├── PlanRepositoryService.test.ts
│   │   ├── PlanLedgerService.test.ts
│   │   └── PlanTypes.test.ts              (optional)
│   └── handlers/
│       └── phase6/
│           └── plan-lifecycle-api-handler.test.ts
├── fixtures/
│   └── plan/
│       ├── revenue-plan-draft.json
│       ├── revenue-plan-approved.json
│       ├── revenue-plan-active.json
│       └── plan-policy-gate-input.json
└── integration/
    └── plan/
        └── plan-services.test.ts          (optional, env-gated)
```

---

## 9. Integration Tests (Optional, Env-Gated)

**Condition:** Run only when `RUN_PHASE6_1_INTEGRATION_TESTS=true` (or equivalent). Requires DynamoDB tables (RevenuePlans, PlanLedger).

**File:** `src/tests/integration/plan/plan-services.test.ts`

| Scenario | Description |
|----------|-------------|
| PlanRepositoryService E2E | putPlan (DRAFT); getPlan; putPlan again (update DRAFT); updatePlanStatus to APPROVED; listPlansByTenantAndStatus(ACTIVE empty, APPROVED has plan); existsActivePlanForAccountAndType |
| PlanLedgerService E2E | append PLAN_APPROVED; append PLAN_ACTIVATED; getByPlanId returns both in order; condition attribute_not_exists(sk) prevents overwrite |
| PlanLifecycleService E2E | Create DRAFT; transition to APPROVED; transition to ACTIVE; transition to PAUSED; transition to ABORTED; ledger has PLAN_APPROVED, PLAN_ACTIVATED, PLAN_PAUSED, PLAN_ABORTED |
| DRAFT-only putPlan | putPlan(DRAFT) succeeds; updatePlanStatus to APPROVED; putPlan(same plan_id, modified steps) fails (reject) |

---

## 10. Running Tests and Coverage Gates

### Unit tests (required)

```bash
npm test -- --testPathPattern=plan
npm test -- --testPathPattern=phase6/plan-lifecycle
```

### Coverage gate (100% for Phase 6.1 modules)

```bash
npm test -- --coverage --collectCoverageFrom='src/services/plan/**/*.ts' --collectCoverageFrom='src/handlers/phase6/plan-lifecycle*.ts' --collectCoverageFrom='src/types/plan/*.ts' --testPathPattern=plan
```

**Requirement:** 100% statement and branch coverage for:

- `src/services/plan/PlanLifecycleService.ts`
- `src/services/plan/PlanPolicyGateService.ts`
- `src/services/plan/PlanRepositoryService.ts`
- `src/services/plan/PlanLedgerService.ts`
- `src/handlers/phase6/plan-lifecycle-api-handler.ts`

(Exclude types-only files from branch coverage if they have no branches.)

---

## 11. Success Criteria — 100% Coverage Checklist

Phase 6.1 tests are complete when:

1. **PlanLifecycleService:** All allowed transitions (9) pass; all disallowed transitions (including terminal) reject; same-status and null toStatus reject; ledger event type and payload asserted for each allowed transition.
2. **PlanPolicyGateService:** validateForApproval — INVALID_PLAN_TYPE, STEP_ORDER_VIOLATION, RISK_ELEVATED, HUMAN_TOUCH_REQUIRED and valid path; evaluateCanActivate — CONFLICT_ACTIVE_PLAN, PRECONDITIONS_UNMET, INVALID_PLAN_TYPE and valid path; determinism tests pass.
3. **PlanRepositoryService:** getPlan, putPlan (create + update DRAFT), putPlan reject when status !== DRAFT, updatePlanStatus, listPlansByTenantAndStatus, listPlansByTenantAndAccount, existsActivePlanForAccountAndType — all covered.
4. **PlanLedgerService:** append (sk condition), getByPlanId — covered.
5. **plan-lifecycle-api-handler:** approve, pause, resume (with can_activate true/false), abort — success and failure; auth rejection; 404/500.
6. **Ledger events:** Each event type (PLAN_APPROVED, PLAN_ACTIVATED, PLAN_PAUSED, PLAN_RESUMED, PLAN_ABORTED, PLAN_COMPLETED, PLAN_EXPIRED) emitted with correct data payload.
7. **Coverage gate:** 100% statement and branch coverage for the five modules above (or per-project standard).
8. **CI:** All Phase 6.1 unit tests run in CI and must pass before merge.

---

## References

- [PHASE_6_1_CODE_LEVEL_PLAN.md](../PHASE_6_1_CODE_LEVEL_PLAN.md) — implementation plan (§4a, §3a, §5a, §5b)
- [PHASE_6_IMPLEMENTATION_PLAN.md](../PHASE_6_IMPLEMENTATION_PLAN.md) — EPIC 6.1 acceptance criteria
- [PHASE_5_1_TEST_PLAN.md](../../phase_5/testing/PHASE_5_1_TEST_PLAN.md) — structure reference
