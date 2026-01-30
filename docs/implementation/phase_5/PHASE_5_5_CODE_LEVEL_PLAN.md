# Phase 5.5 — Learning & Evaluation: Code-Level Plan

**Status:** 🟡 **PLANNING**  
**Created:** 2026-01-28  
**Last Updated:** 2026-01-28  
**Parent:** [PHASE_5_CODE_LEVEL_PLAN.md](PHASE_5_CODE_LEVEL_PLAN.md)

---

## Overview

Phase 5.5 implements outcome feedback for **ranking** (not policy):

- **OutcomeTaxonomyV1** — disambiguate failure modes (IDEA_REJECTED, IDEA_EDITED, EXECUTION_FAILED, EXECUTION_SUCCEEDED, NO_RESPONSE, NEGATIVE_RESPONSE)
- **Outcome normalization** — learning-ready format from ActionOutcome and approval/rejection events
- **Ranking calibration** — offline jobs compute better ranking weights
- **Learning Shadow Mode** — offline scoring of proposed actions vs. seller behavior; gate production ranking changes

**Constraint:** Learning tunes ranking and confidence — **never** policy. Changes are versioned and reversible.

**Dependencies:** Phase 4 (ActionOutcome, execution outcomes, ledger); Phase 3 (approval/rejection events).

---

## Implementation Tasks

1. OutcomeTaxonomyV1 type and application
2. Outcome normalization (learning-ready format)
3. Ranking calibration (offline jobs)
4. Learning Shadow Mode (offline scoring; gate production ranking)

---

## 1. Type Definitions

### File: `src/types/learning/LearningTypes.ts` (new)

**OutcomeTaxonomyV1** (canonical labels; use everywhere for outcomes)

```typescript
export type OutcomeTaxonomyV1 =
  | 'IDEA_REJECTED'    // human rejected the proposal
  | 'IDEA_EDITED'      // human edited then approved
  | 'EXECUTION_FAILED' // execution attempted and failed
  | 'EXECUTION_SUCCEEDED' // execution attempted and succeeded
  | 'NO_RESPONSE'      // (later) no response from recipient
  | 'NEGATIVE_RESPONSE';  // (later) negative response
```

**Normalized outcome (learning-ready)**

```typescript
export interface NormalizedOutcomeV1 {
  outcome_id: string;
  action_intent_id: string;
  tenant_id: string;
  account_id: string;
  taxonomy: OutcomeTaxonomyV1;
  action_type: string;
  confidence_score?: number;  // from Phase 3 at decision time
  executed_at?: string;       // ISO
  outcome_at: string;         // ISO
  metadata?: Record<string, unknown>;  // extensible
}
```

**Ranking weights / calibration (output of offline jobs)**

```typescript
export interface RankingWeightsV1 {
  version: string;            // e.g. "v1.0"
  action_type?: string;        // optional per-action-type weights
  weights: Record<string, number>;  // feature or factor -> weight
  calibrated_at: string;       // ISO
  shadow_mode_validated?: boolean;  // true if passed Shadow Mode
}
```

**Shadow Mode result** (offline; not surfaced to sellers)

```typescript
export interface ShadowModeScoreV1 {
  proposal_id: string;
  action_type: string;
  tenant_id: string;
  account_id: string;
  score: number;              // agreement with seller behavior or quality metric
  validated_at: string;       // ISO
  used_for_production: boolean;  // false until gated
}
```

---

## 2. Outcome Normalization + OutcomeTaxonomyV1

**File:** `src/services/learning/OutcomeNormalizationService.ts`

- **Inputs:** ActionOutcome (Phase 4), approval/rejection events (Phase 3), edits (if available).
- **Outputs:** NormalizedOutcomeV1 with **taxonomy** set (IDEA_REJECTED, IDEA_EDITED, EXECUTION_FAILED, EXECUTION_SUCCEEDED, etc.).
- **Logic:** Map approval/rejection to IDEA_REJECTED or IDEA_EDITED; map execution success/failure to EXECUTION_SUCCEEDED/EXECUTION_FAILED; later extend for NO_RESPONSE, NEGATIVE_RESPONSE.
- **Storage:** Learning-ready table or stream for downstream ranking jobs.

**Acceptance:** Every outcome used for learning has a taxonomy label; no conflated "success/failure" without disambiguation.

---

## 3. Ranking Calibration

**File:** `src/services/learning/RankingCalibrationService.ts` or offline job (Lambda/Batch)

- **Inputs:** NormalizedOutcomeV1 stream or table.
- **Outputs:** RankingWeightsV1 (versioned); optionally confidence calibration tables.
- **Logic:** Offline jobs compute weights (e.g. by action_type, taxonomy); store with version and calibrated_at. Production ranking consumes latest validated weights.
- **Acceptance:** Learning does not affect policy; changes are versioned and reversible.

---

## 4. Learning Shadow Mode

**File:** `src/services/learning/ShadowModeService.ts` or offline pipeline

- **Purpose:** Before outcomes influence production ranking, run proposed actions offline; score them against actual seller behavior; do **not** surface to sellers.
- **Outputs:** ShadowModeScoreV1; gate: only if shadow score meets threshold, allow new weights to be used in production.
- **Acceptance:** Shadow mode gates production ranking changes; no production ranking update without validation path (optional but recommended).

---

## 5. Integration with Phase 3/4

- **Phase 4** emits ActionOutcome and ledger events; Phase 5.5 consumes these and normalizes with OutcomeTaxonomyV1.
- **Phase 3** approval/rejection events (if available) feed IDEA_REJECTED / IDEA_EDITED.
- **Production ranking:** Phase 3 (or decision layer) may consume RankingWeightsV1 for "next best action"; only versions that passed Shadow Mode (or no gate initially) are used.

---

## 6. Test Strategy (placeholder)

Unit tests for OutcomeNormalizationService (taxonomy mapping), RankingCalibrationService, ShadowModeService. Integration tests for normalization pipeline with real outcome data (optional). Formal test plan after implementation.

---

## References

- Parent: [PHASE_5_CODE_LEVEL_PLAN.md](PHASE_5_CODE_LEVEL_PLAN.md)
- Implementation Plan: [PHASE_5_IMPLEMENTATION_PLAN.md](PHASE_5_IMPLEMENTATION_PLAN.md) EPIC 5.5, Stories 5.5.1–5.5.3
