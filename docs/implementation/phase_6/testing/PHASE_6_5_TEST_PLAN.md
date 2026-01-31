# Phase 6.5 Test Plan — Cross-Plan Conflict Resolution

**Status:** 🟢 **COMPLETE**  
**Created:** 2026-01-28  
**Last Updated:** 2026-01-28  
**Parent:** [../PHASE_6_5_CODE_LEVEL_PLAN.md](../PHASE_6_5_CODE_LEVEL_PLAN.md)  
**Canonical contract:** [../PHASE_6_IMPLEMENTATION_PLAN.md](../PHASE_6_IMPLEMENTATION_PLAN.md) EPIC 6.5, Stories 6.5.1–6.5.2  
**Reference:** [PHASE_6_1_TEST_PLAN.md](PHASE_6_1_TEST_PLAN.md), [PHASE_6_4_TEST_PLAN.md](PHASE_6_4_TEST_PLAN.md) — handler and integration pattern

**Canonical conflict lookup naming:** The PlanRepositoryService method for “ACTIVE plan IDs for (tenant_id, account_id, plan_type)” is **listActivePlansForAccountAndType(tenantId, accountId, planType)**. Resume handler calls it directly; the orchestrator may call it via an internal helper (e.g. getActivePlanIdsForAccount) that must be backed by this same repo method. Do not create two different helpers—use one canonical source so behavior cannot drift.

---

## Gap Analysis (vs 100% Coverage)

| Item | Plan § | Status | Notes |
|------|--------|--------|--------|
| **PlanPolicyGateService (CONFLICT_ACTIVE_PLAN)** | §2 | ✅ Existing | PlanPolicyGateService.test.ts: existing_active_plan_ids has another plan → can_activate false, CONFLICT_ACTIVE_PLAN; default empty array when omitted. |
| **plan-lifecycle-api-handler resume (conflict path)** | §4 | 🔲 Required | When **listActivePlansForAccountAndType** returns other plan(s), evaluateCanActivate returns can_activate false with CONFLICT_ACTIVE_PLAN; assert **409 Conflict**, body.error 'Conflict', body.reasons contain CONFLICT_ACTIVE_PLAN; transition(ACTIVE) NOT called; Plan Ledger PLAN_ACTIVATION_REJECTED written. |
| **PlanOrchestratorService (skip activate on conflict)** | §5 | 🔲 Required | When conflict lookup (**listActivePlansForAccountAndType**; orchestrator may use internal getActivePlanIdsForAccount backed by it) returns other plan IDs, evaluateCanActivate returns can_activate false; assert transition(ACTIVE) NOT called for that plan; **assert Plan Ledger PLAN_ACTIVATION_REJECTED written** (caller 'orchestrator', conflicting_plan_ids). |
| **PlanRepositoryService (conflict 6.5 usage)** | §3 | 🔲 Optional | Add listActivePlansForAccountAndType(tenantId, accountId, planType): Promise&lt;string[]&gt; used by both resume and orchestrator; or document limit/pagination requirement. Existing existsActivePlanForAccountAndType / listPlansByTenantAndStatus covered; 6.5 may add or use same. |
| **Integration (conflict rejection)** | §9 | 🔲 Required | conflict-resolution.test.ts: seed two plans same account+plan_type (one ACTIVE, one PAUSED); POST resume for PAUSED; assert **409 Conflict**, body.error 'Conflict', reasons include CONFLICT_ACTIVE_PLAN; teardown. Mandatory when env present. |

---

## Executive Summary

This document defines **100% coverage** requirements for Phase 6.5 (conflict-resolution invariant). All code paths that enforce "one ACTIVE plan per (tenant_id, account_id, plan_type)" must be covered: Policy Gate CONFLICT_ACTIVE_PLAN, plan-lifecycle-api-handler resume **409 Conflict** when conflict, PlanOrchestratorService skip activate when conflict. Integration test must assert conflict rejection against real DynamoDB (seed → invoke handler → teardown).

**Coverage target:** 100% statement and branch coverage for **6.5-relevant code**: PlanPolicyGateService.evaluateCanActivate (CONFLICT path); plan-lifecycle-api-handler resume branch when !can_activate with CONFLICT_ACTIVE_PLAN; PlanOrchestratorService run loop when can_activate false (no transition).

---

## 1. PlanPolicyGateService — CONFLICT_ACTIVE_PLAN (100% Coverage)

**File:** `src/tests/unit/plan/PlanPolicyGateService.test.ts`

