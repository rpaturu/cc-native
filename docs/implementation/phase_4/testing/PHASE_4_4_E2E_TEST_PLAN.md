# Phase 4.4 E2E Test Plan

**Status:** 🟢 **COMPLETE**  
**Created:** 2026-01-30  
**Last Updated:** 2026-01-30  
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
| **test-phase4-execution.sh** | ✅ Implemented | Seed → wait → verify attempt/outcome → cleanup. |
| **seed-phase4-e2e-intent.sh** | ✅ Implemented | Puts action intent (B2) and ACTION_APPROVED to EventBridge. |
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

Optional extensions (not required for status COMPLETE): verify Execution Status API returns 200 for the same `action_intent_id`; verify signal in signals table.

---

## Verification checklist

| Check | How |
|-------|-----|
| **EventBridge rule** | Rule forwards ACTION_APPROVED to Step Functions. |
| **Step Functions** | Execution starts; MapActionToTool → ToolInvoker → ExecutionRecorder. |
| **Gateway + Internal Adapter** | internal.create_task creates task in DynamoDB; Tool Invoker parses MCP response and passes external_object_refs. |
| **ExecutionAttempt** | Row exists; status SUCCEEDED. |
| **ActionOutcome** | Row exists; status SUCCEEDED. |

---

## References

- **Phase 4.4 integration tests:** [PHASE_4_4_INTEGRATION_TEST_PLAN.md](PHASE_4_4_INTEGRATION_TEST_PLAN.md)
- **Phase 4.4 unit tests:** [PHASE_4_4_TEST_PLAN.md](PHASE_4_4_TEST_PLAN.md)
- **Phase 4.4 code plan:** `../PHASE_4_4_CODE_LEVEL_PLAN.md`
- **Scripts:** `scripts/phase_4/test-phase4-execution.sh`, `scripts/phase_4/seed-phase4-e2e-intent.sh`
