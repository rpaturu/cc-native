# Phase 3 — Autonomous Decision + Action Proposal (Human-in-the-Loop)

**Status:** 📋 **PLANNING** (Not Started)  
**Prerequisites:** Phase 0 ✅ Complete | Phase 1 ✅ Complete | Phase 2 ✅ Complete  
**Dependencies:** Phase 0 + Phase 1 + Phase 2 are implemented and certified (event envelope, immutable evidence, append-only ledger, canonical signals + lifecycle inference, situation graph + deterministic synthesis).

**Last Updated:** 2026-01-25

---

## Phase 3 Objective (Very Precise)

Phase 3 introduces a **Decision Layer** that:

* Consumes **truth** (posture, signals, graph, evidence)
* Synthesizes **what should happen next**
* Produces **explicit, auditable action proposals**
* Routes **human involvement only when required**
* Executes **nothing silently**

> **Phase 3 is about judgment, not automation.**

---

## Scope Boundaries (Non-Negotiable)

### In Scope

* Decision synthesis (LLM-assisted)
* Action proposal generation
* Deterministic policy gating
* Human approval routing
* Decision audit + explainability

### Explicitly Out of Scope

* Background autonomous execution
* Self-learning / ranking optimization
* Tool sprawl or free-form agent loops
* "Always-on" automation without approval

---

## Core Phase 3 Conceptual Model

```
Account Truth
  ↓
Decision Synthesis (LLM proposes)
  ↓
Policy Gate (code decides)
  ↓
Human Touch (if required)
  ↓
Approved Action Intent
  ↓
(Phase 4) Execution
```

**Key Invariant:**
LLMs never bypass policy, humans, or audit.

---

## Decision Triggering Model

**Critical:** Decisions are **not** continuously evaluated. They are triggered by specific events to prevent "decision storms" and unbounded cost.

### Trigger Types

1. **Lifecycle Transition Events**
   * `PROSPECT → SUSPECT` transition
   * `SUSPECT → CUSTOMER` transition
   * `CUSTOMER` risk state changes (OK → AT_RISK)

2. **High-Signal Arrival**
   * `RENEWAL_WINDOW_ENTERED` signal
   * `SUPPORT_RISK_EMERGING` signal
   * `USAGE_TREND_CHANGE` with severity > threshold

3. **Explicit Seller Request**
   * User-initiated via UI: "What should I do next?"
   * Manual decision evaluation request

4. **Cooldown-Gated Periodic Evaluation**
   * Maximum once per account per 24 hours
   * Only if no recent high-signal events
   * Cooldown tracked in `AccountPostureState.last_decision_evaluated_at`

### Trigger Semantics

* **Event-Driven (Primary):** Lifecycle transitions and high-signal events trigger immediate evaluation
* **Pull-Based (Secondary):** Seller-initiated requests trigger on-demand evaluation
* **Cooldown Enforcement:** Prevents redundant evaluations within 24-hour window
* **Cost Budgeting:** Each trigger consumes budget; budget exhaustion blocks evaluation

**Acceptance Criteria:**
* No decision evaluation without explicit trigger
* Cooldown prevents decision storms
* Budget limits prevent unbounded LLM usage

---

## Canonical Data Contracts (Versioned)

### 3.1 `DecisionContextV1`

**Inputs to the decision engine**

* `tenant_id`
* `account_id`
* `lifecycle_state`
* `AccountPostureState`
* `active_signals[]`
* `risk_factors[]`
* `opportunities[]`
* `unknowns[]`
* `graph_context_refs[]` (bounded)
* `policy_context` (thresholds, permissions)

---

### 3.2 `DecisionProposalV1`

**Output of the decision engine**

```json
{
  "decision_id": "...",
  "account_id": "...",
  "decision_type": "PROPOSE_ACTIONS",
  "actions": [
    {
      "action_intent_id": "...",
      "action_type": "REQUEST_RENEWAL_MEETING",
      "why": [
        "RENEWAL_WINDOW_ENTERED < 90d",
        "USAGE_TREND_CHANGE = DOWN",
        "SUPPORT_RISK_EMERGING"
      ],
      "confidence": 0.84,
      "risk_level": "MEDIUM",
      "requires_human": true,
      "blocking_unknowns": []
    }
  ],
  "summary": "Renewal risk detected; proactive engagement recommended.",
  "decision_version": "v1"
}
```

---

### 3.3 `ActionIntentV1`

**What survives policy + human approval**

