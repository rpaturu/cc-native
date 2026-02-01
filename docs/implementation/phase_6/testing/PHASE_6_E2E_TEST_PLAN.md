# Phase 6 E2E Test Plan

**Status:** 🟢 **COMPLETE**  
**Created:** 2026-01-28  
**Last Updated:** 2026-01-28  
**Parent:** [PHASE_6_IMPLEMENTATION_PLAN.md](../PHASE_6_IMPLEMENTATION_PLAN.md), [PHASE_6_5_CODE_LEVEL_PLAN.md](../PHASE_6_5_CODE_LEVEL_PLAN.md)  
**Satisfies:** Phase 6 E2E (post-deploy): plan lifecycle API and conflict resolution against deployed Lambda + DynamoDB.  
**Related:** [PHASE_6_5_TEST_PLAN.md](PHASE_6_5_TEST_PLAN.md) (unit + integration), [PHASE_6_4_TEST_PLAN.md](PHASE_6_4_TEST_PLAN.md) (Plans API)  
**Prerequisites:** Deployed stack (`./deploy`); `.env` with `AWS_REGION`, `REVENUE_PLANS_TABLE_NAME` (canonical; or `REVENUE_PLANS_TABLE` for backward compat), and optionally `PLAN_LIFECYCLE_API_FUNCTION_NAME` (default `cc-native-plan-lifecycle-api`). Script exits with a clear message if required env vars are missing.

---

## Overview

Phase 6 E2E runs **post-deploy** scripts that seed data into DynamoDB, invoke the **deployed** Plan Lifecycle API Lambda, and verify responses and cleanup. The pattern matches Phase 4 and Phase 5 E2E: seed → invoke (Lambda) → verify → cleanup.

**Scope (current):**
- **Conflict resolution:** Seed two plans (one ACTIVE, one PAUSED) for the same (tenant_id, account_id, plan_type); invoke POST `/plans/:planId/resume` for the PAUSED plan; assert **409 Conflict**, `body.error === 'Conflict'`, and CONFLICT_ACTIVE_PLAN in reasons; **assert Plan B remained PAUSED** (re-read from DynamoDB); **if PLAN_LEDGER_TABLE_NAME is set**, assert Plan Ledger contains `PLAN_ACTIVATION_REJECTED` (caller `resume`, `conflicting_plan_ids` contains Plan A); cleanup both plans.
- **Plans API happy path:** Seed one PAUSED plan; GET /plans (list), GET /plans/:planId, POST resume → 200; assert plan becomes ACTIVE; cleanup.
- **Orchestrator cycle:** Seed one tenant and one APPROVED plan; invoke plan-orchestrator Lambda (scheduled event); assert plan becomes ACTIVE; cleanup tenant and plan.

---

## Implementation Status

| Item | Status | Notes |
|------|--------|--------|
| **seed-phase6-conflict-e2e.sh** | ✅ Implemented | Puts two plans into RevenuePlans (ACTIVE + PAUSED, same tenant/account/plan_type). Outputs PLAN_ACTIVE_ID, PLAN_PAUSED_ID, TENANT_ID, ACCOUNT_ID, PK. |
| **test-phase6-conflict-resolution.sh** | ✅ Implemented | Seed → invoke Plan Lifecycle Lambda (POST resume) → assert 409, body.error Conflict, CONFLICT_ACTIVE_PLAN → assert Plan B still PAUSED (DynamoDB read) → if PLAN_LEDGER_TABLE_NAME set, assert PLAN_ACTIVATION_REJECTED (caller resume, conflicting_plan_ids) → cleanup. Fail-fast if AWS_REGION or REVENUE_PLANS_TABLE_NAME missing. |
| **seed-phase6-plans-happy-e2e.sh** | ✅ Implemented | Puts one PAUSED plan into RevenuePlans. Outputs PLAN_ID, TENANT_ID, ACCOUNT_ID, PK. |
| **test-phase6-plans-api-happy.sh** | ✅ Implemented | Seed → GET /plans, GET /plans/:id, POST resume → 200 → assert plan ACTIVE (DynamoDB) → cleanup. |
| **seed-phase6-orchestrator-e2e.sh** | ✅ Implemented | Puts one tenant into Tenants and one APPROVED plan into RevenuePlans. Outputs PLAN_ID, TENANT_ID, ACCOUNT_ID, PK. |
| **test-phase6-orchestrator-cycle.sh** | ✅ Implemented | Seed → invoke plan-orchestrator Lambda (scheduled event) → assert plan ACTIVE (DynamoDB) → cleanup tenant and plan. |
| **run-phase6-e2e.sh** | ✅ Implemented | Runs Phase 6 E2E suite: conflict resolution, Plans API happy path, orchestrator cycle. |
| **Run in deploy** | ✅ Yes | `./deploy` runs Phase 6 E2E after Phase 5 E2E unless `--skip-phase6-e2e`. |

