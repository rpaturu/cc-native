# Phase 4.4 Test Plan — Safety & Outcomes

**Status:** 🟢 **IMPLEMENTED**  
**Created:** 2026-01-28  
**Updated:** 2026-01-29  
**Parent Document:** `PHASE_4_4_CODE_LEVEL_PLAN.md`  
**Prerequisites:** Phase 4.1, 4.2, 4.3 complete; unit tests for Phase 4.4 handlers (optional, see PHASE_4_TEST_COVERAGE.md)

---

## Executive Summary

Phase 4.4 adds **signal emission**, **execution status API**, and **CloudWatch alarms**. This plan recommends **verifying by deploying first**, then implementing **integration tests** in `src/tests/integration/execution/`.

**Testing philosophy:**
> Deploy to confirm infrastructure and API wiring; then add integration tests against the deployed (or test) stack so Phase 4.4 behavior is regression‑safe.

---

## Implementation Status (2026-01-29)

| Item | Status | Notes |
|------|--------|--------|
| **execution-status-api.test.ts** | ✅ Implemented | 11 tests; invokes handler directly with real DynamoDB (no HTTP/Cognito). |
| **end-to-end-execution.test.ts** | ✅ Placeholder | Skip when env missing; 3 placeholder tests for future E2E. |
| **Deploy → .env** | ✅ Fixed | Deploy script writes `ACTION_INTENT_TABLE_NAME` to `.env`; required for execution-status-api tests to run. |
| **How to run** | See below | Run from project root after deploy; `.env` must have the three execution table names. |

### How to Run Phase 4.4 Integration Tests

**Prerequisites:** Deploy once (`./deploy`) so `.env` contains `EXECUTION_OUTCOMES_TABLE_NAME`, `EXECUTION_ATTEMPTS_TABLE_NAME`, and `ACTION_INTENT_TABLE_NAME`. Jest setup and the test file load `.env` from the project root.

**Run all integration tests** (recommended; runs post-deploy automatically):
```bash
npm run test:integration
```

**Run Execution Status API integration tests only:**
```bash
npm test -- --testPathPattern="execution/execution-status-api"
```

**Run unit tests only** (default; excludes integration):
```bash
npm test
# or: npm run test:unit
```

**Run all tests** (unit + integration):
```bash
npm run test:all
```

**Post-deploy:** `./deploy` runs integration tests after writing `.env` and seeding. Use `./deploy --skip-integration-tests` to skip.

**Skip execution-status-api integration tests** (e.g. in CI without AWS): set `SKIP_EXECUTION_STATUS_API_INTEGRATION=1`.  
**Skip E2E placeholder suite:** set `SKIP_E2E_EXECUTION=1`.  

If required env is missing and the skip flag is not set, the suite **fails** with a clear error (not skipped). Use the skip flag when you intend to omit integration tests.

---

## 1. Verify by Deploying

Before writing integration tests, deploy and confirm that Phase 4.4 infrastructure and APIs work.

### 1.1 Deploy

```bash
./deploy
```

Use the project’s standard deploy (build + deploy). Ensure the stack completes and no resources fail.

### 1.2 Post-Deploy Verification Checklist

| Check | How to verify |
|-------|-------------------------------|
| **Stack outputs** | `ExecutionStatusApiUrl` present; note the base URL for API tests. |
| **Execution Status API Lambda** | Lambda exists (e.g. `cc-native-execution-status-api` or name from config); env has `EXECUTION_OUTCOMES_TABLE_NAME`, `EXECUTION_ATTEMPTS_TABLE_NAME`, `ACTION_INTENT_TABLE_NAME`. |
| **API Gateway** | RestApi `cc-native-execution-status-api` exists; resources `/executions/{action_intent_id}/status` and `/accounts/{account_id}/executions` with GET methods; Cognito authorizer attached. |
| **Recorder env** | Execution Recorder Lambda has `SIGNALS_TABLE_NAME`, `EVENT_BUS_NAME`; no S3 env (correct — tool-invoker uses S3). |
| **CloudWatch alarms** | Alarms for state machine (Failed, Duration, Throttled) and Lambda errors (tool-invoker, execution-recorder, execution-failure-recorder) exist. |
| **S3 bucket** | Execution artifacts bucket exists (stack or `ExecutionArtifactsBucket`); tool-invoker has write access. |

### 1.3 Optional Smoke Checks (Manual or Script)

- **Execution Status API (no auth):**  
  `GET {ExecutionStatusApiUrl}/executions/{fake_id}/status?account_id={fake}` with no JWT → **401 Unauthorized**.
- **Execution Status API (with JWT):**  
  Use a valid Cognito ID token; call `GET .../executions/{action_intent_id}/status?account_id=...` for a non-existent id → **404 Execution not found** (not 200 with PENDING).
- **List endpoint:**  
  With valid JWT, `GET .../accounts/{account_id}/executions?limit=10` → 200 and `{ executions: [], next_token?: ... }`.

After these checks pass, proceed to implement the integration test suite below.

---

## 2. Integration Tests Plan

Integration tests live under **`src/tests/integration/execution/`** and run against **deployed** (or test) AWS resources. Reuse the same IAM and env setup as other integration tests (see `docs/testing/INTEGRATION_TEST_SETUP.md`).

### 2.1 Directory and Files

| File | Purpose | Status |
|------|--------|--------|
| `src/tests/integration/execution/execution-status-api.test.ts` | Execution Status API: GET status, GET list, auth, 404, pagination. Invokes handler directly with real DynamoDB. | ✅ Implemented (11 tests) |
| `src/tests/integration/execution/end-to-end-execution.test.ts` | Full execution flow: EventBridge → Step Functions → starter → … → recorder. | ✅ Placeholder (skip when env missing) |

