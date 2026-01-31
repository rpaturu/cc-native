# Phase 5.3 Test Plan — Perception Scheduler

**Status:** 🟢 **COMPLETE** (unit + integration + handlers + EventBridge implemented)  
**Created:** 2026-01-28  
**Last Updated:** 2026-01-28 (gaps closed: HeatScoringService posture/recency/tier/hysteresis; PerceptionPullBudgetService TransactWrite + getStateForDate; handler unit tests)  
**Parent:** [PHASE_5_3_CODE_LEVEL_PLAN.md](../PHASE_5_3_CODE_LEVEL_PLAN.md)

---

## Executive Summary

This document outlines the testing strategy for Phase 5.3 (Perception Scheduler). The plan covers **unit tests for heat scoring, pull budget, pull idempotency, and pull orchestrator**, **Lambda handlers** (heat-scoring, perception-pull-orchestrator), **EventBridge rules** (SIGNAL_DETECTED → heat scoring; periodic heat scoring and pull orchestration), and **integration tests** (env-gated with real DynamoDB).

**Testing philosophy:**  
Test heat scoring, budget atomicity, and idempotency in isolation (unit); validate handlers and EventBridge when dependencies are available; run integration tests when `PERCEPTION_SCHEDULER_TABLE_NAME` and `PULL_IDEMPOTENCY_STORE_TABLE_NAME` are set (e.g. after `./deploy` writes .env).

### Implementation Status

**✅ Unit tests – HeatTierPolicyService: COMPLETE**

- **Test file:** `src/tests/unit/perception/HeatTierPolicyService.test.ts`
- **Tests:** 6 (getPolicy, getDefaultDepth, getPullCadence, getDemotionCooldownHours; custom policies; fallback for unknown tier)
- **Status:** All passing ✅

**✅ Unit tests – HeatScoringService: COMPLETE**

