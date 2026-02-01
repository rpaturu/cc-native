# Phase 5 E2E Test Plan

**Status:** 🟢 **COMPLETE**  
**Created:** 2026-01-30  
**Last Updated:** 2026-01-30  
**Parent:** [PHASE_5_IMPLEMENTATION_PLAN.md](../PHASE_5_IMPLEMENTATION_PLAN.md), Phase 5 code-level plans  
**Satisfies:** Phase 5 E2E (post-deploy): auto-exec, fallback, decision-scheduler, audit export against deployed Lambda + DynamoDB + Control Center API.  
**Related:** [scripts/phase_5/README.md](../../../scripts/phase_5/README.md)  
**Prerequisites:** Deployed stack (`./deploy`); `.env` with required vars per test (see below).  
**Based on scripts:** `scripts/phase_5/run-phase5-e2e.sh`, `test-phase5-autoexec.sh`, `test-phase5-fallback.sh`, `test-phase5-decision-scheduler.sh`, `test-phase5-audit-export.sh`, and seed scripts.

---

## Overview

Phase 5 E2E runs **post-deploy** scripts that exercise autonomy (auto-approval gate, budget fallback), decision scheduling idempotency, and Control Center audit export. The suite runs four tests in order; deploy runs the suite after Phase 4 E2E unless `--skip-phase5-e2e`.

**Scope:**
- **Auto-exec:** Intent + autonomy config (allowlist, mode, budget) → invoke auto-approval gate → expect AUTO_EXECUTED → Phase 4 execution → outcome has `approval_source=POLICY`, `auto_executed=true`.
- **Fallback:** Intent + autonomy config with budget exhausted → invoke gate → expect REQUIRE_APPROVAL (BUDGET_EXCEEDED) → no execution attempt.
- **Decision scheduler:** Same RUN_DECISION trigger twice (same idempotency_key) → second invoke returns early (SKIP as DUPLICATE); idempotency store has one reservation.
- **Audit export:** POST /autonomy/audit/exports → poll GET …/audit/exports/:id until COMPLETED → verify presigned download and CSV. Skipped if AUTONOMY_ADMIN_API_URL or CONTROL_CENTER_AUTH_HEADER unset.

---

## Implementation status

| Item | Status | Notes |
|------|--------|--------|
| **run-phase5-e2e.sh** | ✅ Implemented | Runs auto-exec → fallback → decision-scheduler → audit-export in order; exit on first failure. |
| **test-phase5-autoexec.sh** | ✅ Implemented | Seed (seed-phase5-autoexec.sh) → invoke gate → wait for attempt/outcome → verify outcome approval_source=POLICY, auto_executed=true → cleanup. |
| **test-phase5-fallback.sh** | ✅ Implemented | Seed (seed-phase5-fallback.sh, budget exhausted) → invoke gate → expect REQUIRE_APPROVAL → verify no attempt → cleanup. |
| **test-phase5-decision-scheduler.sh** | ✅ Implemented | Two invokes of decision-cost-gate with same idempotency_key → verify idempotency store has key → cleanup key. |
| **test-phase5-audit-export.sh** | ✅ Implemented | POST audit export → poll GET until COMPLETED → verify presigned download and CSV; exits 0 (skip) if URL/auth unset. |
| **seed-phase5-autoexec.sh** | ✅ Implemented | Action intent + allowlist + mode AUTO_EXECUTE + budget config (max_autonomous_per_day=1); clears today’s budget state. Outputs ACTION_INTENT_ID. |
| **seed-phase5-fallback.sh** | ✅ Implemented | Action intent + allowlist + mode + budget config max_autonomous_per_day=0. Outputs ACTION_INTENT_ID. |
| **Run in deploy** | ✅ Yes | `./deploy` runs Phase 5 E2E after Phase 4 E2E unless `--skip-phase5-e2e`. |

---

## How to run

**Prerequisites:** Run `./deploy` once so `.env` has the required vars for each test (see Required env below). For audit export, set `AUTONOMY_ADMIN_API_URL` and `CONTROL_CENTER_AUTH_HEADER` (e.g. JWT from deploy when COGNITO_TEST_USER/COGNITO_TEST_PASSWORD are in .env.local).