Directory: `src/tests/integration/execution/` (created).

### 2.2 Test File 1: `end-to-end-execution.test.ts`

**Scope:** Full execution lifecycle from ACTION_APPROVED to outcome (and optional signal/ledger).

**Prerequisites:** Deployed stack; EventBridge rule; Step Functions state machine; DynamoDB tables (attempts, outcomes, action intents, etc.); optional: Gateway + adapters for success path.

**Test cases (suggested):**

1. **E2E: ACTION_APPROVED → Step Functions started**  
   Put ACTION_APPROVED event on event bus; assert Step Functions execution started (by listing executions or polling execution ARN).

2. **E2E: Execution reaches RecordOutcome or RecordFailure**  
   For a known action_intent_id (pre-seeded or from a real run), assert outcome or failure record exists in ExecutionOutcomesTable (or attempt status updated).

3. **E2E: Execution Status API reflects outcome**  
   After an execution completes, call GET `/executions/{action_intent_id}/status?account_id=...` with valid JWT; assert status is SUCCEEDED or FAILED and response shape matches `ExecutionStatus`.

4. **Optional: Signal and ledger**  
   If signal/ledger are enabled, assert one ledger append and one signal row (or event) for the execution outcome (ACTION_EXECUTED or ACTION_FAILED).

**Data / auth:** Use test tenant and account; obtain Cognito ID token for API calls. Pre-seed action intents and registry if needed for a deterministic path.

**Skip conditions:** If EventBridge/Step Functions or Cognito are not configured in the test env, skip with a clear message (e.g. `process.env.SKIP_E2E_EXECUTION` or missing `EXECUTION_STATUS_API_URL`).

---

### 2.3 Test File 2: `execution-status-api.test.ts` ✅ IMPLEMENTED

**Scope:** Execution Status API only (GET status, GET list, auth, 404, pagination).

**Implementation:** Handler is invoked **directly** (not over HTTP). Events are constructed with mock authorizer claims; real DynamoDB tables are used. No Cognito or API Gateway required for these tests. Env: load `.env` / `.env.local`; require `EXECUTION_OUTCOMES_TABLE_NAME`, `EXECUTION_ATTEMPTS_TABLE_NAME`, `ACTION_INTENT_TABLE_NAME` (all written by `./deploy`).

**Test cases (implemented):**

1. **GET /executions/{id}/status — no auth → 401**  
   Request without `Authorization` (or invalid token) → 401 and error body.

2. **GET /executions/{id}/status — missing account_id → 400**  
   Valid JWT, path has `action_intent_id`, query missing `account_id` → 400.

3. **GET /executions/{id}/status — not found → 404**  
   Valid JWT, non-existent `action_intent_id` and `account_id` → 404 and "Execution not found" (not 200 with PENDING).

4. **GET /executions/{id}/status — outcome wins over attempt**  
   Pre-seed attempt (RUNNING) and outcome (SUCCEEDED) for same id; call API → 200 and status = SUCCEEDED.

5. **GET /executions/{id}/status — only intent, not expired → PENDING**  
   Pre-seed only action intent (no attempt/outcome); call API → 200 and status = PENDING.

6. **GET /executions/{id}/status — only intent, expired → EXPIRED**  
   Pre-seed action intent with `expires_at_epoch` in the past; call API → 200 and status = EXPIRED.

7. **GET /accounts/{account_id}/executions — list and pagination**  
   Valid JWT; GET with `limit=2`; assert 200, `executions` array, and `next_token` when there are more than 2 outcomes.

8. **GET /accounts/{account_id}/executions — invalid limit → 400**  
   `limit=0` or `limit=101` → 400.

9. **OPTIONS — CORS**  
   OPTIONS request → 200 and CORS headers present.

**Data / auth:** Tests use synthetic tenant/account IDs and inject `requestContext.authorizer.claims` into the event; no Cognito token needed. Data is seeded via DynamoDB PutCommand / ExecutionOutcomeService where required.

**Skip conditions:** Suite is skipped if `SKIP_EXECUTION_STATUS_API_INTEGRATION=1` or any of `EXECUTION_OUTCOMES_TABLE_NAME`, `EXECUTION_ATTEMPTS_TABLE_NAME`, `ACTION_INTENT_TABLE_NAME` is missing (e.g. before first deploy).

---

## 3. Implementation Order ✅ Done

1. ~~**Deploy** and complete §1.2–1.3~~ — Deploy writes execution table names to `.env`.
2. ~~**Create** `src/tests/integration/execution/` and add `execution-status-api.test.ts`~~ — Implemented (handler-direct, 11 tests).
3. ~~**Add** `end-to-end-execution.test.ts`~~ — Placeholder added; skip when env missing.
4. **Run** integration tests: `npm test` or `npm test -- --testPathPattern="execution/execution-status-api"`; IAM and env per `docs/testing/INTEGRATION_TEST_SETUP.md`.

---

## 4. References

- **Phase 4.4 code plan:** `docs/implementation/phase_4/PHASE_4_4_CODE_LEVEL_PLAN.md`
- **Integration test setup:** `docs/testing/INTEGRATION_TEST_SETUP.md`
- **Phase 4 test coverage:** `docs/implementation/phase_4/testing/PHASE_4_TEST_COVERAGE.md`
- **Phase 4.2 / 4.3 test plans:** `PHASE_4_2_TEST_PLAN.md`, `PHASE_4_3_TEST_PLAN.md` (same folder)
