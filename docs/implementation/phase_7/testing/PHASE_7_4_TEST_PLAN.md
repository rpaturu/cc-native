# Phase 7.4 Test Plan — Outcomes Capture (Scaffolding)

**Status:** 🟢 **COMPLETE**  
**Created:** 2026-01-31  
**Parent:** [../PHASE_7_4_CODE_LEVEL_PLAN.md](../PHASE_7_4_CODE_LEVEL_PLAN.md)  
**Canonical contract:** [../PHASE_7_IMPLEMENTATION_PLAN.md](../PHASE_7_IMPLEMENTATION_PLAN.md) EPIC 7.4, Story 7.4.1  
**Reference:** [../../phase_6/testing/PHASE_6_1_TEST_PLAN.md](../../phase_6/testing/PHASE_6_1_TEST_PLAN.md) — structure and coverage pattern

---

## Gap Analysis (vs 100% Coverage)

| Item | Plan § | Status | Notes |
|------|--------|--------|--------|
| **OutcomeTypes.test.ts** | §1 | 🔲 Pending | OutcomeEventType, OutcomeSource, PlanLinkedOutcomeEvent, DownstreamOutcomeEvent, OutcomeCaptureInput (discriminated), DuplicateOutcome; plan_id required plan-linked; account_id + data.opportunity_id required downstream. |
| **OutcomesCaptureService.append (success)** | §3 | 🔲 Pending | PutItem correct pk/sk/gsi1/gsi2; timestamp_utc_ms from single evaluation time; outcome_id UUID; ledger_entry_id; all event types (plan-linked + downstream). |
| **OutcomesCaptureService validation fail-fast** | §3 | 🔲 Pending | Missing plan_id (plan-linked); missing account_id (DOWNSTREAM_*); missing data.opportunity_id (DOWNSTREAM_*); missing idempotency_key for key events; reject immediately, no fallback. |
| **OutcomesCaptureService idempotency** | §3 | 🔲 Pending | Key events: dedupe record first (conditional write); collision → DuplicateOutcome (outcome_id from GetItem dedupe); second call returns duplicate, no second outcome item. |
| **OutcomesCaptureService dedupe-then-outcome repair** | §3 | 🔲 Pending | Outcome write fails after dedupe succeeds; retry append → GetItem dedupe → retry outcome PutItem; outcome item written; no duplicate outcome rows. |
| **OutcomesCaptureService non-key events** | §3 | 🔲 Pending | SELLER_EDIT, EXECUTION_SUCCESS, EXECUTION_FAILURE: write outcome only (no dedupe record). |
| **Integration: approval + completion** | §4 | 🔲 Pending | After plan approval and plan completion, query Outcomes table; assert event exists with event_type and data (ACTION_APPROVED, PLAN_COMPLETED). |
| **Integration: DOWNSTREAM_*** | §4 | 🔲 Pending | Append DOWNSTREAM_WIN/DOWNSTREAM_LOSS with account_id and data.opportunity_id; query table; assert event and data.opportunity_id. |
| **Integration: execution + seller edit** | §4 | 🔲 Pending | EXECUTION_SUCCESS/FAILURE and SELLER_EDIT captured; query and assert. |
| **Integration: dedupe-then-outcome repair E2E** | §3 | 🔲 Pending | Real table: first append dedupe succeeds, outcome PutItem fails (mock or fault); retry append; assert outcome item present. |
| **Outcomes table unavailable / no fallback** | §2, §3 | 🔲 Pending | Append fails when Outcomes table unavailable or misconfigured; no fallback to Plan Ledger; fail if table not provisioned. |

---

## Executive Summary

This document defines **100% test coverage** and **required integration tests** for Phase 7.4 (Outcomes Capture). Every append path, validation branch, idempotency flow (dedupe record, collision, DuplicateOutcome), dedupe-then-outcome repair, and integration point must be covered. All tests listed are **required** for definition of done (per code-level plan §7).

**Coverage target:** **100% statement and branch coverage** for `OutcomeTypes.ts` (if runtime-validated), `OutcomesCaptureService.ts` (including table-unavailable / no-fallback path); and integration tests for approval + completion, DOWNSTREAM_* contract, execution outcome, seller edit, and dedupe-then-outcome repair. No branch or statement in these modules may be uncovered.

