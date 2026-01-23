# Phase 1 — Lifecycle-Aware Perception & Signals

## Prospect → Suspect → Customer

## Phase Objective

Establish the system's ability to **autonomously understand and advance an account through its lifecycle** by detecting meaningful change, synthesizing signals across systems, and triggering decision logic — **without human prompting**.

Phase 1 is **not** about full deal execution.
It is about proving that the system can:

* recognize where an account is in its lifecycle
* detect when it should transition
* surface the *right next action* with evidence
* do so cost-efficiently and deterministically

---

## Lifecycle Model (Canonical)

```
PROSPECT → SUSPECT → CUSTOMER
```

Lifecycle state is **derived by the system**, not manually set by users.

---

## Scope Boundaries (Important)

### In scope

* Signal generation
* Lifecycle state inference
* Evidence binding
* Ledger logging
* Deterministic perception

### Explicitly out of scope (Phase 1)

* Autonomous external execution
* AgentCore decision orchestration
* Learning / ranking optimization
* Broad signal coverage

Phase 1 ends **before** the Decision Layer executes actions.

---

## Phase 1 Architecture (What Runs)

Phase 1 uses the **existing Phase 0 foundation**:

* Event spine (EventBridge)
* Immutable evidence store (S3)
* Append-only ledger
* Tenant isolation
* Schema-validated events

Phase 1 adds:

* Connector-driven perception
* Diff-based detectors
* Canonical lifecycle signals

---

## Signal Design Principles (Non-Negotiable)

Every Phase 1 signal must:

1. Represent **meaningful lifecycle change**
2. Be **derived from deltas**, not full scans
3. Bind to **immutable evidence**
4. Include confidence, severity, and TTL
5. Be explainable without LLM inference

If a signal does not directly influence lifecycle progression, it does not belong in Phase 1.

### Evidence Schema Versioning

**Principle:** Each signal references an evidence schema version used at creation time.

This ensures:
* Replayability across schema migrations
* Future-proofing for evidence format changes
* Deterministic signal reconstruction from historical evidence

**Implementation:**
* Every signal includes `evidenceSchemaVersion: string`
* Evidence storage includes schema version metadata
* Signal replay uses the schema version from signal creation time

### Signal Metadata Requirements

Every signal must include:

1. **Confidence** (normalized scale):
   * Range: `[0.0 – 1.0]`
   * Source-specific, not cross-signal comparable
   * Confidence source taxonomy:
     * `direct`: Direct evidence from source system (confidence = 1.0)
     * `derived`: Computed from direct evidence (confidence = 0.7-0.9)
     * `inferred`: Inferred from patterns or absence (confidence = 0.5-0.7)
   * Logged but not thresholded in Phase 1 (no filtering by confidence)
   * Provides explainability for future phases without changing behavior now

2. **Severity** (categorical):
   * `low | medium | high | critical`
   * Lifecycle-impact based (not arbitrary)

3. **TTL** (time-to-live):
   * Default TTL ranges by signal type (see TTL Semantics section)
   * Expiry meaning defined per signal type
   * Expired signals remain in history but are marked inactive

---

## Phase 1 Signal Set (Lifecycle-Native)

### 🟦 PROSPECT — No engagement yet

**System question:**
*Should this account be engaged now?*

#### Signals

### 1. `ACCOUNT_ACTIVATION_DETECTED`

**Meaning:**
The account has crossed a relevance threshold.

**Sources (one or more):**

* Target account list update
* External signal (news, hiring, tech change)
* Partner / inbound attribution

**Purpose:**

* Wake the system up
* Justify attention

---

### 2. `NO_ENGAGEMENT_PRESENT`

**Meaning:**
The account is relevant but untouched.

**Derived from:**

* Absence of meetings
* Absence of outbound/inbound interaction

**Purpose:**

* Prevent silent neglect
* Enable proactive engagement decisions

**Guardrails (Critical):**
* Emit only on lifecycle state entry (PROSPECT)
* Re-emit only after meaningful time decay (30+ days)
* Automatically suppressed when `FIRST_ENGAGEMENT_OCCURRED` is detected
* Do not let this become a heartbeat signal

---

### 🟨 SUSPECT — Initial engagement / early opportunity