```json
{
  "action_intent_id": "...",
  "action_type": "REQUEST_RENEWAL_MEETING",
  "target_entity": "account:acme_corp",
  "parameters": {
    "meeting_type": "renewal",
    "priority": "high"
  },
  "approved_by": "user:john_doe",
  "approval_timestamp": "2026-01-25T07:00:00Z",
  "execution_policy": {
    "retry_count": 3,
    "timeout_seconds": 300
  },
  "expires_at": "2026-01-30T00:00:00Z",
  "original_proposal_id": "...",
  "original_decision_id": "...",
  "edited_fields": [],
  "edited_by": null,
  "edited_at": null
}
```

**Fields:**
* `action_type` - From ActionTypeV1 enum
* `target_entity` - Entity ID (account, contact, opportunity)
* `parameters` - Action-specific parameters (mutable)
* `approved_by` - User ID who approved
* `approval_timestamp` - When approved
* `execution_policy` - Retry/timeout configuration
* `expires_at` - Action expiration (mutable)
* `original_proposal_id` - Links to DecisionProposalV1 (provenance)
* `original_decision_id` - Links to DecisionContextV1 (provenance)
* `edited_fields[]` - List of field names that were edited (if any)
* `edited_by` - User ID who edited (if edited)
* `edited_at` - Timestamp of edit (if edited)

---

## Confidence Semantics Contract

**Definition:**
Confidence is the **LLM's self-assessed certainty** that a proposed action is appropriate, expressed as a value in `[0.0, 1.0]`.

### Confidence Properties

* **Source:** LLM self-assessment (not post-processed or calibrated)
* **Range:** `[0.0, 1.0]` (inclusive)
* **Interpretation:** Higher values indicate stronger LLM belief in action appropriateness
* **Non-Comparable:** Confidence values are **not** comparable across different action types or decision contexts

### Policy Gate Consumption

The Policy Gate interprets confidence **deterministically**:

* `confidence < min_confidence_threshold` → **BLOCKED**
* `confidence >= min_confidence_threshold && requires_human === true` → **APPROVAL_REQUIRED**
* `confidence >= min_confidence_threshold && requires_human === false` → **ALLOWED** (if action type permits)

### Confidence Limitations

* **Not calibrated:** Confidence is raw LLM output, not calibrated against historical outcomes
* **Not validated:** Confidence does not guarantee action success or appropriateness
* **Not authoritative:** Policy gate and human approval are authoritative, not confidence alone

### Future Calibration (Explicitly Deferred)

Confidence calibration (mapping LLM confidence to actual outcomes) is **explicitly deferred** to a later phase. Phase 3 treats confidence as advisory input to policy, not as a validated metric.

**Acceptance Criteria:**
* Confidence is always present in `DecisionProposalV1`
* Confidence is bounded `[0.0, 1.0]`
* Policy gate uses confidence deterministically
* Confidence calibration is explicitly deferred

---

## ActionType Registry v1

**Purpose:** Canonical enumeration of action types with risk classification and default policy rules.

### ActionType Enumeration

```typescript
enum ActionTypeV1 {
  // Outreach Actions (Always require human approval)
  REQUEST_RENEWAL_MEETING = 'REQUEST_RENEWAL_MEETING',
  REQUEST_DISCOVERY_CALL = 'REQUEST_DISCOVERY_CALL',
  REQUEST_STAKEHOLDER_INTRO = 'REQUEST_STAKEHOLDER_INTRO',
  
  // CRM Write Actions (Approval required unless low risk)
  UPDATE_OPPORTUNITY_STAGE = 'UPDATE_OPPORTUNITY_STAGE',
  CREATE_OPPORTUNITY = 'CREATE_OPPORTUNITY',
  UPDATE_ACCOUNT_FIELDS = 'UPDATE_ACCOUNT_FIELDS',
  
  // Internal Actions (Auto-allowed if confidence threshold met)
  CREATE_INTERNAL_NOTE = 'CREATE_INTERNAL_NOTE',
  CREATE_INTERNAL_TASK = 'CREATE_INTERNAL_TASK',
  FLAG_FOR_REVIEW = 'FLAG_FOR_REVIEW',
  
  // Research Actions (Auto-allowed)
  FETCH_ACCOUNT_NEWS = 'FETCH_ACCOUNT_NEWS',
  ANALYZE_USAGE_PATTERNS = 'ANALYZE_USAGE_PATTERNS',
}
```

### Risk Classification

