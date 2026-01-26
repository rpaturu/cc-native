# Phase 4 — Bounded Execution & AI-Native Action Fulfillment

**Status:** 🟡 **PLANNED**  
**Prerequisites:** Phase 0 ✅ Complete | Phase 1 ✅ Complete | Phase 2 ✅ Complete | Phase 3 ✅ Complete  
**Dependencies:** Phase 3 produces approved `ActionIntentV1` objects that need execution

**Created:** 2026-01-26  
**Last Updated:** 2026-01-26

---

## Why Phase 4 Exists (One Sentence)

> Phase 4 turns **approved ActionIntents** into **real-world effects**—safely, reversibly, and audibly—without introducing autonomy risk.

**What You Already Have:**
- ✅ Truth (posture, signals, graph, evidence)
- ✅ Judgment (decision synthesis, policy evaluation)
- ✅ Governance (human approval, audit trail)
- ✅ Human control points (approve/reject/edit)

**What Phase 4 Adds:**
- Execution of approved actions
- Connector write-backs to external systems
- Retry and compensation logic
- Full execution auditability

---

## Phase 4 Objective (Precise)

Convert `ActionIntentV1` → **executed outcome** via:

* Deterministic orchestration
* Connector-safe writes
* Retries + compensation
* Full auditability

**Critical Constraint:**
> **No new decisions. No new LLM judgment.**

Execution only fulfills what was already approved. If something is ambiguous, execution halts, intent expires, and human is notified.

---

## Core Phase 4 Invariant

> **Execution never re-decides. It only fulfills.**

**Enforcement:**
- Execution receives `ActionIntentV1` (already approved)
- No LLM calls during execution
- No policy re-evaluation
- No decision re-synthesis
- If ambiguous → halt → notify human

---

## Phase 4 System Model

```
Approved ActionIntent (from Phase 3)
  ↓
Execution Orchestrator (Step Functions)
  ↓
Connector Adapter (stateless, idempotent)
  ↓
External System (CRM, Calendar, Email, etc.)
  ↓
Outcome Recorded (Ledger + Signals)
  ↓
Feedback Loop (for future phases)
```

**Key Properties:**
- One execution per `action_intent_id` (idempotent)
- Execution TTL enforcement (intents expire)
- Partial failure handling (compensation where possible)
- Full audit trail (every step logged)

---

## Scope Boundaries (Non-Negotiable)

### In Scope

* Execution orchestration (Step Functions)
* Connector adapters (CRM, Calendar, internal systems)
* Retry logic with backoff
* Compensation for reversible actions
* Execution outcome tracking
* Kill switches and safety controls
* Execution status UI/API

### Explicitly Out of Scope

* Learning / ranking optimization
* Auto-approval (still requires human approval from Phase 3)
* Fully autonomous background actions
* Outbound email execution (Phase 5+)
* Self-healing execution (Phase 5+)

---

## EPIC 4.1 — Execution Orchestrator

**Purpose:** Owns lifecycle of execution, enforces idempotency, handles retries + failure modes

### Story 4.1.1 — Step Functions State Machine

**Tasks:**
- Create Step Functions state machine for action execution
- States: `PENDING` → `EXECUTING` → `SUCCEEDED` / `FAILED` / `EXPIRED`
- Enforce execution TTL (from `ActionIntentV1.expires_at_epoch`)
- Idempotency key: `action_intent_id`

**Acceptance Criteria:**
- Same intent cannot execute twice (idempotency check)
- Execution halts if intent expired
- State transitions logged to ledger
- Partial failure does not corrupt state

### Story 4.1.2 — Execution Service

**Tasks:**
- Create `ExecutionService` to manage execution lifecycle
- Methods: `executeActionIntent()`, `getExecutionStatus()`, `cancelExecution()`
- Integrate with Step Functions
- Handle execution state persistence (DynamoDB)

**Acceptance Criteria:**
- Execution can be queried by `action_intent_id`
- Execution can be cancelled (if not completed)
- Execution state is persisted and recoverable

### Story 4.1.3 — Retry Logic

**Tasks:**
- Implement exponential backoff for transient failures
- Max retry attempts per action type (configurable)
- Retry only for transient errors (not permanent failures)
- Log retry attempts to ledger

**Acceptance Criteria:**
- Transient failures retry with backoff
- Permanent failures fail immediately (no retry)
- Retry count tracked and logged
- Retry exhaustion triggers failure notification

---

## EPIC 4.2 — Connector Write Adapters

**Purpose:** Stateless, idempotent adapters for external system writes

### Story 4.2.1 — Connector Adapter Interface

**Tasks:**
- Define `IConnectorAdapter` interface
- Methods: `execute()`, `validate()`, `compensate()` (where applicable)
- Idempotency contract: same input → same output
- Error classification: transient vs permanent

**Acceptance Criteria:**
- All adapters implement same interface
- Adapters are stateless (no internal state)
- Adapters are idempotent (safe to retry)

### Story 4.2.2 — CRM Adapter (Initial)

**Scope (Initial):**
- Create task
- Update field
- Create opportunity

**Tasks:**
- Implement CRM connector adapter
- Handle authentication (OAuth, API keys)
- Map `ActionIntentV1.parameters` to CRM API calls
- Return external object IDs for tracking

**Acceptance Criteria:**
- CRM writes succeed for supported action types
- External object IDs captured and logged
- Failures are classified (transient vs permanent)
- No cross-tenant data leakage

### Story 4.2.3 — Calendar Adapter (Initial)

**Scope (Initial):**
- Draft meeting request (not send, just draft)

**Tasks:**
- Implement Calendar connector adapter
- Map action parameters to calendar API
- Create draft events (not sent)
- Return calendar event IDs

