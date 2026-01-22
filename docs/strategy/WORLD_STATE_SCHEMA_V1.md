# World State Schema v1.0

## 1. Purpose

This document defines the **canonical schema** for all entities in the World Model v1.0.

**Core Principle:**
> **Missing schema ⇒ Tier D (fail safe)**

If an entity or field is not defined in this schema, agents cannot make decisions about it. This enforces safety through explicit schema definition.

---

## 2. Version Information

**Schema Version:** 1.0

**Effective Date:** 2024-01-15

**Backward Compatibility:** Not applicable (initial version)

**Migration Strategy:** N/A (initial version)

---

## 3. Global Schema Rules

### 3.1 Field Metadata Requirements

**Every field MUST include:**
```typescript
interface FieldMetadata {
  value: any;                    // Field value (typed per field)
  confidence: number;            // [0, 1] confidence score
  freshness: number;             // Hours since last update
  contradiction: number;         // [0, 1] contradiction score
  provenanceTrust: TrustClass;   // Trust classification
  lastUpdated: string;           // ISO 8601 timestamp
  evidenceRefs: string[];        // References to evidence records
  ttl?: number;                  // Optional TTL override (hours)
  minConfidence?: number;        // Optional min confidence override
}
```

### 3.2 Confidence Rules

**Default Confidence Calculation:**
* Base confidence from source reliability
* Decay over time (deterministic function)
* Corroboration bonus (multiple sources)
* Contradiction penalty

**Field-Level Overrides:**
* `minConfidence`: Override minimum confidence threshold
* Applied per-field via critical field registry

### 3.3 Freshness Rules

**Default Freshness Thresholds:**
* Tier A: ≤ 24 hours
* Tier B: ≤ 72 hours
* Tier C: ≤ 168 hours (7 days)
* Tier D: > 168 hours

**Field-Level Overrides:**
* `ttl`: Override freshness TTL (hours)
* Applied per-field via critical field registry

### 3.4 Provenance Trust Classes

**Trust Hierarchy:**
1. **PRIMARY** - Direct system of record (confidence multiplier: 1.0)
2. **VERIFIED** - Verified by multiple sources (confidence multiplier: 0.95)
3. **DERIVED** - Computed from primary sources (confidence multiplier: 0.85)
4. **AGENT_INFERENCE** - Agent-generated inference (confidence multiplier: 0.60, max Tier C)
5. **UNTRUSTED** - Unverified sources (confidence multiplier: 0.30, Tier D only)

---

## 4. Required v1 Entity List

### 4.1 Tier A: Critical Revenue Entities (Must Have)

**Priority 1 - Revenue Core:**
1. **Account** - Customer account information
2. **Contract** - Contract and renewal data
3. **Opportunity** - Sales opportunities
4. **Renewal** - Renewal tracking and risk

**Priority 2 - Engagement:**
5. **Contact** - Person/contact information
6. **Meeting** - Meeting records and summaries
7. **Activity** - Sales activities and interactions

### 4.2 Tier B: Support & Usage (High Value)

8. **SupportCase** - Support tickets and escalations
9. **UsageSignal** - Product usage signals
10. **TelemetryAggregate** - Aggregated telemetry data

### 4.3 Tier C: Intelligence & Signals (Medium Value)

11. **NewsItem** - News and external signals
12. **WebSignal** - Web scraping and external data
13. **RelationshipEdge** - Organizational relationships

### 4.4 Tier D: System & Audit (Required for Operations)

14. **Decision** - Agent decisions
15. **Action** - Actions taken
16. **Approval** - Approval requests and responses
17. **AuditEvent** - Audit trail events
18. **Run** - System execution runs
19. **QualityCheck** - Quality validation results

---

## 5. Entity Schemas (Highest ROI First)

### 5.1 Contract / Renewal

**Entity: Contract**
```typescript
interface Contract {
  entityId: string;              // "contract:{contract_id}"
  entityType: "Contract";
  
  // Core Fields
  contractId: string;
  accountId: string;             // Reference to Account
  contractNumber: string;
  startDate: string;             // ISO 8601 date
  endDate: string;               // ISO 8601 date
  renewalDate: string;           // ISO 8601 date (CRITICAL)
  status: "active" | "expired" | "cancelled" | "pending";
  value: number;                 // Contract value (currency)
  currency: string;              // ISO currency code
  
  // Metadata
  createdAt: string;
  updatedAt: string;
  version: string;
}
```

