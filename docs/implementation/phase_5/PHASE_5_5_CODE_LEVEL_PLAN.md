# Phase 5.5 — Learning & Evaluation: Code-Level Plan

**Status:** 🟢 **IMPLEMENTED** (types, normalization, registry, calibration, shadow gate, unit tests)  
**Created:** 2026-01-28  
**Last Updated:** 2026-01-28 (review: registry, shadow gate, normalization completeness, provenance/rollback, tenant scoping)  
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
  tenant_id: string;          // GLOBAL for global defaults; tenant id for overrides
  action_type?: string;        // optional per-action-type weights
  weights: Record<string, number>;  // feature or factor -> weight
  calibrated_at: string;       // ISO
  shadow_mode_validated?: boolean;  // true if passed Shadow Mode gate
  // Provenance (required for audit and rollback)
  trained_on_range: { start: string; end: string };  // ISO date range
  data_volume: { n_outcomes: number };
  features_version: string;
  calibration_job_id: string;
  baseline_version_compared_to?: string;  // version we compared against in eval
  evaluation_summary?: string;  // short human-readable summary
  // Optional: structured gate decision for audits (better than parsing summary)
  evaluation_metrics?: {
    metric_name: string;
    baseline_value: number;
    candidate_value: number;
    uplift: number;
    sample_size: number;
    window_start: string;  // ISO
    window_end: string;    // ISO
  };
}
```

**RankingWeightsRegistryV1** (how production selects weights — versioned and reversible)

- **Hard rule:** Production ranking may use **only** weights whose registry status is `ACTIVE`.
- Shadow mode / calibration jobs write new weights as artifacts and register them as `CANDIDATE`; promotion to `ACTIVE` requires explicit gate pass (see §4 Shadow Mode gate).
- **Rollback contract:** Rollback = set registry `active_version` to the previous active version; rollback is instant and does **not** delete candidate or historical weight artifacts.

```typescript
export type RankingWeightsRegistryStatusV1 = 'ACTIVE' | 'CANDIDATE' | 'ROLLED_BACK';

