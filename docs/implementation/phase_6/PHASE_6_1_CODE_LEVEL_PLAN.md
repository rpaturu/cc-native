# Phase 6.1 — RevenuePlan Schema + Policy: Code-Level Plan

**Status:** 🟢 **COMPLETE**  
**Created:** 2026-01-30  
**Last Updated:** 2026-01-30  
**Sign-off:** Phase 6.1 implemented; types, services (PlanRepository, PlanLifecycle, PlanPolicyGate, PlanLedger), handler, CDK (PlanInfrastructure), and unit tests passing.  
**Parent:** [PHASE_6_CODE_LEVEL_PLAN.md](PHASE_6_CODE_LEVEL_PLAN.md)  
**Canonical contract:** [PHASE_6_IMPLEMENTATION_PLAN.md](PHASE_6_IMPLEMENTATION_PLAN.md) EPIC 6.1, Stories 6.1.1–6.1.4

---

## Overview

Phase 6.1 establishes the plan schema, lifecycle state machine, Plan Policy Gate, ownership/authority rules, and Plan Ledger. No orchestration or execution in this sub-phase—validation and storage only.

**Deliverables:**
- RevenuePlanV1 and plan step schema (**step_id** stable UUID)
- DynamoDB: revenue-plans table + Plan Ledger (append-only)
- PlanLifecycleService (valid transitions only)
- PlanPolicyGateService (validation only; **can_activate** + reasons[])
- PlanLedgerService + event schema
- Plan lifecycle API (approve, pause, abort) with permission checks

**Dependencies:** Phase 4 (execution spine exists); Phase 5 (autonomy policy). Plan-step execution is Phase 6.3.

---

## Implementation Tasks

1. Type definitions (PlanTypes: RevenuePlanV1, PlanStepV1, PlanStatus, Policy Gate I/O, Plan Ledger events)
2. DynamoDB: revenue-plans table (keys + GSIs)
3. DynamoDB: Plan Ledger table (append-only, keys + GSI by plan_id)
4. PlanRepositoryService (or PlanService) — CRUD for plans; tenant/account scoped
5. PlanLifecycleService — transition validation and execution
6. PlanPolicyGateService — validation only; can_activate + reasons taxonomy
7. PlanLedgerService — append-only plan events
8. Plan lifecycle API handler (approve, pause, abort); auth model

---

## 1. Type Definitions

### File: `src/types/plan/PlanTypes.ts` (new)

**PlanStatus** (lifecycle states)

```typescript
export type PlanStatus =
  | 'DRAFT'
  | 'APPROVED'
  | 'ACTIVE'
  | 'PAUSED'
  | 'COMPLETED'
  | 'ABORTED'
  | 'EXPIRED';
```

**PlanStepStatus** (per-step state)

```typescript
export type PlanStepStatus =
  | 'PENDING'
  | 'PENDING_APPROVAL'
  | 'AUTO_EXECUTED'
  | 'DONE'
  | 'SKIPPED'
  | 'FAILED';
```

**PlanStepV1** — each step has a **stable step_id (UUID)**; identity is independent of array order.

```typescript
export interface PlanStepV1 {
  step_id: string;           // UUID, immutable; created at DRAFT time
  action_type: string;       // e.g. REQUEST_RENEWAL_MEETING
  status: PlanStepStatus;
  sequence?: number;         // optional display order; identity is step_id
  dependencies?: string[];  // optional step_ids that must be DONE before this
  constraints?: Record<string, unknown>;
}
// Retry count is NOT in plan schema. Track retries in orchestrator execution state (Phase 6.3); write retry outcomes to Plan Ledger only. Plans define intent, not execution counters.
```

**RevenuePlanV1**

```typescript
export interface RevenuePlanV1 {
  plan_id: string;
  plan_type: string;         // e.g. RENEWAL_DEFENSE (only one in 6.2)
  account_id: string;
  tenant_id: string;
  objective: string;
  plan_status: PlanStatus;
  steps: PlanStepV1[];
  constraints?: Record<string, unknown>;
  expires_at: string;        // ISO 8601; evaluated deadline for EXPIRED
  created_at: string;
  updated_at: string;
  approved_at?: string;
  approved_by?: string;
  completed_at?: string;
  aborted_at?: string;
  expired_at?: string;
  completion_reason?: 'objective_met' | 'all_steps_done';  // when COMPLETED
}
```