---

## 1. Type Definitions — OutcomeTypes

**File:** `src/tests/unit/governance/OutcomeTypes.test.ts`

**Scope:** Type invariants, discriminated union shape, and runtime validation (if any) for plan_id / account_id / data.opportunity_id.

### OutcomeEventType / PlanLinkedEventType

| Scenario | Expected | Test |
|----------|----------|------|
| Plan-linked event types | ACTION_APPROVED, ACTION_REJECTED, SELLER_EDIT, EXECUTION_SUCCESS, EXECUTION_FAILURE, PLAN_COMPLETED, PLAN_ABORTED, PLAN_EXPIRED | Assert each is in PlanLinkedEventType; fixture passes type check. |
| Downstream event types | DOWNSTREAM_WIN, DOWNSTREAM_LOSS | Assert event_type union includes these. |

### PlanLinkedOutcomeEvent

| Scenario | Expected | Test |
|----------|----------|------|
| plan_id required | Omit plan_id → invalid (runtime validation or type guard) | Assert validation rejects or type narrows; plan_id required for plan-linked. |
| Optional step_id, ledger_entry_id | Present or omitted | Valid event with and without step_id, ledger_entry_id. |
| timestamp_utc_ms | number (UTC epoch ms) | Assert type is number; no ISO string. |
| source | OutcomeSource | HUMAN, POLICY, ORCHESTRATOR, CONNECTOR, DOWNSTREAM. |

### DownstreamOutcomeEvent

| Scenario | Expected | Test |
|----------|----------|------|
| account_id required | Omit account_id → invalid | Assert validation rejects or type enforces account_id for downstream. |
| plan_id optional | May be present or absent | Valid downstream event with and without plan_id. |
| source === 'DOWNSTREAM' | Enforced | Assert source is DOWNSTREAM for DOWNSTREAM_WIN/LOSS. |

### OutcomeCaptureInput (discriminated)

| Scenario | Expected | Test |
|----------|----------|------|
| Plan-linked input | plan_id required; idempotency_key in data for key events | PlanLinkedOutcomeCaptureInput: plan_id required; event_type in key set → data.idempotency_key required (validation). |
| Downstream input | account_id required; data.opportunity_id required | DownstreamOutcomeCaptureInput: account_id required; assert runtime validation requires data.opportunity_id. |

### DuplicateOutcome

| Scenario | Expected | Test |
|----------|----------|------|
| Shape | { duplicate: true, outcome_id: string } | Assert DuplicateOutcome has duplicate and outcome_id; outcome_id from dedupe record. |

### Standardized data fields (PLAN_*)

| Event type | Required/expected data | Test |
|------------|------------------------|------|
| PLAN_COMPLETED | completion_reason, terminal_state | Assert data shape documented or validated. |
| PLAN_ABORTED | aborted_reason, terminal_state | Assert data shape. |
| PLAN_EXPIRED | expired_reason, terminal_state | Assert data shape. |
| source === 'HUMAN' | actor_id or approved_by / edited_by | Assert data may include actor_id for audit. |

**Coverage:** Every event type; plan_id vs account_id discrimination; data.opportunity_id for downstream; idempotency_key for key events; DuplicateOutcome shape.

---

## 2. OutcomesCaptureService — Append (Success Paths)

**File:** `src/tests/unit/governance/OutcomesCaptureService.test.ts`

**Mock:** DynamoDBDocumentClient (PutCommand, GetCommand). Pass **evaluation_time_utc_ms** (or equivalent) at entry; service must not use Date.now() inside append.

### PutItem payload (plan-linked)

| Scenario | Expected | Test |
|----------|----------|------|
| pk | TENANT#<tenant_id>#PLAN#<plan_id> | Assert PutItem Item.pk for plan-linked event. |
| sk | OUTCOME#<timestamp_utc_ms>#<outcome_id> | Assert sk format; timestamp_utc_ms numeric; outcome_id UUID. |
| GSI1 | gsi1pk = PLAN#<plan_id>, gsi1sk = OUTCOME#<timestamp_utc_ms> | Assert GSI1 keys present. |
| GSI2 | gsi2pk = TENANT#<tenant_id>#TYPE#<event_type>, gsi2sk = timestamp_utc_ms | Assert GSI2 keys present. |
| timestamp_utc_ms | From single evaluation time at entry | Pass evaluation_time_utc_ms; assert outcome timestamp equals it (no Date.now() in service). |
| outcome_id | UUID generated | Assert outcome_id format; returned in OutcomeEvent. |
| ledger_entry_id | When provided | Assert payload includes ledger_entry_id when input has it. |

