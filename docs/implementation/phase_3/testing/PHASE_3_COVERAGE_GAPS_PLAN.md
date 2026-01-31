# Phase 3 Coverage Gaps Plan — Close Unit-Test Gaps

**Complements:** [PHASE_3_TEST_PLAN.md](PHASE_3_TEST_PLAN.md) (existing Phase 3 test plan; do not override).

This plan covers **all Phase 3 coverage gaps**: four handlers and one service with no dedicated unit tests. Implementing the tests below will close Phase 3 unit-test gaps.

**Scope:** `src/handlers/phase3/*` and `src/services/decision/DecisionSynthesisService.ts`.

---

## 1. Implementation order and file layout

| # | Target | Test file path | Notes |
|---|--------|----------------|-------|
| 1 | budget-reset-handler | `src/tests/unit/handlers/phase3/budget-reset-handler.test.ts` | Small, single-purpose; quick win |
| 2 | decision-trigger-handler | `src/tests/unit/handlers/phase3/decision-trigger-handler.test.ts` | EventBridge event + inferTriggerType |
| 3 | decision-api-handler | `src/tests/unit/handlers/phase3/decision-api-handler.test.ts` | Multiple routes; mock many services |
| 4 | decision-evaluation-handler | `src/tests/unit/handlers/phase3/decision-evaluation-handler.test.ts` | EventBridge event; mock context, synthesis, policy, budget, store, ledger, EventBridge |
| 5 | DecisionSynthesisService | `src/tests/unit/decision/DecisionSynthesisService.test.ts` | Mock Bedrock; test parse paths and ID generation |

**Test pattern:** Prefer **dependency injection** where handlers can be refactored to accept services (e.g. `createHandler(...)`). Where handlers use module-level singletons (current Phase 3 pattern), use **jest.mock()** for AWS SDK and service modules so that handler behavior is asserted without real I/O.

---

## 2. budget-reset-handler

**Source:** `src/handlers/phase3/budget-reset-handler.ts`

**Behavior:**
- If `event.detail?.account_id` and `event.detail?.tenant_id` are present: call `costBudgetService.resetDailyBudget(account_id, tenant_id)` and return `{ reset: 1 }`.
- Otherwise: log that batch reset is not implemented and return `{ reset: 0, message: '...' }`.
- On thrown error: log and rethrow.

**Dependencies to mock:**
- `CostBudgetService` (DynamoDB) — mock `resetDailyBudget`.
- Logger (optional, or spy for log assertions).

**Test cases:**

| Case | Input | Expected |
|------|--------|----------|
| Happy path – specific account | `event.detail = { account_id: 'acc1', tenant_id: 't1' }` | `costBudgetService.resetDailyBudget` called with `('acc1','t1')`; return `{ reset: 1 }`. |
| Batch path – no account/tenant | `event.detail = {}` or `event = {}` | `resetDailyBudget` not called; return `{ reset: 0, message: '...' }`. |
| Error path | `resetDailyBudget` throws | Error propagates; logger.error called. |

**Implementation note:** Handler uses module-level `costBudgetService`. Use `jest.mock('../../services/decision/CostBudgetService')` and ensure the handler module is required after mocks so the constructed service is the mock.

---

## 3. decision-trigger-handler

**Source:** `src/handlers/phase3/decision-trigger-handler.ts`

**Behavior:**
- Read `account_id`, `tenant_id` from `event.detail`.
- Infer trigger type via `inferTriggerType(envelope)` (LIFECYCLE_STATE_CHANGED → LIFECYCLE_TRANSITION; SIGNAL_DETECTED + high signal types → HIGH_SIGNAL_ARRIVAL; cc-native.scheduler + PERIODIC_DECISION_EVALUATION → COOLDOWN_GATED_PERIODIC; else null).
- If no trigger type: log and return (no EventBridge publish).
- Call `decisionTriggerService.shouldTriggerDecision(account_id, tenant_id, triggerType, envelope.id)`.
- If `!triggerResult.should_evaluate`: return (no publish).
- Otherwise: send `PutEventsCommand` with DECISION_EVALUATION_REQUESTED; log success.

**Dependencies to mock:**
- `DecisionTriggerService.shouldTriggerDecision`
- `EventBridgeClient.send` (PutEventsCommand)
- Logger (optional).

