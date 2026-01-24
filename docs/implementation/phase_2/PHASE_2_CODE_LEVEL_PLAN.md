# Phase 2: Code-Level Implementation Plan

## Situation Graph + Deterministic Synthesis

**Goal:** Build a durable Situation Graph (Neptune) and deterministic synthesis engine that derives AccountPostureState from signals and lifecycle state.

**Duration:** 3-4 weeks  
**Status:** 📋 **PLANNING** (Not Started)  
**Dependencies:** Phase 0 ✅ Complete | Phase 1 ✅ Complete

**Prerequisites:**
- Phase 1 signals are being generated and stored
- EventBridge routing `SIGNAL_DETECTED` and `SIGNAL_CREATED` events
- Evidence snapshots are stored in S3 with immutable references
- `synthesis/rules/v1.yaml` is defined and hardened

---

## Implementation Status Summary

| Component | Status | Completion |
|-----------|--------|------------|
| 1. Neptune Infrastructure | 📋 Planned | 0% |
| 2. Graph Types & Conventions | 📋 Planned | 0% |
| 3. Graph Service (Neptune) | 📋 Planned | 0% |
| 4. Graph Materializer | 📋 Planned | 0% |
| 5. Posture Types & Schemas | 📋 Planned | 0% |
| 6. Synthesis Engine | 📋 Planned | 0% |
| 7. AccountPostureState Service | 📋 Planned | 0% |
| 8. Event Handlers | 📋 Planned | 0% |
| 9. Infrastructure (CDK) | 📋 Planned | 0% |
| 10. Unit Tests & Contract Tests | 📋 Planned | 0% |

**Overall Phase 2 Progress: 0% 📋**

**Target Implementation Date:** TBD  
**Estimated Files:** ~25-30 TypeScript files (graph + synthesis layer)

---

## Implementation Order

1. **Neptune Infrastructure** (Day 1-2)
2. **Graph Types & Conventions** (Day 2-3)
3. **Graph Service** (Day 3-5)
4. **Posture Types & Schemas** (Day 4-5) ⚠️ **Do this early**
5. **Graph Materializer** (Day 6-8)
6. **Synthesis Engine** (Day 9-12)
7. **AccountPostureState Service** (Day 10-11)
8. **Event Handlers** (Day 13-14)
9. **Infrastructure (CDK)** (Day 13-15)
10. **Unit Tests & Contract Tests** (Day 16-18)

---

## 1. Neptune Infrastructure

### 1.1 Neptune Cluster (CDK)

**File:** `src/stacks/CCNativeStack.ts` (additions)

**Purpose:** Provision Neptune cluster with VPC, security groups, and IAM roles

**Key Resources:**
- `neptune.Cluster` - Neptune cluster (dev/stage)
- `neptune.SubnetGroup` - VPC subnets for Neptune
- `neptune.ParameterGroup` - Cluster parameters
- `ec2.SecurityGroup` - Security group for Neptune (VPC-only access)
- `iam.Role` - IAM role for Lambda to access Neptune
- `iam.Policy` - Neptune access policy (Gremlin queries)

**Configuration:**
- Instance type: `db.r5.large` (dev) / `db.r5.xlarge` (stage)
- Engine version: Latest Neptune engine
- Backup retention: 7 days
- Encryption at rest: Enabled
- VPC: Private subnets only
- Public access: Disabled

**IAM Policy Permissions:**
- `neptune-db:connect`
- `neptune-db:ReadDataViaQuery`
- `neptune-db:WriteDataViaQuery`

**Neptune Auth Mode Validation (LOCKED):**
- IAM permissions listed above are for IAM auth mode (Data API endpoints or IAM-signed Gremlin)
- If using Gremlin over websockets in VPC with no IAM signing, these IAM policies may be irrelevant
- **During setup:** Validate actual Neptune auth mode and adjust IAM policies accordingly
- Default: Use IAM auth for security and auditability

**Acceptance Criteria:**
- Cluster deploys via CDK
- Connectivity test utility can connect via VPC
- IAM role can execute Gremlin queries (if using IAM auth)
- Auth mode is validated and IAM policies match actual auth configuration
- No public internet access

---

### 1.2 Neptune Connection Utility

**File:** `src/services/graph/NeptuneConnection.ts`

**Purpose:** Manage Neptune connection and provide health check

**Key Methods:**
- `connect()`: Establish Gremlin connection
- `disconnect()`: Close connection
- `healthCheck()`: Execute simple query to verify connectivity
- `getConnection()`: Return active connection (singleton pattern)

**Dependencies:**
- `gremlin` npm package (AWS Neptune Gremlin client)
- Neptune cluster endpoint (from CDK outputs)
- IAM role credentials (via AWS SDK)

