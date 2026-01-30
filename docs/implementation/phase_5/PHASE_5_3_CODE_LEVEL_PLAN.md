# Phase 5.3 — Perception Scheduler: Code-Level Plan

**Status:** 🟡 **PLANNING**  
**Created:** 2026-01-28  
**Last Updated:** 2026-01-28  
**Parent:** [PHASE_5_CODE_LEVEL_PLAN.md](PHASE_5_CODE_LEVEL_PLAN.md)

---

## Overview

Phase 5.3 establishes cost-safe **pull** orchestration for perception:

- **Heat scoring** — compute account heat from posture + signals; store in DDB
- **Pull orchestration** — schedule pull jobs based on heat + per-tenant budgets; enforce connector rate limits

**Deliverable:** PerceptionScheduler that decides *when to pull* and *how deep to go*. Cold accounts are cheap; hot accounts get deeper coverage.

**Dependencies:** Phase 1 (perception); Phase 2 (posture/signals); existing connector and cost budgets.

---

## Implementation Tasks

1. Heat scoring (account heat from posture + signals; DDB)
2. Pull orchestration (Step Functions or equivalent; per-tenant budgets, connector throttles)

---

## 1. Type Definitions

### File: `src/types/perception/PerceptionSchedulerTypes.ts` (new)

**Account heat**

```typescript
export interface AccountHeatV1 {
  pk: string;   // TENANT#<tenant_id>#ACCOUNT#<account_id>
  sk: string;   // HEAT#<computed_at_epoch_or_date>
  tenant_id: string;
  account_id: string;
  heat_score: number;   // 0–1 or tier (e.g. HOT, WARM, COLD)
  heat_tier?: 'HOT' | 'WARM' | 'COLD';
  factors?: {
    posture_score?: number;
    signal_recency?: number;
    signal_volume?: number;
  };
  computed_at: string;  // ISO
  updated_at: string;
}
```

**Pull job request** (output of scheduler; input to pull Step Functions or worker)

```typescript
export interface PerceptionPullJobV1 {
  tenant_id: string;
  account_id: string;
  connector_id: string;
  depth: 'SHALLOW' | 'DEEP';  // based on heat + budget
  scheduled_at: string;  // ISO
  correlation_id?: string;
  budget_remaining?: number;
}
```

**Per-tenant pull budget** (config)

```typescript
export interface PerceptionPullBudgetV1 {
  pk: string;   // TENANT#<tenant_id>
  sk: string;   // BUDGET#PULL
  tenant_id: string;
  max_pull_calls_per_day?: number;
  max_per_connector_per_day?: Record<string, number>;
  updated_at: string;
}
```

---

## 2. Heat Scoring

**File:** `src/services/perception/HeatScoringService.ts`

- **Inputs:** Posture data, signal recency/volume (from Phase 1/2 or existing stores).
- **Output:** AccountHeatV1 (heat_score or heat_tier).
- **Storage:** DDB table (e.g. `AccountHeat` or partition in existing table with sk HEAT#...).
- **Cadence:** Computed periodically (e.g. hourly or on signal arrival); used by pull orchestrator to decide depth and cadence.

**Logic (reference):** Hot = recent signals + high posture score; cold = low activity. Map to HOT/WARM/COLD or 0–1 score.

---

## 3. Pull Orchestration

**File:** `src/services/perception/PerceptionPullOrchestrator.ts` or Step Functions state machine

- **Inputs:** Heat scores, per-tenant pull budgets, connector rate limits.
- **Outputs:** PerceptionPullJobV1 items (scheduled pull jobs); explicit ledger entries for each pull decision.
- **Enforcement:** Cold accounts get fewer/shallower pulls; hot accounts get deeper coverage; never exceed per-tenant or per-connector caps.
- **Mechanism:** Step Functions or Lambda that evaluates heat + budget, then invokes connector pull workers (or emits jobs to a queue).

**Acceptance:** Cold accounts are cheap; hot accounts get deeper coverage; all pull decisions logged.

---

## 4. CDK / Infrastructure

- **DDB:** Table or partition for AccountHeatV1; optional table for PerceptionPullBudgetV1 if not in existing config store.
- **Step Functions:** Optional state machine for pull workflow (schedule → check budget → invoke connector pull).
- **EventBridge:** Optional scheduled rule to run heat scoring and/or pull orchestration on cadence.

---

## 5. Test Strategy (placeholder)

Unit tests for HeatScoringService and PerceptionPullOrchestrator (budget and rate-limit logic). Integration tests with real DDB and mock connectors (optional; skip with env flag). Formal test plan after implementation.

---

## References

- Parent: [PHASE_5_CODE_LEVEL_PLAN.md](PHASE_5_CODE_LEVEL_PLAN.md)
- Implementation Plan: [PHASE_5_IMPLEMENTATION_PLAN.md](PHASE_5_IMPLEMENTATION_PLAN.md) EPIC 5.3, Stories 5.3.1–5.3.2