**Run full Phase 5 E2E suite (standalone):**
```bash
./scripts/phase_5/run-phase5-e2e.sh
```

**Run individual tests:**
```bash
./scripts/phase_5/test-phase5-autoexec.sh
./scripts/phase_5/test-phase5-fallback.sh
./scripts/phase_5/test-phase5-decision-scheduler.sh
./scripts/phase_5/test-phase5-audit-export.sh
```

**Run as part of deploy (default):**
```bash
./deploy
```

**Deploy without Phase 5 E2E:**
```bash
./deploy --skip-phase5-e2e
```

**Skip all tests (including Phase 5 E2E):**
```bash
./deploy --skip-tests
# or
./deploy --no-test
```

---

## E2E flow — Auto-exec (test-phase5-autoexec.sh)

1. **Seed** — If `ACTION_INTENT_ID` unset: run `seed-phase5-autoexec.sh`. It writes one action intent (CREATE_INTERNAL_TASK), allowlist (ALLOWLIST#AUTO_EXEC, action_types CREATE_INTERNAL_TASK), autonomy mode (AUTONOMY#CREATE_INTERNAL_TASK, AUTO_EXECUTE), clears today’s budget state, and budget config (BUDGET#CONFIG, max_autonomous_per_day=1). Outputs ACTION_INTENT_ID.
2. **Invoke gate** — Lambda invoke of `AUTO_APPROVAL_GATE_FUNCTION_NAME` (default cc-native-auto-approval-gate) with payload `{ action_intent_id, tenant_id, account_id }`. Assert response `result === 'AUTO_EXECUTED'`.
3. **Wait** — Poll DynamoDB ExecutionAttempt (pk/sk = TENANT#…#ACCOUNT#… / EXECUTION#{action_intent_id}) every 10s until status ≠ RUNNING (max 90s). Assert status === SUCCEEDED.
4. **Verify outcome** — Get ActionOutcome from ExecutionOutcomes table. Assert status SUCCEEDED, approval_source === POLICY, auto_executed === true.
5. **Cleanup** — Delete attempt, outcome, intent (if ACTION_INTENT_TABLE_NAME set), autonomy config rows (ALLOWLIST#AUTO_EXEC, AUTONOMY#CREATE_INTERNAL_TASK), budget config and today’s budget state.

---

## E2E flow — Fallback (test-phase5-fallback.sh)

1. **Seed** — If `ACTION_INTENT_ID` unset: run `seed-phase5-fallback.sh`. It writes one action intent, allowlist, autonomy mode AUTO_EXECUTE, and budget config with max_autonomous_per_day=0 (exhausted). Outputs ACTION_INTENT_ID.
2. **Invoke gate** — Lambda invoke of auto-approval gate with same payload shape. Assert response `result === 'REQUIRE_APPROVAL'` (reason e.g. BUDGET_EXCEEDED).
3. **Verify no attempt** — Wait 5s, then get ExecutionAttempt for the intent; assert no Item (execution must not have been started).
4. **Cleanup** — Delete intent, autonomy config (ALLOWLIST#AUTO_EXEC, AUTONOMY#CREATE_INTERNAL_TASK), budget config (BUDGET#CONFIG). No attempt/outcome to delete.

---

## E2E flow — Decision scheduler idempotency (test-phase5-decision-scheduler.sh)

1. **First invoke** — Lambda invoke of `DECISION_COST_GATE_FUNCTION_NAME` (default cc-native-decision-cost-gate) with payload `detail: { tenant_id, account_id, trigger_type: "SIGNAL_ARRIVED", idempotency_key }` (key e.g. e2e-p5-idem-$$-timestamp).
2. **Second invoke** — Same payload (same idempotency_key). Lambda returns early on duplicate; no second reservation.
3. **Verify** — Get item from IdempotencyStore (pk = IDEMPOTENCY#{idempotency_key}, sk = METADATA). Assert Item exists (one record from first invoke).
4. **Cleanup** — Delete idempotency key from IdempotencyStore.

---

## E2E flow — Audit export (test-phase5-audit-export.sh)

**Skipped** if `AUTONOMY_ADMIN_API_URL` or `CONTROL_CENTER_AUTH_HEADER` unset; script exits 0.

1. **POST export** — `POST {AUTONOMY_ADMIN_API_URL}/autonomy/audit/exports` with Authorization header and body `{ from, to, format: "csv" }` (e.g. last 7 days). Assert HTTP 200 or 202; parse `export_id` from response.
2. **Poll status** — `GET {AUTONOMY_ADMIN_API_URL}/autonomy/audit/exports/{export_id}` every 5s until status === COMPLETED (max 120s). On FAILED, exit 1. On COMPLETED, capture `presigned_url`.
3. **Verify download** — GET presigned_url; assert HTTP 200, save to /tmp/p5-audit-export.csv; assert file exists and has header (line count ≥ 1).

---

## Required env (from scripts)

E2E and seed scripts use **`.env` only** (populated by deploy). `.env.local` is for deploy inputs (e.g. COGNITO_TEST_USER, COGNITO_TEST_PASSWORD for JWT).

| Variable | Auto-exec | Fallback | Decision scheduler | Audit export |
|----------|-----------|----------|--------------------|--------------|
| AWS_REGION | Yes | Yes | Yes | — |
| TENANT_ID, ACCOUNT_ID | Optional (defaults test-tenant-1, test-account-1) | Optional | Optional | TENANT_ID optional |
| ACTION_INTENT_TABLE_NAME | Yes | Yes | — | — |
| AUTONOMY_CONFIG_TABLE_NAME | Yes | Yes | — | — |
| AUTONOMY_BUDGET_STATE_TABLE_NAME | Yes | Yes | — | — |
| EVENT_BUS_NAME | Yes | — | — | — |
| EXECUTION_ATTEMPTS_TABLE_NAME | Yes | Yes | — | — |
| EXECUTION_OUTCOMES_TABLE_NAME | Yes | — | — | — |
| AUTO_APPROVAL_GATE_FUNCTION_NAME | Optional (default cc-native-auto-approval-gate) | Optional | — | — |
| IDEMPOTENCY_STORE_TABLE_NAME | — | — | Yes | — |
| DECISION_COST_GATE_FUNCTION_NAME | — | — | Optional (default cc-native-decision-cost-gate) | — |
| AUTONOMY_ADMIN_API_URL | — | — | — | Yes (or skip) |
| CONTROL_CENTER_AUTH_HEADER | — | — | — | Yes (or skip) |

---

## Verification checklist

| Test | Key assertions |
|------|----------------|
| **Auto-exec** | Gate returns AUTO_EXECUTED; ExecutionAttempt SUCCEEDED; ActionOutcome SUCCEEDED, approval_source=POLICY, auto_executed=true. |
| **Fallback** | Gate returns REQUIRE_APPROVAL; no ExecutionAttempt row. |
| **Decision scheduler** | Second invoke with same idempotency_key does not create second reservation; IdempotencyStore has one key. |
| **Audit export** | POST returns 200/202 with export_id; GET status reaches COMPLETED; presigned download returns 200 and CSV has content. |

---

## References

- **Scripts:** `scripts/phase_5/run-phase5-e2e.sh`, `scripts/phase_5/test-phase5-autoexec.sh`, `scripts/phase_5/test-phase5-fallback.sh`, `scripts/phase_5/test-phase5-decision-scheduler.sh`, `scripts/phase_5/test-phase5-audit-export.sh`, `scripts/phase_5/seed-phase5-autoexec.sh`, `scripts/phase_5/seed-phase5-fallback.sh`
- **Phase 5 README:** `scripts/phase_5/README.md`
- **Phase 4 E2E:** [Phase 4.5 E2E Test Plan](../../phase_4/testing/PHASE_4_5_E2E_TEST_PLAN.md)
- **Phase 5 implementation:** [PHASE_5_IMPLEMENTATION_PLAN.md](../PHASE_5_IMPLEMENTATION_PLAN.md)
