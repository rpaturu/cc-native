# Phase 5 — Implementation Plan

*Always-On Autonomy + Learning Loop (Controlled)*

**Status:** 🟡 **PLANNING**  
**Created:** 2026-01-28  
**Last Updated:** 2026-01-28  
**Parent:** [PHASE_5_OUTLINE.md](PHASE_5_OUTLINE.md)

**Prerequisites:**  
Phase 0–4 completed and certified:
- Deterministic perception & lifecycle (Phase 1)
- Situation Graph + synthesis (Phase 2)
- Decision intelligence (Phase 3)
- Bounded execution via AgentCore (Phase 4)
- Zero-trust networking, IAM, and audit

---

## 0) Phase 5 Objective

Phase 5 transforms the system from **reactive execution of approved intents** into an **always-on, AI-native revenue engine** that:

- continuously monitors accounts
- proactively proposes and prioritizes actions
- safely auto-executes *low-risk* actions
- learns from outcomes without breaking trust or determinism

> Phase 5 is where the system starts to *compound*.

---

## 1) Core Principles (Do Not Violate)

1. **Autonomy is policy-driven, not model-driven**
2. **Low-risk actions only auto-execute**
3. **All autonomy is reversible and auditable**
4. **Learning tunes ranking and confidence — never policy**
5. **Humans remain the final authority on high-risk actions**

---

## 1.1) Architecture Review (Pre-Implementation)

Phase 5 was reviewed at architecture level. The following **4 risks** and **3 upgrades** are incorporated into this plan; do not implement without them.

| Risk | Mitigation (in plan) |
|------|----------------------|
| **R1: Always-On → Always-Expensive** | **DecisionCostGate** (§2.2.1) runs *before* Phase 3: budget, marginal value, cooldowns. |
| **R2: Blocked actions unexplained** | **Auto-Approval policy** returns `reason` + `explanation` for BLOCK/REQUIRE_APPROVAL (§2.3). |
| **R3: Failure modes conflated** | **OutcomeTaxonomyV1** (§2.5): IDEA_REJECTED, IDEA_EDITED, EXECUTION_FAILED, EXECUTION_SUCCEEDED, NO_RESPONSE, NEGATIVE_RESPONSE. |
| **R4: Autonomous schedules erode trust** | **Hard requirements**: daily digest, explicit opt-in, kill-switch visibility (§2.1 Mode 4; EPIC 5.6). |

| Upgrade | Where |
|---------|--------|
| **Autonomy Budget** | Max autonomous actions per account/day and per action type; decay if unused (§2.6; EPIC 5.1/5.6). |
| **Learning Shadow Mode** | Offline scoring of proposed actions vs. seller behavior before outcomes influence ranking (§2.5; EPIC 5.5). |
| **Ledger first-class UI** | Expose “why did the system do this?”, “what did it know?”, “which policy allowed it?” (EPIC 5.6; cc-dealmind + APIs). |

---

## 2) New Capabilities Introduced

### 2.1 Autonomy Modes

Formalize execution modes per tenant, per action type:

| Mode | Description |
|---|---|
| PROPOSE_ONLY | System proposes actions, no execution |
| APPROVAL_REQUIRED | Human approval required (Phase 4 default) |
| AUTO_EXECUTE | System may execute autonomously if policy allows |
| DISABLED | Action type fully disabled |

Stored as `AutonomyModeConfigV1`.

**Mode 4 (Autonomous schedules) — hard requirements:**  
Daily digest, explicit opt-in per tenant/account, and kill-switch visibility are **gating requirements** (not optional UI). Sellers must not wake to “Autopilot did N things” without prior opt-in and daily summary.

---

### 2.2 Decision Loop Scheduling (Always-On)

Introduce a **DecisionTrigger layer** (deterministic):

Triggers include:
- New signal emitted
- Lifecycle state change
- Posture change
- Time-based rituals (daily brief, weekly review, renewal runway)

**Key rule:**  
Triggers decide *when* to run Phase 3 — the LLM never self-triggers.

**Flow:** Signal → DecisionTrigger → **DecisionCostGate** (§2.2.1) → Phase 3 (LLM).

#### 2.2.1 DecisionCostGate (first-class cost governor)

Runs *before* Phase 3. Without it, “always-on” can become always-expensive.

- **Inputs:** budget remaining, marginal value of this run, cooldowns, tenant/account.
- **Output:** ALLOW | DEFER | SKIP (with reason). DEFER = cooldown / temporary; SKIP = permanent for this cycle.
- **Enforcement:** No Phase 3 invocation if CostGate returns DEFER or SKIP.

