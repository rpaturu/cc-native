# Phase 6.4 Test Plan — Plans API (GET)

**Status:** ✅ **COMPLETE**  
**Created:** 2026-01-30  
**Last Updated:** 2026-01-28  
**Completed:** 2026-01-28  
**Parent:** [../PHASE_6_4_CODE_LEVEL_PLAN.md](../PHASE_6_4_CODE_LEVEL_PLAN.md)  
**Canonical contract:** [../PHASE_6_IMPLEMENTATION_PLAN.md](../PHASE_6_IMPLEMENTATION_PLAN.md) EPIC 6.4, Stories 6.4.1–6.4.2  
**Reference:** [PHASE_6_1_TEST_PLAN.md](PHASE_6_1_TEST_PLAN.md) — handler and coverage pattern

---

## Gap Analysis (vs 100% Coverage)

| Item | Plan § | Status | Notes |
|------|--------|--------|--------|
| **plan-lifecycle-api-handler (6.4 GET)** | §1–§4 | ✅ Done | Extended `plan-lifecycle-api-handler.test.ts`: GET list (PlanSummary[], default ACTIVE+PAUSED, CSV/multiValue status, invalid status, empty status→default, limit); GET plan (200/404); GET ledger (200/404, ownership check); 400/401/503; routing and auth edge cases. |
| **PlanRepositoryService (6.4 usage)** | §3 | ✅ Existing | listPlansByTenantAndStatus, getPlan already covered; no new methods in 6.4. |
| **PlanLedgerService (6.4 usage)** | §3 | ✅ Existing | getByPlanId covered; handler tests assert getByPlanId called after getPlan for ledger. |
| **CORS (GET)** | §4 | ✅ Done | Assert GET in Allow-Methods; Authorization, Content-Type in Allow-Headers. |

---

## Executive Summary

This document defines **100% test coverage** requirements for Phase 6.4 (Plans API GET: list, get plan, get ledger). All new handler branches—GET /plans (list with multi-status, limit, sort), GET /plans/:planId, GET /plans/:planId/ledger (with mandatory ownership check)—and error paths (400, 401, 404, 503) must be covered by unit tests. Existing POST routes and services remain covered by 6.1; 6.4 adds only GET coverage and CORS assertions for GET.

**Coverage target:** 100% statement and branch coverage for **6.4-added code** in `plan-lifecycle-api-handler.ts` (GET list, GET plan, GET ledger, multi-status parsing, default ACTIVE+PAUSED, limit, sort, ledger ownership check, CORS GET).

---

## 1. GET /plans (List) — 100% Coverage

**File:** `src/tests/unit/handlers/phase6/plan-lifecycle-api-handler.test.ts` (extend existing)

**Mock:** PlanRepositoryService must expose `listPlansByTenantAndStatus(tenantId, status, limit)` (and optionally `listPlansByTenantAndAccount`). Return arrays of plans; handler maps to PlanSummary (plan_id, plan_type, account_id, tenant_id, objective, plan_status, expires_at, updated_at — no steps).

### Success paths

| Scenario | Expected | Test |
|----------|----------|------|
| GET /plans with account_id (no status) | Default status = ACTIVE + PAUSED; repo called per status (or multi-status); response 200, body.plans is array of PlanSummary (no steps); sort by updated_at desc; limit default (e.g. 50) applied | event: httpMethod GET, path /plans, queryStringParameters { account_id: 'acc-1' }; mock listPlansByTenantAndStatus for ACTIVE and PAUSED; assert statusCode 200; body.plans array; each item has plan_id, plan_status, updated_at, no steps |
| GET /plans with status=ACTIVE,PAUSED (CSV) | Parse CSV; repo called for ACTIVE and PAUSED; merge/dedupe; sort updated_at desc; return PlanSummary[] | queryStringParameters { account_id: 'acc-1', status: 'ACTIVE,PAUSED' }; assert repo called with each status; response 200; plans sorted by updated_at desc |
| GET /plans with status[]=ACTIVE&status[]=PAUSED | Parse repeated status[]; same as CSV | queryStringParameters or multiValueQueryStringParameters { status: ['ACTIVE', 'PAUSED'] }; assert repo called; 200; PlanSummary[] |
| GET /plans with limit=10 | limit 10 applied after merge/sort; response has at most 10 plans | queryStringParameters { account_id: 'acc-1', limit: '10' }; mock return 15 plans; assert response.plans.length <= 10 (or repo called with limit 10) |
| GET /plans empty result | plans = [] when repo returns [] | mock listPlansByTenantAndStatus returns []; assert statusCode 200; body.plans === [] |