**Test cases:**

| Case | Event envelope | shouldTriggerDecision | Expected |
|------|----------------|------------------------|----------|
| Unknown event | `detail-type: 'UNKNOWN'` | N/A | No PutEvents; no throw. |
| LIFECYCLE_STATE_CHANGED | `detail-type: 'LIFECYCLE_STATE_CHANGED'`, detail has account_id, tenant_id | `{ should_evaluate: false, reason: '...' }` | No PutEvents. |
| LIFECYCLE_STATE_CHANGED | Same | `{ should_evaluate: true }` | PutEvents called with DECISION_EVALUATION_REQUESTED, detail has trigger_type LIFECYCLE_TRANSITION. |
| SIGNAL_DETECTED (high signal) | `detail-type: 'SIGNAL_DETECTED'`, detail.signal_type = RENEWAL_WINDOW_ENTERED | `{ should_evaluate: true }` | PutEvents with trigger_type HIGH_SIGNAL_ARRIVAL. |
| SIGNAL_DETECTED (low signal) | detail.signal_type = some low type | N/A | inferTriggerType returns null; no PutEvents. |
| PERIODIC_DECISION_EVALUATION | source: 'cc-native.scheduler', detail-type: 'PERIODIC_DECISION_EVALUATION' | `{ should_evaluate: true }` | PutEvents with trigger_type COOLDOWN_GATED_PERIODIC. |
| Error path | Any; `shouldTriggerDecision` or `send` throws | N/A | Error propagates. |

**Implementation note:** `inferTriggerType` is not exported. Either export it for unit testing or test it indirectly by asserting on EventBridge payload (trigger_type) for known envelope shapes.

---

## 4. decision-api-handler

**Source:** `src/handlers/phase3/decision-api-handler.ts`

**Exports:** `handler` (main router), `evaluateDecisionHandler`, `getAccountDecisionsHandler`, `approveActionHandler`, `rejectActionHandler`, `getEvaluationStatusHandler`. Routes: POST /decisions/evaluate, GET /decisions/{evaluation_id}/status, GET /accounts/{account_id}/decisions, POST /actions/{action_id}/approve, POST /actions/{action_id}/reject; 404 for unknown route.

**Dependencies to mock:**
- `DecisionTriggerService.shouldTriggerDecision`
- `CostBudgetService.canEvaluateDecision`, `consumeBudget` (if any path uses it — evaluate path does not consume)
- `ActionIntentService.createIntent`
- `DecisionProposalStore.getProposal`, `storeProposal`
- `LedgerService.append`, `query`
- `EventBridgeClient.send` (PutEventsCommand)
- `TraceService.generateTraceId`

**Test cases (by route):**

### 4.1 Main handler routing

| Case | httpMethod, resource/path, pathParameters | Expected handler / response |
|------|------------------------------------------|----------------------------|
| POST /decisions/evaluate | POST, resource `/decisions/evaluate`, body with account_id, tenant_id | evaluateDecisionHandler behavior. |
| GET /decisions/{id}/status | GET, pathParameters.evaluation_id set | getEvaluationStatusHandler behavior. |
| GET /accounts/{id}/decisions | GET, pathParameters.account_id set, header x-tenant-id | getAccountDecisionsHandler behavior. |
| POST /actions/{id}/approve | POST, pathParameters.action_id, body decision_id, header x-tenant-id | approveActionHandler behavior. |
| POST /actions/{id}/reject | POST, pathParameters.action_id, body decision_id, header x-tenant-id | rejectActionHandler behavior. |
| Unknown route | e.g. GET /other | 404, body `{ error: 'Not found', path: ... }`. |

### 4.2 evaluateDecisionHandler

| Case | Body / trigger | shouldTrigger | canEvaluate | Expected |
|------|----------------|---------------|------------|----------|
| Not triggered | account_id, tenant_id, trigger_type | `{ should_evaluate: false, reason: '...' }` | N/A | 200, `{ message: 'Decision not triggered', reason }`. |
| Budget exceeded | should_evaluate: true | `{ allowed: false, reason: '...' }` | 429, `{ message: 'Budget exceeded', reason }`. |
| Success | should_evaluate: true, allowed: true | N/A | PutEvents DECISION_EVALUATION_REQUESTED; ledger append DECISION_EVALUATION_REQUESTED; 202 with evaluation_id, status_url. |
| Error | Any; e.g. trigger service throws | N/A | 500, `{ error: 'Internal server error' }`. |

