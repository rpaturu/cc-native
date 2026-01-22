# World Snapshot Contract

## 1. Purpose

This contract defines the **snapshot binding requirements** for agent decisions. Every agent decision MUST bind to a specific, immutable snapshot of world state.

**Core Principle:**
> **Every agent decision MUST bind to a specific snapshot. No snapshot = no valid decision.**

---

## 2. Snapshot Definition

A **snapshot** is an immutable, timestamped view of world state at a point in time.

### 2.1 Snapshot Properties

**Immutable:**
* Once created, snapshot cannot be modified
* Historical accuracy preserved
* Audit trail integrity maintained

**Timestamped:**
* Precise point-in-time capture
* Temporal queries supported
* Time-travel capability enabled

**Versioned:**
* Unique snapshot ID
* Version tracking
* Reproducible retrieval

**Complete:**
* Contains all entity state at capture time
* Includes confidence scores
* Includes metadata (freshness, contradictions, provenance)

---

## 3. Snapshot Structure

### 3.1 Snapshot Schema

```typescript
interface WorldSnapshot {
  snapshotId: string;              // Unique snapshot identifier
  entityId: string;                // Entity identifier (e.g., "account:acme_corp")
  entityType: string;              // Entity type (e.g., "Account")
  version: string;                 // Schema version (e.g., "1.0")
  timestamp: string;               // ISO 8601 timestamp
  asOf: string;                    // Point-in-time reference
  
  // Entity State
  state: {
    [fieldName: string]: {
      value: any;                  // Field value
      confidence: number;          // [0, 1] confidence score
      freshness: number;            // Hours since last update
      contradiction: number;        // [0, 1] contradiction score
      provenanceTrust: TrustClass;  // Trust classification
      lastUpdated: string;          // ISO 8601 timestamp
      evidenceRefs: string[];       // References to evidence records
    };
  };
  
  // Metadata
  metadata: {
    snapshotVersion: string;        // Snapshot format version
    criticalFields: string[];       // Fields required from registry
    registryVersion: string;        // Critical field registry version used
    computedAt: string;             // When snapshot was computed
    computedBy: string;              // System component that computed it
  };
  
  // Audit
  audit: {
    createdBy: string;              // Agent/system that requested snapshot
    purpose: string;                // Why snapshot was created
    decisionContext?: string;       // Associated decision context
  };
}
```

### 3.2 Example Snapshot

```json
{
  "snapshotId": "snap_20240115_143022_account_acme_corp_v1",
  "entityId": "account:acme_corp",
  "entityType": "Account",
  "version": "1.0",
  "timestamp": "2024-01-15T14:30:22.123Z",
  "asOf": "2024-01-15T14:30:22.123Z",
  
  "state": {
    "accountName": {
      "value": "Acme Corporation",
      "confidence": 0.95,
      "freshness": 12,
      "contradiction": 0,
      "provenanceTrust": "PRIMARY",
      "lastUpdated": "2024-01-15T02:30:22.123Z",
      "evidenceRefs": [
        "evt_crm_account_update_20240115_023022",
        "evt_salesforce_sync_20240115_023100"
      ]
    },
    "renewalDate": {
      "value": "2024-12-31",
      "confidence": 0.90,
      "freshness": 6,
      "contradiction": 0,
      "provenanceTrust": "PRIMARY",
      "lastUpdated": "2024-01-15T08:30:22.123Z",
      "evidenceRefs": [
        "evt_crm_renewal_update_20240115_083022"
      ]
    },
    "healthScore": {
      "value": 0.75,
      "confidence": 0.85,
      "freshness": 24,
      "contradiction": 0.1,
      "provenanceTrust": "DERIVED",
      "lastUpdated": "2024-01-14T14:30:22.123Z",
      "evidenceRefs": [
        "evt_telemetry_usage_20240114_143022",
        "evt_support_tickets_20240114_143100"
      ]
    }
  },
  
  "metadata": {
    "snapshotVersion": "1.0",
    "criticalFields": ["accountName", "renewalDate"],
    "registryVersion": "1.0",
    "computedAt": "2024-01-15T14:30:22.123Z",
    "computedBy": "world-model-snapshot-service"
  },
  
  "audit": {
    "createdBy": "agent:meeting-prep-v1",
    "purpose": "meeting_prep_decision",
    "decisionContext": "prep_for_renewal_call_20240116"
  }
}
```