**Valid lifecycle transitions** (enforced by PlanLifecycleService):

- DRAFT → APPROVED
- APPROVED → ACTIVE (only when Policy Gate returns can_activate=true; orchestrator performs)
- ACTIVE → PAUSED | COMPLETED | ABORTED | EXPIRED
- PAUSED → ACTIVE | ABORTED
- COMPLETED | ABORTED | EXPIRED are terminal (no outgoing transitions)

---

## 2. Plan Policy Gate — Interface and Reasons Taxonomy

### File: `src/types/plan/PlanPolicyGateTypes.ts` (new)

**PlanPolicyGateInput** (for validation and can_activate evaluation)

```typescript
export interface PlanPolicyGateInput {
  plan: RevenuePlanV1;
  tenant_id: string;
  account_id: string;
  existing_active_plan_ids?: string[];  // same account + plan_type; for conflict check. Callers must supply; Policy Gate does not perform DB reads.
  preconditions_met: boolean;            // required (not optional); required approvals, dependencies, data
}
```

Implementation must treat `preconditions_met` as **required** (not optional). Tests assert this; optional would allow undefined and drift.

**PlanPolicyGateResult** (for APPROVED→ACTIVE; canonical evaluator)

```typescript
export interface PlanPolicyGateResult {
  can_activate: boolean;
  reasons: PlanPolicyGateReason[];  // empty if can_activate true; else list of blockers
}

export interface PlanPolicyGateReason {
  code: PlanPolicyGateReasonCode;
  message: string;  // human-readable
}

export type PlanPolicyGateReasonCode =
  | 'CONFLICT_ACTIVE_PLAN'      // another ACTIVE plan same account + plan_type
  | 'PRECONDITIONS_UNMET'       // required approvals / dependencies / data not met
  | 'RISK_ELEVATED'            // plan inherits high-risk step; needs elevated authority
  | 'INVALID_PLAN_TYPE'         // plan_type not allowed for tenant
  | 'STEP_ORDER_VIOLATION'      // dependencies or ordering invalid
  | 'HUMAN_TOUCH_REQUIRED';    // external contact etc. requires approval
```

**Approval-time validation** (plan can move to APPROVED): same types; use a separate method or a `validation_only` result that returns pass/fail + reasons (e.g. RISK_ELEVATED, INVALID_PLAN_TYPE, STEP_ORDER_VIOLATION). Policy Gate must be **deterministic**: same input → same output.

---

## 3. Plan Ledger — Event Schema (Append-Only)

### File: `src/types/plan/PlanLedgerTypes.ts` (new)

**PlanLedgerEventType** — typed events; append-only; no mutation or deletion.

```typescript
export type PlanLedgerEventType =
  | 'PLAN_CREATED'
  | 'PLAN_UPDATED'       // steps/constraints edited in DRAFT only (see rule below)
  | 'PLAN_APPROVED'
  | 'PLAN_ACTIVATED'
  | 'PLAN_PAUSED'
  | 'PLAN_RESUMED'
  | 'PLAN_ABORTED'
  | 'PLAN_COMPLETED'     // completion_reason: objective_met | all_steps_done
  | 'PLAN_EXPIRED'
  | 'STEP_STARTED'
  | 'STEP_COMPLETED'
  | 'STEP_SKIPPED'
  | 'STEP_FAILED';
```

**PlanLedgerEntry**

```typescript
export interface PlanLedgerEntry {
  entry_id: string;       // UUID
  plan_id: string;
  tenant_id: string;
  account_id: string;
  event_type: PlanLedgerEventType;
  timestamp: string;      // ISO 8601
  data: Record<string, unknown>;  // event-specific payload (e.g. reason, step_id, completion_reason)
}
```

**Rule:** **PLAN_UPDATED events may only be emitted while plan_status = DRAFT.** Prevents accidental mutation of APPROVED/ACTIVE plans.

**Storage:** Dedicated Plan Ledger table (append-only). Keys chosen so "why did this plan stop?" is a single query by plan_id (see §4).

---

### 3a. Ledger Event Schema — Per-Event Data and When Emitted (Deep)

