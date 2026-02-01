# Phase 7.4 — Outcomes Capture (Scaffolding): Code-Level Plan

**Status:** 🟢 **COMPLETE**  
**Created:** 2026-01-31  
**Parent:** [PHASE_7_CODE_LEVEL_PLAN.md](PHASE_7_CODE_LEVEL_PLAN.md)  
**Canonical contract:** [PHASE_7_IMPLEMENTATION_PLAN.md](PHASE_7_IMPLEMENTATION_PLAN.md) EPIC 7.4, Story 7.4.1  
**Prerequisites:** Phase 6 complete (plan lifecycle, execution, ledger). No dependency on Phase 7.1–7.3 for schema; capture can be implemented in parallel or after 7.3.

**Canonical version (2026-01-31).** Implement **this** version only. This plan uses: OutcomeSource, timestamp_utc_ms (UTC deterministic), plan-scoped PK default, capture-only-after-transition-commits, and required idempotency_key for key terminal events. Any copy that still has `timestamp: string (ISO 8601)` with Date.now()-style generation, PK defaulting to `TENANT#<tenant_id>` only (hot partition risk), or capture-before-commit without ledger_entry_id linkage is **deprecated**—do not implement.

---

## Overview

Phase 7.4 adds **write-only outcomes capture** to create the substrate for Phase 8+ learning. It does **not** train models, change decision logic, or alter execution behavior. Captured signals: approved vs rejected actions, seller edits, execution success/failure, plan completion reason, downstream outcomes (win/loss) where available. Stored in an Outcomes table (or equivalent) and linked to Plan Ledger for audit.

**Deliverables:**
- Outcomes event schema (approved/rejected, seller_edit, execution_outcome, plan_completion, downstream_outcome)
- Outcomes table (dedicated; no Plan Ledger fallback)
- OutcomesCaptureService (write-only): append outcome events from existing paths (plan approval, plan lifecycle, execution outcome, downstream when available)
- No new decision or execution logic; no training; no feedback loops in Phase 7

**Dependencies:** Phase 6 (plan approval, plan lifecycle, execution outcome, Plan Ledger). No dependency on Phase 7.1–7.3.

**Out of scope for 7.4:** Model retraining; self-improvement; adaptive behavior; reading outcomes back into decision or execution path.

---

## Implementation Tasks

1. Type definitions: OutcomeEventType, OutcomeEvent payload (approved/rejected, seller_edit, execution_outcome, plan_completion, downstream_outcome)
2. Outcomes table schema (DynamoDB or equivalent): partition/sort key for query by tenant, plan_id, time
3. OutcomesCaptureService: append(event) only; no read path for decision logic
4. Integration: call OutcomesCaptureService from plan approval path (approved vs rejected), plan lifecycle (completion reason), execution path (success/failure), downstream outcome ingestion when available (e.g. webhook or batch for win/loss)
5. Plan Ledger linkage: outcome event may reference plan_id, step_id, ledger_entry_id for audit trail
6. **Required tests:** OutcomesCaptureService unit (append, validation fail-fast, idempotency, dedupe-then-outcome repair); integration (approval + completion); DOWNSTREAM_* contract (data.opportunity_id). All tests required for definition of done.

---

## 1. Type Definitions

### File: `src/types/governance/OutcomeTypes.ts` (new)

**OutcomeEventType** — categories of outcome for learning substrate.

```typescript
export type OutcomeEventType =
  | 'ACTION_APPROVED'       // human or policy approved action/plan
  | 'ACTION_REJECTED'       // human or policy rejected
  | 'SELLER_EDIT'          // seller modified plan or action
  | 'EXECUTION_SUCCESS'    // step/action executed successfully
  | 'EXECUTION_FAILURE'    // step/action failed
  | 'PLAN_COMPLETED'       // plan reached COMPLETED (completion_reason: objective_met | all_steps_done)
  | 'PLAN_ABORTED'         // plan aborted
  | 'PLAN_EXPIRED'         // plan expired
  | 'DOWNSTREAM_WIN'       // optional: deal/opportunity closed won (later phase)
  | 'DOWNSTREAM_LOSS';     // optional: deal/opportunity closed lost (later phase)
```