**System question:**
*Is this engagement becoming a real opportunity?*

---

### 3. `FIRST_ENGAGEMENT_OCCURRED`

**Meaning:**
The account has transitioned from cold to active.

**Sources:**

* First meeting
* Meaningful reply
* Logged interaction

**Purpose:**

* Transition PROSPECT → SUSPECT
* Trigger deeper observation

---

### 4. `DISCOVERY_PROGRESS_STALLED`

**Meaning:**
Engagement exists, but learning is not progressing.

**Derived from:**

* Incomplete notes
* Repeated meetings without new signals
* Missing follow-ups

**Purpose:**

* Detect false momentum
* Prevent wasted cycles

**Guardrails (Critical - Phase 1 Clean):**
* Base strictly on *missing expected artifacts* (e.g., notes field empty, required fields missing)
* Avoid semantic note analysis (no LLM inference)
* Avoid outcome judgment (no "good" vs "bad" meeting assessment)
* Use only structural checks: presence/absence of data, not content quality
* If tempted to "understand" notes—stop. That's Phase 2.

---

### 5. `STAKEHOLDER_GAP_DETECTED`

**Meaning:**
The engagement is single-threaded or incomplete.

**Derived from:**

* Role mapping vs expected buying group
* Missing decision-critical personas

**Purpose:**

* Surface deal risk early
* Drive expansion decisions later

---

### 🟩 CUSTOMER — Adoption, renewal, expansion

**System question:**
*Is this customer healthy, at risk, or primed for expansion?*

---

### 6. `USAGE_TREND_CHANGE`

**Meaning:**
Customer behavior has materially shifted.

**Derived from:**

* Aggregate usage deltas
* Directional trend (up / down)

**Purpose:**

* Leading indicator for risk or growth
* Avoid reactive renewal behavior

---

### 7. `SUPPORT_RISK_EMERGING`

**Meaning:**
Operational friction may affect sentiment or renewal.

**Derived from:**

* Severity
* Aging
* Volume trend

**Purpose:**

* Cross-functional signal synthesis
* Early risk surfacing

---

### 8. `RENEWAL_WINDOW_ENTERED`

**Meaning:**
Commercial urgency has begun.

**Derived from:**

* Contract metadata
* Time-based threshold

**Purpose:**

* Gate deeper analysis
* Justify higher-cost actions later

---

## Lifecycle State Inference (Phase 1)

Lifecycle state is inferred by **signal presence**, not by CRM fields:

| State    | Minimum conditions                  |
| -------- | ----------------------------------- |
| PROSPECT | Activation detected + no engagement |
| SUSPECT  | First engagement occurred           |
| CUSTOMER | Active contract present             |

**Inference Priority Order:**
Lifecycle inference is evaluated in priority order: **CUSTOMER → SUSPECT → PROSPECT**.

This prevents edge ambiguity when signals overlap briefly during transitions. The system checks for CUSTOMER conditions first, then SUSPECT, then PROSPECT.

This inference logic is deterministic and versioned.

---

## Signal Precedence & Suppression Rules

**Principle:** Signals are lifecycle-scoped. Signals outside the current lifecycle are suppressed, not deleted.

### Suppression Rules

1. **Lifecycle-Scoped Suppression:**
   * PROSPECT signals (`ACCOUNT_ACTIVATION_DETECTED`, `NO_ENGAGEMENT_PRESENT`) are suppressed when account transitions to SUSPECT
   * SUSPECT signals (`FIRST_ENGAGEMENT_OCCURRED`, `DISCOVERY_PROGRESS_STALLED`, `STAKEHOLDER_GAP_DETECTED`) are suppressed when account transitions to CUSTOMER
   * Suppression is logged, not silent

2. **Conflict Resolution:**
   * When `NO_ENGAGEMENT_PRESENT` conflicts with `FIRST_ENGAGEMENT_OCCURRED`: `FIRST_ENGAGEMENT_OCCURRED` takes precedence, `NO_ENGAGEMENT_PRESENT` is suppressed
   * When `USAGE_TREND_CHANGE` occurs during renewal window: Both signals remain active (complementary, not conflicting)
   * When `SUPPORT_RISK_EMERGING` occurs during renewal window: Both signals remain active (complementary, not conflicting)

