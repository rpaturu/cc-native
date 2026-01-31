# Phase 5.3 — Perception Scheduler: Code-Level Plan

**Status:** 🟢 **COMPLETE** (implementation done; unit + integration + handlers + EventBridge)  
**Created:** 2026-01-28  
**Last Updated:** 2026-01-28 (implementation complete; DUPLICATE_PULL_JOB_ID, budget consume order, heat triggers)  
**Parent:** [PHASE_5_CODE_LEVEL_PLAN.md](PHASE_5_CODE_LEVEL_PLAN.md)

---

## Overview

Phase 5.3 establishes cost-safe **pull** orchestration for perception:

- **Heat scoring** — compute account heat from posture + signals; store in DDB (latest per account)
- **Pull orchestration** — schedule pull jobs based on heat + per-tenant budgets; enforce connector rate limits
- **Runtime budget state** — atomic consume (like 5.1/5.2); depth in units so budgets are enforceable
- **Deterministic cadence** — heat-tier → cadence/depth mapping + hysteresis so accounts don’t flap

**Deliverable:** PerceptionScheduler that decides *when to pull* and *how deep to go*. Cold accounts are cheap; hot accounts get deeper coverage. Budget/state accounting is atomic; connector throttling is explicit (per-tenant and optional global).

**Dependencies:** Phase 1 (perception); Phase 2 (posture/signals); existing connector and cost budgets. Phase 5.2 (Decision Scheduling) is not required; 5.3 can run independently. Optional: align pull cadence with RUN_DECISION if desired.

**Production-tight contracts (must implement):**

1. **Runtime pull budget state + atomic consume** — PerceptionPullBudgetStateV1; `checkAndConsumePullBudget(tenant, connector, depthUnits)` atomic; depth in units (SHALLOW=1, DEEP=3).
2. **Explicit connector throttling** — per tenant+connector and optionally global per connector; protect upstream APIs.
3. **Deterministic cadence + hysteresis** — HeatTierPolicyV1; promotion/demotion rules so accounts don’t flap; no tier thrashing.
4. **Idempotency for pull jobs** — pull_job_id; idempotency store with TTL (same pattern as 5.2); at-most-once (no reschedule via same id on downstream failure).

---

## Implementation Tasks

1. Heat scoring (account heat from posture + signals; DDB; **latest only** `sk=HEAT#LATEST`, optional daily rollup with TTL)
2. **Runtime pull budget state** + atomic consume (PerceptionPullBudgetStateV1; depth units: SHALLOW=1, DEEP=3)
3. **Connector throttling** — per-tenant per connector + optional global per connector (explicit semantics)
4. **Deterministic cadence + hysteresis** — HeatTierPolicyV1; promotion/demotion rules so no tier flapping
5. Pull orchestration (Step Functions or equivalent; idempotent job scheduling via `pull_job_id`; idempotency store with TTL, same pattern as 5.2)

---

## 1. Type Definitions

### File: `src/types/perception/PerceptionSchedulerTypes.ts` (new)

**Depth units (budget accounting)** — SHALLOW and DEEP consume different units so depth is real in budgets.

- **SHALLOW** = 1 unit (metadata only / deltas since last sync; cheap).
- **DEEP** = 3 units (example; full object graph or extended endpoints; expensive).

Configurable per connector if needed; default SHALLOW=1, DEEP=3.

---

**Account heat** — store **latest only** per account to avoid unbounded time-series. Optional daily rollup with TTL for analytics.

```typescript
export interface AccountHeatV1 {
  pk: string;   // TENANT#<tenant_id>#ACCOUNT#<account_id>
  sk: string;   // HEAT#LATEST (or HEAT#<date> for optional daily rollup with TTL)
  tenant_id: string;
  account_id: string;
  heat_score: number;   // 0–1
  heat_tier: 'HOT' | 'WARM' | 'COLD';
  factors?: {
    posture_score?: number;
    signal_recency?: number;
    signal_volume?: number;
  };
  computed_at: string;  // ISO
  updated_at: string;
}
```

---

**Pull job request** (output of scheduler; input to pull Step Functions or worker). **pull_job_id** required for idempotency (same pattern as 5.2).

