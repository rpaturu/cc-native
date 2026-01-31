# Phase 6.2 — Single Plan Type (Renewal Defense): Code-Level Plan

**Status:** ✅ **COMPLETE**  
**Created:** 2026-01-30  
**Last Updated:** 2026-01-30  
**Parent:** [PHASE_6_CODE_LEVEL_PLAN.md](PHASE_6_CODE_LEVEL_PLAN.md)  
**Canonical contract:** [PHASE_6_IMPLEMENTATION_PLAN.md](PHASE_6_IMPLEMENTATION_PLAN.md) EPIC 6.2, Stories 6.2.1–6.2.2  
**Prerequisites:** Phase 6.1 complete (schema, lifecycle, Policy Gate, ledger, API).

---

## Overview

Phase 6.2 introduces the **first (and only in 6.2) plan type: RENEWAL_DEFENSE**, with a defined set of allowed steps and optional ordering/dependencies. It adds the **Plan Proposal Generator**: LLM-assisted, bounded; output is **DRAFT only**; no execution. Policy Gate (6.1) is extended to use plan-type config so only RENEWAL_DEFENSE and its allowed steps are accepted.

**Deliverables:**
- Plan type and step type definitions (RENEWAL_DEFENSE; allowed step action types)
- Plan type config / seed (Policy Gate reads allowed types and steps)
- PlanProposalGeneratorService (input: posture, signals, history, tenant goals → output: RevenuePlanV1 DRAFT)
- Proposal generation audit (Plan Ledger or equivalent)
- Optional: API or trigger to request a proposal for an account

**Dependencies:** Phase 6.1 (PlanRepositoryService, PlanPolicyGateService, PlanLedgerService, RevenuePlanV1). No orchestration or execution in 6.2—proposals are DRAFT until approved in 6.1/6.3.

**Out of scope for 6.2:** Additional plan types; execution of steps; auto-approval. **Cannot auto-approve plans** (governance).

---

## Implementation Tasks

1. Type definitions (PlanType enum, RENEWAL_DEFENSE step action types, proposal input/output)
2. Plan type config (allowed plan types + allowed steps per type); seed or DynamoDB/config
3. Extend PlanPolicyGateService to use plan-type config (INVALID_PLAN_TYPE, STEP_ORDER_VIOLATION for disallowed steps)
4. PlanProposalGeneratorService (LLM-assisted, bounded); output DRAFT only; audit log
5. Optional: API route or Lambda trigger to generate proposal (e.g. POST /plans/propose or event-driven)
6. Unit tests (proposal generator bounded output, DRAFT only, audit; config; Policy Gate with RENEWAL_DEFENSE)

---

## 1. Plan Type and Step Type Definitions

### File: `src/types/plan/PlanTypeConfig.ts` (new)

**PlanType** (Phase 6.2: single type only)

```typescript
export type PlanType = 'RENEWAL_DEFENSE';
// In 6.2 only RENEWAL_DEFENSE is accepted; other plan types rejected by Policy Gate.
```

**RENEWAL_DEFENSE step action types** (allowed action_type values for steps)

```typescript
export const RENEWAL_DEFENSE_STEP_ACTION_TYPES = [
  'REQUEST_RENEWAL_MEETING',
  'PREP_RENEWAL_BRIEF',
  'ESCALATE_SUPPORT_RISK',
] as const;

export type RenewalDefenseStepActionType = typeof RENEWAL_DEFENSE_STEP_ACTION_TYPES[number];
```

**Optional ordering / dependencies:** Document recommended sequence (e.g. REQUEST_RENEWAL_MEETING → PREP_RENEWAL_BRIEF → ESCALATE_SUPPORT_RISK). Policy Gate can validate step ordering and dependencies against this config. **default_sequence semantics:** if dependencies exist, they must be acyclic and refer to valid step_ids; if default_sequence is used, enforce **relative ordering only** (not exact match), so the generator can omit steps without failing validation. Step identity remains **step_id** (UUID); ordering is for validation and display.

**PlanTypeConfig** (per tenant or global; used by Policy Gate and Proposal Generator)

```typescript
export interface PlanTypeConfig {
  plan_type: PlanType;
  allowed_step_action_types: string[];  // e.g. RENEWAL_DEFENSE_STEP_ACTION_TYPES
  default_sequence?: string[];          // optional recommended order (action_type values)
  objective_template?: string;          // optional e.g. "Secure renewal before day -30"
  expires_at_days_from_creation?: number; // optional default for expires_at
}
```

---

## 2. Plan Type Config / Seed

Policy Gate and Proposal Generator must know allowed plan types and allowed steps. Two options:

**Option A — Static config (simplest for 6.2):**  
- File or constant: e.g. `src/config/planTypeConfig.ts` exporting `RENEWAL_DEFENSE_CONFIG: PlanTypeConfig` with allowed_step_action_types, optional default_sequence, objective_template, expires_at_days.  
- PlanPolicyGateService and PlanProposalGeneratorService read from this config. Tenant-specific overrides can be added later (e.g. DynamoDB).

