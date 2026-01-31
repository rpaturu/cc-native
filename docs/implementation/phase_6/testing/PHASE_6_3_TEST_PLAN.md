# Phase 6.3 Test Plan — Plan Orchestration Over Time

**Status:** 🟢 **IMPLEMENTED**  
**Created:** 2026-01-30  
**Last Updated:** 2026-01-30  
**Parent:** [../PHASE_6_3_CODE_LEVEL_PLAN.md](../PHASE_6_3_CODE_LEVEL_PLAN.md)  
**Canonical contract:** [../PHASE_6_IMPLEMENTATION_PLAN.md](../PHASE_6_IMPLEMENTATION_PLAN.md) EPIC 6.3  
**Reference:** [PHASE_6_2_TEST_PLAN.md](PHASE_6_2_TEST_PLAN.md) — structure and coverage pattern

---

## Gap Analysis (vs 100% Coverage)

| Item | Plan § | Status | Notes |
|------|--------|--------|--------|
| **PlanStateEvaluatorService.test.ts** | §1, §2 | ✅ Complete | EXPIRE, COMPLETE (all_steps_done, DONE+SKIPPED), NO_CHANGE; empty steps; determinism; expires_at undefined. |
| **PlanStepExecutionStateService.test.ts** | §3, §3a, §3b | ✅ Complete | getCurrentNextAttempt; reserveNextAttempt (ADD, throw when invalid); recordStepStarted (ConditionExpression, sk, claimed true/false); updateStepOutcome (error_message). |
| **PlanOrchestratorService.test.ts** | §4 | ✅ Complete | runCycle: K-bound; activation; step dispatch; claimed false; dependencies; retry limit → pause; evaluator COMPLETE/EXPIRE/NO_CHANGE; applyStepOutcome DONE/FAILED/SKIPPED; plan not found; early return (not ACTIVE/PAUSED, getPlan null). |
| **plan-orchestrator-handler.test.ts** | §5 | ✅ Complete | Tenant IDs from Tenants table (Scan); runCycle called per tenant; no tenants → no runCycle; throw when TENANTS_TABLE_NAME missing; throw when required env missing; runCycle throw propagates. |
| **PlanTypeConfig (6.3)** | §6 | ✅ Complete | max_retries_per_step === 3 in planTypeConfig.test.ts. |
| **Ledger step events** | §9 | ✅ Complete | STEP_STARTED, STEP_FAILED, STEP_COMPLETED, STEP_SKIPPED payloads asserted in PlanOrchestratorService tests. |

---

## Executive Summary

This document defines **100% test coverage** requirements for Phase 6.3 (Plan Orchestration Over Time: Plan State Evaluator, Step Execution State, Plan Orchestrator, Orchestrator Handler). Every evaluator branch, step attempt mechanism, orchestrator path (activation, step dispatch, retry limit, pause on exhaustion, State Evaluator COMPLETE/EXPIRE), and handler path must be covered by unit tests.

**Coverage target:** 100% statement and branch coverage for Phase 6.3 modules: `PlanStateEvaluatorService.ts`, step execution state service (e.g. `PlanStepExecutionStateService.ts`), `PlanOrchestratorService.ts`, `plan-orchestrator-handler.ts`; and 6.3 branches in `PlanTypeConfig` / plan type config.

---

## 1. Plan State Evaluator — 100% Coverage

**File:** `src/tests/unit/plan/PlanStateEvaluatorService.test.ts`

**Mock:** None (pure function of plan + optional context). No DB read/write.

### evaluate(input: PlanStateEvaluatorInput)

| Scenario | Result | Test |
|----------|--------|------|
| now >= plan.expires_at | EXPIRE, expired_at | Mock Date or pass plan with expires_at in past; assert action === 'EXPIRE', expired_at set |
| All steps DONE | COMPLETE, completion_reason 'all_steps_done' | plan.steps every step status === 'DONE'; assert action === 'COMPLETE', completion_reason === 'all_steps_done' |
| All steps DONE or SKIPPED (RENEWAL_DEFENSE) | COMPLETE, completion_reason 'all_steps_done' | plan.steps mix of DONE and SKIPPED; assert COMPLETE, all_steps_done (SKIPPED counts as terminal success) |
| Some step PENDING / FAILED | NO_CHANGE | plan.steps at least one PENDING or FAILED; assert action === 'NO_CHANGE' |
| Empty steps (edge) | COMPLETE all_steps_done or NO_CHANGE per spec | plan.steps = []; assert per implementation (all_steps_done if empty counts as done) |
| objective_met (if implemented) | COMPLETE, completion_reason 'objective_met' | context indicates objective met; assert COMPLETE, objective_met (optional branch) |
| Determinism | Same input → same result | evaluate twice with same plan + context; assert deep equality of results |