| Event type     | Emitted when | data payload (required/optional) | Emitter |
|----------------|--------------|----------------------------------|--------|
| PLAN_CREATED   | Plan first persisted (DRAFT) | plan_id, plan_type, account_id, objective (optional: trigger) | PlanRepositoryService.putPlan or API |
| PLAN_UPDATED   | Steps/constraints edited; **only if plan_status = DRAFT** | plan_id, changed_fields (e.g. steps, constraints), reason? | API / service on draft update |
| PLAN_APPROVED  | DRAFT → APPROVED | plan_id, approved_by?, approved_at | PlanLifecycleService.transition |
| PLAN_ACTIVATED | APPROVED → ACTIVE | plan_id | PlanLifecycleService.transition |
| PLAN_PAUSED    | ACTIVE → PAUSED | plan_id, reason? | PlanLifecycleService.transition |
| PLAN_RESUMED   | PAUSED → ACTIVE | plan_id | PlanLifecycleService.transition |
| PLAN_ABORTED   | → ABORTED | plan_id, reason, aborted_at | PlanLifecycleService.transition |
| PLAN_COMPLETED | → COMPLETED | plan_id, completion_reason (objective_met \| all_steps_done), completed_at | PlanLifecycleService.transition (or Plan State Evaluator in 6.3) |
| PLAN_EXPIRED   | → EXPIRED | plan_id, expired_at | PlanLifecycleService.transition (or Plan State Evaluator in 6.3) |
| STEP_STARTED   | Step execution begins (6.3) | plan_id, step_id, action_type | Orchestrator |
| STEP_COMPLETED | Step succeeds (6.3) | plan_id, step_id, outcome? | Orchestrator |
| STEP_SKIPPED   | Step skipped with reason (6.3) | plan_id, step_id, reason | Orchestrator |
| STEP_FAILED    | Step fails (6.3) | plan_id, step_id, reason, attempt? | Orchestrator |

**Payload rule:** Every entry has plan_id, tenant_id, account_id, event_type, timestamp; `data` is event-specific. No mutation or deletion of historical events.

---

## 4. DynamoDB Tables (CDK)

### Table: RevenuePlans

- **Partition key:** `pk` (string) — `TENANT#<tenant_id>#ACCOUNT#<account_id>`
- **Sort key:** `sk` (string) — `PLAN#<plan_id>`
- **GSI1 (by status):** `gsi1pk` = `TENANT#<tenant_id>#STATUS#<plan_status>`, `gsi1sk` = `updated_at` — list plans by tenant and status (e.g. ACTIVE, PAUSED)
- **GSI2 (by account):** `gsi2pk` = `TENANT#<tenant_id>`, `gsi2sk` = `ACCOUNT#<account_id>#<updated_at>` — list plans by tenant, optionally filter by account
- **Access:** All reads/writes scoped by tenant_id (and account_id where applicable). No cross-tenant reads.
- **Condition writes:** Use conditional updates for status transitions (e.g. `plan_status = :expected_status`) to enforce state machine and prevent races.

**Item shape:** Store RevenuePlanV1 as the document; add `pk`, `sk`, `gsi1pk`, `gsi1sk`, `gsi2pk`, `gsi2sk` for DynamoDB. TTL optional (e.g. on COMPLETED/ABORTED/EXPIRED after retention period).

### Table: PlanLedger (append-only)

- **Partition key:** `pk` (string) — `PLAN#<plan_id>`
- **Sort key:** `sk` (string) — `EVENT#<timestamp>#<entry_id>` (ISO timestamp + entry_id for uniqueness)
- **GSI1 (by tenant):** `gsi1pk` = `TENANT#<tenant_id>`, `gsi1sk` = `PLAN#<plan_id>#<timestamp>` — list all plan events by tenant; or query by plan_id via base table.
- **Condition:** Use `ConditionExpression: 'attribute_not_exists(sk)'` on write (sk is unique per event: `EVENT#<timestamp>#<entry_id>`). Do not use `attribute_not_exists(pk)` — many items share the same pk (plan_id). Append-only: never update/delete.
- **Item:** PlanLedgerEntry + pk, sk, gsi1pk, gsi1sk; tenant_id and account_id in item for access control and audit.