3. **Precedence Order (within lifecycle stage):**
   * Transition signals (`FIRST_ENGAGEMENT_OCCURRED`) take precedence over status signals (`NO_ENGAGEMENT_PRESENT`)
   * Risk signals (`SUPPORT_RISK_EMERGING`, `DISCOVERY_PROGRESS_STALLED`) are additive, not exclusive
   * Commercial urgency signals (`RENEWAL_WINDOW_ENTERED`) gate deeper analysis but don't suppress other signals

**Implementation Note:** Suppression is deterministic and logged. Suppressed signals remain in history but are marked as `suppressed: true` with a `suppressedAt` timestamp and `suppressedBy` (lifecycle transition or conflicting signal).

---

## TTL Semantics (Time-to-Live)

**Principle:** TTL defines signal relevance window. Expired signals remain in history but are marked inactive.

### Default TTL Ranges by Signal Type

| Signal Type | Default TTL | Expiry Meaning |
|------------|-------------|---------------|
| `ACCOUNT_ACTIVATION_DETECTED` | 30–90 days | Relevance decayed (account no longer relevant) |
| `NO_ENGAGEMENT_PRESENT` | Until transition | Lifecycle moved (suppressed on SUSPECT transition) |
| `FIRST_ENGAGEMENT_OCCURRED` | Permanent | Historical milestone (never expires) |
| `DISCOVERY_PROGRESS_STALLED` | 14–30 days | Risk window passed (stall resolved or escalated) |
| `STAKEHOLDER_GAP_DETECTED` | 30–60 days | Gap resolved or deal progressed without resolution |
| `USAGE_TREND_CHANGE` | 14–30 days | Trend normalized or new trend detected |
| `SUPPORT_RISK_EMERGING` | 14–30 days | Risk window passed (resolved or escalated) |
| `RENEWAL_WINDOW_ENTERED` | Contract-bound | Commercial urgency ended (renewed or churned) |

### TTL Implementation Rules

1. **TTL Calculation:**
   * TTL = `createdAt + ttlDays`
   * Expired signals: `expiresAt < now()`
   * Active signals: `expiresAt >= now()` OR `expiresAt === null` (permanent)

2. **Expiry Behavior:**
   * Expired signals are marked `active: false`
   * Expired signals remain queryable in history
   * Expired signals do not influence lifecycle inference
   * Expiry is logged but signals are not deleted

3. **TTL Override:**
   * Lifecycle transitions can override TTL (e.g., `NO_ENGAGEMENT_PRESENT` suppressed on SUSPECT transition)
   * Signal suppression takes precedence over TTL expiry

---

## Phase 1 Output Artifacts

By the end of Phase 1, the system must be able to answer:

For any account:

* current lifecycle state
* recent lifecycle-relevant signals
* why the account is in that state
* what changed recently
* what evidence supports it

No decisions are executed yet — only **made visible and logged**.

---

## Phase 1 Definition of Done

Phase 1 is complete when:

* Signals are emitted reliably for all three lifecycle stages
* Each signal links to immutable evidence
* **Every signal is replayable from raw evidence without LLM inference** (non-negotiable)
* Lifecycle state can be inferred deterministically
* Signal precedence and suppression rules are implemented and tested
* TTL semantics are defined and enforced for all signal types
* Confidence is normalized to [0.0-1.0] scale and logged
* Ledger records all signal creation, suppression, and expiry
* Source costs are bounded (delta-only, capped polling)
* No manual tagging is required to move lifecycle state
* `NO_ENGAGEMENT_PRESENT` guardrails are enforced (state-entry only, time-decay re-emit)
* `DISCOVERY_PROGRESS_STALLED` uses only structural checks (no semantic analysis)

---

## Why This Phase Matters

Phase 1 proves that the system can:

* observe accounts without being asked
* understand progression, not just events
* reason about *when to care*
* do so safely, cheaply, and explainably

Only after this is true does autonomy make sense.

---

## Transition to Phase 2

Phase 2 builds on this by introducing:

* Situation Graph materialization
* Cross-signal synthesis
* Retrieval-augmented context

Phase 3 then introduces **Decision + Action**.

---

### One-line internal framing

> **Phase 1 teaches the system how accounts evolve. Everything else builds on that.**