**Connection Pattern:**
```typescript
import { DriverRemoteConnection } from 'gremlin';
import { Graph } from 'gremlin';

const connection = new DriverRemoteConnection(
  `wss://${neptuneEndpoint}:8182/gremlin`,
  { mimeType: 'application/vnd.gremlin-v2.0+json' }
);
const graph = new Graph();
const g = graph.traversal().withRemote(connection);
```

**Connection Management:**
- Implement **lazy singleton** with reconnect-on-failure
- Keep Gremlin connection lifetime short and resilient (health check + retry)
- Handle frequent cold starts and stale websockets gracefully
- Do NOT assume connection pooling "just works" - connections are per-warm-container only

**Acceptance Criteria:**
- Connection utility can connect to Neptune
- Health check returns success
- Connection reconnects on failure (lazy singleton pattern)
- Handles cold starts gracefully (reconnects on each invocation if needed)

---

## 2. Graph Types & Conventions

### 2.1 Graph Types

**File:** `src/types/GraphTypes.ts`

**Purpose:** Define graph vertex and edge types, IDs, and properties

**Key Types:**

**Vertex Types:**
- `TenantVertex` - Tenant node
- `AccountVertex` - Account node
- `SignalVertex` - Signal node
- `EvidenceSnapshotVertex` - Evidence snapshot node
- `PostureVertex` - Posture state node
- `RiskFactorVertex` - Risk factor node
- `OpportunityVertex` - Opportunity node
- `UnknownVertex` - Unknown node

**Edge Types:**
- `HAS_SIGNAL` - Account → Signal
- `SUPPORTED_BY` - Signal → EvidenceSnapshot
- `HAS_POSTURE` - Account → Posture
- `IMPLIES_RISK` - Posture → RiskFactor
- `IMPLIES_OPPORTUNITY` - Posture → OpportunitySignal
- `HAS_UNKNOWN` - Account → Unknown

**Vertex ID Scheme (Canonical):**
- `TENANT#{tenant_id}`
- `ACCOUNT#{tenant_id}#{account_id}` (or `TENANT#{tenant_id}#ACCOUNT#{account_id}`)
- `SIGNAL#{tenant_id}#{signal_id}` (tenant-scoped; assumes signal_id is unique within tenant)
- `EVIDENCE_SNAPSHOT#{tenant_id}#{evidence_snapshot_id}` (tenant-scoped; from EvidenceSnapshotRef.sha256 or unique ID)
- `POSTURE#{tenant_id}#{account_id}#{posture_id}` (posture_id = inputs_hash, NOT timestamp - ensures determinism)
- `RISK_FACTOR#{risk_factor_id}` (risk_factor_id = SHA256 hash of: `{tenant_id, account_id, ruleset_version, inputs_hash, rule_id, type: "RISK_FACTOR", risk_type}`)
- `OPPORTUNITY#{opportunity_id}` (opportunity_id = SHA256 hash of: `{tenant_id, account_id, ruleset_version, inputs_hash, rule_id, type: "OPPORTUNITY", opportunity_type}`)
- `UNKNOWN#{unknown_id}` (unknown_id = SHA256 hash of: `{tenant_id, account_id, ruleset_version, inputs_hash, rule_id, type: "UNKNOWN", unknown_type}`)

**Critical Rule: Deterministic Hash Composition (LOCKED)**
- Risk/Opportunity/Unknown vertex IDs MUST include `tenant_id` in hash composition to prevent cross-tenant collisions
- Hash components must be sorted lexicographically before hashing for determinism
- Example: `SHA256(JSON.stringify({account_id, rule_id, ruleset_version, tenant_id, type, ...}.sort()))`

**Critical Rule: Tenant-Scoped Vertex IDs (LOCKED)**
- **Decision:** All vertex IDs MUST be tenant-scoped unless you can prove global uniqueness forever
- Multi-tenant collisions in graph IDs are catastrophic and hard to unwind
- **Canonical format:** `SIGNAL#{tenant_id}#{signal_id}` and `EVIDENCE_SNAPSHOT#{tenant_id}#{evidence_snapshot_id}`
- Recommendation: Tenant-scope for safety unless 100% certain of global uniqueness
- If global uniqueness is assumed, document it as a hard assumption with rationale

**Critical Rule: Signal Identity**
- Vertex ID = `SIGNAL#{tenant_id}#{signal_id}` (tenant-scoped; from Phase 1 signal record)
- `dedupeKey` stored as a **property**, not used for vertex identity
- Prevents accidental graph collapse when signals look similar

**Required Properties (All Vertices):**
- `tenant_id: string`
- `entity_type: string` (e.g., "SIGNAL", "ACCOUNT", "POSTURE")
- `created_at: string` (ISO timestamp, snake_case)
- `updated_at: string` (ISO timestamp, snake_case)
- `schema_version: string` (e.g., "v1")

**Critical Rule: Timestamp Field Naming Convention (LOCKED)**
- **Signals (Phase 1):** Use `createdAt` (camelCase) - from `Timestamped` interface
- **Graph vertices/edges:** Use `created_at`, `updated_at` (snake_case)
- **Contract:** Never translate `createdAt` → `created_at` inside signal objects; only at graph boundary (when materializing signal to graph vertex)
- This prevents field name confusion and maintains clear separation between Phase 1 signal structure and Phase 2 graph structure

**Optional Properties (Per Vertex Type):**
- SignalVertex: `signal_type`, `status`, `dedupeKey`, `detector_version`, `window_key`
- AccountVertex: `account_id`, `lifecycle_state`
- PostureVertex: `posture`, `momentum`, `ruleset_version`, `active_signals_hash`
- RiskFactorVertex: `risk_type`, `severity`, `description`
- OpportunityVertex: `opportunity_type`, `severity`, `description`
- UnknownVertex: `unknown_type`, `description`, `introduced_at`, `expires_at`, `review_after`

**Edge Properties:**
- `created_at: string` (ISO timestamp)
- `updated_at: string` (ISO timestamp)
- `trace_id: string` (for ledger alignment)
- `schema_version: string` (e.g., "v1")
- Optional: `weight`, `metadata` (JSON)
- Note: Edge label already encodes type (e.g., "HAS_SIGNAL", "SUPPORTED_BY"), so `edge_type` is redundant and omitted

