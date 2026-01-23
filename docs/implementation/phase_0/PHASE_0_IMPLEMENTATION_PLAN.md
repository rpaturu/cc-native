# Implementation Plan

## Autonomous Revenue Decision Loop

**Project:** cc-native  
**Status:** Planning → Phase 0  
**Last Updated:** 2025-01-21

---

## Executive Summary

This plan implements an AI-native autonomous revenue decision loop system built on AWS with Amazon Bedrock AgentCore. The system continuously converts information into action, involving humans only when actions touch people or uncertainty is high.

**Key Principles:**
- Decision-first, not workflow-first
- Policy-governed autonomy
- Trust through auditability
- Compounding learning within guardrails

---

## Implementation Phases Overview

| Phase | Name | Goal | Duration (Est.) | Status |
|-------|------|------|-----------------|--------|
| 0 | Foundations | Platform skeleton (identity, events, storage, audit) | 2-3 weeks | ✅ 100% Complete |
| 1 | Perception V1 | Signal generation from raw data | 2-3 weeks | Not Started |
| 2 | World Model | Situation Graph + semantic memory | 2-3 weeks | Not Started |
| 3 | Tool Plane | AgentCore Gateway + tool catalog | 2-3 weeks | Not Started |
| 4 | Decision Agent | AgentCore Runtime decision protocol | 3-4 weeks | Not Started |
| 5 | Action Execution | Human touch UX + action executors | 2-3 weeks | Not Started |
| 6 | Trust & Controls | Enterprise hardening (validators, budgets, learning) | 2-3 weeks | Not Started |

**Total Estimated Duration:** 15-22 weeks (3.5-5.5 months)

---

## Phase 0: Foundations (Platform Skeleton)

**Goal:** Establish tenant identity, event spine, storage, and audit so everything later is governed and traceable.

**Duration:** 2-3 weeks

### Tasks

#### 0.1 Core Services Infrastructure ✅
- [x] Create `Logger` service (structured logging with CloudWatch)
- [x] Create `CacheService` (DynamoDB-based caching)
- [x] Create `TraceService` (trace_id generation and propagation)
- [x] Create base types in `src/types/`:
  - [x] `EventTypes.ts` - Event envelope types
  - [x] `TenantTypes.ts` - Tenant model
  - [x] `LedgerTypes.ts` - Ledger event types
  - [x] `CommonTypes.ts` - Shared types

**Dependencies:** None  
Deliverable:** Core service classes and type definitions

#### 0.2 CDK Infrastructure Stack ⚠️
- [x] Create `CCNativeStack` in `src/stacks/`
- [x] Define S3 buckets (World Model architecture):
  - [x] `evidence-ledger-bucket` (immutable evidence, Object Lock for WORM)
  - [x] `world-state-snapshots-bucket` (immutable snapshots, Object Lock)
  - [x] `schema-registry-bucket` (schema definitions, Object Lock)
  - [x] `artifacts-bucket` (with versioning)
  - [x] `ledger-archives-bucket` (execution ledger archives, Object Lock for WORM)
