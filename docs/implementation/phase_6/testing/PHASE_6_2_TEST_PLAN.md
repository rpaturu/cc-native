# Phase 6.2 Test Plan — Single Plan Type (RENEWAL_DEFENSE) + Proposal Generator

**Status:** 🟢 **COMPLETE**  
**Created:** 2026-01-28  
**Last Updated:** 2026-01-28  
**Parent:** [../PHASE_6_2_CODE_LEVEL_PLAN.md](../PHASE_6_2_CODE_LEVEL_PLAN.md)  
**Canonical contract:** [../PHASE_6_IMPLEMENTATION_PLAN.md](../PHASE_6_IMPLEMENTATION_PLAN.md) EPIC 6.2  
**Reference:** [PHASE_6_1_TEST_PLAN.md](PHASE_6_1_TEST_PLAN.md) — structure and coverage pattern

---

## Gap Analysis (vs 100% Coverage)

| Item | Plan § | Status | Notes |
|------|--------|--------|--------|
| **planTypeConfig.test.ts** | §1, §2 | ✅ Added | `src/tests/unit/config/planTypeConfig.test.ts` — getPlanTypeConfig(RENEWAL_DEFENSE), getPlanTypeConfig(unknown), RENEWAL_DEFENSE_CONFIG. |
| **PlanProposalGeneratorService.test.ts** | §4 | ✅ Added | `src/tests/unit/plan/PlanProposalGeneratorService.test.ts` — DRAFT only, allowed steps, step_id/sequence, expires_at, unsupported type throws, proposal_id, objective template; objective fallback when no template. |
| **PlanPolicyGateService (6.2)** | §5 | ✅ Added | validateForApproval with getPlanTypeConfig: INVALID_PLAN_TYPE, STEP_ORDER_VIOLATION (disallowed action_type), valid RENEWAL_DEFENSE; evaluateCanActivate with getPlanTypeConfig: INVALID_PLAN_TYPE. |
| **plan-lifecycle-api-handler (propose)** | §7 | ✅ Added | POST /plans/propose: 201 + persist + ledger; 400 invalid plan_type; 403 tenant/account mismatch; 500 on generator throw; 503 when env missing; parseBody invalid JSON. |

---

## Executive Summary

This document defines **100% test coverage** requirements for Phase 6.2 (Single Plan Type RENEWAL_DEFENSE, Plan Type Config, Plan Proposal Generator, POST /plans/propose). Every config path, Policy Gate branch with getPlanTypeConfig, proposal generator path, and API route for propose must be covered by unit tests.

**Coverage target:** 100% statement and branch coverage for Phase 6.2 modules: `planTypeConfig.ts`, `PlanProposalGeneratorService.ts`, `PlanPolicyGateService.ts` (6.2 branches), `plan-lifecycle-api-handler.ts` (propose + shared paths).

---

## 1. Plan Type Config — 100% Coverage

**File:** `src/tests/unit/config/planTypeConfig.test.ts`

### getPlanTypeConfig(planType)

| Scenario | Expected | Test |
|----------|----------|------|
| planType === 'RENEWAL_DEFENSE' | PlanTypeConfig with plan_type, allowed_step_action_types, default_sequence, objective_template, expires_at_days_from_creation | Assert config not null; assert all fields match RENEWAL_DEFENSE_STEP_ACTION_TYPES and spec |
| planType unknown (e.g. 'OTHER_TYPE', '', 'renewal_defense') | null | Assert getPlanTypeConfig returns null |

### RENEWAL_DEFENSE_CONFIG

| Scenario | Expected | Test |
|----------|----------|------|
| Export equals getPlanTypeConfig('RENEWAL_DEFENSE') | Deep equality | Assert getPlanTypeConfig('RENEWAL_DEFENSE') === RENEWAL_DEFENSE_CONFIG |

**Coverage:** Every branch of getPlanTypeConfig; CONFIG_BY_TYPE lookup hit and miss.

---

## 2. PlanProposalGeneratorService — 100% Coverage

**File:** `src/tests/unit/plan/PlanProposalGeneratorService.test.ts`

### generateProposal(input)