**Existing (verify present):**
- evaluateCanActivate with existing_active_plan_ids = ['other-plan-id'] → can_activate false, reasons include code CONFLICT_ACTIVE_PLAN, message mentions other plan id(s).
- evaluateCanActivate with existing_active_plan_ids = [] (or omitted) → can_activate true when preconditions_met and plan_type allowed.
- existing_active_plan_ids filter excludes current plan.plan_id (so [plan.plan_id] only → otherActive length 0 → can_activate true).

**Self-conflict (add explicit test):** existing_active_plan_ids = [plan.plan_id] only (no other ids) → can_activate **true** when preconditions_met and plan_type allowed. Prevents future refactors from treating the plan’s own id as a conflict.

**Coverage:** CONFLICT_ACTIVE_PLAN branch; default empty array; filter id !== plan.plan_id; message string contains conflicting ids; self-conflict ignored.

---

## 2. plan-lifecycle-api-handler — Resume Conflict Path (100% Coverage)

**File:** `src/tests/unit/handlers/phase6/plan-lifecycle-api-handler.test.ts`

**Required tests:**

| Scenario | Expected | Test |
|----------|----------|------|
| Resume: another ACTIVE plan same account+plan_type | **listActivePlansForAccountAndType** returns other plan id(s); evaluateCanActivate returns can_activate false, reasons [{ code: 'CONFLICT_ACTIVE_PLAN', message: '...' }]; response **409 Conflict**; body.error 'Conflict'; body.reasons array includes CONFLICT_ACTIVE_PLAN; lifecycle.transition NOT called; **Plan Ledger PLAN_ACTIVATION_REJECTED written (mandatory assert)** | Mock listActivePlansForAccountAndType returns ['other-active-id']; mockEvaluateCanActivate({ can_activate: false, reasons: [{ code: 'CONFLICT_ACTIVE_PLAN', message: 'Another ACTIVE plan...' }] }); POST /plans/:planId/resume; assert statusCode **409**; JSON body.error === 'Conflict'; body.reasons some r => r.code === 'CONFLICT_ACTIVE_PLAN'; mockTransition not called; **assert PlanLedgerService.append called with event_type PLAN_ACTIVATION_REJECTED, caller 'resume', conflicting_plan_ids including other plan id(s); if testing order per code-level plan §6, assert conflicting_plan_ids sorted ascending (e.g. by plan_id), else assert membership only** |
| Resume: no other ACTIVE | listActivePlansForAccountAndType returns []; evaluateCanActivate returns can_activate true; transition(ACTIVE) called; 200 | Mock listActivePlansForAccountAndType returns []; mockEvaluateCanActivate({ can_activate: true, reasons: [] }); assert statusCode 200; mockTransition called with ACTIVE |
| Resume: conflict lookup called with correct args | tenant_id, account_id, plan.plan_type | Assert mock **listActivePlansForAccountAndType** calledWith(tenantId, accountId, plan.plan_type) |

**Coverage:** Branch when !result.can_activate (**409** and reasons, ledger event); branch when can_activate (transition called); call order: getPlan → conflict lookup → evaluateCanActivate → transition only if can_activate.

---

## 3. PlanOrchestratorService — Skip Activate on Conflict (100% Coverage)

**File:** `src/tests/unit/plan/PlanOrchestratorService.test.ts`

**Required tests:**

| Scenario | Expected | Test |
|----------|----------|------|
| APPROVED plan: conflict lookup (listActivePlansForAccountAndType) returns other plan IDs | evaluateCanActivate returns can_activate false; transition(ACTIVE) NOT called for this plan; **Plan Ledger PLAN_ACTIVATION_REJECTED written** (caller 'orchestrator'); orchestrator continues (no throw) | Mock repo.listPlansByTenantAndStatus('APPROVED') returns [planA]; mock conflict lookup (repo.listActivePlansForAccountAndType or orchestrator’s getActivePlanIdsForAccount backed by it) returns other plan id(s); mockGate.evaluateCanActivate resolves { can_activate: false, reasons: [{ code: 'CONFLICT_ACTIVE_PLAN' }] }; run(); assert lifecycle.transition NOT called with (planA, 'ACTIVE'); **assert PlanLedgerService.append called with event_type PLAN_ACTIVATION_REJECTED, caller 'orchestrator', conflicting_plan_ids; if testing order per code-level plan §6, assert conflicting_plan_ids sorted ascending, else assert membership only** |
| APPROVED plan: no other ACTIVE | Conflict lookup returns []; evaluateCanActivate returns can_activate true; transition(ACTIVE) called | Mock conflict lookup returns []; mockGate.evaluateCanActivate resolves { can_activate: true }; run(); assert transition called with plan, 'ACTIVE' |