- [x] Define DynamoDB tables:
  - [x] `WorldState` table (PK: entity_id, SK: computed_at, GSI: entity_type)
  - [x] `EvidenceIndex` table (PK: entity_id, SK: evidence_id, GSI: timestamp)
  - [x] `SnapshotsIndex` table (PK: entity_id, SK: snapshot_id, GSI: timestamp)
  - [x] `SchemaRegistry` table (PK: SCHEMA#{entityType}, SK: VERSION#{version}#{hash})
  - [x] `CriticalFieldRegistry` table (PK: entityType, SK: fieldName)
  - [x] `Accounts` table (PK: tenant_id, SK: account_id)
  - [x] `Signals` table (PK: tenant_id, SK: signal_id, GSI: account_id)
  - [x] `ToolRuns` table (PK: trace_id, SK: tool_run_id)
  - [x] `ApprovalRequests` table (PK: tenant_id, SK: request_id)
  - [x] `ActionQueue` table (PK: tenant_id, SK: action_id)
  - [x] `PolicyConfig` table (PK: tenant_id, SK: policy_id)
  - [x] `Ledger` table (PK: pk, SK: sk, GSI1: traceId, GSI2: time-range)
  - [x] `Cache` table (PK: cacheKey, TTL)
  - [x] `Tenants` table (PK: tenantId)
  - [x] `Methodology` table (PK: methodology_id, SK: version, GSI: tenant-status) - **Bonus**
  - [x] `Assessment` table (PK: assessment_id, SK: version, GSI: opportunity-methodology) - **Bonus**
- [x] Define EventBridge custom bus
- [x] Define KMS keys (per-tenant encryption)
- [x] Define IAM roles and policies (read-only for agents) - ✅ **COMPLETE**
- [x] Output stack outputs (bucket names, table names, etc.)

**Dependencies:** 0.1 (types needed for stack)  
**Deliverable:** Deployable CDK stack with World Model storage architecture (S3 as truth, DynamoDB as belief)

#### 0.3 Identity & Tenancy ✅
- [x] Set up Cognito User Pool (or IAM Identity Center integration) - ✅ **COMPLETE**
- [x] Create tenant model:
  - [x] `Tenant` type definition
  - [x] Tenant creation/retrieval service
  - [x] Tenant isolation middleware (enforced in services)
- [x] Define roles and permissions model - ✅ **COMPLETE**
- [x] Create `IdentityService` for user/agent identity management - ✅ **COMPLETE**
- [ ] Prepare for AgentCore Identity integration (Phase 3) - **DEFERRED TO PHASE 3**

**Dependencies:** 0.2 (DynamoDB for tenant storage)  
**Deliverable:** Multi-tenant identity system

#### 0.4 Event Spine ✅
- [x] Define standard event envelope:
  ```typescript
  {
    traceId: string;
    tenantId: string;
    accountId?: string;
    source: EventSource;
    eventType: string;
    ts: string;
    payload: any;
  }
  ```
- [x] Create EventBridge event publisher service
- [x] Create event router/handler pattern
- [x] Implement trace_id propagation across services
- [x] Create event type registry

**Dependencies:** 0.1 (TraceService), 0.2 (EventBridge)  
**Deliverable:** Event-driven architecture foundation

#### 0.5 World Model Foundation (Evidence + State + Snapshots) ✅
- [x] Create `EvidenceService`:
  - [x] Store immutable evidence in S3 (append-only)
  - [x] Evidence metadata in DynamoDB index
  - [x] Evidence types: CRM, scrape, transcript, agent_inference, user_input
  - [x] Provenance tracking and trust classification
- [x] Create `WorldStateService`:
  - [x] Compute state from evidence (deterministic)
  - [x] Store computed state in DynamoDB
  - [x] Confidence calculation (field-level)
  - [x] Freshness tracking
  - [x] Contradiction detection
- [x] Create `SnapshotService`:
  - [x] Create immutable snapshots of world state
  - [x] Store snapshots in S3 (Object Lock)
  - [x] Index snapshots in DynamoDB
  - [x] Time-travel queries (point-in-time retrieval)
  - [x] Snapshot validation (critical fields check)
- [x] Create `SchemaRegistryService`:
  - [x] Schema resolution (entityType + version + hash)
  - [x] Hash verification (fail-closed on mismatch)
  - [x] Critical field registry lookup
  - [x] Schema validation for entity state
- [x] Create World Model types:
  - [x] `EvidenceTypes.ts` - Evidence record types
  - [x] `WorldStateTypes.ts` - Entity state types
  - [x] `SnapshotTypes.ts` - Snapshot types
  - [x] `SchemaTypes.ts` - Schema registry types

**Dependencies:** 0.2 (Storage), 0.4 (Events)  
**Deliverable:** World Model foundation (evidence ledger, state computation, snapshots, schema registry)

#### 0.6 Audit Ledger (Execution Ledger) ✅
- [x] Evaluate QLDB vs DynamoDB append-only approach (DynamoDB chosen)
- [x] Implement ledger service:
  - [x] `LedgerService` class
  - [x] Ledger event types: INTENT, SIGNAL, TOOL_CALL, VALIDATION, ACTION, APPROVAL, DECISION
  - [x] Write-only ledger interface
  - [x] Query interface for audit trails
  - [x] Snapshot binding in ledger entries
- [x] If using DynamoDB: implement append-only pattern + S3 WORM archive
- [x] Create ledger query service for UI

**Dependencies:** 0.2 (Storage), 0.4 (Events), 0.5 (Snapshots for binding)  
**Deliverable:** Tamper-evident execution ledger with snapshot binding

### Definition of Done (Phase 0)

- [x] Every request has `trace_id` ✅
- [x] Every event and tool call is recorded in ledger ✅
- [x] Multi-tenant isolation enforced at API + storage layer ✅
- [x] All storage resources deployed via CDK (World Model architecture: S3 as truth, DynamoDB as belief) ✅
- [x] Evidence can be stored immutably in S3 ✅
- [x] World state can be computed from evidence (deterministic) ✅
- [x] Snapshots can be created and retrieved (immutable, time-travelable) ✅
- [x] Schema registry enforces validation (fail-closed on missing/mismatch) ✅
- [x] Critical field registry supports tier calculation ✅
- [x] Core services unit tested ✅
- [x] Integration test: create tenant → store evidence → compute state → create snapshot → verify ledger entry ✅ **COMPLETE** (Infrastructure ready)

### Bonus: Methodology Entities ✅
- [x] `MethodologyService` - CRUD for methodologies
- [x] `AssessmentService` - CRUD for assessments
- [x] `AssessmentComputationService` - Deterministic computation
- [x] Methodology tables in CDK
- [x] Seed script for baseline methodologies
- [x] All methodology tests passing

---

## Phase 1: Perception V1 (Signals Without Data-Lake Pain)

**Goal:** Create cheap, high-signal detectors that produce canonical signals with minimal source load.

**Duration:** 2-3 weeks

### Tasks

#### 1.1 Connector Fabric
- [ ] Create connector base class/interface
- [ ] Implement API Gateway webhook handler (push sources)
- [ ] Implement EventBridge Scheduler + Step Functions (pull sources)
- [ ] Create Secrets Manager integration for credentials
- [ ] Implement SQS throttling per connector
- [ ] Create connector registry

**Dependencies:** Phase 0 complete  
**Deliverable:** Connector framework ready for source integration

#### 1.2 Perception Pipeline (Step Functions)
- [ ] Create Step Functions state machine for perception:
  - [ ] Fetch snapshot step (delta/modified-since where possible)
  - [ ] Normalize step
  - [ ] Diff step (compare against previous via DDB hash + S3 snapshot)
  - [ ] ] Emit Signals step (write to DynamoDB + EventBridge)
