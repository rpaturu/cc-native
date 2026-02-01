# Phase 4.5 E2E Test Plan (4.5A — One Deterministic Path)

**Status:** 🟢 **COMPLETE**  
**Created:** 2026-01-30  
**Last Updated:** 2026-01-30  
**Last verified:** 2026-01-30 — E2E run passed as part of `./deploy` (steps 3–4, 6; step 5 skipped without URL+JWT).  
**Parent:** [PHASE_4_5_CODE_LEVEL_PLAN.md](../PHASE_4_5_CODE_LEVEL_PLAN.md) §3  
**Satisfies:** Phase 4.5A "one deterministic E2E path". **Validates:** 4.4 execution/safety layer (recorder, signals, status API).  
**Related:** [PHASE_4_4_INTEGRATION_TEST_PLAN.md](PHASE_4_4_INTEGRATION_TEST_PLAN.md)  
**Prerequisites:** Deployed stack (./deploy); `.env` with `EVENT_BUS_NAME`, `ACTION_INTENT_TABLE_NAME`, `EXECUTION_ATTEMPTS_TABLE_NAME`, `EXECUTION_OUTCOMES_TABLE_NAME`  
**Based on scripts:** `scripts/phase_4/test-phase4-execution.sh`, `scripts/phase_4/seed-phase4-e2e-intent.sh`

---

## Overview

Phase 4.5 E2E implements the **one deterministic path** required by 4.5A: seed action intent → EventBridge (ACTION_APPROVED) → Step Functions → Tool Mapper → Gateway → Internal Adapter (create task) → Tool Invoker → Execution Recorder → outcome and signals. Run as part of `./deploy` unless skipped.

**Scope:** Single happy path (internal.create_task). No CRM or external adapters required.

---

## Implementation status

| Item | Status | Notes |
|------|--------|--------|
| **test-phase4-execution.sh** | ✅ Implemented | Steps 1–7: seed (or use ACTION_INTENT_ID) → wait → verify attempt → verify outcome → (optional) Status API → (optional) signal → cleanup. |
| **seed-phase4-e2e-intent.sh** | ✅ Implemented | Writes one action intent to ActionIntent table; puts ACTION_APPROVED to EventBridge. Outputs `ACTION_INTENT_ID`. |
| **Status API check** | ✅ In script | Step 5 when EXECUTION_STATUS_API_URL + EXECUTION_STATUS_API_AUTH_HEADER set. **Recommended** when deploy pipeline provides URL+JWT. |
| **Signal check** | ✅ In script | Step 6 when SIGNALS_TABLE_NAME set (e.g. from deploy .env). |
| **Run in deploy** | ✅ Yes | `./deploy` runs E2E after integration tests unless `--skip-e2e`. |

---

## How to run

**Prerequisites:** Run `./deploy` once so `.env` has `EVENT_BUS_NAME`, `ACTION_INTENT_TABLE_NAME`, `EXECUTION_ATTEMPTS_TABLE_NAME`, `EXECUTION_OUTCOMES_TABLE_NAME`. Optionally `EXECUTION_STATUS_API_URL` and auth for status API checks.

**Run E2E (standalone):**
```bash
./scripts/phase_4/test-phase4-execution.sh
```

**Run as part of deploy (default):**
```bash
./deploy
```

**Deploy without E2E:**
```bash
./deploy --skip-e2e
```

---

## E2E flow (script steps 1–7)

Flow below matches `test-phase4-execution.sh` and `seed-phase4-e2e-intent.sh`.

