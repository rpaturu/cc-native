# Phase 7 E2E Test Plan

**Status:** 🟢 **COMPLETE** — Plan Ledger, Validator run, Budget reserve, and Outcomes capture E2E implemented and passing. Deploy writes OUTCOMES_TABLE_NAME to .env (from ExecutionOutcomesTableName); Outcomes E2E requires it and verifies table exists (no skip).  
**Created:** 2026-01-31  
**Last Updated:** 2026-01-31  
**Parent:** [PHASE_7_IMPLEMENTATION_PLAN.md](../PHASE_7_IMPLEMENTATION_PLAN.md), [PHASE_7_CODE_LEVEL_PLAN.md](../PHASE_7_CODE_LEVEL_PLAN.md)  
**Satisfies:** Phase 7 E2E (post-deploy): Plan Ledger and governance paths against deployed Lambda + DynamoDB.  
**Related:** [PHASE_7_1_TEST_PLAN.md](PHASE_7_1_TEST_PLAN.md) (validators), [PHASE_7_2_TEST_PLAN.md](PHASE_7_2_TEST_PLAN.md) (budgets), [PHASE_7_4_TEST_PLAN.md](PHASE_7_4_TEST_PLAN.md) (outcomes)  
**Prerequisites:** Deployed stack (`./deploy`); `.env` with `AWS_REGION`, `REVENUE_PLANS_TABLE_NAME` (canonical; or `REVENUE_PLANS_TABLE` for backward compat), and optionally `PLAN_LIFECYCLE_API_FUNCTION_NAME` (default `cc-native-plan-lifecycle-api`). Scripts exit with a clear message if required env vars are missing.

---

## Overview

Phase 7 E2E runs **post-deploy** scripts that seed data into DynamoDB, invoke the **deployed** Plan Lifecycle API Lambda (and, when added, other governance paths), and verify responses and cleanup. The pattern matches Phase 4, Phase 5, and Phase 6 E2E: seed → invoke (Lambda) → verify → cleanup.

**Scope (current):**
- **Plan Ledger (resume → ledger entries):** Seed one PAUSED plan; POST `/plans/:planId/resume` → 200; GET `/plans/:planId/ledger` → 200; assert at least one ledger entry with `event_type` (e.g. `PLAN_RESUMED`); cleanup plan.

**Scope (implemented):**
- **Validator run:** Seed one PAUSED plan; POST resume (plan-lifecycle invokes ValidatorGateway); GET ledger; assert `VALIDATOR_RUN` or `VALIDATOR_RUN_SUMMARY`; cleanup.
- **Budget reserve:** Seed one plan; invoke Phase 7 governance E2E Lambda (action=budget_reserve); GET ledger; assert `BUDGET_RESERVE`; cleanup.
- **Outcomes capture:** Requires `OUTCOMES_TABLE_NAME` (from deploy .env). Verifies Outcomes table exists via DynamoDB describe-table; does not skip.

---

## Implementation Status

| Item | Status | Notes |
|------|--------|--------|
| **seed-phase7-ledger-e2e.sh** | ✅ Implemented | Writes one PAUSED plan to RevenuePlans (e2e-p7-ledger-*). Outputs PLAN_ID, TENANT_ID, ACCOUNT_ID, PK. |
| **test-phase7-plan-ledger.sh** | ✅ Implemented | Seed → POST /plans/:planId/resume → 200 → GET /plans/:planId/ledger → assert entries count ≥ 1 and event_type present → cleanup. Fail-fast if AWS_REGION or REVENUE_PLANS_TABLE_NAME missing. |
| **run-phase7-e2e.sh** | ✅ Implemented | Runs Phase 7 E2E suite: Plan Ledger, Validator run, Budget reserve, Outcomes capture. |
| **Run in deploy** | ✅ Yes | `./deploy` runs Phase 7 E2E after Phase 6 E2E unless `--skip-phase7-e2e`. |
| **test-phase7-validator-run.sh** | ✅ Implemented | Seed → POST resume → GET ledger → assert VALIDATOR_RUN or VALIDATOR_RUN_SUMMARY → cleanup. ValidatorGateway integrated in plan-lifecycle handleResume. |
| **test-phase7-budget-reserve.sh** | ✅ Implemented | Seed plan → invoke Phase 7 governance E2E Lambda (action=budget_reserve) → GET ledger → assert BUDGET_RESERVE → cleanup. |
| **test-phase7-outcomes-capture.sh** | ✅ Implemented | Requires OUTCOMES_TABLE_NAME (deploy writes to .env); verifies Outcomes table exists; no skip. |
| **phase7-governance-e2e-handler** (Lambda) | ✅ Implemented | Invoked with action=budget_reserve; writes BUDGET_RESERVE to Plan Ledger. |