**Acceptance Criteria:**
- All vertex ID schemes documented
- Signal identity rule clearly separated from dedupeKey
- Required properties enforced in code
- Type definitions match `GRAPH_CONVENTIONS.md`

---

### 2.2 Graph Conventions Document

**File:** `docs/implementation/phase_2/GRAPH_CONVENTIONS.md`

**Purpose:** Non-negotiable graph conventions (already created, verify alignment)

**Key Sections:**
- Query language: Gremlin only (not OpenCypher)
- Vertex ID schemes
- Required/optional properties
- Idempotent upsert patterns
- Determinism rules
- Write boundaries
- Bounded query contract
- Versioning
- Deletion/tombstones
- Ledger alignment

**Acceptance Criteria:**
- Document exists and is referenced by code
- All code follows conventions
- Upsert patterns are idempotent

---

## 3. Graph Service (Neptune)

### 3.1 GraphService Interface

**File:** `src/services/graph/IGraphService.ts`

**Purpose:** Abstract interface for graph operations

**Key Methods:**
- `upsertVertex(vertexId, label, properties)`: Idempotent vertex upsert
- `upsertEdge(fromVertexId, toVertexId, edgeLabel, properties)`: Idempotent edge upsert
- `getVertex(vertexId)`: Get vertex by ID
- `getEdges(vertexId, edgeLabel?)`: Get edges from vertex
- `deleteVertex(vertexId)`: Delete vertex (soft delete via tombstone)
- `queryVertices(query)`: Bounded query (no unbounded traversals)

**Critical:** All operations must be idempotent and bounded.

---

### 3.2 GraphService Implementation

**File:** `src/services/graph/GraphService.ts`

**Purpose:** Implement graph operations using Gremlin

**Key Methods:**

**Upsert Vertex (Idempotent):**
```typescript
async upsertVertex(
  vertexId: string,
  label: string,
  properties: Record<string, any>
): Promise<void> {
  // Gremlin pattern:
  // g.V(vertexId).fold().coalesce(
  //   unfold(),
  //   addV(label).property(id, vertexId).property(...properties)
  // ).property('updated_at', now).next()
}
```

**Upsert Edge (Idempotent):**
```typescript
async upsertEdge(
  fromVertexId: string,
  toVertexId: string,
  edgeLabel: string,
  properties?: Record<string, any>
): Promise<void> {
  // Gremlin pattern (corrected - prevents duplicates):
  // g.V(fromVertexId).as('from')
  //  .coalesce(
  //    __.outE(edgeLabel).where(__.inV().hasId(toVertexId)),
  //    __.V(toVertexId).addE(edgeLabel).from('from').property(...properties)
  //  ).next()
  // Start at 'from', check outE(edgeLabel) where inV() matches 'to', else add edge
}
```

**Get Vertex:**
```typescript
async getVertex(vertexId: string): Promise<Vertex | null> {
  // g.V(vertexId).next()
}
```

**Get Edges:**
```typescript
async getEdges(
  vertexId: string,
  edgeLabel?: string
): Promise<Edge[]> {
  // g.V(vertexId).outE(edgeLabel).limit(100).toList()
  // Bounded: limit(100) prevents unbounded traversals
}
```

**Bounded Query Contract:**
- All queries must have explicit limits
- No unbounded traversals (e.g., `.repeat(__.out())` without `.times(N)`)
- Maximum depth: 3 levels
- Maximum results: 100 per query

**Error Handling:**
- Retry on transient errors (connection, timeout)
- Log to ledger on failures
- Dead letter queue for persistent failures

**Acceptance Criteria:**
- All upserts are idempotent (tested with retries)
- Queries are bounded (no unbounded traversals)
- Connection reuse works within warm container; reconnect-on-failure handles cold starts/stale websockets
- Errors are logged and retried appropriately

---

## 4. Posture Types & Schemas

### 4.1 Posture Types

**File:** `src/types/PostureTypes.ts`

**Purpose:** Define posture state, risk factors, opportunities, and unknowns

**Key Types:**

**PostureState Enum:**
```typescript
export enum PostureState {
  OK = 'OK',
  WATCH = 'WATCH',
  AT_RISK = 'AT_RISK',
  EXPAND = 'EXPAND',
  DORMANT = 'DORMANT',
}
```

**Momentum Enum:**
```typescript
export enum Momentum {
  UP = 'UP',
  FLAT = 'FLAT',
  DOWN = 'DOWN',
}
```

**Severity Enum (Normalized):**
```typescript
export enum Severity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  // No 'critical' or other values allowed
}
```

**RiskFactorV1:**
```typescript
export interface RiskFactorV1 {
  risk_id: string; // Deterministic hash
  type: string; // e.g., "RENEWAL_RISK", "USAGE_DECLINE"
  severity: Severity; // low | medium | high
  description: string;
  evidence_signal_ids: string[]; // Top K signal IDs (authoritative)
  evidence_snapshot_refs: EvidenceSnapshotRef[]; // Top K snapshot refs
  introduced_at: string; // ISO timestamp
  expires_at?: string | null; // ISO timestamp (optional)
}
```

**OpportunityV1:**
```typescript
export interface OpportunityV1 {
  opportunity_id: string; // Deterministic hash
  type: string; // e.g., "EARLY_ENGAGEMENT", "USAGE_GROWTH"
  severity: Severity; // low | medium | high
  description: string;
  evidence_signal_ids: string[]; // Top K signal IDs (authoritative)
  evidence_snapshot_refs: EvidenceSnapshotRef[]; // Top K snapshot refs
  introduced_at: string; // ISO timestamp
  expires_at?: string | null; // ISO timestamp (optional)
}
```