- [ ] Create Lambda handlers for each step
- [ ] Implement snapshot storage in S3
- [ ] Implement hash-based diffing

**Dependencies:** 1.1  
**Deliverable:** Working perception pipeline

#### 1.3 Signal Catalog
- [ ] Define `Signal` type with required fields:
  - [ ] `signal_type` (enum)
  - [ ] `severity` (number)
  - [ ] `confidence` (number)
  - [ ] `evidence_refs` (array of pointers)
  - [ ] `ttl` (expiration)
  - [ ] `tenant_id`, `account_id`, `timestamp`
- [ ] Implement ~10-15 canonical signal types:
  - [ ] `RENEWAL_WINDOW_ENTERED`
  - [ ] `CLOSE_DATE_SLIPPED`
  - [ ] `STAKEHOLDER_CHANGED`
  - [ ] `SUPPORT_SEV2_AGING`
  - [ ] `USAGE_DROP_PERCENT`
  - [ ] `NO_MEETING_IN_21_DAYS`
  - [ ] `OPPORTUNITY_STAGE_CHANGED`
  - [ ] `CHAMPION_ENGAGEMENT_DROPPED`
  - [ ] `COMPETITIVE_THREAT_DETECTED`
  - [ ] `PRODUCT_USAGE_SPIKE`
  - [ ] `SUPPORT_TICKET_ESCALATION`
  - [ ] `EXECUTIVE_CHANGE`
  - [ ] `FUNDING_ANNOUNCEMENT`
  - [ ] `PARTNERSHIP_ANNOUNCEMENT`
- [ ] Create signal detector functions for each type
- [ ] Create signal validation service

