# Implementation Approach

## AgentCore-Native Autonomous Revenue Decision Loop

---

### Implementation Reality (Updated)

The original implementation approach anticipated that "Phase 6" would focus on trust, quality, and cost controls.

During execution, the system required a **governed orchestration layer** before those controls could be meaningfully enforced.

As a result:

* Phase 6 was redefined to deliver **Plan-based Autonomous Orchestration**
* Trust, quality, and cost controls are now deferred to **Phase 7**, where they can be enforced uniformly across plans, tools, and execution

---

### Phase Mapping (Original Concept → Actual Implementation)

| Original Concept        | Actual Implementation |
|-------------------------|------------------------|
| Phase 1: Assist          | Phase 1–3 (Signals, Tools, Decisions) |
| Phase 2: Partial Auto    | Phase 4–5 (Deterministic Execution) |
| Phase 3: Trust Layer    | Phase 7 (Validators, Budgets, Audit) |
| Phase 6 (Original)      | Phase 6 (Plan Orchestration) |

---

## Phase 0 — Foundations (platform skeleton)

**Goal:** establish tenant identity, event spine, storage, and audit so everything later is governed and traceable.

### Build

1. **Tenancy + Identity**

* Cognito / IAM Identity Center (user auth)
* AgentCore Identity (agent/tool auth)
* Tenant model: `tenant_id`, roles, permissions

2. **Event spine**

* EventBridge bus + standard event envelope:

  * `trace_id`, `tenant_id`, `account_id`, `source`, `event_type`, `ts`

3. **Stores**

* S3 buckets:

  * `raw_snapshots/`
  * `artifacts/`
  * `ledger_archives/` (Object Lock optional)
* DynamoDB tables:

  * `Accounts`
  * `Signals`
  * `ToolRuns` (tool call results pointers)
  * `ApprovalRequests`
  * `ActionQueue`
  * `PolicyConfig`

4. **Ledger**

* QLDB (preferred) or DynamoDB append-only + S3 WORM archive
* Define ledger event types now (INTENT, SIGNAL, TOOL_CALL, VALIDATION, ACTION, APPROVAL)

### Definition of done

* Every request has `trace_id`
* Every event and tool call is recorded in ledger
* Multi-tenant isolation enforced at API + storage layer

---

## Phase 1 — Perception V1 (signals without data-lake pain)

**Goal:** create cheap, high-signal detectors that produce canonical signals with minimal source load.

### Build

1. **Connector fabric**

* API Gateway webhook handlers (push sources)
* EventBridge Scheduler + Step Functions (pull sources)
* Secrets Manager for credentials
* SQS throttling per connector

2. **Perception pipeline (Step Functions)**

* fetch snapshot (delta/modified-since where possible)
* normalize
* diff against previous (DDB hash + S3 snapshot)
* emit **canonical Signals** to DynamoDB + EventBridge

3. **Signal catalog**
   Implement ~10–15 canonical signal types (start small):

* `RENEWAL_WINDOW_ENTERED`
* `CLOSE_DATE_SLIPPED`
* `STAKEHOLDER_CHANGED`
* `SUPPORT_SEV2_AGING`
* `USAGE_DROP_PERCENT`
* `NO_MEETING_IN_21_DAYS`
  Each signal must include:
* severity, confidence, evidence refs, TTL

### Definition of done

* Signals are produced reliably for selected sources
* Source cost is bounded (no full scans; delta-only)
* Each signal links to evidence (record IDs / snapshot pointers)

---

## Phase 2 — World Model (Situation Graph + retrieval plane)

**Goal:** make signals accumulate into "account reality," not a noisy feed.

### Build

1. **Situation Graph (Neptune)**

* entity schema: Account, Contact, Opportunity, Product, Risk, Event, Interaction
* update graph from signals (graph upserts)

2. **Artifact pipeline**

* S3 artifacts: meeting briefs, summaries, extracted notes
* chunking + embedding pipeline (to Pinecone)
* store chunk text in S3; Pinecone stores vectors + minimal metadata

3. **Account state service**

* `account.get_state(account_id)` returns:

  * posture, risks, unknowns, momentum, last changes

### Definition of done

* For any account, you can retrieve:

  * current posture
  * top risks + why
  * recent changes
  * supporting artifacts

---

## Phase 3 — Tool Plane (AgentCore Gateway)

**Goal:** standardize all read/write operations as governed tools.

### Build

1. **Tool Catalog**
   Define a stable tool contract set (10–15 tools max to start):

* `signals.list_recent`
* `crm.get_commercial_window`
* `support.get_risk_summary`
* `telemetry.get_health_summary`
* `memory.search`
* `draft.meeting_brief`
* `approve.request`
* `crm.write_update` (internal-only initially)