---

## How to Run

**Prerequisites:** Run `./deploy` once so `.env` has `AWS_REGION`, `REVENUE_PLANS_TABLE_NAME`, and (optionally) `PLAN_LIFECYCLE_API_FUNCTION_NAME`. Default Lambda name is `cc-native-plan-lifecycle-api`.

**Run E2E suite (standalone):**
```bash
./scripts/phase_7/run-phase7-e2e.sh
```

**Run a single scenario:**
```bash
./scripts/phase_7/test-phase7-plan-ledger.sh
./scripts/phase_7/test-phase7-validator-run.sh
./scripts/phase_7/test-phase7-budget-reserve.sh
./scripts/phase_7/test-phase7-outcomes-capture.sh
```

**Run as part of deploy (default):**
```bash
./deploy
```

**Deploy without Phase 7 E2E:**
```bash
./deploy --skip-phase7-e2e
```

**Skip all tests (including Phase 7 E2E):**
```bash
./deploy --skip-tests
# or
./deploy --no-test
```

---

## E2E Flow — Plan Ledger (resume → ledger entries)

1. **Seed** — Create one plan in RevenuePlans via `scripts/phase_7/seed-phase7-ledger-e2e.sh`:
   - One PAUSED plan for (tenant_id, account_id, plan_type); no other ACTIVE for same account/type.
   - Unique ID: `e2e-p7-ledger-{ts}`

2. **Invoke** — Call the Plan Lifecycle API Lambda:
   - **2a.** `POST /plans/:planId/resume` with pathParameters.planId, queryStringParameters.account_id, requestContext.authorizer.claims['custom:tenant_id'].
   - **2b.** `GET /plans/:planId/ledger` with same planId, account_id, tenant_id.

3. **Verify** — Assert:
   - POST resume response `statusCode === 200`.
   - GET ledger response `statusCode === 200`.
   - Response body has `entries` array with length ≥ 1.
   - At least one entry has `event_type` (e.g. `PLAN_RESUMED`).

4. **Cleanup** — Delete the plan from RevenuePlans (by pk/sk).

---

## Verification Checklist

| Check | How |
|-------|-----|
| **RevenuePlans table** | Seed script writes one PAUSED item with correct pk/sk and GSI attributes. |
| **Plan Lifecycle Lambda** | Invoke with resume payload; Lambda uses REVENUE_PLANS_TABLE_NAME, PLAN_LEDGER_TABLE_NAME from env (set by CDK). |
| **Resume success** | Lambda returns statusCode 200 for POST resume. |
| **Ledger API** | GET /plans/:planId/ledger returns 200 with body.entries array. |
| **Ledger content** | At least one entry with event_type (e.g. PLAN_RESUMED). |
| **Cleanup** | Plan removed from RevenuePlans after verify. |
| **Required env** | Script exits with clear message if `AWS_REGION` or `REVENUE_PLANS_TABLE_NAME` (or `REVENUE_PLANS_TABLE`) are missing. |

---

## Environment Variables