**UnknownV1 (TTL Semantics Required):**
```typescript
export interface UnknownV1 {
  unknown_id: string; // Deterministic hash
  type: string; // e.g., "ENGAGEMENT_QUALITY", "SUSPECT_PROGRESSION"
  description: string;
  introduced_at: string; // ISO timestamp (REQUIRED)
  expires_at: string | null; // ISO timestamp OR
  review_after: string; // ISO timestamp (alternative to expires_at)
  // At least one of expires_at or review_after must be set
}
```

**Critical Rule: Unknown Timestamp Determinism (LOCKED)**
- `introduced_at`, `expires_at`, and `review_after` are derived from `event.as_of_time` (not wall clock)
- These timestamps are **excluded from semantic-equality checks** (non-deterministic fields)
- Engine stamps them deterministically using `event.as_of_time` and fixed functions
- This ensures replayability: same event → same timestamps
- **Equality Function Contract:** When comparing posture outputs for determinism, equality function MUST explicitly ignore `introduced_at`, `expires_at`, and `review_after` fields (not just documented - enforced in code)

**AccountPostureStateV1:**
```typescript
export interface AccountPostureStateV1 {
  // Primary key
  account_id: string;
  tenant_id: string;
  
  // Posture
  posture: PostureState;
  momentum: Momentum;
  
  // Arrays
  risk_factors: RiskFactorV1[];
  opportunities: OpportunityV1[];
  unknowns: UnknownV1[];
  
  // Evidence (IDs-first, types-second)
  evidence_signal_ids: string[]; // Top K (authoritative, for audit/readability)
  evidence_snapshot_refs: EvidenceSnapshotRef[]; // Top K (authoritative, for audit/readability)
  evidence_signal_types: string[]; // Human-readable (documentation only)
  
  // Versioning & Determinism
  ruleset_version: string; // e.g., "v1.0.0"
  schema_version: string; // e.g., "v1"
  active_signals_hash: string; // SHA256 hash of ALL active signal IDs (after TTL + suppression), sorted lexicographically
  inputs_hash: string; // SHA256 hash of (active_signals_hash + lifecycle_state + ruleset_version)
  // Note: active_signals_hash includes ALL active signals, not just top K evidence signals
  
  // Metadata
  evaluated_at: string; // ISO timestamp (event.as_of_time)
  output_ttl_days: number | null; // Posture expiry (null = permanent)
  rule_id: string; // Which rule matched
  created_at: string; // ISO timestamp
  updated_at: string; // ISO timestamp
}
```

**Rule Trigger Metadata:**
```typescript
export interface RuleTriggerMetadata {
  rule_id: string;
  ruleset_version: string;
  inputs_hash: string; // SHA256 hash of inputs
  matched_at: string; // ISO timestamp
  priority: number; // Rule priority
}
```

**Acceptance Criteria:**
- All schemas are versioned (V1)
- UnknownV1 includes TTL semantics (introduced_at, expires_at OR review_after)
- Evidence is IDs-first (evidence_signal_ids, evidence_snapshot_refs)
- Types are for documentation only
- Schemas are enforced at runtime (fail-closed)

---

## 5. Graph Materializer

### 5.1 GraphMaterializer Service

**File:** `src/services/graph/GraphMaterializer.ts`

**Purpose:** Materialize signals and evidence into Neptune graph

**Key Methods:**
- `materializeSignal(signalId, tenantId)`: Materialize a single signal
- `materializeBatch(signalIds, tenantId)`: Materialize multiple signals (batch)
- `ensureAccountVertex(accountId, tenantId, accountState)`: Ensure account vertex exists
- `materializeEvidenceSnapshot(evidenceRef)`: Materialize evidence snapshot vertex

**Materialization Flow (Per Signal):**
1. Load signal by ID from DynamoDB
2. Validate schema + versions
3. Ensure Account vertex exists (idempotent upsert)
4. Upsert Signal vertex (idempotent)
5. Upsert EvidenceSnapshot vertex from `EvidenceSnapshotRef` (idempotent)
6. Create edges:
   - Account `HAS_SIGNAL` Signal (idempotent)
   - Signal `SUPPORTED_BY` EvidenceSnapshot (idempotent)
7. Write materialization status to `GraphMaterializationStatus` table:
   - `GraphMaterializationStatus(pk=SIGNAL#{tenant_id}#{signal_id}) { status: 'COMPLETED', trace_id, updated_at }`
   - This table is the authoritative gating mechanism for synthesis (ledger is for audit only)
8. Emit ledger events: `GRAPH_UPSERTED`, `GRAPH_EDGE_CREATED`, `GRAPH_MATERIALIZATION_COMPLETED`
9. Emit EventBridge event: `GRAPH_MATERIALIZED` (triggers synthesis)

**Idempotency:**
- All upserts use vertex ID uniqueness
- Edges are idempotent via coalesce pattern
- Replaying same event produces no duplicates

**Failure Semantics Rule (LOCKED):**
- If graph materialization partially succeeds, synthesis MUST NOT run
- **Enforcement (LOCKED):** Use `GraphMaterializationStatus` table as authoritative gating mechanism
  - Status table is fast (single DDB read) and cost-effective
  - Ledger is used for audit only (not for gating synthesis)
  - Synthesis handler checks `GraphMaterializationStatus` table before running