### PutItem payload (downstream)

| Scenario | Expected | Test |
|----------|----------|------|
| pk | TENANT#<tenant_id>#ACCOUNT#<account_id> | Assert pk for DOWNSTREAM_* uses account_id; no NO_PLAN or missing account_id. |
| sk | OUTCOME#<timestamp_utc_ms>#<outcome_id> | Same as plan-linked. |
| GSI1/GSI2 | Per schema | Assert GSI keys for downstream (plan_id optional in item). |

### Return type

| Scenario | Expected | Test |
|----------|----------|------|
| Success | OutcomeEvent (PlanLinkedOutcomeEvent or DownstreamOutcomeEvent) | Assert return has outcome_id, event_type, timestamp_utc_ms, plan_id or account_id per type; no read-back of outcome item for decision logic. |

### All plan-linked event types

| Event type | Test |
|------------|------|
| ACTION_APPROVED, ACTION_REJECTED | Append with plan_id, source, data (idempotency_key for key events); assert PutItem + dedupe flow (see §3). |
| SELLER_EDIT | Append; assert outcome item only (no dedupe); PutItem called once. |
| EXECUTION_SUCCESS, EXECUTION_FAILURE | Append; assert outcome item only; PutItem called once. |
| PLAN_COMPLETED, PLAN_ABORTED, PLAN_EXPIRED | Append with idempotency_key; assert dedupe then outcome (see §3). |

### Downstream event types

| Event type | Test |
|------------|------|
| DOWNSTREAM_WIN, DOWNSTREAM_LOSS | Append with account_id, data.opportunity_id; assert PutItem with pk TENANT#...#ACCOUNT#<account_id>; data.opportunity_id in payload. |

**Coverage:** Every event type; pk/sk/gsi1/gsi2; timestamp from evaluation time; no read path for decision logic.

---

## 3. OutcomesCaptureService — Validation Fail-Fast

**File:** Same as §2.

**Mock:** DynamoDBDocumentClient; no PutCommand/GetCommand invoked when validation fails.

### Plan-linked validation

| Scenario | Expected | Test |
|----------|----------|------|
| Missing plan_id | Reject immediately (throw or return validation error); no PutItem | Input with event_type plan-linked but plan_id missing or empty; assert reject; assert DynamoDB not called. |
| Invalid event_type for plan-linked | Reject if event_type not in PlanLinkedEventType | (Optional if type system prevents; else assert.) |

### Downstream validation

| Scenario | Expected | Test |
|----------|----------|------|
| Missing account_id | Reject immediately; no PutItem | Downstream input without account_id; assert reject; DynamoDB not called. |
| Missing data.opportunity_id | Reject immediately; no PutItem | Downstream input with account_id but data.opportunity_id missing; assert reject; enforce at runtime per plan §1. |

### Key events — idempotency_key required

| Event type | Required idempotency_key | Test |
|------------|--------------------------|------|
| ACTION_APPROVED, ACTION_REJECTED | data.idempotency_key | Omit idempotency_key; assert reject; no fallback. |
| PLAN_COMPLETED, PLAN_ABORTED, PLAN_EXPIRED | data.idempotency_key | Omit idempotency_key; assert reject. |

**Coverage:** Every invalid path; no fallback; no write on validation failure.

---

## 3a. Outcomes Table Unavailable / No Fallback (100% Coverage)

**File:** Same as §2.

**Contract (plan §2, §3):** Dedicated Outcomes table only. If the Outcomes table is unavailable or misconfigured, append fails; do not fall back to Plan Ledger or other storage. Fail if the table is not provisioned.