**Option B — DynamoDB or config table:**  
- Table or item: e.g. `PLAN_TYPE#RENEWAL_DEFENSE` with allowed_step_action_types, default_sequence, etc.  
- PlanPolicyGateService.getPlanTypeConfig(planType): returns config or null; if null for plan_type, reject (INVALID_PLAN_TYPE).

**Recommendation for 6.2:** Start with **Option A** (static config) so Policy Gate and Proposal Generator are deterministic and testable without DB. Migrate to Option B when tenant-specific plan types are needed.

**Location:** `src/config/planTypeConfig.ts` or equivalent. Export `getPlanTypeConfig(planType: string): PlanTypeConfig | null`; for 6.2 return config only for `RENEWAL_DEFENSE`, null otherwise.

---

## 3. Proposal Generator — Input and Output Types

### File: `src/types/plan/PlanProposalTypes.ts` (new)

**PlanProposalInput** (input to PlanProposalGeneratorService)

```typescript
export interface PlanProposalInput {
  tenant_id: string;
  account_id: string;
  plan_type: PlanType;  // in 6.2 only 'RENEWAL_DEFENSE'
  posture?: Record<string, unknown>;   // account/situation posture (from perception/world model)
  signals?: unknown[];                 // relevant signals (e.g. renewal window, support risk)
  history?: unknown[];                // recent actions or plan history for account
  tenant_goals?: Record<string, unknown>; // tenant-level goals or constraints
}
```

**PlanProposalOutput** (output: always a DRAFT plan; never executable until approved)

```typescript
import { RevenuePlanV1 } from './PlanTypes';

export interface PlanProposalOutput {
  plan: RevenuePlanV1;  // plan_status = 'DRAFT'; plan_type and steps from config + LLM suggestion
  proposal_id?: string; // optional id for audit correlation
}
```

**Contract:** Output plan must have `plan_status = 'DRAFT'`, `plan_type` in allowed list, steps each with `action_type` in allowed list for that plan_type, and stable `step_id` (UUID) per step. Proposal Generator **cannot auto-approve**; it only produces a DRAFT.

---

## 4. PlanProposalGeneratorService

### File: `src/services/plan/PlanProposalGeneratorService.ts` (new)

**Responsibilities:**
- Accept PlanProposalInput; return PlanProposalOutput (RevenuePlanV1 in DRAFT).
- Use **bounded** LLM call: prompt + schema (e.g. suggest steps and objective from posture/signals/history/goals); constrain output to allowed plan_type and allowed step action types.
- Generate plan_id (UUID), expires_at (e.g. from config or now + default days), and step_id (UUID) per step.
- **Cannot auto-approve plans** — output is proposal only; approval is always human or explicit policy (6.1).

**Methods:**
- `generateProposal(input: PlanProposalInput): Promise<PlanProposalOutput>`  
  - Load plan type config (allowed steps, default_sequence, objective_template, expires_at_days).  
  - Call LLM (or rule-based stub) with bounded prompt + schema; get suggested objective and list of step action_types (and optional dependencies).  
  - Build RevenuePlanV1: plan_id, plan_type, account_id, tenant_id, objective, plan_status: 'DRAFT', steps (each with step_id UUID, action_type from allowed list, status: 'PENDING', sequence), expires_at, created_at, updated_at.  
  - Return { plan }. Optionally write PLAN_CREATED to Plan Ledger (audit).  
  - On validation failure (e.g. LLM returns disallowed action_type): **sanitize then accept** (Phase 6.2 baseline)—drop disallowed steps; if no steps remain after sanitize → reject proposal. Avoids brittle retries and keeps the generator stable.

**Bounded schema (LLM):** Restrict LLM output to: objective (string), steps (array of { action_type: one of allowed_step_action_types, optional dependencies }). Do not allow free-form plan_type or action_type outside config.

**Audit:** Log proposal creation: either append to Plan Ledger (event PLAN_CREATED with data: plan_id, plan_type, account_id, tenant_id, trigger: 'proposal_generated', input_summary) or separate audit log. Key inputs (tenant_id, account_id, plan_type) must be auditable.

**Dependencies:** Plan type config (getPlanTypeConfig); optional PlanLedgerService for PLAN_CREATED; no PlanRepositoryService.putPlan in this service (caller may persist the DRAFT).

---

## 5. Integration with Plan Policy Gate (6.1)

PlanPolicyGateService (6.1) must validate plan_type and step action types against config:

- **validateForApproval(plan, tenantId):** If plan.plan_type is not in allowed list (e.g. getPlanTypeConfig(plan.plan_type) === null), return invalid with reason INVALID_PLAN_TYPE. For each step, if step.action_type is not in config.allowed_step_action_types for that plan_type, return invalid with reason **STEP_ORDER_VIOLATION** and a descriptive message (e.g. "Disallowed step action_type: …"). **Use STEP_ORDER_VIOLATION only; do not introduce new reason codes in 6.2** — keep the 6.1 taxonomy so UI and tests stay stable. Optional: validate default_sequence or dependencies.
- **evaluateCanActivate:** No change to plan_type/step checks beyond what is already validated at approval; conflict and preconditions only.