**Acceptance Criteria:**
- Calendar drafts created successfully
- Event IDs captured for tracking
- Drafts can be reviewed before sending (Phase 5+)

### Story 4.2.4 — Internal Systems Adapter

**Scope:**
- Create internal tasks
- Log notes
- Attach briefs

**Tasks:**
- Implement internal system adapter
- Write to internal DynamoDB tables
- No external API calls (safer for initial phase)

**Acceptance Criteria:**
- Internal writes succeed
- Data persisted correctly
- Reversible where applicable

---

## EPIC 4.3 — Outcome & Feedback Capture

**Purpose:** Record execution outcomes and feed back into system

### Story 4.3.1 — Execution Outcome Recording

**Tasks:**
- Emit `ACTION_EXECUTED` or `ACTION_FAILED` ledger events
- Capture: timestamps, external object IDs, failure reasons
- Store execution outcomes in DynamoDB
- Link outcomes to original `ActionIntentV1`

**Acceptance Criteria:**
- All executions produce outcome records
- Outcomes are queryable per account
- Execution does not mutate original decision records
- Full traceability: decision → approval → execution → outcome

### Story 4.3.2 — Signal Emission

**Tasks:**
- Emit signals for execution outcomes
- Signal types: `ACTION_EXECUTED`, `ACTION_FAILED`
- Include execution metadata in signals
- Feed signals back into Phase 1 perception layer

**Acceptance Criteria:**
- Execution outcomes generate signals
- Signals are processed by existing perception layer
- Execution feedback influences future decisions (Phase 5+)

---

## EPIC 4.4 — Safety & Kill Switches

**Purpose:** Mandatory safety controls for execution

### Story 4.4.1 — Execution Toggles

**Tasks:**
- Per-tenant execution toggle (DynamoDB config)
- Per-action-type disablement (policy config)
- Global emergency stop (environment variable)
- Toggle checks before execution starts

**Acceptance Criteria:**
- Execution can be halted without redeploy
- In-flight executions fail safely when toggled off
- Kill events are logged to ledger
- Toggles are queryable via API

### Story 4.4.2 — Execution Monitoring

**Tasks:**
- CloudWatch alarms for execution failures
- Execution rate monitoring
- Connector health checks
- Alert on execution anomalies

**Acceptance Criteria:**
- Execution failures trigger alerts
- Execution rate is monitored
- Connector health is visible
- Anomalies are detected and alerted

---

## EPIC 4.5 — UI: "Executed / Pending / Failed"

**Purpose:** Seller-facing execution status visibility

### Story 4.5.1 — Execution Status API

**Tasks:**
- `GET /actions/{action_intent_id}/status` - Get execution status
- `GET /accounts/{account_id}/executions` - List executions for account
- Filter by status: `PENDING`, `EXECUTING`, `SUCCEEDED`, `FAILED`, `EXPIRED`
- Include execution metadata and outcomes

**Acceptance Criteria:**
- Execution status is queryable via API
- Status includes human-readable explanations
- Failed executions show failure reasons
- No system internals exposed (clean API)

### Story 4.5.2 — Execution Timeline

**Tasks:**
- Show execution timeline: decision → approval → execution → outcome
- Display execution steps and retries (simplified view)
- Show external object IDs (where applicable)
- Link to original decision proposal

**Acceptance Criteria:**
- Timeline is human-readable
- Retry noise is hidden (show only final outcome)
- Connector errors are explained (not raw error messages)
- Full audit trail is accessible (via ledger)

---

## Phase 4 Definition of Done

Phase 4 is complete when:

- ✅ Approved actions execute deterministically
- ✅ No action executes without approval (Phase 3 gate)
- ✅ Execution failures are visible and recoverable
- ✅ Ledger shows full **decision → approval → execution** chain
- ✅ System remains safe under retries, outages, and connector failures
- ✅ At least 2 connector adapters implemented (CRM + one other)
- ✅ Kill switches operational
- ✅ Execution status visible via API

---

## Phase 4 → Phase 5 Handoff

Phase 5 introduces:

* Learning / ranking optimization
* Auto-approval for low-risk actions
* Fully autonomous background actions (with policy)
* Outbound email execution
* Self-healing execution

Phase 4 ensures Phase 5 is **safe to expand autonomy**.

---

## Implementation Approach

### Recommended Starting Point

1. **Start with 1-2 execution adapters:**
   - Internal systems adapter (safest, no external dependencies)
   - CRM adapter (most valuable, one external system)

2. **Keep execution boring:**
   - No LLM calls
   - No decision re-evaluation
   - Just fulfill what was approved

3. **Preserve every invariant:**
   - Idempotency
   - Auditability
   - Human control
   - Zero Trust networking

### Implementation Order

1. **Week 1-2:** Execution Orchestrator (Step Functions + Execution Service)
2. **Week 3-4:** Internal Systems Adapter + Execution Outcome Recording
3. **Week 5-6:** CRM Adapter + Safety Controls
4. **Week 7:** Execution Status API + Testing

**Total Duration:** 6-7 weeks

---

## Executive Framing

> "By Phase 4, the system doesn't just know *what* to do and *why*—  
> it can **act safely in the real world**, under human control."

---

## Next Steps

1. ✅ Phase 4 plan documented
2. ⏳ Create Phase 4 code-level implementation plan
3. ⏳ Choose initial execution actions to implement
4. ⏳ Design Step Functions state machine
5. ⏳ Design connector adapter interface
6. ⏳ Begin EPIC 4.1 implementation

---

**Ready to proceed?** Start with EPIC 4.1 (Execution Orchestrator) to establish the foundation for safe, bounded execution.