**Coverage:** Every branch: expiry first, then completion (all DONE or DONE+SKIPPED), then NO_CHANGE; determinism.

---

## 2. Step Execution State Service — 100% Coverage (§3, §3a, §3b)

**File:** `src/tests/unit/plan/PlanStepExecutionStateService.test.ts` (or equivalent name per implementation)

**Mock:** DynamoDBDocumentClient (UpdateCommand for ADD next_attempt; PutCommand with ConditionExpression; GetCommand/QueryCommand as needed).

### Attempt number (§3a — single authoritative mechanism)

| Scenario | Expected | Test |
|----------|----------|------|
| obtainNextAttempt(plan_id, step_id) | UpdateItem ADD next_attempt :1; return returned value as attempt | Assert UpdateCommand/UpdateItem with ADD next_attempt; assert returned attempt is number, >= 1 |
| First attempt for step | attempt === 1 | Mock DynamoDB to return UPDATED_NEW next_attempt: 1; assert attempt === 1 |
| Subsequent attempt | attempt === 2, 3, ... | Mock return next_attempt: 2; assert attempt === 2 |

### Idempotency row

| Scenario | Expected | Test |
|----------|----------|------|
| recordStepStarted(plan_id, step_id, attempt, ...) | PutCommand with sk = STEP#<step_id>#ATTEMPT#<attempt>; ConditionExpression attribute_not_exists(sk) | Assert PutItem with correct pk/sk; ConditionExpression attribute_not_exists(sk) |
| Duplicate (condition fails) | Throw or return false (do not double-execute) | Mock send to reject conditional check; assert error or false |

### Retry count

| Scenario | Expected | Test |
|----------|----------|------|
| getRetryCountForStep(plan_id, step_id) | Count of attempts (or attempt - 1 for in-flight) per spec | Mock Query/Get; assert count used for comparison with N |

### Step status transitions (§3b)

| Scenario | Expected | Test |
|----------|----------|------|
| PENDING → DONE / FAILED / SKIPPED | Allowed | updateStepStatus(plan_id, step_id, 'DONE'); assert allowed |
| DONE → * | Reject | Assert transition to any other status throws or returns false |
| SKIPPED → * | Reject | Assert transition from SKIPPED rejected |
| FAILED → (new attempt) | Allowed only via new attempt (new attempt number) | New attempt row allowed; same attempt row not updated to PENDING |

**Coverage:** Atomic attempt generation; idempotency condition; retry count; every allowed/disallowed transition in §3b table.

---

## 3. Plan Orchestrator Service — 100% Coverage

**File:** `src/tests/unit/plan/PlanOrchestratorService.test.ts`

**Mock:** PlanRepositoryService, PlanLifecycleService, PlanPolicyGateService, PlanLedgerService, PlanStateEvaluatorService, PlanStepExecutionStateService (or equivalent), ActionIntentService / Phase 3 create intent, Phase 4 execution trigger (or stub). Config: ORCHESTRATOR_MAX_PLANS_PER_RUN = K, retry limit N.

### runCycle(tenantId?: string)

#### Per-run bound K

| Scenario | Expected | Test |
|----------|----------|------|
| More than K APPROVED plans | Process at most K (activation) | listPlansByTenantAndStatus(APPROVED) returns K+1; assert only K transitions to ACTIVE (or K evaluateCanActivate calls) |
| More than K ACTIVE plans | Process at most K (step advancement) | listPlansByTenantAndStatus(ACTIVE) returns K+1; assert only K plans get step dispatch |

#### Activation (APPROVED → ACTIVE)

