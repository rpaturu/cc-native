# GRAPH_CONVENTIONS.md (Phase 2)

## Purpose

This document defines **non-negotiable graph conventions** for the DealMind **Situation Graph** (Neptune) used in **Phase 2**.

Goals:

* **Deterministic materialization** from Phase 1 Signals + EvidenceSnapshotRefs
* **Idempotent upserts** under retries and replays
* **Stable IDs** across environments and deployments
* **Bounded queries** (no unbounded traversals in runtime paths)
* **Audit alignment** with the append-only ledger and trace IDs

Non-goals:

* Graph as a primary runtime store (DynamoDB read model remains primary for UI/agents)
* Open-ended ontology expansion without schema versioning

---

## Query Language + Driver

**Standard:** **Gremlin** (only)
**Reason:** AWS/Neptune maturity, SDK/tooling, and well-understood idempotent patterns.

> All graph writes must be expressible as deterministic Gremlin traversals with explicit IDs and property sets.

---

## Core Graph Model

### Vertex Labels (Phase 2 MVP)

* `Tenant`
* `Account`
* `Signal`
* `EvidenceSnapshot`
* `Posture`
* `RiskFactor`
* `OpportunitySignal`
* `Unknown`
* `Artifact` *(optional in Phase 2.5)*

### Edge Labels (Phase 2 MVP)

* `HAS_SIGNAL` (Account → Signal)
* `SUPPORTED_BY` (Signal → EvidenceSnapshot)
* `HAS_POSTURE` (Account → Posture)
* `IMPLIES_RISK` (Posture → RiskFactor)
* `IMPLIES_OPPORTUNITY` (Posture → OpportunitySignal)
* `HAS_UNKNOWN` (Account → Unknown)
* `HAS_ARTIFACT` *(optional)*

---

## Identity: Vertex IDs

### Absolute Rule

**All vertices must have an explicit, stable `id`** set by the application.
Never rely on Neptune-generated IDs.

### ID Format

IDs are **string** and must follow:

`<TYPE>#<tenant_id>#<entity_specific_key>`

Examples:

* Tenant
  `TENANT#t_123`

* Account
  `ACCOUNT#t_123#acc_456`

* Signal
  `SIGNAL#t_123#sig_789`

* EvidenceSnapshot
  `EVIDENCE#t_123#ev_abc123`
  *(use EvidenceSnapshotRef ID; never hash content here)*

* Posture (versioned by ruleset + inputs hash)
  `POSTURE#t_123#acc_456#v1#<active_signals_hash>`

* RiskFactor (scoped to posture instance)
  `RISK#t_123#acc_456#v1#<active_signals_hash>#<rule_id>`

* OpportunitySignal (scoped to posture instance)
  `OPP#t_123#acc_456#v1#<active_signals_hash>#<rule_id>`

* Unknown (scoped to posture instance)
  `UNKNOWN#t_123#acc_456#v1#<active_signals_hash>#<rule_id>`

#### Why posture/risk/unknown are keyed by `(ruleset_version + active_signals_hash)`

Because you explicitly want:

* determinism
* replayability
* "same inputs → same outputs"
* avoidance of duplicates under retries

---

## Required Properties (All Vertices)

Every vertex must include:

* `tenant_id` (string)
* `entity_type` (string; redundant but useful)
* `schema_version` (string; e.g., `graph_v1`)
* `created_at` (ISO string)
* `updated_at` (ISO string)

Notes:

* `created_at` is set once at first insert
* `updated_at` changes on every upsert

---

## Optional Standard Properties (Recommended)

Common:

* `source` (e.g., `phase1`, `phase2_synthesis`)
* `trace_id` (last writer trace; for debugging)
* `ruleset_version` (for posture/risk/unknown/opportunity)
* `inputs_hash` (for posture/risk/unknown/opportunity)

Signal:

* `signal_type`
* `signal_status` (ACTIVE/INACTIVE)
* `first_seen_at`, `last_seen_at`
* `ttl_expires_at` (if signal TTL exists)

EvidenceSnapshot:

* `evidence_ref` (canonical ref string)
* `captured_at`

---

## Edges: Identity + Properties

### Absolute Rule

Edges must also be created **idempotently**.

**Preferred edge ID convention (if supported in your Gremlin approach):**
`<EDGE_LABEL>#<from_id>#<to_id>`

If explicit edge IDs are not used consistently, then **edge creation must use a "check then create" traversal**.

### Edge Properties (Recommended)

* `created_at`
* `updated_at`
* `trace_id`
* `schema_version`

---

## Idempotent Upsert Patterns (Gremlin)

### Vertex Upsert: "Get-or-Create-Then-Update"

Pseudo-pattern:

1. `g.V(id).fold()`
2. `coalesce(unfold(), addV(label).property(id, id).property(created_at, now)...)`
3. `.property(updated_at, now)...` (set/overwrite mutable props)

