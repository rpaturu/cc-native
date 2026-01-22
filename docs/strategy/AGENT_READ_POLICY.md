# Agent Read Policy

## 1. Purpose

This document defines **exactly how confidence gates restrict agent behavior**. This is your **kill switch** for autonomous systems.

The policy makes safety **enforceable, not theoretical**.

---

## 2. Core Principle

> **Agents are consumers of world state, not co-authors of reality.**

All agent access to the World Model is:
* **Read-only**
* **Confidence-gated**
* **Snapshot-bound**
* **Auditable**

---

## 3. Autonomy Tiers

Agents are assigned to one of four autonomy tiers based on their **read policy scorecard**.

### 3.1 Tier A: Full Autonomy

**Threshold Requirements:**
* Confidence score ≥ 0.85
* Freshness ≤ 24 hours
* Contradiction score = 0
* Provenance trust class = PRIMARY or VERIFIED

**Allowed Actions:**
* All autonomous actions (within policy scope)
* No human approval required
* Can execute high-risk actions (if policy allows)

**Use Cases:**
* High-confidence, recent, uncontested data
* Critical path operations with verified sources

---

### 3.2 Tier B: Limited Autonomy

**Threshold Requirements:**
* Confidence score ≥ 0.70
* Freshness ≤ 72 hours
* Contradiction score ≤ 0.2
* Provenance trust class = PRIMARY, VERIFIED, or DERIVED

**Allowed Actions:**
* Low-risk autonomous actions
* Medium-risk actions require approval
* High-risk actions blocked

**Use Cases:**
* Moderate confidence with minor contradictions
* Stale but reliable data

---

### 3.3 Tier C: Supervised Autonomy

**Threshold Requirements:**
* Confidence score ≥ 0.50
* Freshness ≤ 168 hours (7 days)
* Contradiction score ≤ 0.4
* Provenance trust class = Any (including AGENT_INFERENCE)

**Allowed Actions:**
* Read-only analysis
* Draft generation (not execution)
* All actions require human approval
* No autonomous execution

**Use Cases:**
* Uncertain or contested data
* Agent-generated inferences
* Stale data requiring validation

---

### 3.4 Tier D: Blocked

**Threshold Requirements:**
* Confidence score < 0.50
* OR Freshness > 168 hours
* OR Contradiction score > 0.4
* OR Provenance trust class = UNTRUSTED

**Allowed Actions:**
* Read-only (for debugging/analysis)
* No actions allowed
* Escalation to human required

**Use Cases:**
* Low confidence data
* High contradiction
* Untrusted sources
* Stale data beyond threshold

---

## 4. Confidence Gating

### 4.1 Field-Level Confidence

Each field in world state has a confidence score in `[0, 1]`.

**Confidence Calculation:**
* Base confidence from source reliability
* Decay over time (deterministic function)
* Corroboration bonus (multiple sources agree)
* Contradiction penalty (conflicting evidence)

### 4.2 Aggregate Confidence

For entity-level decisions, use **minimum confidence** across all required fields.

**Example:**
```
Account entity:
  - accountName: confidence = 0.95
  - renewalDate: confidence = 0.60  ← MINIMUM
  - healthScore: confidence = 0.85

Aggregate confidence = 0.60 (Tier C)
```

---

## 5. Freshness Gating

### 5.1 Freshness Definition

Freshness = time since last evidence update for the field.

**Freshness Thresholds:**
* Tier A: ≤ 24 hours
* Tier B: ≤ 72 hours
* Tier C: ≤ 168 hours (7 days)
* Tier D: > 168 hours

### 5.2 Freshness Decay

Confidence decays with freshness using deterministic functions:

```
confidence_after_decay = base_confidence * decay_factor(freshness)
```

Decay functions MUST be:
* Deterministic
* Documented
* Consistent across entity types

---

## 6. Contradiction Gating

### 6.1 Contradiction Score

Contradiction score = measure of conflicting evidence for a field.

**Calculation:**
* Count of conflicting evidence records
* Weighted by recency and source trust
* Normalized to `[0, 1]` range

**Contradiction Thresholds:**
* Tier A: 0 (no contradictions)
* Tier B: ≤ 0.2 (minor contradictions)
* Tier C: ≤ 0.4 (moderate contradictions)
* Tier D: > 0.4 (high contradictions)

### 6.2 Contradiction Handling

When contradictions exist:
* State reflects weighted belief
* Contradiction metadata exposed
* Agents see both values with confidence scores
* Autonomy reduced accordingly

---

## 7. Provenance Trust Classes

### 7.1 Trust Class Hierarchy

