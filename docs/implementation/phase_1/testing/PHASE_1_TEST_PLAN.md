# Phase 1 Test Plan

**Status:** 🟢 **COMPLETE**  
**Last Updated:** 2026-01-28  
**Parent:** [PHASE_1_CODE_LEVEL_PLAN.md](../PHASE_1_CODE_LEVEL_PLAN.md)

---

## Summary

| Unit Coverage | Integration/Contract | Gaps |
|---------------|----------------------|------|
| Improved | ✅ phase1-certification | Detectors (8), perception handlers (3) — no unit tests (optional) |

---

## Components (from PHASE_1_CODE_LEVEL_PLAN)

Signal types, Connector framework, Signal detectors, Lifecycle State Service, Signal Service, Suppression Engine, Connector implementations, Event handlers.

---

## Unit test coverage

### ✅ Has unit tests

| Component | Test File |
|-----------|-----------|
| SignalService | `src/tests/unit/perception/SignalService.test.ts` |
| LifecycleStateService | `src/tests/unit/perception/LifecycleStateService.test.ts` |
| SuppressionEngine | `src/tests/unit/perception/SuppressionEngine.test.ts` |
| CrmConnectorAdapter | `src/tests/unit/adapters/crm/CrmConnectorAdapter.test.ts` |
| InternalConnectorAdapter | `src/tests/unit/adapters/internal/InternalConnectorAdapter.test.ts` |

### ❌ Missing unit tests (optional)

| Component | Source File | Notes |
|-----------|-------------|-------|
| BaseDetector | `src/services/perception/detectors/BaseDetector.ts` | No unit test |
| AccountActivationDetector | `src/services/perception/detectors/AccountActivationDetector.ts` | No unit test |
| DiscoveryStallDetector | `src/services/perception/detectors/DiscoveryStallDetector.ts` | No unit test |
| EngagementDetector | `src/services/perception/detectors/EngagementDetector.ts` | No unit test |
| RenewalWindowDetector | `src/services/perception/detectors/RenewalWindowDetector.ts` | No unit test |
| StakeholderGapDetector | `src/services/perception/detectors/StakeholderGapDetector.ts` | No unit test |
| SupportRiskDetector | `src/services/perception/detectors/SupportRiskDetector.ts` | No unit test |
| UsageTrendDetector | `src/services/perception/detectors/UsageTrendDetector.ts` | No unit test |
| connector-poll-handler | `src/handlers/perception/connector-poll-handler.ts` | No unit test |
| signal-detection-handler | `src/handlers/perception/signal-detection-handler.ts` | No unit test |
| lifecycle-inference-handler | `src/handlers/perception/lifecycle-inference-handler.ts` | No unit test |

*Connectors (CRMConnector, SupportConnector, UsageAnalyticsConnector) and BaseConnector are exercised indirectly via adapter tests; dedicated unit tests are optional.*

---

## Integration / contract

- **Contract:** `src/tests/contract/perception/phase1-certification.test.ts` ✅  

---

## Recommendations

1. Consider shared tests for detectors (e.g. BaseDetector + one concrete detector).  
2. Add handler unit tests for connector-poll, signal-detection, lifecycle-inference (validation + mocked services) if desired.

---

## Test commands

- **Unit:** `npm test` or `npm run test:unit`  
- **Integration:** `npm run test:integration`  
- See [docs/testing/INTEGRATION_TEST_SETUP.md](../../../testing/INTEGRATION_TEST_SETUP.md) for setup.