**Location:** CDK in `src/stacks/` (e.g. new construct `PlanInfrastructure` or under existing stack). Table names via env: `REVENUE_PLANS_TABLE_NAME`, `PLAN_LEDGER_TABLE_NAME`.

---

### 4a. DynamoDB Keys + GSIs (Deep)

**RevenuePlans — Key formats and query patterns**

| Operation | Key / Query | Notes |
|-----------|-------------|--------|
| Get plan by tenant + account + plan_id | `GetItem(pk = TENANT#t1#ACCOUNT#a1, sk = PLAN#plan-uuid)` | Primary access path |
| List plans by tenant + status | GSI1: `Query(gsi1pk = TENANT#t1#STATUS#ACTIVE, gsi1sk between ...)` | List ACTIVE/PAUSED/DRAFT etc. |
| List plans by tenant + account | GSI2: `Query(gsi2pk = TENANT#t1, gsi2sk begins_with ACCOUNT#a1#)` | All plans for one account |
| existsActivePlanForAccountAndType | GSI1: `Query(gsi1pk = TENANT#t1#STATUS#ACTIVE)` then filter by account_id + plan_type in item | Or GSI2 query + filter; must scope by tenant |

**Key derivation (RevenuePlans item):**

- `pk` = `TENANT#${tenant_id}#ACCOUNT#${account_id}`
- `sk` = `PLAN#${plan_id}`
- `gsi1pk` = `TENANT#${tenant_id}#STATUS#${plan_status}` (must be updated on every status change)
- `gsi1sk` = `updated_at` (ISO 8601)
- `gsi2pk` = `TENANT#${tenant_id}`
- `gsi2sk` = `ACCOUNT#${account_id}#${updated_at}` (sort by time per account)

**Status transition conditional update:** `UpdateItem` with `ConditionExpression = 'plan_status = :from'` and `:from` = current status; set `plan_status = :to`, `updated_at`, `approved_at`/`completed_at`/`aborted_at`/`expired_at` as needed; update `gsi1pk` to new `TENANT#t#STATUS#<new_status>` so GSI1 reflects current status.

**PlanLedger — Key formats and query patterns**

| Operation | Key / Query | Notes |
|-----------|-------------|--------|
| Append event | `PutItem(pk = PLAN#plan_id, sk = EVENT#<timestamp>#<entry_id>, ...)` with `ConditionExpression: attribute_not_exists(sk)` | sk unique per event |
| Get all events for plan ("why did this stop?") | `Query(pk = PLAN#plan_id, sk begins_with EVENT#)`; sort ascending by sk (time) or descending for latest-first | Single partition query |

**Key derivation (PlanLedger item):**

- `pk` = `PLAN#${plan_id}`
- `sk` = `EVENT#${timestamp}#${entry_id}` (timestamp ISO 8601; entry_id UUID)
- `gsi1pk` = `TENANT#${tenant_id}`
- `gsi1sk` = `PLAN#${plan_id}#${timestamp}` (query all events for tenant, or by plan within tenant)

---

## 5. Services

### PlanRepositoryService (or PlanService)

**File:** `src/services/plan/PlanRepositoryService.ts` (new)

- `getPlan(tenantId: string, accountId: string, planId: string): Promise<RevenuePlanV1 | null>`
- `putPlan(plan: RevenuePlanV1): Promise<void>` — create or replace; enforce tenant/account scope. **DRAFT-only mutability:** when updating an existing plan, reject if stored plan has `plan_status !== 'DRAFT'` (steps and constraints are immutable outside DRAFT). Enforce at service layer so internal callers/tests cannot bypass API rules.
- `updatePlanStatus(tenantId: string, accountId: string, planId: string, newStatus: PlanStatus, options?: { completed_at?, aborted_at?, expired_at?, completion_reason? }): Promise<void>` — use conditional update so that current status matches expected; reject if invalid transition (or delegate to PlanLifecycleService)
- `listPlansByTenantAndStatus(tenantId: string, status: PlanStatus, limit?: number): Promise<RevenuePlanV1[]>`
- `listPlansByTenantAndAccount(tenantId: string, accountId: string, limit?: number): Promise<RevenuePlanV1[]>`
- `existsActivePlanForAccountAndType(tenantId: string, accountId: string, planType: string): Promise<{ exists: boolean; planId?: string }>` — for Policy Gate conflict check