---

## 4. Snapshot Binding Requirements

### 4.1 Binding Rule

> **Every agent decision MUST bind to a specific snapshot.**

**Decision Invalid Without Snapshot:**
* No snapshot = no valid decision
* Snapshot must be captured **before** decision
* Snapshot ID must be logged with decision
* Snapshot must be retrievable for audit

### 4.2 Binding Process

**Step 1: Request Snapshot**
```typescript
const snapshot = await worldModel.getSnapshot({
  entityId: 'account:acme_corp',
  asOf: new Date().toISOString(),
  purpose: 'meeting_prep_decision'
});
```

**Step 2: Validate Snapshot**
```typescript
// Verify snapshot completeness
if (!snapshot.metadata.criticalFields.every(
  field => snapshot.state[field]
)) {
  throw new Error('Missing critical fields in snapshot');
}

// Verify snapshot freshness
const snapshotAge = Date.now() - new Date(snapshot.timestamp).getTime();
if (snapshotAge > MAX_SNAPSHOT_AGE) {
  throw new Error('Snapshot too stale for decision');
}
```

**Step 3: Make Decision**
```typescript
const decision = await agent.makeDecision({
  snapshotId: snapshot.snapshotId,
  entityId: snapshot.entityId,
  context: decisionContext
});
```

**Step 4: Log Decision with Snapshot**
```typescript
await ledger.append({
  eventType: 'DECISION',
  traceId: decision.traceId,
  tenantId: decision.tenantId,
  snapshotId: snapshot.snapshotId,  // REQUIRED
  decisionId: decision.decisionId,
  actionProposals: decision.actions,
  // ... other decision data
});
```

---

## 5. Snapshot Retrieval

### 5.1 Retrieval Patterns

**By Snapshot ID:**
```
GET /world-model/entities/{entity_id}/snapshots/{snapshot_id}
```

**By Timestamp (Time-Travel):**
```
GET /world-model/entities/{entity_id}/snapshots?as_of={timestamp}
```

**Latest Snapshot:**
```
GET /world-model/entities/{entity_id}/snapshots/latest
```

### 5.2 Retrieval Guarantees

**Immutability:**
* Same snapshot ID → same data (always)
* No modifications after creation
* Historical accuracy preserved

**Reproducibility:**
* Snapshot can be recreated from evidence
* Deterministic computation
* Audit trail completeness

**Availability:**
* Snapshots stored in S3 (immutable)
* DynamoDB index for fast lookup
* QLDB for tamper-evident audit

---

## 6. Snapshot Storage

### 6.1 Storage Architecture

**Primary Storage: S3**
* Immutable object storage
* Versioned buckets
* Object Lock (WORM) for compliance
* Path: `s3://cc-native-world-state-snapshots/{entity_type}/{entity_id}/{snapshot_id}.json`

**Index: DynamoDB**
* Fast lookup by snapshot ID
* Time-range queries
* GSI for entity + timestamp queries
* Table: `cc-native-snapshots-index`

**Audit: QLDB**
* Tamper-evident ledger
* Immutable audit trail
* Full decision → snapshot → evidence traceability

### 6.2 Storage Schema

**S3 Object:**
```
Key: snapshots/account/acme_corp/snap_20240115_143022_account_acme_corp_v1.json
Content: Full snapshot JSON (as defined above)
Metadata:
  - snapshot-id
  - entity-id
  - entity-type
  - timestamp
  - version
```