---

### 2.3 Auto-Approval Policy

Introduce `AutoApprovalPolicyV1` evaluated **after Phase 3 decision** and **before Phase 4 execution**.

**Inputs**
- action_type
- confidence score (produced by Phase 3 decision synthesis; not learned in Phase 5)
- risk_level
- lifecycle state
- tenant policy
- autonomy mode

**Outputs (rich; required for BLOCK/REQUIRE_APPROVAL)**  
Policy returns a structured result, not just a decision code:

- `decision`: AUTO_EXECUTE | REQUIRE_APPROVAL | BLOCK
- `reason`: e.g. EXTERNAL_CONTACT, RISK_LEVEL_HIGH, TENANT_POLICY
- `explanation`: human-readable (for UI, compliance, learning)
- `policy_version`: e.g. AutoApprovalPolicyV1

Example for BLOCK: `{ "decision": "BLOCK", "reason": "EXTERNAL_CONTACT", "explanation": "Customer-facing actions require human review", "policy_version": "AutoApprovalPolicyV1" }`

Blocked actions are the best training signal later; sellers will ask “why didn’t it do this?” — explanations are required.

This policy is:
- deterministic
- versioned
- kill-switchable

---

### 2.4 Perception Scheduler (Cost-Safe Pull)

Add a scheduler that decides **when to pull deeper data**.

Features:
- heat-based polling (hot vs cold accounts)
- per-tenant cost budgets
- adaptive cadence
- connector-specific throttles

Outputs:
- scheduled pull jobs (Step Functions)
- explicit ledger entries for each pull decision

---

### 2.5 Outcome Feedback Loop (Learning without Chaos)

Use execution outcomes to improve *ranking*, not rules.

**OutcomeTaxonomyV1 (disambiguate failure modes)**  
If outcomes are conflated (bad idea vs. bad timing vs. bad execution vs. bad tool), learning quality collapses. Define and use:

- IDEA_REJECTED — human rejected the proposal
- IDEA_EDITED — human edited then approved
- EXECUTION_FAILED — execution attempted and failed
- EXECUTION_SUCCEEDED — execution attempted and succeeded
- NO_RESPONSE — (later) no response from recipient
- NEGATIVE_RESPONSE — (later) negative response

**Inputs**
- approved vs rejected actions (with taxonomy)
- edits to drafts
- execution success/failure (with taxonomy)
- response outcomes (later)

**Outputs**
- updated action ranking weights
- confidence calibration tables
- evaluation reports

**Learning Shadow Mode (upgrade)**  
Before outcomes influence ranking in production: run proposed actions offline, score them against actual seller behavior, do not surface to sellers. Validates learning safely and avoids regressions.

**Implementation**
- start with heuristics + offline analysis
- graduate to SageMaker ranking models later

---

### 2.6 Autonomy Budget (upgrade)

Not only API/cost budgets — **autonomy budgets**:

- Max autonomous actions per account per day
- Max per action type
- Optional decay over time if unused

Keeps autonomy predictable, auditable, and seller-aligned. Enforced after Auto-Approval Policy (AUTO_EXECUTE) and before Phase 4 execution.

---

## 3) Epics & Stories

---

## EPIC 5.1 — Autonomy Modes & Policy

### Story 5.1.1 — AutonomyModeConfigV1
- Define schema
- Store per-tenant + per-action-type
- Expose admin API to update

**Acceptance**
- Changes take effect without redeploy
- All changes logged to ledger

---

### Story 5.1.2 — AutoApprovalPolicyV1 Engine
- Deterministic policy evaluator (Lambda/OPA)
- Integrated between Phase 3 and Phase 4
- **Rich output:** `decision`, `reason`, `explanation`, `policy_version` (required for BLOCK/REQUIRE_APPROVAL)

**Acceptance**
- Same input → same decision
- Policy changes do not retroactively affect history
- Blocked/required-approval decisions include reason + explanation (UI, compliance, learning)

---

### Story 5.1.3 — Autonomy Budget
- Max autonomous actions per account per day; max per action type; optional decay if unused
- Enforced after Auto-Approval (AUTO_EXECUTE) and before Phase 4 execution
- Expose via admin API; configurable per tenant

**Acceptance**
- Autonomy stays predictable and auditable; sellers see budget state in UI (cc-dealmind)

---

## EPIC 5.2 — Decision Triggering & Scheduling

### Story 5.2.1 — DecisionTrigger Registry
- Define allowed trigger types
- Define debounce + cooldown rules