1. **Seed** — If `ACTION_INTENT_ID` is unset and `EVENT_BUS_NAME` + `ACTION_INTENT_TABLE_NAME` are set: run `seed-phase4-e2e-intent.sh`. It writes one action intent (CREATE_INTERNAL_TASK, E2E test) to ActionIntent and puts ACTION_APPROVED to EventBridge. Script captures `ACTION_INTENT_ID` from seed output. Otherwise set `ACTION_INTENT_ID` (or use Phase 3 API with DECISION_API_URL + auth).
2. **Wait** — Poll DynamoDB ExecutionAttempt (pk/sk = TENANT#…#ACCOUNT#… / EXECUTION#{action_intent_id}) every 10s until status ≠ RUNNING or Step Functions execution reaches SUCCEEDED/FAILED (max 90s). Resolve state machine by name `cc-native-execution-orchestrator` if EXECUTION_STATE_MACHINE_ARN unset. Fail if SFN status is FAILED or timeout.
3. **Verify ExecutionAttempt** — Assert attempt status is SUCCEEDED (not FAILED from RecordFailure path).
4. **Verify ActionOutcome** — Get item from ExecutionOutcomes table (sk = OUTCOME#{action_intent_id}); assert Item exists and status = SUCCEEDED.
5. **Execution Status API (optional)** — If `EXECUTION_STATUS_API_URL` and `EXECUTION_STATUS_API_AUTH_HEADER` are set: GET `{url}/executions/{action_intent_id}/status?account_id=…` with Authorization header; assert HTTP 200 and body `status === 'SUCCEEDED'`. Otherwise step skipped.
6. **Execution signal (optional)** — If `SIGNALS_TABLE_NAME` is set: get item (tenantId, signalId = `exec-{action_intent_id}-{account_id}-ACTION_EXECUTED`); assert Item exists. Otherwise step skipped.
7. **Cleanup** — Delete ExecutionAttempt, ActionOutcome, and (if ACTION_INTENT_TABLE_NAME set) ActionIntent rows for the E2E intent.

---

## Required / optional env (from scripts)

| Variable | Required | Notes |
|----------|----------|--------|
| AWS_REGION | Yes | Deployed region. |
| EVENT_BUS_NAME | Yes (for seed path) | From .env / CDK outputs. |
| ACTION_INTENT_TABLE_NAME | Yes (for seed path) | From .env / CDK outputs. |
| EXECUTION_ATTEMPTS_TABLE_NAME | Yes | Or EXECUTION_ATTEMPTS_TABLE. |
| EXECUTION_OUTCOMES_TABLE_NAME | Yes | Or EXECUTION_OUTCOMES_TABLE. |
| EXECUTION_STATUS_API_URL | No | Enables Step 5 (Status API check). |
| EXECUTION_STATUS_API_AUTH_HEADER | No | JWT for Status API (e.g. from deploy .env). |
| SIGNALS_TABLE_NAME | No | Enables Step 6 (signal check). |
| EXECUTION_STATE_MACHINE_ARN | No | Else resolved by name cc-native-execution-orchestrator. |
| TENANT_ID, ACCOUNT_ID | No | Defaults: test-tenant-1, test-account-1. |

---

## Verification checklist

| Check | How |
|-------|-----|
| **EventBridge rule** | Rule forwards ACTION_APPROVED to Step Functions. |
| **Step Functions** | Execution starts; MapActionToTool → ToolInvoker → ExecutionRecorder. |
| **Gateway + Internal Adapter** | internal.create_task creates task in DynamoDB; Tool Invoker parses MCP response and passes external_object_refs. |
| **ExecutionAttempt** | Row exists; status SUCCEEDED (step 3). |
| **ActionOutcome** | Row exists; status SUCCEEDED (step 4). |
| **Execution Status API** | When URL + JWT set: GET status returns 200 and status SUCCEEDED (step 5). |
| **Execution signal** | When SIGNALS_TABLE_NAME set: signal row exists for ACTION_EXECUTED (step 6). |

---

## Test results

E2E has been run successfully as part of `./deploy`:

- **Steps 3–4:** ExecutionAttempt and ActionOutcome (DynamoDB) — **PASSED** (status SUCCEEDED).
- **Step 5:** Execution Status API — **Skipped** when `EXECUTION_STATUS_API_URL` and `EXECUTION_STATUS_API_AUTH_HEADER` are not set (expected).
- **Step 6:** Execution signal — **PASSED** (signal row found, signalType=ACTION_EXECUTED).
- **Step 7:** Cleanup — completed.

To re-verify, run `./scripts/phase_4/test-phase4-execution.sh` or `./deploy` (without `--skip-e2e`).

---

## References

- **Phase 4.5 code plan:** [PHASE_4_5_CODE_LEVEL_PLAN.md](../PHASE_4_5_CODE_LEVEL_PLAN.md) §3
- **Phase 4.4 integration tests:** [PHASE_4_4_INTEGRATION_TEST_PLAN.md](PHASE_4_4_INTEGRATION_TEST_PLAN.md)
- **Phase 4.4 unit tests:** [PHASE_4_4_TEST_PLAN.md](PHASE_4_4_TEST_PLAN.md)
- **Phase 4.4 code plan:** [PHASE_4_4_CODE_LEVEL_PLAN.md](../PHASE_4_4_CODE_LEVEL_PLAN.md)
- **Scripts:** `scripts/phase_4/test-phase4-execution.sh`, `scripts/phase_4/seed-phase4-e2e-intent.sh`
