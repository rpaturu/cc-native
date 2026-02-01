# Phase 6 E2E Scripts

E2E tests for Phase 6 (plan lifecycle, conflict resolution). Same pattern as Phase 4 and Phase 5: seed → invoke (Lambda or API) → verify → cleanup.

**Requires:** `.env` from `./deploy` (or equivalent) with at least:
- `AWS_REGION`
- `REVENUE_PLANS_TABLE_NAME` (or `REVENUE_PLANS_TABLE`)
- `PLAN_LIFECYCLE_API_FUNCTION_NAME` (optional; default `cc-native-plan-lifecycle-api`)
- For orchestrator E2E: `TENANTS_TABLE_NAME` (or `TENANTS_TABLE`; default `cc-native-tenants`), `PLAN_ORCHESTRATOR_FUNCTION_NAME` (optional; default `cc-native-plan-orchestrator`)

## Scripts

- **seed-phase6-conflict-e2e.sh** — Writes two plans to RevenuePlans (one ACTIVE, one PAUSED, same tenant/account/plan_type). Outputs `PLAN_ACTIVE_ID`, `PLAN_PAUSED_ID`, `TENANT_ID`, `ACCOUNT_ID`, `PK`.
- **test-phase6-conflict-resolution.sh** — Runs seed, invokes Plan Lifecycle API Lambda (POST resume for PAUSED plan), asserts 409 Conflict and `body.error === 'Conflict'` and CONFLICT_ACTIVE_PLAN in reasons, then cleans up both plans.
- **seed-phase6-plans-happy-e2e.sh** — Writes one PAUSED plan to RevenuePlans (no other ACTIVE for same tenant/account/plan_type). Outputs `PLAN_ID`, `TENANT_ID`, `ACCOUNT_ID`, `PK`.
- **test-phase6-plans-api-happy.sh** — Runs seed, GET /plans, GET /plans/:id, POST resume → 200, asserts plan becomes ACTIVE, cleans up.
- **seed-phase6-orchestrator-e2e.sh** — Writes one tenant to Tenants and one APPROVED plan to RevenuePlans. Outputs `PLAN_ID`, `TENANT_ID`, `ACCOUNT_ID`, `PK`.
- **test-phase6-orchestrator-cycle.sh** — Runs seed, invokes plan-orchestrator Lambda (scheduled event), asserts plan becomes ACTIVE, cleans up tenant and plan.
- **run-phase6-e2e.sh** — Runs all Phase 6 E2E tests: conflict resolution, Plans API happy path, orchestrator cycle.

## Usage

After deploy (`.env` is populated):

```bash
./scripts/phase_6/run-phase6-e2e.sh
```

Or run a single scenario:

```bash
./scripts/phase_6/test-phase6-conflict-resolution.sh
./scripts/phase_6/test-phase6-plans-api-happy.sh
./scripts/phase_6/test-phase6-orchestrator-cycle.sh
```

Deploy runs Phase 6 E2E by default after Phase 5 E2E. Skip with:

```bash
./deploy --skip-phase6-e2e
```