| Variable | Required | Default | Notes |
|----------|----------|---------|--------|
| `AWS_REGION` | Yes | — | Deployed region. |
| `REVENUE_PLANS_TABLE_NAME` | Yes | — | Canonical; from deploy .env (stack output). |
| `REVENUE_PLANS_TABLE` | No | — | Backward-compat alternative to REVENUE_PLANS_TABLE_NAME. |
| `PLAN_LIFECYCLE_API_FUNCTION_NAME` | No | `cc-native-plan-lifecycle-api` | Plan Lifecycle API Lambda name. |
| `PHASE7_GOVERNANCE_E2E_FUNCTION_NAME` | No | `cc-native-phase7-governance-e2e` | Phase 7 governance E2E Lambda (budget_reserve). |
| `PLAN_LEDGER_TABLE_NAME` | No | — | Used by Lambda for ledger writes/reads; E2E does not need to set for current Plan Ledger test (Lambda reads from env). |
| `OUTCOMES_TABLE_NAME` | Yes (Outcomes E2E) | — | Set by deploy from ExecutionOutcomesTableName. Outcomes capture E2E requires it and verifies table exists. |

---

## E2E Flow — Validator run (7.1)

1. **Seed** — One PAUSED plan via `seed-phase7-ledger-e2e.sh` (same as Plan Ledger).
2. **Invoke** — POST /plans/:planId/resume (plan-lifecycle runs ValidatorGateway before transition).
3. **Verify** — GET /plans/:planId/ledger; assert at least one entry with `event_type === 'VALIDATOR_RUN'` or `VALIDATOR_RUN_SUMMARY`.
4. **Cleanup** — Delete plan from RevenuePlans.

## E2E Flow — Budget reserve (7.2)

1. **Seed** — One PAUSED plan via `seed-phase7-ledger-e2e.sh` (for plan_id, tenant_id, account_id).
2. **Invoke** — Phase 7 governance E2E Lambda with payload `{ action: 'budget_reserve', plan_id, tenant_id, account_id }`.
3. **Verify** — GET /plans/:planId/ledger; assert at least one entry with `event_type === 'BUDGET_RESERVE'`.
4. **Cleanup** — Delete plan from RevenuePlans.

## E2E Flow — Outcomes capture (7.4)

1. **Require OUTCOMES_TABLE_NAME** — Script fails (exit 1) if not set; deploy populates it from stack output ExecutionOutcomesTableName.
2. **Verify table** — `aws dynamodb describe-table --table-name "$OUTCOMES_TABLE_NAME"` to ensure table exists and is accessible.
3. **No skip** — Test runs as part of Phase 7 E2E suite after deploy.

---

## References

- **Phase 7 code plan:** [PHASE_7_CODE_LEVEL_PLAN.md](../PHASE_7_CODE_LEVEL_PLAN.md)
- **Phase 7.1–7.4 unit/integration test plans:** [PHASE_7_1_TEST_PLAN.md](PHASE_7_1_TEST_PLAN.md), [PHASE_7_2_TEST_PLAN.md](PHASE_7_2_TEST_PLAN.md), [PHASE_7_3_TEST_PLAN.md](PHASE_7_3_TEST_PLAN.md), [PHASE_7_4_TEST_PLAN.md](PHASE_7_4_TEST_PLAN.md)
- **Phase 6 E2E test plan (pattern):** [../../phase_6/testing/PHASE_6_E2E_TEST_PLAN.md](../../phase_6/testing/PHASE_6_E2E_TEST_PLAN.md)
- **Scripts:** `scripts/phase_7/run-phase7-e2e.sh`, `scripts/phase_7/test-phase7-plan-ledger.sh`, `scripts/phase_7/test-phase7-validator-run.sh`, `scripts/phase_7/test-phase7-budget-reserve.sh`, `scripts/phase_7/test-phase7-outcomes-capture.sh`, `scripts/phase_7/seed-phase7-ledger-e2e.sh`
- **Scripts README:** `scripts/phase_7/README.md`