**OutcomeSource** — origin of the outcome (human UI, policy gate, orchestrator, connector, downstream). Required for Phase 8 learning analysis.

**OutcomeEvent** — single outcome record (append-only). Use a **discriminated union** so TypeScript enforces plan_id for plan-linked events and account_id for downstream.

```typescript
/** Origin of the outcome (for Phase 8 learning analysis). */
export type OutcomeSource = 'HUMAN' | 'POLICY' | 'ORCHESTRATOR' | 'CONNECTOR' | 'DOWNSTREAM';

const PLAN_LINKED_EVENT_TYPES = [
  'ACTION_APPROVED', 'ACTION_REJECTED', 'SELLER_EDIT',
  'EXECUTION_SUCCESS', 'EXECUTION_FAILURE',
  'PLAN_COMPLETED', 'PLAN_ABORTED', 'PLAN_EXPIRED'
] as const;
export type PlanLinkedEventType = typeof PLAN_LINKED_EVENT_TYPES[number];

/** Plan-linked outcome: plan_id required so no orphan rows. */
export interface PlanLinkedOutcomeEvent {
  outcome_id: string;
  tenant_id: string;
  account_id?: string;
  plan_id: string;           // required for plan-linked
  step_id?: string;
  event_type: PlanLinkedEventType;
  source: OutcomeSource;
  timestamp_utc_ms: number;
  ledger_entry_id?: string;
  data: Record<string, unknown>;
}

/** Downstream outcome: plan_id optional; account_id required so events are joinable. */
export interface DownstreamOutcomeEvent {
  outcome_id: string;
  tenant_id: string;
  account_id: string;        // required for downstream
  plan_id?: string;
  event_type: 'DOWNSTREAM_WIN' | 'DOWNSTREAM_LOSS';
  source: 'DOWNSTREAM';
  timestamp_utc_ms: number;
  ledger_entry_id?: string;
  data: Record<string, unknown>;  // must include opportunity_id (see contract below)
}

export type OutcomeEvent = PlanLinkedOutcomeEvent | DownstreamOutcomeEvent;
```

**OutcomeCaptureInput** — discriminated union so callers cannot omit plan_id for plan-linked or account_id for downstream.

```typescript
export interface PlanLinkedOutcomeCaptureInput {
  tenant_id: string;
  account_id?: string;
  plan_id: string;
  step_id?: string;
  event_type: PlanLinkedEventType;
  source: OutcomeSource;
  ledger_entry_id?: string;
  data: Record<string, unknown>;  // idempotency_key required for ACTION_APPROVED, ACTION_REJECTED, PLAN_COMPLETED, PLAN_ABORTED, PLAN_EXPIRED
}

export interface DownstreamOutcomeCaptureInput {
  tenant_id: string;
  account_id: string;
  plan_id?: string;
  event_type: 'DOWNSTREAM_WIN' | 'DOWNSTREAM_LOSS';
  source: 'DOWNSTREAM';
  data: Record<string, unknown>;  // must include opportunity_id
}

export type OutcomeCaptureInput = PlanLinkedOutcomeCaptureInput | DownstreamOutcomeCaptureInput;

/** Returned when append is called with same idempotency_key (dedupe collision). Do not fetch outcome item; return this deterministic response only. */
export interface DuplicateOutcome {
  duplicate: true;
  outcome_id: string;  // from dedupe record
}
```

**Contract (plan_id / account_id):** Discriminated union enforces: for event_type in {ACTION_*, SELLER_EDIT, EXECUTION_*, PLAN_*} → **plan_id: string**; for DOWNSTREAM_* → **account_id: string** required, plan_id optional. Prevents orphan outcome rows.

**Standardized data fields (Phase 8–parseable):**

