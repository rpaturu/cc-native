# Phase 7 — Code-Level Implementation Plan

*Trust, Quality, and Cost Governance — controlling, validating, and bounding autonomous behavior*

**Status:** 🟢 **COMPLETE**  
**Created:** 2026-01-31  
**Parent:** [PHASE_7_OUTLINE.md](PHASE_7_OUTLINE.md) | [PHASE_7_IMPLEMENTATION_PLAN.md](PHASE_7_IMPLEMENTATION_PLAN.md)  
**Contracts:** [PHASE_7_CONTRACTS_ADDENDUM.md](PHASE_7_CONTRACTS_ADDENDUM.md) — canonical validator and budget semantics; implement per addendum before coding.  
**Prerequisites:** Phase 6 complete (Plans, Orchestrator, UI, Conflicts, E2E). Plan Ledger append-only and operational.  
**Progress:** Not started.

**Note:** Test plans (e.g. `testing/PHASE_7_x_TEST_PLAN.md`) to be created per sub-phase. This plan is the code-level reference; sub-phase docs provide detailed file paths, type shapes, and handler contracts.

---

## Document purpose

This is the **parent** code-level plan. It provides overview, sub-phase list, implementation order, and quick reference. **Detailed implementation** (file paths, type shapes, service methods, validator contracts, CDK resources) lives in sub-phase documents **PHASE_7_1** through **PHASE_7_4**. Create sub-phase plans as each epic is started.

**Source-of-truth roles:** **Implementation Plan** = epic/story + acceptance contract; **Contracts Addendum** = Freshness/Grounding/Contradiction/Budget/Validator execution semantics; **Code-Level Plan** = file paths, handler contracts, CDK resources, validator I/O; **Architecture Invariants** (in Implementation Plan) = non-negotiable constraints that sub-phase docs must not weaken.

---

## Overview

Phase 7 adds **runtime governance** without new autonomy: validators block/warn at defined choke points; BudgetService enforces cost caps; metrics and dashboards support explainability. No changes to Plan Orchestrator logic; governance layers wrap existing paths.

**Key Architectural Additions:**

1. **ValidatorGateway** — Runs validators at four choke points (before plan approval, before step execution, before external writebacks, before expensive reads); run all validators, record all results (no short-circuit on BLOCK); aggregate ALLOW/WARN/BLOCK; emit ledger events.
2. **Validators (baseline)** — Freshness (hard_ttl/soft_ttl), Grounding (action-level; evidence reference shape), Contradiction (canonical snapshot; field allowlist), Compliance/Field Guard (tenant allow/deny).
3. **BudgetService** — Track usage; enforce hard/soft caps; reserve-before-execute; BLOCK if any hard cap exceeded, WARN if any soft cap exceeded (no hard); ledger all decisions.
4. **Cost classes** — CHEAP, MEDIUM, EXPENSIVE; instrument execution paths; BudgetService invoked inline (no scheduling).
5. **Metrics + Dashboards** — Validator block rate, budget consumption, plan success/pause/abort, orchestrator throughput; alerting hooks.
6. **Outcomes capture (scaffolding)** — Write-only; approved/rejected actions, execution outcomes, plan completion reason; no training in Phase 7.

---

## Sub-Phase Documents

For detailed code-level plans, see:

| Sub-Phase | Document | Scope |
|-----------|----------|--------|
| **7.1** | `PHASE_7_1_CODE_LEVEL_PLAN.md` | ValidatorGateway, Freshness/Grounding/Contradiction/Compliance validators, choke-point integration, Plan Ledger validator events |
| **7.2** | `PHASE_7_2_CODE_LEVEL_PLAN.md` | Cost classes, budget schema, BudgetService (reserve-before-execute), instrument execution paths |
| **7.3** | `PHASE_7_3_CODE_LEVEL_PLAN.md` | Validator and budget metrics, CloudWatch, dashboards, alerting hooks |
| **7.4** | `PHASE_7_4_CODE_LEVEL_PLAN.md` | Outcomes table/schema, write-only capture, no training |

**Implementation order:** 7.1 → 7.2 → 7.3 → 7.4. Do not start with budgets before validators — quality first, then cost.

**Detailed code-level plans:** See [PHASE_7_1_CODE_LEVEL_PLAN.md](PHASE_7_1_CODE_LEVEL_PLAN.md), [PHASE_7_2_CODE_LEVEL_PLAN.md](PHASE_7_2_CODE_LEVEL_PLAN.md), [PHASE_7_3_CODE_LEVEL_PLAN.md](PHASE_7_3_CODE_LEVEL_PLAN.md), [PHASE_7_4_CODE_LEVEL_PLAN.md](PHASE_7_4_CODE_LEVEL_PLAN.md) for file paths, type shapes, service methods, and CDK.

---

## Core principles and contracts

**Core principles (from Implementation Plan §1):**  
Validators are runtime truth, not policy; validators do not mutate state; WARN never alters execution flow; BLOCK is deterministic stop; BudgetService is invoked, not a scheduler; Phase 6 orchestration semantics do not change.

