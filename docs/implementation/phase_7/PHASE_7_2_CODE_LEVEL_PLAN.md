# Phase 7.2 — Budgets and Cost Classes: Code-Level Plan

**Status:** 🟢 **COMPLETE**  
**Created:** 2026-01-31  
**Parent:** [PHASE_7_CODE_LEVEL_PLAN.md](PHASE_7_CODE_LEVEL_PLAN.md)  
**Canonical contract:** [PHASE_7_IMPLEMENTATION_PLAN.md](PHASE_7_IMPLEMENTATION_PLAN.md) EPIC 7.2, Stories 7.2.1–7.2.3  
**Contracts addendum:** [PHASE_7_CONTRACTS_ADDENDUM.md](PHASE_7_CONTRACTS_ADDENDUM.md) §5 (Budget precedence, reserve-before-execute)  
**Prerequisites:** Phase 6 complete; Phase 7.1 not required for 7.2 core logic (budgets can be implemented in parallel after 7.1 types); recommend 7.1 first per implementation plan.

---

## Overview

Phase 7.2 introduces **cost classes** (CHEAP, MEDIUM, EXPENSIVE), **budget schema** (scope, period, hard_cap, soft_cap), and **BudgetService** with reserve-before-execute semantics. BudgetService is invoked by existing execution and tool-call paths; it does not schedule, defer, or re-order work. All budget decisions (reserve, BLOCK, WARN, ALLOW) are logged to the Plan Ledger.

**Deliverables:**
- Cost class enum and budget schema (scope, period, hard_cap, soft_cap)
- BudgetService: reserve-before-execute; BLOCK if any hard cap exceeded; WARN if any soft cap exceeded (no hard); else ALLOW
- Budget usage store: **reserved_count only** per scope and cost class (Phase 7 baseline; no consumed_count / no decrement on failure)
- Plan Ledger extension: budget event types (BUDGET_RESERVE, BUDGET_BLOCK, BUDGET_WARN)
- Instrument execution paths: tag operations with cost class; call BudgetService before EXPENSIVE (and optionally MEDIUM) operations

**Dependencies:** Phase 6 Plan Ledger; execution path / tool adapters for instrumentation. No dependency on Phase 7.1 for core BudgetService logic; use same ledger extension pattern as 7.1 when both are present.

**Out of scope for 7.2:** Scheduling or deferral of work; priority queues; cross-tenant optimization; increment-after-success without explicit reserve-before-execute contract.

---

## Implementation Tasks

1. Type definitions: CostClass, BudgetScope, BudgetConfig, BudgetServiceResult, budget ledger event payloads
2. Budget config store: per tenant/account/plan/tool, period (day/month), hard_cap, soft_cap per cost class
3. Budget usage store: reserve and consume per scope (tenant, account, plan, tool) and cost class; period key (e.g. day or month)
4. BudgetService: check caps; reserve before execute; return ALLOW/WARN/BLOCK; ledger every decision
5. Plan Ledger: extend event types for BUDGET_RESERVE, BUDGET_BLOCK, BUDGET_WARN
6. Instrument execution paths: tag cost class on tool/LLM calls; call BudgetService.reserve() before EXPENSIVE (and optionally MEDIUM); respect BLOCK (do not proceed); WARN annotates ledger only
7. Unit tests: BudgetService (precedence, reserve-before-execute, ledger); usage store (reserve, consume, period rollover); instrumentation (BLOCK prevents call, WARN does not)

---

## 1. Type Definitions

### File: `src/types/governance/BudgetTypes.ts` (new)

**CostClass** — baseline three classes (addendum; outline).

```typescript
export type CostClass = 'CHEAP' | 'MEDIUM' | 'EXPENSIVE';
```

**BudgetScope** — dimensions for scoping budgets and usage.

```typescript
export interface BudgetScope {
  tenant_id: string;
  account_id?: string;
  plan_id?: string;
  tool_id?: string;   // or operation type
}
```

**BudgetPeriod** — day or month; usage and caps are per period.

```typescript
export type BudgetPeriod = 'DAY' | 'MONTH';
```

**BudgetConfig** — per scope and period; hard_cap and optional soft_cap per cost class.