- **PLAN_* events (PLAN_COMPLETED, PLAN_ABORTED, PLAN_EXPIRED):** Standardize `data` so Phase 8 can parse without guessing. Required/expected: `completion_reason` (PLAN_COMPLETED), `aborted_reason` (PLAN_ABORTED), `expired_reason` (PLAN_EXPIRED), `terminal_state` (COMPLETED | ABORTED | EXPIRED). Avoid "Phase 8 can't parse outcomes" problems.
- **source === 'HUMAN':** Include **actor_id** (or `approved_by` / `edited_by`) in `data` for audit and later learning. Keep non-PII (e.g. user id, not email).
- **DOWNSTREAM_*:** Minimal contract: **required** `account_id` (enforced by input type); **required** `data.opportunity_id` (enforce at runtime, not just docs—see §3 validate). Optional: `close_date`, `amount`, `stage`. Otherwise downstream events become unjoinable.

---

## 2. Outcomes Table Schema

**Outcomes table (required; no fallback):** Dedicated Outcomes table only. Plan-scoped PK to avoid hot partitions. **Fail-fast:** If the Outcomes table is unavailable or misconfigured, append fails; do not fall back to Plan Ledger or other storage.

- **Partition key:** `pk` = `TENANT#<tenant_id>#PLAN#<plan_id>` for plan-linked events (ACTION_*, SELLER_EDIT, EXECUTION_*, PLAN_*). For DOWNSTREAM_* use `pk` = `TENANT#<tenant_id>#ACCOUNT#<account_id>`; **account_id is required** (discriminated union)—no `NO_PLAN` or missing account_id; fail validation if absent.  
- **Sort key:** `sk` = `OUTCOME#<timestamp_utc_ms>#<outcome_id>` (numeric timestamp + UUID for uniqueness and sort order).  
- **GSI1 (by plan):** `gsi1pk` = `PLAN#<plan_id>`, `gsi1sk` = `OUTCOME#<timestamp_utc_ms>` — list outcomes by plan.  
- **GSI2 (tenant-wide analytics):** `gsi2pk` = `TENANT#<tenant_id>#TYPE#<event_type>`, `gsi2sk` = `timestamp_utc_ms` — list by type for analytics.  
- **Idempotency (baseline):** **Conditional write with a companion dedupe record** (no GSI for dedupe). Dedupe item key: `pk` = `TENANT#<tenant_id>#PLAN#<plan_id>#TYPE#<event_type>#IDEMP#<idempotency_key>`, `sk` = `OUTCOME`. Store in dedupe: **outcome_id**, **outcome_pk**, **outcome_sk** (for “dedupe exists but outcome missing” retry). PutItem with `ConditionExpression: attribute_not_exists(pk)`. If condition fails → return deterministic `DuplicateOutcome` (outcome_id from dedupe); do not fetch outcome item. If outcome write fails after dedupe succeeds, retry path: GetItem dedupe → retry outcome PutItem. Simplest and cheapest; avoids GSI3.
- Append-only: no update/delete of outcome events.

**Storage intent (canonical):** **Plan Ledger** = audit trail (why something happened; append-only; query by plan_id/tenant for "why blocked/warned" and lifecycle events). **Outcomes table** = query/analytics substrate for learning (Phase 8+). Do not overuse the ledger for analytics; do not use the Outcomes table as the sole audit source for governance. See parent [PHASE_7_CODE_LEVEL_PLAN.md](PHASE_7_CODE_LEVEL_PLAN.md) § Implementation contract clarifications.

**No Plan Ledger extension for outcomes.** Using Plan Ledger as an Outcomes store is **out of scope** for 7.4; implement the dedicated Outcomes table only. Fail if the table is not provisioned.

---

## 3. OutcomesCaptureService

### File: `src/services/governance/OutcomesCaptureService.ts` (new)

**Contract:** Write-only. Append outcome events from existing paths. No read method used by decision or execution logic in Phase 7.

**Methods:**