### 4.3 getAccountDecisionsHandler

| Case | pathParameters.account_id, headers x-tenant-id | ledgerService.query | Expected |
|------|-----------------------------------------------|---------------------|----------|
| Missing account_id or tenant_id | One or both missing | N/A | 400, `{ error: 'Missing account_id or tenant_id', ... }`. |
| Success | Both set | Return array | 200, `{ decisions }`. |
| Error | Query throws | N/A | 500, body includes error. |

### 4.4 approveActionHandler

| Case | action_id, decision_id, tenant_id (header), body edits | getProposal | createIntent | Expected |
|------|-------------------------------------------------------|-------------|-------------|----------|
| Missing fields | Any of action_id, decision_id, tenant_id missing | N/A | N/A | 400. |
| Decision not found | getProposal returns null | N/A | N/A | 404, 'Decision not found'. |
| Action not in proposal | proposal.actions does not contain action_ref === actionId | N/A | N/A | 404, 'Action proposal not found in decision'. |
| Success | Valid; getProposal returns proposal; createIntent returns intent | Called | Called | Ledger append ACTION_APPROVED; PutEvents ACTION_APPROVED with approval_source HUMAN, auto_executed false; 200, `{ intent }`. |
| Error | createIntent or ledger/EventBridge throws | N/A | N/A | 500. |

### 4.5 rejectActionHandler

| Case | action_id, decision_id, tenant_id | getProposal | Expected |
|------|----------------------------------|-------------|----------|
| Missing fields | Any missing | N/A | 400. |
| Decision not found | null | N/A | 404. |
| Action not in proposal | proposal without matching action_ref | N/A | 404. |
| Success | Valid | Return proposal | Ledger append ACTION_REJECTED; 200, `{ message: 'Action rejected' }`. |
| Error | Ledger throws | N/A | 500. |

### 4.6 getEvaluationStatusHandler

| Case | evaluation_id, tenant_id | ledgerService.query (REQUESTED then PROPOSED) | decisionProposalStore.getProposal | Expected |
|------|---------------------------|-----------------------------------------------|-----------------------------------|----------|
| Missing evaluation_id or tenant_id | One or both missing | N/A | N/A | 400. |
| Evaluation not found | No event with data.evaluation_id === evaluationId | N/A | N/A | 404. |
| PENDING | REQUESTED found; no PROPOSED for this evaluation | N/A | N/A | 200, status PENDING, created_at. |
| COMPLETED | REQUESTED + PROPOSED with matching evaluation_id | getProposal returns proposal | N/A | 200, status COMPLETED, decision_id, decision (proposal), created_at, completed_at. |
| Error | Any throw | N/A | N/A | 500. |

**Implementation note:** Handler uses module-level service instances. Use `jest.mock()` for each service and EventBridge client; require handler after mocks. For routing tests, invoke the main `handler` with different `event` shapes.

---

## 5. decision-evaluation-handler

**Source:** `src/handlers/phase3/decision-evaluation-handler.ts`

**Behavior:** EventBridge event with detail `account_id`, `tenant_id`, `trigger_type`, `evaluation_id`, `trace_id`. Steps: (1) assemble context, (2) check budget, (3) synthesize decision, (4) evaluate policy, (5) consume budget, (6) store proposal, (7) ledger DECISION_PROPOSED, (8) ledger POLICY_EVALUATED per result, (9) PutEvents DECISION_PROPOSED. If budget not allowed, return early. On error, throw.

**Dependencies to mock:**
- `DecisionContextAssembler.assembleContext`
- `CostBudgetService.canEvaluateDecision`, `consumeBudget`
- `DecisionSynthesisService.synthesizeDecision`
- `PolicyGateService.evaluateDecisionProposal`
- `DecisionProposalStore.storeProposal`
- `LedgerService.append`
- `EventBridgeClient.send` (PutEventsCommand)

**Test cases:**

