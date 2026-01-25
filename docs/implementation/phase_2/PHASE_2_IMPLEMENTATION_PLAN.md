# Phase 2 — Situation Graph + Deterministic Synthesis

**Status:** ✅ **IMPLEMENTATION COMPLETE** | ✅ **INTEGRATION TESTS PASSING**  
**Prerequisites:** Phase 0 ✅ Complete | Phase 1 ✅ Complete  
**Dependencies:** Phase 0 + Phase 1 are implemented and certified (event envelope, immutable evidence, append-only ledger, canonical signals + lifecycle inference).

**Last Updated:** 2026-01-25  
**Integration Tests:** ✅ All 4 Phase 2 integration tests passing on EC2 instance with Neptune connectivity

---

## Phase Objective

Phase 2 turns Phase 1 outputs (Signals, EvidenceSnapshotRefs, AccountState) into:

1. **Situation Graph** (Neptune) — a durable, queryable representation of account reality and why it changed.
2. **Deterministic Synthesis** — a versioned ruleset that derives:
   - `AccountPostureState` (OK/WATCH/AT_RISK/EXPAND/DORMANT)
   - `RiskFactors[]`
   - `Opportunities[]`
   - `Unknowns[]`
3. **Hot read models** (DynamoDB) for fast UI/agent reads (no graph queries required for most use cases).
4. **Replayability** — given the same active signals + ruleset version, outputs are identical.