**PRIMARY** (highest trust)
* Direct system of record (CRM, product telemetry)
* Confidence multiplier: 1.0
* No penalty

**VERIFIED**
* Verified by multiple sources
* Cross-referenced and validated
* Confidence multiplier: 0.95

**DERIVED**
* Computed from primary sources
* Deterministic derivation
* Confidence multiplier: 0.85

**AGENT_INFERENCE** (explicit penalty)
* Agent-generated inference
* Not ground truth
* Confidence multiplier: 0.60
* **Explicit penalty applied**

**UNTRUSTED**
* Unverified sources
* Low reliability
* Confidence multiplier: 0.30
* **Blocks Tier A/B autonomy**

### 7.2 Agent Inference Penalty

**Explicit Penalty for `AGENT_INFERENCE`:**

* Confidence reduced by 40% (multiplier: 0.60)
* Maximum tier: Tier C (supervised autonomy)
* Cannot achieve Tier A or Tier B
* Requires human approval for all actions

**Rationale:**
Agent inferences are not ground truth. They are hypotheses that must be validated.

---

## 8. Snapshot Binding Requirements

### 8.1 Snapshot Definition

A **snapshot** is an immutable, timestamped view of world state at a point in time.

**Snapshot MUST Include:**
* Entity state (all fields)
* Field-level confidence scores
* Freshness timestamps
* Contradiction metadata
* Provenance information
* Snapshot version ID
* Timestamp

### 8.2 Snapshot Binding Rule

> **Every agent decision MUST bind to a specific snapshot.**

**Decision Invalid Without Snapshot:**
* No snapshot = no valid decision
* Snapshot must be captured before decision
* Snapshot ID must be logged with decision
* Snapshot must be retrievable for audit

### 8.3 Snapshot Retrieval

Snapshots are:
* Immutable
* Versioned
* Time-travelable
* Auditable

**Query Pattern:**
```
GET /world-model/entities/{entity_id}/snapshots/{snapshot_id}
GET /world-model/entities/{entity_id}/snapshots?as_of={timestamp}
```

---

## 9. Deterministic Scorecard

### 9.1 Scorecard Calculation

The autonomy tier is determined by a **deterministic scorecard**:

```typescript
interface ReadPolicyScorecard {
  confidence: number;        // [0, 1]
  freshness: number;         // hours since last update
  contradiction: number;      // [0, 1]
  provenanceTrust: TrustClass;
}

function calculateTier(
  scorecard: ReadPolicyScorecard,
  criticalFields: CriticalFieldRegistry[],
  entityState: EntityState
): AutonomyTier {
  // Step 1: Check critical field registry (fail safe)
  if (!criticalFields || criticalFields.length === 0) {
    return 'TIER_D'; // Missing registry entry - fail safe
  }
  
  // Step 2: Verify all critical fields present in state
  const missingFields = criticalFields.filter(
    field => !entityState.fields[field.fieldName]
  );
  if (missingFields.length > 0) {
    return 'TIER_D'; // Missing critical fields - fail safe
  }
  
  // Step 3: Apply field-level overrides
  const overriddenScorecard = applyFieldOverrides(
    scorecard,
    criticalFields,
    entityState
  );
  
  // Step 4: Deterministic tier calculation
  if (overriddenScorecard.confidence < 0.50 || 
      overriddenScorecard.freshness > 168 || 
      overriddenScorecard.contradiction > 0.4 ||
      overriddenScorecard.provenanceTrust === 'UNTRUSTED') {
    return 'TIER_D';
  }
  
  if (overriddenScorecard.confidence >= 0.85 && 
      overriddenScorecard.freshness <= 24 && 
      overriddenScorecard.contradiction === 0 &&
      (overriddenScorecard.provenanceTrust === 'PRIMARY' || 
       overriddenScorecard.provenanceTrust === 'VERIFIED')) {
    return 'TIER_A';
  }
  
  if (overriddenScorecard.confidence >= 0.70 && 
      overriddenScorecard.freshness <= 72 && 
      overriddenScorecard.contradiction <= 0.2 &&
      overriddenScorecard.provenanceTrust !== 'UNTRUSTED') {
    return 'TIER_B';
  }
  
  return 'TIER_C';
}
```

### 9.2 Testability

The scorecard is **fully testable**:

* Same inputs → same tier
* No randomness
* No hidden state
* Deterministic functions only