```typescript
export interface PerceptionPullJobV1 {
  pull_job_id: string;   // required; derived from tenant/account/connector/depth/time-bucket for idempotency
  tenant_id: string;
  account_id: string;
  connector_id: string;
  depth: 'SHALLOW' | 'DEEP';  // SHALLOW=1 unit, DEEP=3 units (configurable)
  depth_units: number;   // 1 or 3 (or from config)
  scheduled_at: string;  // ISO
  correlation_id?: string;
  budget_remaining?: number;
}
```

---

**Per-tenant pull budget** (config)

```typescript
export interface PerceptionPullBudgetV1 {
  pk: string;   // TENANT#<tenant_id>
  sk: string;   // BUDGET#PULL
  tenant_id: string;
  max_pull_units_per_day?: number;   // total units per day (calls × depth_units)
  max_per_connector_per_day?: Record<string, number>;  // per connector cap
  updated_at: string;
}
```

---

**Runtime pull budget state** (like 5.1 AutonomyBudgetState) — **required for atomic consume**. Keyed by tenant + date (+ optional connector).

```typescript
export interface PerceptionPullBudgetStateV1 {
  pk: string;   // TENANT#<tenant_id>
  sk: string;   // BUDGET_STATE#<date_key> or BUDGET_STATE#<date_key>#CONNECTOR#<connector_id>
  tenant_id: string;
  date_key: string;   // YYYY-MM-DD
  connector_id?: string;   // optional for per-connector state
  units_consumed: number;   // total units consumed this day
  pull_count: number;      // number of pull jobs this day
  updated_at: string;
}
```

**Contract:** `checkAndConsumePullBudget(tenantId, connectorId, depthUnits)` must be **atomic** (DDB conditional write / atomic counter). Returns `{ allowed: boolean; remaining?: number }`. On concurrent calls, only one succeeds per budget cap.

---

**Deterministic cadence: HeatTierPolicyV1** (constants or config) — prevents tier flapping.

```typescript
export interface HeatTierPolicyV1 {
  tier: 'HOT' | 'WARM' | 'COLD';
  pull_cadence: string;   // e.g. '1h' (deep), '6h' (shallow), '3d' (shallow)
  default_depth: 'SHALLOW' | 'DEEP';
  promotion_signals_in_hours?: number;   // N signals in M hours to promote
  promotion_window_hours?: number;
  demotion_cooldown_hours?: number;      // cooldown before demotion so account doesn't flap
}
```

**Example mapping (reference):**

- **HOT:** deep every 1h + shallow on signal; promotion = 2+ signals in 1h; demotion cooldown = 4h.
- **WARM:** shallow every 6h; promotion = 1 signal in 6h; demotion cooldown = 24h.
- **COLD:** shallow every 3–7d; demotion cooldown = 48h.

---

**Connector throttling** — explicit semantics so limits are enforceable.

- **Per-tenant per connector:** `TenantConnectorDailyCap` (max units/calls per tenant per connector per day). Enforced via PerceptionPullBudgetStateV1 per connector.
- **Global per connector:** `ConnectorGlobalRateLimit` (RPS or max concurrency shared across tenants). Protects upstream APIs from burst.
- **Optional:** `TenantConnectorRateLimit` (per-tenant RPS cap).

**Contract:** Rate limits are enforced **per tenant+connector** and **optionally globally per connector** to protect upstream APIs. Orchestrator must check both before emitting a pull job.

---

## 2. Heat Scoring

**File:** `src/services/perception/HeatScoringService.ts`

- **Inputs:** Posture data, signal recency/volume (from Phase 1/2 or existing stores).
- **Output:** AccountHeatV1 (heat_score, heat_tier).
- **Storage:** DDB table; **latest only** per account (`sk=HEAT#LATEST`). Optionally write daily rollup with `sk=HEAT#<date>` and TTL for analytics; avoid unbounded time-series.
- **Triggers:** Recompute heat on signal arrival; periodic sweep for cold accounts. Used by pull orchestrator to decide depth and cadence.

