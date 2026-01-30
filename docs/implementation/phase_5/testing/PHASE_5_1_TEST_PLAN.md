# Phase 5.1 Test Plan — Autonomy Modes & Policy

**Status:** ✅ **UNIT TESTS COMPLETE**  
**Created:** 2026-01-28  
**Last Updated:** 2026-01-28  
**Parent:** [PHASE_5_1_CODE_LEVEL_PLAN.md](../PHASE_5_1_CODE_LEVEL_PLAN.md)

---

## Executive Summary

This document outlines the testing strategy for Phase 5.1 (Autonomy Modes & Policy). The plan prioritizes **unit tests for service and policy logic** and treats **integration tests** (real DynamoDB) as optional, controlled by env flag.

**Testing philosophy:**  
Test policy and budget logic in isolation (unit); validate config/budget persistence and API behavior when dependencies are available (integration).

### Implementation Status

**✅ Unit tests – AutoApprovalPolicyEngine: COMPLETE** (2026-01-28)

- **Test file:** `src/tests/unit/autonomy/AutoApprovalPolicyEngine.test.ts`
- **Tests:** 9 (DISABLED → BLOCK, PROPOSE_ONLY/APPROVAL_REQUIRED → REQUIRE_APPROVAL, **UNKNOWN_MODE → REQUIRE_APPROVAL**, HIGH risk, low confidence, AUTO_EXECUTE for LOW/MINIMAL + sufficient confidence, Engine.evaluate wrapper)
- **Status:** All passing ✅

**✅ Unit tests – Services & handler: COMPLETE** (2026-01-28)

- AutonomyModeService (getMode precedence, putConfig, listConfigs) — `src/tests/unit/autonomy/AutonomyModeService.test.ts`
- AutonomyBudgetService (getConfig, putConfig, checkAndConsume atomicity, getStateForDate) — `src/tests/unit/autonomy/AutonomyBudgetService.test.ts`
- autonomy-admin-api-handler (route dispatch, /config, /budget, /budget/state; GET /budget config exists and config null; validation and error responses) — `src/tests/unit/handlers/phase5/autonomy-admin-api-handler.test.ts`
- **Status:** All passing ✅

**🟡 Integration tests: OPTIONAL**

- Policy + budget enforcement with real DynamoDB (skip when env not set)
- Admin API against deployed or local API Gateway

---

## Testing Strategy Overview

### 1. Unit tests (now)

- **AutoApprovalPolicyEngine:** Pure function; all branches and decision/reason/explanation.
- **AutonomyModeService:** getMode precedence (account+action_type → tenant+action_type → account+DEFAULT → tenant+DEFAULT → APPROVAL_REQUIRED); putConfig, listConfigs with mocked DynamoDB.
- **AutonomyBudgetService:** getConfig, putConfig; checkAndConsume conditional update (under limit → increment and return true; over limit → ConditionalCheckFailedException → return false); getStateForDate with mocked DynamoDB.
- **autonomy-admin-api-handler:** Path/method routing (/config, /budget, /budget/state); validation and error responses; no live AWS.

### 2. Integration tests (optional)

- AutonomyModeService + AutonomyBudgetService against real autonomy config and autonomy budget state tables (e.g. test tenant/account); skip when `RUN_PHASE5_INTEGRATION_TESTS` is not set.
- Admin API: GET/PUT config, GET/PUT budget, GET budget/state with real Lambda + API Gateway (or local server); auth via test Cognito or API key.

### 3. Out of scope for 5.1

- End-to-end auto-execute flow (Phase 5.4).
- Load or chaos tests.

---

## Unit Tests — Detailed Plan

### 1. AutoApprovalPolicyEngine (✅ DONE)

**File:** `src/tests/unit/autonomy/AutoApprovalPolicyEngine.test.ts`