**Entity: Renewal**
```typescript
interface Renewal {
  entityId: string;              // "renewal:{account_id}"
  entityType: "Renewal";
  
  // Core Fields
  accountId: string;             // Reference to Account
  contractId: string;             // Reference to Contract
  renewalDate: string;            // ISO 8601 date (CRITICAL)
  renewalWindowStart: string;     // ISO 8601 date
  renewalWindowEnd: string;       // ISO 8601 date
  riskLevel: "low" | "medium" | "high" | "critical";
  riskScore: number;             // [0, 1]
  healthScore: number;           // [0, 1]
  
  // Signals
  usageTrend: "increasing" | "stable" | "decreasing";
  supportEscalations: number;
  engagementScore: number;       // [0, 1]
  
  // Metadata
  lastAssessed: string;
  nextAssessment: string;
  version: string;
}
```

**Critical Fields:**
* Contract: `renewalDate`, `endDate`, `status`
* Renewal: `renewalDate`, `riskLevel`, `healthScore`

---

### 5.2 SupportCase

**Entity: SupportCase**
```typescript
interface SupportCase {
  entityId: string;              // "support_case:{case_id}"
  entityType: "SupportCase";
  
  // Core Fields
  caseId: string;
  accountId: string;             // Reference to Account
  contactId?: string;            // Reference to Contact
  caseNumber: string;
  subject: string;
  description: string;
  status: "open" | "in_progress" | "resolved" | "closed";
  priority: "low" | "medium" | "high" | "critical";
  severity: "sev1" | "sev2" | "sev3" | "sev4";
  
  // Timing
  openedAt: string;              // ISO 8601 timestamp
  resolvedAt?: string;           // ISO 8601 timestamp
  firstResponseAt?: string;      // ISO 8601 timestamp
  age: number;                   // Hours since opened
  slaStatus: "on_track" | "at_risk" | "breached";
  
  // Risk Indicators
  isEscalated: boolean;
  escalationLevel?: number;
  customerSatisfaction?: number; // [0, 1]
  
  // Metadata
  source: string;                // "zendesk", "salesforce", etc.
  tags: string[];
  version: string;
}
```

**Critical Fields:**
* `severity`, `status`, `age`, `isEscalated`

---

### 5.3 UsageSignal + TelemetryAggregate

**Entity: UsageSignal**
```typescript
interface UsageSignal {
  entityId: string;              // "usage_signal:{signal_id}"
  entityType: "UsageSignal";
  
  // Core Fields
  signalId: string;
  accountId: string;             // Reference to Account
  signalType: "feature_usage" | "login" | "api_call" | "data_volume" | "user_count";
  timestamp: string;             // ISO 8601 timestamp
  value: number;
  unit: string;                  // "count", "bytes", "hours", etc.
  
  // Context
  featureName?: string;
  userId?: string;
  sessionId?: string;
  
  // Metadata
  source: string;                // "product_telemetry", "api_logs", etc.
  version: string;
}
```

**Entity: TelemetryAggregate**
```typescript
interface TelemetryAggregate {
  entityId: string;              // "telemetry_agg:{account_id}:{period}"
  entityType: "TelemetryAggregate";
  
  // Core Fields
  accountId: string;             // Reference to Account
  period: string;                // "daily" | "weekly" | "monthly"
  periodStart: string;           // ISO 8601 date
  periodEnd: string;             // ISO 8601 date
  
  // Aggregated Metrics
  totalUsers: number;
  activeUsers: number;
  featureUsage: Record<string, number>;
  apiCalls: number;
  dataVolume: number;            // bytes
  loginCount: number;
  
  // Trends
  userTrend: "increasing" | "stable" | "decreasing";
  usageTrend: "increasing" | "stable" | "decreasing";
  engagementScore: number;       // [0, 1]
  
  // Metadata
  computedAt: string;
  version: string;
}
```

**Critical Fields:**
* UsageSignal: `signalType`, `value`, `timestamp`
* TelemetryAggregate: `activeUsers`, `engagementScore`, `usageTrend`

---

### 5.4 Meeting + Activity