### Error paths

| Scenario | Expected | Test |
|----------|----------|------|
| GET /plans missing account_id | 400, error message | queryStringParameters null or {} (no account_id); assert statusCode 400; body.error mentions account_id |
| GET /plans no auth | 401 | requestContext.authorizer.claims missing tenant_id (or no authorizer); assert statusCode 401 |
| GET /plans service not configured | 503 | Same as 6.1: unset REVENUE_PLANS_TABLE_NAME; assert 503 |

### PlanSummary shape

- Assert each element in body.plans has: plan_id, plan_type, account_id, tenant_id, objective, plan_status, expires_at, updated_at.
- Assert each element does **not** have a full steps array (or steps is undefined/omitted). Drill-in uses GET /plans/:planId for full plan.

**Limit baseline (single path):** Limit is applied **after** merge + sort only. Handler fetches per status (repo may use a generous limit or no limit per status), merges and dedupes, sorts by updated_at desc, then applies the request limit to return top-N newest across all statuses. Do not apply limit per status (that would bias toward whichever status is queried first). Tests must assert this exact behavior.

**Coverage:** Default status ACTIVE+PAUSED; CSV and status[] parsing; **invalid status (ACTIVE,BADVALUE → 400); empty status → default;** limit applied after merge+sort only; sort updated_at desc; 200 empty and non-empty; 400 missing account_id; 401; 503.

---

## 2. GET /plans/:planId — 100% Coverage

**File:** Same as §1.

**Mock:** PlanRepositoryService.getPlan(tenantId, accountId, planId).

### Success path

| Scenario | Expected | Test |
|----------|----------|------|
| GET /plans/:planId with account_id, plan exists | 200; body.plan is full RevenuePlanV1 (includes steps) | path /plans/plan-1, pathParameters { planId: 'plan-1' }, queryStringParameters { account_id: 'acc-1' }; mockGetPlan resolves with plan(); assert statusCode 200; body.plan has plan_id, steps (array) |

### Error paths

| Scenario | Expected | Test |
|----------|----------|------|
| GET /plans/:planId plan not found | 404 | mockGetPlan resolves null; assert statusCode 404 |
| GET /plans/:planId missing account_id | 400 | queryStringParameters null or {} (no account_id); assert statusCode 400 |
| GET /plans/:planId no auth | 401 | no claims; assert statusCode 401 |
| GET /plans/:planId service not configured | 503 | env missing; assert 503 |

**Routing:** Path must match GET /plans/:planId and **not** match /plans/:planId/ledger (ledger has its own handler). Assert route dispatches to get-plan handler, not list or ledger.

**Coverage:** 200 with plan; 404 not found; 400 missing account_id; 401; 503.

---

## 3. GET /plans/:planId/ledger — 100% Coverage

**File:** Same as §1.

**Mock:** PlanRepositoryService.getPlan; PlanLedgerService.getByPlanId(planId, limit).

### Mandatory ownership check