- **Do NOT mutate signal record** (avoids write contention and mixing responsibilities)
- **Do NOT use `graph_materialized=true` flag** - this option is removed entirely
- **Do NOT use ledger gate for synthesis gating** - status table is the single enforcement path
- Prevents "phantom posture updates" without full evidence linkage

**Error Handling:**
- Retry on transient Neptune errors
- Log partial failures to ledger
- Dead letter queue for persistent failures

**Acceptance Criteria:**
- Every signal materializes with Account, Signal, EvidenceSnapshot vertices
- Correct edges are created
- Replaying same event produces no duplicates
- Ledger records materialization with same `trace_id`
- Partial failures prevent synthesis from running

---

### 5.2 Graph Materializer Handler

**File:** `src/handlers/phase2/graph-materializer-handler.ts`

**Purpose:** Lambda handler for graph materialization

**Trigger:**
- EventBridge: `SIGNAL_DETECTED` or `SIGNAL_CREATED` events (from Phase 1)

**Event Pattern:**
```typescript
{
  source: 'cc-native.perception',
  'detail-type': ['SIGNAL_DETECTED', 'SIGNAL_CREATED'],
  detail: {
    signalId: string,
    tenantId: string,
    accountId: string,
    traceId: string,
  }
}
```

**Handler Logic:**
1. Extract signalId from event
2. Call `GraphMaterializer.materializeSignal(signalId, tenantId)`
3. Log to ledger: `GRAPH_MATERIALIZATION_STARTED`, `GRAPH_MATERIALIZATION_COMPLETED`
4. Write materialization status to `GraphMaterializationStatus` table (authoritative gating mechanism)
5. Emit EventBridge event: `GRAPH_MATERIALIZED` (triggers synthesis engine)
6. On failure: log `GRAPH_MATERIALIZATION_FAILED` and send to DLQ (do NOT emit `GRAPH_MATERIALIZED`)

**Dead Letter Queue:**
- `graph-materializer-handler-dlq`
- Max retries: 3
- Quarantine failed signals for manual review

**Acceptance Criteria:**
- Handler processes events from EventBridge
- Materialization is logged to ledger
- Failures are sent to DLQ
- Handler is idempotent (can be retried)

---

### 5.3 Backfill Job

**File:** `src/handlers/phase2/graph-backfill-handler.ts`

**Purpose:** One-time backfill of Phase 1 signals into graph

**Trigger:**
- Manual invocation (Lambda function)
- Can be invoked via AWS Console, CLI, or scheduled via EventBridge Scheduler

**Logic:**
1. Query signals by tenant/account/time (paginated)
2. For each signal batch:
   - Call `GraphMaterializer.materializeBatch(signalIds, tenantId)`
   - Checkpoint progress (DynamoDB)
3. Resume from checkpoint if interrupted (on retry or manual re-invocation)

**Checkpointing:**
- Store last processed `signalId` and `tenantId` in DynamoDB (`BackfillCheckpoint` table)
- Resume from checkpoint on retry or re-invocation
- Idempotent: re-processing same signals produces no duplicates (graph upserts are idempotent)

**Why Lambda (not Step Functions):**
- Simple batch processing with checkpointing doesn't require Step Functions orchestration
- Lambda timeout (15 min) is sufficient for batch processing with pagination
- Checkpointing in DynamoDB provides resumability
- Consistent with Phase 1 architecture (no Step Functions)
- Lower operational overhead

**Backfill Batch Size & Time Limits (LOCKED):**
- **Batch size:** 50-200 signals per invocation (fits Neptune write rate, prevents timeouts)
- **Time limit:** Stop processing at 12 minutes, checkpoint, re-invoke
- **Rationale:** Prevents "works in dev, times out in stage" - explicit contract prevents production failures
- **Checkpoint frequency:** After each batch (every 50-200 signals) or every 2 minutes, whichever comes first
- **Resumability:** On re-invocation, read checkpoint and continue from last processed `signalId`

**Acceptance Criteria:**
- Backfill can run for a tenant without timeouts (respects 12-minute time limit per invocation)
- Batch size is capped at 50-200 signals per invocation
- Checkpointing happens after each batch or every 2 minutes (whichever comes first)
- Backfill is resumable and idempotent
- Post-run: graph node/edge counts match expectation for sample accounts

---

## 6. Synthesis Engine

### 6.1 Ruleset Loader

**File:** `src/services/synthesis/RulesetLoader.ts`

**Purpose:** Load and parse synthesis ruleset from YAML

**Key Methods:**
- `loadRuleset(version: string)`: Load ruleset by version (e.g., "v1.0.0")
- `parseRuleset(yamlContent: string)`: Parse YAML into typed ruleset
- `validateRuleset(ruleset)`: Validate ruleset schema

**Ruleset Schema:**
- Matches `synthesis/rules/v1.yaml` structure
- Validates: rule_id, priority, lifecycle_state, conditions, outputs
- Validates: required_signals, excluded_signals, computed_predicates
- Validates: output_ttl_days, evidence_signals

**Caching:**
- Cache parsed ruleset in memory (Lambda warm start)
- Invalidate on ruleset version change

**Acceptance Criteria:**
- Ruleset loads from `synthesis/rules/v1.yaml`
- Parsed ruleset matches TypeScript types
- Validation catches schema errors

---

### 6.2 Condition Evaluator

**File:** `src/services/synthesis/ConditionEvaluator.ts`

**Purpose:** Evaluate rule conditions against active signals