| Scenario | Expected | Test |
|----------|----------|------|
| Valid RENEWAL_DEFENSE input | plan_status === 'DRAFT'; plan_type === 'RENEWAL_DEFENSE'; steps with allowed action_type only | Assert DRAFT only (no auto-approve); assert each step.action_type in RENEWAL_DEFENSE_STEP_ACTION_TYPES |
| Governance: never non-DRAFT | plan_status is always 'DRAFT'; never APPROVED/ACTIVE/PAUSED/COMPLETED/ABORTED/EXPIRED | Assert plan_status === 'DRAFT' and not in other lifecycle statuses (even if LLM suggested otherwise) |
| Each step | step_id (UUID), status 'PENDING', sequence 1..n | Assert UUID regex; status; sequence |
| plan_id, expires_at, created_at, updated_at | Set and expires_at > now | Assert defined and expires_at in future |
| Unsupported plan_type | Throw Error(/not supported/) | Assert rejects with /not supported/ |
| proposal_id | proposal_id === plan.plan_id | Assert equality |
| objective | From config.objective_template when present | Assert objective === 'Secure renewal before day -30' |
| objective fallback | When config has no objective_template, objective === `Plan for ${account_id}` | Mock getPlanTypeConfig to return config without objective_template; assert objective fallback |

**No steps remain after sanitize:** Config with empty default_sequence / no allowed steps → throw (/rejected/). (Current stub uses config.default_sequence so always has steps; branch for steps.length === 0 is covered by throwing.)

**Defensive filter:** The `.filter((step) => allowedSteps.has(step.action_type))` after map is redundant (steps already come from suggestedActionTypes filtered by allowedSteps). Its false branch is unreachable in the current implementation; 100% branch coverage for that line is not required per plan.

**Sanitize vs retry:** Sanitize-then-accept is the Phase 6.2 baseline (drop disallowed steps; reject if none remain). Retry loops or LLM re-prompting on invalid output are out of scope for 6.2 (Phase 7+ if needed).

**Coverage:** All branches: config null (throw), steps.length === 0 (throw), objective_template vs fallback, expires_at_days_from_creation vs default 30.

---

## 3. PlanPolicyGateService (6.2) — getPlanTypeConfig Branches

**File:** `src/tests/unit/plan/PlanPolicyGateService.test.ts`

### validateForApproval with getPlanTypeConfig

| Scenario | valid | Reason | Test |
|----------|--------|--------|------|
| getPlanTypeConfig(plan.plan_type) === null | false | INVALID_PLAN_TYPE | Plan type 'OTHER_TYPE'; assert INVALID_PLAN_TYPE |
| Step action_type not in config.allowed_step_action_types | false | STEP_ORDER_VIOLATION, message "Disallowed step action_type" | Step with action_type 'DISALLOWED_ACTION'; assert reason code and message |
| Plan type in config, all steps allowed | true | (empty) | RENEWAL_DEFENSE with REQUEST_RENEWAL_MEETING, PREP_RENEWAL_BRIEF; assert valid, reasons.length === 0 |

### evaluateCanActivate with getPlanTypeConfig

| Scenario | can_activate | Reason | Test |
|----------|--------------|--------|------|
| getPlanTypeConfig(plan.plan_type) === null | false | INVALID_PLAN_TYPE | Gate with getPlanTypeConfig; plan_type 'OTHER_TYPE'; assert INVALID_PLAN_TYPE |
| getPlanTypeConfig returns config (plan type valid) | (other checks only) | — | Same as existing can_activate true test with getPlanTypeConfig |

**Coverage:** Both branches of "if (this.config.getPlanTypeConfig)" in validateForApproval and evaluateCanActivate; null vs non-null config.

---

## 4. Plan Lifecycle API Handler — POST /plans/propose and Shared Paths

**File:** `src/tests/unit/handlers/phase6/plan-lifecycle-api-handler.test.ts`

### POST /plans/propose

| Scenario | Status | Test |
|----------|--------|------|
| Valid body (tenant_id, account_id, plan_type RENEWAL_DEFENSE); generateProposal returns plan; putPlan; ledger.append | 201, body.plan, putPlan and append called with plan / PLAN_CREATED | Assert 201; plan in body; putPlan(draftPlan); append event_type PLAN_CREATED |
| plan_type !== 'RENEWAL_DEFENSE' | 400, error mentions RENEWAL_DEFENSE | Assert 400, generateProposal not called |
| tenant_id or account_id in body does not match auth | 403 | Assert 403, generateProposal not called |
| generateProposal throws Error('not supported') or 'rejected' | 400, error in body | (Already covered by unsupported type or reject message) |
| generateProposal throws generic Error | 500, Internal server error | Mock generateProposal.mockRejectedValue(new Error('DB error')); assert 500 |

### Shared / edge