| Scenario | Expected | Test |
|----------|----------|------|
| Ledger: plan exists, ledger has entries | **First** getPlan(tenantId, accountId, planId) called; **then** getByPlanId(planId, limit) called; 200; body.entries array (latest-first) | mockGetPlan resolves plan(); mockGetByPlanId resolves [entry1, entry2]; assert getPlan called before getByPlanId; assert statusCode 200; body.entries length 2 |
| Ledger: plan not found | getPlan returns null; **do not** call getByPlanId; 404 | mockGetPlan resolves null; assert getByPlanId **not** called; assert statusCode 404 |
| Ledger: ownership check prevents leaked data | Caller with tenant/account A cannot read ledger for plan owned by B (getPlan returns null for wrong scope) | Use tenant/account from auth; getPlan(tenantId, accountId, planId) returns null when scope wrong; assert 404 and getByPlanId not called |

### Success path

| Scenario | Expected | Test |
|----------|----------|------|
| Ledger with limit=20 | getByPlanId(planId, 20) called; response.entries up to 20 | queryStringParameters { account_id: 'acc-1', limit: '20' }; assert getByPlanId called with limit 20 (or default 50 when omitted) |

### Error paths

| Scenario | Expected | Test |
|----------|----------|------|
| Ledger missing account_id | 400 | no account_id in query; assert statusCode 400 |
| Ledger no auth | 401 | assert statusCode 401 |
| Ledger service not configured | 503 | assert 503 |

**Coverage:** getPlan always called first; getByPlanId only when plan exists; 200 with entries; 404 when plan null; 400/401/503.

---

## 4. CORS and Auth (Reuse + Extend)

**File:** Same as §1.

### CORS (6.4 extension)

| Scenario | Expected | Test |
|----------|----------|------|
| GET response headers | Access-Control-Allow-Methods includes GET | Invoke GET /plans or GET /plans/:planId; assert res.headers['Access-Control-Allow-Methods'] includes 'GET' (or contains GET,POST,OPTIONS) |
| Allow-Headers | Access-Control-Allow-Headers includes Authorization, Content-Type | Assert headers include Authorization and Content-Type in Allow-Headers |

### Auth (unchanged from 6.1)

- tenant_id from requestContext.authorizer.claims (custom:tenant_id or tenant_id).
- account_id from queryStringParameters (GET) or body (POST); required for GET list, GET plan, GET ledger.
- No auth → 401; missing account_id for GET → 400.

**Coverage:** CORS GET and Allow-Headers asserted for at least one GET route; auth 401 and 400 covered in §1–§3.

---

## 5. Routing and Edge Cases

| Scenario | Expected | Test |
|----------|----------|------|
| GET /plans (no planId) | Dispatches to list handler, not get or ledger | path /plans, no pathParameters.planId; assert list logic runs (repo list called) |
| GET /plans/plan-1 (planId, no /ledger) | Dispatches to get-plan handler | path /plans/plan-1, pathParameters.planId = 'plan-1'; resource does not end with /ledger; assert getPlan called, getByPlanId not called |
| GET /plans/plan-1/ledger | Dispatches to ledger handler | path or resource ends with /ledger; assert getPlan called then getByPlanId called |
| OPTIONS /plans | 200 CORS preflight | httpMethod OPTIONS; assert statusCode 200; CORS headers present |
| Unknown GET path | 404 | e.g. GET /plans/plan-1/unknown; assert 404 |

**Coverage:** No branch where GET list, GET plan, or GET ledger is confused; OPTIONS and unknown path covered.

---

## 6. Test Structure and Locations

```
src/tests/
├── unit/
│   └── handlers/
│       └── phase6/
│           └── plan-lifecycle-api-handler.test.ts   (extend: add GET list, GET plan, GET ledger, CORS GET)
├── fixtures/
│   └── plan/
│       └── (existing; optional PlanSummary or list response fixture for 6.4)
└── integration/
    └── plan/
        └── plans-api.test.ts   (Phase 6.4 — mandatory when env present; seed → invoke handler → teardown)
```

**New mocks required in plan-lifecycle-api-handler.test.ts:**

- PlanRepositoryService: add `listPlansByTenantAndStatus` (and optionally `listPlansByTenantAndAccount`) if not already mocked; handler uses these for GET list.
- PlanLedgerService: add `getByPlanId`; currently only `append` may be mocked; GET ledger calls getByPlanId.