| Action Type | Risk Tier | Default Approval Required | Min Confidence |
|------------|-----------|--------------------------|----------------|
| Outreach Actions | HIGH | ✅ Always | 0.75 |
| CRM Write Actions | MEDIUM | ✅ Unless low risk | 0.70 |
| Internal Actions | LOW | ❌ If confidence >= threshold | 0.65 |
| Research Actions | MINIMAL | ❌ Auto-allowed | 0.60 |

### Policy Rules by Action Type

**Outreach Actions:**
* Always require human approval
* Cannot be auto-approved regardless of confidence
* Must include explicit rationale

**CRM Write Actions:**
* Require approval unless:
  * `confidence >= 0.85`
  * `risk_level === 'LOW'`
  * Action type is non-destructive (e.g., adding tags)

**Internal Actions:**
* Auto-allowed if:
  * `confidence >= min_confidence_threshold`
  * `risk_level === 'LOW'`
* Otherwise require approval

**Research Actions:**
* Auto-allowed if:
  * `confidence >= 0.60`
  * No external side effects

**Acceptance Criteria:**
* All action types are enumerated
* Risk tier is assigned per action type
* Default approval rules are deterministic
* Policy rules are code + config (no prompts)

---

## Epics and Stories

---

## EPIC 3.1 — Decision Engine (LLM-Assisted, Bounded)

### Story 3.1.1 — Decision Context Assembler

**Purpose**

* Construct a **bounded, deterministic input** for the LLM

**Tasks**

* Fetch `AccountPostureState` (DDB)
* Fetch active signals + evidence refs
* Fetch limited graph neighborhood (Neptune, capped depth)
* Fetch tenant policy config
* Assemble `DecisionContextV1`

**Acceptance Criteria**

* Context assembly is deterministic
* No unbounded graph traversal
* Input size capped and logged

---

### Story 3.1.2 — Decision Synthesis Service

**Purpose**

* Generate decision proposals, not actions

**Tasks**

* Single Decision Service (Lambda/ECS)
* Call Bedrock model with strict schema output
* Enforce `DecisionProposalV1` schema (fail-closed)

**Acceptance Criteria**

* Output always conforms to schema
* No tool execution from LLM
* Confidence + rationale always present

---

## EPIC 3.2 — Policy Gate (Deterministic Control Plane)

### Story 3.2.1 — Action Classification Rules

**Purpose**

* Decide what can happen next

**Rules Examples**

* Outreach → always human-approved
* CRM write → approval unless low risk
* Internal draft → auto-allowed
* Confidence < threshold → block

**Acceptance Criteria**

* Rules are code + config (no prompts)
* Policy decision is logged + replayable

---

### Story 3.2.2 — Policy Evaluation Engine

**Tasks**

* Evaluate each proposed action
* Annotate:
  * allowed / blocked / approval required
  * reason codes

**Acceptance Criteria**

* Same proposal → same policy result
* Policy changes do not affect historical decisions

---

## EPIC 3.3 — Human Decision Surface (UI)

### Story 3.3.1 — "What should I do next?" Feed

**UI Shows**

* Ranked action proposals
* Why this action
* Supporting signals + evidence
* Confidence + risk level

**Acceptance Criteria**

* Seller can understand the recommendation in <10 seconds
* No raw signals or system noise exposed

---

### Story 3.3.2 — Approval & Edit Flow

**Capabilities**

* Approve
* Edit parameters (with constraints)
* Reject with reason

**Human Edit Constraints**

**Editable Fields:**
* `parameters` (action-specific parameters)
* `target_entity` (e.g., different contact, different opportunity)
* `expires_at` (execution deadline)

**Locked Fields (Immutable):**
* `action_type` (cannot change action type)
* `original_proposal_id` (provenance preserved)
* `decision_id` (original decision context)

**Edit Semantics:**
* Edited actions generate a **new** `ActionIntentV1` with:
  * `original_proposal_id` pointing to original proposal
  * `edited_fields[]` listing what was changed
  * `edited_by` (user ID)
  * `edited_at` (timestamp)
* Original proposal remains **immutable** in ledger
* Edited action is treated as a new intent (not a mutation)

**Approval Record:**
* Every action (approved or rejected) has an approval record
* Approval record includes:
  * Original proposal ID
  * Edited fields (if any)
  * Approver/rejector ID
  * Timestamp
  * Reason (if rejected)

**Acceptance Criteria**

* Every action has an approval record
* Original proposals are immutable
* Edited actions create new intents with provenance
* Rejections are fed back as outcome signals (later phases)
* Edit constraints are enforced (locked fields cannot be changed)

