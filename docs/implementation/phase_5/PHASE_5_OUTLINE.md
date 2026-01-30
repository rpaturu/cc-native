# Phase 5 — Outline

*Always-On Autonomy (Controlled) + Learning Loop*

**Status:** 🟡 **PLANNING**  
**Created:** 2026-01-28  
**Last Updated:** 2026-01-28  
**Prerequisites:** Phase 4 complete (4.5A signed off 2026-01-28). End-to-end spine: **Decide → Approve → Execute → Outcome → Ledger**.

---

## Phase 5 objective (precise)

Turn the system from "executes approved intents" into an **always-on revenue engine** that:

- **continuously monitors accounts**
- **proactively proposes** the best next actions
- runs **safe autopilot** for low-risk actions
- improves over time via **outcome feedback**, without breaking policy

**Investor story:** "Now it compounds."

---

## Implementation order (recommended)

| Priority | Sub-phases | Rationale |
|----------|------------|-----------|
| **First** | **5.1 + 5.4** — Autonomy modes + AutoApprovalPolicy | Unlocks "AI-native" behavior safely, without learning yet. |
| **Next** | 5.2 + 5.3 — Perception scheduling + Decision triggers | Always-on push + pull; when to run Phase 3. |
| **Then** | 5.5 — Outcome feedback → ranking | Learning loop (scoring, ranking, calibration). |
| **Then** | 5.6 — Autonomy Control Center (UI) | Seller + admin surfaces for legibility and control. |
| **Ongoing** | 5.7 — Reliability hardening | Circuit breakers, SLOs, replay, backpressure, tenant isolation. |

---

## 5.1 Autonomy Modes (formalize)

You already have bounded execution (Phase 4); now add **autonomy tiers**:

| Mode | Description |
|------|-------------|
| **1. Assist (Propose only)** | System proposes; human always decides and triggers. |
| **2. Execute w/ human approval** | Current behavior — human approves, then execution. |
| **3. Autopilot for low-risk actions** | Policy-allowed actions execute without human approval. |
| **4. Autonomous schedules** | Time-based or event-based autonomous runs (controlled). |

**Core rule:** Autopilot = *policy-allowed + low-risk + reversible + idempotent + auditable*.

**Mode 4 (Autonomous schedules) — hard requirements (contractual, not cosmetic):**
- **Explicit opt-in** per tenant/account before any autonomous schedule runs
- **Autonomy budget** per seller/account (e.g. max autonomous actions per day; enforced before execution)
- **Daily digest** as a gate: sellers receive a summary of what autopilot did; no "wake up to N surprises" without prior opt-in and digest

**Deliverable:** Formal autonomy mode per tenant/account (or global default); used by Decision and Execution layers to route actions.

---

## 5.2 Always-On Perception Triggering (push + pull)

Make perception triggering explicit and cost-safe.

### A) Push triggers (already supported)

- Webhook events (CRM updates, meeting created, ticket escalated)
- External signals (news, hiring, product usage anomalies)

### B) Pull orchestration (new, cost-safe)

- **Heat-based polling** and **coverage sweeps**
- Per-tenant budgets + per-connector caps
- Adaptive cadence (hot accounts hourly, cold accounts weekly)

**Deliverable:** `PerceptionScheduler` that decides *when to pull* and *how deep to go*.

---

## 5.3 Decision Loop Scheduling ("Always-On Decisions")

Create a **DecisionTrigger** layer (not the LLM) that decides *when* to run Phase 3:

- On new signal arrival
- On account entering a lifecycle state change (prospect → suspect → customer)
- On "time-based rituals" (morning brief, weekly territory review, renewal runway)

**Key constraint:** Triggers are **deterministic + logged**. The LLM still only synthesizes.

**DecisionCostGate (pre-Phase-3, required):**  
Nothing today answers "Is it worth running a decision *right now*?" Without a cost gate, always-on becomes always-expensive.

- **Runs after** DecisionTrigger, **before** Phase 3 (LLM).
- **Inputs:** budget remaining, recency, action saturation, tenant tier.
- **Output:** `ALLOW | DEFER | SKIP` (with reason).
- No Phase 3 invocation when CostGate returns DEFER or SKIP; all decisions logged.

**Flow:** Signal → DecisionTrigger → **DecisionCostGate** → Phase 3.

**Deliverable:** Trigger definitions + **DecisionCostGate** + scheduler integration; audit log of why a decision run was triggered or skipped.