```typescript
export interface BudgetConfig {
  scope: BudgetScope;
  period: BudgetPeriod;
  /** Hard cap: exceeding → BLOCK. */
  hard_cap: Partial<Record<CostClass, number>>;
  /** Soft cap: exceeding (with no hard cap exceeded) → WARN. */
  soft_cap?: Partial<Record<CostClass, number>>;
}
```

**BudgetServiceResultKind** — ALLOW | WARN | BLOCK.

```typescript
export type BudgetServiceResultKind = 'ALLOW' | 'WARN' | 'BLOCK';
```

**BudgetServiceResult** — result of reserve or check. **details** must always include effective caps so metrics (7.3) and ledger consumers do not need to recompute config.

```typescript
export interface BudgetServiceResult {
  result: BudgetServiceResultKind;
  reason?: string;   // e.g. HARD_CAP_EXCEEDED, SOFT_CAP_EXCEEDED
  /** Always includes cap_hard (effective hard cap); cap_soft if any applicable soft cap. Plus usage_before, usage_after, matched_configs per §4. */
  details?: Record<string, unknown>;  // usage_before, usage_after, cap_hard, cap_soft?, matched_configs
}
```

**Contract:** BudgetServiceResult.details **always** includes **cap_hard** (computed effective hard cap) and **cap_soft** (if any applicable soft cap) so metrics emission (Phase 7.3) can publish BudgetHardCap/BudgetUsage without re-resolving config.

**ReserveRequest** — what to reserve before execution (addendum §5: reserve-before-execute). **operation_id** is required for idempotency so retries do not double-charge.

```typescript
export interface ReserveRequest {
  scope: BudgetScope;
  cost_class: CostClass;
  period_key: string;   // e.g. '2026-01-31' for DAY, '2026-01' for MONTH; derived from single evaluation time at request entry (no Date.now inside)
  /** Required. Idempotency key component; same (scope, period_key, cost_class, operation_id) returns original outcome and does not increment again. */
  operation_id: string;
  amount?: number;      // default 1 unit per call
}
```

**Idempotency (dedupe):** Same `(scope, period_key, cost_class, operation_id)` must return the **original outcome** (ALLOW/WARN/BLOCK) and **must not increment** usage again. Production retries (Lambda, network, tool adapter) will re-call reserve; dedupe prevents over-counting.

---

## 2. Budget Config Store and Applicable Config Matching

**Budget config (choose one; no fallback):** **Option A — Config file:** `src/config/budgetConfig.ts` — export getBudgetConfigs(scope, period): BudgetConfig[]; tenant-scoped; no cross-tenant reads. Returns **all applicable** configs per matching rules below. **Option B — DynamoDB:** Table keyed by tenant_id, scope (account_id, plan_id, tool_id when used), period_type. Item: BudgetConfig shape. GSI by tenant_id for list. Query returns all configs whose scope matches request scope. **Fail-fast:** Choose one at deploy time. If no applicable config is found for scope, BudgetService fails (or returns BLOCK with reason NO_APPLICABLE_CONFIG); do not assume unbounded/no limit.

**Applicable config matching (canonical):** A config **applies** if every non-null scope field in the config matches the request scope. Example: config with scope { tenant_id, account_id } applies to request scope { tenant_id, account_id, plan_id } (request has superset). Config with scope { tenant_id, tool_id } applies only when request has same tenant_id and tool_id.

**Precedence and enforcement (deterministic):** Resolve all applicable configs; order from **most-specific to least-specific** (e.g. tool+plan+account+tenant → tenant-only) for consistent evaluation. **Enforcement uses ANY applicable:**
- If **any** applicable hard cap would be exceeded (after this reserve) → BLOCK
- Else if **any** applicable soft cap would be exceeded (after this reserve) → WARN
- Else → ALLOW

This must be implemented as written; different selection logic causes production drift.

**Config shape:** hard_cap: { EXPENSIVE: 50, MEDIUM: 200 } (per day per tenant); soft_cap: { EXPENSIVE: 40 } (WARN at 40, BLOCK at 50).

---

## 3. Budget Usage Store

**Contract (addendum §5):** Reserve-before-execute. When an operation is about to run, BudgetService **reserves** the usage (increments **reserved_count** for the scope and period) **before** execution and writes the reservation to the ledger.