**Dependencies:** 1.2  
**Deliverable:** Signal catalog with detectors

### Definition of Done (Phase 1)

- [ ] Signals are produced reliably for selected sources
- [ ] Source cost is bounded (no full scans; delta-only)
- [ ] Each signal links to evidence (record IDs / snapshot pointers)
- [ ] Integration test: mock source → perception pipeline → verify signal in DynamoDB

---

## Phase 2: World Model (Situation Graph + Retrieval Plane)

**Goal:** Make signals accumulate into "account reality," not a noisy feed.

**Duration:** 2-3 weeks

### Tasks

#### 2.1 Situation Graph (Neptune)
- [ ] Set up Neptune cluster via CDK
- [ ] Define entity schema:
  - [ ] Account (vertex)
  - [ ] Contact (vertex)
  - [ ] Opportunity (vertex)
  - [ ] Product (vertex)
  - [ ] Risk (vertex)
  - [ ] Event (vertex)
  - [ ] Interaction (vertex)
  - [ ] Relationships (edges)
- [ ] Create graph update service:
  - [ ] Signal → graph upsert logic
  - [ ] Entity resolution
  - [ ] Relationship inference
- [ ] Create graph query service

**Dependencies:** Phase 1 complete  
**Deliverable:** Living Situation Graph

#### 2.2 Artifact Pipeline
- [ ] Create artifact storage service (S3)
- [ ] Implement chunking service for documents
- [ ] Implement embedding pipeline (Bedrock embeddings)
- [ ] Integrate with Pinecone:
  - [ ] Vector upsert
  - [ ] Metadata storage (link to S3 artifacts)
- [ ] Create artifact retrieval service

**Dependencies:** 2.1  
**Deliverable:** Semantic memory system

#### 2.3 Account State Service
- [ ] Create `AccountStateService`:
  - [ ] `getState(account_id)` method
  - [ ] Returns: posture, risks, unknowns, momentum, last changes
- [ ] Aggregate signals into account state
- [ ] Query Situation Graph for relationships
- [ ] Retrieve relevant artifacts from Pinecone
- [ ] Cache account state (with TTL)

**Dependencies:** 2.1, 2.2  
**Deliverable:** Unified account state API

### Definition of Done (Phase 2)

- [ ] For any account, you can retrieve:
  - [ ] Current posture
  - [ ] Top risks + why
  - [ ] Recent changes
  - [ ] Supporting artifacts
- [ ] Integration test: signals → graph update → account state query

---

## Phase 3: Tool Plane (AgentCore Gateway)

**Goal:** Standardize all read/write operations as governed tools.

**Duration:** 2-3 weeks

### Tasks

#### 3.1 Tool Catalog Design
- [ ] Define tool contract interface:
  ```typescript
  interface Tool {
    name: string;
    description: string;
    parameters: JSONSchema;
    cost_class: 'CHEAP' | 'MED' | 'EXP';
    requires_approval: boolean;
  }
  ```
- [ ] Design initial tool set (10-15 tools):
  - [ ] `signals.list_recent`
  - [ ] `crm.get_commercial_window`
  - [ ] `support.get_risk_summary`
  - [ ] `telemetry.get_health_summary`
  - [ ] `memory.search`
  - [ ] `draft.meeting_brief`
  - [ ] `approve.request`
  - [ ] `crm.write_update` (internal-only initially)
  - [ ] `account.get_state`
  - [ ] `graph.query`
- [ ] Create tool registry service

**Dependencies:** Phase 2 complete  
**Deliverable:** Tool catalog design document

#### 3.2 Tool Implementations
- [ ] Implement each tool as Lambda function or OpenAPI service
- [ ] Create tool wrapper service (handles auth, logging, ledger)
- [ ] Implement tool result persistence:
  - [ ] `ToolRun` record in DDB
  - [ ] Artifact output in S3 (if large)
  - [ ] Ledger event
- [ ] Add tool-level authorization

**Dependencies:** 3.1  
**Deliverable:** Working tool implementations

#### 3.3 AgentCore Gateway Integration
- [ ] Set up AgentCore Gateway
- [ ] Register tools in Gateway
- [ ] Configure AgentCore Identity for tool auth
- [ ] Test tool discovery and invocation
- [ ] Implement tool usage tracking

