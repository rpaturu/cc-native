# Phase 4.4 Integration Test Plan

**Status:** 🟢 **IMPLEMENTED**  
**Created:** 2026-01-28  
**Updated:** 2026-01-29  
**Parent:** [PHASE_4_4_TEST_PLAN.md](PHASE_4_4_TEST_PLAN.md)  
**Prerequisites:** Phase 4.1, 4.2, 4.3 complete; deploy once so `.env` has execution table names

---

## Overview

Phase 4.4 adds **signal emission**, **execution status API**, and **CloudWatch alarms**. Integration tests live under `src/tests/integration/execution/` and run against deployed (or test) AWS resources. Handler is invoked **directly** (not over HTTP); real DynamoDB tables are used. No Cognito or API Gateway required for the current suite.

**Testing philosophy:** Deploy to confirm infrastructure and API wiring; then run integration tests so Phase 4.4 behavior is regression-safe.

---

## Implementation status

| Item | Status | Notes |
|------|--------|--------|
| **execution-status-api.test.ts** | ✅ Implemented | 11 tests; handler-direct + real DynamoDB. |
| **end-to-end-execution.test.ts** | ✅ Placeholder | Skip when env missing; 3 placeholder tests for future E2E. |
| **Deploy → .env** | ✅ Fixed | Deploy writes `ACTION_INTENT_TABLE_NAME`, `EXECUTION_OUTCOMES_TABLE_NAME`, `EXECUTION_ATTEMPTS_TABLE_NAME` to `.env`. |

---

## How to run integration tests

**Prerequisites:** Deploy once (`./deploy`) so `.env` contains `EXECUTION_OUTCOMES_TABLE_NAME`, `EXECUTION_ATTEMPTS_TABLE_NAME`, and `ACTION_INTENT_TABLE_NAME`. Jest and the test file load `.env` from the project root.

**Run all integration tests:**
```bash
npm run test:integration
```

**Run Execution Status API integration tests only:**
```bash
npm test -- --testPathPattern="execution/execution-status-api"
```

**Run unit tests only (excludes integration):**
```bash
npm test
# or: npm run test:unit
```

**Run all tests (unit + integration):**
```bash
npm run test:all
```

**Post-deploy:** `./deploy` runs integration tests after writing `.env` and seeding. Use `./deploy --skip-integration-tests` to skip.

**Skip flags:**
- **Skip execution-status-api integration** (e.g. CI without AWS): set `SKIP_EXECUTION_STATUS_API_INTEGRATION=1`.
- **Skip E2E placeholder suite:** set `SKIP_E2E_EXECUTION=1`.

If required env is missing and the skip flag is not set, the suite **fails** with a clear error (not skipped). Use the skip flag when you intend to omit integration tests.

---

## Verify by deploying

Before relying on integration tests, deploy and confirm Phase 4.4 infrastructure and APIs.

### Deploy

```bash
./deploy
```

Ensure the stack completes and no resources fail.

### Post-deploy verification checklist

| Check | How to verify |
|-------|-------------------------------|
| **Stack outputs** | `ExecutionStatusApiUrl` present; note base URL for API tests. |
| **Execution Status API Lambda** | Lambda exists (e.g. `cc-native-execution-status-api`); env has `EXECUTION_OUTCOMES_TABLE_NAME`, `EXECUTION_ATTEMPTS_TABLE_NAME`, `ACTION_INTENT_TABLE_NAME`. |
| **API Gateway** | RestApi exists; resources `/executions/{action_intent_id}/status` and `/accounts/{account_id}/executions` with GET; Cognito authorizer attached. |
| **Recorder env** | Execution Recorder Lambda has `SIGNALS_TABLE_NAME`, `EVENT_BUS_NAME`. |
| **CloudWatch alarms** | Alarms for state machine (Failed, Duration, Throttled) and Lambda errors exist. |
| **S3 bucket** | Execution artifacts bucket exists; tool-invoker has write access. |

### Optional smoke checks (manual or script)

- **Execution Status API (no auth):** `GET {ExecutionStatusApiUrl}/executions/{fake_id}/status?account_id={fake}` with no JWT → **401 Unauthorized**.
- **Execution Status API (with JWT):** Valid Cognito ID token; `GET .../executions/{action_intent_id}/status?account_id=...` for non-existent id → **404 Execution not found** (not 200 with PENDING).
- **List endpoint:** With valid JWT, `GET .../accounts/{account_id}/executions?limit=10` → 200 and `{ executions: [], next_token?: ... }`.