**DynamoDB Index:**
```typescript
{
  pk: 'ENTITY#account:acme_corp',
  sk: 'SNAPSHOT#2024-01-15T14:30:22.123Z#snap_20240115_143022_account_acme_corp_v1',
  snapshotId: 'snap_20240115_143022_account_acme_corp_v1',
  entityId: 'account:acme_corp',
  entityType: 'Account',
  timestamp: '2024-01-15T14:30:22.123Z',
  s3Key: 'snapshots/account/acme_corp/snap_20240115_143022_account_acme_corp_v1.json',
  version: '1.0',
  ttl: 2555  // 7 years (compliance requirement)
}
```

---

## 7. Snapshot Validation

### 7.1 Required Validations

**Before Decision Binding:**
1. Snapshot exists and is retrievable
2. All critical fields present (per registry)
3. Snapshot age within acceptable threshold
4. Snapshot version compatible with agent
5. Entity state complete and consistent

**Validation Checks:**
```typescript
async function validateSnapshotForDecision(
  snapshot: WorldSnapshot,
  agentVersion: string,
  maxAgeHours: number
): Promise<ValidationResult> {
  // Check snapshot exists
  if (!snapshot) {
    return { valid: false, error: 'Snapshot not found' };
  }
  
  // Check critical fields
  const registry = await getCriticalFields(snapshot.entityType, snapshot.metadata.registryVersion);
  const missingFields = registry
    .filter(f => f.isCritical)
    .filter(f => !snapshot.state[f.fieldName]);
  
  if (missingFields.length > 0) {
    return { 
      valid: false, 
      error: `Missing critical fields: ${missingFields.map(f => f.fieldName).join(', ')}` 
    };
  }
  
  // Check snapshot age
  const ageHours = (Date.now() - new Date(snapshot.timestamp).getTime()) / (1000 * 60 * 60);
  if (ageHours > maxAgeHours) {
    return { 
      valid: false, 
      error: `Snapshot too stale: ${ageHours.toFixed(1)} hours old` 
    };
  }
  
  // Check version compatibility
  if (!isVersionCompatible(snapshot.version, agentVersion)) {
    return { 
      valid: false, 
      error: `Version mismatch: snapshot ${snapshot.version} vs agent ${agentVersion}` 
    };
  }
  
  return { valid: true };
}
```

---

## 8. Decision-Snapshot Binding

### 8.1 Binding Contract

**Every Decision MUST Include:**
```typescript
interface Decision {
  decisionId: string;
  snapshotId: string;           // REQUIRED - binds to snapshot
  entityId: string;
  entityType: string;
  timestamp: string;
  
  // Decision data
  actionProposals: ActionProposal[];
  reasoning: string;
  confidence: number;
  
  // Snapshot reference
  snapshot: {
    snapshotId: string;
    timestamp: string;
    version: string;
    asOf: string;
  };
}
```

### 8.2 Invalid Decision Handling

**Decision Rejected If:**
* No `snapshotId` provided
* Snapshot not found
* Snapshot validation fails
* Snapshot too stale
* Snapshot missing critical fields

**Error Response:**
```json
{
  "error": "INVALID_DECISION",
  "reason": "Snapshot binding required",
  "details": {
    "snapshotId": "snap_20240115_143022_account_acme_corp_v1",
    "validationErrors": [
      "Missing critical field: renewalDate",
      "Snapshot too stale: 25 hours old"
    ]
  }
}
```

---

## 9. Audit Requirements

### 9.1 Required Audit Fields

**Every Snapshot Creation MUST Log:**
* Snapshot ID
* Entity ID
* Timestamp
* Created by (agent/system)
* Purpose
* Decision context (if applicable)

**Every Decision MUST Log:**
* Decision ID
* Snapshot ID (binding)
* Entity ID
* Timestamp
* Agent ID
* Action proposals
* Reasoning
* Confidence scores

### 9.2 Audit Trail

**Storage:**
* QLDB: Tamper-evident ledger
* S3: Immutable archive
* DynamoDB: Hot index for queries