**Non-goals (explicit):**
- No autonomous execution/actions
- No LLM-driven synthesis for posture/risk (optional bounded summaries are allowed as artifacts only)
- No ranking/learning loop (that's Phase 6)

---

## Deliverables (Phase 2 Outputs)

### 1.1 Neptune Situation Graph (MVP)
- Vertex labels:
  - `Tenant`, `Account`, `Signal`, `EvidenceSnapshot`, `Posture`, `RiskFactor`, `OpportunitySignal`, `Unknown`, `Artifact` (optional in 2.2)
- Edge labels:
  - `HAS_SIGNAL` (Account→Signal)
  - `SUPPORTED_BY` (Signal→EvidenceSnapshot)
  - `HAS_POSTURE` (Account→Posture)
  - `IMPLIES_RISK` (Posture→RiskFactor)
  - `IMPLIES_OPPORTUNITY` (Posture→OpportunitySignal)
  - `HAS_UNKNOWN` (Account→Unknown)

### 1.2 Read Models (DynamoDB)
- `AccountPostureState` (primary)
- Optional: `AccountTimelineIndex` (defer if not needed)

### 1.3 Pipelines
- `Phase2GraphMaterializer` (Step Functions)
- `Phase2SynthesisEngine` (Step Functions)

### 1.4 Rules
- `synthesis/rules/v1.yaml` (versioned)
- `SYNTHESIS_RULESET_VERSION` is recorded in outputs + ledger

### 1.5 Minimal APIs (internal)
- `GET /accounts/{account_id}/posture`
- `GET /accounts/{account_id}/signals?active=true`
- Optional: `GET /accounts/{account_id}/unknowns`

### 1.6 Observability
- CloudWatch dashboards + alarms for:
  - materialization errors
  - synthesis errors
  - posture churn rate
  - unknowns count
  - rule trigger counts

---

## Epics and Stories

## EPIC 2.1 — Neptune Graph Foundation (Schema + Access)

### Story 2.1.1 — Provision Neptune + network access
**Tasks**
- Create Neptune cluster (dev/stage)
- VPC/subnets/security groups
- IAM roles for Step Functions/Lambda to access Neptune
- Add connection test utility (health check)
- **Lock query language: Gremlin only** (not OpenCypher)

**Acceptance criteria**
- CI/CD can deploy Neptune infra
- A service identity can run a simple Gremlin query successfully
- Connectivity is private (VPC-only)
- Gremlin is documented as the authoritative query language

---

### Story 2.1.2 — Define graph conventions (IDs, partitioning, upsert policy)
**Tasks**
- Define canonical vertex ID scheme:
  - `TENANT#{tenant_id}#ACCOUNT#{account_id}`
  - `SIGNAL#{signal_id}` (use signal_id directly, not dedupeKey)
  - `EVIDENCE_SNAPSHOT#{evidence_snapshot_id}`
  - `POSTURE#{tenant_id}#{account_id}#{posture_id}`
  - `RISK_FACTOR#{risk_factor_id}`
  - `UNKNOWN#{unknown_id}`
- **Signal Identity Rule:** 
  - Vertex ID = `SIGNAL#{signal_id}` (from Phase 1 signal record)
  - `dedupeKey` stored as a **property**, not used for vertex identity
  - This prevents accidental graph collapse when signals look similar
- Define required properties: `tenant_id`, `entity_type`, `created_at`, `updated_at`, `schema_version`
- Define idempotent upsert patterns (vertex + edge) using Gremlin
- Document Gremlin query patterns for all operations

**Acceptance criteria**
- A written `GRAPH_CONVENTIONS.md` exists and is followed by materializer code
- Upserts are idempotent under retries
- Signal vertex identity is clearly separated from dedupeKey
- All query patterns use Gremlin (no OpenCypher)

---

## EPIC 2.2 — Graph Materialization Pipeline (Signals → Graph)

### Story 2.2.1 — Implement `Phase2GraphMaterializer` state machine
**Input event**
- `SIGNAL_DETECTED` or `SIGNAL_CREATED` (from Phase 1 EventBridge)

**Steps**
1. Load signal by ID (DDB)
2. Validate schema + versions
3. Ensure Account vertex exists
4. Upsert Signal vertex
5. Upsert EvidenceSnapshot vertex from `EvidenceSnapshotRef`
6. Create edges:
   - Account `HAS_SIGNAL` Signal
   - Signal `SUPPORTED_BY` EvidenceSnapshot
7. Emit ledger events: `GRAPH_UPSERTED`, `GRAPH_EDGE_CREATED`

**Acceptance criteria**
- For every emitted signal, the graph contains:
  - Account node
  - Signal node
  - EvidenceSnapshot node
  - Correct edges
- Replaying the same event produces no duplicates
- Ledger records the materialization with the same `trace_id`
- **Failure Semantics Rule:** If graph materialization partially succeeds, synthesis MUST NOT run
  - Enforce via ledger gate or `graph_materialized=true` flag per signal
  - Prevents "phantom posture updates" without full evidence linkage

**Note:** Phase 1 emits `SIGNAL_DETECTED` and `SIGNAL_CREATED` events. The materializer should listen to these events via EventBridge.

---

### Story 2.2.2 — Backfill job (Phase 1 signals → graph)
**Tasks**
- Build a one-time backfill Step Functions workflow:
  - iterate through existing signals by tenant/account/time
  - feed into materializer
- Use checkpointing to resume if interrupted

**Acceptance criteria**
- Backfill can run for a tenant without timeouts
- Backfill is resumable and idempotent
- Post-run: graph node/edge counts match expectation for sample accounts

---

## EPIC 2.3 — AccountPostureState Read Model (DynamoDB)

### Story 2.3.1 — Create `AccountPostureState` table and schema
**Attributes**
- `posture`: `OK|WATCH|AT_RISK|EXPAND|DORMANT`
- `momentum`: `UP|FLAT|DOWN`
- `risk_factors[]`, `opportunities[]`, `unknowns[]`
- `active_signals[]` (top K)
- `evidence_refs[]` (top K)
- `ruleset_version`, `schema_version`, `active_signals_hash`

**Acceptance criteria**
- Table exists with correct keys and GSIs (if needed)
- Write pattern supports idempotent upserts

---

### Story 2.3.2 — Implement `account.get_posture_state(account_id)` service function
**Tasks**
- Add a small library/service that:
  - reads posture state
  - returns a stable DTO used by UI and later Phase 3 agents

**Acceptance criteria**
- Returns posture state within low latency (single DDB read)
- Missing posture state returns a typed "not ready" response

---

## EPIC 2.4 — Deterministic Synthesis Engine (Ruleset + Execution)

### Story 2.4.1 — Define synthesis output contracts
**Tasks**
- Create versioned schemas:
  - `PostureStateV1`
  - `RiskFactorV1`
  - `UnknownV1` (must include TTL semantics: `introduced_at`, `expires_at` OR `review_after`)
- Define rule trigger metadata:
  - `rule_id`, `ruleset_version`, `inputs_hash`
- **Unknowns TTL Requirement:** Every `UnknownV1` must have:
  - `introduced_at: string` (ISO timestamp)
  - `expires_at: string | null` OR `review_after: string` (ISO timestamp)
  - Prevents Unknowns from accumulating indefinitely

**Acceptance criteria**
- Schemas are enforced at runtime (fail-closed)
- Output includes `ruleset_version` and input references
- Unknowns schema includes TTL semantics

---

### Story 2.4.2 — Implement `synthesis/rules/v1.yaml`
**Scope**
- Cover lifecycle stages:
  - PROSPECT: activation + no engagement → WATCH
  - SUSPECT: first engagement → WATCH, stalled → AT_RISK (or WATCH with risk factor)
  - CUSTOMER: renewal window + usage/support → AT_RISK; strong usage → EXPAND

**Acceptance criteria**
- Ruleset includes: `rule_id`, `conditions`, `outputs`, `priority`, `ttl` (where applicable)
- Rule evaluation is deterministic and order-stable

---

### Story 2.4.3 — Implement `Phase2SynthesisEngine` state machine
**Trigger**
- `SIGNAL_DETECTED` and/or scheduled consolidation (hourly)

**Steps**
1. Load active signals for account (apply TTL, suppression)
2. Load AccountState (lifecycle)
3. Evaluate ruleset
4. Write `AccountPostureState` (DDB)
5. Upsert Posture/Risk/Unknown vertices + edges in Neptune
6. Emit ledger events: `POSTURE_UPDATED`, `RISK_FACTOR_EMITTED`, `UNKNOWN_EMITTED`

**Idempotency key**
- `tenant_id#account_id#ruleset_version#active_signals_hash`

**Acceptance criteria**
- Same active signals → same posture output (bitwise identical JSON ignoring timestamps)
- Replays do not create duplicate risk/unknown entries
- Posture updates only when output changes (avoid churn)

---

## EPIC 2.5 — Optional Artifacts (Human-readable summaries)

### Story 2.5.1 — Deterministic `AccountDeltaSummary` artifact
**Trigger**
- posture changes OR high severity risk factor emitted

**Output**
- S3 artifact with:
  - "what changed"
  - "why it matters"
  - top evidence refs

**Acceptance criteria**
- Artifact can be generated without an LLM (template-based)
- Artifact is stored in S3 and referenced from ledger

*(Optional extension: bounded Bedrock summarization as a second pass, clearly labeled and non-authoritative.)*

---

## EPIC 2.6 — APIs for UI and Phase 3 agents

### Story 2.6.1 — Implement minimal posture + signals endpoints
- `GET /accounts/{id}/posture`
- `GET /accounts/{id}/signals?active=true`
- Optional: `GET /accounts/{id}/unknowns`

**Acceptance criteria**
- Endpoints return within p95 < 200ms for DDB-backed reads
- Responses include version fields and evidence pointers

---

## EPIC 2.7 — Observability, Testing, and Certification

### Story 2.7.1 — Metrics + dashboards
**Metrics**
- `graph_materializer_success/fail`
- `synthesis_success/fail`
- `posture_change_count`
- `unknown_count`
- `rule_trigger_count{rule_id}`

**Acceptance criteria**
- Dashboard exists with actionable graphs and alarms
- Alarms are routed to on-call channel

---

### Story 2.7.2 — Replay test harness
**Tasks**
- Build a replay runner that:
  - replays a fixed set of Phase 1 signals
  - asserts graph + posture outputs match golden files

**Acceptance criteria**
- Deterministic replay passes in CI
- Any ruleset change requires an explicit golden update + changelog entry

---

### Story 2.7.3 — Phase 2 certification checklist
**Checklist**
- Idempotency verified under retries
- No duplicate edges/nodes under replay
- Posture state derivation stable
- Ledger coverage complete
- Cost: no scans; bounded queries only

**Acceptance criteria**
- A `PHASE_2_CERTIFICATION.md` is produced and signed off

---

## Suggested Execution Order (Practical)

**Recommended order (refined):**

1. EPIC 2.1 — Neptune foundation
2. EPIC 2.2 — Graph materializer + backfill
3. **EPIC 2.4 — Synthesis rules (define early, code later)** ⚠️ **Do this before 2.3**
   - Write `synthesis/rules/v1.yaml` first
   - Forces clarity on posture semantics
   - Prevents schema churn later
4. EPIC 2.3 — AccountPostureState (DDB)
5. EPIC 2.4 — Synthesis engine implementation
6. EPIC 2.6 — Minimal APIs
7. EPIC 2.7 — Replay + certification
8. EPIC 2.5 — Optional artifacts (if time)

**Rationale:** Writing rules early forces clarity on posture semantics and prevents schema churn during implementation.

---

## Phase 2 Definition of Done (Final)

Phase 2 is complete when:
- ✅ Signals are materialized into Neptune with evidence edges
- ✅ `AccountPostureState` exists and can be queried per account
- ✅ Synthesis rules produce posture/risk/unknowns deterministically
- ✅ Replay harness passes in CI
- ✅ Ledger contains complete trace for materialization + synthesis
- ✅ Costs are bounded (no lake scans; no unbounded graph traversals)

---

## Handoff to Phase 3 (AgentCore Decision)

Phase 3 agents will consume:
- `AccountPostureState` (fast, primary context)
- Neptune graph for deep context
- Active signals + evidence refs
- Optional delta summary artifacts

This keeps Phase 3 cheap, grounded, and safe.

---

## Technical Review & Refinements

### Executive Assessment ✅

**Verdict:** ✅ **Strong, implementable, and correctly sequenced.**

This is a *clean continuation* of Phase 1 and preserves core architectural principles: determinism, replayability, evidence grounding, and cost control.

**Key Strengths:**
- Phase boundary discipline (does not mutate Phase 1)
- Deterministic synthesis correctly scoped (versioned, hashed, reproducible)
- Graph as truth store, not runtime dependency
- Idempotency + replay are first-class

### Critical Refinements Applied

1. **Graph Query Language Locked:** ✅ Gremlin only (not OpenCypher)
   - Better AWS tooling
   - More examples for idempotent upserts
   - Less cognitive overhead

2. **Signal Identity vs Vertex Identity:** ✅ Clarified
   - Vertex ID = `SIGNAL#{signal_id}` (from Phase 1 signal record)
   - `dedupeKey` stored as property, not used for vertex identity
   - Prevents accidental graph collapse

3. **Failure Semantics Rule:** ✅ Added
   - If graph materialization partially succeeds, synthesis MUST NOT run
   - Enforced via ledger gate or `graph_materialized=true` flag
   - Prevents "phantom posture updates"

4. **Unknowns TTL Semantics:** ✅ Required
   - Every `UnknownV1` must have `introduced_at`, `expires_at` OR `review_after`
   - Prevents Unknowns from accumulating indefinitely

5. **Execution Order Refined:** ✅ Rules defined early
   - Write `synthesis/rules/v1.yaml` before implementing AccountPostureState
   - Forces clarity on posture semantics
   - Prevents schema churn

### Alignment with Phase 1 ✅
- **Event Types:** Phase 1 emits `SIGNAL_DETECTED` and `SIGNAL_CREATED` events. The plan correctly references these events for triggering materialization.
- **Evidence Binding:** Phase 1 signals already include `EvidenceSnapshotRef`, which aligns perfectly with graph materialization.
- **AccountState:** Phase 1 maintains `AccountState` read model, which synthesis engine can leverage.

### Technical Considerations

1. **EventBridge Integration:**
   - Current Phase 1 setup routes `SIGNAL_DETECTED`/`SIGNAL_CREATED` to lifecycle-inference-handler
   - Phase 2 materializer should be added as an additional target (fan-out pattern)
   - Use EventBridge filtering to route to both handlers
   - Materializer must check `graph_materialized` flag before synthesis runs

2. **Neptune Query Language:** ✅ **LOCKED: Gremlin only**
   - Gremlin is the authoritative query language
   - Document all query patterns in `GRAPH_CONVENTIONS.md`
   - Use AWS Neptune Gremlin SDK

3. **Idempotency:**
   - Signal vertex ID = `SIGNAL#{signal_id}` (from Phase 1)
   - `dedupeKey` is a property, not part of vertex identity
   - Natural idempotency via vertex ID uniqueness

4. **Cost Optimization:**
   - Bounded queries only (no scans, no unbounded traversals)
   - Batch graph operations where possible
   - Use Neptune query timeout limits
   - Read models (DynamoDB) for hot paths

5. **Schema Versioning:**
   - Align with Phase 0/1 versioning approach
   - Use same versioning scheme as evidence schemas
   - Record `ruleset_version` in all outputs

### Missing Considerations

1. **Error Handling:**
   - Add DLQ configuration for Step Functions state machines
   - Define retry policies for Neptune operations
   - Handle partial failures in graph materialization

2. **Testing Strategy:**
   - Add unit tests for graph materialization logic
   - Add integration tests for Neptune connectivity
   - Add contract tests for synthesis determinism

3. **Migration Strategy:**
   - Plan for migrating existing Phase 1 signals (backfill story covers this)
   - Consider data migration scripts for production rollout

4. **Monitoring:**
   - Add Neptune query performance metrics
   - Monitor graph size growth
   - Track materialization latency

### Recommendations

1. **File Structure:**
   - Create `src/services/synthesis/` for synthesis engine
   - Create `src/services/graph/` for Neptune graph operations
   - Create `src/handlers/phase2/` for Phase 2 handlers

2. **Type Definitions:**
   - Create `src/types/PostureTypes.ts` for posture-related types
   - Create `src/types/GraphTypes.ts` for graph vertex/edge types
   - Align with existing type organization patterns

3. **CDK Organization:**
   - Add Neptune cluster to `CCNativeStack`
   - Create separate Step Functions state machines
   - Follow existing CDK patterns from Phase 1

4. **Documentation:**
   - Create `docs/implementation/phase_2/` directory
   - Add `GRAPH_CONVENTIONS.md` as specified
   - Document synthesis ruleset format and examples

---

## Strategic Validation

This plan correctly positions the system as:

* **Grounded** (evidence-first)
* **Deterministic** (rules, not vibes)
* **Agent-ready but not agent-dependent**

Phase 2 builds the **substrate** that real agents can safely stand on in Phase 3.

---

## Next Steps

**Before coding:**
1. ✅ Lock Gremlin as query language (done)
2. ✅ Define signal identity rules (done)
3. 📋 Draft `synthesis/rules/v1.yaml` (recommended next step)
4. 📋 Design `GRAPH_CONVENTIONS.md` (recommended next step)
5. 📋 Sanity-check posture semantics (OK/WATCH/AT_RISK/EXPAND/DORMANT) against real sales motion

**Status:** ✅ Plan reviewed, refined, and ready for implementation. All prerequisites met (Phase 0 ✅, Phase 1 ✅).