**Contracts (from Addendum):**  
- Freshness: hard_ttl → BLOCK, soft_ttl → WARN, age from single evaluation time (UTC).  
- Grounding: action-level; evidence reference shape (source_type+source_id, ledger_event_id, record_locator).  
- Contradiction: same snapshot as Phase 6 planning; no re-reads; defined field allowlist; null/unknown = not contradictory unless compliance.  
- Validator execution: run all validators; record all results; no short-circuit on BLOCK.  
- Budget: any hard cap → BLOCK; any soft cap (no hard) → WARN; reserve-before-execute; ledger reservation.

**Zero Trust:**  
Phase 7 preserves [Phase 2 Zero Trust](../phase_2/ZERO_TRUST_IMPLEMENTATION_PLAN.md). All new Lambda, API, DynamoDB, IAM: least privilege, tenant-scoped where applicable, audit logging. Plan Ledger append-only; no bypass of Phase 6.

**Integration with Phase 6:**  
- ValidatorGateway is **invoked** from existing paths (plan approval API, orchestrator before step execution, execution path before writeback, execution path before expensive read).  
- BudgetService is **invoked** from execution/tool-call paths before EXPENSIVE (and optionally MEDIUM) operations; does not schedule or re-order.  
- Plan Ledger is extended with validator and budget event types (append-only).

**Fail-fast (no fallbacks):** Required config and storage must be present; invalid input or missing dependencies fail immediately. Do not fall back to "allow all," "no limit," or alternate storage. All tests in sub-phase plans (7.1–7.4) are **required** for definition of done; no test is optional.

**Implementation contract clarifications (lock before coding):**

- **ValidatorGateway idempotency:** ValidatorGateway executions are idempotent per `(plan_id, choke_point, target_id, snapshot_id)` (or equivalent identity for the run). Duplicate invocations with the same identity must not produce divergent results; re-runs (e.g. after retry) may append to ledger but aggregate outcome must be consistent.
- **"Expensive read" boundary:** The choke point "before expensive read" means **any operation tagged with `CostClass.EXPENSIVE`**, regardless of read vs write semantics. Use cost class as the single switch; do not introduce separate "expensive read" vs "expensive write" semantics in Phase 7.
- **Budget usage store concurrency:** Budget reservations must be enforced using **conditional atomic updates** (e.g. DynamoDB conditional write or atomic counter with cap check) to prevent over-reservation under concurrency. Do not rely on read-then-write without atomicity.
- **Outcomes storage intent:** **Plan Ledger** = audit trail (why something happened; append-only; query by plan_id/tenant for "why blocked/warned"). **Outcomes table** = query/analytics substrate for learning (Phase 8+). Do not overuse the ledger for analytics; do not use the Outcomes table as the sole audit source for governance.

---

## Implementation Order

### Phase 7.1 — Validators Layer
1. Validator types (ValidatorResult, ValidatorContext, choke point enum, ledger event types for validators)
2. ValidatorGatewayService: run all validators in fixed order; aggregate; append all results to Plan Ledger
3. FreshnessValidator (addendum §1): hard_ttl/soft_ttl, single evaluation time
4. GroundingValidator (addendum §2): action-level, evidence reference shape
5. ContradictionValidator (addendum §3): canonical snapshot input, field allowlist, null/unknown semantics
6. ComplianceValidator (Field Guard): tenant/config allow/deny
7. Choke-point integration: call ValidatorGateway from plan approval, orchestrator (before step), execution (before writeback, before expensive read)
8. Plan Ledger: extend event types for validator results (VALIDATOR_RUN, per-validator result payload)

### Phase 7.2 — Budgets and Cost Classes
9. Cost class enum (CHEAP, MEDIUM, EXPENSIVE); budget schema (scope, period, hard_cap, soft_cap)
10. BudgetService: reserve-before-execute; BLOCK/WARN/ALLOW per addendum §5; ledger all decisions
11. Budget usage store (DynamoDB or equivalent): reserved/consumed per scope and cost class
12. Instrument execution paths: tag cost class; call BudgetService before EXPENSIVE (and optionally MEDIUM)
13. Plan Ledger: extend for budget events (BUDGET_RESERVE, BUDGET_BLOCK, BUDGET_WARN)

### Phase 7.3 — Observability and Dashboards
14. Emit metrics: validator block rate by type, budget consumption by cost class (and tenant/account)
15. CloudWatch (or equivalent) namespaces and dimensions
16. Dashboards: validator block rate, budget consumption, plan success/pause/abort, orchestrator throughput, time-in-plan, % human intervention
17. Alerting hooks and runbooks for "why was this blocked?" (ledger + UI)

### Phase 7.4 — Outcomes Capture (Scaffolding)
18. Outcomes schema (approved/rejected, seller edits, execution success/failure, plan completion reason, downstream outcome)
19. Outcomes table or extension; write-only from existing paths (no new decision logic)
20. Ledger linkage for audit

---

## Quick Reference: Component Locations

