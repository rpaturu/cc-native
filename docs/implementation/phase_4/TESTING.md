# Phase 4 — How to Run Tests

Single entry point for running Phase 4 (Execution) tests. For detailed coverage and scenarios, see the per-phase plans below.

## Quick reference

| Scope | Command | Plan |
|-------|---------|------|
| **Unit (4.1–4.4)** | `npm test` (or `npm test -- --testPathPattern="phase4\|execution"`) | [PHASE_4_2](testing/PHASE_4_2_TEST_PLAN.md), [PHASE_4_3](testing/PHASE_4_3_TEST_PLAN.md), [PHASE_4_4](testing/PHASE_4_4_TEST_PLAN.md) |
| **Integration (4.4)** | `npm run test:integration` (or equivalent with env for DynamoDB) | [PHASE_4_4_INTEGRATION](testing/PHASE_4_4_INTEGRATION_TEST_PLAN.md) |
| **E2E (4.5A)** | Expanded `end-to-end-execution.test.ts` or `scripts/phase_4/test-phase4-execution.sh` | [PHASE_4_5](PHASE_4_5_CODE_LEVEL_PLAN.md) §3 |

## Phase plans (details)

- **Unit 4.1+4.2:** [testing/PHASE_4_2_TEST_PLAN.md](testing/PHASE_4_2_TEST_PLAN.md)
- **Unit 4.3:** [testing/PHASE_4_3_TEST_PLAN.md](testing/PHASE_4_3_TEST_PLAN.md)
- **Unit 4.4:** [testing/PHASE_4_4_TEST_PLAN.md](testing/PHASE_4_4_TEST_PLAN.md)
- **Integration + E2E placeholder:** [testing/PHASE_4_4_INTEGRATION_TEST_PLAN.md](testing/PHASE_4_4_INTEGRATION_TEST_PLAN.md)
- **4.5 wrap-up (E2E script, DoD):** [PHASE_4_5_CODE_LEVEL_PLAN.md](PHASE_4_5_CODE_LEVEL_PLAN.md)

## Prerequisites

- **Unit:** `npm install`, then `npm test`.
- **Integration:** Stack deployed or local DynamoDB; set `EXECUTION_ATTEMPTS_TABLE`, `EXECUTION_OUTCOMES_TABLE` (and any API URL/auth) per integration plan.
- **E2E script:** See PHASE_4_5_CODE_LEVEL_PLAN.md §3 (env vars and optional `ACTION_INTENT_ID` or API).