**Acceptance**
- Triggers are bounded and observable
- No trigger storms possible

---

### Story 5.2.2 — DecisionScheduler
- Emits `RUN_DECISION` events
- Integrates with EventBridge Scheduler

**Acceptance**
- Decision cadence is configurable
- All scheduled runs are logged

---

### Story 5.2.3 — DecisionCostGate
- First-class cost governor: runs *before* Phase 3 (LLM)
- Inputs: budget remaining, marginal value, cooldowns, tenant/account
- Output: ALLOW | DEFER | SKIP (with reason). DEFER = cooldown; SKIP = skip this cycle.

**Acceptance**
- No Phase 3 invocation when CostGate returns DEFER or SKIP
- All CostGate decisions logged (cost governance is auditable)

---

## EPIC 5.3 — Perception Scheduler

### Story 5.3.1 — Heat Scoring
- Compute account heat from posture + signals
- Store heat score in DDB

### Story 5.3.2 — Pull Orchestration
- Schedule pull jobs based on heat + budgets
- Enforce connector rate limits

**Acceptance**
- Cold accounts are cheap
- Hot accounts get deeper coverage

---

## EPIC 5.4 — Autonomous Execution (Low Risk Only)

### Story 5.4.1 — Auto-Execute Pipeline
- Auto-approved actions skip human approval
- Flow directly into Phase 4 execution

**Acceptance**
- Only whitelisted action types auto-execute
- Auto-execution events clearly labeled in UI + ledger
- Auto-executed actions must be idempotent or protected by execution-level deduplication (Phase 4 guarantees)

---

## EPIC 5.5 — Learning & Evaluation

### Story 5.5.1 — Outcome Normalization + OutcomeTaxonomyV1
- Normalize ActionOutcome into learning-ready format
- **OutcomeTaxonomyV1:** IDEA_REJECTED, IDEA_EDITED, EXECUTION_FAILED, EXECUTION_SUCCEEDED, NO_RESPONSE, NEGATIVE_RESPONSE (disambiguate failure modes)

### Story 5.5.2 — Ranking Calibration
- Offline jobs compute better ranking weights

### Story 5.5.3 — Learning Shadow Mode
- Run proposed actions offline; score against actual seller behavior; do not surface to sellers until validated
- Validates learning safely and avoids regressions before outcomes influence production ranking

**Acceptance**
- Learning does not affect policy
- Changes are versioned and reversible
- Shadow mode gates production ranking changes

---

## EPIC 5.6 — Autonomy Control Center (UI + APIs)

**UI (implemented in cc-dealmind):**  
Seller and admin surfaces for autonomy legibility and control. **cc-native** provides the APIs and config that the UI consumes.

**Seller UI (cc-dealmind):**
- "Autopilot did X" timeline
- "Needs your input" queue

**Admin UI (cc-dealmind):**
- autonomy modes
- budgets
- kill switches
- audit export

**cc-native deliverables (this repo):**
- APIs for autonomy mode config, **autonomy budget** (max actions/account/day, per type, decay), kill-switch state, audit export
- Execution status / timeline data (Phase 4 Status API; extend as needed for "Autopilot did X")
- **Ledger-first APIs:** “Why did the system do this?”, “What did it know at the time?”, “Which policy allowed it?” — Ledger is first-class for security, legal, enterprise (cc-dealmind consumes; cc-native exposes)

**Mode 4 (Autonomous schedules) — gating:**  
Daily digest, explicit opt-in, kill-switch visibility are **hard requirements** (not optional UI). Sellers must not wake to “Autopilot did N things” without prior opt-in and daily summary.

**Acceptance**
- Sellers always know what the system did (UI in cc-dealmind; data from cc-native)
- Admins can stop autonomy instantly (UI in cc-dealmind; kill switches + APIs in cc-native)
- Ledger-explanation APIs available for “why did the system do this?” (cc-dealmind UI; cc-native APIs)
- Autonomous schedules require daily digest + explicit opt-in + kill-switch visibility before enable

---

## 4) Phase 5 Definition of Done

Phase 5 is complete when:

- Decisions run continuously without prompts
- Some actions auto-execute safely
- High-risk actions always require approval
- Outcome feedback improves ranking quality
- Costs remain bounded and predictable
- Every autonomous act is auditable

---

## 5) What Comes After Phase 5

Phase 6+ may include:
- deeper learning loops
- partial auto-approval expansion
- cross-account optimization
- proactive deal orchestration

These are **intentionally deferred**.

---

## One-line framing

> Phase 5 is where AI-native systems stop reacting — and start compounding.