| Scenario | Expected | Test |
|----------|----------|------|
| APPROVED plan, evaluateCanActivate true | transition(plan, 'ACTIVE') called; ledger PLAN_ACTIVATED | Mock can_activate true; assert transition called with ACTIVE; ledger append PLAN_ACTIVATED |
| APPROVED plan, evaluateCanActivate false | transition not called | Mock can_activate false; assert transition not called |
| No APPROVED plans | activated === 0 | listPlansByTenantAndStatus returns []; assert activated === 0 |

#### Step advancement (next PENDING step)

| Scenario | Expected | Test |
|----------|----------|------|
| ACTIVE plan, next step PENDING, retry count < N | obtainNextAttempt; create action intent; recordStepStarted; ledger STEP_STARTED | Assert createFromPlanStep (or equivalent) called with plan_id, step_id, attempt; ledger append STEP_STARTED |
| ACTIVE plan, next step PENDING, retry count >= N | Do not start step; mark step FAILED; ledger STEP_FAILED; pause plan | Mock retry count >= N; assert no create intent; STEP_FAILED appended; transition(plan, 'PAUSED') called |
| ACTIVE plan, no PENDING steps (all DONE/SKIPPED) | Call State Evaluator; if COMPLETE → transition to COMPLETED, PLAN_COMPLETED | Mock evaluator returns COMPLETE all_steps_done; assert transition(plan, 'COMPLETED'); ledger PLAN_COMPLETED |
| ACTIVE plan, no PENDING steps, evaluator EXPIRE | transition(plan, 'EXPIRED'); ledger PLAN_EXPIRED | Mock evaluator returns EXPIRE; assert transition(plan, 'EXPIRED'); ledger PLAN_EXPIRED |
| ACTIVE plan, no PENDING steps, evaluator NO_CHANGE | No transition | Mock evaluator returns NO_CHANGE; assert transition not called |

#### Outcome handling (when step outcome is known)

| Scenario | Expected | Test |
|----------|----------|------|
| Step outcome SUCCESS | Update step status DONE; ledger STEP_COMPLETED; re-evaluate plan; if COMPLETE → PLAN_COMPLETED | Mock outcome success; assert step status DONE; STEP_COMPLETED; evaluator called; transition if COMPLETE |
| Step outcome FAILED | Update step status FAILED; ledger STEP_FAILED | Assert step status FAILED; STEP_FAILED |
| Step outcome SKIPPED | Update step status SKIPPED; ledger STEP_SKIPPED | Assert STEP_SKIPPED |

#### Return counts

| Scenario | Expected | Test |
|----------|----------|------|
| runCycle return | { activated, stepsStarted, completed, expired } | Assert all four counts present; values match mocked behavior |

**Coverage:** runCycle entry; K-bound for APPROVED and ACTIVE; activation branch (can_activate true/false); step dispatch branch (retry < N vs >= N); State Evaluator COMPLETE/EXPIRE/NO_CHANGE; step status transitions; ledger event types STEP_STARTED, STEP_COMPLETED, STEP_FAILED, STEP_SKIPPED, PLAN_COMPLETED, PLAN_EXPIRED.

---

## 4. Plan Orchestrator Handler — 100% Coverage

**File:** `src/tests/unit/handlers/phase6/plan-orchestrator-handler.test.ts`

**Mock:** DynamoDB send (ScanCommand for Tenants table); PlanOrchestratorService.runCycle. **No TENANT_ID in env** — tenant IDs are discovered at runtime from the Tenants table (same pattern as rest of codebase).

### Tenant discovery (Tenants table)

| Scenario | Expected | Test |
|----------|----------|------|
| Scan Tenants table | listTenantIds returns tenantId from each item | Mock DynamoDB send to resolve Scan with Items: [{ tenantId: 't1' }]; assert runCycle called with 't1' |
| Multiple tenants | runCycle called once per tenant | Mock Scan with Items: [{ tenantId: 't1' }, { tenantId: 't2' }]; assert runCycle called with 't1', then 't2' |
| No tenants | runCycle not called; handler exits | Mock Scan with Items: []; assert runCycle not called |
| Missing TENANTS_TABLE_NAME | Handler throws before runCycle | Unset TENANTS_TABLE_NAME; assert handler rejects with /TENANTS_TABLE_NAME/ |

### EventBridge scheduled event