| Case | assembleContext | canEvaluate | synthesizeDecision | Expected |
|------|-----------------|-------------|--------------------|----------|
| Budget blocked | Return context | `{ allowed: false }` | N/A | Early return; no synthesis, no store, no event. |
| Happy path | Return context | `{ allowed: true }` | Return proposal | consumeBudget(1); storeProposal; ledger DECISION_PROPOSED + POLICY_EVALUATED; PutEvents DECISION_PROPOSED. |
| Error in synthesis | Return context | allowed: true | Throw | Error propagates; no store. |
| Error in store | Store throws | N/A | Return proposal | Error propagates. |

**Implementation note:** Handler initializes Neptune/GraphService at module load. Mock `NeptuneConnection.getInstance()` and/or `GraphService` so that no real Neptune connection is attempted. Alternatively mock at `../../services/graph/NeptuneConnection` and `../../services/graph/GraphService`.

---

## 6. DecisionSynthesisService

**Source:** `src/services/decision/DecisionSynthesisService.ts`

**Behavior:** `synthesizeDecision(context)` builds prompt, calls Bedrock `InvokeModelCommand`, parses JSON from response (raw or inside markdown code block), validates with `DecisionProposalBodyV1Schema`, generates fingerprint and decision_id, enriches actions with server-generated `action_ref`, returns `DecisionProposalV1`.

**Dependencies to mock:**
- `BedrockRuntimeClient.send` (InvokeModelCommand) — return a minimal response body that decodes to JSON with `content[0].text` containing valid proposal body JSON.

**Test cases:**

| Case | Mock Bedrock response (content[0].text) | Expected |
|------|----------------------------------------|----------|
| Happy path – raw JSON | Valid DecisionProposalBodyV1 JSON (decision_type, actions, summary, etc.) | Parsed and validated; proposal has decision_id, account_id, tenant_id, trace_id from context; actions have action_ref. |
| Wrapped in markdown code block | Same JSON inside `` ```json ... ``` `` | Same as above. |
| Parse failure – no JSON | Plain text or invalid JSON | Throws with message indicating parse failure. |
| Bedrock 404 / model not found | Throw with ResourceNotFoundException or httpStatusCode 404 | Throws with message like "Bedrock model not found". |
| Schema validation failure | JSON missing required fields or wrong types | Zod parse throws; error propagates. |
| action_ref stability | Two actions; same action_type/target/why[0] ordering | action_ref is deterministic (e.g. same inputs → same refs when order is stable). |

**Implementation note:** Use a minimal `DecisionContextV1` fixture (account_id, tenant_id, trace_id, posture_state, risk_factors, opportunities, unknowns, active_signals, policy_context). Mock `InvokeModelCommand` to resolve with `{ body: new TextEncoder().encode(JSON.stringify({ content: [{ text: proposalBodyJson }] })) }`.

---

## 7. Test file creation checklist

- [x] Create directory `src/tests/unit/handlers/phase3/` if it does not exist.
- [x] Implement `budget-reset-handler.test.ts` (all cases in §2).
- [x] Implement `decision-trigger-handler.test.ts` (all cases in §3).
- [x] Implement `decision-api-handler.test.ts` (routing + §4.2–4.6).
- [x] Implement `decision-evaluation-handler.test.ts` (all cases in §5).
- [x] Implement `DecisionSynthesisService.test.ts` in `src/tests/unit/decision/` (all cases in §6).
- [x] Run `npx jest --coverage --testPathIgnorePatterns=integration` and confirm Phase 3 handlers and DecisionSynthesisService show increased (or full) line/branch coverage.
- [ ] Optionally add `coverageThreshold` in `jest.config.js` and set global minimums so Phase 3 coverage cannot regress unnoticed.

---

## 8. References

- **Existing Phase 3 test plan:** [PHASE_3_TEST_PLAN.md](PHASE_3_TEST_PLAN.md) (summary, contract, recommendations).
- **Handler test pattern (injected deps):** `src/tests/unit/handlers/phase4/execution-starter-handler.test.ts`, `src/tests/unit/handlers/phase5/auto-approval-gate-handler.test.ts`.
- **Handler test pattern (module mocks):** Use `jest.mock('path/to/service')` and `require` or dynamic import of handler after mocks.
- **Coverage improvement overview:** `docs/testing/TEST_COVERAGE_IMPROVEMENT.md`.