---

## How to Run

**Prerequisites:** Run `./deploy` once so `.env` has `AWS_REGION`, `REVENUE_PLANS_TABLE_NAME`, and (optionally) `PLAN_LIFECYCLE_API_FUNCTION_NAME`. Default Lambda name is `cc-native-plan-lifecycle-api`.

**Run E2E suite (standalone):**
```bash
./scripts/phase_6/run-phase6-e2e.sh
```

**Run a single scenario:**
```bash
./scripts/phase_6/test-phase6-conflict-resolution.sh
./scripts/phase_6/test-phase6-plans-api-happy.sh
./scripts/phase_6/test-phase6-orchestrator-cycle.sh
```

**Run as part of deploy (default):**
```bash
./deploy
```

**Deploy without Phase 6 E2E:**
```bash
./deploy --skip-phase6-e2e
```

**Skip all tests (including Phase 6 E2E):**
```bash
./deploy --skip-tests
# or
./deploy --no-test
```

---

## E2E Flow — Conflict Resolution

1. **Seed** — Create two plans in RevenuePlans via `scripts/phase_6/seed-phase6-conflict-e2e.sh`:
   - Plan A: ACTIVE, (tenant_id, account_id, plan_type)
   - Plan B: PAUSED, same (tenant_id, account_id, plan_type)
   - Unique IDs: `e2e-p6-active-{ts}`, `e2e-p6-paused-{ts}`

2. **Invoke** — Call the Plan Lifecycle API Lambda with an API Gateway–shaped payload:
   - `POST /plans/:planId/resume`, `pathParameters.planId` = Plan B (PAUSED), `queryStringParameters.account_id`, `requestContext.authorizer.claims['custom:tenant_id']`

3. **Verify** — Assert Lambda response:
   - `statusCode === 409`
   - `body.error === 'Conflict'`
   - `body.reasons` includes one reason with `code === 'CONFLICT_ACTIVE_PLAN'`
   - **3b. No transition:** Re-read Plan B from RevenuePlans (pk/sk); assert `plan_status === 'PAUSED'`.
   - **3c. Ledger (when PLAN_LEDGER_TABLE_NAME set):** Query Plan Ledger for Plan B (pk = `PLAN#` + Plan B plan_id, begins_with sk `EVENT#`); assert at least one event with `event_type === 'PLAN_ACTIVATION_REJECTED'`, `caller === 'resume'`, `conflicting_plan_ids` contains Plan A. If ledger table name is not set, skip this assertion.

4. **Cleanup** — Delete both plans from RevenuePlans (by pk/sk).

---

## Verification Checklist

| Check | How |
|-------|-----|
| **RevenuePlans table** | Seed script writes two items (ACTIVE, PAUSED) with correct pk/sk and GSI attributes. |
| **Plan Lifecycle Lambda** | Invoke with resume payload; Lambda reads REVENUE_PLANS_TABLE_NAME, PLAN_LEDGER_TABLE_NAME from env (set by CDK). |
| **Conflict lookup** | Lambda uses listActivePlansForAccountAndType; finds Plan A (ACTIVE); gate returns can_activate false. |
| **409 response** | Lambda returns statusCode 409, body.error 'Conflict', reasons CONFLICT_ACTIVE_PLAN. |
| **No transition** | E2E re-reads Plan B from DynamoDB and asserts `plan_status === 'PAUSED'`. |
| **Ledger (baseline when table present)** | If `PLAN_LEDGER_TABLE_NAME` is set (CDK sets it), E2E queries ledger for Plan B and asserts an event `event_type === 'PLAN_ACTIVATION_REJECTED'`, `caller === 'resume'`, `conflicting_plan_ids` contains Plan A. If table name not set, assertion skipped. |
| **Cleanup** | Both plans removed from RevenuePlans after verify. |
| **Required env** | Script exits with clear message if `AWS_REGION` or `REVENUE_PLANS_TABLE_NAME` (or `REVENUE_PLANS_TABLE`) are missing. |

