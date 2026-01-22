# Phase 0: Step-by-Step Implementation Plan

## Overview

This is a **practical, step-by-step action plan** for implementing Phase 0 Foundations. Each step includes:
- What to create
- Where to create it
- Dependencies
- Acceptance criteria

**Status:** Infrastructure ✅ Deployed | Next: Types & Core Services

---

## Resource Naming Contract

**CRITICAL:** All resources MUST use the `cc-native-*` prefix consistently.

### Naming Patterns

- **DynamoDB Tables:** `cc-native-{resource-name}` (e.g., `cc-native-world-state`)
- **S3 Buckets:** `cc-native-{resource-name}-{account}-{region}` (e.g., `cc-native-evidence-ledger-099892828192-us-west-2`)
- **EventBridge Source:** `cc-native.{source}` (e.g., `cc-native.system`, `cc-native.perception`)
- **EventBridge Bus:** `cc-native-events`
- **Stack Name:** `CCNativeStack`
- **Environment Variables:** `{RESOURCE}_TABLE_NAME`, `{RESOURCE}_BUCKET` (e.g., `WORLD_STATE_TABLE_NAME`)

### Enforcement

- All code MUST use these exact names
- No `autonomous-revenue-*` references allowed
- CDK stack outputs MUST match these patterns
- Environment variables MUST match these patterns

**Why:** Debugging and operations become impossible when resources split across multiple namespaces.

---

## Implementation Sequence

### ✅ Step 0: Infrastructure (COMPLETE)
- [x] CDK Stack deployed
- [x] S3 buckets created
- [x] DynamoDB tables created
- [x] EventBridge bus created
- [x] KMS key created

---

## Step 1: Create Type Definitions (Day 1-2)

### 1.1 Create Types Directory Structure

```bash
mkdir -p src/types
```

### 1.2 CommonTypes.ts

**File:** `src/types/CommonTypes.ts`

**Purpose:** Foundation types used across all services

**Implementation:**
- `TraceContext` interface
- `Timestamped` interface
- `TenantScoped` interface
- `Traceable` interface
- `EventSource` type
- `Severity` type
- `EvidenceRef` interface
- `TrustClass` type (PRIMARY, VERIFIED, DERIVED, AGENT_INFERENCE, UNTRUSTED)
- `AutonomyTier` type (TIER_A, TIER_B, TIER_C, TIER_D)

**Acceptance Criteria:**
- [ ] All types exported
- [ ] TypeScript compiles without errors
- [ ] Types match World Model Contract definitions

---

### 1.3 EventTypes.ts

**File:** `src/types/EventTypes.ts`

**Purpose:** Event envelope and event type definitions

**Implementation:**
- `EventEnvelope` interface (camelCase: `traceId`, `tenantId`, `accountId?`, `source`, `eventType`, `ts`, `payload`)
  - Note: Use camelCase in code; EventBridge Detail will serialize as-is
- `EventType` enum/union type
- Event type constants

**Exact Interface:**
```typescript
export interface EventEnvelope {
  traceId: string;
  tenantId: string;
  accountId?: string;
  source: EventSource;
  eventType: string;
  ts: string;
  payload: Record<string, any>;
  metadata?: {
    correlationId?: string;
    causationId?: string;
    evidenceRefs?: EvidenceRef[];
  };
}
```

**Acceptance Criteria:**
- [ ] EventEnvelope uses camelCase (traceId, tenantId, eventType)
- [ ] EventEnvelope matches EventBridge structure
- [ ] All event types defined
- [ ] Source namespaced as `cc-native.{source}`

---

### 1.4 TenantTypes.ts

**File:** `src/types/TenantTypes.ts`

**Purpose:** Tenant model and configuration

**Implementation:**
- `Tenant` interface (tenantId, name, config, createdAt, updatedAt)
- `TenantConfig` interface
- `TenantStatus` type

**Acceptance Criteria:**
- [ ] Tenant model matches DynamoDB schema
- [ ] All tenant fields typed

---

### 1.5 LedgerTypes.ts

**File:** `src/types/LedgerTypes.ts`

**Purpose:** Execution ledger event types

**Implementation:**
- `LedgerEntry` interface
- `LedgerEventType` enum with clear taxonomy (see below)
- `LedgerQuery` interface