**Logic (reference):** Hot = recent signals + high posture score; cold = low activity. Map to HOT/WARM/COLD or 0–1 score. Use **HeatTierPolicyV1** for promotion/demotion and hysteresis so accounts don’t flap.

---

## 3. Runtime Pull Budget State + Atomic Consume

**File:** `src/services/perception/PerceptionPullBudgetService.ts` (or equivalent)

- **State:** PerceptionPullBudgetStateV1 keyed by tenant + date (+ optional connector).
- **Contract:** `checkAndConsumePullBudget(tenantId, connectorId, depthUnits)` must be **atomic** (DDB conditional write / atomic counter). Returns `{ allowed: boolean; remaining?: number }`. On concurrent calls, only one succeeds per budget cap. Consume per-connector cap first, then tenant total; reject if either cap would be exceeded.
- **Units:** SHALLOW = 1 unit, DEEP = 3 units (configurable). Budget config uses `max_pull_units_per_day` (and per-connector caps). Without runtime state + atomic increments, you overspend under concurrency.

---

## 4. Connector Throttling Semantics

- **Per-tenant per connector:** TenantConnectorDailyCap (max units/calls per tenant per connector per day). Enforced via PerceptionPullBudgetStateV1 per connector.
- **Global per connector:** ConnectorGlobalRateLimit (RPS or max concurrency shared across tenants). Protects upstream APIs.
- **Optional:** TenantConnectorRateLimit (per-tenant RPS cap).
- **Contract:** Orchestrator checks **per tenant+connector** and **optionally global per connector** before emitting a pull job. Rate limits are enforced per tenant+connector and optionally globally per connector to protect upstream APIs.

---

## 5. Deterministic Cadence + Hysteresis

**File:** `src/services/perception/HeatTierPolicyService.ts` or config (HeatTierPolicyV1)

- **Cadence mapping (deterministic):** HOT = deep every 1h + shallow on signal; WARM = shallow every 6h; COLD = shallow every 3–7d. No ad-hoc logic; use a **deterministic table** (HeatTierPolicyV1).
- **Hysteresis:** Promotion requires N signals in M hours; demotion requires cooldown window so accounts don’t flap on noisy signals. Prevents connector and budget thrash.

---

## 6. Pull Orchestration

**File:** `src/services/perception/PerceptionPullOrchestrator.ts` or Step Functions state machine

- **Inputs:** Heat scores (latest per account), per-tenant pull budgets, **runtime budget state**, connector rate limits (tenant + optional global).
- **Outputs:** PerceptionPullJobV1 items (scheduled pull jobs) with **pull_job_id** for idempotency; explicit ledger entries for each pull decision.
- **Enforcement:** Cold accounts get fewer/shallower pulls; hot accounts get deeper coverage; never exceed per-tenant or per-connector caps. **Atomic consume** before emitting job; **idempotency store** (pull_job_id, TTL) so retries/schedules don’t duplicate (same pattern as 5.2).
- **Orchestrator order (avoid leaking budget):** (1) Check global/per-tenant rate limit *eligibility* (cheap). (2) Reserve idempotency key (dedupe). (3) Atomic consume budget. (4) Emit job / start SFN. Do not consume budget before rate-limit checks; otherwise jobs rejected by rate limits underutilize budgets.
- **Idempotency semantics (Phase 5):** at-most-once scheduling. If `pull_job_id` is reserved and the job fails downstream, we do not reschedule via the same id; the next cadence run will schedule a new job. (Two-phase RESERVED→COMPLETED can be added later if stronger delivery is needed.) For idempotency hits, use reason code **`DUPLICATE_PULL_JOB_ID`** in audit, metrics, and ledger.
- **Metrics:** Log/emit units consumed and pull decisions by **tenant**, **connector**, **depth**, and **tier** so tuning and cost analysis do not require schema changes.
- **Mechanism:** Step Functions or Lambda that evaluates heat + budget (atomic consume) + rate limits, then invokes connector pull workers (or emits jobs to a queue).

**Acceptance:** Cold accounts are cheap; hot accounts get deeper coverage; all pull decisions logged; no duplicate pulls under retry or multiple triggers.