All methods must scope by tenant_id (and account_id where applicable). No cross-tenant access.

---

### PlanLifecycleService

**File:** `src/services/plan/PlanLifecycleService.ts` (new)

- `transition(plan: RevenuePlanV1, toStatus: PlanStatus, options?: { reason?: string; completed_at?; aborted_at?; expired_at?; completion_reason? }): Promise<void>`
  - Validates transition against allowed matrix (DRAFT→APPROVED; APPROVED→ACTIVE; ACTIVE→PAUSED|COMPLETED|ABORTED|EXPIRED; PAUSED→ACTIVE|ABORTED).
  - Rejects invalid transitions (return error or throw); does not mutate.
  - On valid: updates plan in PlanRepositoryService; appends to PlanLedgerService with appropriate event type (PLAN_APPROVED, PLAN_ACTIVATED, PLAN_PAUSED, PLAN_ABORTED, PLAN_COMPLETED, PLAN_EXPIRED, etc.).
- **APPROVED→ACTIVE:** Caller (orchestrator) must have already received `can_activate=true` from PlanPolicyGateService; PlanLifecycleService only enforces that current status is APPROVED when transitioning to ACTIVE.

Dependency: PlanRepositoryService, PlanLedgerService. No Policy Gate call inside this service (Policy Gate is called by API or orchestrator before requesting transition).

---

### 5a. PlanLifecycleService — Transition Matrix (Deep)

**Allowed transitions (enforced in code):**

| From   | To        | Allowed | Ledger event   | Notes |
|--------|-----------|--------|----------------|-------|
| DRAFT  | APPROVED  | Yes    | PLAN_APPROVED  | API/orchestrator; validateForApproval first |
| APPROVED | ACTIVE  | Yes    | PLAN_ACTIVATED | Orchestrator only when can_activate=true |
| ACTIVE | PAUSED    | Yes    | PLAN_PAUSED    | API/orchestrator; optional reason in data |
| ACTIVE | COMPLETED | Yes   | PLAN_COMPLETED | completion_reason in options |
| ACTIVE | ABORTED   | Yes   | PLAN_ABORTED   | reason, aborted_at in options |
| ACTIVE | EXPIRED   | Yes   | PLAN_EXPIRED   | expired_at in options |
| PAUSED | ACTIVE    | Yes    | PLAN_RESUMED   | API/orchestrator; evaluateCanActivate first |
| PAUSED | ABORTED   | Yes    | PLAN_ABORTED   | reason, aborted_at |
| APPROVED | ABORTED | Yes    | PLAN_ABORTED   | reason, aborted_at |
| DRAFT  | (any other) | No   | —              | Reject |
| APPROVED | PAUSED/COMPLETED/EXPIRED | No | —        | Reject (APPROVED→only ACTIVE or ABORTED) |
| ACTIVE | DRAFT/APPROVED | No | —            | Reject |
| PAUSED | DRAFT/APPROVED/COMPLETED/EXPIRED | No | — | Reject |
| COMPLETED | *   | No    | —              | Terminal; no outgoing |
| ABORTED | *   | No    | —              | Terminal |
| EXPIRED | *   | No    | —              | Terminal |

**Edge cases to enforce:**

- Transition to same status: reject (no-op is not a valid transition).
- Null/undefined toStatus: reject.
- Plan not found or tenant/account mismatch: reject before transition check.
- Conditional update fails (concurrent status change): treat as invalid transition or retry with fresh read per product choice.

---

### PlanPolicyGateService

**File:** `src/services/plan/PlanPolicyGateService.ts` (new)

- `validateForApproval(plan: RevenuePlanV1, tenantId: string): Promise<{ valid: boolean; reasons: PlanPolicyGateReason[] }>` — allowed plan type, step ordering, risk accumulation (plan inherits highest-risk step), human-touch points. No execution; validation only.
- `evaluateCanActivate(input: PlanPolicyGateInput): Promise<PlanPolicyGateResult>` — returns **can_activate** and **reasons[]**. Checks: (1) conflict invariant (no other ACTIVE plan same account + plan_type), (2) preconditions met, (3) any other tenant/config rules. **Deterministic:** same input → same output. Used by API (when showing "why can't activate") and by orchestrator (before transitioning APPROVED→ACTIVE).

