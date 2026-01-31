# Phase 6.4 — Plans API (GET + CDK) — Code-Level Plan

**Status:** ✅ **COMPLETE**  
**Created:** 2026-01-30  
**Last Updated:** 2026-01-28  
**Completed:** 2026-01-28  
**Parent:** [PHASE_6_CODE_LEVEL_PLAN.md](PHASE_6_CODE_LEVEL_PLAN.md)  
**Canonical contract:** [PHASE_6_IMPLEMENTATION_PLAN.md](PHASE_6_IMPLEMENTATION_PLAN.md) EPIC 6.4, Stories 6.4.1–6.4.2  
**Prerequisites:** Phase 6.1 (schema, lifecycle, Policy Gate, ledger, plan-lifecycle-api-handler); Phase 6.2 (RENEWAL_DEFENSE, propose); Phase 6.3 (orchestrator). Plan lifecycle API already implements approve, pause, resume, abort, propose.

**Canonical 6.4 doc:** This file is the **single** Phase 6.4 code-level plan. Implement and test from this doc only. If you see another 6.4 plan with "per product choice," "optional ownership check," or different status/limit semantics, treat it as stale and ignore it.

---

## Overview

Phase 6.4 completes the **Plans API** in **cc-native** only: list, get, and ledger GET endpoints plus API Gateway wiring for all plan routes (GET + existing POST). UI (e.g. Active Plans in cc-dealmind) is out of scope for this plan; handle later.

**Deliverables (cc-native):**
- Plans API — list plans (tenant/account, filter by status), get plan by id (full detail + steps), get plan ledger ("why did this stop?"); API Gateway routes for all plan operations (GET + existing POST).
- CDK: Wire **GET /plans**, **GET /plans/{planId}**, **GET /plans/{planId}/ledger**, and all **existing POST** routes to the **same** plan-lifecycle Lambda; use the **same authorizer** as other plan routes.

**Existing in 6.1/6.2:** plan-lifecycle-api-handler already implements POST /plans/propose, POST /plans/:planId/approve, /pause, /resume, /abort. 6.4 adds **GET** list, **GET** plan by id, **GET** plan ledger, and wires the full Plans API to API Gateway (if not already wired).

---

## 1. API Contract (cc-native)

### 1.1 Existing routes (plan-lifecycle-api-handler)

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| POST | /plans/propose | Create DRAFT plan (6.2 proposal generator) | JWT; tenant_id, account_id |
| POST | /plans/:planId/approve | DRAFT → APPROVED | JWT; tenant_id, account_id |
| POST | /plans/:planId/pause | ACTIVE → PAUSED | JWT; tenant_id, account_id |
| POST | /plans/:planId/resume | PAUSED → ACTIVE (Policy Gate check) | JWT; tenant_id, account_id |
| POST | /plans/:planId/abort | → ABORTED with reason | JWT; tenant_id, account_id |

### 1.2 New routes (6.4)

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | /plans | List plans by tenant_id + account_id; multi-status filter (default ACTIVE+PAUSED). Returns **PlanSummary[]** (baseline). Sort: updated_at desc. Optional limit (default e.g. 50). | JWT; tenant_id, account_id (query or claims) |
| GET | /plans/:planId | Get plan by id (full detail + steps). 404 if not found or tenant/account mismatch. | JWT; tenant_id, account_id (query) |
| GET | /plans/:planId/ledger | Plan ledger ("why did this plan exist?" / "why did it stop?"). **Always** validates plan ownership first (getPlan); 404 if not found. Optional query `limit` (default e.g. 50). Entries latest-first. | JWT; tenant_id, account_id (query) |

**Query parameters (GET /plans):**
- `tenant_id` — optional if from JWT
- `account_id` — required (or from JWT)
- `status` — **multi-status filter.** Formats: `status=ACTIVE,PAUSED` (CSV) or `status[]=ACTIVE&status[]=PAUSED`. **Default when omitted or empty string: ACTIVE + PAUSED.** Values must be valid PlanStatus; **invalid value (e.g. BADVALUE) → 400**, error message mentions invalid status (no silent ignore).
- `limit` — optional; default e.g. 50. Max plans returned.

**Sorting / pagination (GET /plans baseline):**
- **Sort:** by `updated_at` descending (newest first).
- **Limit:** **Apply limit after merge + sort only** (return top-N newest across all statuses). Do not apply limit per status. Single path: fetch per status (repo may use generous or no limit per status), merge/dedupe, sort by updated_at desc, then take first `limit` items.

**Query parameters (GET /plans/:planId and GET /plans/:planId/ledger):**
- `account_id` — required for scope (plan is tenant+account scoped)

