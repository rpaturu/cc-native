# WORLD_MODEL_CONTRACT

## 1. Purpose

The **World Model** is the canonical, system-owned representation of reality as understood by Manus.

Its purpose is to:

* Maintain a **grounded, auditable state of the world**
* Provide a **shared source of truth** for all downstream decision systems
* Preserve **uncertainty, evidence, and temporal validity**
* Enable **safe autonomy** through confidence-aware access

The World Model is **not** an intelligence layer. It is a state layer.

---

## 2. Core Principle

> **The World Model describes what *is believed to be true*, not what *should be done*.**

All reasoning, planning, and action must occur **outside** the World Model.

---

## 3. Non-Goals (Hard Constraints)

The World Model MUST NOT:

* Perform planning or optimization
* Execute agent loops or reasoning chains
* Infer user intent
* Trigger actions or workflows
* Hide uncertainty or resolve ambiguity implicitly
* Rewrite history without evidence

If any of the above are required, they belong in **Decision Models**, **Agents**, or **Policy Engines**, not here.

---

## 4. Conceptual Model

### 4.1 Entity-Centric World View

The world is modeled as a set of **Entities**, each with:

* A stable identifier
* A concrete type
* A current computed state
* Historical state transitions
* Evidence-backed attributes
* Explicit confidence values

Entities may reference one another through typed relationships, forming a **world graph**.

---

## 5. Entity Definition

Each Entity MUST include:

* `entity_id` — globally unique and stable
* `entity_type` — strongly typed (e.g., Account, Person, Opportunity)
* `attributes` — key-value facts about the entity
* `relationships` — typed links to other entities

Entities are **append-only** at the evidence level and **computed** at the state level.

---

## 6. State Model

### 6.1 Current State

The **Current State** represents the system's best-known belief about an entity *as of a point in time*.

State is derived from:

* Evidence ingestion
* Deterministic aggregation logic
* Confidence weighting and decay

State MUST include:

* Field-level values
* Field-level confidence scores
* `as_of` timestamp

### 6.2 State Is Computed

State MUST NOT be directly edited.

All state changes MUST occur via:

1. New evidence
2. Re-computation

---

## 7. Evidence Ledger

### 7.1 Evidence Definition

Evidence is the atomic input to the World Model.

Each evidence record MUST include:

* Source (CRM, scrape, transcript, agent inference, user input)
* Timestamp
* Payload (raw or minimally processed)
* Provenance metadata
* Trust classification

### 7.2 Evidence Immutability

Evidence records are **immutable**.

They may be superseded by newer evidence but MUST NEVER be deleted or overwritten.

---

## 8. Confidence Model

### 8.1 Field-Level Confidence

Each attribute in state MUST have an explicit confidence value in `[0,1]`.

Confidence is influenced by:

* Source reliability
* Recency
* Corroboration
* Contradiction

### 8.2 Confidence Decay

Confidence MUST decay over time unless reinforced by new evidence.

Decay functions MUST be:

* Deterministic
* Documented
* Consistent across entities of the same type

---

## 9. Contradiction Handling

The World Model MUST support conflicting evidence.

Rules:

* Conflicts are preserved, not erased
* State reflects weighted belief, not forced resolution
* Contradiction metadata MUST be exposed to consumers

"Unknown" and "Contested" are valid states.

---

## 10. Temporal Semantics

The World Model is **time-aware**.

It MUST support:

* Point-in-time queries
* State history reconstruction
* Evidence timelines

Time travel is **read-only** and MUST NOT alter current state.

---

## 11. Access Model

### 11.1 Read Access

* Agents MAY read from the World Model
* Reads MAY be gated by confidence thresholds
* Reads MUST expose confidence and provenance

### 11.2 Write Access

* Only ingestion pipelines and system-owned writers may write evidence
* Agents MAY NOT write state directly
* Agent-generated inferences MUST be explicitly labeled as such

---

## 12. Safety and Autonomy Constraints

The World Model is a **governor of autonomy**, not an enabler of recklessness.

Downstream systems SHOULD:

* Reduce autonomy when confidence is low
* Escalate to humans when contradictions are high
* Log all decisions with referenced world state snapshots

---

## 13. Auditability Requirements

The World Model MUST support:

* Full traceability from decision → state → evidence
* Reproducible reads (by timestamp and version)
* Immutable audit logs

No silent state mutation is permitted.

---

## 14. Failure Modes (Explicitly Allowed)

The system may:

* Be uncertain
* Be incomplete
* Contain contradictions
* Defer judgment

The system must NOT:

* Hallucinate certainty
* Collapse ambiguity prematurely

---

## 15. Design Philosophy

> **The World Model must be boring, explicit, and strict.**

If it feels clever, it is wrong.
If it reasons, it is wrong.
If it hides uncertainty, it is dangerous.

---

## 16. Versioning

This contract is versioned.

All changes MUST:

* Be backward compatible where possible
* Be documented with rationale
* Include migration and validation strategy

---

## 17. Final Note

The World Model is the foundation upon which all Manus intelligence stands.

If this layer is corrupted, no amount of agent sophistication can compensate.

**Protect it accordingly.**
