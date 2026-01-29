# Phase 3 Test Plan

**Last Updated:** 2026-01-28  
**Parent:** [PHASE_3_CODE_LEVEL_PLAN.md](../PHASE_3_CODE_LEVEL_PLAN.md)

---

## Summary

| Unit Coverage | Integration/Contract | Gaps |
|---------------|----------------------|------|
| Improved | ✅ phase3-certification | DecisionSynthesisService (Bedrock), decision handlers (4) — no unit tests (optional) |

---

## Components (from PHASE_3_CODE_LEVEL_PLAN)

Decision Context Assembler, Synthesis Service, Trigger Service, Policy Gate, Action Intent Service, Proposal Store, Cost Budget, Decision API, Event handlers.

---

## Unit test coverage

### ✅ Has unit tests

| Component | Test File |
|-----------|-----------|
| PolicyGateService | `src/tests/unit/decision/PolicyGateService.test.ts` |
| DecisionProposalStore | `src/tests/unit/decision/DecisionProposalStore.test.ts` |
| ActionIntentService | `src/tests/unit/decision/ActionIntentService.test.ts` |
| CostBudgetService | `src/tests/unit/decision/CostBudgetService.test.ts` |
| DecisionContextAssembler | `src/tests/unit/decision/DecisionContextAssembler.test.ts` |
| DecisionTriggerService | `src/tests/unit/decision/DecisionTriggerService.test.ts` |

### ❌ Missing unit tests (optional)

| Component | Source File | Notes |
|-----------|-------------|-------|
| DecisionSynthesisService | `src/services/decision/DecisionSynthesisService.ts` | Bedrock LLM; no unit test |
| decision-api-handler | `src/handlers/phase3/decision-api-handler.ts` | No unit test |
| decision-evaluation-handler | `src/handlers/phase3/decision-evaluation-handler.ts` | No unit test |
| decision-trigger-handler | `src/handlers/phase3/decision-trigger-handler.ts` | No unit test |
| budget-reset-handler | `src/handlers/phase3/budget-reset-handler.ts` | No unit test |

---

## Integration / contract

- **Contract:** `src/tests/contract/phase3-certification.test.ts` ✅  
- **Integration / manual / E2E:** [PHASE_3_INTEGRATION_TEST_PLAN.md](PHASE_3_INTEGRATION_TEST_PLAN.md) (API curl, CloudWatch, DynamoDB checks).

---

## Recommendations

1. Optionally mock Bedrock in `DecisionSynthesisService` for deterministic tests.  
2. Add handler unit tests for decision-api, decision-evaluation, decision-trigger, budget-reset (validation + mocks) if desired.

---

## Test commands

- **Unit:** `npm test` or `npm run test:unit`  
- **Integration:** `npm run test:integration`  
- See [docs/testing/INTEGRATION_TEST_SETUP.md](../../../testing/INTEGRATION_TEST_SETUP.md) and [PHASE_3_INTEGRATION_TEST_PLAN.md](PHASE_3_INTEGRATION_TEST_PLAN.md) for setup.
