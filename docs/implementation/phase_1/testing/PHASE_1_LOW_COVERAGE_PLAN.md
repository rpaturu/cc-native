# Phase 1 Low / Zero Coverage Plan — Perception Connectors

**Status:** 🟡 In progress  
**Parent:** [PROJECT_TEST_COVERAGE_REVIEW.md](../../../testing/PROJECT_TEST_COVERAGE_REVIEW.md)  
**Scope:** Raise coverage for Phase 1 perception components currently at **0%**: BaseConnector, IConnector, CRMConnector, SupportConnector, UsageAnalyticsConnector.

---

## Current gaps (0% coverage)

| Component | Path | Notes |
|-----------|------|--------|
| **BaseConnector.ts** | `services/perception/BaseConnector.ts` | Abstract base; exercised via concrete connectors. |
| **IConnector.ts** | `services/perception/IConnector.ts` | Interface only; no executable statements. |
| **CRMConnector** | `services/perception/connectors/CRMConnector.ts` | Extends BaseConnector; connect/poll/disconnect + CRM API. |
| **SupportConnector** | `services/perception/connectors/SupportConnector.ts` | Same pattern; support system API. |
| **UsageAnalyticsConnector** | `services/perception/connectors/UsageAnalyticsConnector.ts` | Same pattern; analytics API. |

---

## Strategy

1. **IConnector / BaseConnector:** Coverage comes from concrete connector tests. No separate “interface” tests needed; exclude or accept 0% for interface-only files if desired.
2. **Concrete connectors (CRM, Support, UsageAnalytics):** Add one unit test file per connector:
   - Mock EvidenceService, Logger, S3Client (and any external API clients).
   - Test constructor and lifecycle: `connect()` → `poll()` → `disconnect()`.
   - Test `poll()` returns `EvidenceSnapshotRef[]` (empty or with mocked refs).
   - Test error path: connect/poll/disconnect throw → error propagates.

---

## Test cases to add

### CRMConnector

**Test file:** `src/tests/unit/perception/connectors/CRMConnector.test.ts`

- Constructor builds instance with syncMode TIMESTAMP.
- connect() sets connected flag (or calls external API; mock to succeed).
- poll() returns array of EvidenceSnapshotRef (mock evidenceService or internal fetch).
- disconnect() clears connected state.
- When connect/poll/disconnect throw, error propagates.

### SupportConnector

**Test file:** `src/tests/unit/perception/connectors/SupportConnector.test.ts`

- Same pattern as CRMConnector with Support-specific config.

### UsageAnalyticsConnector

**Test file:** `src/tests/unit/perception/connectors/UsageAnalyticsConnector.test.ts`

- Same pattern with UsageAnalytics-specific config.

---

## Verification

```bash
npm test -- --coverage --testPathIgnorePatterns=integration
```

Target: connectors ≥70% statements; BaseConnector/IConnector covered indirectly or excluded.