| Scenario | Decision | Notes |
|----------|----------|--------|
| autonomy_mode === DISABLED | BLOCK | reason: ACTION_TYPE_DISABLED |
| autonomy_mode === PROPOSE_ONLY | REQUIRE_APPROVAL | reason: PROPOSE_ONLY |
| autonomy_mode === APPROVAL_REQUIRED | REQUIRE_APPROVAL | reason: TENANT_POLICY |
| unexpected autonomy_mode (e.g. CUSTOM_OR_INVALID) | REQUIRE_APPROVAL | reason: UNKNOWN_MODE, policy_clause: UNKNOWN_MODE |
| AUTO_EXECUTE + risk HIGH/MEDIUM | REQUIRE_APPROVAL | reason: RISK_LEVEL_HIGH |
| AUTO_EXECUTE + confidence < 0.7 | REQUIRE_APPROVAL | reason: CONFIDENCE_BELOW_THRESHOLD |
| AUTO_EXECUTE + LOW risk + confidence ≥ 0.7 | AUTO_EXECUTE | policy_clause: AUTO_EXECUTE_ALLOWED |
| AUTO_EXECUTE + MINIMAL risk + sufficient confidence | AUTO_EXECUTE | same |
| Engine.evaluate() | delegates to evaluateAutoApprovalPolicy | wrapper test |

**Coverage:** All decision paths and required reason/explanation for BLOCK and REQUIRE_APPROVAL.

---

### 2. AutonomyModeService (✅ DONE)

**File:** `src/tests/unit/autonomy/AutonomyModeService.test.ts`

**Mock:** DynamoDBDocumentClient (GetCommand, PutCommand, QueryCommand).

| Method | Test cases |
|--------|------------|
| **getMode(tenantId, accountId, actionType)** | (1) Returns mode from account+action_type item. (2) Falls back to tenant+action_type. (3) Falls back to account+DEFAULT. (4) Falls back to tenant+DEFAULT. (5) Returns APPROVAL_REQUIRED when no config. (6) Never returns AUTO_EXECUTE when no config. |
| **putConfig(item)** | (1) Writes item with policy_version and updated_at. (2) PutCommand called with correct table and item. |
| **listConfigs(tenantId, accountId?)** | (1) Queries by pk = TENANT#id when no accountId. (2) Queries by pk = TENANT#id#ACCOUNT#id when accountId provided. (3) Returns array of AutonomyModeConfigV1. |

**Fixtures:** AutonomyModeConfigV1 items (tenant-level, account-level, DEFAULT sk, action_type sk).

---

### 3. AutonomyBudgetService (✅ DONE)

**File:** `src/tests/unit/autonomy/AutonomyBudgetService.test.ts`

**Mock:** DynamoDBDocumentClient (GetCommand, PutCommand, UpdateCommand).

| Method | Test cases |
|--------|------------|
| **getConfig(tenantId, accountId)** | (1) Returns config when present. (2) Returns null when absent. |
| **putConfig(config)** | (1) Writes item with pk/sk and updated_at. (2) PutCommand with correct table. |
| **checkAndConsume(tenantId, accountId, actionType)** | (1) No config → returns false. (2) max_autonomous_per_day 0 → returns false. (3) Under limit → UpdateCommand with ConditionExpression; returns true. (4) Over limit → ConditionalCheckFailedException handled; returns false. (5) First consume of day creates state item (total/counts). |
| **getStateForDate(tenantId, accountId, dateKey)** | (1) Returns state item when present. (2) Returns null when absent. |

