# Phase 4.4 E2E Test Plan

**Status:** 🟢 **COMPLETE**  
**Created:** 2026-01-30  
**Last Updated:** 2026-01-30  
**Last verified:** 2026-01-30 — E2E run passed as part of `./deploy` (steps 3–4, 6; step 5 skipped without URL+JWT).  
**Parent:** [PHASE_4_4_INTEGRATION_TEST_PLAN.md](PHASE_4_4_INTEGRATION_TEST_PLAN.md)  
**Prerequisites:** Deployed stack (./deploy); `.env` with `EVENT_BUS_NAME`, `ACTION_INTENT_TABLE_NAME`, `EXECUTION_ATTEMPTS_TABLE_NAME`, `EXECUTION_OUTCOMES_TABLE_NAME`

---

## Overview

Phase 4.4 E2E validates the **full execution path**: seed action intent → EventBridge (ACTION_APPROVED) → Step Functions → Tool Mapper → Gateway → Internal Adapter (create task) → Tool Invoker → Execution Recorder → outcome and signals. One deterministic path is implemented and run as part of `./deploy` unless skipped.

**Scope:** Single happy path (internal.create_task). No CRM or external adapters required.

---

## Implementation status

| Item | Status | Notes |
|------|--------|--------|
| **test-phase4-execution.sh** | ✅ Implemented | Seed → wait → verify attempt/outcome → (optional) Status API → (optional) signal → cleanup. |
| **seed-phase4-e2e-intent.sh** | ✅ Implemented | Puts action intent (B2) and ACTION_APPROVED to EventBridge. |
| **Status API check** | ✅ In script | Step 5 when EXECUTION_STATUS_API_URL + EXECUTION_STATUS_API_AUTH_HEADER set. |
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

## E2E flow (one path)

1. **Seed** — Create action intent (B2) and put ACTION_APPROVED on EventBridge (`scripts/phase_4/seed-phase4-e2e-intent.sh`).
2. **Wait** — Poll DynamoDB execution attempt until status is not RUNNING or Step Functions reaches terminal (max 90s).
3. **Verify** — Assert ExecutionAttempt status (e.g. SUCCEEDED) and ActionOutcome present and SUCCEEDED.
4. **Cleanup** — Remove E2E seed data (attempt, outcome, intent if configured).

**Step 5 — Execution Status API (optional):** When `EXECUTION_STATUS_API_URL` and `EXECUTION_STATUS_API_AUTH_HEADER` (JWT) are set, the script calls `GET .../executions/{action_intent_id}/status?account_id=...` and asserts 200 and `status: SUCCEEDED`. If either is unset, the step is skipped.

**Step 6 — Execution signal (optional):** When `SIGNALS_TABLE_NAME` is set (e.g. from deploy `.env`), the script verifies a signal row exists in the signals table for the execution (`signalId = exec-{action_intent_id}-{account_id}-ACTION_EXECUTED`). If unset, the step is skipped.

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

- **Phase 4.4 integration tests:** [PHASE_4_4_INTEGRATION_TEST_PLAN.md](PHASE_4_4_INTEGRATION_TEST_PLAN.md)
- **Phase 4.4 unit tests:** [PHASE_4_4_TEST_PLAN.md](PHASE_4_4_TEST_PLAN.md)
- **Phase 4.4 code plan:** `../PHASE_4_4_CODE_LEVEL_PLAN.md`
- **Scripts:** `scripts/phase_4/test-phase4-execution.sh`, `scripts/phase_4/seed-phase4-e2e-intent.sh`