**Coverage:** Branch when can_activate false (no transition, ledger event written); branch when can_activate true (transition called). Conflict lookup (**listActivePlansForAccountAndType** or orchestrator helper backed by it) must be invoked with (tenantId, accountId, planType) for each APPROVED plan. **Ledger assert mandatory when conflict:** append called with PLAN_ACTIVATION_REJECTED, caller 'orchestrator', conflicting_plan_ids.

---

## 4. PlanRepositoryService (6.5 Usage)

**File:** `src/tests/unit/plan/PlanRepositoryService.test.ts`

**Existing:** existsActivePlanForAccountAndType, listPlansByTenantAndStatus already covered. **6.5 (optional):** If adding **listActivePlansForAccountAndType**(tenantId, accountId, planType): Promise&lt;string[]&gt; as the canonical conflict lookup, unit test: returns non-empty array when ACTIVE plan(s) exist for that scope; returns [] when none. Resume and orchestrator both use this method (orchestrator may wrap it in getActivePlanIdsForAccount internally)—do not add a second, different helper.

---

## 5. Coverage Gates (100%)

**PlanPolicyGateService.ts (evaluateCanActivate):**
- 100% statement and branch for CONFLICT_ACTIVE_PLAN path (existing_active_plan_ids non-empty after excluding plan.plan_id).

**plan-lifecycle-api-handler.ts (resume):**
- 100% branch for !result.can_activate (**409**, reasons, ledger event, transition not called) and result.can_activate (transition called). Statement coverage for conflict lookup call and evaluateCanActivate call. **Ledger assert mandatory:** append called with PLAN_ACTIVATION_REJECTED, caller, conflicting_plan_ids when conflict.

**PlanOrchestratorService.ts (run loop):**
- 100% branch for can_activate true (transition) vs false (no transition). Conflict lookup (**listActivePlansForAccountAndType** or internal getActivePlanIdsForAccount backed by it) called for each APPROVED plan.

**Commands:**
```bash
npm test -- --testPathPattern=PlanPolicyGateService
npm test -- --testPathPattern=plan-lifecycle-api-handler
npm test -- --testPathPattern=PlanOrchestratorService
npm test -- --coverage --collectCoverageFrom='src/services/plan/PlanPolicyGateService.ts' --collectCoverageFrom='src/handlers/phase6/plan-lifecycle-api-handler.ts' --collectCoverageFrom='src/services/plan/PlanOrchestratorService.ts' --testPathPattern='(PlanPolicyGateService|plan-lifecycle-api-handler|PlanOrchestratorService)'
```

---

## 6. Integration Tests (Mandatory When Env Present)

**Status:** **Mandatory.** Same approach as Phase 6.3 and 6.4: seed → invoke handler → teardown. When integration tests run (e.g. `npm run test:integration` or post-deploy), the Phase 6.5 suite must pass when required env is present (REVENUE_PLANS_TABLE_NAME from `./deploy` .env). No skip flag.

**File:** `src/tests/integration/plan/conflict-resolution.test.ts`

**Flow:**
1. **Seed:** Put two plans in RevenuePlans for the same (tenant_id, account_id, plan_type): Plan A ACTIVE, Plan B PAUSED. Use unique ids (e.g. `plan-int-6-5-active-*`, `plan-int-6-5-paused-*`).
2. **Invoke:** Call plan-lifecycle-api-handler with POST /plans/:planId/resume for Plan B (PAUSED), with valid auth (tenant_id, account_id). Handler must obtain Plan A's id (conflict lookup), pass existing_active_plan_ids = [Plan A], evaluateCanActivate returns can_activate false, return **409 Conflict** with body.reasons containing one reason with code `CONFLICT_ACTIVE_PLAN`.
3. **Assert:** statusCode **409 Conflict**; body.error === 'Conflict'; body.reasons is array; at least one reason has code === 'CONFLICT_ACTIVE_PLAN'. **If PLAN_LEDGER_TABLE_NAME is present:** assert Plan Ledger contains an entry for Plan B with event_type `PLAN_ACTIVATION_REJECTED`, caller `resume`, conflicting_plan_ids including Plan A's id. For conflicting_plan_ids: either assert **sorted ascending** (e.g. by plan_id) per code-level plan §6, or assert **membership only** (order not asserted)—pick one to avoid flaky tests.
4. **Teardown:** Delete both seeded plans from RevenuePlans; if ledger was used, delete or leave ledger entries per test hygiene.

