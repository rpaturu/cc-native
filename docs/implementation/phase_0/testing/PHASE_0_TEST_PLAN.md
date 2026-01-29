# Phase 0 Test Plan

**Status:** 🟢 **COMPLETE**  
**Last Updated:** 2026-01-28  
**Parent:** [PHASE_0_CODE_LEVEL_PLAN.md](../PHASE_0_CODE_LEVEL_PLAN.md)

---

## Summary

| Unit Coverage | Integration/Contract | Gaps |
|---------------|----------------------|------|
| Partial | ✅ phase0-certification, phase0 integration, methodology integration | World-model services (4) — no unit tests |

---

## Components (from PHASE_0_CODE_LEVEL_PLAN)

Core services, Event spine, World Model, Ledger, Identity, Methodology.

---

## Unit test coverage

### ✅ Has unit tests

| Component | Test File |
|-----------|-----------|
| Logger | `src/tests/unit/core/Logger.test.ts` |
| CacheService | `src/tests/unit/core/CacheService.test.ts` |
| TraceService | `src/tests/unit/core/TraceService.test.ts` |
| TenantService | `src/tests/unit/core/TenantService.test.ts` |
| IdentityService | `src/tests/unit/core/IdentityService.test.ts` |
| EventPublisher | `src/tests/unit/events/EventPublisher.test.ts` |
| EventRouter | `src/tests/unit/events/EventRouter.test.ts` |
| LedgerService | `src/tests/unit/ledger/LedgerService.test.ts` |
| MethodologyService | `src/tests/unit/methodology/MethodologyService.test.ts` |
| AssessmentService | `src/tests/unit/methodology/AssessmentService.test.ts` |
| AssessmentComputationService | `src/tests/unit/methodology/AssessmentComputationService.test.ts` |
| MethodologyFixtures | `src/tests/unit/methodology/MethodologyFixtures.test.ts` |

### ❌ Missing unit tests

| Component | Source File | Notes |
|-----------|-------------|-------|
| EvidenceService | `src/services/world-model/EvidenceService.ts` | S3 + DynamoDB; no unit test |
| WorldStateService | `src/services/world-model/WorldStateService.ts` | DynamoDB; no unit test |
| SnapshotService | `src/services/world-model/SnapshotService.ts` | S3 + DynamoDB; no unit test |
| SchemaRegistryService | `src/services/world-model/SchemaRegistryService.ts` | DynamoDB; no unit test |

---

## Integration / contract

- **Contract:** `src/tests/contract/phase0-certification.test.ts` ✅  
- **Integration:** `src/tests/integration/phase0.test.ts` ✅  
- **Methodology:** `src/tests/integration/methodology.test.ts` ✅  
- See [docs/testing/INTEGRATION_TEST_SETUP.md](../../../testing/INTEGRATION_TEST_SETUP.md) for setup.

---

## Recommendations

Add unit tests for `EvidenceService`, `WorldStateService`, `SnapshotService`, `SchemaRegistryService` (mock DynamoDB/S3) to lock behavior and avoid regressions.

---

## Test commands

- **Unit:** `npm test` or `npm run test:unit`  
- **Integration:** `npm run test:integration`  
- See [docs/testing/INTEGRATION_TEST_SETUP.md](../../../testing/INTEGRATION_TEST_SETUP.md) for setup.