### Type Definitions
- **7.1:** `PHASE_7_1_CODE_LEVEL_PLAN.md` — ValidatorResult, ValidatorContext, ValidatorChokePoint, Plan Ledger validator event payloads
- **7.2:** `PHASE_7_2_CODE_LEVEL_PLAN.md` — CostClass, BudgetConfig, BudgetScope, budget ledger event payloads
- **7.4:** `PHASE_7_4_CODE_LEVEL_PLAN.md` — OutcomeEvent, Outcomes schema

### Services
- **7.1:** ValidatorGatewayService, FreshnessValidator, GroundingValidator, ContradictionValidator, ComplianceValidator (in `src/services/governance/` or equivalent)
- **7.2:** BudgetService (GovernanceBudgetService or Phase7BudgetService to avoid name clash with existing AutonomyBudgetService/CostBudgetService), budget usage store
- **7.3:** Metrics emission from ValidatorGateway and BudgetService; dashboard/alerting config
- **7.4:** OutcomesCaptureService (write-only)

### Integration Points (no new handlers required for baseline)
- **7.1:** Plan approval API (call ValidatorGateway before transitioning DRAFT→APPROVED); Plan Orchestrator (call ValidatorGateway before step execution); execution path (before writeback, before expensive read)
- **7.2:** Execution/tool adapters (tag cost class, call BudgetService before EXPENSIVE/MEDIUM)

### Phase 7 E2E — Governance E2E Lambda (post-deploy E2E only)
- **Handler:** `src/handlers/phase7/governance-e2e-handler.ts`
- **Purpose:** Post-deploy E2E scripts invoke this Lambda to exercise BudgetService (and optionally future OutcomesCaptureService) without wiring into production execution paths. Writes BUDGET_RESERVE (or BUDGET_BLOCK/BUDGET_WARN) to Plan Ledger; E2E asserts ledger entry.
- **Payload:** `event.body` JSON: `{ action: 'budget_reserve', plan_id, tenant_id, account_id?, period_key?, cost_class?, amount?, operation_id? }`. Required: `action`, `plan_id`, `tenant_id`.
- **Behavior:** Builds BudgetService with in-memory BudgetUsageStore and PlanLedgerService (env `PLAN_LEDGER_TABLE_NAME`); calls `budgetService.reserve(scope, period_key, cost_class, operation_id, amount)`; returns `{ statusCode, body: { result, reason?, details? } }`. All budget decisions are appended to Plan Ledger per §7.2.
- **CDK:** PlanInfrastructure construct adds `phase7GovernanceE2EHandler` (NodejsFunction). Default function name `cc-native-phase7-governance-e2e`; optional prop `phase7GovernanceE2EFunctionName`. Env: `PLAN_LEDGER_TABLE_NAME`. Grant: `planLedgerTable.grantReadWriteData(phase7GovernanceE2EHandler)`.
- **Enhancements:** Optional future `action: 'outcomes_capture'` when `OUTCOMES_TABLE_NAME` is set and OutcomesCaptureService is wired for E2E; same Lambda can support multiple E2E actions to avoid proliferating test-only Lambdas.

### CDK / Infrastructure
- **7.1:** No new tables required if Plan Ledger extended with validator event types; optional validator config (TTL, field allowlist) in config table or env
- **7.2:** Budget config store; budget usage store (reserved/consumed per scope); **Phase 7 E2E:** governance E2E Lambda (see above) for budget reserve E2E
- **7.3:** CloudWatch metrics, dashboards, alarms
- **7.4:** Outcomes table (or Plan Ledger extension)

---

## Prerequisites (Before Starting Phase 7)

- Phase 6 complete (Plan Ledger append-only; PlanOrchestratorService, PlanLifecycleService, PlanPolicyGateService, plan-lifecycle API).
- Contracts Addendum read and locked: Freshness, Grounding, Contradiction, Validator execution, Budget precedence and reserve-before-execute.

**See:** `PHASE_7_IMPLEMENTATION_PLAN.md` §1 Core Principles, §1.1 Architecture Invariants; `PHASE_7_CONTRACTS_ADDENDUM.md` for all validator and budget contracts.

---

## References

- **Phase 7 Outline:** [PHASE_7_OUTLINE.md](PHASE_7_OUTLINE.md)
- **Phase 7 Implementation Plan:** [PHASE_7_IMPLEMENTATION_PLAN.md](PHASE_7_IMPLEMENTATION_PLAN.md)
- **Phase 7 Contracts Addendum:** [PHASE_7_CONTRACTS_ADDENDUM.md](PHASE_7_CONTRACTS_ADDENDUM.md)
- **Phase 7 E2E Test Plan:** [testing/PHASE_7_E2E_TEST_PLAN.md](testing/PHASE_7_E2E_TEST_PLAN.md) — Plan Ledger, Validator run, Budget reserve (governance E2E Lambda), Outcomes capture (env-gated)
- **Phase 6 Code-Level Plan:** [../phase_6/PHASE_6_CODE_LEVEL_PLAN.md](../phase_6/PHASE_6_CODE_LEVEL_PLAN.md)
- **Phase 2 Zero Trust:** [../phase_2/ZERO_TRUST_IMPLEMENTATION_PLAN.md](../phase_2/ZERO_TRUST_IMPLEMENTATION_PLAN.md)
