# Phase 2 Low Coverage Plan — World-Model, Synthesis, PostureTypes

**Status:** 🟡 In progress  
**Parent:** [PROJECT_TEST_COVERAGE_REVIEW.md](../../../testing/PROJECT_TEST_COVERAGE_REVIEW.md)  
**Related:** [PHASE_2_COVERAGE_TEST_PLAN.md](PHASE_2_COVERAGE_TEST_PLAN.md)  
**Scope:** Focused plan to raise coverage for **&lt;70%** areas: world-model (59.7%), synthesis (73.55%), and **types/PostureTypes.ts** (41.66%).

---

## Priority 1 — PostureTypes.ts (41.66%)

**Uncovered:** Lines 182–233 — runtime function `postureEquals(a, b)`.

**Test file:** `src/tests/unit/types/PostureTypes.test.ts` (new)

### Test cases

- `postureEquals` returns true when a and b are deep-equal (excluding timestamps).
- Returns false when account_id / tenantId / posture / momentum / rule_id / hashes differ.
- Returns false when risk_factors / opportunities / unknowns arrays differ (or order differs).
- Returns false when evidence_signal_ids / evidence_snapshot_refs / evidence_signal_types differ.
- Returns true for two identical AccountPostureStateV1 (timestamps may differ).

---

## Priority 2 — SnapshotService (46.66%)

**Uncovered:** Lines 182–305 — `getSnapshotByTimestamp`, `query`.

**Test file:** `src/tests/unit/world-model/SnapshotService.test.ts` (extend)

### Test cases

- **getSnapshotByTimestamp:** Dynamo Query returns one item with s3Key/s3VersionId; S3 GetObject returns body; returns parsed WorldSnapshot.
- **getSnapshotByTimestamp:** Query returns empty → returns null.
- **getSnapshotByTimestamp:** S3 GetObject throws → catch, logger.error, rethrow.
- **query:** entityId path — KeyConditionExpression pk, FilterExpression; returns list of snapshots from S3.
- **query:** entityType path — GSI gsi1pk; FilterExpression tenantId; returns list.
- **query:** neither entityId nor entityType → throws "Either entityId or entityType must be provided".
- **query:** empty Items → returns [].
- **query:** one S3 get fails → warn, skip that snapshot, return others.

---

## Priority 3 — World-model (EvidenceService, SchemaRegistryService, WorldStateService)

See [PHASE_2_COVERAGE_TEST_PLAN.md](PHASE_2_COVERAGE_TEST_PLAN.md) for EvidenceService, SchemaRegistryService, WorldStateService test cases. Add tests per that plan for fetch/aggregate, error branches, cache miss.

---

## Priority 4 — Synthesis (SynthesisEngine, ConditionEvaluator)

See [PHASE_2_COVERAGE_TEST_PLAN.md](PHASE_2_COVERAGE_TEST_PLAN.md). Add tests for synthesize branches, rule application, condition operator branches.

---

## Verification

```bash
npm test -- --coverage --testPathIgnorePatterns=integration
```

Target: PostureTypes 100% for postureEquals; SnapshotService ≥70%; world-model/synthesis as in PHASE_2_COVERAGE_TEST_PLAN.