**Fixtures:** AutonomyBudgetV1 (BUDGET#CONFIG), BudgetStateItem (BUDGET_STATE#YYYY-MM-DD, total, counts).

---

### 4. autonomy-admin-api-handler (✅ DONE)

**File:** `src/tests/unit/handlers/phase5/autonomy-admin-api-handler.test.ts`

**Mock:** No live AWS; service layer mocked for full handler tests.

| Route | Method | Test cases |
|-------|--------|------------|
| /config | GET | (1) 200 + list of configs when tenant_id present. (2) 400 when tenant_id missing. (3) Uses query params or X-Tenant-Id. |
| /config | PUT | (1) 200 + config when body has tenant_id, mode. (2) 400 when tenant_id or mode missing. (3) pk/sk derived from body. |
| /budget | GET | (1) 200 + config when budget config exists. (2) 200 + config null when no budget config. (3) 400 when either missing. |
| /budget | PUT | (1) 200 + config when body has tenant_id, account_id, max_autonomous_per_day. (2) 400 when required fields missing. |
| /budget/state | GET | (1) 200 + state when tenant_id, account_id, date present. (2) 400 when tenant_id or account_id missing. |
| OPTIONS | - | (1) 204 CORS. |
| Unknown path | - | (1) 404. |
| Handler error | - | (1) 500 and no stack in body. |

---

## Integration Tests (Optional)

**Condition:** Run only when `RUN_PHASE5_INTEGRATION_TESTS=true` (or similar). Requires deployed stack or local DynamoDB with autonomy tables.

**File:** `src/tests/integration/autonomy/autonomy-services.test.ts` (to create)

| Scenario | Description |
|----------|-------------|
| AutonomyModeService E2E | putConfig (tenant DEFAULT), getMode for account+action_type → falls back to tenant DEFAULT; putConfig (account+action_type), getMode returns that mode. |
| AutonomyBudgetService E2E | putConfig (max_autonomous_per_day=2, max_per_action_type); checkAndConsume x2 → true, true; third → false; getStateForDate shows total=2, counts per action_type. |
| Admin API E2E | PUT /config, GET /config; PUT /budget, GET /budget, GET /budget/state; verify with real Lambda + API Gateway or local server. |

---

## Test Structure and Organization

### Directory structure

```
src/tests/
├── unit/
│   ├── autonomy/
│   │   ├── AutoApprovalPolicyEngine.test.ts   ✅
│   │   ├── AutonomyModeService.test.ts       ✅
│   │   └── AutonomyBudgetService.test.ts     ✅
│   └── handlers/
│       └── phase5/
│           └── autonomy-admin-api-handler.test.ts  ✅
├── integration/
│   └── autonomy/
│       └── autonomy-services.test.ts         🟡 (optional)
└── fixtures/
    └── autonomy/
        ├── autonomy-mode-config.json          🟡
        ├── autonomy-budget-config.json        🟡
        └── autonomy-budget-state.json         🟡
```

---

## Running Tests

### Unit tests only (exclude integration)

```bash
npm test -- --testPathIgnorePatterns=integration
```

### Phase 5.1 autonomy unit tests only

```bash
npm test -- --testPathPattern=autonomy
```

### With coverage

```bash
npm test -- --coverage --testPathIgnorePatterns=integration
```

### Integration tests (when implemented and env set)

```bash
RUN_PHASE5_INTEGRATION_TESTS=true npm test -- --testPathPattern=integration/autonomy
```

---

## Success Criteria

### Phase 5.1 unit tests complete when

1. ✅ AutoApprovalPolicyEngine: all decision paths and reason/explanation covered (9 tests, including UNKNOWN_MODE).
2. ✅ AutonomyModeService: getMode precedence, putConfig, listConfigs with mocked DynamoDB.
3. ✅ AutonomyBudgetService: getConfig, putConfig, checkAndConsume (including conditional update and false on limit), getStateForDate with mocked DynamoDB.
4. ✅ autonomy-admin-api-handler: route dispatch and validation for /config, /budget, /budget/state; GET /budget config exists and config null; error responses.
5. ✅ All new tests run in existing CI (e.g. `npm test -- --testPathIgnorePatterns=integration`).

### Phase 5.1 integration tests (optional) complete when

1. 🟡 AutonomyModeService and AutonomyBudgetService tests pass against real tables (env-gated).
2. 🟡 Admin API tests pass against deployed or local API (env-gated).

---

## References

- [PHASE_5_1_CODE_LEVEL_PLAN.md](../PHASE_5_1_CODE_LEVEL_PLAN.md) — implementation plan
- [PHASE_5_IMPLEMENTATION_PLAN.md](../PHASE_5_IMPLEMENTATION_PLAN.md) — EPIC 5.1
- [Phase 4.2 Test Plan](../../phase_4/testing/PHASE_4_2_TEST_PLAN.md) — structure reference