**Test Example:**
```typescript
test('Tier A requires high confidence and freshness', () => {
  const scorecard = {
    confidence: 0.90,
    freshness: 12,
    contradiction: 0,
    provenanceTrust: 'PRIMARY'
  };
  const criticalFields = [
    { fieldName: 'accountName', isCritical: true, minConfidence: 0.85 }
  ];
  const entityState = {
    fields: {
      accountName: { value: 'Acme', confidence: 0.90, freshness: 12 }
    }
  };
  expect(calculateTier(scorecard, criticalFields, entityState)).toBe('TIER_A');
});
```

---

## 10. Critical Field Registry (System-Owned)

### 10.1 Registry Purpose

Agents **must** fetch critical fields from a versioned registry before making decisions.

**Registry Location:**
* DynamoDB table: `world_schema_registry`
* Versioned schema definitions
* System-owned (not agent-writable)

### 10.2 Registry Schema

```typescript
interface CriticalFieldRegistry {
  entityType: string;           // e.g., "Account", "Opportunity"
  fieldName: string;            // e.g., "renewalDate", "healthScore"
  version: string;               // Schema version (e.g., "1.0")
  isCritical: boolean;          // Required for tier calculation
  minConfidence?: number;        // Override minimum confidence (optional)
  maxFreshnessHours?: number;   // Override freshness TTL (optional)
  requiredForTier?: AutonomyTier[]; // Which tiers require this field
  createdAt: string;
  updatedAt: string;
}
```

### 10.3 Registry Lookup

**Before Tier Calculation:**
1. Agent requests entity state
2. System checks registry for critical fields
3. Missing registry entry → **Tier D** (fail safe)
4. Missing critical field in state → **Tier D** (fail safe)

**Lookup Pattern:**
```typescript
async function getCriticalFields(entityType: string, version: string): Promise<CriticalFieldRegistry[]> {
  const result = await dynamodb.query({
    TableName: 'world_schema_registry',
    KeyConditionExpression: 'entityType = :type AND version = :version',
    ExpressionAttributeValues: {
      ':type': entityType,
      ':version': version
    }
  });
  
  if (!result.Items || result.Items.length === 0) {
    throw new Error(`No registry entry for ${entityType} v${version} - fail safe to Tier D`);
  }
  
  return result.Items.filter(field => field.isCritical);
}
```

### 10.4 Fail-Safe Behavior

**Missing Registry Entry:**
* Behavior: **Immediate Tier D**
* Error: "Critical field registry entry not found"
* Rationale: Fail safe - if we don't know what's critical, assume worst case

**Missing Critical Field in State:**
* Behavior: **Tier D**
* Error: "Required critical field missing from state"
* Rationale: Cannot make safe decisions without required data

### 10.5 TTL and Min-Confidence Overrides

**Per-Field Overrides:**
* `minConfidence`: Override default confidence threshold for this field
* `maxFreshnessHours`: Override default freshness TTL for this field

**Example:**
```json
{
  "entityType": "Account",
  "fieldName": "renewalDate",
  "isCritical": true,
  "minConfidence": 0.90,        // Higher than default 0.85 for Tier A
  "maxFreshnessHours": 12,      // Stricter than default 24 hours
  "requiredForTier": ["TIER_A", "TIER_B"]
}
```

**Override Logic:**
```typescript
function applyFieldOverrides(
  field: CriticalFieldRegistry,
  defaultConfidence: number,
  defaultFreshness: number
): { confidence: number; freshness: number } {
  return {
    confidence: field.minConfidence ?? defaultConfidence,
    freshness: field.maxFreshnessHours ?? defaultFreshness
  };
}
```

---

## 11. Golden Test Fixtures (Non-Regression Harness)

### 11.1 Purpose

Deterministic test fixtures ensure tier selection logic remains stable and auditable.

**Storage:**
* Location: `tests/fixtures/agent_read_policy/`
* Format: JSON
* Version controlled

### 11.2 Fixture Structure

```typescript
interface GoldenTestFixture {
  name: string;                  // Descriptive test name
  version: string;               // Fixture version
  description: string;          // What this tests
  input: {
    entityType: string;
    fields: {
      [fieldName: string]: {
        value: any;
        confidence: number;
        freshness: number;      // hours
        contradiction: number;
        provenanceTrust: TrustClass;
      };
    };
    criticalFields: string[];    // Fields required from registry
  };
  expectedOutput: {
    tier: AutonomyTier;
    reason: string;             // Why this tier
    confidence: number;         // Aggregate confidence
    blockedFields?: string[];   // Fields that blocked higher tier
  };
}
```

### 11.3 Fixture Categories

**1. Threshold Boundaries**
* Tests exact threshold values (0.85, 0.70, 0.50)
* Tests boundary conditions (0.84 vs 0.85)
* Tests edge cases (0.0, 1.0)