| Scenario | Expected | Test |
|----------|----------|------|
| DynamoDB PutItem (outcome or dedupe) fails (table unavailable) | append rejects (throw or return error); no Plan Ledger write | Mock DynamoDB to reject PutItem (e.g. ResourceNotFoundException or service error); assert append fails; assert no call to PlanLedgerService or fallback storage. |
| Table not provisioned (env missing) | Service fails at init or first append | When OUTCOMES_TABLE_NAME unset or invalid; assert append fails; no silent fallback. |

**Coverage:** Table-unavailable path; no Plan Ledger fallback; fail-fast when table not provisioned.

---

## 4. OutcomesCaptureService — Idempotency (Key Events)

**File:** Same as §2.

**Mock:** DynamoDBDocumentClient; first call: dedupe PutItem condition succeeds, outcome PutItem succeeds; second call: dedupe PutItem condition fails.

### Dedupe record write first

| Scenario | Expected | Test |
|----------|----------|------|
| Key event (e.g. ACTION_APPROVED) | First PutItem is **dedupe record** (pk = TENANT#...#PLAN#...#TYPE#...#IDEMP#<idempotency_key>, sk = OUTCOME) | Assert first PutCommand is dedupe key; ConditionExpression attribute_not_exists(pk). |
| Dedupe record stores outcome_id, outcome_pk, outcome_sk | For repair | Assert dedupe item contains outcome_id, outcome_pk, outcome_sk. |
| Second PutItem is outcome item | After dedupe succeeds | Assert second PutCommand is outcome pk/sk. |

### Collision (same idempotency_key twice)

| Scenario | Expected | Test |
|----------|----------|------|
| Second append same idempotency_key | Dedupe PutItem condition fails | Mock dedupe PutItem to fail condition (already exists). |
| Return DuplicateOutcome | { duplicate: true, outcome_id } | Assert return is DuplicateOutcome; outcome_id from GetItem dedupe only (do not GetItem outcome item). |
| Only one outcome item | No second outcome PutItem for same key | Assert outcome PutItem not called again for same idempotency_key on collision (dedupe read returns outcome_id; return DuplicateOutcome). |
| GetItem dedupe only | When collision, read **dedupe record only** to get outcome_id | Assert GetItem called with dedupe pk/sk only; not outcome item. |

**Coverage:** Dedupe-first order; conditional write; collision → DuplicateOutcome; outcome_id from dedupe; no duplicate outcome rows.

---

## 5. OutcomesCaptureService — Dedupe-Then-Outcome Repair

**File:** Same as §2.

**Mock:** First append: dedupe PutItem succeeds, outcome PutItem **fails** (transient error). Retry append: dedupe PutItem condition fails (record exists); GetItem dedupe returns outcome_id, outcome_pk, outcome_sk; outcome PutItem **succeeds**.

| Scenario | Expected | Test |
|----------|----------|------|
| First append: outcome write fails after dedupe | Dedupe record exists; outcome item missing | Simulate: dedupe PutItem success, outcome PutItem reject (e.g. throw). |
| Retry append (same input) | Dedupe write not repeated; GetItem dedupe to get outcome_id, outcome_pk, outcome_sk | Second call: dedupe PutItem condition fails; service does GetItem on dedupe record. |
| Retry outcome PutItem | PutItem outcome item with keys from dedupe and same payload | Assert PutItem called with outcome_pk, outcome_sk from dedupe; payload consistent. |
| Return OutcomeEvent | After repair, return OutcomeEvent (not DuplicateOutcome) | Assert return is full OutcomeEvent with outcome_id from dedupe. |
| Only one outcome row | No duplicate outcome items | After repair, only one outcome item for that idempotency_key. |

**Coverage:** Repair path; GetItem dedupe only; retry outcome write; no double outcome item.

---

## 6. OutcomesCaptureService — Non-Key Events (No Dedupe)

**File:** Same as §2.

| Event type | Expected | Test |
|------------|----------|------|
| SELLER_EDIT | Write outcome item only; no dedupe record | Append SELLER_EDIT; assert exactly one PutItem (outcome); no dedupe key PutItem. |
| EXECUTION_SUCCESS, EXECUTION_FAILURE | Write outcome item only | Same; one PutItem; no dedupe. |

**Coverage:** Non-key events do not use dedupe record; single PutItem.

---

## 7. Outcomes Table Schema (Unit Assertions)

**File:** Same as §2 or `OutcomesTableSchema.test.ts`.

| Item | Expected | Test |
|------|----------|------|
| Plan-linked pk | TENANT#<tenant_id>#PLAN#<plan_id> | Assert service builds pk from tenant_id, plan_id. |
| Downstream pk | TENANT#<tenant_id>#ACCOUNT#<account_id> | Assert pk uses account_id; fail if account_id missing. |
| sk | OUTCOME#<timestamp_utc_ms>#<outcome_id> | Assert format; sort order by timestamp. |
| Dedupe pk | TENANT#<tenant_id>#PLAN#<plan_id>#TYPE#<event_type>#IDEMP#<idempotency_key> | Assert dedupe key built only for key events. |
| Append-only | No UpdateItem/DeleteItem | Assert service never calls Update or Delete on outcome items. |

**Coverage:** Key shapes; no update/delete.

---

## 8. Integration Points (Call Sites)

**File:** Extend plan-lifecycle-api-handler.test.ts, PlanLifecycleService.test.ts, execution-path tests (or dedicated OutcomesCaptureIntegration.test.ts) with OutcomesCaptureService mock.

| Integration point | Trigger | Assertion |
|-------------------|---------|-----------|
| Plan approval (after transition commits) | PlanLifecycleService.transition(plan, 'APPROVED') succeeds | OutcomesCaptureService.append called **after** transition; event_type ACTION_APPROVED; plan_id, ledger_entry_id from approval ledger entry; data.idempotency_key. |
| Plan rejection (e.g. Policy Gate invalid) | Approval rejected | append called with event_type ACTION_REJECTED; plan_id, ledger_entry_id if available; data.reason/reasons, idempotency_key. |
| Plan completion/abort/expiry | transition to COMPLETED/ABORTED/EXPIRED | append called after transition; event_type PLAN_COMPLETED | PLAN_ABORTED | PLAN_EXPIRED; data.completion_reason/aborted_reason/expired_reason, terminal_state, idempotency_key. |
| Execution success/failure | Step execution completes | append EXECUTION_SUCCESS or EXECUTION_FAILURE; plan_id, step_id, source; ledger_entry_id when available. |
| Seller edit | Seller modifies plan (DRAFT) | append SELLER_EDIT; source HUMAN; data.actor_id or edited_by, edited_fields, edited_at. |
| Downstream | Win/loss ingestion | append DOWNSTREAM_WIN or DOWNSTREAM_LOSS; account_id required; data.opportunity_id required. |

**Coverage:** Each integration point invokes append with correct event_type and required fields; capture only after transition commits (approval/completion).

---

## 9. Test Structure and Locations

```
src/tests/
├── unit/
│   └── governance/
│       ├── OutcomeTypes.test.ts
│       ├── OutcomesCaptureService.test.ts
│       └── OutcomesTableSchema.test.ts              (optional; can merge into OutcomesCaptureService)
├── fixtures/
│   └── governance/
│       ├── plan-linked-outcome-input.json
│       ├── downstream-outcome-input.json
│       ├── outcome-event-plan-linked.json
│       └── outcome-event-downstream.json
└── integration/
    └── governance/
        └── outcomes-capture.test.ts                 (required; see §10)
```

---

## 10. Integration Tests (Required)

**Status:** **Required** for definition of done (per code-level plan §7). Run when `OUTCOMES_TABLE_NAME` is set (e.g. after deploy or env-gated).

**File:** `src/tests/integration/governance/outcomes-capture.test.ts`

**Required env:** OUTCOMES_TABLE_NAME (and tenant_id/account_id/plan_id used for test data).

### 10.1 Approval + completion flow

| Step | Action | Assertion |
|------|--------|-----------|
| 1 | Create plan (DRAFT) in RevenuePlans (or use existing plan fixture); get plan_id. | Plan exists. |
| 2 | Call plan approval path (or PlanLifecycleService.transition + OutcomesCaptureService.append) so plan becomes APPROVED; pass ledger_entry_id. | Transition succeeds; append called. |
| 3 | Query Outcomes table by plan_id (GSI1 or pk = TENANT#...#PLAN#plan_id). | One outcome with event_type ACTION_APPROVED; data includes idempotency_key, ledger_entry_id. |
| 4 | Transition plan to COMPLETED (or ABORTED/EXPIRED); call append after transition with PLAN_COMPLETED, completion_reason, idempotency_key. | Append succeeds. |
| 5 | Query Outcomes table by plan_id. | Outcome with event_type PLAN_COMPLETED; data.completion_reason, terminal_state. |
| Teardown | Delete test plan from RevenuePlans; delete outcome rows for test plan_id (and dedupe rows). | No leftover test data. |

### 10.2 DOWNSTREAM_* contract

| Step | Action | Assertion |
|------|--------|-----------|
| 1 | Append DOWNSTREAM_WIN with tenant_id, account_id, data.opportunity_id (e.g. opp-123). | append returns OutcomeEvent. |
| 2 | Query Outcomes table (pk = TENANT#...#ACCOUNT#<account_id>). | One outcome; event_type DOWNSTREAM_WIN; data.opportunity_id === 'opp-123'. |
| 3 | Append DOWNSTREAM_LOSS with account_id, data.opportunity_id. | append returns OutcomeEvent. |
| 4 | Query by account_id. | DOWNSTREAM_LOSS outcome with data.opportunity_id. |
| 5 | Append DOWNSTREAM_WIN **without** data.opportunity_id. | append **rejects** (validation fail-fast). |
| Teardown | Delete outcome rows for test account_id. | Cleanup. |

### 10.3 Execution outcome + seller edit

| Step | Action | Assertion |
|------|--------|-----------|
| 1 | Append EXECUTION_SUCCESS with plan_id, step_id, source ORCHESTRATOR. | append returns OutcomeEvent. |
| 2 | Query by plan_id. | Outcome EXECUTION_SUCCESS; step_id present. |
| 3 | Append EXECUTION_FAILURE with plan_id, step_id, data.error. | Query; EXECUTION_FAILURE present. |
| 4 | Append SELLER_EDIT with plan_id, source HUMAN, data.actor_id, edited_fields. | Query; SELLER_EDIT present. |
| Teardown | Delete outcome rows for test plan_id. | Cleanup. |

### 10.4 Idempotency (same idempotency_key twice)

| Step | Action | Assertion |
|------|--------|-----------|
| 1 | Append ACTION_APPROVED with plan_id, idempotency_key = 'idem-1'. | Returns OutcomeEvent. |
| 2 | Append again with same plan_id, same idempotency_key. | Returns DuplicateOutcome { duplicate: true, outcome_id }. |
| 3 | Query Outcomes table by plan_id. | **Only one** outcome item for that idempotency_key (no duplicate row). |
| Teardown | Delete outcome and dedupe rows. | Cleanup. |

### 10.5 Dedupe-then-outcome repair E2E

| Step | Action | Assertion |
|------|--------|-----------|
| 1 | Use a fault-injection or test double so that on first append: dedupe PutItem succeeds, outcome PutItem fails (e.g. conditional fail or mock DynamoDB to reject second PutItem once). | Dedupe record exists; outcome item missing. |
| 2 | Retry append with same input (same idempotency_key). | Service does GetItem dedupe; retries outcome PutItem. |
| 3 | Query Outcomes table. | Outcome item **exists** (repair succeeded). |
| 4 | Only one outcome item for that idempotency_key. | No duplicate. |
| Teardown | Delete dedupe and outcome rows. | Cleanup. |

**Note:** If fault injection is hard (e.g. DynamoDB local), alternative: unit test with mock (dedupe succeeds, outcome fails; retry with dedupe condition fail, GetItem returns keys, outcome PutItem succeeds) already covers repair logic; integration can assert idempotency and approval+completion only, with repair covered in unit.

**Coverage:** Approval + completion; DOWNSTREAM_* with opportunity_id and validation reject; execution + seller edit; idempotency no duplicate row; repair E2E if feasible.

---

## 11. Running Tests and Coverage Gates

### Unit tests (required)

```bash
npm test -- --testPathPattern=OutcomesCaptureService|OutcomeTypes
npm test -- --testPathPattern=governance/outcomes
```

### Coverage gate (100% for Phase 7.4 modules)

```bash
npm test -- --coverage \
  --collectCoverageFrom='src/types/governance/OutcomeTypes.ts' \
  --collectCoverageFrom='src/services/governance/OutcomesCaptureService.ts' \
  --testPathPattern=OutcomesCaptureService|OutcomeTypes
```

**Requirement:** 100% statement and branch coverage for:

- `src/types/governance/OutcomeTypes.ts` (if runtime validation present)
- `src/services/governance/OutcomesCaptureService.ts`

### Integration tests (required when env present)

```bash
npm run test:integration -- --testPathPattern=outcomes-capture
```

**Condition:** OUTCOMES_TABLE_NAME set (e.g. from deploy .env). If not set, skip with clear message or fail fast with "Outcomes table not configured."

---

## 12. Success Criteria — 100% Coverage + Integration Checklist

Phase 7.4 tests are complete when:

1. **OutcomeTypes:** All event types; PlanLinkedOutcomeEvent plan_id required; DownstreamOutcomeEvent account_id required; data.opportunity_id required for downstream; idempotency_key required for key events; DuplicateOutcome shape; PLAN_* data shape (completion_reason, aborted_reason, expired_reason, terminal_state).
2. **OutcomesCaptureService append (success):** PutItem with correct pk/sk/gsi1/gsi2 for plan-linked and downstream; timestamp_utc_ms from single evaluation time; outcome_id UUID; all event types (ACTION_APPROVED, ACTION_REJECTED, SELLER_EDIT, EXECUTION_*, PLAN_*, DOWNSTREAM_*); no read path for decision logic.
3. **Validation fail-fast:** Missing plan_id (plan-linked); missing account_id or data.opportunity_id (DOWNSTREAM_*); missing idempotency_key for ACTION_APPROVED, ACTION_REJECTED, PLAN_COMPLETED, PLAN_ABORTED, PLAN_EXPIRED; reject immediately; no PutItem on validation failure.
4. **Idempotency:** Key events: dedupe record first (conditional write); collision → DuplicateOutcome (outcome_id from GetItem dedupe only); second call returns duplicate; only one outcome item per idempotency_key.
5. **Dedupe-then-outcome repair:** Outcome write fails after dedupe succeeds; retry append → GetItem dedupe → retry outcome PutItem; outcome item written; return OutcomeEvent; no duplicate outcome rows.
6. **Non-key events:** SELLER_EDIT, EXECUTION_SUCCESS, EXECUTION_FAILURE: write outcome only; no dedupe record.
7. **Integration (approval + completion):** After plan approval and plan completion, query Outcomes table; assert event exists with expected event_type and data.
8. **Integration (DOWNSTREAM_*):** Append DOWNSTREAM_WIN/LOSS with account_id and data.opportunity_id; query and assert; append without opportunity_id rejected.
9. **Integration (execution + seller edit):** EXECUTION_SUCCESS/FAILURE and SELLER_EDIT captured; query and assert.
10. **Integration (idempotency):** Same idempotency_key twice → one outcome row; second call returns DuplicateOutcome.
11. **Integration (repair E2E):** Dedupe succeeds, outcome fails; retry append; outcome item present (if fault injection available).
12. **Coverage gate:** **100% statement and branch coverage** for OutcomeTypes and OutcomesCaptureService (including table-unavailable / no-fallback); CI passes; integration suite passes when OUTCOMES_TABLE_NAME is set.
13. **No fallback:** Outcomes table unavailable → append fails; no Plan Ledger fallback; no read path for decision logic.

---

## References

- [PHASE_7_4_CODE_LEVEL_PLAN.md](../PHASE_7_4_CODE_LEVEL_PLAN.md) — implementation plan (§1–§7)
- [PHASE_7_IMPLEMENTATION_PLAN.md](../PHASE_7_IMPLEMENTATION_PLAN.md) — EPIC 7.4 acceptance criteria
- [PHASE_6_1_TEST_PLAN.md](../../phase_6/testing/PHASE_6_1_TEST_PLAN.md) — structure reference
- [PHASE_6_4_TEST_PLAN.md](../../phase_6/testing/PHASE_6_4_TEST_PLAN.md) — integration test pattern (seed → invoke → teardown)