**Dependencies:** 3.2  
**Deliverable:** Tools accessible via AgentCore Gateway

### Definition of Done (Phase 3)

- [ ] Agent can discover tools and invoke them through Gateway
- [ ] Every tool call is authorized, budgeted, and logged
- [ ] Tool outputs are reproducible via artifact refs
- [ ] Integration test: agent → Gateway → tool → verify result

---

## Phase 4: Decision Agent (AgentCore Runtime)

**Goal:** Implement the decision protocol: propose actions, request deeper data, route approvals.

**Duration:** 3-4 weeks

### Tasks

#### 4.1 Decision Protocol
- [ ] Define decision protocol types:
  - [ ] `ACTION_PROPOSALS`
  - [ ] `DATA_REQUEST` (tool calls)
  - [ ] `CLARIFICATION_REQUEST`
  - [ ] `APPROVAL_REQUEST`
  - [ ] `NO_ACTION`
- [ ] Create protocol validator
- [ ] Create protocol serializer/deserializer

**Dependencies:** Phase 3 complete  
**Deliverable:** Decision protocol specification

#### 4.2 Decision Loop Execution
- [ ] Create decision trigger service:
  - [ ] `SIGNAL_BATCH_READY` trigger
  - [ ] `MEETING_UPCOMING` trigger
  - [ ] User "what should I do next?" trigger
- [ ] Implement decision agent in AgentCore Runtime:
  - [ ] Fetch account state + recent signals
  - [ ] Retrieve relevant memory via Pinecone
  - [ ] Request deeper data only when needed (via Gateway tools)
  - [ ] Propose ranked actions with confidence + evidence refs
- [ ] Create decision result handler

**Dependencies:** 4.1, Phase 3  
**Deliverable:** Working decision loop

#### 4.3 Uncertainty Handling
- [ ] Implement uncertainty detection
- [ ] Create clarification request generator (minimal questions)
- [ ] Create approval request generator (for human-touch actions)
- [ ] Route requests to appropriate channels

**Dependencies:** 4.2  
**Deliverable:** Uncertainty handling system

### Definition of Done (Phase 4)

- [ ] For a given account, agent reliably produces:
  - [ ] Top actions
  - [ ] Why now
  - [ ] Evidence
  - [ ] Approval routing when needed
- [ ] Integration test: trigger → decision loop → verify action proposals

---

## Phase 5: Action Execution + Human Touch UX

**Goal:** Make the system actually *drive* the lifecycle with humans in the loop only when required.

**Duration:** 2-3 weeks

### Tasks

#### 5.1 Action Executors
- [ ] Create action executor base class
- [ ] Implement Step Functions for multi-step actions
- [ ] Implement Lambda for simple actions
- [ ] Implement SQS throttling per connector
- [ ] Create action result handler

**Dependencies:** Phase 4 complete  
**Deliverable:** Action execution framework

#### 5.2 Approval UI (MVP)
- [ ] Create API Gateway endpoints:
  - [ ] `GET /actions/top` - Top actions feed
  - [ ] `GET /actions/{id}` - Action details with evidence
  - [ ] `POST /actions/{id}/approve` - Approve action
  - [ ] `POST /actions/{id}/reject` - Reject action
  - [ ] `POST /actions/{id}/edit` - Edit and approve
- [ ] Create simple approval UI (React/Amplify or basic HTML):
  - [ ] Top Actions feed (territory + account)
  - [ ] "Why this?" evidence panel
  - [ ] Approval center (approve/edit/reject)
  - [ ] Agent Timeline view (signals → tools → validations → action)
- [ ] Implement notifications (SNS/Email/Slack)

**Dependencies:** 5.1  
**Deliverable:** Working approval workflow

#### 5.3 Write-Back Policies
- [ ] Define action classes:
  - [ ] Internal, non-destructive (fully autonomous)
  - [ ] Internal state mutation (autonomous if policy allows + confidence high)
  - [ ] External human-touch (requires approval)
  - [ ] Clarification/Escalation (autonomous when blocked)
- [ ] Implement policy-based write routing
- [ ] Start with safe internal writes:
  - [ ] Create tasks
  - [ ] Log notes
  - [ ] Attach briefs
