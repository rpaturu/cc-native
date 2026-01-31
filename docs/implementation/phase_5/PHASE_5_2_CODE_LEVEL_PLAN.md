# Phase 5.2 — Decision Triggering & Scheduling: Code-Level Plan

**Status:** 🟢 **FROZEN** (production-shape; ready for implementation)  
**Created:** 2026-01-28  
**Last Updated:** 2026-01-28  
**Review:** Code-level review applied (determinism, storm prevention, DEFER semantics, idempotency, DecisionRunState). Second pass: IdempotencyStore, DEFER owner, run_count = ALLOW only. Third pass: DUPLICATE_IDEMPOTENCY_KEY, at-most-once failure semantics, RunState vs CostGate atomicity rule.  
**Parent:** [PHASE_5_CODE_LEVEL_PLAN.md](PHASE_5_CODE_LEVEL_PLAN.md)

---

## Overview

Phase 5.2 establishes when to run Phase 3 (Decision) in an always-on way:

- **DecisionTrigger** — registry of allowed trigger types; debounce and cooldown rules
- **DecisionScheduler** — emits RUN_DECISION events; integrates with EventBridge Scheduler
- **DecisionCostGate** — runs **before** Phase 3 (LLM); output **ALLOW | DEFER | SKIP** (canonical)

**Flow:** Signal → DecisionTrigger → **DecisionCostGate** → Phase 3 (LLM). No Phase 3 invocation when CostGate returns DEFER or SKIP.

**Dependencies:** Phase 3 (Decision API); Phase 4 (Ledger for audit). Phase 5.1 complete (autonomy config and budget) — CostGate may consult autonomy budget or tenant tier when evaluating ALLOW/DEFER/SKIP.

---

## Implementation Tasks