**Key Methods:**
- `evaluateRequiredSignals(condition, activeSignals)`: Check required signals match
- `evaluateExcludedSignals(condition, activeSignals)`: Check excluded signals don't match
- `evaluateWhereClause(signal, whereClause)`: Evaluate property predicates
- `evaluateComputedPredicates(predicates, activeSignals, eventTime)`: Evaluate computed predicates

**Property Predicate Evaluation:**
- `equals`: Exact match
- `greater_than`, `less_than`, `less_than_or_equal`: Numeric comparison
- `within_last_days`: `signal.createdAt >= (event.as_of_time - N days)`
- `in`: Array membership
- `exists`, `not_exists`: Property existence

**Property Access:**
- `signal.context.{property_name}` for context properties
- `signal.metadata.{property_name}` for metadata properties
- `signal.createdAt` for time-based comparisons

**Computed Predicates:**
- `no_engagement_in_days`: Absence of engagement signals in last N days
  - Engagement signals: `FIRST_ENGAGEMENT_OCCURRED`, `ACCOUNT_ACTIVATION_DETECTED`
- `has_engagement_in_days`: Presence of engagement signals in last N days

**Acceptance Criteria:**
- All operators are implemented correctly
- Property paths match signal structure
- Computed predicates scan active signals (not signal properties)
- Evaluation is deterministic (same inputs → same outputs)

---

### 6.3 Synthesis Engine

**File:** `src/services/synthesis/SynthesisEngine.ts`

**Purpose:** Execute synthesis ruleset and generate posture state

**Key Methods:**
- `synthesize(accountId, tenantId, eventTime)`: Main synthesis method
- `loadActiveSignals(accountId, tenantId)`: Load active signals (apply TTL, suppression)
- `loadAccountState(accountId, tenantId)`: Load AccountState (lifecycle)
- `evaluateRules(ruleset, activeSignals, accountState, eventTime)`: Evaluate rules in priority order
- `generatePostureState(matchedRule, activeSignals, accountState, eventTime)`: Generate posture state from matched rule
- `resolveEvidenceSignals(evidenceSignalTypes, activeSignals)`: Resolve signal types to signal IDs

**Synthesis Flow:**
1. Load active signals for account (apply TTL, suppression)
2. Load AccountState (lifecycle)
3. Load ruleset (cached)
4. Sort rules by priority (ascending), then by rule_id (alphabetical) as tie-breaker
5. Evaluate rules in order until first match
6. Generate posture state from matched rule
7. Resolve evidence signals to IDs (IDs-first contract) - top K for evidence arrays
8. Compute hashes:
   - `active_signals_hash`: SHA256 of ALL active signal IDs (after TTL + suppression), sorted lexicographically
   - `inputs_hash`: SHA256 of (active_signals_hash + lifecycle_state + ruleset_version)
9. Return `AccountPostureStateV1`

**Idempotency Key:**
- `tenant_id#account_id#ruleset_version#active_signals_hash`
- Same inputs → same output (bitwise identical JSON ignoring timestamps)

**Evidence Resolution (IDs-first Contract):**
- `evidence_signals` lists signal types (human-readable)
- Engine MUST resolve to actual `signal_ids` when storing
- Store as `evidence_signal_ids[]` (top K) for auditability
- Store as `evidence_snapshot_refs[]` (top K) for immutable evidence linkage
- Types are for documentation only; IDs are authoritative

**Timestamp Handling:**
- `evaluated_at`: Use `event.as_of_time` (not wall clock)
- `introduced_at`, `review_after` in unknowns: Stamped by engine using `event.as_of_time`
- These fields are excluded from bitwise equality checks

**Acceptance Criteria:**
- Same active signals → same posture output (bitwise identical JSON ignoring timestamps)
- Evidence is resolved to IDs (not just types)
- Hashes are computed correctly
- Rule evaluation is deterministic and order-stable
- Posture updates only when output changes (avoid churn)

---

### 6.4 Synthesis Engine Handler

**File:** `src/handlers/phase2/synthesis-engine-handler.ts`

**Purpose:** Lambda handler for synthesis engine

**Trigger:**
- EventBridge: `GRAPH_MATERIALIZED` event (from graph materializer) - **Canonical path**
- Scheduled: Hourly consolidation (optional)

**Event Pattern:**
```typescript
{
  source: 'cc-native.graph',
  'detail-type': 'GRAPH_MATERIALIZED',
  detail: {
    accountId: string,
    tenantId: string,
    signalId: string,
    traceId: string,
  }
}
```

**Handler Logic:**
1. Extract accountId, tenantId from event
2. Verify graph materialization succeeded (check `GraphMaterializationStatus` table - **Failure Semantics Rule**)
   - Query `GraphMaterializationStatus` table for signal materialization status
   - If status is not 'COMPLETED', do NOT run synthesis (prevents phantom posture updates)
   - Ledger is for audit only, not for gating synthesis
3. Call `SynthesisEngine.synthesize(accountId, tenantId, eventTime)`
4. Write `AccountPostureState` to DynamoDB (idempotent - conditional write with `inputs_hash` check)
5. Upsert Posture/Risk/Unknown vertices + edges in Neptune
6. Emit ledger events: `POSTURE_UPDATED`, `RISK_FACTOR_EMITTED`, `UNKNOWN_EMITTED`

**Dead Letter Queue:**
- `synthesis-engine-handler-dlq`
- Max retries: 3
- Quarantine failed accounts for manual review

**Acceptance Criteria:**
- Handler processes events from EventBridge
- Synthesis only runs if graph materialization succeeded
- Posture state is written to DynamoDB
- Graph vertices/edges are upserted
- Failures are sent to DLQ