**Entity: Meeting**
```typescript
interface Meeting {
  entityId: string;              // "meeting:{meeting_id}"
  entityType: "Meeting";
  
  // Core Fields
  meetingId: string;
  accountId: string;             // Reference to Account
  opportunityId?: string;        // Reference to Opportunity
  subject: string;
  description?: string;
  scheduledAt: string;            // ISO 8601 timestamp
  duration: number;              // Minutes
  status: "scheduled" | "completed" | "cancelled" | "no_show";
  
  // Participants
  organizerId: string;           // Reference to Contact
  attendees: string[];            // Array of Contact IDs
  internalAttendees: string[];   // Array of internal user IDs
  
  // Outcomes
  outcome?: string;
  notes?: string;
  actionItems?: string[];
  nextSteps?: string[];
  sentiment?: "positive" | "neutral" | "negative";
  
  // Metadata
  source: string;                // "calendar", "crm", etc.
  createdAt: string;
  updatedAt: string;
  version: string;
}
```

**Entity: Activity**
```typescript
interface Activity {
  entityId: string;              // "activity:{activity_id}"
  entityType: "Activity";
  
  // Core Fields
  activityId: string;
  accountId: string;             // Reference to Account
  contactId?: string;            // Reference to Contact
  opportunityId?: string;        // Reference to Opportunity
  activityType: "call" | "email" | "meeting" | "task" | "note" | "other";
  subject: string;
  description?: string;
  occurredAt: string;            // ISO 8601 timestamp
  
  // Direction
  direction: "inbound" | "outbound";
  
  // Outcomes
  outcome?: string;
  sentiment?: "positive" | "neutral" | "negative";
  
  // Metadata
  source: string;                // "crm", "email", "calendar", etc.
  createdBy: string;
  createdAt: string;
  version: string;
}
```

**Critical Fields:**
* Meeting: `scheduledAt`, `status`, `outcome`
* Activity: `activityType`, `occurredAt`, `direction`

---

### 5.5 NewsItem + WebSignal

**Entity: NewsItem**
```typescript
interface NewsItem {
  entityId: string;              // "news_item:{item_id}"
  entityType: "NewsItem";
  
  // Core Fields
  itemId: string;
  accountId?: string;            // Reference to Account (if account-specific)
  title: string;
  content: string;
  url: string;
  publishedAt: string;           // ISO 8601 timestamp
  source: string;                // News source name
  sourceUrl: string;
  
  // Classification
  category: "hiring" | "funding" | "product" | "partnership" | "executive_change" | "other";
  relevanceScore: number;        // [0, 1]
  sentiment: "positive" | "neutral" | "negative";
  
  // Metadata
  extractedAt: string;
  version: string;
}
```

**Entity: WebSignal**
```typescript
interface WebSignal {
  entityId: string;              // "web_signal:{signal_id}"
  entityType: "WebSignal";
  
  // Core Fields
  signalId: string;
  accountId?: string;            // Reference to Account
  signalType: "job_posting" | "news" | "social_media" | "website_change" | "other";
  title: string;
  content: string;
  url: string;
  detectedAt: string;            // ISO 8601 timestamp
  
  // Classification
  relevanceScore: number;        // [0, 1]
  confidence: number;            // [0, 1] - extraction confidence
  sentiment: "positive" | "neutral" | "negative";
  
  // Metadata
  source: string;                // "linkedin", "twitter", "company_website", etc.
  extractedBy: string;          // Extraction method/service
  version: string;
}
```

**Critical Fields:**
* NewsItem: `publishedAt`, `category`, `relevanceScore`
* WebSignal: `signalType`, `detectedAt`, `relevanceScore`

---

### 5.6 Decision + Action + Approval + AuditEvent + Run + QualityCheck

**Entity: Decision**
```typescript
interface Decision {
  entityId: string;              // "decision:{decision_id}"
  entityType: "Decision";
  
  // Core Fields
  decisionId: string;
  traceId: string;
  snapshotId: string;           // REQUIRED - binds to snapshot
  agentId: string;
  entityId: string;              // Entity this decision is about
  entityType: string;
  
  // Decision Data
  actionProposals: ActionProposal[];
  reasoning: string;
  confidence: number;            // [0, 1]
  tier: AutonomyTier;
  
  // Metadata
  timestamp: string;
  version: string;
}
```