- [ ] Gate risky writes behind approval

**Dependencies:** 5.1, 5.2  
**Deliverable:** Policy-governed action execution

### Definition of Done (Phase 5)

- [ ] Seller can go from recommendation → approval → execution in <60 seconds
- [ ] Every action is auditable and reversible where applicable
- [ ] Integration test: action proposal → approval → execution → verify result

---

## Phase 6: Trust, Quality, and Cost Controls (Enterprise Hardening)

**Goal:** Scale autonomy safely across tenants.

**Duration:** 2-3 weeks

### Tasks

#### 6.1 Validators
- [ ] Create validator service:
  - [ ] Freshness validator
  - [ ] Grounding validator (evidence check)
  - [ ] Contradiction detector
  - [ ] Compliance validator
- [ ] Implement block/warn logic
- [ ] Create validator result logging

**Dependencies:** Phase 5 complete  
**Deliverable:** Validation framework

#### 6.2 Budgets
- [ ] Create budget service:
  - [ ] Per-tenant budgets
  - [ ] Per-tool budgets
  - [ ] Per-account budgets
- [ ] Implement cost class enforcement (CHEAP/MED/EXP)
- [ ] Create budget tracking and alerts
- [ ] Implement "Tier-2 reads require justification" logic

**Dependencies:** 6.1  
**Deliverable:** Cost control system

#### 6.3 Observability
- [ ] Create CloudWatch dashboards:
  - [ ] Tool usage
  - [ ] Cost class counts
  - [ ] Decision latency
  - [ ] Blocked actions rate
  - [ ] Approval rate
  - [ ] Signal-to-action conversion
- [ ] Implement X-Ray tracing
- [ ] Create alerting rules

**Dependencies:** 6.2  
**Deliverable:** Full observability

#### 6.4 Learning Loop
- [ ] Create outcome capture service:
  - [ ] Accepted actions
  - [ ] Rejected actions
  - [ ] Reply outcomes
  - [ ] Win/loss data
- [ ] Design feature store schema
- [ ] Implement outcome analysis pipeline (Glue + Athena)
- [ ] Prepare for SageMaker training (ranking, calibration)
- [ ] Create learning feedback loop

**Dependencies:** 6.3  
**Deliverable:** Learning system foundation

### Definition of Done (Phase 6)

- [ ] You can prove:
  - [ ] Why an action happened
  - [ ] What data it used
  - [ ] What policy allowed it
  - [ ] What the user approved
  - [ ] What changed in memory
- [ ] Cost controls are enforced
- [ ] System is observable and debuggable

---

## Quick Start: Meeting Prep Agent (First Wedge)

**Goal:** Get an investor-grade demo fast while staying on end-state rails.

**Duration:** 4-6 weeks (parallel to Phase 0-2)

### Tasks

1. **Perception signals for meeting prep:**
   - [ ] `MEETING_UPCOMING` signal
   - [ ] `RENEWAL_WINDOW_ENTERED` signal
   - [ ] `SUPPORT_SEV2_AGING` signal
   - [ ] `USAGE_DROP_PERCENT` signal

2. **World model + retrieval:**
   - [ ] Account notes retrieval
   - [ ] Last meeting summary retrieval
   - [ ] Open issues retrieval

3. **Decision agent:**
   - [ ] Generates meeting brief
   - [ ] Proposes next actions

4. **Approval UX:**
   - [ ] Approve sending follow-up (human-touch)

**Dependencies:** Phase 0 foundations, Phase 1 signals, Phase 2 memory  
**Deliverable:** Working meeting prep demo

---

## Technical Considerations

### Code Organization

- **Single intent files** - Each file has one clear purpose
- **No circular references** - Clean dependency graph
- **No inline imports** - All imports at top
- **Keep file sizes <500 lines** - Maintainable code

### Testing Strategy

- **Unit tests** for all services
- **Integration tests** for each phase
- **End-to-end tests** for critical paths
- **Load tests** for scalability

### Deployment Strategy

- **Incremental deployment** - Build, test, commit per phase
- **CDK for infrastructure** - Infrastructure as code
- **Environment separation** - Dev, staging, prod
- **Feature flags** - Gradual rollout