- **Test file:** `src/tests/unit/perception/HeatScoringService.test.ts`
- **Tests:** 14 (computeAndStoreHeat HEAT#LATEST; getLatestHeat null/item; postureToScore DORMANT/OK/AT_RISK/EXPAND + null; signalRecencyToScore empty/≤1h/≤6h/≤24h/&gt;24h; scoreToTier HOT/COLD; hysteresis keep tier within cooldown, demote when ≥ cooldown)
- **Status:** All passing ✅

**✅ Unit tests – PerceptionPullBudgetService: COMPLETE**

- **Test file:** `src/tests/unit/perception/PerceptionPullBudgetService.test.ts`
- **Tests:** 11 (getConfig present/absent; putConfig; checkAndConsume no config/zero cap/success/limit/TransactWrite path/TransactionCanceledException; getStateForDate present/absent)
- **Status:** All passing ✅

**✅ Unit tests – PullIdempotencyStoreService: COMPLETE**

- **Test file:** `src/tests/unit/perception/PullIdempotencyStoreService.test.ts`
- **Tests:** 5 (tryReserve success/duplicate/throw, exists true/false)
- **Status:** All passing ✅

**✅ Unit tests – PerceptionPullOrchestrator: COMPLETE**

- **Test file:** `src/tests/unit/perception/PerceptionPullOrchestrator.test.ts`
- **Tests:** 4 (schedulePull scheduled, DUPLICATE_PULL_JOB_ID, RATE_LIMIT, BUDGET_EXCEEDED)
- **Status:** All passing ✅

**✅ Unit tests – heat-scoring-handler: COMPLETE**

- **Test file:** `src/tests/unit/handlers/phase5/heat-scoring-handler.test.ts`
- **Tests:** 6 (skip when missing tenantId/accountId; normalize detail.tenant_id/account_id; single account; accountIds loop; collect errors on computeAndStoreHeat throw)
- **Status:** All passing ✅

**✅ Unit tests – perception-pull-orchestrator-handler: COMPLETE**

- **Test file:** `src/tests/unit/handlers/phase5/perception-pull-orchestrator-handler.test.ts`
- **Tests:** 4 (skip when no jobs; normalize single job with depth; SHALLOW default; event.jobs array, scheduled/skipped results)
- **Status:** All passing ✅

**✅ Lambda handlers + EventBridge: COMPLETE**

- **heat-scoring-handler:** `src/handlers/phase5/heat-scoring-handler.ts` — Triggered by SIGNAL_DETECTED (detail → tenantId/accountId) or periodic schedule. Input: tenantId + accountId or accountIds; normalizes EventBridge envelope.
- **perception-pull-orchestrator-handler:** `src/handlers/phase5/perception-pull-orchestrator-handler.ts` — Triggered by periodic schedule or event with jobs. Input: single SchedulePullInput or { jobs: SchedulePullInput[] }.
- **EventBridge rules:** SIGNAL_DETECTED/SIGNAL_CREATED → heat-scoring-handler (fromEventPath detail); rate(1h) → heat-scoring-handler (payload tenantId/accountIds empty); rate(1h) → perception-pull-orchestrator-handler (jobs []).

**✅ Integration tests: IMPLEMENTED (env-gated)**

- **perception-scheduler:** `src/tests/integration/perception/perception-scheduler.test.ts` — Run when `PERCEPTION_SCHEDULER_TABLE_NAME` and `PULL_IDEMPOTENCY_STORE_TABLE_NAME` are set (e.g. after `./deploy` writes .env). Tests PullIdempotencyStoreService tryReserve/duplicate/exists; PerceptionPullBudgetService getConfig/putConfig/checkAndConsume/cap exceeded.

---

## Test coverage (reified)

Concrete file paths, test counts, and test names as of implementation. Run `npm test` for unit; `npm run test:integration` for integration (Phase 5.3 suite runs only when `PERCEPTION_SCHEDULER_TABLE_NAME` and `PULL_IDEMPOTENCY_STORE_TABLE_NAME` are set).

### Unit tests — 50 tests across 7 files

| File | Tests | Test names |
|------|-------|------------|
| `src/tests/unit/perception/HeatTierPolicyService.test.ts` | 6 | `getPolicy returns policy for HOT, WARM, COLD`; `getDefaultDepth returns DEEP for HOT, SHALLOW for WARM and COLD`; `getPullCadence returns cadence string per tier`; `getDemotionCooldownHours returns hours per tier`; `uses provided policies when passed`; `getDefaultDepth falls back to SHALLOW for unknown tier` |
| `src/tests/unit/perception/HeatScoringService.test.ts` | 14 | `computeAndStoreHeat writes HEAT#LATEST...`; `getLatestHeat returns null`; `getLatestHeat returns AccountHeatV1 when item exists`; postureToScore DORMANT/OK/AT_RISK/EXPAND; postureScore 0 when null; signalRecencyToScore empty/≤1h/3h/12h/48h; scoreToTier HOT/COLD; hysteresis keep tier within cooldown, demote when ≥ cooldown |
| `src/tests/unit/perception/PerceptionPullBudgetService.test.ts` | 11 | getConfig present/absent; putConfig; checkAndConsume no config/zero cap/success/limit/TransactWrite path/TransactionCanceledException; getStateForDate present/absent |
| `src/tests/unit/perception/PullIdempotencyStoreService.test.ts` | 5 | tryReserve success/duplicate/throw; exists true/false |
| `src/tests/unit/perception/PerceptionPullOrchestrator.test.ts` | 4 | schedulePull success, DUPLICATE_PULL_JOB_ID, RATE_LIMIT, BUDGET_EXCEEDED |
| `src/tests/unit/handlers/phase5/heat-scoring-handler.test.ts` | 6 | skip missing tenantId/accountId; normalize detail; single account; accountIds; errors on throw |
| `src/tests/unit/handlers/phase5/perception-pull-orchestrator-handler.test.ts` | 4 | skip no jobs; single job with depth; SHALLOW default; event.jobs array |

### Integration tests — 6 tests (env-gated)

| File | Suite | Tests | Test names |
|------|--------|-------|------------|
| `src/tests/integration/perception/perception-scheduler.test.ts` | Perception Scheduler Integration (PullBudget + PullIdempotency) | 6 | **PullIdempotencyStoreService:** `tryReserve returns true when key is new`; `tryReserve returns false when key already exists (duplicate)`; `exists returns true after reserve, false for unknown key`. **PerceptionPullBudgetService:** `getConfig returns config after putConfig`; `checkAndConsumePullBudget returns allowed true and consumes units`; `checkAndConsumePullBudget returns allowed false when cap exceeded` |

**Env gating:** Suite uses `(hasRequiredEnv ? describe : describe.skip)`. Required: `PERCEPTION_SCHEDULER_TABLE_NAME`, `PULL_IDEMPOTENCY_STORE_TABLE_NAME` (e.g. from `.env` after `./deploy`).

### Coverage summary

| Layer | Files | Tests | Notes |
|-------|-------|-------|--------|
| HeatTierPolicyService | 1 | 6 | Default/custom policies; fallback for unknown tier |
| HeatScoringService | 1 | 14 | computeAndStoreHeat; getLatestHeat; posture/recency/tier/hysteresis |
| PerceptionPullBudgetService | 1 | 11 | getConfig, putConfig; checkAndConsume (incl. TransactWrite); getStateForDate |
| PullIdempotencyStoreService | 1 | 5 | tryReserve success/duplicate/throw; exists |
| PerceptionPullOrchestrator | 1 | 4 | schedulePull: success, DUPLICATE_PULL_JOB_ID, RATE_LIMIT, BUDGET_EXCEEDED |
| heat-scoring-handler | 1 | 6 | normalizeEvent; skip/success/error paths |
| perception-pull-orchestrator-handler | 1 | 4 | normalizeInput; single job / jobs array |
| Integration (DDB) | 1 | 6 | Idempotency + budget against real tables |
| **Total** | **8** | **56** | Gaps closed 2026-01-28 |

### Gaps closed (2026-01-28)

- **HeatScoringService:** Added tests for postureToScore (DORMANT, OK, AT_RISK, EXPAND, null), signalRecencyToScore (empty, ≤1h, 3h, 12h, 48h), scoreToTier (HOT, COLD), hysteresis (keep tier within cooldown, demote when ≥ cooldown).
- **PerceptionPullBudgetService:** Added TransactWrite path (per-connector cap differs from tenant), TransactionCanceledException path, getStateForDate (present/absent).
- **Handlers:** Added unit tests for heat-scoring-handler and perception-pull-orchestrator-handler (normalize + invoke paths).

### Gaps still out of scope for 5.3

- **E2E heat with real posture/signals:** Requires Phase 1/2 data.
- **Step Functions pull workflow:** Optional; not implemented.
- **Load / chaos:** Out of scope.

---

## Testing Strategy Overview

### 1. Unit tests

- **HeatTierPolicyService:** Default/custom policies; getPolicy, getDefaultDepth, getPullCadence, getDemotionCooldownHours; fallbacks for unknown tier.
- **HeatScoringService:** computeAndStoreHeat (posture + signals → heat_tier, heat_score; HEAT#LATEST); getLatestHeat; mocked getPostureState, getSignalsForAccount.
- **PerceptionPullBudgetService:** getConfig, putConfig; checkAndConsumePullBudget (no config, zero cap, success, ConditionalCheckFailed); per-connector then tenant total (TransactWrite when both caps).
- **PullIdempotencyStoreService:** tryReserve (conditional put; true/false on duplicate); exists; mocked DynamoDB.
- **PerceptionPullOrchestrator:** schedulePull (order: rate-limit → reserve → consume → job); scheduled; DUPLICATE_PULL_JOB_ID, RATE_LIMIT, BUDGET_EXCEEDED; mocked services.

### 2. Integration tests (env-gated)

- **Perception Scheduler:** Real DynamoDB (perception scheduler table, pull idempotency table). Idempotency tryReserve/duplicate/exists; budget putConfig/getConfig/checkAndConsume/cap exceeded. Requires `PERCEPTION_SCHEDULER_TABLE_NAME` and `PULL_IDEMPOTENCY_STORE_TABLE_NAME` (written by `./deploy` to .env). Run with `npm run test:integration` (suite runs only when env is set).

### 3. Out of scope for 5.3

- End-to-end heat scoring with real posture/signals (requires Phase 1/2 data).
- Step Functions for pull workflow (optional; not implemented).
- Load or chaos tests.

---

## Execution

- **Unit tests (default):** `npm test` — excludes integration; all Phase 5.3 unit tests run.
- **Unit tests with coverage:** `npm run test:coverage` — same as unit but emits line/branch/function coverage to `coverage/` (text, lcov, html). Phase 5.3 perception services (HeatScoringService, HeatTierPolicyService, PerceptionPullBudgetService, PullIdempotencyStoreService, PerceptionPullOrchestrator) are covered by unit tests; coverage report shows per-file stats.
- **Integration tests:** `npm run test:integration` — runs all integration tests including Phase 5.3 when `PERCEPTION_SCHEDULER_TABLE_NAME` and `PULL_IDEMPOTENCY_STORE_TABLE_NAME` are set. After `./deploy`, .env contains these; `npm run test:integration` will run the perception-scheduler suite.
- **Deploy:** `./deploy` builds, runs unit tests, deploys, seeds, runs integration tests (including Phase 5.3 if env is set), then Phase 4 E2E.

---

## References

- **Code-level plan:** [PHASE_5_3_CODE_LEVEL_PLAN.md](../PHASE_5_3_CODE_LEVEL_PLAN.md)
- **Implementation plan:** [PHASE_5_IMPLEMENTATION_PLAN.md](../PHASE_5_IMPLEMENTATION_PLAN.md) EPIC 5.3
