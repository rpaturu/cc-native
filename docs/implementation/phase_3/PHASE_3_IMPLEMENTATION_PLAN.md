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

* `action_type`
* `target_entity`
* `parameters`
* `approved_by`
* `approval_timestamp`
* `execution_policy`
* `expires_at`

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
* Edit parameters
* Reject with reason

**Acceptance Criteria**

* Every action has an approval record
* Rejections are fed back as outcome signals (later phases)

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