**Phase 7 baseline — reserved_count only:** Track **reserved_count** only. Caps apply to reserved_count. **No decrement on failure** (no consumed_count, no rollback when the operation fails). Optional later: add consumed_count for analytics only (not enforcement). This keeps Phase 7 deterministic and avoids turning budgets into a recovery/scheduler mechanism.

**Concurrency — atomic reserve only:** Budget **hard cap enforcement must be a single conditional update**, not read-then-write. **BudgetUsageStore.reserve** (or equivalent) must perform **one** DynamoDB operation: e.g. `UpdateItem` with `UpdateExpression: 'ADD reserved_count :amount'` and `ConditionExpression: 'reserved_count + :amount <= :hard_cap'` (using attribute_not_exists for initial zero). If the condition fails → do **not** reserve; return BLOCK and do not increment. Do **not** implement as: read current usage, then update—that is unsafe under concurrency.

**Dedupe (operation_id):** Before attempting the atomic reserve, check idempotency: if a prior reserve for the same `(scope, period_key, cost_class, operation_id)` already succeeded, return the **stored outcome** (ALLOW/WARN/BLOCK) and do not increment again. Store outcome keyed by operation_id (e.g. in same table with sk = OP#<operation_id>, or separate idempotency store). If no prior outcome, proceed with atomic reserve; on success store outcome for operation_id.

**Storage:** DynamoDB table or equivalent. Partition key: scope + period_key (e.g. TENANT#t1#DAY#2026-01-31). Sort key: cost_class (e.g. COST#EXPENSIVE). Attribute: **reserved_count** (number). For dedupe: store operation_id → outcome (e.g. GSI or secondary row keyed by operation_id). Conditional update: `ADD reserved_count :amount` only when `reserved_count + :amount <= :hard_cap` (and attribute_not_exists for new rows). Single row per (scope, period_key) with EXPENSIVE_reserved, MEDIUM_reserved, CHEAP_reserved is acceptable; each reserve is still one conditional update per cost_class.

**Methods (internal to BudgetService or separate BudgetUsageStore):**
- `getUsage(scope: BudgetScope, period_key: string): Promise<Record<CostClass, number>>` — read reserved_count per cost class (for ledger details and post-reserve WARN computation).
- `reserve(request: ReserveRequest, applicableHardCap: number): Promise<{ success: boolean; usage_after?: number }>` — **one** conditional update: ADD amount to reserved_count only if reserved_count + amount ≤ applicableHardCap. If condition fails, success = false, do not increment. If success, return usage_after = reserved_count + amount. Caller (BudgetService) resolves applicable hard cap from configs; usage store does not read config.

**Period key derivation:** Caller supplies period_key derived from a **single evaluation time** at request entry (e.g. evaluation_time_utc_ms or request timestamp). BudgetService must **not** call Date.now() inside reserve. Alternatively: caller passes evaluation_time_utc_ms and BudgetService derives period_key (e.g. DAY = YYYY-MM-DD from that ms). Same pattern as validators for determinism and replay.

---

## 4. BudgetService

### File: `src/services/governance/BudgetService.ts` (new)

**Naming:** Use `BudgetService` in governance folder to avoid confusion with existing AutonomyBudgetService / CostBudgetService. If name clash, use `GovernanceBudgetService` or `Phase7BudgetService`.

**Contract (addendum §5):** BLOCK if *any* applicable hard cap is exceeded. WARN if *any* applicable soft cap is exceeded and no hard cap is exceeded. Reserve-before-execute: reserve (increment) **before** execution; ledger the reservation. Do not schedule, defer, or re-order work; invoked inline by execution path.

**Methods:**

- `reserve(request: ReserveRequest): Promise<BudgetServiceResult>`
  1. **Dedupe:** If a prior reserve for same (scope, period_key, cost_class, operation_id) exists, return the stored outcome (ALLOW/WARN/BLOCK); do not reserve again. Ledger already written for that operation_id.
  2. Resolve all applicable BudgetConfigs per §2 (config applies if all non-null scope fields in config match request.scope; order most-specific → least-specific). Compute **effective hard cap** = minimum of all applicable hard_caps for request.cost_class (so we do not exceed *any* applicable cap); **effective soft cap** = minimum of all applicable soft_caps for request.cost_class. If no config applies, treat per product (e.g. no cap = allow without reserve, or default cap).
  3. **Atomic reserve:** Call usage store **once**: reserve(request.scope, request.period_key, request.cost_class, request.amount ?? 1, **effectiveHardCap**). The store performs **one conditional update** (e.g. DynamoDB ADD with ConditionExpression reserved_count + amount ≤ hard_cap). If condition fails → store returns success = false; do **not** increment. Return { result: 'BLOCK', reason: 'HARD_CAP_EXCEEDED', details: { scope, cost_class, cap_hard, usage_before, matched_configs, ... } }; append BUDGET_BLOCK to Plan Ledger.
  4. If atomic reserve succeeds, **usage_after = usage_before + amount** (or returned by store). **WARN is computed using usage_after_reserve** (the operation you are about to run is included). If any applicable soft cap is exceeded by usage_after → append BUDGET_WARN to Plan Ledger; return { result: 'WARN', reason: 'SOFT_CAP_EXCEEDED', details: { usage_before, usage_after, cap_soft, matched_configs, ... } }.
  5. Else (no soft cap exceeded) → append BUDGET_RESERVE to Plan Ledger; return { result: 'ALLOW', details: { usage_before, usage_after, ... } }.
  6. Store outcome for (scope, period_key, cost_class, operation_id) for dedupe.
  7. Deterministic: same scope, period_key, cost_class, operation_id, caps → same result.

**Dependencies:** Budget config (getBudgetConfigs), Budget usage store (getUsage, reserve with **one** conditional update), Plan Ledger (append), idempotency store for operation_id → outcome.

**Ledger payloads (explainability):** Include pre/post usage and matched configs so CFO/ops can interpret.
- BUDGET_RESERVE: scope, period_key, cost_class, amount, result: ALLOW, **usage_before**, **usage_after**, **cap_hard**, **cap_soft**? (if any), **matched_configs**? (ids or scope descriptors)
- BUDGET_BLOCK: scope, period_key, cost_class, result: BLOCK, reason: HARD_CAP_EXCEEDED, **usage_before**, **cap_hard**, **matched_configs**? (do not reserve, so usage_after = usage_before)
- BUDGET_WARN: scope, period_key, cost_class, amount, result: WARN, **usage_before**, **usage_after** (post-reserve), **cap_soft**, **matched_configs**?

---

## 5. Plan Ledger Extension (Budget Events)

### File: `src/types/plan/PlanLedgerTypes.ts` (extend)

**Add to PlanLedgerEventType:**

```typescript
  | 'BUDGET_RESERVE'
  | 'BUDGET_BLOCK'
  | 'BUDGET_WARN';
```

**Payload (data):** scope (tenant_id, account_id?, plan_id?, tool_id?), period_key, cost_class, operation_id?, result (ALLOW/WARN/BLOCK), reason?, amount?, **usage_before**, **usage_after**?, **cap_hard**?, **cap_soft**?, **matched_configs**? (config ids or scope descriptors for explainability).

---

## 6. Instrument Execution Paths

**Where:** Tool adapters, LLM gateway, or execution path that performs EXPENSIVE (and optionally MEDIUM) operations. Phase 6 / Phase 4 execution spine: identify call sites for "expensive read" or "LLM call" or "enrichment."

**Steps:**
1. Tag the operation with CostClass (e.g. EXPENSIVE for LLM, MEDIUM for standard API, CHEAP for cache read). Use constant or config per operation type.
2. Before invoking the operation: build ReserveRequest (scope from tenant/account/plan, cost_class, period_key from **single evaluation time at request entry** (no Date.now() inside BudgetService), **operation_id** (e.g. request id or deterministic id for this operation)).
3. Call BudgetService.reserve(request).
4. If result.result === 'BLOCK': do **not** invoke the operation; return error or throttle; ledger already written by BudgetService.
5. If result.result === 'WARN': invoke the operation; ledger already written; surface WARN in response/UI per product (required: ledger; UI surfacing per integration).
6. If result.result === 'ALLOW': invoke the operation.

**No new execution paths:** Only wrap existing calls with reserve-check; do not add scheduling or queues.

---

## 7. CDK / Infrastructure

- **Budget config:** Config file in repo or SSM/Parameter Store; no DynamoDB required for Option A.
- **Budget usage store:** DynamoDB table. Partition key: pk = scope + period_key (e.g. TENANT#t1#DAY#2026-01-31). Sort key: sk = COST#<cost_class>. Attribute: **reserved_count** (number). **One conditional update per reserve:** UpdateItem with ADD reserved_count :amount and ConditionExpression `reserved_count + :amount <= :hard_cap` (and attribute_not_exists for new rows). No read-then-write. For dedupe: store operation_id → outcome (e.g. GSI or separate idempotency table keyed by operation_id).
- **Environment:** BUDGET_CONFIG_PATH or BUDGET_TABLE_NAME, PLAN_LEDGER_TABLE_NAME passed to Lambda/services.

### Phase 7 E2E — Governance E2E Lambda (budget reserve E2E)

- **Purpose:** Post-deploy E2E only. Invoked by `scripts/phase_7/test-phase7-budget-reserve.sh` to exercise BudgetService and assert BUDGET_RESERVE (or BUDGET_BLOCK/BUDGET_WARN) in Plan Ledger without wiring into production execution paths.
- **Handler:** `src/handlers/phase7/governance-e2e-handler.ts`. Entry: `handler`; runtime: Node.js 20.x.
- **Payload:** `event.body` (JSON string): `{ action: 'budget_reserve', plan_id, tenant_id, account_id?, period_key?, cost_class?, amount?, operation_id? }`. Required: `action`, `plan_id`, `tenant_id`.
- **Behavior:** Builds BudgetService with **in-memory** BudgetUsageStore (per invocation; no DynamoDB budget usage table for this Lambda) and PlanLedgerService (env `PLAN_LEDGER_TABLE_NAME`). Calls `budgetService.reserve(scope, period_key, cost_class, operation_id, amount)`; returns `{ statusCode: 200, body: JSON.stringify({ result, reason?, details? }) }`. All budget decisions are appended to Plan Ledger per §4.
- **CDK wiring (PlanInfrastructure):** New Lambda `Phase7GovernanceE2EHandler` (NodejsFunction). Default function name: `cc-native-phase7-governance-e2e`. Optional prop: `phase7GovernanceE2EFunctionName`. Environment: `PLAN_LEDGER_TABLE_NAME` = plan ledger table name. Grant: `planLedgerTable.grantReadWriteData(phase7GovernanceE2EHandler)`. No RevenuePlans table access; no budget usage DynamoDB table (in-memory store per invoke).
- **Enhancements:** Optional future `action: 'outcomes_capture'` when OUTCOMES_TABLE_NAME is set and OutcomesCaptureService is wired for E2E; same Lambda can support multiple E2E actions. See parent [PHASE_7_CODE_LEVEL_PLAN.md](PHASE_7_CODE_LEVEL_PLAN.md) § Quick Reference — Phase 7 E2E — Governance E2E Lambda.

---

## 8. Test Strategy (all required)

See **testing/PHASE_7_2_TEST_PLAN.md** for full test plan. All of the following tests are **required** for definition of done. No test is optional.

- **Required — BudgetService:** Applicable config matching (all non-null scope fields match); any hard cap exceeded → BLOCK, **no reserve** (atomic condition fails); soft cap exceeded (no hard) → WARN, reserve; both under → ALLOW, reserve. **WARN uses usage_after_reserve.** Dedupe: same operation_id returns stored outcome, no double increment. Ledger: BUDGET_BLOCK, BUDGET_WARN, BUDGET_RESERVE with usage_before, usage_after, cap_hard, cap_soft, matched_configs. Deterministic: same inputs → same result. No applicable config → fail or BLOCK (no unbounded fallback). **Required.**
- **Required — Usage store:** **One conditional update** per reserve (no read-then-write); condition failure → no increment; getUsage returns reserved_count; period_key isolation; reserved_count only (no consumed_count, no decrement on failure). **Required.**
- **Required — Instrumentation:** Mock BudgetService; BLOCK → operation not called; WARN/ALLOW → operation called; operation_id in request; cost class and scope passed correctly. **Required.**

---

## References

- Parent: [PHASE_7_CODE_LEVEL_PLAN.md](PHASE_7_CODE_LEVEL_PLAN.md)
- Implementation Plan EPIC 7.2: [PHASE_7_IMPLEMENTATION_PLAN.md](PHASE_7_IMPLEMENTATION_PLAN.md)
- Contracts Addendum §5: [PHASE_7_CONTRACTS_ADDENDUM.md](PHASE_7_CONTRACTS_ADDENDUM.md)
