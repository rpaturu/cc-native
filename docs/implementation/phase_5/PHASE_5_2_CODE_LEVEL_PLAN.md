# Phase 5.2 — Decision Triggering & Scheduling: Code-Level Plan

**Status:** 🟡 **PLANNING**  
**Created:** 2026-01-28  
**Last Updated:** 2026-01-28  
**Parent:** [PHASE_5_CODE_LEVEL_PLAN.md](PHASE_5_CODE_LEVEL_PLAN.md)

---

## Overview

Phase 5.2 establishes when to run Phase 3 (Decision) in an always-on way:

- **DecisionTrigger** — registry of allowed trigger types; debounce and cooldown rules
- **DecisionScheduler** — emits RUN_DECISION events; integrates with EventBridge Scheduler
- **DecisionCostGate** — runs **before** Phase 3 (LLM); output **ALLOW | DEFER | SKIP** (canonical)

**Flow:** Signal → DecisionTrigger → **DecisionCostGate** → Phase 3 (LLM). No Phase 3 invocation when CostGate returns DEFER or SKIP.

**Dependencies:** Phase 3 (Decision API); Phase 4 (Ledger for audit).

---

## Implementation Tasks

1. DecisionTrigger registry (types, debounce/cooldown)
2. DecisionCostGate (pre-Phase-3 Lambda or step)
3. DecisionScheduler (EventBridge Scheduler → RUN_DECISION)
4. Integration: Trigger → CostGate → Phase 3

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
  debounce_seconds: number;
  cooldown_seconds: number;
  max_per_tenant_per_hour?: number;
}
```

**DecisionCostGate result** (canonical: use ALLOW | DEFER | SKIP everywhere)

```typescript
export type DecisionCostGateResult = 'ALLOW' | 'DEFER' | 'SKIP';

export interface DecisionCostGateOutputV1 {
  result: DecisionCostGateResult;
  reason?: string;  // e.g. BUDGET_EXHAUSTED, COOLDOWN, MARGINAL_VALUE_LOW
  explanation?: string;  // human-readable for audit
  evaluated_at: string;  // ISO
}
```

**DecisionCostGate input**

```typescript
export interface DecisionCostGateInputV1 {
  tenant_id: string;
  account_id: string;
  trigger_type: DecisionTriggerType;
  budget_remaining?: number;   // cost budget for Phase 3 runs
  recency_last_run_epoch?: number;
  action_saturation_score?: number;  // e.g. how many actions already this period
  tenant_tier?: string;  // for tier-based caps
}
```

**RUN_DECISION event** (emitted by DecisionScheduler; consumed by CostGate then Phase 3)

```typescript
export interface RunDecisionEventV1 {
  source: 'cc-native';
  'detail-type': 'RUN_DECISION';
  detail: {
    tenant_id: string;
    account_id: string;
    trigger_type: DecisionTriggerType;
    scheduled_at: string;  // ISO
    correlation_id?: string;
  };
}
```

---

## 2. DecisionTrigger Registry

- **Storage:** Config table or JSON config (e.g. in Parameter Store or DDB).
- **Usage:** Before emitting RUN_DECISION or before invoking Phase 3, check debounce/cooldown and max_per_tenant_per_hour.
- **Acceptance:** Triggers are bounded and observable; no trigger storms.

---

## 3. DecisionCostGate (pre-Phase-3)

**File:** `src/services/decision/DecisionCostGateService.ts` or Lambda `decision-cost-gate-handler`

- **Input:** DecisionCostGateInputV1 (tenant_id, account_id, trigger_type, budget_remaining, recency, action_saturation, tenant_tier).
- **Output:** DecisionCostGateOutputV1 (result: ALLOW | DEFER | SKIP, reason, explanation).
- **Enforcement:** No Phase 3 invocation when result is DEFER or SKIP; all CostGate decisions logged (cost governance is auditable).
- **Location:** Invoked after DecisionTrigger fires and before Phase 3 LLM call (e.g. Step Functions state or Lambda in front of Phase 3).

**Acceptance:** Same input → same output (deterministic); all decisions logged.

---

## 4. DecisionScheduler

- **Mechanism:** EventBridge Scheduler (or equivalent) emits RUN_DECISION events on cadence (e.g. daily brief, weekly review).
- **Event:** RunDecisionEventV1; target: rule that triggers CostGate + Phase 3 pipeline.
- **Config:** Decision cadence is configurable per tenant/account (e.g. cron expressions in config table).
- **Acceptance:** All scheduled runs are logged; no Phase 3 run without passing CostGate.

---

## 5. Integration: Trigger → CostGate → Phase 3

- **Step 1:** Trigger fires (signal, lifecycle change, or scheduler).
- **Step 2:** Optional: DecisionTrigger registry check (debounce/cooldown).
- **Step 3:** DecisionCostGate.evaluate(DecisionCostGateInputV1) → ALLOW | DEFER | SKIP.
- **Step 4:** If ALLOW → invoke Phase 3 (Decision API / LLM). If DEFER or SKIP → log and do not invoke Phase 3.

**CDK:** EventBridge Scheduler, rule(s) for RUN_DECISION, Lambda for CostGate, integration with Phase 3 entry point.

---

## 6. Test Strategy (placeholder)

Unit tests for DecisionCostGateService (determinism, ALLOW/DEFER/SKIP logic). Integration tests for Trigger → CostGate → no Phase 3 when SKIP (optional). Formal test plan after implementation.

---

## References

- Parent: [PHASE_5_CODE_LEVEL_PLAN.md](PHASE_5_CODE_LEVEL_PLAN.md)
- Implementation Plan: [PHASE_5_IMPLEMENTATION_PLAN.md](PHASE_5_IMPLEMENTATION_PLAN.md) EPIC 5.2, Stories 5.2.1–5.2.3