- `append(input: OutcomeCaptureInput): Promise<OutcomeEvent | DuplicateOutcome>`
  - **Timestamp:** Derive **timestamp_utc_ms** from a single evaluation time at entry (e.g. from request context or passed-in evaluation_time). Do not use `Date.now()` scattered at call sites—keeps Phase 7 deterministic and sort key consistent.
  - **Validate (fail-fast):** Discriminated union enforces plan_id for plan-linked and account_id for downstream. Reject invalid input immediately: missing plan_id (plan-linked), missing account_id (DOWNSTREAM_*), missing data.opportunity_id (DOWNSTREAM_*), or missing idempotency_key for key terminal events. Do not fall back to optional behavior; throw or return a validation error.
  - Generate outcome_id (UUID) and build outcome pk/sk.
  - **Idempotency flow (key events only):** **First** conditional-write the **dedupe record** (pk = `TENANT#<tenant_id>#PLAN#<plan_id>#TYPE#<event_type>#IDEMP#<idempotency_key>`, sk = `OUTCOME`). Store in the dedupe record: **outcome_id**, **outcome_pk**, **outcome_sk** (so “dedupe exists but outcome missing” is repairable). `ConditionExpression: attribute_not_exists(pk)`.  
    - **If condition fails (collision):** Return a **deterministic `DuplicateOutcome`** response: `{ duplicate: true, outcome_id }`. To obtain outcome_id: **GetItem the dedupe record only** (one read); do **not** GetItem the outcome item—keeps the service write-only for outcome data. Explicitly permitted read: dedupe record only, for this collision case.  
    - **If condition succeeds:** Write the outcome item (PutItem with pk/sk). If outcome write **fails** (transient Dynamo error): on a **retry**, the client calls append again; dedupe write fails (record already exists). Then **treat “dedupe exists but outcome missing” as repairable:** GetItem the **dedupe record** to obtain outcome_id, outcome_pk, outcome_sk; retry PutItem of the outcome item using those keys and the same payload. One read (dedupe) + one write (outcome) for repair only.  
  - **Non-key events:** Write outcome item only (no dedupe record).
  - Return OutcomeEvent (or DuplicateOutcome). Do not read back for decision logic.

**Dependencies:** DynamoDB Outcomes table only. No Plan Ledger fallback for outcome storage. If the Outcomes table is unavailable, append fails; no silent fallback.

**Idempotency (baseline):** Callers **must** pass `idempotency_key` in `data` for PLAN_COMPLETED, PLAN_ABORTED, PLAN_EXPIRED, ACTION_APPROVED, ACTION_REJECTED. Uniqueness enforced via **conditional write on a companion dedupe record** (same table; key `TENANT#<tenant_id>#PLAN#<plan_id>#TYPE#<event_type>#IDEMP#<idempotency_key>`). Dedupe record stores outcome_id, outcome_pk, outcome_sk for retry when outcome write fails after dedupe. No GSI required.

---

## 4. Integration Points

**Plan approval path:** Capture outcome **only after the transition successfully commits** (and you have the ledger_entry_id for PLAN_APPROVED / PLAN_REJECTED). Call OutcomesCaptureService.append **after** PlanLifecycleService.transition succeeds, passing **ledger_entry_id** = the exact approval ledger entry. Do not capture "approved" if the transition failed—avoid "Outcome says approved but ledger says it never happened." If using a unit-of-work / transaction boundary, capture in the same boundary so outcome and ledger stay consistent. For APPROVED: append({ event_type: 'ACTION_APPROVED', plan_id, tenant_id, ledger_entry_id, source, data: { **actor_id** (or approved_by), approved_at, idempotency_key } }). For rejected (e.g. Policy Gate invalid): append({ event_type: 'ACTION_REJECTED', plan_id, tenant_id, ledger_entry_id, source, data: { reason, reasons, idempotency_key } }).

**Plan lifecycle (completion/abort/expiry):** When plan transitions to COMPLETED/ABORTED/EXPIRED, call append **after** transition commits. Pass event_type PLAN_COMPLETED | PLAN_ABORTED | PLAN_EXPIRED, plan_id, source (e.g. ORCHESTRATOR), ledger_entry_id = exact PLAN_COMPLETED/PLAN_ABORTED/PLAN_EXPIRED ledger entry, and data: { **completion_reason** (PLAN_COMPLETED), **aborted_reason** (PLAN_ABORTED), **expired_reason** (PLAN_EXPIRED), **terminal_state**, **idempotency_key** }.

