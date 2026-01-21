# AUTONOMOUS_REVENUE_DECISION_LOOP.md

## 1) Purpose

Define an **AI-native autonomous revenue system** that continuously:

* synthesizes information into understanding
* identifies and prioritizes actions
* executes actions where allowed
* escalates to humans only when required
* learns and adapts within explicit guardrails

This system is **not a workflow engine**.
It is a **decision and execution loop** governed by policy, confidence, and risk.

---

## 2) Core Principle

> The system does not follow predefined steps.
> It **forms a situation model, reasons about next actions, and acts autonomously** — with humans supervising only when actions touch people or uncertainty is high.

Autonomy is bounded by **policy, permissions, and uncertainty**, not scripts.

---

## 3) Mental Model (AI-Native)

The system operates as a **continuous loop**, triggered by events or user prompts.

### Autonomous Loop

1. **Perceive**
2. **Synthesize**
3. **Decide**
4. **Act**
5. **Escalate (when required)**
6. **Learn**

This loop may run:

* on user request ("prep me for Acme")
* on events (deal stage change, usage spike, escalation)
* on schedule (daily account health scan)

---

## 4) System Architecture

### 4.1 World Model (Situation Graph)

The system maintains a **Situation Graph** — a living model of reality.

**Inputs**

* Seeded admin knowledge (ICP, personas, playbooks, tone, policies)
* CRM data
* Product usage signals
* Support signals
* Meetings, notes, emails
* External signals (news, hiring, exec changes)

**Situation Graph captures**

* Account state
* Opportunity state
* Stakeholder map
* Momentum and risk indicators
* Open questions / unknowns
* Candidate actions with confidence

This is *not* a database mirror.
It is a **synthesized understanding**.

---

### 4.2 Admin Guidance & Guardrails (Control Layer)

Admins do **not** define workflows.
They define **operating constraints**.

**Admin configures**

* Allowed action classes per agent
* What actions require approval
* Confidence thresholds
* Compliance constraints
* Tone and messaging guardrails
* Data access boundaries
* Escalation rules

This creates **safe autonomy**.

---

## 5) Decision Layer (LLM Deliberation)

The LLM is responsible for **thinking**, not executing steps.

For each loop iteration, it performs:

1. **Situation interpretation**

   * What is happening?
   * What has changed?
   * What matters now?

2. **Hypothesis generation**

   * Why is this deal at risk?
   * What is the likely buyer intent?
   * What signal explains recent behavior?

3. **Action proposal**

   * Identify top candidate actions
   * Estimate expected value
   * Estimate confidence
   * Classify risk

4. **Uncertainty assessment**

   * Is there missing or contradictory information?
   * Can a decision be made safely?

---

## 6) Action Proposal Model (Key Shift)

Instead of a task plan, the system produces **Action Proposals**.

Each proposal includes:

* `action_type`
* `description`
* `expected_outcome`
* `required_inputs`
* `risk_class`
* `confidence`
* `human_required` (yes/no)
* `why_now`

### Example proposals

* "Generate a concise meeting brief for tomorrow's Acme call"
* "Draft (not send) a follow-up email focused on renewal risk"
* "Ask user to clarify whether this call is renewal-focused or expansion-focused"

---

## 7) Action Classes & Autonomy Rules

### Action Classes

1. **Internal, non-destructive**

   * briefs, summaries, drafts, analysis
   * ✅ fully autonomous

2. **Internal state mutation**

   * CRM updates, task creation, tagging
   * ✅ autonomous if policy allows + confidence high

3. **External human-touch**

   * sending emails, scheduling meetings, customer messaging
   * ⛔ requires human approval (V1/V2)

4. **Clarification / Escalation**

   * asking a targeted human question
   * ✅ autonomous when blocked by uncertainty

---

## 8) Acting Layer (Execution)

Once an action is approved by policy:

* the system selects tools dynamically
* executes the action
* records outcomes
* updates the Situation Graph

Execution is **tool-agnostic** and policy-gated.

---

## 9) Human Escalation (Only When Needed)

Humans are involved when:

* the action touches another human
* the system's confidence is below threshold
* policy requires approval
* critical contradictions exist

### Escalation Rule

> The system must ask the **minimum question necessary** to proceed.

**Good escalation**

> "To proceed, I need one clarification: is tomorrow's call focused on renewal risk or expansion?"

**Bad escalation**

> "I'm unsure how to proceed. Please advise."

---

## 10) Learning & Adaptation (Safe Learning)

The system learns from:

* human approvals / rejections
* edits to drafts
* meeting outcomes
* reply outcomes

Learning updates:

* ranking of actions
* confidence calibration
* signal weighting

**Hard rule**

> Learning tunes *preferences and thresholds*, not autonomy scope or compliance rules.

---

## 11) Transparency & Trust

Every loop iteration produces:

* reasoning summary ("why this action")
* evidence pointers
* confidence indicators
* escalation rationale (if any)

This creates **debuggability without exposing chain-of-thought**.

---

## 12) Meeting Prep Agent as First Instance

Meeting Prep is simply:

> A specialized autonomous loop instance optimized for **low-risk, high-frequency decision support**.

It:

* synthesizes account state
* proposes prep actions
* autonomously generates briefs
* escalates only when intent or context is ambiguous

No workflows.
Just decisions.

---

## 13) One-Sentence Summary (Investor-grade)

> This system is a **policy-governed autonomous decision loop** that continuously converts information into action, involving humans only when actions touch people or uncertainty is high.

---

### Final take (direct)

You were right to push back.

This framing:

* **feels native to LLMs**
* avoids brittle workflows
* still gives you governance, safety, and trust
* scales from Meeting Prep → Outreach → Full autonomy

If you want next, I can:

* map **Meeting Prep Agent** explicitly into this loop
* define the **Action Proposal schema** in code
* design the **Admin Control Plane UI**
* or help you name this category properly (because now it *is* one)

Just tell me where you want to go next.