export interface RankingWeightsRegistryV1 {
  tenant_id: string;           // GLOBAL or tenant id (see §7 tenant scoping)
  active_version: string;     // version used by production ranking
  candidate_version?: string; // version under evaluation (shadow)
  status: RankingWeightsRegistryStatusV1;
  activated_at: string;       // ISO
  activated_by: string;        // job id or "rollback"
  rollback_of?: string;       // version we rolled back from (for audit)
}
```

**Registry storage and writes (implementation note).** Store registry in DDB (or existing config store); key by `tenant_id`. On promotion/rollback:

- Use **conditional update** on `active_version` (e.g. conditional put or update with expected previous value) to avoid races.
- **Write a ledger entry** on promotion and on rollback (e.g. RANKING_WEIGHTS_PROMOTED, RANKING_WEIGHTS_ROLLED_BACK) so changes are auditable.

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

**Normalization completeness contract (avoid silent missing outcomes).** Learning pipelines fail silently if a large fraction of outcomes are never normalized.

- **Contract (choose one or both):**
  - For every ActionIntentV1 that reaches APPROVED or AUTO_EXECUTE, there must exist a NormalizedOutcomeV1 within N hours/days, or a ledger entry `NORMALIZATION_MISSING` (or equivalent) for that intent so the gap is visible.
  - **Or:** A daily reconciliation job: compare count(action outcomes that should be normalized) vs count(normalized outcomes) by tenant; alert or write reconciliation report when gap exceeds a threshold (e.g. > 5%).
- **Acceptance:** Missing normalization is detectable (reconciliation or NORMALIZATION_MISSING); no silent 30% gap.

---

## 3. Ranking Calibration

**File:** `src/services/learning/RankingCalibrationService.ts` or offline job (Lambda/Batch)

- **Inputs:** NormalizedOutcomeV1 stream or table.
- **Outputs:** RankingWeightsV1 (versioned, with provenance fields); write to weight store; register as **CANDIDATE** in RankingWeightsRegistryV1 (never ACTIVE until gate pass). Optionally confidence calibration tables (see §7).
- **Logic:** Offline jobs compute weights (e.g. by action_type, taxonomy); store with version, calibrated_at, trained_on_range, data_volume, features_version, calibration_job_id, baseline_version_compared_to, evaluation_summary. Production ranking **only** reads weights for the registry’s `active_version` per tenant (see §7).
- **Acceptance:** Learning does not affect policy; changes are versioned and reversible; production uses only ACTIVE weights from registry.

---

## 4. Learning Shadow Mode

**File:** `src/services/learning/ShadowModeService.ts` or offline pipeline

- **Purpose:** Before outcomes influence production ranking, run proposed actions offline; score them against actual seller behavior; do **not** surface to sellers.
- **Outputs:** ShadowModeScoreV1; gate: only if shadow score meets threshold, allow new weights to be promoted to ACTIVE in the registry.

**Shadow Mode gate (explicit and measurable).** Do not leave “meets threshold” vague; define one Phase-5 metric and gate so “Shadow Mode validated” is auditable.

- **Metric (pick one for Phase 5):**
  - **Agreement rate:** % of top-K suggested actions where the seller took a similar action within 7 days (e.g., same action_type or edited then approved).
  - **Or:** Uplift in IDEA_REJECTED rate for top-ranked actions (fewer rejections = better ranking).
  - **Or:** Edit-distance proxy for drafts (if draft outcomes are available).
- **Evaluation parameters (must be explicit):**
  - **Evaluation window:** e.g. 14 days of shadow traffic.
  - **Minimum sample size:** e.g. N outcomes per tenant (or global) below which we do not promote.
  - **Threshold:** e.g. candidate weights must achieve ≥ X% improvement over baseline (or ≥ Y agreement rate) to pass the gate.
- **Gate pass:** Only when the candidate version meets the metric threshold over the evaluation window with minimum sample size may `RankingWeightsRegistryV1.active_version` be updated to the candidate; until then, production uses only ACTIVE.
- **Acceptance:** Shadow mode gates production ranking changes; no production ranking update without a defined metric, window, sample size, and threshold.

---

## 5. Integration with Phase 3/4

- **Phase 4** emits ActionOutcome and ledger events; Phase 5.5 consumes these and normalizes with OutcomeTaxonomyV1.
- **Phase 3** approval/rejection events (if available) feed IDEA_REJECTED / IDEA_EDITED.
- **Production ranking:** Phase 3 (or decision layer) consumes ranking weights **only** via RankingWeightsRegistryV1: resolve `active_version` for the tenant (or GLOBAL), load RankingWeightsV1 for that version; only ACTIVE versions are used. No production ranking from CANDIDATE or unregistered weights.

---

## 6. Tenant scoping and confidence calibration

**Weights per-tenant (recommended).** In practice, enterprise systems need global defaults and tenant overrides.

- Store **global** weights with `tenant_id = 'GLOBAL'` in RankingWeightsV1 and in the registry (e.g. `RankingWeightsRegistryV1` for tenant_id = 'GLOBAL').
- Allow **tenant-specific** weights and registry rows to override; resolution order: **tenant active_version → GLOBAL active_version**.
- Ranking resolution: look up registry for tenant; if no tenant row or no active_version, fall back to GLOBAL registry and its active_version.

**Confidence calibration is separate from ranking and policy.** Confidence calibration tables (if implemented) must be explicitly scoped:

- **Do not** affect policy gates (policy remains independent of learned confidence).
- **May** affect UI confidence display and ranking tie-breakers only.
- Document in implementation: “Confidence calibration updates do not change policy; they only affect display and optional ranking tie-breaks.”

---

## 7. Test Strategy (placeholder)

Unit tests for OutcomeNormalizationService (taxonomy mapping), RankingCalibrationService, ShadowModeService, registry resolution (tenant → GLOBAL). Integration tests for normalization pipeline with real outcome data (optional). Formal test plan after implementation.

---

## 8. Summary: production-safe contracts (review checklist)

| Contract | Enforcement |
|--------|-------------|
| **Weights selection** | Production ranking only uses weights for `RankingWeightsRegistryV1.active_version` (ACTIVE); shadow/calibration writes CANDIDATE; promotion requires Shadow Mode gate pass. |
| **Shadow Mode gate** | Explicit metric (e.g. agreement rate or uplift), evaluation window, minimum sample size, threshold; only then may candidate become ACTIVE. |
| **Normalization completeness** | Reconciliation job or NORMALIZATION_MISSING ledger; no silent large gap between outcomes and normalized outcomes. |
| **Provenance + rollback** | RankingWeightsV1 has trained_on_range, data_volume, features_version, calibration_job_id, baseline_version_compared_to, evaluation_summary; rollback = set registry active_version to previous; rollback does not delete artifacts. |

---

## References

- Parent: [PHASE_5_CODE_LEVEL_PLAN.md](PHASE_5_CODE_LEVEL_PLAN.md)
- Implementation Plan: [PHASE_5_IMPLEMENTATION_PLAN.md](PHASE_5_IMPLEMENTATION_PLAN.md) EPIC 5.5, Stories 5.5.1–5.5.3

**Next (Phase 5.6 — Control Center APIs):** Expose registry state (ACTIVE/CANDIDATE), evaluation summaries, normalization gap reports, and rollback operations so operators can observe and control learning without touching data stores directly.