---

## Integration test suites

### Directory and files

| File | Purpose | Status |
|------|--------|--------|
| `src/tests/integration/execution/execution-status-api.test.ts` | Execution Status API: GET status, GET list, auth, 404, pagination. Handler invoked directly; real DynamoDB. | ✅ Implemented (11 tests) |
| `src/tests/integration/execution/end-to-end-execution.test.ts` | Full execution flow: EventBridge → Step Functions → starter → … → recorder. | ✅ Placeholder (skip when env missing) |

---

### execution-status-api.test.ts (implemented)

**Scope:** Execution Status API only (GET status, GET list, auth, 404, pagination).

Events are constructed with mock authorizer claims; real DynamoDB tables are used. Env: `.env` / `.env.local`; require `EXECUTION_OUTCOMES_TABLE_NAME`, `EXECUTION_ATTEMPTS_TABLE_NAME`, `ACTION_INTENT_TABLE_NAME` (all written by `./deploy`).

**Test cases:**

1. **GET /executions/{id}/status — no auth → 401** — Request without `Authorization` (or invalid token) → 401 and error body.
2. **GET /executions/{id}/status — missing account_id → 400** — Valid JWT, path has `action_intent_id`, query missing `account_id` → 400.
3. **GET /executions/{id}/status — not found → 404** — Valid JWT, non-existent id → 404 and "Execution not found" (not 200 with PENDING).
4. **GET /executions/{id}/status — outcome wins over attempt** — Pre-seed attempt (RUNNING) and outcome (SUCCEEDED) for same id; call API → 200 and status = SUCCEEDED.
5. **GET /executions/{id}/status — only intent, not expired → PENDING** — Pre-seed only action intent (no attempt/outcome); call API → 200 and status = PENDING.
6. **GET /executions/{id}/status — only intent, expired → EXPIRED** — Pre-seed action intent with `expires_at_epoch` in the past; call API → 200 and status = EXPIRED.
7. **GET /accounts/{account_id}/executions — list and pagination** — Valid JWT; GET with `limit=2`; assert 200, `executions` array, and `next_token` when more than 2 outcomes.
8. **GET /accounts/{account_id}/executions — invalid limit → 400** — `limit=0` or `limit=101` → 400.
9. **OPTIONS — CORS** — OPTIONS request → 200 and CORS headers present.

**Skip conditions:** Suite is skipped if `SKIP_EXECUTION_STATUS_API_INTEGRATION=1` or any of the three table name env vars is missing (e.g. before first deploy).

---

### end-to-end-execution.test.ts (placeholder)

**Scope:** Full execution lifecycle from ACTION_APPROVED to outcome (and optional signal/ledger).

**Prerequisites:** Deployed stack; EventBridge rule; Step Functions state machine; DynamoDB tables; optional: Gateway + adapters for success path.

**Suggested test cases (not yet implemented):**

1. **E2E: ACTION_APPROVED → Step Functions started** — Put ACTION_APPROVED event on event bus; assert Step Functions execution started.
2. **E2E: Execution reaches RecordOutcome or RecordFailure** — For a known action_intent_id, assert outcome or failure record exists.
3. **E2E: Execution Status API reflects outcome** — After execution completes, GET status with valid JWT; assert SUCCEEDED or FAILED and response shape.
4. **Optional: Signal and ledger** — If enabled, assert ledger append and signal (ACTION_EXECUTED or ACTION_FAILED).

**Skip conditions:** If EventBridge/Step Functions or Cognito are not configured, skip (e.g. `SKIP_E2E_EXECUTION` or missing `EXECUTION_STATUS_API_URL`).

---

## References

- **Phase 4.4 test plan (unit):** [PHASE_4_4_TEST_PLAN.md](PHASE_4_4_TEST_PLAN.md)
- **Phase 4.4 code plan:** `docs/implementation/phase_4/PHASE_4_4_CODE_LEVEL_PLAN.md`
- **Integration test setup:** `docs/testing/INTEGRATION_TEST_SETUP.md`