---

## Environment Variables

| Variable | Required | Default | Notes |
|----------|----------|---------|--------|
| `AWS_REGION` | Yes | — | Deployed region. |
| `REVENUE_PLANS_TABLE_NAME` | Yes | — | Canonical; from deploy .env (stack output). |
| `REVENUE_PLANS_TABLE` | No | — | Backward-compat alternative to REVENUE_PLANS_TABLE_NAME. |
| `PLAN_LEDGER_TABLE_NAME` | No | — | When set (CDK output), E2E asserts PLAN_ACTIVATION_REJECTED ledger event; when unset, ledger assertion skipped. |
| `PLAN_LIFECYCLE_API_FUNCTION_NAME` | No | `cc-native-plan-lifecycle-api` | Plan Lifecycle API Lambda name. |
| `TENANTS_TABLE_NAME` | No | — | For orchestrator E2E; from deploy .env. |
| `TENANTS_TABLE` | No | `cc-native-tenants` | Backward-compat. |
| `PLAN_ORCHESTRATOR_FUNCTION_NAME` | No | `cc-native-plan-orchestrator` | Plan orchestrator Lambda name (orchestrator E2E). |
| `TENANT_ID` | No | `e2e-p6-tenant` | Seed tenant_id. |
| `ACCOUNT_ID` | No | `e2e-p6-account` | Seed account_id. |

---

## E2E Flow — Plans API Happy Path

1. **Seed** — One PAUSED plan via `seed-phase6-plans-happy-e2e.sh`.
2. **Invoke** — GET /plans (list), GET /plans/:planId, POST /plans/:planId/resume (Plan Lifecycle Lambda).
3. **Verify** — statusCode 200 for list, get, resume; plan_status ACTIVE after resume (DynamoDB read).
4. **Cleanup** — Delete plan from RevenuePlans.

## E2E Flow — Orchestrator Cycle

1. **Seed** — One tenant in Tenants, one APPROVED plan in RevenuePlans via `seed-phase6-orchestrator-e2e.sh`.
2. **Invoke** — plan-orchestrator Lambda with scheduled-event payload (EventBridge-shaped).
3. **Verify** — Plan plan_status ACTIVE (DynamoDB read).
4. **Cleanup** — Delete plan from RevenuePlans, delete tenant from Tenants.

See [../PHASE_6_IMPLEMENTATION_PLAN.md](../PHASE_6_IMPLEMENTATION_PLAN.md) §7 (Phase 6 complete — definition and optional hardening).

---

## References

- **Phase 6.5 code plan:** [PHASE_6_5_CODE_LEVEL_PLAN.md](../PHASE_6_5_CODE_LEVEL_PLAN.md)
- **Phase 6.5 unit + integration test plan:** [PHASE_6_5_TEST_PLAN.md](PHASE_6_5_TEST_PLAN.md)
- **Phase 4.5 E2E test plan (pattern):** [../../phase_4/testing/PHASE_4_5_E2E_TEST_PLAN.md](../../phase_4/testing/PHASE_4_5_E2E_TEST_PLAN.md)
- **Scripts:** `scripts/phase_6/run-phase6-e2e.sh`, `scripts/phase_6/test-phase6-conflict-resolution.sh`, `scripts/phase_6/seed-phase6-conflict-e2e.sh`, `scripts/phase_6/test-phase6-plans-api-happy.sh`, `scripts/phase_6/seed-phase6-plans-happy-e2e.sh`, `scripts/phase_6/test-phase6-orchestrator-cycle.sh`, `scripts/phase_6/seed-phase6-orchestrator-e2e.sh`
- **Scripts README:** `scripts/phase_6/README.md`