**2. Contradictions**
* No contradictions (Tier A eligible)
* Minor contradictions (Tier B)
* Moderate contradictions (Tier C)
* High contradictions (Tier D)

**3. Provenance Mix**
* PRIMARY only (Tier A eligible)
* VERIFIED (Tier A eligible)
* DERIVED (Tier B max)
* AGENT_INFERENCE (Tier C max, explicit penalty)
* UNTRUSTED (Tier D)

**4. Missing Fields**
* All critical fields present
* One critical field missing (Tier D)
* Registry entry missing (Tier D)

**5. Freshness Decay**
* Fresh data (within 24h)
* Stale data (beyond thresholds)
* Decay calculations

### 11.4 Example Fixtures

**Fixture: `tier_a_high_confidence.json`**
```json
{
  "name": "Tier A - High Confidence Primary Source",
  "version": "1.0",
  "description": "Perfect conditions for Tier A autonomy",
  "input": {
    "entityType": "Account",
    "fields": {
      "accountName": {
        "value": "Acme Corp",
        "confidence": 0.95,
        "freshness": 12,
        "contradiction": 0,
        "provenanceTrust": "PRIMARY"
      },
      "renewalDate": {
        "value": "2024-12-31",
        "confidence": 0.90,
        "freshness": 6,
        "contradiction": 0,
        "provenanceTrust": "PRIMARY"
      }
    },
    "criticalFields": ["accountName", "renewalDate"]
  },
  "expectedOutput": {
    "tier": "TIER_A",
    "reason": "All fields meet Tier A thresholds",
    "confidence": 0.90,
    "blockedFields": []
  }
}
```

**Fixture: `tier_d_missing_registry.json`**
```json
{
  "name": "Tier D - Missing Registry Entry",
  "version": "1.0",
  "description": "Fail safe when registry entry not found",
  "input": {
    "entityType": "Account",
    "fields": {
      "accountName": {
        "value": "Acme Corp",
        "confidence": 0.95,
        "freshness": 12,
        "contradiction": 0,
        "provenanceTrust": "PRIMARY"
      }
    },
    "criticalFields": []  // Registry lookup failed
  },
  "expectedOutput": {
    "tier": "TIER_D",
    "reason": "Critical field registry entry not found - fail safe",
    "confidence": 0.0,
    "blockedFields": ["registry_lookup"]
  }
}
```

### 11.5 Test Execution

**Test Runner:**
```typescript
describe('Agent Read Policy - Golden Fixtures', () => {
  const fixtures = loadFixtures('tests/fixtures/agent_read_policy/');
  
  fixtures.forEach(fixture => {
    test(fixture.name, () => {
      const registry = getCriticalFields(fixture.input.entityType, '1.0');
      const scorecard = calculateScorecard(fixture.input, registry);
      const tier = calculateTier(scorecard);
      
      expect(tier).toBe(fixture.expectedOutput.tier);
      expect(scorecard.confidence).toBeCloseTo(fixture.expectedOutput.confidence, 2);
    });
  });
});
```

### 11.6 Hard Rule: Tier A Changes

**Critical Policy:**
> **Any change that increases Tier A outcomes requires:**
> 1. Explicit version bump
> 2. Reviewer approval
> 3. Updated golden fixtures
> 4. Migration plan

**Why:**
* Tier A = full autonomy
* Increasing Tier A = increasing risk
* Must be intentional and reviewed

**Change Process:**
1. Propose change with rationale
2. Update fixtures to reflect new behavior
3. Run regression tests (all fixtures must pass)
4. Get reviewer approval
5. Version bump (e.g., 1.0 → 1.1)
6. Document migration impact

**Example Change:**
```typescript
// BEFORE (v1.0)
if (scorecard.confidence >= 0.85 && ...) {
  return 'TIER_A';
}

// AFTER (v1.1) - Lowered threshold
if (scorecard.confidence >= 0.80 && ...) {  // Changed from 0.85
  return 'TIER_A';
}

// REQUIRED:
// 1. Version bump to 1.1
// 2. Update all affected fixtures
// 3. Reviewer approval
// 4. Migration plan for existing decisions
```

### 11.7 Fixture Maintenance

**When to Add Fixtures:**
* New entity types
* New field types
* Edge cases discovered
* Bug fixes

**When to Update Fixtures:**
* Policy changes (with version bump)
* Threshold adjustments
* Provenance class changes

**Fixture Validation:**
* All fixtures must be valid JSON
* All fixtures must have expected outputs
* All fixtures must be testable
* No duplicate test scenarios

---

## 12. Infrastructure Guardrails

### 10.1 Read-Only IAM Policies