---

## 7. AccountPostureState Service

### 7.1 AccountPostureState Service

**File:** `src/services/synthesis/AccountPostureStateService.ts`

**Purpose:** Manage AccountPostureState read model in DynamoDB

**Key Methods:**
- `getPostureState(accountId, tenantId)`: Get posture state (single DDB read)
- `writePostureState(postureState)`: Write posture state (idempotent upsert)
- `updatePostureState(accountId, tenantId, updates)`: Update posture state
- `deletePostureState(accountId, tenantId)`: Delete posture state (soft delete)

**DynamoDB Table Schema:**
- Primary key: `pk = ACCOUNT#{tenant_id}#{account_id}`, `sk = POSTURE#LATEST`
- GSI (optional): `gsi1pk = TENANT#{tenant_id}`, `gsi1sk = POSTURE#{posture}#{updated_at}`
- Attributes: All fields from `AccountPostureStateV1`

**Idempotent Upsert (Churn Prevention - LOCKED):**
- Use `inputs_hash` as idempotency key
- **DDB Conditional Write Expression (enforces churn prevention under concurrency):**
  ```typescript
  ConditionExpression: 'attribute_not_exists(inputs_hash) OR inputs_hash <> :new_inputs_hash'
  ```
- Only update if `inputs_hash` changes (avoid churn)
- **Churn Prevention:** If only `event.as_of_time` changes but signals/lifecycle don't, `inputs_hash` is unchanged → no DDB write
- This conditional write prevents concurrent writes from causing unnecessary updates when inputs_hash is unchanged

**Acceptance Criteria:**
- Returns posture state within low latency (single DDB read)
- Missing posture state returns typed "not ready" response
- Upserts are idempotent (same inputs_hash → no update)
- Posture updates only when output changes

---

## 8. Event Handlers

### 8.1 Event-Driven Chain (EventBridge → Lambda)

**File:** `src/stacks/CCNativeStack.ts` (additions)

**Purpose:** Route events to Phase 2 handlers (matching Phase 1 pattern)

**Decision: Use EventBridge → Lambda directly (no Step Functions for event-driven path)**
- Phase 1 uses EventBridge → Lambda with DLQs (no Step Functions)
- Step Functions add operational overhead without clear benefit for simple event chains
- Lambda already provides retry/DLQ support
- Ledger already provides audit trails
- Keep architecture consistent with Phase 1

**EventBridge Integration (Event-Driven Chain, NOT Fan-Out):**
- Rule 1: Route `SIGNAL_DETECTED` → `graph-materializer-handler` Lambda
- Rule 2: Route `SIGNAL_CREATED` → `graph-materializer-handler` Lambda
- Rule 3: Route `GRAPH_MATERIALIZED` → `synthesis-engine-handler` Lambda (canonical path)
- **Critical:** Do NOT use fan-out pattern - EventBridge doesn't guarantee ordering across targets
- Materializer emits `GRAPH_MATERIALIZED` event only after successful materialization
- Synthesis handler triggers only on `GRAPH_MATERIALIZED` event (not directly on signal events)

**Handler Configuration:**
- Each Lambda has DLQ configured (matching Phase 1 pattern)
- Retry attempts: 2 (configurable per handler)
- Timeout: Appropriate for operation (materializer: 5 min, synthesis: 3 min)
- Ledger logging happens within handlers (not separate Lambda)

**Optional: Step Functions for Backfill Only**
- If backfill workflow needs richer orchestration (checkpointing, parallel batches, etc.), consider Step Functions for backfill handler only
- Event-driven path remains EventBridge → Lambda for simplicity and consistency

**Acceptance Criteria:**
- EventBridge routes events to handlers correctly
- DLQs are configured for all handlers
- Retries and error handling work via Lambda configuration
- Architecture matches Phase 1 pattern (EventBridge → Lambda)

---

## 9. Infrastructure (CDK)

### 9.1 CDK Stack Additions

**File:** `src/stacks/CCNativeStack.ts` (additions)

**Resources to Add:**
- Neptune cluster (see 1.1)
- Neptune subnet group
- Neptune security group
- IAM roles for Neptune access
- Lambda functions:
  - `graph-materializer-handler`
  - `graph-backfill-handler`
  - `synthesis-engine-handler`
- Dead letter queues:
  - `graph-materializer-handler-dlq`
  - `synthesis-engine-handler-dlq`
- DynamoDB tables:
  - `AccountPostureState` (see 7.1)
  - `GraphMaterializationStatus` (for failure semantics enforcement)
- EventBridge rules for handler routing

**EventBridge Rules:**
- Rule 1: Route `SIGNAL_DETECTED` → `graph-materializer-handler` Lambda
- Rule 2: Route `SIGNAL_CREATED` → `graph-materializer-handler` Lambda
- Rule 3: Route `GRAPH_MATERIALIZED` → `synthesis-engine-handler` Lambda (canonical path)

**Acceptance Criteria:**
- All resources deploy via CDK
- EventBridge routes events correctly
- DLQs are configured
- IAM roles have correct permissions

---

## 10. Unit Tests & Contract Tests

### 10.1 Test Coverage

**Files:**
- `src/tests/unit/graph/GraphService.test.ts`
- `src/tests/unit/graph/GraphMaterializer.test.ts`
- `src/tests/unit/synthesis/ConditionEvaluator.test.ts`
- `src/tests/unit/synthesis/SynthesisEngine.test.ts`
- `src/tests/unit/synthesis/AccountPostureStateService.test.ts`
- `src/tests/unit/synthesis/RulesetLoader.test.ts`