**Ledger Event Type Taxonomy:**
- `INTENT` = Inbound user/agent request
- `SIGNAL` = Perception output (signal generation)
- `TOOL_CALL` = Tool invocation (request/response)
- `VALIDATION` = Checks/gates (policy, confidence, compliance)
- `DECISION` = Planner output (proposed action set + snapshot binding)
- `ACTION` = Execution attempt/result
- `APPROVAL` = Human-in-the-loop approval/rejection

**Acceptance Criteria:**
- [ ] Ledger entry matches DynamoDB schema
- [ ] All event types defined with clear taxonomy
- [ ] DECISION type includes snapshot binding requirement
- [ ] Query interface supports traceId and time-range queries

---

### 1.6 EvidenceTypes.ts

**File:** `src/types/EvidenceTypes.ts`

**Purpose:** Evidence record types for World Model

**Implementation:**
- `EvidenceRecord` interface
- `EvidenceType` enum (CRM, SCRAPE, TRANSCRIPT, AGENT_INFERENCE, USER_INPUT, TELEMETRY, SUPPORT, EXTERNAL)
- `EvidenceMetadata` interface with provenance:
  - `provenance.trustClass` (TrustClass: PRIMARY, VERIFIED, DERIVED, AGENT_INFERENCE, UNTRUSTED)
  - `provenance.sourceSystem` (string)
  - `metadata.traceId`, `metadata.tenantId`, `metadata.accountId`
- `EvidenceQuery` interface

**Acceptance Criteria:**
- [ ] Evidence record matches S3 + DynamoDB schema
- [ ] All evidence types defined (including telemetry, support, external)
- [ ] Provenance tracking includes trustClass and sourceSystem
- [ ] Metadata includes traceId, tenantId, accountId
- [ ] Types align with World Model Contract

---

### 1.7 WorldStateTypes.ts

**File:** `src/types/WorldStateTypes.ts`

**Purpose:** Entity state types for World Model

**Implementation:**
- `EntityState` interface
- `EntityType` enum/union
- `FieldState` interface (concrete, not abstract):
  ```typescript
  interface FieldState {
    value: any;
    confidence: number;        // 0-1
    freshness: number;          // hours since last update
    contradiction: number;      // 0-1 (contradiction score)
    provenanceTrust: TrustClass;
    lastUpdated: string;        // ISO timestamp
    evidenceRefs: EvidenceRef[];
  }
  ```
- `WorldStateQuery` interface

**Acceptance Criteria:**
- [ ] Entity state matches DynamoDB schema
- [ ] FieldState includes all required fields (value, confidence, freshness, contradiction, provenanceTrust, lastUpdated, evidenceRefs)
- [ ] Confidence tracking per field (0-1)
- [ ] Contradiction metadata included (0-1 score)
- [ ] Types match World Model Contract exactly

---

### 1.8 SnapshotTypes.ts

**File:** `src/types/SnapshotTypes.ts`

**Purpose:** World state snapshot types

**Implementation:**
- `WorldSnapshot` interface
- `SnapshotMetadata` interface
- `SnapshotQuery` interface

**Acceptance Criteria:**
- [ ] Snapshot matches S3 + DynamoDB schema
- [ ] Binding requirements included
- [ ] Time-travel support

---

### 1.9 SchemaTypes.ts

**File:** `src/types/SchemaTypes.ts`

**Purpose:** Schema registry types

**Implementation:**
- `EntitySchema` interface
- `FieldDefinition` interface
- `CriticalFieldRegistry` interface
- `SchemaQuery` interface

**Acceptance Criteria:**
- [ ] Schema matches S3 + DynamoDB schema
- [ ] Critical field registry included
- [ ] Hash verification support

---

## Step 2: Core Services (Day 3-5)

### 2.1 Create Services Directory Structure

```bash
mkdir -p src/services/core
```

### 2.2 Logger Service

**File:** `src/services/core/Logger.ts`

**Purpose:** Structured logging (stdout → CloudWatch Logs)

**Implementation:**
- `Logger` class
- Methods: `info()`, `warn()`, `error()`, `debug()`
- Structured JSON logging to stdout (Lambda automatically sends to CloudWatch Logs)
- **Do NOT** create CloudWatch Logs client (adds cost/latency + failure modes)
- Log level configuration

**Dependencies:**
- `CommonTypes.ts` (TraceContext)