**Entity: Action**
```typescript
interface Action {
  entityId: string;              // "action:{action_id}"
  entityType: "Action";
  
  // Core Fields
  actionId: string;
  decisionId: string;            // Reference to Decision
  traceId: string;
  actionType: string;
  description: string;
  status: "pending" | "approved" | "rejected" | "executed" | "failed";
  
  // Execution
  executedAt?: string;
  result?: any;
  error?: string;
  
  // Metadata
  createdAt: string;
  version: string;
}
```

**Entity: Approval**
```typescript
interface Approval {
  entityId: string;              // "approval:{approval_id}"
  entityType: "Approval";
  
  // Core Fields
  approvalId: string;
  actionId: string;             // Reference to Action
  decisionId: string;            // Reference to Decision
  requestedBy: string;           // Agent ID
  requestedAt: string;
  
  // Response
  status: "pending" | "approved" | "rejected";
  reviewedBy?: string;          // User ID
  reviewedAt?: string;
  reason?: string;
  
  // Metadata
  version: string;
}
```

**Entity: AuditEvent**
```typescript
interface AuditEvent {
  entityId: string;              // "audit_event:{event_id}"
  entityType: "AuditEvent";
  
  // Core Fields
  eventId: string;
  traceId: string;
  eventType: string;
  timestamp: string;
  
  // Context
  agentId?: string;
  userId?: string;
  entityId?: string;
  entityType?: string;
  
  // Data
  payload: Record<string, any>;
  
  // Metadata
  source: string;
  version: string;
}
```

**Entity: Run**
```typescript
interface Run {
  entityId: string;              // "run:{run_id}"
  entityType: "Run";
  
  // Core Fields
  runId: string;
  traceId: string;
  runType: "perception" | "decision" | "action" | "validation";
  status: "running" | "completed" | "failed" | "cancelled";
  
  // Timing
  startedAt: string;
  completedAt?: string;
  duration?: number;             // Milliseconds
  
  // Results
  result?: any;
  error?: string;
  
  // Metadata
  version: string;
}
```

**Entity: QualityCheck**
```typescript
interface QualityCheck {
  entityId: string;              // "quality_check:{check_id}"
  entityType: "QualityCheck";
  
  // Core Fields
  checkId: string;
  traceId: string;
  checkType: "freshness" | "confidence" | "contradiction" | "completeness";
  status: "pass" | "fail" | "warning";
  
  // Results
  score: number;                 // [0, 1]
  threshold: number;             // [0, 1]
  details: string;
  
  // Metadata
  checkedAt: string;
  version: string;
}
```

**Critical Fields:**
* Decision: `snapshotId`, `tier`, `confidence`
* Action: `status`, `actionType`
* Approval: `status`, `reviewedBy`
* AuditEvent: `eventType`, `timestamp`
* Run: `status`, `runType`
* QualityCheck: `status`, `score`

---

### 5.7 RelationshipEdge

**Entity: RelationshipEdge**
```typescript
interface RelationshipEdge {
  entityId: string;              // "relationship:{from_entity_id}:{to_entity_id}:{type}"
  entityType: "RelationshipEdge";
  
  // Core Fields
  fromEntityId: string;          // Source entity ID
  fromEntityType: string;
  toEntityId: string;            // Target entity ID
  toEntityType: string;
  relationshipType: "reports_to" | "works_with" | "influences" | "owns" | "manages" | "other";
  
  // Properties
  strength: number;               // [0, 1] relationship strength
  direction: "directed" | "undirected";
  metadata: Record<string, any>;
  
  // Metadata
  discoveredAt: string;
  lastVerified: string;
  confidence: number;            // [0, 1]
  version: string;
}
```

**Note on OrgChartNode:**
* OrgChartNode is **optional** and can be represented via RelationshipEdge pattern
* Use `relationshipType: "reports_to"` for org chart relationships
* Query pattern: `fromEntityType: "Contact" AND relationshipType: "reports_to"`

**Critical Fields:**
* `relationshipType`, `strength`, `confidence`

---

## 6. Split File Strategy

### 6.1 Directory Layout