**Query Pattern:**
```
// Get all decisions for a snapshot
GET /audit/snapshots/{snapshot_id}/decisions

// Get snapshot for a decision
GET /audit/decisions/{decision_id}/snapshot

// Get full trace: decision → snapshot → evidence
GET /audit/trace/{trace_id}
```

---

## 10. Time-Travel Queries

### 10.1 Point-in-Time Retrieval

**Query by Timestamp:**
```typescript
const snapshot = await worldModel.getSnapshot({
  entityId: 'account:acme_corp',
  asOf: '2024-01-10T10:00:00Z'  // Historical point in time
});
```

**Use Cases:**
* Audit: "What did we believe at the time of decision?"
* Debugging: "What was the state when this action was taken?"
* Compliance: "Show me the state as of this date"

### 10.2 Time-Travel Guarantees

**Read-Only:**
* Time-travel queries are read-only
* Cannot modify historical state
* Cannot create new snapshots for past times

**Reproducibility:**
* Same timestamp → same snapshot (deterministic)
* Computed from evidence up to that point
* No retroactive modifications

---

## 11. Snapshot Lifecycle

### 11.1 Creation

**Triggered By:**
* Agent decision request
* Scheduled state capture
* Manual snapshot request

**Process:**
1. Compute current state from evidence
2. Apply confidence calculations
3. Apply freshness decay
4. Check critical fields
5. Generate snapshot ID
6. Store in S3
7. Index in DynamoDB
8. Log in QLDB

### 11.2 Retention

**Retention Policy:**
* Active snapshots: 90 days (hot storage)
* Archived snapshots: 7 years (cold storage)
* Compliance snapshots: Indefinite (WORM)

**Cleanup:**
* Automatic TTL-based cleanup
* Manual archival for compliance
* Never delete snapshots referenced by decisions

---

## 12. Versioning

### 12.1 Snapshot Version

**Version Format:**
* Major.Minor (e.g., "1.0", "1.1", "2.0")
* Major: Breaking changes
* Minor: Backward compatible additions

**Version Compatibility:**
* Agents must support snapshot version they request
* Backward compatibility maintained for 2 major versions
* Migration path for version upgrades

### 12.2 Schema Evolution

**Breaking Changes:**
* Require major version bump
* Migration strategy required
* Deprecation period for old versions

**Non-Breaking Changes:**
* Minor version bump
* Backward compatible
* New fields optional

---

## 13. Failure Modes

### 13.1 Snapshot Creation Failure

**Behavior:** Decision blocked

**Error:** "Failed to create snapshot"

**Resolution:** Retry or escalate to human

---

### 13.2 Snapshot Retrieval Failure

**Behavior:** Decision blocked

**Error:** "Snapshot not found"

**Resolution:** Recreate snapshot or use latest

---

### 13.3 Snapshot Validation Failure

**Behavior:** Decision blocked

**Error:** "Snapshot validation failed"

**Resolution:** Fix snapshot or request new one

---

### 13.4 Stale Snapshot

**Behavior:** Decision blocked or autonomy reduced

**Error:** "Snapshot too stale"

**Resolution:** Request fresh snapshot

---

## 14. Best Practices

### 14.1 Snapshot Timing

**Best Practice:**
* Capture snapshot immediately before decision
* Don't reuse snapshots across decisions
* Each decision gets its own snapshot

**Anti-Pattern:**
* Reusing old snapshots
* Sharing snapshots across agents
* Caching snapshots for decisions

### 14.2 Snapshot Size

**Optimization:**
* Include only fields needed for decision
* Use field-level confidence filtering
* Compress large snapshots

**Limits:**
* Maximum snapshot size: 1 MB
* Maximum fields per snapshot: 100
* Maximum evidence refs per field: 50

---

## 15. Final Note

This contract ensures **every decision is traceable to a specific world state**.

**Key Guarantees:**
* Immutability: Snapshots never change
* Reproducibility: Can recreate from evidence
* Auditability: Full traceability chain
* Safety: Invalid decisions rejected

**This is the foundation of reversible autonomy.**