Reasons taxonomy: use PlanPolicyGateReasonCode (CONFLICT_ACTIVE_PLAN, PRECONDITIONS_UNMET, RISK_ELEVATED, INVALID_PLAN_TYPE, STEP_ORDER_VIOLATION, HUMAN_TOUCH_REQUIRED). Policy Gate must not perform state writes (read-only plus return result).

---

### 5b. Policy Gate Interface + Reasons Taxonomy (Deep)

**validateForApproval(plan, tenantId) → { valid, reasons[] }**

| Condition | valid | Reason code(s) |
|-----------|--------|----------------|
| plan_type not in allowed list for tenant | false | INVALID_PLAN_TYPE |
| Step dependencies invalid or order violation | false | STEP_ORDER_VIOLATION |
| Plan inherits highest-risk step and tenant requires elevated authority | false | RISK_ELEVATED |
| Human-touch required (e.g. external contact) not satisfied | false | HUMAN_TOUCH_REQUIRED |
| All checks pass | true | (empty reasons) |

**evaluateCanActivate(input: PlanPolicyGateInput) → { can_activate, reasons[] }**

| Condition | can_activate | Reason code(s) |
|-----------|--------------|----------------|
| existing_active_plan_ids includes another plan_id (same account + plan_type) | false | CONFLICT_ACTIVE_PLAN |
| preconditions_met === false | false | PRECONDITIONS_UNMET |
| Plan type not allowed (duplicate check if not done at approval) | false | INVALID_PLAN_TYPE |
| All checks pass | true | (empty reasons) |

**Contract:** Same input → same output (deterministic). Callers supply existing_active_plan_ids and preconditions_met; Policy Gate does not read from DB. Both methods return reasons[] with code + message for every blocker.

---

### PlanLedgerService

**File:** `src/services/plan/PlanLedgerService.ts` (new)

- `append(entry: Omit<PlanLedgerEntry, 'entry_id' | 'timestamp'>): Promise<PlanLedgerEntry>` — generate entry_id (UUID) and timestamp; write to PlanLedger table; **append-only** (no update/delete). Use **ConditionExpression: attribute_not_exists(sk)** on PutItem (sk is unique per event; see PlanLedger table §3). Do not use attribute_not_exists(pk).
- `getByPlanId(planId: string, limit?: number): Promise<PlanLedgerEntry[]>` — query pk = `PLAN#<plan_id>`, order by sk descending (or ascending by time). Answers "why did this plan exist?" and "why did it stop?".

Dependency: DynamoDB PlanLedger table. All writes are appends; no mutation or deletion of historical events.

---

## 6. API Routes and Auth Model

### Plan lifecycle API (approve, pause, abort)

**Handler:** `src/handlers/phase6/plan-lifecycle-api-handler.ts` (new)

**Routes (to be wired in API Gateway or existing API):**

- `POST /plans/:planId/approve` — transition DRAFT → APPROVED. **Auth:** Caller must have plan-approver authority (same as high-risk action approval, or explicit plan-approver role per Implementation Plan §2.8). **Flow:** Load plan; verify status = DRAFT; call PlanPolicyGateService.validateForApproval; if valid, call PlanLifecycleService.transition(plan, 'APPROVED'); write PLAN_APPROVED to ledger. Return 200 or 400 with reasons.
- `POST /plans/:planId/pause` — transition ACTIVE → PAUSED. **Auth:** Same authority (or role that can pause). **Flow:** Load plan; verify status = ACTIVE; PlanLifecycleService.transition(plan, 'PAUSED', { reason }); ledger PLAN_PAUSED.
- `POST /plans/:planId/resume` — transition PAUSED → ACTIVE. **Auth:** Same. **Flow:** Verify PAUSED; **always** call Policy Gate evaluateCanActivate before resuming (same semantics as APPROVED→ACTIVE); if can_activate=true, PlanLifecycleService.transition(plan, 'ACTIVE'); ledger PLAN_RESUMED. Do not resume without Policy Gate check.
- `POST /plans/:planId/abort` — transition ACTIVE | PAUSED | APPROVED → ABORTED. **Auth:** Same. **Flow:** Verify non-terminal; PlanLifecycleService.transition(plan, 'ABORTED', { reason, aborted_at }); ledger PLAN_ABORTED.

