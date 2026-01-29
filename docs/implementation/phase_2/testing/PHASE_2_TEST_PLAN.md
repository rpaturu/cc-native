# Phase 2 Test Plan

**Status:** 🟢 **COMPLETE**  
**Last Updated:** 2026-01-28  
**Parent:** [PHASE_2_CODE_LEVEL_PLAN.md](../PHASE_2_CODE_LEVEL_PLAN.md)

---

## Summary

| Unit Coverage | Integration | Gaps |
|---------------|-------------|------|
| Improved | ✅ phase2 integration (Neptune) | GraphService, GraphMaterializer, NeptuneConnection, handlers (2) — no unit tests (optional) |

---

## Components (from PHASE_2_CODE_LEVEL_PLAN)

Neptune, Graph Service, Graph Materializer, Posture types, Synthesis Engine, AccountPostureState Service, Event handlers.

---

## Unit test coverage

### ✅ Has unit tests

| Component | Test File |
|-----------|-----------|
| ConditionEvaluator | `src/tests/unit/synthesis/ConditionEvaluator.test.ts` |
| RulesetLoader | `src/tests/unit/synthesis/RulesetLoader.test.ts` |
| SynthesisEngine | `src/tests/unit/synthesis/SynthesisEngine.test.ts` |
| AccountPostureStateService | `src/tests/unit/synthesis/AccountPostureStateService.test.ts` |

### ❌ Missing unit tests (optional)

| Component | Source File | Notes |
|-----------|-------------|-------|
| NeptuneConnection | `src/services/graph/NeptuneConnection.ts` | Network; often tested via integration only |
| GraphService | `src/services/graph/GraphService.ts` | Neptune; no unit test |
| GraphMaterializer | `src/services/graph/GraphMaterializer.ts` | No unit test |
| graph-materializer-handler | `src/handlers/phase2/graph-materializer-handler.ts` | No unit test |
| synthesis-engine-handler | `src/handlers/phase2/synthesis-engine-handler.ts` | No unit test |

---

## Integration

- **Integration:** `src/tests/integration/phase2.test.ts` ✅ (Neptune connectivity; may skip when env missing)  
- **Integration test plan:** [PHASE_2_INTEGRATION_TEST_PLAN.md](PHASE_2_INTEGRATION_TEST_PLAN.md) (Neptune, EC2 test runner, scripts).

---

## Recommendations

1. GraphService / GraphMaterializer / NeptuneConnection can remain integration-only if Neptune is hard to mock.  
2. Add handler unit tests for graph-materializer and synthesis-engine (validation + mocks) if desired.

---

## Test commands

- **Unit:** `npm test` or `npm run test:unit`  
- **Integration:** `npm run test:integration`  
- See [docs/testing/INTEGRATION_TEST_SETUP.md](../../../testing/INTEGRATION_TEST_SETUP.md) and [PHASE_2_INTEGRATION_TEST_PLAN.md](PHASE_2_INTEGRATION_TEST_PLAN.md) for setup.
