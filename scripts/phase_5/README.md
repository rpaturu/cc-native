# Phase 5 E2E Test Suite

Small suite of **3–4 targeted E2E paths** for Phase 5 (always-on autonomy, control center, reliability). Each script proves one contract end-to-end. Phase 4 E2E proves EventBridge → SFN → attempt/outcome; Phase 5 adds policy/mode/budget, decision scheduling, audit export, and auto-exec paths.

## Scripts

| Script | Purpose |
|--------|--------|
| **test-phase5-autoexec.sh** | Auto-execute happy path: intent + allowlist + mode + policy AUTO_EXECUTE + budget → gate returns AUTO_EXECUTED → Phase 4 runs → outcome has `approval_source=POLICY`, `auto_executed=true`. |
| **test-phase5-fallback.sh** | Policy/budget fallback: budget exhausted or policy REQUIRE_APPROVAL → gate returns REQUIRE_APPROVAL → no execution attempt, no double budget consume. |
| **test-phase5-decision-scheduler.sh** | Decision scheduling idempotency: same trigger twice (same idempotency key) → second is SKIP as DUPLICATE; CostGate DEFER → one bounded retry (RUN_DECISION_DEFERRED). |
| **test-phase5-audit-export.sh** | Control Center audit export: POST /autonomy/audit/exports → poll GET …/:id until COMPLETED → verify presigned download and CSV schema. |

## Env source (same as Phase 4 E2E)

E2E and seed scripts use **`.env` only** (no `.env.local`). Deploy writes stack outputs and optional Cognito JWT into `.env`. `.env.local` is for deploy inputs only (e.g. `BEDROCK_MODEL`, `COGNITO_TEST_USER`).

## Required env (from .env, populated by deploy)

- **All:** `AWS_REGION`, `TENANT_ID`, `ACCOUNT_ID` (defaults: test-tenant-1, test-account-1).
- **Auto-exec / Fallback:** `ACTION_INTENT_TABLE_NAME`, `AUTONOMY_CONFIG_TABLE_NAME`, `AUTONOMY_BUDGET_STATE_TABLE_NAME`, `EVENT_BUS_NAME`, `EXECUTION_ATTEMPTS_TABLE_NAME`, `EXECUTION_OUTCOMES_TABLE_NAME`. Optional: `AUTO_APPROVAL_GATE_FUNCTION_NAME` (default: cc-native-auto-approval-gate).
- **Decision scheduler:** `DECISION_RUN_STATE_TABLE_NAME`, `IDEMPOTENCY_STORE_TABLE_NAME`, `EVENT_BUS_NAME`. Optional: `DECISION_COST_GATE_FUNCTION_NAME` (default: cc-native-decision-cost-gate).
- **Audit export:** `AUTONOMY_ADMIN_API_URL` (Control Center API base URL), `CONTROL_CENTER_AUTH_HEADER` (e.g. JWT). Optional: `AUDIT_EXPORT_TABLE_NAME` (default: cc-native-audit-export).

If autonomy/audit table names are not in `.env`, add them after deploy (CDK outputs for autonomy config, budget state, audit export table and API URL).

## Running

```bash
# From project root (after ./deploy or with .env set)
./scripts/phase_5/test-phase5-autoexec.sh
./scripts/phase_5/test-phase5-fallback.sh
./scripts/phase_5/test-phase5-decision-scheduler.sh
./scripts/phase_5/test-phase5-audit-export.sh

# Or run all in sequence (stops on first failure)
./scripts/phase_5/run-phase5-e2e.sh
```

**Note:** `./deploy` runs the Phase 5 E2E suite after Phase 4 E2E (unless `--skip-phase5-e2e`). Deploy writes stack outputs to `.env`; E2E scripts use `.env` only.

## Reuse from Phase 4 E2E

- Attempt/outcome polling and DynamoDB verification (test-phase5-autoexec.sh).
- Cleanup pattern (delete attempt, outcome, intent, autonomy seed data).
- Optional: status API verification; SFN discovery.

## References

- Phase 4 E2E: `scripts/phase_4/test-phase4-execution.sh`, `scripts/phase_4/seed-phase4-e2e-intent.sh`
- Phase 5 code-level: `docs/implementation/phase_5/PHASE_5_*_CODE_LEVEL_PLAN.md`