1. DecisionTrigger registry (types, debounce/cooldown semantics)
2. **DecisionRunState** storage (DDB) + atomic cooldown; **run_count_this_hour** incremented on ALLOW only
3. **IdempotencyStore** (DDB, pk=IDEMPOTENCY#<key>, TTL ~24h, conditional put for dedupe)
4. DecisionCostGate (pre-Phase-3 Lambda or step); on DEFER → emit **RUN_DECISION_DEFERRED**
5. **Requeue Lambda** (consumes RUN_DECISION_DEFERRED; creates single bounded retry)
6. DecisionScheduler (EventBridge Scheduler → RUN_DECISION); **required idempotency key**
7. Integration: Trigger → IdempotencyStore → CostGate → Phase 3 (or DEFER → requeue)

---

## 1. Type Definitions

### File: `src/types/decision/DecisionTriggerTypes.ts` (new)

**Trigger types**

```typescript
export type DecisionTriggerType =
  | 'SIGNAL_ARRIVED'
  | 'LIFECYCLE_STATE_CHANGE'
  | 'POSTURE_CHANGE'
  | 'TIME_RITUAL_DAILY_BRIEF'
  | 'TIME_RITUAL_WEEKLY_REVIEW'
  | 'TIME_RITUAL_RENEWAL_RUNWAY';

export interface DecisionTriggerRegistryEntryV1 {
  trigger_type: DecisionTriggerType;
  /** Per-trigger-type: min seconds between same trigger firing for same account */
  debounce_seconds: number;
  /** Global per-account: min seconds between any Phase 3 run for this account (recommended) */
  cooldown_seconds: number;
  max_per_tenant_per_hour?: number;
  max_per_account_per_hour?: number;  // hot-account storm prevention
}
```

**DecisionCostGate result** (canonical: use ALLOW | DEFER | SKIP everywhere)

- **DEFER** = “not now, try later” (deterministic retry; see `defer_until_epoch`).
- **SKIP** = “not worth it / blocked / out of budget” (no retry this cycle).

```typescript
export type DecisionCostGateResult = 'ALLOW' | 'DEFER' | 'SKIP';

export interface DecisionCostGateOutputV1 {
  result: DecisionCostGateResult;
  reason?: string;  // e.g. BUDGET_EXHAUSTED, COOLDOWN, MARGINAL_VALUE_LOW, DUPLICATE_IDEMPOTENCY_KEY
  explanation?: string;  // human-readable for audit
  evaluated_at: string;  // ISO
  /** Required when result === DEFER: epoch (seconds) after which a single retry is allowed */
  defer_until_epoch?: number;
  /** Alternative: retry after N seconds (scheduler uses this for single bounded retry) */
  retry_after_seconds?: number;
}
```

**DecisionCostGate input**

```typescript
export interface DecisionCostGateInputV1 {
  tenant_id: string;
  account_id: string;
  trigger_type: DecisionTriggerType;
  /** Run-count budget (recommended first); source: tenant config or rolling-window counter. Token-cost later if needed. Enforced in CostGate; optional in Trigger layer. */
  budget_remaining?: number;
  recency_last_run_epoch?: number;   // from DecisionRunState (global account cooldown)
  action_saturation_score?: number;  // e.g. how many actions already this period
  tenant_tier?: string;  // for tier-based caps
}
```

**RUN_DECISION event** (emitted by DecisionScheduler; consumed by CostGate then Phase 3)

- **Idempotency key is required.** Dedupe is enforced via **IdempotencyStore** (see §2b); CostGate/Phase 3 entry check it so EventBridge retries do not cause duplicate Phase 3 runs.

```typescript
export interface RunDecisionEventV1 {
  source: 'cc-native';
  'detail-type': 'RUN_DECISION';
  detail: {
    tenant_id: string;
    account_id: string;
    trigger_type: DecisionTriggerType;
    scheduled_at: string;  // ISO
    /** Required. e.g. sha256(tenant_id + account_id + trigger_type + scheduled_at_bucket). Used by CostGate/Phase 3 for dedupe. */
    idempotency_key: string;
    correlation_id?: string;
  };
}
```

**RUN_DECISION_DEFERRED event** (emitted by CostGate when result is DEFER; consumed by requeue Lambda)

```typescript
export interface RunDecisionDeferredEventV1 {
  source: 'cc-native';
  'detail-type': 'RUN_DECISION_DEFERRED';
  detail: {
    tenant_id: string;
    account_id: string;
    trigger_type: DecisionTriggerType;
    defer_until_epoch: number;
    retry_after_seconds?: number;
    original_idempotency_key: string;
    correlation_id?: string;
  };
}
```

**DecisionRunState** (DDB record for debounce/cooldown; enables atomic enforcement)

```typescript
export interface DecisionRunStateV1 {
  pk: string;   // TENANT#<tenant_id>#ACCOUNT#<account_id>
  sk: string;   // e.g. RUN_STATE#GLOBAL or RUN_STATE#TRIGGER#<trigger_type>
  last_allowed_at_epoch: number;   // last time CostGate returned ALLOW (Phase 3 run)
  last_deferred_at_epoch?: number;
  /** Optional: per-trigger-type last fire (for debounce) */
  last_trigger_at_by_type?: Record<DecisionTriggerType, number>;
  /** Incremented on ALLOW only (actual Phase 3 runs); used for max_per_account_per_hour. Aligns with cost. */
  run_count_this_hour?: number;
  updated_at: string;  // ISO
}
```

---

## 2b. IdempotencyStore (dedupe enforcement)

- **Purpose:** Dedupe by `idempotency_key` so EventBridge retries (or duplicate RUN_DECISION events) do not cause duplicate Phase 3 runs. **Independent of cooldown** — idempotency is per event, cooldown is per account/time.
- **Storage:** DynamoDB: `pk = IDEMPOTENCY#<idempotency_key>`, `sk` fixed (e.g. `METADATA`). **TTL ~ 24h** so keys expire.
- **Semantics:** **Conditional put** on first processing of a RUN_DECISION; if key already exists → treat as **DUPLICATE** and SKIP (do not invoke Phase 3); CostGate returns result SKIP with **reason: DUPLICATE_IDEMPOTENCY_KEY** for dashboards/audit. CostGate (or Phase 3 entry) checks IdempotencyStore before proceeding.
- **Failure after reserve:** **At-most-once (recommended for Phase 5):** If IdempotencyStore put succeeds but CostGate/Phase 3 execution fails, do not retry this event; rely on the next trigger cycle. Two-phase idempotency (RESERVED → COMPLETED with retry) can be added later if needed.

---

## 2. DecisionTrigger Registry and Cooldown Semantics

- **Storage:** Config table or JSON config (e.g. in Parameter Store or DDB).
- **Debounce vs cooldown (recommended):**
  - **Debounce:** per trigger type (seconds) — min time between same trigger firing for same account.
  - **Cooldown:** global per account (seconds) — min time between any Phase 3 run for this account. Yields simpler, stronger storm protection.
- **Usage:** Before emitting RUN_DECISION or invoking Phase 3, check debounce/cooldown and max_per_tenant_per_hour / max_per_account_per_hour.
- **Acceptance:** Triggers are bounded and observable; no trigger storms.

---

## 2a. DecisionRunState Storage and Atomic Cooldown

- **Storage:** DynamoDB table (or partition) keyed by `pk = TENANT#<tenant_id>#ACCOUNT#<account_id>`, `sk` for global vs per-trigger state.
- **Fields:** `last_allowed_at_epoch`, `last_deferred_at_epoch`, optionally `last_trigger_at_by_type`, `run_count_this_hour` (incremented on **ALLOW** only — actual Phase 3 runs; aligns with cost).
- **Atomic check:** Debounce/cooldown check and update must use **conditional write** (e.g. DynamoDB conditional update or compare-and-swap) so that under concurrent signals only one ALLOW can proceed; duplicate ALLOWs are prevented. Without atomicity, “no trigger storms” is aspirational.
- **Consumption:** CostGate (or a dedicated DecisionRunStateService) reads/updates this state; `recency_last_run_epoch` in DecisionCostGateInputV1 is populated from `last_allowed_at_epoch`.
- **Atomicity rule (do not flip order):** **DecisionRunState atomic update is the admission lock**; **CostGate is the policy/cost decision**. In practice: **acquire the RunState lock first** (conditional write), **then** evaluate CostGate. This ordering prevents storm amplification under concurrency; reversing it would allow multiple CostGate evaluations to proceed before the lock is taken.

---

## 3. DecisionCostGate (pre-Phase-3)

**File:** `src/services/decision/DecisionCostGateService.ts` or Lambda `decision-cost-gate-handler`

- **Input:** DecisionCostGateInputV1 (tenant_id, account_id, trigger_type, budget_remaining from tenant/rolling window, recency from DecisionRunState, action_saturation, tenant_tier).
- **Output:** DecisionCostGateOutputV1 (result: ALLOW | DEFER | SKIP, reason, explanation; when DEFER, include defer_until_epoch or retry_after_seconds).
- **Budget:** Run-count budgets first (simple, deterministic); token-cost later if needed. Enforced in CostGate; optional in Trigger layer.
- **Enforcement:** No Phase 3 invocation when result is DEFER or SKIP; all CostGate decisions logged (cost governance is auditable).
- **Location:** Invoked after DecisionTrigger fires and before Phase 3 LLM call (e.g. Step Functions state or Lambda in front of Phase 3).
- **Handler error handling:** If implemented as Lambda, await all async calls inside the handler's try block so rejections are caught; on error return 500 with a safe body (no stack or internal messages), per Phase 5.1 pattern.

**Acceptance:** Same input → same output (deterministic); all decisions logged.

---

## 4. DecisionScheduler

- **Mechanism:** EventBridge Scheduler (or equivalent) emits RUN_DECISION events on cadence (e.g. daily brief, weekly review).
- **Event:** RunDecisionEventV1; **idempotency_key required**; target: rule that triggers CostGate + Phase 3 pipeline.
- **Config:** Decision cadence is configurable per tenant/account (e.g. cron expressions in config table).
- **DEFER retry (owner):** When CostGate returns DEFER, it emits a **`RUN_DECISION_DEFERRED`** event (detail includes `defer_until_epoch` or `retry_after_seconds`). A small **requeue Lambda** consumes that event and creates the **single** bounded retry (e.g. EventBridge Scheduler one-off or SQS delayed). This keeps the main EventBridge Scheduler config simpler; CostGate owns the DEFER → retry contract.
- **Acceptance:** All scheduled runs are logged; no Phase 3 run without passing CostGate.

---

## 5. Integration: Trigger → CostGate → Phase 3

- **Step 1:** Trigger fires (signal, lifecycle change, or scheduler). Event carries **required idempotency_key**.
- **Step 2:** **IdempotencyStore** check (conditional put); if key already exists → SKIP as DUPLICATE (CostGate returns SKIP, reason **DUPLICATE_IDEMPOTENCY_KEY**). DecisionTrigger registry check (debounce/cooldown). **DecisionRunState** atomic update (**admission lock** — acquire first); only one ALLOW can proceed under concurrency.
- **Step 3:** **CostGate** (policy/cost decision, after lock): DecisionCostGate.evaluate(DecisionCostGateInputV1) → ALLOW | DEFER | SKIP. Input includes `recency_last_run_epoch` from DecisionRunState; budget is run-count (source: tenant config or rolling window).
- **Step 4:** If ALLOW → update DecisionRunState (`last_allowed_at_epoch`, increment `run_count_this_hour`), invoke Phase 3 (Decision API / LLM). If DEFER → CostGate emits **RUN_DECISION_DEFERRED**; requeue Lambda creates single bounded retry. If SKIP → log and do not invoke Phase 3.

**CDK:** EventBridge Scheduler, rule(s) for RUN_DECISION, DynamoDB for DecisionRunState and IdempotencyStore, Lambda for CostGate and requeue (DEFER), integration with Phase 3 entry point.

---

## 6. Test Strategy

See **[PHASE_5_2_TEST_PLAN.md](testing/PHASE_5_2_TEST_PLAN.md)** for unit tests (DecisionCostGateService ✅, DecisionIdempotencyStoreService ✅, DecisionRunStateService ✅, decision-cost-gate-handler optional, decision-deferred-requeue-handler optional) and optional integration tests (RUN_DECISION → CostGate → Phase 3 / DEFER / SKIP; RUN_DECISION_DEFERRED → one-time schedule; env-gated). For Lambda handlers, unit tests invoke with `(event, context, callback)` (or a wrapper that returns the result) and assert on error responses; see [PHASE_5_1_TEST_PLAN.md](testing/PHASE_5_1_TEST_PLAN.md) for pattern.

---

## References

- Parent: [PHASE_5_CODE_LEVEL_PLAN.md](PHASE_5_CODE_LEVEL_PLAN.md)
- Implementation Plan: [PHASE_5_IMPLEMENTATION_PLAN.md](PHASE_5_IMPLEMENTATION_PLAN.md) EPIC 5.2, Stories 5.2.1–5.2.3