**Acceptance Criteria:**
- [ ] Logs structured JSON to stdout
- [ ] Trace context included in all logs
- [ ] Log levels configurable
- [ ] No CloudWatch Logs SDK client (use stdout only)
- [ ] Unit tests passing

---

### 2.3 Trace Service

**File:** `src/services/core/TraceService.ts`

**Purpose:** Trace ID generation and propagation

**Implementation:**
- `TraceService` class
- `generateTraceId()` method
- `extractTraceContext()` method (from headers/event)
- `withTrace()` helper (AsyncLocalStorage support)
- Header normalization (case-insensitive)

**Dependencies:**
- `CommonTypes.ts` (TraceContext)

**Acceptance Criteria:**
- [ ] Generates unique trace IDs
- [ ] Extracts from API Gateway headers
- [ ] Extracts from EventBridge events
- [ ] AsyncLocalStorage support (Node 18+)
- [ ] Unit tests passing

---

### 2.4 Cache Service

**File:** `src/services/core/CacheService.ts`

**Purpose:** DynamoDB-based TTL cache (best-effort semantics)

**Implementation:**
- `CacheService` class
- `get(key)` method (returns null on miss/failure)
- `set(key, value, ttl)` method (best-effort, failures don't throw)
- `delete(key)` method (best-effort)
- DynamoDB integration
- TTL handling
- **Critical:** Cache failures must NOT break core flows

**Dependencies:**
- DynamoDB table: `cc-native-cache`
- `CommonTypes.ts`

**Acceptance Criteria:**
- [ ] Reads from DynamoDB cache table
- [ ] Writes with TTL
- [ ] Handles expired entries
- [ ] Cache failures are handled gracefully (no exceptions thrown)
- [ ] Core flows continue even if cache is unavailable
- [ ] Unit tests passing

---

### 2.5 Tenant Service

**File:** `src/services/core/TenantService.ts`

**Purpose:** Tenant CRUD operations

**Implementation:**
- `TenantService` class
- `getTenant(tenantId)` method
- `createTenant(tenant)` method
- `updateTenant(tenantId, updates)` method
- DynamoDB integration

**Dependencies:**
- DynamoDB table: `cc-native-tenants`
- `TenantTypes.ts`

**Acceptance Criteria:**
- [ ] CRUD operations working
- [ ] Tenant isolation enforced
- [ ] Unit tests passing

---

## Step 3: Event Spine (Day 6-7)

### 3.1 Create Event Services Directory

```bash
mkdir -p src/services/events
```

### 3.2 Event Publisher

**File:** `src/services/events/EventPublisher.ts`

**Purpose:** Publish events to EventBridge

**Implementation:**
- `EventPublisher` class
- `publish(event)` method
- EventBridge integration
- Source namespacing (`cc-native.{source}`)
- Error handling

**Dependencies:**
- EventBridge bus: `cc-native-events`
- `EventTypes.ts`
- `TraceService`

**Acceptance Criteria:**
- [ ] Events published to EventBridge
- [ ] Source properly namespaced
- [ ] Trace context included
- [ ] Error handling robust
- [ ] Unit tests passing

---

### 3.3 Event Router

**File:** `src/services/events/EventRouter.ts`

**Purpose:** Route events to handlers with idempotency

**Implementation:**
- `EventRouter` class
- `registerHandler(eventType, handler)` method
- `route(event)` method
- **Idempotency key generation:** `idempotencyKey = hash(eventType + entityId + sourceEventId + payloadNormalized)`
- **Idempotency check:** Query ledger by idempotencyKey (not just traceId)
- Handler execution (only if idempotencyKey not found)
- Error handling

**Dependencies:**
- `EventTypes.ts`
- `LedgerService` (for idempotency check)
- `TraceService`

**Acceptance Criteria:**
- [ ] Handlers registered correctly
- [ ] Events routed to correct handlers
- [ ] Idempotency key computed from eventType + entityId + sourceEventId + normalized payload
- [ ] Duplicate deliveries with same idempotencyKey produce exactly one side effect
- [ ] Idempotency check uses ledger (not just traceId)
- [ ] Error handling robust
- [ ] Unit tests passing

---

## Step 4: World Model Foundation (Day 8-12)

### 4.1 Create World Model Services Directory

```bash
mkdir -p src/services/world-model
```

**Note:** Directory name is `world-model` (with hyphen) to match code-level plan consistency.

### 4.2 Evidence Service

**File:** `src/services/world-model/EvidenceService.ts`

**Purpose:** Store and retrieve immutable evidence

**Implementation:**
- `EvidenceService` class
- `store(evidence)` method (S3 + DynamoDB index)
- `get(evidenceId)` method
- `query(query)` method
- S3 Object Lock integration
- DynamoDB index updates

**Dependencies:**
- S3 bucket: `cc-native-evidence-ledger-{account}-{region}`
- DynamoDB table: `cc-native-evidence-index`
- `EvidenceTypes.ts`

**Acceptance Criteria:**
- [ ] Evidence stored in S3 (immutable)
- [ ] Metadata indexed in DynamoDB
- [ ] Object Lock enabled
- [ ] Query by entityId, timestamp working
- [ ] Unit tests passing

---

### 4.3 World State Service

**File:** `src/services/world-model/WorldStateService.ts`

**Purpose:** Compute and store entity state

**Implementation:**
- `WorldStateService` class
- `computeState(entityId)` method (deterministic from evidence)
- `getState(entityId)` method
- `updateState(entityId, evidence)` method
- Confidence calculation
- Freshness tracking
- Contradiction detection (field-specific)
- Parallel evidence fetching

**Dependencies:**
- `EvidenceService`
- DynamoDB table: `cc-native-world-state`
- `WorldStateTypes.ts`
- `EvidenceTypes.ts`

**Acceptance Criteria:**
- [ ] State computed deterministically
- [ ] Confidence calculated per field
- [ ] Contradictions detected correctly
- [ ] Parallel evidence fetching (concurrency limit)
- [ ] Unit tests passing

---

### 4.4 Snapshot Service

**File:** `src/services/world-model/SnapshotService.ts`

**Purpose:** Create and retrieve immutable snapshots

**Implementation:**
- `SnapshotService` class
- `createSnapshot(entityId, state)` method
- `getSnapshot(snapshotId)` method
- `getSnapshotByTimestamp(entityId, timestamp)` method
- S3 Object Lock integration
- DynamoDB index updates

**Dependencies:**
- S3 bucket: `cc-native-world-state-snapshots-{account}-{region}`
- DynamoDB table: `cc-native-snapshots-index`
- `WorldStateService`
- `SnapshotTypes.ts`

**Acceptance Criteria:**
- [ ] Snapshots stored in S3 (immutable)
- [ ] Metadata indexed in DynamoDB
- [ ] Object Lock enabled
- [ ] Time-travel queries working
- [ ] Unit tests passing

---

### 4.5 Schema Registry Service

**File:** `src/services/world-model/SchemaRegistryService.ts`

**Purpose:** Schema resolution and validation

**Implementation:**
- `SchemaRegistryService` class
- `getSchema(entityType, version)` method
- `getCriticalFields(entityType)` method
- `validateEntityState(entityState, schema)` method
- Hash verification (fail-closed)
- S3 schema retrieval
- DynamoDB index lookup

**Dependencies:**
- S3 bucket: `cc-native-schema-registry-{account}-{region}`
- DynamoDB table: `cc-native-schema-registry`
- DynamoDB table: `cc-native-critical-field-registry`
- `SchemaTypes.ts`

**Acceptance Criteria:**
- [ ] Schemas resolved from S3
- [ ] Hash verification enforced
- [ ] Critical fields retrieved
- [ ] Validation working
- [ ] Fail-closed on mismatch
- [ ] Unit tests passing

---

## Step 5: Audit Ledger (Day 13-14)

### 5.1 Ledger Service

**File:** `src/services/ledger/LedgerService.ts`

**Purpose:** Append-only execution ledger

**Implementation:**
- `LedgerService` class
- `write(entry)` method (append-only)
- `getByTraceId(traceId)` method
- `query(query)` method (time-range, eventType)
- DynamoDB integration
- GSI usage for queries

**Dependencies:**
- DynamoDB table: `cc-native-ledger`
- `LedgerTypes.ts`
- `TraceService`

**Acceptance Criteria:**
- [ ] Append-only writes enforced
- [ ] Query by traceId working
- [ ] Time-range queries working (GSI2)
- [ ] Event type filtering working
- [ ] Unit tests passing

---

## Step 6: Testing (Day 15-16)

### 6.1 Unit Tests (Mocked SDK)

**File:** `src/tests/unit/**/*.test.ts`

**Purpose:** Fast, isolated unit tests with mocked AWS SDK

**Test Coverage:**
- All services with mocked DynamoDB, S3, EventBridge clients
- Error handling paths
- Edge cases
- Type validation

**Acceptance Criteria:**
- [ ] Unit test coverage >80%
- [ ] All services have unit tests
- [ ] Tests use mocked AWS SDK clients
- [ ] Tests run fast (<5 seconds total)
- [ ] All edge cases covered

---

### 6.2 Integration Tests (Real AWS)

**File:** `src/tests/integration/phase0.test.ts`

**Purpose:** End-to-end Phase 0 validation with real AWS resources

**Test Environment:**
- **MUST** run in dedicated sandbox AWS account
- **MUST** use real S3, DynamoDB, EventBridge resources
- **MUST** test Object Lock behavior
- **MUST** test EventBridge retry semantics
- **MUST** test IAM permission boundaries
- **MUST** test DynamoDB TTL behavior

**Test Scenarios:**
1. **Tenant Creation Flow:**
   - Create tenant
   - Verify in DynamoDB
   - Retrieve tenant

2. **Evidence → State → Snapshot Flow:**
   - Store evidence
   - Compute state
   - Create snapshot
   - Verify all components
   - Verify Object Lock prevents overwrite

3. **Event → Ledger Flow:**
   - Publish event
   - Verify ledger entry
   - Verify traceId propagation
   - Test duplicate delivery idempotency

4. **Schema Registry Flow:**
   - Resolve schema
   - Get critical fields
   - Validate entity state
   - Test hash verification (fail-closed)

**Acceptance Criteria:**
- [ ] All integration tests passing
- [ ] Tests use real AWS resources (not mocks)
- [ ] Object Lock behavior verified
- [ ] EventBridge retry/idempotency verified
- [ ] IAM permissions verified
- [ ] Cleanup after tests

---

### 6.3 Contract Certification Test

**File:** `src/tests/contract/phase0-certification.test.ts`

**Purpose:** Single end-to-end test that MUST pass before Phase 1

**Test Flow:**
1. Create tenant
2. Store evidence with provenance
3. Compute world state (deterministic)
4. Create snapshot (immutable)
5. Publish event (idempotent)
6. Verify ledger entry with snapshot binding
7. Verify recompute determinism (wipe DynamoDB, recompute, same result)
8. Verify immutability (attempt overwrite, must fail)

**Acceptance Criteria:**
- [ ] Contract certification test passes
- [ ] Recompute determinism proven
- [ ] Immutability proven
- [ ] Idempotency proven
- [ ] Snapshot binding enforced
- [ ] Tenant isolation proven

---

## Step 7: Documentation & Cleanup (Day 17-18)

### 7.1 Code Documentation
- [ ] Add JSDoc comments to all public methods
- [ ] Document service interfaces
- [ ] Update README with service descriptions

### 7.2 Testing
- [ ] Unit test coverage >80%
- [ ] Integration tests passing
- [ ] All edge cases covered

### 7.3 Code Review Checklist
- [ ] Single intent files
- [ ] No circular references
- [ ] No inline imports
- [ ] File sizes <500 lines
- [ ] Error handling robust
- [ ] Logging comprehensive

---

## Quick Reference: File Structure

```
src/
├── types/
│   ├── CommonTypes.ts
│   ├── EventTypes.ts
│   ├── TenantTypes.ts
│   ├── LedgerTypes.ts
│   ├── EvidenceTypes.ts
│   ├── WorldStateTypes.ts
│   ├── SnapshotTypes.ts
│   └── SchemaTypes.ts
├── services/
│   ├── core/
│   │   ├── Logger.ts
│   │   ├── TraceService.ts
│   │   ├── CacheService.ts
│   │   └── TenantService.ts
│   ├── events/
│   │   ├── EventPublisher.ts
│   │   └── EventRouter.ts
│   ├── world-model/
│   │   ├── EvidenceService.ts
│   │   ├── WorldStateService.ts
│   │   ├── SnapshotService.ts
│   │   └── SchemaRegistryService.ts
│   └── ledger/
│       └── LedgerService.ts
└── tests/
    └── integration/
        └── phase0.test.ts
```

---

## Environment Variables Reference

Services should read from `process.env`:

```bash
# DynamoDB Tables (from CDK outputs)
WORLD_STATE_TABLE_NAME=cc-native-world-state
EVIDENCE_INDEX_TABLE_NAME=cc-native-evidence-index
SNAPSHOTS_INDEX_TABLE_NAME=cc-native-snapshots-index
SCHEMA_REGISTRY_TABLE_NAME=cc-native-schema-registry
CRITICAL_FIELD_REGISTRY_TABLE_NAME=cc-native-critical-field-registry
ACCOUNTS_TABLE_NAME=cc-native-accounts
SIGNALS_TABLE_NAME=cc-native-signals
TOOL_RUNS_TABLE_NAME=cc-native-tool-runs
APPROVAL_REQUESTS_TABLE_NAME=cc-native-approval-requests
ACTION_QUEUE_TABLE_NAME=cc-native-action-queue
POLICY_CONFIG_TABLE_NAME=cc-native-policy-config
LEDGER_TABLE_NAME=cc-native-ledger
CACHE_TABLE_NAME=cc-native-cache
TENANTS_TABLE_NAME=cc-native-tenants

# S3 Buckets (from CDK outputs)
EVIDENCE_LEDGER_BUCKET=cc-native-evidence-ledger-{account}-{region}
WORLD_STATE_SNAPSHOTS_BUCKET=cc-native-world-state-snapshots-{account}-{region}
SCHEMA_REGISTRY_BUCKET=cc-native-schema-registry-{account}-{region}
ARTIFACTS_BUCKET=cc-native-artifacts-{account}-{region}
LEDGER_ARCHIVES_BUCKET=cc-native-ledger-archives-{account}-{region}

# EventBridge
EVENT_BUS_NAME=cc-native-events

# AWS
AWS_REGION=us-west-2
```

---

## Next Steps After Phase 0

Once Phase 0 is complete:
1. **Phase 1:** Perception V1 (Signal generation)
2. **Phase 2:** World Model (Situation Graph + retrieval)
3. **Phase 3:** Tool Plane (AgentCore Gateway)
4. **Phase 4:** Decision Agent (AgentCore Runtime)
5. **Phase 5:** Action Execution + Human Touch UX
6. **Phase 6:** Trust & Controls (Enterprise hardening)

---

## Notes

- **Incremental Development:** Build, test, and commit after each service
- **Testing:** Write unit tests alongside implementation
- **Documentation:** Document as you go
- **Code Quality:** Follow single intent, no circular refs, <500 lines per file

---

## Definition of Done (Phase 0)

Phase 0 is **not complete** until all of the following are true:

### 1. Recompute Determinism
- [ ] Wiping DynamoDB and recomputing from evidence produces **identical state**
- [ ] Same evidence → same state (deterministic)
- [ ] Test: Store evidence, compute state, delete DynamoDB state, recompute, verify identical

### 2. Immutability Proof
- [ ] Evidence stored in S3 **cannot be overwritten** (Object Lock enforced)
- [ ] Snapshots stored in S3 **cannot be overwritten** (Object Lock enforced)
- [ ] Test: Attempt to overwrite evidence/snapshot, must fail with Object Lock error

### 3. Idempotency Proof
- [ ] Duplicate EventBridge delivery does **not duplicate** downstream side effects
- [ ] Idempotency key prevents duplicate handler execution
- [ ] Test: Send same event twice, verify handler executes exactly once

### 4. Snapshot Binding Enforced
- [ ] All actions/decisions **require snapshotId** in ledger entry
- [ ] Snapshot binding is validated before action execution
- [ ] Test: Attempt action without snapshot binding, must fail

### 5. Tenant Isolation
- [ ] Cross-tenant reads **blocked at IAM layer**
- [ ] Cross-tenant reads **blocked at application layer**
- [ ] Test: Tenant A cannot read Tenant B's data (both IAM and app-level checks)

### 6. Contract Certification
- [ ] Contract certification test passes (see Step 6.3)
- [ ] All DoD criteria verified in certification test
- [ ] Test results documented

**Only when all 6 criteria are met can Phase 0 be considered complete.**