```
docs/strategy/world-schema/
├── WORLD_STATE_SCHEMA_V1.md          # This file (overview + global rules)
├── entities/
│   ├── Account.md
│   ├── Contract.md
│   ├── Renewal.md
│   ├── Opportunity.md
│   ├── Contact.md
│   ├── SupportCase.md
│   ├── UsageSignal.md
│   ├── TelemetryAggregate.md
│   ├── Meeting.md
│   ├── Activity.md
│   ├── NewsItem.md
│   ├── WebSignal.md
│   ├── RelationshipEdge.md
│   ├── Decision.md
│   ├── Action.md
│   ├── Approval.md
│   ├── AuditEvent.md
│   ├── Run.md
│   └── QualityCheck.md
└── registry/
    └── critical-fields-v1.json       # Critical field registry
```

### 6.2 File Organization

**Main Schema File (`WORLD_STATE_SCHEMA_V1.md`):**
* Overview and global rules
* Entity list and priorities
* High-level entity summaries
* Links to detailed entity files

**Entity Files (`entities/*.md`):**
* Full field definitions
* Field-level metadata requirements
* Validation rules
* Example data
* Critical field annotations

**Registry File (`registry/critical-fields-v1.json`):**
* Machine-readable critical field definitions
* Used by agents for tier calculation
* Version controlled

---

## 7. Hard Rule: Missing Schema ⇒ Tier D

### 7.1 Enforcement

**Rule:**
> **If an entity or field is not defined in this schema, agents cannot make decisions about it. Result: Tier D (blocked).**

**Implementation:**
1. Agent requests entity state
2. System checks schema registry
3. Missing entity type → **Tier D**
4. Missing critical field → **Tier D**
5. Unknown field → Ignored (not critical) or **Tier D** (if critical)

### 7.2 Schema Registry Lookup

```typescript
async function validateEntitySchema(
  entityType: string,
  entityState: EntityState,
  schemaVersion: string
): Promise<ValidationResult> {
  // Check entity type exists
  const entitySchema = await getEntitySchema(entityType, schemaVersion);
  if (!entitySchema) {
    return {
      valid: false,
      tier: 'TIER_D',
      error: `Entity type ${entityType} not found in schema v${schemaVersion}`
    };
  }
  
  // Check critical fields
  const criticalFields = entitySchema.criticalFields || [];
  const missingFields = criticalFields.filter(
    field => !entityState.fields[field]
  );
  
  if (missingFields.length > 0) {
    return {
      valid: false,
      tier: 'TIER_D',
      error: `Missing critical fields: ${missingFields.join(', ')}`
    };
  }
  
  return { valid: true };
}
```

---

## 8. Schema Evolution

### 8.1 Versioning Strategy

**Version Format:** Major.Minor (e.g., "1.0", "1.1", "2.0")

**Major Version:**
* Breaking changes
* New required fields
* Field type changes
* Migration required

**Minor Version:**
* New optional fields
* New entity types
* Backward compatible
* No migration required

### 8.2 Change Process

**For Schema Changes:**
1. Propose change with rationale
2. Update schema documentation
3. Update critical field registry
4. Update golden test fixtures
5. Version bump
6. Migration plan (if major version)

---

## 9. Critical Field Registry

### 9.1 Registry Format

```json
{
  "version": "1.0",
  "entities": {
    "Contract": {
      "criticalFields": [
        {
          "fieldName": "renewalDate",
          "minConfidence": 0.90,
          "maxFreshnessHours": 12
        },
        {
          "fieldName": "endDate",
          "minConfidence": 0.85,
          "maxFreshnessHours": 24
        }
      ]
    },
    "Renewal": {
      "criticalFields": [
        {
          "fieldName": "renewalDate",
          "minConfidence": 0.90,
          "maxFreshnessHours": 12
        },
        {
          "fieldName": "riskLevel",
          "minConfidence": 0.85,
          "maxFreshnessHours": 24
        }
      ]
    }
  }
}
```

### 9.2 Registry Location

**Storage:**
* DynamoDB: `world_schema_registry` table
* S3: `registry/critical-fields-v1.json` (backup)
* Version controlled in repository

---

## 10. Final Note

This schema is the **canonical definition** of world state for v1.0.

**Key Guarantees:**
* Explicit schema = safe decisions
* Missing schema = Tier D (fail safe)
* Version controlled = reproducible
* Machine readable = enforceable

**This is the foundation of safe autonomy.**