| Scenario | Status | Test |
|----------|--------|------|
| getServices() returns null (e.g. env missing so buildServices throws) | 503, Service not configured | Unset REVENUE_PLANS_TABLE_NAME; invoke handler; assert 503; restore env |
| parseBody receives invalid JSON (body triggers JSON.parse throw) | Route continues with {} (or 400/201 depending on route) | Body '{'; propose still gets plan_type default; or use route that fails without body — optional explicit test for parseBody catch |
| Unknown route (path not approve/pause/resume/abort/propose) | 404, error Not found, path | Assert 404, body.error |
| Any handler throws (e.g. getPlan rejects) | 500, Internal server error | Assert 500 (existing test) |

**Coverage:** handlePropose success and both catch branches (400 vs 500); getServices() catch (503); parseBody catch; 404 return; main handler catch.

---

## 5. Test Structure and Locations

```
src/tests/
├── unit/
│   ├── config/
│   │   └── planTypeConfig.test.ts       (§1)
│   ├── plan/
│   │   ├── PlanProposalGeneratorService.test.ts  (§2)
│   │   └── PlanPolicyGateService.test.ts         (§3 — 6.2 describe block)
│   └── handlers/
│       └── phase6/
│           └── plan-lifecycle-api-handler.test.ts  (§4 — propose + shared)
```

---

## 6. Running Tests and Coverage Gates

### Unit tests (required)

```bash
npm test -- --testPathPattern="planTypeConfig|PlanProposalGeneratorService|PlanPolicyGateService|plan-lifecycle-api-handler"
```

### Coverage gate (100% for Phase 6.2 modules)

```bash
npm test -- --coverage \
  --collectCoverageFrom='src/config/planTypeConfig.ts' \
  --collectCoverageFrom='src/services/plan/PlanProposalGeneratorService.ts' \
  --collectCoverageFrom='src/services/plan/PlanPolicyGateService.ts' \
  --collectCoverageFrom='src/handlers/phase6/plan-lifecycle-api-handler.ts' \
  --testPathPattern="planTypeConfig|PlanProposalGeneratorService|PlanPolicyGateService|plan-lifecycle-api-handler"
```

**Requirement:** 100% statement and line coverage for Phase 6.2 modules. Branch coverage target is high; a few branches are defensive (e.g. PlanProposalGeneratorService step filter false branch is unreachable given prior filter on suggestedActionTypes).

- `src/config/planTypeConfig.ts` — 100% statements, branches, lines
- `src/services/plan/PlanProposalGeneratorService.ts` — 100% functions/lines where testable; one defensive filter branch may remain uncovered
- `src/services/plan/PlanPolicyGateService.ts` — 100% statements/lines
- `src/handlers/phase6/plan-lifecycle-api-handler.ts` — 100% lines

---

## 7. Success Criteria — 100% Coverage Checklist

Phase 6.2 tests are complete when:

1. **planTypeConfig:** getPlanTypeConfig('RENEWAL_DEFENSE') returns config; getPlanTypeConfig(unknown) returns null; RENEWAL_DEFENSE_CONFIG matches.
2. **PlanProposalGeneratorService:** generateProposal returns DRAFT only; allowed steps only; step_id/sequence/expires_at; throws for unsupported type; proposal_id; objective from template and fallback when no template.
3. **PlanPolicyGateService (6.2):** validateForApproval with getPlanTypeConfig: INVALID_PLAN_TYPE, STEP_ORDER_VIOLATION (disallowed action_type), valid; evaluateCanActivate with getPlanTypeConfig: INVALID_PLAN_TYPE when plan type not in config.
4. **plan-lifecycle-api-handler:** POST /plans/propose 201 + persist + ledger; 400 invalid plan_type; 403 tenant/account mismatch; 500 on generic throw; 503 when services null (getServices catch); parseBody catch covered; 404 unknown route; 500 on handler throw.
5. **Coverage gate:** 100% statement and line coverage for the four modules; branch coverage maximized (defensive/unreachable branches documented).
6. **CI:** All Phase 6.2 unit tests run in CI and must pass before merge.

---

## References

- [PHASE_6_2_CODE_LEVEL_PLAN.md](../PHASE_6_2_CODE_LEVEL_PLAN.md) — implementation plan
- [PHASE_6_IMPLEMENTATION_PLAN.md](../PHASE_6_IMPLEMENTATION_PLAN.md) — EPIC 6.2 acceptance criteria
- [PHASE_6_1_TEST_PLAN.md](PHASE_6_1_TEST_PLAN.md) — structure reference