**Response shapes:**
- **List (baseline):** `{ plans: PlanSummary[] }`. **PlanSummary** (baseline type for GET /plans): plan_id, plan_type, account_id, tenant_id, objective, plan_status, expires_at, updated_at. No steps array; drill-in uses GET /plans/:planId for full steps. Keeps payloads small and avoids UI coupling to full schema churn.
- Get plan: `{ plan: RevenuePlanV1 }` (full document including steps).
- Get ledger: `{ entries: PlanLedgerEntry[] }` (append-only events; latest first).

### 1.3 PlanSummary type (implementation detail)

Define a **PlanSummary** type (e.g. in `PlanTypes.ts` or a small types file under `src/types/plan/` or equivalent) with exactly:

- `plan_id`, `plan_type`, `account_id`, `tenant_id`, `objective`, `plan_status`, `expires_at`, `updated_at`
- **No** `steps` (or step-related fields).

The list handler must **map RevenuePlanV1 → PlanSummary** when building the GET /plans response: fetch full plans (or list results) from the repo, then map each to PlanSummary before returning `{ plans: PlanSummary[] }`. This keeps list payloads small and the API contract stable.

---

## 2. Handler Extension (cc-native)

### File: `src/handlers/phase6/plan-lifecycle-api-handler.ts` (extend existing)

**Add GET routing and handlers:**

1. **GET /plans** — Parse query `account_id`, `status`, `limit`. **Multi-status:** parse `status` as CSV or repeated `status[]`; **default when omitted or empty string: `['ACTIVE', 'PAUSED']`.** **Validate each value is a valid PlanStatus; if any invalid (e.g. BADVALUE) → 400**, error mentions invalid status. Call repo per status (e.g. listPlansByTenantAndStatus for each status); **merge/dedupe; sort by updated_at desc; then apply limit** (default e.g. 50) to return top-N newest across statuses (limit applied after merge+sort only). Return **PlanSummary[]** (plan_id, plan_type, account_id, objective, plan_status, expires_at, updated_at — no full steps). Enforce tenant/account from auth; no cross-tenant.
2. **GET /plans/:planId** — Load `PlanRepositoryService.getPlan(tenantId, accountId, planId)`. If null, 404. Return `{ plan }` (full RevenuePlanV1).
3. **GET /plans/:planId/ledger** — **Mandatory ownership check:** call `PlanRepositoryService.getPlan(tenantId, accountId, planId)` first; if null, 404. Only then call `PlanLedgerService.getByPlanId(planId, limit)`. Return `{ entries }`. Prevents ledger access by guessed planId.

**CORS:** Extend allowed methods to include `GET`. Headers:
- `Access-Control-Allow-Methods: GET,POST,OPTIONS`
- `Access-Control-Allow-Headers: Authorization,Content-Type,X-Tenant-Id` (and any other request headers the client sends)
- If the frontend uses cookies/credentials: `Access-Control-Allow-Credentials: true` (otherwise omit; JWT bearer-only does not require it)

**Auth:** Unchanged — JWT authorizer; `tenant_id` from claims, `account_id` from query or body (and required for get/list so plan scope is explicit).

**Errors:**
- 400 — Missing account_id for list/get.
- 401 — Unauthorized (no/invalid JWT).
- 404 — Plan not found or ledger requested for non-existent plan.
- 503 — Service not configured (missing env).

---

## 3. PlanRepositoryService and PlanLedgerService (existing)

No new methods required for 6.4:

- **PlanRepositoryService:** `listPlansByTenantAndStatus(tenantId, status, limit)`, `listPlansByTenantAndAccount(tenantId, accountId, limit)`, `getPlan(tenantId, accountId, planId)` already exist.
- **PlanLedgerService:** `getByPlanId(planId, limit)` already exists.

Handler calls these; no schema changes.

---

## 4. API Gateway Wiring (CDK)

**Requirement:** All plan routes (GET and POST) must be wired to the **same** plan-lifecycle Lambda and use the **same authorizer** as other plan routes. No separate Lambda or authorizer for GET vs POST.

### Option A — Extend PlanInfrastructure

If API Gateway and authorizer are passed into PlanInfrastructure (similar to ExecutionInfrastructure or AutonomyInfrastructure), add a method `createPlansApiGateway(props: { apiGateway: apigateway.RestApi; plansAuthorizer: apigateway.IAuthorizer })` (reuse the **same** authorizer used elsewhere for plan/control-center routes):