**Location of config usage:** PlanPolicyGateService (6.1) already exists; add dependency on getPlanTypeConfig (or PlanTypeConfigService). In 6.2, only RENEWAL_DEFENSE is allowed; reject any other plan_type.

---

## 6. Persisting the Proposal (DRAFT)

Proposal Generator returns a DRAFT plan; it does not have to persist it. Two patterns:

**Option A — Caller persists:** API or trigger that calls PlanProposalGeneratorService.generateProposal then PlanRepositoryService.putPlan(plan). putPlan only accepts DRAFT (6.1); so this is valid.

**Option B — Service persists:** PlanProposalGeneratorService calls PlanRepositoryService.putPlan(plan) after generating. Then audit (PLAN_CREATED) can be written by repository or ledger when plan is first persisted.

**Recommendation:** Caller persists (Option A) so Proposal Generator remains a pure “generate DRAFT” service; API or trigger is responsible for putPlan and audit. Document in API section below.

---

## 7. API or Trigger to Generate Proposal

**Optional in 6.2:** An endpoint or event that requests a proposal for an account.

**If implemented:**
- **POST /plans/propose** (or POST /accounts/:accountId/plans/propose)  
  - Body: { tenant_id, account_id, plan_type: 'RENEWAL_DEFENSE', optional posture, signals, history, tenant_goals }.  
  - Auth: same as plan-approver or a dedicated “proposal requester” role.  
  - Flow: PlanProposalGeneratorService.generateProposal(input) → PlanRepositoryService.putPlan(plan) (only if DRAFT) → PlanLedgerService.append(PLAN_CREATED) → return 201 { plan }.  
  - Validation: plan_type must be RENEWAL_DEFENSE in 6.2; else 400.

**If not implemented in 6.2:** Proposal generation can be triggered in 6.3 by orchestrator or a separate scheduler (e.g. “suggest plan for account when renewal window detected”). Document “proposal trigger” as out of scope for 6.2 or minimal (e.g. unit test only).

---

## 8. CDK / Infrastructure

- **No new DynamoDB tables required** if using static config (Option A).  
- If using Option B (config table): add table or item(s) for plan type config; GSI by plan_type if needed.  
- **Optional:** Lambda for proposal generation (if triggered by event) or reuse API handler.  
- **Environment:** If LLM is used, add env vars for model endpoint/API key (e.g. PLAN_PROPOSAL_LLM_ENDPOINT); keep schema bounded.

---

## 9. Test Strategy

See **testing/PHASE_6_2_TEST_PLAN.md** (to be created) for:

- **PlanProposalGeneratorService:** generateProposal returns DRAFT only; plan_type = RENEWAL_DEFENSE; all step action_types in allowed list; step_id present per step; expires_at set; no auto-approval. Bounded output (mock LLM returning allowed vs disallowed action_type; sanitize or reject). Audit: PLAN_CREATED or equivalent logged when caller persists.
- **Plan type config:** getPlanTypeConfig('RENEWAL_DEFENSE') returns config; getPlanTypeConfig('OTHER') returns null.
- **PlanPolicyGateService (6.1) + 6.2 config:** validateForApproval rejects plan with plan_type not in config (INVALID_PLAN_TYPE); rejects step with action_type not in allowed list; accepts valid RENEWAL_DEFENSE plan with allowed steps.
- **API (if implemented):** POST /plans/propose with valid input → 201 and plan persisted as DRAFT; invalid plan_type → 400; auth rejection → 403.

**Coverage target:** 100% for PlanProposalGeneratorService and plan type config; Policy Gate branches for RENEWAL_DEFENSE and allowed steps.

---

## 10. Contract: No Execution in 6.2

- Plan Proposal Generator **outputs DRAFT only**; it does not approve, activate, or execute steps.
- No Phase 4 execution calls in 6.2; no orchestrator. Only plan type definition, config, and proposal generation.
- **Cannot auto-approve plans** — governance; approval is always human or explicit policy (6.1).

---

## References

- Parent: [PHASE_6_CODE_LEVEL_PLAN.md](PHASE_6_CODE_LEVEL_PLAN.md)
- Canonical contract: [PHASE_6_IMPLEMENTATION_PLAN.md](PHASE_6_IMPLEMENTATION_PLAN.md) EPIC 6.2
- Phase 6.1: [PHASE_6_1_CODE_LEVEL_PLAN.md](PHASE_6_1_CODE_LEVEL_PLAN.md) (Policy Gate, PlanRepositoryService, PlanLedgerService, types)
- Phase 6.3: Plan Orchestrator will consume DRAFT plans only after approval (6.1) and activation (6.3).