**Execution path:** When step/action succeeds or fails, call append with event_type EXECUTION_SUCCESS | EXECUTION_FAILURE, plan_id, step_id, source (e.g. ORCHESTRATOR or CONNECTOR), data: { outcome_id?, error? }. Set ledger_entry_id to STEP_COMPLETED/STEP_FAILED ledger entry when available; fail-fast if required context is missing.

**Seller edit:** When seller modifies plan (e.g. edit step in DRAFT), call append with event_type SELLER_EDIT, plan_id, source: 'HUMAN', data: { **actor_id** (or edited_by), edited_fields, edited_at }.

**Downstream outcome:** When win/loss data is available (e.g. CRM webhook or batch job), call append with event_type DOWNSTREAM_WIN | DOWNSTREAM_LOSS, source: 'DOWNSTREAM', **account_id** (required), data: { **opportunity_id** (required), close_date?, amount?, stage? }. plan_id optional. If account_id or data.opportunity_id is missing, fail-fast; no fallback.

---

## 5. Plan Ledger Linkage

OutcomeEvent.ledger_entry_id references PlanLedgerEntry.entry_id when the outcome corresponds to a ledger event (e.g. plan approved → ledger PLAN_APPROVED; outcome ACTION_APPROVED with same context). **Always set ledger_entry_id to the exact approval/lifecycle ledger entry** after that transition commits—enables audit: "this outcome was recorded when this ledger event was written." Timestamp for the outcome should align with the same evaluation/commit boundary where possible (single evaluation time at entry).

---

## 6. CDK / Infrastructure

- **Outcomes table (required):** DynamoDB table with plan-scoped pk (TENANT#tenant_id#PLAN#plan_id or TENANT#tenant_id#ACCOUNT#account_id for DOWNSTREAM_*), sk = OUTCOME#timestamp_utc_ms#outcome_id; dedupe records use pk = TENANT#tenant_id#PLAN#plan_id#TYPE#event_type#IDEMP#idempotency_key, sk = OUTCOME. GSI1 (by plan), GSI2 (tenant + event_type). No GSI for idempotency. Create in GovernanceInfrastructure or Phase7Infrastructure construct. Environment: OUTCOMES_TABLE_NAME. **No alternative storage;** fail if table is not provisioned.

---

## 7. Test Strategy (all required)

See **testing/PHASE_7_4_TEST_PLAN.md** for full test plan (100% coverage + required integration tests). All of the following tests are **required** for definition of done. No test is optional.

- **Required — OutcomesCaptureService unit:** Append: verify PutItem called with correct pk/sk and payload; no read path used by service for decision logic. **Required.**
- **Required — Validation fail-fast:** Invalid input (missing plan_id for plan-linked, missing account_id or data.opportunity_id for DOWNSTREAM_*, missing idempotency_key for key events) is rejected immediately; no fallback. **Required.**
- **Required — Idempotency:** Same idempotency_key twice → only one outcome item exists; second call returns **DuplicateOutcome** (duplicate: true, outcome_id). Assert no duplicate outcome rows for that key. **Required.**
- **Required — Integration (approval + completion):** After plan approval and plan completion in test, query Outcomes table and assert outcome event exists with expected event_type and data. **Required.**
- **Required — DOWNSTREAM_* contract:** Assert data.opportunity_id is present when event_type is DOWNSTREAM_WIN or DOWNSTREAM_LOSS; runtime check and test. **Required.**
- **Required — Dedupe-then-outcome repair:** Simulate outcome write failure after dedupe succeeds; retry append and assert outcome item is written (GetItem dedupe → retry outcome PutItem). **Required.**

---

## References

- Parent: [PHASE_7_CODE_LEVEL_PLAN.md](PHASE_7_CODE_LEVEL_PLAN.md)
- Implementation Plan EPIC 7.4: [PHASE_7_IMPLEMENTATION_PLAN.md](PHASE_7_IMPLEMENTATION_PLAN.md)
- Phase 6 Plan Ledger: [../phase_6/PHASE_6_1_CODE_LEVEL_PLAN.md](../phase_6/PHASE_6_1_CODE_LEVEL_PLAN.md) §3