---

## 5.4 Auto-Approval Policy (the big unlock)

Define what is allowed to execute **with no human**:

**Typical low risk (auto-execute candidates):**

- Create internal note
- Create internal follow-up task
- Generate a meeting brief
- Draft an email (not send)
- Open an approval request pre-filled with context

**High risk (never autonomous):**

- Send email
- Change opportunity stage / forecast
- Modify pricing / discount fields
- Contact a customer externally

**Deliverable:** `AutoApprovalPolicyV1` (OPA/Lambda policy). Output is **rich**, not just a code:

- **decision:** `AUTO_EXECUTE | REQUIRE_APPROVAL | BLOCK`
- **reason:** e.g. `EXTERNAL_CONTACT`, `RISK_LEVEL_HIGH`, `TENANT_POLICY` (for audit and learning)
- **policy_clause:** which rule/clause produced the result
- **explanation:** human-readable (seller trust, UI, compliance)

Without reason + explanation, blocked actions are opaque and learning/audit suffer. Required from day one.

---

## 5.5 Outcome Feedback → Ranking (Learning without chaos)

Phase 4 already emits execution outcomes as signals. Phase 5 makes that useful.

**OutcomeTaxonomyV1 (minimal, required):**  
"Success/failure" and "approved/rejected" collapse too many meanings: bad idea ≠ bad timing ≠ bad execution ≠ external constraint. Learning quality plateaus without disambiguation.

- **IDEA_REJECTED** — human rejected the proposal
- **IDEA_EDITED** — human edited then approved
- **EXECUTION_FAILED** — execution attempted and failed
- **EXECUTION_SUCCEEDED** — execution attempted and succeeded
- **NO_RESPONSE** — (later) no response from recipient
- **NEGATIVE_RESPONSE** — (later) negative response

Labels first; ML later. This doesn't mean ML yet — it means **better labels**.

**Inputs:**

- Approved vs rejected actions (with taxonomy)
- Edits to drafts
- Executed outcomes (with taxonomy)
- Response outcomes (reply/no reply) — later

**Outputs:**

- Better action ranking
- Better confidence calibration
- Better "next best action" selection

**Important:** Initial version is **not** retraining the LLM. It is:

- Scoring + ranking models (SageMaker optional)
- Heuristics tuned by data
- Evaluation harness + offline replay

---

## 5.6 UI: Autonomy Control Center (admin + seller)

Surfaces that make autonomy **legible and controllable**.

**Seller UI:**

- "What should I do next?" feed
- "Autopilot did X" timeline
- "Needs your input" inbox

**Admin UI:**

- Configure auto-approval scope
- Budgets and connector rate limits
- Kill switches + audit exports
- Tool registry + action type registry management

---

## 5.7 Reliability Hardening (production)

Stabilize for production:

- Connector circuit breakers
- Per-tool SLOs
- Replay tooling ("re-run execution from intent")
- Backpressure policies
- Tenant isolation verification

---

## Definition of Done — Phase 5

Phase 5 is complete when:

- [ ] System runs **daily** without manual prompting
- [ ] Account monitoring is **continuous** (push + pull)
- [ ] **Some** actions execute autonomously (low-risk only)
- [ ] High-risk actions **always** route to humans
- [ ] Outcomes **measurably** improve action ranking (or harness in place)
- [ ] Every autonomous act is **fully auditable**
- [ ] **DecisionCostGate** in place (pre-Phase-3); cost governance auditable
- [ ] **AutoApprovalPolicyV1** returns reason + explanation for BLOCK/REQUIRE_APPROVAL
- [ ] **OutcomeTaxonomyV1** in use (outcomes labeled, not conflated)
- [ ] **Trust safeguards** for autonomous schedules: explicit opt-in, autonomy budget, daily digest (gates, not optional UI)

---

## References

- **Phase 5 implementation plan (epics & stories):** [PHASE_5_IMPLEMENTATION_PLAN.md](PHASE_5_IMPLEMENTATION_PLAN.md)
- **Phase 4 completion:** `../phase_4/PHASE_4_5_CODE_LEVEL_PLAN.md` (signed off 2026-01-28)
- **Phase 4 parent:** `../phase_4/PHASE_4_CODE_LEVEL_PLAN.md`
- **Execution spine:** Decide → Approve → Execute → Outcome → Ledger