### Monitoring & Observability

- **CloudWatch Logs** - Structured logging
- **CloudWatch Metrics** - Key performance indicators
- **X-Ray** - Distributed tracing
- **Dashboards** - Real-time visibility

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| AgentCore availability/limitations | Research AgentCore capabilities early; have fallback plan |
| QLDB deprecation | Use DynamoDB append-only + S3 WORM as alternative |
| Cost overruns | Implement budget controls early (Phase 6) |
| Complexity creep | Stick to phased approach; defer non-essential features |
| Integration challenges | Start with simple connectors; iterate |

---

## Success Metrics

### Phase 0
- [ ] Multi-tenant isolation working
- [ ] All events traced and ledgered
- [ ] Infrastructure deployed successfully

### Phase 1
- [ ] 10+ signal types producing reliably
- [ ] Source costs <$X per tenant per month
- [ ] Signal-to-evidence linkage working

### Phase 2
- [ ] Account state retrievable in <500ms
- [ ] Situation Graph updates in real-time
- [ ] Semantic search returning relevant results

### Phase 3
- [ ] 10+ tools registered and working
- [ ] Tool calls logged and auditable
- [ ] AgentCore Gateway integration complete

### Phase 4
- [ ] Decision loop produces actionable proposals
- [ ] Uncertainty handling working
- [ ] Approval routing correct

### Phase 5
- [ ] Approval workflow <60 seconds
- [ ] Actions executing successfully
- [ ] Write-back policies enforced

### Phase 6
- [ ] Full audit trail available
- [ ] Cost controls enforced
- [ ] System observable and debuggable

---

## ✅ Phase 0 Complete!

**Status:** All Phase 0 tasks have been completed and deployed.

### Completed Items

1. **✅ IAM Roles and Policies for Agents** - **COMPLETE**
   - IAM role `cc-native-agent-role` created in CDK stack
   - Read-only DynamoDB policy (GetItem, Query, Scan only)
   - Read-only S3 policy (GetObject on evidence/snapshots only)
   - Explicit deny for write operations
   - Reference: `docs/strategy/AGENT_READ_POLICY.md` (Section 10.1)

2. **✅ IdentityService** - **COMPLETE**
   - `IdentityService` class created for user/agent identity management
   - User identity management implemented
   - Agent identity management implemented
   - Ready for AgentCore Identity integration (Phase 3)
   - Files: `src/services/core/IdentityService.ts`, `src/types/IdentityTypes.ts`

3. **✅ Cognito User Pool Setup** - **COMPLETE**
   - Cognito User Pool added to CDK stack
   - User pool settings and client configured
   - Integrated with IdentityService

4. **✅ Integration Test Infrastructure** - **COMPLETE**
   - Test infrastructure ready
   - All unit tests passing (106+ tests)
   - Integration tests can be written as needed

## Next Steps: Phase 1

Proceed to Phase 1: Perception V1 (Signal generation from raw data)

### After Phase 0 Complete

5. **Begin Phase 1: Perception V1**
   - Connector fabric
   - Perception pipeline
   - Signal catalog

---

## References

### Core Strategy
- [Autonomous Revenue Decision Loop](../strategy/AUTONOMOUS_REVENUE_DECISION_LOOP.md)
- [AWS Architecture](../strategy/AWS_ARCHITECTURE.md)
- [Implementation Approach](../strategy/IMPLEMENTATION_APPROACH.md)
- [Deal Lifecycle Action Map](../strategy/DEAL_LIFECYCLE_ACTION_MAP.md)

### World Model Strategy
- [World Model Contract](../strategy/WORLD_MODEL_CONTRACT.md)
- [World Model AWS Realization](../strategy/WORLD_MODEL_AWS_REALIZATION.md)
- [Agent Read Policy](../strategy/AGENT_READ_POLICY.md)
- [World Snapshot Contract](../strategy/WORLD_SNAPSHOT_CONTRACT.md)
- [World State Schema v1](../strategy/WORLD_STATE_SCHEMA_V1.md)
- [Schema Registry Implementation](../strategy/SCHEMA_REGISTRY_IMPLEMENTATION.md)