---

## 7. CDK / Infrastructure

- **DDB:** Table or partition for AccountHeatV1 (latest per account); table for PerceptionPullBudgetV1 (config) and PerceptionPullBudgetStateV1 (runtime state); idempotency store for pull jobs (TTL).
- **Step Functions:** Optional state machine for pull workflow (schedule → **atomic checkAndConsumePullBudget** → invoke connector pull).
- **EventBridge:** Optional scheduled rule to run heat scoring and/or pull orchestration on cadence.
- **Zero trust:** All new resources (Lambda, DDB, IAM) must follow Phase 2 zero-trust and least privilege; tenant-scoped access where applicable.

---

## 8. Test Strategy (placeholder)

Unit tests for HeatScoringService, PerceptionPullBudgetService (atomic consume), HeatTierPolicyService, and PerceptionPullOrchestrator (budget, rate-limit, idempotency logic). Integration tests with real DDB and mock connectors (optional; env-gated, e.g. `RUN_PHASE5_3_INTEGRATION_TESTS=true`). Formal test plan **PHASE_5_3_TEST_PLAN.md** created; see [PHASE_5_3_TEST_PLAN.md](testing/PHASE_5_3_TEST_PLAN.md).

---

## Implementation Complete (2026-01-28)

- **Types:** `src/types/perception/PerceptionSchedulerTypes.ts`
- **Services:** HeatTierPolicyService, HeatScoringService, PerceptionPullBudgetService, PullIdempotencyStoreService, PerceptionPullOrchestrator
- **Handlers:** `heat-scoring-handler.ts`, `perception-pull-orchestrator-handler.ts`
- **Infrastructure:** PerceptionSchedulerInfrastructure (DDB heat/budget/idempotency; EventBridge SIGNAL_DETECTED + rate(1h))
- **Tests:** Unit (all five services + handlers); integration (env-gated, perception-scheduler.test.ts)

---

## Operational checks (don't skip)

### 1. Budget state reset / date_key consistency

- **date_key semantics:** All budget state uses **UTC** date keys: `new Date().toISOString().slice(0, 10)` → `YYYY-MM-DD`. Used in PerceptionPullBudgetService, AutonomyBudgetService, and autonomy-admin-api default.
- **Rollover:** No explicit “reset” job for perception pull budget. Rollover is **implicit**: each calendar day (UTC) uses a new DDB key (`BUDGET_STATE#<date_key>`), so previous days’ state is left as-is. No tenant timezone; design is UTC-only.
- **Consistency:** Scheduler (orchestrator → budget service), budget service consume, and admin/UI `getStateForDate(tenantId, dateKey)` all use the same UTC date_key. Metrics or dashboards that key by date should use the same UTC `YYYY-MM-DD` for alignment.

### 2. Global connector limit under burst

- **Per-tenant and per-connector caps** are enforced atomically in DDB via PerceptionPullBudgetService (conditional update / TransactWrite). Effective across all Lambdas that share the same table.
- **Global connector limit** (e.g. “max N pulls/min for connector X across all tenants”): the design exposes a **hook** only. `PerceptionPullOrchestrator` accepts an optional `rateLimitCheck(tenantId, connectorId)`; the handler does **not** pass it, so the default is a no-op (`() => Promise.resolve(true)`). There is no shared global limiter (no DDB/Redis token bucket, no SQS/SFN concurrency cap) in the current implementation.
- **Implication:** Under burst, many Lambdas can pass `rateLimitCheck` and only be bounded by per-tenant/per-connector budget. If upstream APIs require a global cap per connector, implement and inject a `rateLimitCheck` that uses a shared store (e.g. DDB counter or token bucket, or SQS concurrency) and wire it in the perception-pull-orchestrator-handler.

---

## References

- Parent: [PHASE_5_CODE_LEVEL_PLAN.md](PHASE_5_CODE_LEVEL_PLAN.md)
- Implementation Plan: [PHASE_5_IMPLEMENTATION_PLAN.md](PHASE_5_IMPLEMENTATION_PLAN.md) EPIC 5.3, Stories 5.3.1–5.3.2