2. **Expose tools through AgentCore Gateway**

* Tools implemented as Lambda/OpenAPI services
* Register them in AgentCore Gateway
* Ensure AgentCore Identity is used for auth to external systems

3. **Tool run persistence**

* Each tool call produces:

  * `ToolRun` record in DDB
  * artifact output in S3 (if large)
  * ledger event

### Definition of done

* Agent can discover tools and invoke them through Gateway
* Every tool call is authorized, budgeted, and logged
* Tool outputs are reproducible via artifact refs

---

## Phase 4 — Decision Agent (AgentCore Runtime)

**Goal:** implement the decision protocol: propose actions, request deeper data, route approvals.

### Build

1. **Decision protocol (hard contract)**
   Agent output must be one of:

* `ACTION_PROPOSALS`
* `DATA_REQUEST` (tool calls)
* `CLARIFICATION_REQUEST`
* `APPROVAL_REQUEST`
* `NO_ACTION`

2. **Decision loop execution**

* Triggered by:

  * `SIGNAL_BATCH_READY`
  * `MEETING_UPCOMING`
  * user "what should I do next?"
* Agent fetches:

  * account state + recent signals
  * retrieves relevant memory via Pinecone
* Agent requests deeper data only when needed via Gateway tools
* Agent proposes ranked actions with confidence + evidence refs

3. **Uncertainty handling**

* If blocked, ask one minimal question
* If human-touch, create ApprovalRequest

### Definition of done

* For a given account, agent reliably produces:

  * top actions
  * why now
  * evidence
  * approval routing when needed

---

## Phase 5 — Action Execution + Human Touch UX

**Goal:** make the system actually *drive* the lifecycle with humans in the loop only when required.

### Build

1. **Action executors**

* Step Functions for multi-step actions
* Lambda for simple actions
* SQS throttling per connector

2. **Approval UI**

* Top Actions feed (territory + account)
* "Why this?" evidence panel
* Approval center:

  * approve / edit / reject
* Agent Timeline view:

  * signals → tools → validations → action

3. **Write-back policies**

* Start with safe internal writes:

  * create tasks
  * log notes
  * attach briefs
* Gate risky writes behind approval

### Definition of done

* Seller can go from recommendation → approval → execution in <60 seconds
* Every action is auditable and reversible where applicable

---

## Phase 6 — Autonomous Plan Orchestration

**Status:** COMPLETE

**Delivered:**

* Governed plan artifact (RevenuePlans, plan lifecycle API)
* Deterministic orchestrator (APPROVED → ACTIVE, step dispatch)
* Conflict invariants (one active plan per account/type; 409 + ledger)
* UI visibility & explainability (plan list, detail, resume/pause)
* Audit-grade ledger (Plan Ledger, PLAN_ACTIVATION_REJECTED, etc.)
* E2E certification (conflict resolution, Plans API happy path, orchestrator cycle)

---

## Phase 7 — Trust, Quality, and Cost Controls (enterprise hardening)

**Next:** Trust, quality, and cost controls — enforced uniformly across plans, tools, and execution.

**Goal:** scale autonomy safely across tenants.

### Build

1. **Validators**

* freshness, grounding, contradiction, compliance
* block or warn with reasons

2. **Budgets**

* per-tenant, per-tool, per-account
* cost classes: CHEAP/MED/EXP
* "Tier-2 reads require justification"

3. **Observability**

* CloudWatch dashboards:

  * tool usage, cost class counts, decision latency
  * blocked actions rate
  * approval rate
  * signal-to-action conversion

4. **Learning loop**

* capture outcomes:

  * accepted actions, rejected actions, reply outcomes, win/loss
* train ranking/calibration later (SageMaker)

### Definition of done

* You can prove:

  * why an action happened
  * what data it used
  * what policy allowed it
  * what the user approved
  * what changed in memory

---

# Practical sequencing (what I'd do first)

If your first wedge is **Meeting Prep Agent**:

1. Perception signals for:

* upcoming meeting
* renewal window
* support risk
* usage changes

2. World model + retrieval:

* notes, last meeting summary, open issues

3. Decision agent:

* generates meeting brief + next actions

4. Approval UX:

* approve sending follow-up (human-touch)

This gives you an investor-grade demo fast, while staying on the end-state rails.

---

## "Definition of AI-native" checkpoints (useful internally)

You're AI-native when:

* the system **initiates** action proposals (not user prompted)
* it requests deeper data **only when needed**
* it routes approvals only for human-touch
* every step is **auditable**
* costs are **budgeted**

---

If you want, I can turn this into:

* a repo-ready `IMPLEMENTATION_PLAN.md`
* a sprint plan with epics/stories
* or a diagram showing which phases unlock which investor demo moments