---

## 7. Running Tests and Coverage Gates

### Unit tests (required)

```bash
npm test -- --testPathPattern=plan-lifecycle-api-handler
```

### Coverage gate (100% for 6.4 handler code)

```bash
npm test -- --coverage \
  --collectCoverageFrom='src/handlers/phase6/plan-lifecycle-api-handler.ts' \
  --testPathPattern=plan-lifecycle-api-handler
```

**Requirement:** 100% statement and branch coverage for `plan-lifecycle-api-handler.ts` (including all GET branches added in 6.4). Existing 6.1 coverage remains; 6.4 adds GET list, GET plan, GET ledger, multi-status default and parsing, limit, sort, ledger ownership check, CORS GET.

---

## 8. Success Criteria — 100% Coverage Checklist

Phase 6.4 tests are complete when:

1. **GET /plans:** Default status ACTIVE+PAUSED; status=ACTIVE,PAUSED (CSV) and status[] parsing; **invalid status (ACTIVE,BADVALUE → 400, message mentions invalid status); empty status → default ACTIVE+PAUSED;** **limit applied after merge + sort only** (top-N newest across statuses); sort by updated_at desc; response PlanSummary[] (no steps); 200 empty and non-empty; 400 missing account_id; 401; 503.
2. **GET /plans/:planId:** 200 with full plan (including steps); 404 not found; 400 missing account_id; 401; 503.
3. **GET /plans/:planId/ledger:** getPlan called first; getByPlanId only when plan exists; 200 with entries; 404 when plan null (getByPlanId not called); 400/401/503.
4. **CORS:** GET in Allow-Methods; Authorization, Content-Type in Allow-Headers (asserted for at least one GET).
5. **Routing:** GET /plans → list; GET /plans/:planId (no /ledger) → get plan; GET /plans/:planId/ledger → ledger; OPTIONS and unknown path handled.
6. **Coverage gate:** 100% statement and branch coverage for plan-lifecycle-api-handler.ts; CI passes before merge.

---

## 9. Integration Tests (Mandatory When Env Present)

**Status:** **Mandatory.** Same approach as Phase 6.3: seed → invoke handler → teardown. When integration tests run (e.g. `npm run test:integration` or post-deploy), the Phase 6.4 suite must pass when required env is present (REVENUE_PLANS_TABLE_NAME, PLAN_LEDGER_TABLE_NAME from `./deploy` .env). No skip flag.

**File:** `src/tests/integration/plan/plans-api.test.ts`

**Flow:**
1. **Seed:** Put one plan in RevenuePlans (ACTIVE) and one ledger entry in PlanLedger for that plan (unique tenant/account/plan ids, e.g. `plan-int-6-4-*`).
2. **Invoke:** Call plan-lifecycle-api-handler directly with GET events (list, get plan, get ledger); assert 200 and response shape; assert 404 for non-existent plan.
3. **Teardown:** Delete seeded plan from RevenuePlans; delete seeded ledger entries for that plan.

**Required env:** REVENUE_PLANS_TABLE_NAME, PLAN_LEDGER_TABLE_NAME (set in .env by deploy script).

**Deploy script:** Integration tests are run after deployment; Phase 6.4 suite is included and must pass when env is present (same as 6.3).

---

## References

- [PHASE_6_4_CODE_LEVEL_PLAN.md](../PHASE_6_4_CODE_LEVEL_PLAN.md) — implementation plan (§1–§7)
- [PHASE_6_IMPLEMENTATION_PLAN.md](../PHASE_6_IMPLEMENTATION_PLAN.md) — EPIC 6.4 acceptance criteria
- [PHASE_6_1_TEST_PLAN.md](PHASE_6_1_TEST_PLAN.md) — handler test structure and mocks
- [PHASE_6_3_TEST_PLAN.md](PHASE_6_3_TEST_PLAN.md) — coverage pattern reference