| Scenario | Expected | Test |
|----------|----------|------|
| EventBridge event (source: events.amazonaws.com, detail-type: Scheduled Event) | listTenantIds; runCycle() called for each tenant | Invoke handler; assert runCycle called per tenant from mocked Scan |
| runCycle returns counts | Handler aggregates counts; logs; no throw | runCycle resolves; assert handler resolves without throw |
| runCycle throws | Handler propagates; no unhandled rejection | runCycle rejects; assert handler rejects with same error |

### Environment

| Scenario | Expected | Test |
|----------|----------|------|
| Missing required env (e.g. TENANTS_TABLE_NAME, REVENUE_PLANS_TABLE_NAME) | Handler throws before runCycle | Unset env; invoke handler; assert handler rejects with /Missing env|TENANTS_TABLE_NAME|REVENUE_PLANS_TABLE_NAME/ |

**Coverage:** Handler entry; tenant discovery (Scan Tenants table); runCycle invocation per tenant; no tenants path; env validation (TENANTS_TABLE_NAME, etc.); error propagation.

---

## 5. Plan Type Config (6.3) — max_retries_per_step

**File:** `src/tests/unit/config/planTypeConfig.test.ts` (extend existing)

### getPlanTypeConfig('RENEWAL_DEFENSE') — 6.3 fields

| Scenario | Expected | Test |
|----------|----------|------|
| RENEWAL_DEFENSE config | max_retries_per_step === 3 (default) | Assert getPlanTypeConfig('RENEWAL_DEFENSE').max_retries_per_step === 3 |
| Unknown type | null (no change) | getPlanTypeConfig('OTHER') returns null |

**Coverage:** New field max_retries_per_step present and used by orchestrator (orchestrator tests assert retry limit N from config).

---

## 6. Plan Ledger — Step Events (payload assertions)

**File:** Covered in PlanOrchestratorService.test.ts (and optionally PlanLedgerService tests if needed)

### Event payloads (§9)

| Event type     | data payload asserted in test |
|----------------|-------------------------------|
| STEP_STARTED   | plan_id, step_id, action_type, attempt |
| STEP_COMPLETED | plan_id, step_id, outcome? |
| STEP_SKIPPED   | plan_id, step_id, reason |
| STEP_FAILED    | plan_id, step_id, reason, attempt? |

**Coverage:** For each step event emitted by orchestrator, assert PlanLedgerService.append called with correct event_type and data shape (in orchestrator unit tests).

---

## 7. Test Structure and Locations

```
src/tests/
├── unit/
│   ├── config/
│   │   └── planTypeConfig.test.ts           (§5 — extend with max_retries_per_step)
│   ├── plan/
│   │   ├── PlanStateEvaluatorService.test.ts      (§1)
│   │   ├── PlanStepExecutionStateService.test.ts  (§2)
│   │   └── PlanOrchestratorService.test.ts        (§3)
│   └── handlers/
│       └── phase6/
│           └── plan-orchestrator-handler.test.ts   (§4)
├── fixtures/
│   └── plan/
│       └── (existing + optional orchestrator fixtures)
└── integration/
    └── plan/
        └── plan-orchestrator.test.ts   (mandatory when env present)
```

---

## 8. Running Tests and Coverage Gates

### Integration tests (mandatory when env present)

Phase 6.3 integration suite runs as part of `npm run test:integration` when required env vars are set (e.g. after `./deploy`). It is **mandatory** to pass when integration tests are run with env configured; no skip flag.

```bash
npm run test:integration
# Or run only Phase 6.3 integration:
npx jest --testPathPattern=tests/integration/plan/plan-orchestrator
```

### Unit tests (required)

```bash
npm test -- --testPathPattern="PlanStateEvaluator|PlanStepExecutionState|PlanOrchestrator|plan-orchestrator-handler|planTypeConfig"
```

### Coverage gate (100% for Phase 6.3 modules)

```bash
npm test -- --coverage \
  --collectCoverageFrom='src/services/plan/PlanStateEvaluatorService.ts' \
  --collectCoverageFrom='src/services/plan/PlanStepExecutionStateService.ts' \
  --collectCoverageFrom='src/services/plan/PlanOrchestratorService.ts' \
  --collectCoverageFrom='src/handlers/phase6/plan-orchestrator-handler.ts' \
  --collectCoverageFrom='src/types/plan/PlanStateEvaluatorTypes.ts' \
  --testPathPattern="PlanStateEvaluator|PlanStepExecutionState|PlanOrchestrator|plan-orchestrator-handler"
```