**Test Scenarios (Unit Tests):**
- Graph vertex/edge upserts (idempotency)
- Graph queries (bounded)
- Condition evaluation (all operators)
- Computed predicates (no_engagement_in_days, has_engagement_in_days)
- Rule evaluation (priority order, tie-breaker)
- Evidence resolution (IDs-first)
- Posture state generation
- Hash computation (active_signals_hash, inputs_hash)
- Timestamp handling (event.as_of_time)
- Posture state read/write (idempotency)

**Contract Tests (Phase 2 Certification):**
1. **Determinism Test:** Same active signals + ruleset → same posture output (bitwise identical JSON ignoring timestamps)
2. **Idempotency Test:** Replaying same event produces no duplicate graph vertices/edges
3. **Failure Semantics Test:** Partial graph materialization prevents synthesis from running
4. **Evidence IDs Test:** Evidence is resolved to signal IDs (not just types)
5. **Bounded Query Test:** All graph queries are bounded (no unbounded traversals)
6. **Replay Test:** Replay harness passes with golden files
7. **Churn Test:** If only `event.as_of_time` changes but signals/lifecycle don't, no DDB write (inputs_hash unchanged) - prevents clock drift from causing posture rewrites

**Replay Test Harness:**
- File: `src/tests/contract/phase2-replay.test.ts`
- Replays fixed set of Phase 1 signals
- Asserts graph + posture outputs match golden files
- Any ruleset change requires explicit golden update + changelog entry

**Acceptance Criteria:**
- Unit tests cover all services (>80% coverage)
- Contract tests pass (determinism, idempotency, failure semantics, evidence IDs, bounded queries, replay)
- Replay harness passes in CI
- Golden files are versioned and documented

---

## Phase 2 Definition of Done

Phase 2 is complete when:

- [ ] Neptune cluster is provisioned and accessible
- [ ] Graph conventions are documented and followed
- [ ] Graph materializer materializes signals with evidence edges
- [ ] `AccountPostureState` exists and can be queried per account
- [ ] Synthesis rules produce posture/risk/unknowns deterministically
- [ ] Evidence is resolved to signal IDs (IDs-first contract)
- [ ] Replay harness passes in CI
- [ ] Ledger contains complete trace for materialization + synthesis
- [ ] Costs are bounded (no lake scans; no unbounded graph traversals)
- [ ] Failure semantics rule is enforced (partial materialization prevents synthesis)
- [ ] All unit tests and contract tests pass
- [ ] `PHASE_2_CERTIFICATION.md` is produced and signed off

**Status: 📋 Phase 2 Implementation Not Started**

---

## Next Steps After Phase 2

After Phase 2 is complete:

1. **Integration Testing** - Test end-to-end flow with real Phase 1 signals
2. **Performance Testing** - Verify bounded queries and cost optimization
3. **Monitoring** - Set up CloudWatch dashboards and alarms
4. **Documentation** - Document synthesis ruleset and graph conventions for operations
5. **Phase 3 Planning** - Begin AgentCore Decision layer planning

**Estimated Implementation Statistics:**
- **~25-30 TypeScript files** (graph + synthesis layer)
- **3 Lambda handlers** deployed via CDK (materializer, backfill, synthesis)
- **2 DLQs** configured for error handling (matching Phase 1 pattern)
- **1 Neptune cluster** (dev/stage)
- **2 DynamoDB tables** (AccountPostureState, GraphMaterializationStatus)
- **3 EventBridge rules** for handler routing (matching Phase 1 pattern)

---

## Implementation Notes

### Critical Implementation Details

1. **Gremlin Query Language:** ✅ **LOCKED: Gremlin only**
   - Use AWS Neptune Gremlin SDK
   - Document all query patterns in `GRAPH_CONVENTIONS.md`
   - No OpenCypher queries

2. **Signal Identity:** ✅ **Separated from dedupeKey (LOCKED - Tenant-Scoped)**
   - Vertex ID = `SIGNAL#{tenant_id}#{signal_id}` (tenant-scoped; from Phase 1)
   - `dedupeKey` stored as property, not used for vertex identity
   - **Decision:** Tenant-scope all vertex IDs unless you can prove global uniqueness forever

3. **Failure Semantics:** ✅ **Enforced (LOCKED)**
   - If graph materialization partially succeeds, synthesis MUST NOT run
   - Enforce via `GraphMaterializationStatus` table as authoritative gating mechanism (fast, cost-effective)
   - Ledger is for audit only, not for gating synthesis
   - **Do NOT mutate signal record** (avoids write contention and mixing responsibilities)
   - **Do NOT use `graph_materialized=true` flag** - this option is removed entirely
   - **Do NOT use ledger gate for synthesis gating** - status table is the single enforcement path

4. **Evidence Resolution:** ✅ **IDs-first Contract**
   - Engine MUST resolve to `evidence_signal_ids[]` and `evidence_snapshot_refs[]`
   - Types are for documentation only

5. **Bounded Queries:** ✅ **Required**
   - All graph queries must have explicit limits
   - No unbounded traversals
   - Maximum depth: 3 levels
   - Maximum results: 100 per query

6. **Determinism:** ✅ **Required**
   - Same inputs → same outputs (bitwise identical JSON ignoring timestamps)
   - Hashes computed deterministically
   - Rule evaluation is order-stable

---

**Last Updated:** 2026-01-23  
**Status:** 📋 Planning Complete - Ready for Implementation