**Authority rule (6.1):** Document in this file or in a small auth module: "Plan approve/pause/abort require plan-approver role or same scope as high-risk action approval." Enforce via Cognito group or API key / IAM. Ownership change (account/seller transfer): define in 6.1—e.g. "plans in APPROVED/ACTIVE for transferred account auto-expire or transfer; rule TBD and enforced in orchestrator/API."

**Who can modify steps:** Only in DRAFT (explicit rule). Enforce in API: any endpoint that updates plan steps must reject if plan_status !== 'DRAFT'.

---

## 7. CDK / Infrastructure

- **RevenuePlans table:** Partition key pk, Sort key sk; GSI1 (tenant + status); GSI2 (tenant + account). Create in `PlanInfrastructure` construct or equivalent in `src/stacks/`.
- **PlanLedger table:** Partition key pk = PLAN#plan_id, Sort key sk = EVENT#timestamp#entry_id; GSI1 by tenant. Append-only; no TTL required for 6.1 (optional later).
- **API routes:** Wire POST /plans/:planId/approve, /pause, /resume, /abort to plan-lifecycle-api-handler; authorizer same as Control Center or plan-scoped role.
- **Environment:** REVENUE_PLANS_TABLE_NAME, PLAN_LEDGER_TABLE_NAME passed to Lambda/handler.

---

## 8. Contract: No Execution in 6.1

- Plan Policy Gate **validates only**; it does not trigger execution.
- APPROVED→ACTIVE transition is **allowed** by PlanLifecycleService when caller requests it (orchestrator will do so in 6.3 only when Policy Gate returns can_activate=true).
- No Phase 4 execution calls in 6.1; no orchestrator. Schema, lifecycle, policy gate, and ledger only.

---

## 9. Test Strategy — 100% Coverage Required

See **testing/PHASE_6_1_TEST_PLAN.md** for the full test plan. **100% test coverage** is required for Phase 6.1:

- **PlanLifecycleService:** Every allowed transition (matrix §5a); every disallowed transition (terminal states, invalid from→to); edge cases (same status, null toStatus, plan not found).
- **PlanPolicyGateService:** validateForApproval — every reason code (INVALID_PLAN_TYPE, STEP_ORDER_VIOLATION, RISK_ELEVATED, HUMAN_TOUCH_REQUIRED) and valid case; evaluateCanActivate — CONFLICT_ACTIVE_PLAN, PRECONDITIONS_UNMET, INVALID_PLAN_TYPE and valid case; deterministic (same input → same output).
- **PlanRepositoryService:** getPlan, putPlan (create + replace DRAFT), putPlan reject when stored status !== DRAFT, updatePlanStatus conditional update, listPlansByTenantAndStatus, listPlansByTenantAndAccount, existsActivePlanForAccountAndType.
- **PlanLedgerService:** append (sk uniqueness, condition), getByPlanId ordering.
- **Plan lifecycle API handler:** approve (DRAFT→APPROVED with validateForApproval; invalid plan/status → 400); pause (ACTIVE→PAUSED); resume (PAUSED→ACTIVE with evaluateCanActivate; reject when can_activate=false); abort (ACTIVE/PAUSED/APPROVED→ABORTED); auth rejection; 404/500 handling.
- **Ledger event schema:** Each event type emitted with correct data payload (per §3a).

---

## References

- Parent: [PHASE_6_CODE_LEVEL_PLAN.md](PHASE_6_CODE_LEVEL_PLAN.md)
- Canonical contract: [PHASE_6_IMPLEMENTATION_PLAN.md](PHASE_6_IMPLEMENTATION_PLAN.md) EPIC 6.1
- Phase 5.1 pattern: [../phase_5/PHASE_5_1_CODE_LEVEL_PLAN.md](../phase_5/PHASE_5_1_CODE_LEVEL_PLAN.md)
- Existing ledger: `src/services/ledger/LedgerService.ts`, `src/types/LedgerTypes.ts` (Plan Ledger is separate table; same append-only discipline)
