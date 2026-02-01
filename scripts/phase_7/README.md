# Phase 7 E2E Scripts

E2E tests for Phase 7 (governance: Plan Ledger, validators path). Same pattern as Phase 6: seed → invoke (Lambda/API) → verify → cleanup.

**Requires:** `.env` from `./deploy` (or equivalent) with at least:
- `AWS_REGION`
- `REVENUE_PLANS_TABLE_NAME` (or `REVENUE_PLANS_TABLE`)
- `PLAN_LIFECYCLE_API_FUNCTION_NAME` (optional; default `cc-native-plan-lifecycle-api`)

## Scripts

- **seed-phase7-ledger-e2e.sh** — Writes one PAUSED plan to RevenuePlans (e2e-p7-ledger-*). Outputs `PLAN_ID`, `TENANT_ID`, `ACCOUNT_ID`, `PK`.
- **test-phase7-plan-ledger.sh** — Runs seed, POST resume → 200, GET /plans/:planId/ledger, asserts at least one ledger entry with event_type (e.g. PLAN_RESUMED), cleans up plan.
- **test-phase7-validator-run.sh** — Runs seed, POST resume (plan-lifecycle runs ValidatorGateway), GET ledger, asserts VALIDATOR_RUN or VALIDATOR_RUN_SUMMARY, cleans up.
- **test-phase7-budget-reserve.sh** — Runs seed, invokes Phase 7 governance E2E Lambda (action=budget_reserve), GET ledger, asserts BUDGET_RESERVE, cleans up.
- **test-phase7-outcomes-capture.sh** — Requires `OUTCOMES_TABLE_NAME` (set by deploy into .env). Verifies Outcomes table exists; does not skip.
- **run-phase7-e2e.sh** — Runs all Phase 7 E2E tests: Plan Ledger, Validator run, Budget reserve, Outcomes capture.

Optional env: `PHASE7_GOVERNANCE_E2E_FUNCTION_NAME` (default `cc-native-phase7-governance-e2e`).

## Usage

After deploy (`.env` is populated):

```bash
./scripts/phase_7/run-phase7-e2e.sh
```

Or run a single scenario:

```bash
./scripts/phase_7/test-phase7-plan-ledger.sh
./scripts/phase_7/test-phase7-validator-run.sh
./scripts/phase_7/test-phase7-budget-reserve.sh
./scripts/phase_7/test-phase7-outcomes-capture.sh
```

Deploy runs Phase 7 E2E by default after Phase 6 E2E. Skip with:

```bash
./deploy --skip-phase7-e2e
```