---

## EPIC 3.4 — Ledger, Audit, Explainability

### Story 3.4.1 — Decision Ledger Events

**New Ledger Events**

* `DECISION_PROPOSED`
* `POLICY_EVALUATED`
* `ACTION_APPROVED`
* `ACTION_REJECTED`

**Acceptance Criteria**

* Full decision chain traceable via `trace_id`
* Evidence pointers preserved

---

### Story 3.4.2 — "Why this?" Explainability Panel

**Shows**

* Top signals
* Key evidence snapshots
* Policy reasoning (human-readable)
* Confidence explanation

**Acceptance Criteria**

* No prompt leakage
* Clear causal chain

---

## EPIC 3.5 — Guardrails & Cost Control

### Story 3.5.1 — Decision Cost Budgeting

**Rules**

* Max decisions per account/day
* Max deep-context fetches
* Confidence gating for expensive context

**Acceptance Criteria**

* Budget breaches block decisions
* Budget usage visible in metrics

---

### Story 3.5.2 — Uncertainty Handling

**Behavior**

* If blocking unknowns exist:
  * ask **one** minimal human question
  * do not proceed otherwise

**Acceptance Criteria**

* Unknowns always explicit
* No silent assumptions

---

## APIs Introduced in Phase 3

* `POST /decisions/evaluate`
* `GET /accounts/{id}/decisions`
* `POST /actions/{id}/approve`
* `POST /actions/{id}/reject`

All APIs are:

* Tenant-scoped
* Trace-aware
* Ledger-backed

---

## Phase 3 Definition of Done

Phase 3 is complete when:

* The system can propose next actions for any account
* Every proposal is:
  * Evidence-backed
  * Confidence-scored
  * Policy-gated
* Humans intervene **only** at approval points
* All decisions are auditable and replayable
* No actions execute without explicit approval

---

## Phase 3 → Phase 4 Handoff

Phase 4 introduces:

* Bounded execution
* Connector write-backs
* Retries and compensation
* Partial autonomy under policy

Phase 3 ensures Phase 4 is **safe**.

---

## Decision Flow Sequence

```
1. Trigger Event (lifecycle transition, high-signal, user request)
   ↓
2. Decision Context Assembler
   - Fetch AccountPostureState (DDB)
   - Fetch active signals + evidence refs (bounded)
   - Fetch graph neighborhood (Neptune, depth <= 2)
   - Fetch tenant policy config
   - Assemble DecisionContextV1
   ↓
3. Decision Synthesis Service
   - Call Bedrock with DecisionContextV1
   - Enforce DecisionProposalV1 schema (fail-closed)
   - Generate action proposals
   ↓
4. Policy Evaluation Engine
   - Evaluate each proposed action
   - Classify: allowed / blocked / approval_required
   - Annotate with reason codes
   ↓
5. Human Decision Surface (if approval required)
   - Display ranked proposals
   - Show "why" (signals, evidence, confidence)
   - Allow approve / edit / reject
   ↓
6. Action Intent Creation
   - Create ActionIntentV1 (approved or edited)
   - Preserve original proposal ID (provenance)
   - Record edited fields (if any)
   ↓
7. Ledger Events
   - DECISION_PROPOSED
   - POLICY_EVALUATED
   - ACTION_APPROVED / ACTION_REJECTED
   ↓
8. (Phase 4) Execution
   - Approved ActionIntentV1 → Execution Layer
```

**Key Points:**
* Each step is bounded and deterministic (except LLM synthesis)
* Policy gate is code-only (no LLM influence)
* Human edits create new intents (original preserved)
* Full traceability via ledger events

---

## One-Line Internal Framing

> **Phase 3 teaches the system judgment — not just awareness.**

---

## Next Steps

1. **Design DecisionProposal Schema** - Define TypeScript types and validation
2. **Design Decision Context Assembler** - Bounded context fetching service
3. **Design Policy Gate** - Deterministic action classification rules
4. **Design Human Approval UI** - Seller-facing decision surface
5. **Design Ledger Events** - Decision audit trail
6. **Design Cost Budgeting** - Guardrails for LLM usage

---

## Related Documents

* `WORLD_MODEL_CONTRACT.md` - Truth layer foundation
* `AGENT_READ_POLICY.md` - Confidence gating and autonomy tiers
* `PHASE_2_IMPLEMENTATION_PLAN.md` - Situation graph and synthesis (prerequisite)
* `GRAPH_CONVENTIONS.md` - Graph query patterns and conventions