**Agent IAM Policy:**
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "dynamodb:GetItem",
        "dynamodb:Query",
        "dynamodb:Scan"
      ],
      "Resource": [
        "arn:aws:dynamodb:*:*:table/cc-native-*"
      ],
      "Condition": {
        "StringEquals": {
          "dynamodb:ReadConsistency": "eventual"
        }
      }
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject"
      ],
      "Resource": [
        "arn:aws:s3:::cc-native-*/evidence/*",
        "arn:aws:s3:::cc-native-*/snapshots/*"
      ]
    },
    {
      "Effect": "Deny",
      "Action": [
        "dynamodb:PutItem",
        "dynamodb:UpdateItem",
        "dynamodb:DeleteItem",
        "s3:PutObject",
        "s3:DeleteObject"
      ],
      "Resource": "*"
    }
  ]
}
```

**Key Points:**
* Read-only access to DynamoDB
* Read-only access to S3 evidence/snapshots
* Explicit deny for write operations
* Eventual consistency for reads (performance)

---

### 10.2 Rate Limits

**Per-Agent Rate Limits:**
* Read operations: 1000 requests/minute
* Snapshot retrievals: 100 requests/minute
* Burst: 200 requests (token bucket)

**Enforcement:**
* API Gateway throttling
* DynamoDB on-demand capacity
* CloudWatch alarms on threshold breaches

---

### 10.3 Policy-as-Code

**Policy Enforcement:**
* OPA (Open Policy Agent) or Lambda policy engine
* Policy rules defined in code
* Version controlled
* Testable

**Policy Rules:**
```rego
package agent.read_policy

default allow = false

allow {
  input.action == "read"
  input.tier != "TIER_D"
  input.has_snapshot == true
}

deny {
  input.action == "write"
}

deny {
  input.tier == "TIER_D"
  input.action != "read_debug"
}
```

---

## 13. Enforcement Points

### 13.1 Pre-Read Validation

Before any read operation:
1. Fetch critical field registry for entity type
2. Verify registry entry exists (fail safe to Tier D if missing)
3. Verify all critical fields present in state (fail safe to Tier D if missing)
4. Calculate scorecard with field-level overrides
5. Determine tier
6. Check rate limits
7. Validate IAM permissions
8. Require snapshot binding

### 13.2 Post-Read Validation

After read operation:
1. Log snapshot ID
2. Log tier used
3. Log confidence scores
4. Audit trail entry

### 13.3 Action Gating

Before any action:
1. Verify snapshot binding
2. Check tier permissions
3. Validate confidence thresholds
4. Require approval if tier < B

---

## 14. Audit Requirements

### 12.1 Required Audit Fields

Every agent read MUST log:
* Agent ID
* Entity ID
* Snapshot ID
* Tier assigned
* Confidence scores
* Freshness
* Contradiction score
* Provenance trust class
* Timestamp
* Decision context

### 12.2 Audit Trail

Audit trail stored in:
* QLDB (tamper-evident ledger)
* S3 (immutable archive)
* DynamoDB (hot index for queries)

---

## 15. Failure Modes

### 13.1 Missing Snapshot

**Behavior:** Decision rejected

**Error:** "Decision requires snapshot binding"

**Resolution:** Agent must capture snapshot before decision

---

### 13.2 Low Confidence

**Behavior:** Autonomy reduced to Tier C or D

**Error:** "Confidence threshold not met"

**Resolution:** Escalate to human or wait for new evidence

---

### 13.3 High Contradiction

**Behavior:** Autonomy reduced to Tier C or D

**Error:** "Contradiction threshold exceeded"

**Resolution:** Human review required

---

### 15.4 Stale Data

**Behavior:** Autonomy reduced based on freshness

**Error:** "Data freshness threshold exceeded"

**Resolution:** Refresh data or reduce autonomy

---

### 15.5 Missing Critical Field Registry

**Behavior:** Immediate Tier D (fail safe)

**Error:** "Critical field registry entry not found"

**Resolution:** System administrator must add registry entry for entity type

---

### 15.6 Missing Critical Field in State

**Behavior:** Immediate Tier D (fail safe)

**Error:** "Required critical field missing from state"

**Resolution:** Ingest evidence for missing field or wait for state update

---

## 16. Versioning

This policy is versioned.

**Version:** 1.0

**Changes MUST:**
* Be backward compatible where possible
* Include migration strategy
* Update test cases
* Document rationale

---

## 17. Final Note

This policy makes safety **enforceable, not theoretical**.

Every agent action is:
* Gated by confidence
* Bound to snapshots
* Auditable
* Reversible

**This is your kill switch. Use it wisely.**