**Rules**

* Never create a second vertex for the same ID
* Never mutate immutable facts (only add metadata like `updated_at`, `last_seen_at`)

### Edge Upsert: "Create if Missing"

Pseudo-pattern:

* Find `outE(label).where(inV().hasId(toId))`
* If missing, add it
* Always update `updated_at`

**Rules**

* The same `(from, label, to)` must not be duplicated
* Edge properties should be minimal; semantics live on vertices + ledger

---

## Determinism Rules

To keep graph outputs stable under replay:

1. **Stable ordering**: any multi-write operation must sort inputs deterministically (e.g., by `signal_id`).
2. **No time-based IDs**: timestamps must never be used to generate IDs.
3. **Timestamps are non-authoritative**: they may differ across runs; do not use them for equality checks.

---

## Write Boundaries

### Materializer Writes (Phase2GraphMaterializer)

Allowed to create/upsert:

* Tenant, Account, Signal, EvidenceSnapshot vertices
* `HAS_SIGNAL`, `SUPPORTED_BY` edges

Must not create:

* Posture, RiskFactor, Opportunity, Unknown vertices

### Synthesis Writes (Phase2SynthesisEngine)

Allowed to create/upsert:

* Posture, RiskFactor, OpportunitySignal, Unknown vertices
* `HAS_POSTURE`, `IMPLIES_RISK`, `IMPLIES_OPPORTUNITY`, `HAS_UNKNOWN` edges

Must not modify:

* Signal vertices beyond harmless metadata (`signal_status`, `last_seen_at`)

---

## Bounded Query Contract

### Runtime paths (UI/Agent) MUST NOT require graph traversal

UI/agents read:

* `AccountPostureState` from DynamoDB

Graph queries are allowed for:

* Deep explainability drill-down
* Debug tools
* Offline audits
* Replay verification

### Approved Query Patterns (Bounded)

* "Account → active signals (K)"
  `g.V(accountId).out('HAS_SIGNAL').has('signal_status','ACTIVE').limit(K)`

* "Signal → evidence snapshots (bounded)"
  `g.V(signalId).out('SUPPORTED_BY').limit(K)`

* "Account → posture for a specific inputs hash"
  `g.V(postureId)` (direct by ID)

### Forbidden Query Patterns (Unbounded)

* Any query without `limit()`, `hasId()`, or a strict time/key bound
* Multi-hop traversals across arbitrary subgraphs without a hard depth bound
* "Find all accounts with X" in production runtime

---

## Versioning

### schema_version

Use a single graph schema tag:

* `schema_version = "graph_v1"`

If breaking changes occur, increment:

* `graph_v2` etc.

### Ruleset version alignment

Posture/Risk/Unknown vertices must include:

* `ruleset_version` (e.g., `v1`)
* `inputs_hash` (active signals hash)

This is required for replay verification.

---

## Deletion + Tombstones

**Default policy:** no deletes in Phase 2.

When a signal becomes inactive:

* Update `signal_status = INACTIVE`
* Do **not** remove edges
* Do **not** delete vertices

If hard deletes are needed later:

* Introduce `tombstoned_at` and a controlled compaction job
* Never delete without a ledger event

---

## Ledger Alignment (Required)

Every graph write batch must emit ledger events with:

* `trace_id`
* `tenant_id`, `account_id`
* `entity_ids` written (vertex IDs + edge triples)
* `writer` (`phase2_graph_materializer` or `phase2_synthesis_engine`)
* `schema_version`
* `ruleset_version` (if synthesis)

This is what makes the graph auditable.

---

## Operational Guardrails

* Neptune write timeouts must be configured (fail fast)
* Retries must be safe (idempotent by design)
* DLQ for failed state machine executions is mandatory
* "Partial materialization" must not trigger synthesis (gate on ledger or state flag)

---

## Appendix: ID Examples for One Account Update

Given:

* tenant: `t_123`
* account: `acc_456`
* signal: `sig_789`
* evidence: `ev_abc123`
* ruleset: `v1`
* active_signals_hash: `h_555`
* rule: `RULE_RENEWAL_USAGE_RISK`

IDs:

* `ACCOUNT#t_123#acc_456`
* `SIGNAL#t_123#sig_789`
* `EVIDENCE#t_123#ev_abc123`
* `POSTURE#t_123#acc_456#v1#h_555`
* `RISK#t_123#acc_456#v1#h_555#RULE_RENEWAL_USAGE_RISK`

Edges:

* `ACCOUNT →HAS_SIGNAL→ SIGNAL`
* `SIGNAL →SUPPORTED_BY→ EVIDENCE`
* `ACCOUNT →HAS_POSTURE→ POSTURE`
* `POSTURE →IMPLIES_RISK→ RISK`

---