**Requirement:** 100% statement and branch coverage for Phase 6.3 modules. PlanTypeConfig 6.3 branch (max_retries_per_step) covered in existing planTypeConfig test file.

- `src/services/plan/PlanStateEvaluatorService.ts` — 100% statements, branches, lines
- `src/services/plan/PlanStepExecutionStateService.ts` (or equivalent) — 100% statements, branches, lines
- `src/services/plan/PlanOrchestratorService.ts` — 100% statements, branches, lines
- `src/handlers/phase6/plan-orchestrator-handler.ts` — 100% lines

---

## 9. Success Criteria — 100% Coverage Checklist

Phase 6.3 tests are complete when:

1. **PlanStateEvaluatorService:** EXPIRE when now >= expires_at; COMPLETE all_steps_done when all steps DONE or (DONE+SKIPPED for RENEWAL_DEFENSE); COMPLETE objective_met when implemented; NO_CHANGE otherwise; determinism.
2. **PlanStepExecutionStateService:** obtainNextAttempt (atomic ADD, returned attempt); recordStepStarted with attribute_not_exists(sk); duplicate attempt rejected; getRetryCountForStep; step status transitions per §3b (allowed/rejected).
3. **PlanOrchestratorService:** runCycle K-bound (APPROVED and ACTIVE); activation (can_activate true → transition ACTIVE; false → skip); step dispatch (retry < N → intent + STEP_STARTED; retry >= N → STEP_FAILED + pause); State Evaluator COMPLETE → PLAN_COMPLETED, EXPIRE → PLAN_EXPIRED, NO_CHANGE → no transition; outcome handling (DONE/FAILED/SKIPPED + ledger); return counts.
4. **plan-orchestrator-handler:** EventBridge event → list tenant IDs from Tenants table (Scan); runCycle called per tenant; no tenants → runCycle not called; missing env (TENANTS_TABLE_NAME or other) → handler throws; runCycle throw → handler propagates.
5. **PlanTypeConfig (6.3):** max_retries_per_step === 3 for RENEWAL_DEFENSE.
6. **Ledger step events:** STEP_STARTED, STEP_COMPLETED, STEP_SKIPPED, STEP_FAILED payloads asserted in orchestrator tests.
7. **Coverage gate:** 100% statement and branch coverage for the four modules above; CI passes before merge.

---

## 10. Integration Tests (Mandatory)

**Status:** **Mandatory.** When integration tests run (e.g. `npm run test:integration` or post-deploy), the Phase 6.3 integration suite must pass. No skip flag; run when required env is present (from `./deploy` .env: REVENUE_PLANS_TABLE_NAME, PLAN_LEDGER_TABLE_NAME, PLAN_STEP_EXECUTION_TABLE_NAME, TENANTS_TABLE_NAME, ACTION_INTENT_TABLE_NAME).

**File:** `src/tests/integration/plan/plan-orchestrator.test.ts`

| Scenario | Description |
|----------|-------------|
| Invoke handler with scheduled event | Seed one test tenant in Tenants table (beforeAll); invoke plan-orchestrator handler with EventBridge scheduled event; assert handler completes without throw (runCycle per tenant against real DynamoDB); tear down: delete test tenant in afterAll. |

**Optional future scenarios (not required for mandatory pass):** One ACTIVE plan one step (orchestrator creates intent; outcome DONE → PLAN_COMPLETED); retry limit (step fails N times → STEP_FAILED, pause); per-run bound K (seed K+1 APPROVED; one run processes K only).

---

## References

- [PHASE_6_3_CODE_LEVEL_PLAN.md](../PHASE_6_3_CODE_LEVEL_PLAN.md) — implementation plan (§1–§12)
- [PHASE_6_IMPLEMENTATION_PLAN.md](../PHASE_6_IMPLEMENTATION_PLAN.md) — EPIC 6.3 acceptance criteria
- [PHASE_6_2_TEST_PLAN.md](PHASE_6_2_TEST_PLAN.md) — structure reference
- [PHASE_6_1_TEST_PLAN.md](PHASE_6_1_TEST_PLAN.md) — plan lifecycle and ledger patterns