- **Resource:** `plans` under API root (or under existing control-center path if Plans API lives under same API).
- **GET /plans** — Lambda integration to **plan-lifecycle-api-handler**; same authorizer; request passes query params (tenant_id, account_id, status).
- **GET /plans/{planId}** — Lambda integration to **plan-lifecycle-api-handler**; same authorizer; path parameter planId + query account_id.
- **GET /plans/{planId}/ledger** — Lambda integration to **plan-lifecycle-api-handler**; same authorizer; path parameter planId + query account_id, limit.
- **POST /plans/propose** — Lambda integration to **plan-lifecycle-api-handler**; same authorizer.
- **POST /plans/{planId}/approve** — Lambda integration to **plan-lifecycle-api-handler**; same authorizer.
- **POST /plans/{planId}/pause** — Lambda integration to **plan-lifecycle-api-handler**; same authorizer.
- **POST /plans/{planId}/resume** — Lambda integration to **plan-lifecycle-api-handler**; same authorizer.
- **POST /plans/{planId}/abort** — Lambda integration to **plan-lifecycle-api-handler**; same authorizer.

Use a **single** Lambda (plan-lifecycle-api-handler) for all of the above; route by `event.httpMethod` and `event.path` / `event.resource` (already done in handler).

### Option B — Separate Plans API construct

If Plans API is a separate RestApi or path, create a small construct that receives API + **same** authorizer + plan-lifecycle Lambda and adds the above resources and methods.

**CCNativeStack:** Pass `apiGateway` and the **same** Cognito/plan-scoped authorizer used for other plan routes into PlanInfrastructure (or new PlansApiGateway construct); ensure plan-lifecycle-api-handler is wired to **all** listed GET and POST routes.

---

## 5. Implementation Tasks (Checklist)

1. **Extend plan-lifecycle-api-handler:** Add GET branch for GET /plans (no planId) → handleListPlans. Require account_id (query). Parse multi-status (CSV or status[]); default when omitted or empty string: ACTIVE + PAUSED. **Validate each status value is PlanStatus; invalid → 400.** Call repo per status; merge/dedupe; **sort by updated_at desc; then apply limit** (default e.g. 50) — limit after merge+sort only. **Map RevenuePlanV1 → PlanSummary** when building the list; return `{ plans: PlanSummary[] }` (no full steps). (PlanSummary type: §1.3.)
2. **Add GET plan by id:** Path matches GET /plans/:planId (no `/ledger` suffix) → handleGetPlan. Require account_id (query). Call repo.getPlan(tenantId, accountId, planId); 404 if null; return { plan }.
3. **Add GET plan ledger:** Path matches GET /plans/:planId/ledger → handleGetPlanLedger. Require account_id (query). **Always** call repo.getPlan(tenantId, accountId, planId) first; 404 if null. Then call ledger.getByPlanId(planId, limit); return { entries }.
4. **CORS:** Add GET to Access-Control-Allow-Methods; ensure Access-Control-Allow-Headers includes Authorization, Content-Type; add Access-Control-Allow-Credentials if the frontend uses credentials.
5. **CDK:** Wire Plans API to API Gateway — add resources and methods for GET /plans, GET /plans/{planId}, GET /plans/{planId}/ledger, and ensure all POST routes are attached (if not already). Pass API + authorizer into PlanInfrastructure or new construct; grant plan-lifecycle Lambda invoke from API.

---

## 6. Test Strategy

- **Unit tests (plan-lifecycle-api-handler):** Add cases for GET list (with/without status filter; 400 missing account_id; 200 with plans array; PlanSummary mapping); GET plan (200 with plan; 404 not found); GET ledger (200 with entries; 404 plan not found). Reuse existing auth and CORS tests. Extend `plan-lifecycle-api-handler.test.ts` with new test cases for GET branches and PlanSummary mapping.
- **Integration (optional):** Call GET /plans and GET /plans/:planId against deployed API with valid JWT; assert shape and 404 when plan missing.

---

## 7. References

- Parent: [PHASE_6_CODE_LEVEL_PLAN.md](PHASE_6_CODE_LEVEL_PLAN.md)
- Canonical contract: [PHASE_6_IMPLEMENTATION_PLAN.md](PHASE_6_IMPLEMENTATION_PLAN.md) EPIC 6.4
- Phase 6.1 (handler, repo, ledger): [PHASE_6_1_CODE_LEVEL_PLAN.md](PHASE_6_1_CODE_LEVEL_PLAN.md)
- Phase 6.2 (propose): [PHASE_6_2_CODE_LEVEL_PLAN.md](PHASE_6_2_CODE_LEVEL_PLAN.md)
- Phase 6.3 (orchestrator, **implemented**): [PHASE_6_3_CODE_LEVEL_PLAN.md](PHASE_6_3_CODE_LEVEL_PLAN.md) — single 6.3 code-level plan; use this doc for "surface what 6.3 produced."
- API Gateway pattern: `src/stacks/constructs/AutonomyInfrastructure.ts`, `ExecutionInfrastructure.ts` (LambdaIntegration, addMethod, authorizer)