**When implementing 6.5:** If the integration test currently expects 400 and 'Cannot resume', update it to expect **409** and **body.error === 'Conflict'** as part of the 6.5 implementation (see code-level plan §4).

**Required env:** REVENUE_PLANS_TABLE_NAME (minimum to run the test). **PLAN_LEDGER_TABLE_NAME:** When present, integration must assert that the Plan Ledger contains `PLAN_ACTIVATION_REJECTED` for the rejected plan (plan_id, caller `resume`, conflicting_plan_ids). When not present, skip only the ledger assertion; the rest of the integration test still runs and is mandatory.

**Deploy script:** Integration tests are run after deployment; Phase 6.5 suite is included and must pass when env is present (same as 6.3, 6.4).

**Implementation note (409 vs 400):** The integration test file `src/tests/integration/plan/conflict-resolution.test.ts` may initially expect **400** and `body.error === 'Cannot resume'` (current handler behavior). When implementing 6.5 per the code-level plan (handler returns **409 Conflict** and `body.error === 'Conflict'`), **update the integration test** to expect:
- **statusCode 409** (not 400)
- **body.error === 'Conflict'** (not 'Cannot resume')

This is part of the 6.5 implementation checklist: the integration test must assert the 409 semantics once the handler is changed.

---

## 7. Success Criteria — 100% Coverage Checklist

Phase 6.5 tests are complete when:

1. **PlanPolicyGateService:** CONFLICT_ACTIVE_PLAN when existing_active_plan_ids has other plan(s); default empty array; filter excludes current plan_id (**self-conflict:** existing_active_plan_ids = [plan.plan_id] only → can_activate true); message clear.
2. **plan-lifecycle-api-handler resume:** **409 Conflict** when evaluateCanActivate returns can_activate false with CONFLICT_ACTIVE_PLAN; body.error 'Conflict'; body.reasons include CONFLICT_ACTIVE_PLAN; transition(ACTIVE) NOT called; **listActivePlansForAccountAndType** called with (tenantId, accountId, plan.plan_type); Plan Ledger PLAN_ACTIVATION_REJECTED written when conflict; 200 when no conflict and can_activate true.
3. **PlanOrchestratorService:** When conflict lookup (**listActivePlansForAccountAndType** or internal getActivePlanIdsForAccount backed by it) returns other plan IDs and gate returns can_activate false, transition(ACTIVE) NOT called and Plan Ledger PLAN_ACTIVATION_REJECTED written (caller 'orchestrator'); when no other ACTIVE and can_activate true, transition(ACTIVE) called.
4. **Integration:** conflict-resolution.test.ts seeds two plans (ACTIVE + PAUSED, same account+plan_type), invokes resume for PAUSED, asserts **409 Conflict**, body.error 'Conflict', and CONFLICT_ACTIVE_PLAN in reasons; **when PLAN_LEDGER_TABLE_NAME is present,** asserts ledger contains PLAN_ACTIVATION_REJECTED for rejected plan (caller 'resume', conflicting_plan_ids). Teardown both plans. Suite runs with integration tests and is mandatory when env present. **When implementing 6.5:** Update conflict-resolution.test.ts from 400 / 'Cannot resume' to **409** / **'Conflict'** so the test matches the code-level plan (§4).
5. **Deploy script:** Post-deploy integration test run includes Phase 6.5 (conflict-resolution); message updated to mention 6.5.

---

## 8. Test Structure and Locations

```
src/tests/
├── unit/
│   ├── plan/
│   │   ├── PlanPolicyGateService.test.ts   (verify CONFLICT_ACTIVE_PLAN coverage)
│   │   └── PlanOrchestratorService.test.ts (add skip-activate-on-conflict cases)
│   └── handlers/
│       └── phase6/
│           └── plan-lifecycle-api-handler.test.ts   (add resume conflict 409 cases)
└── integration/
    └── plan/
        └── conflict-resolution.test.ts   (Phase 6.5 — mandatory when env present)
```

---

## 9. References

- [PHASE_6_5_CODE_LEVEL_PLAN.md](../PHASE_6_5_CODE_LEVEL_PLAN.md) — implementation plan (§1–§9)
- [PHASE_6_IMPLEMENTATION_PLAN.md](../PHASE_6_IMPLEMENTATION_PLAN.md) — EPIC 6.5 acceptance criteria
- [PHASE_6_1_TEST_PLAN.md](PHASE_6_1_TEST_PLAN.md) — Policy Gate and handler test structure
- [PHASE_6_4_TEST_PLAN.md](PHASE_6_4_TEST_PLAN.md) — integration test pattern (seed → invoke → teardown)
