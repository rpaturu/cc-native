# Phase 5 — Code-Level Implementation Plan

*Always-On Autonomy (Controlled) + Learning Loop*

**Status:** 🟡 **PLANNING**  
**Progress:** 5.1, 5.2, 5.3 implemented (see sub-phase docs).  
**Created:** 2026-01-28  
**Last Updated:** 2026-01-28  
**Parent:** [PHASE_5_OUTLINE.md](PHASE_5_OUTLINE.md) | [PHASE_5_IMPLEMENTATION_PLAN.md](PHASE_5_IMPLEMENTATION_PLAN.md)  
**Prerequisites:** Phase 4 complete (4.5A signed off). End-to-end spine: **Decide → Approve → Execute → Outcome → Ledger**.

**Note:** Test plans will be created after implementation. This plan is code-level only. Each PHASE_5_x_CODE_LEVEL_PLAN may include a test strategy section; formal test plans are created after implementation.

---

## Document purpose

This is the **parent** code-level plan. It provides overview, sub-phase list, implementation order, and quick reference. **Detailed implementation** (file paths, type shapes, service methods, handler contracts, CDK resources) lives in sub-phase documents **PHASE_5_1** through **PHASE_5_7**. Create sub-phase plans only after this parent is finalized.

---

## Overview

This document provides a high-level overview and cross-reference for Phase 5: Always-On Autonomy (Controlled) + Learning Loop. **Detailed implementation plans are split into sub-phase documents.**

**Key Architectural Additions:**
1. AutonomyModeConfigV1 (per-tenant, per-action-type modes)
2. AutoApprovalPolicyV1 (deterministic, versioned, explainable; rich output)
3. DecisionCostGate (pre-Phase-3 cost governor; output **ALLOW | DEFER | SKIP** — canonical; use everywhere; DEFER = cooldown, SKIP = skip this cycle)
4. DecisionTrigger + DecisionScheduler (when to run Phase 3; LLM never self-triggers)
5. PerceptionScheduler (heat-based pull; per-tenant budgets)
6. Autonomy Budget (max autonomous actions/account/day; enforced before Phase 4)
7. OutcomeTaxonomyV1 + Learning Shadow Mode (labels first; learning gates production ranking)
8. Ledger-first APIs (“why did the system do this?”)

---

## Sub-Phase Documents

For detailed code-level plans, see:

| Sub-Phase | Document | Scope |
|-----------|----------|--------|
| **5.1** | `PHASE_5_1_CODE_LEVEL_PLAN.md` | Autonomy Modes & Policy (AutonomyModeConfigV1, AutoApprovalPolicyV1, Autonomy Budget) |
| **5.2** | `PHASE_5_2_CODE_LEVEL_PLAN.md` | Decision Triggering & Scheduling (DecisionTrigger, DecisionScheduler, DecisionCostGate) |
| **5.3** | `PHASE_5_3_CODE_LEVEL_PLAN.md` | Perception Scheduler (heat scoring, pull orchestration) |
| **5.4** | `PHASE_5_4_CODE_LEVEL_PLAN.md` | Autonomous Execution (auto-execute pipeline; integration with Phase 3/4) |
| **5.5** | `PHASE_5_5_CODE_LEVEL_PLAN.md` | Learning & Evaluation (OutcomeTaxonomyV1, normalization, ranking calibration, Shadow Mode) |
| **5.6** | `PHASE_5_6_CODE_LEVEL_PLAN.md` | Autonomy Control Center (APIs in cc-native; UI in cc-dealmind) |
| **5.7** | `PHASE_5_7_CODE_LEVEL_PLAN.md` | Reliability Hardening (circuit breakers, SLOs, replay, backpressure, tenant isolation) |

**Implementation order (recommended):** 5.1 + 5.4 first → 5.2 + 5.3 → 5.5 → 5.6 → 5.7 ongoing.

---

## Core principles, risks & integration

**Core principles & mandatory risks:**  
Phase 5 must not violate the core principles in `PHASE_5_IMPLEMENTATION_PLAN.md` §1 (autonomy policy-driven, low-risk only, reversible/auditable, learning never policy, humans for high-risk). The four risks and three upgrades in §1.1 are **mandatory**: DecisionCostGate (pre-Phase-3), rich AutoApprovalPolicy output (reason + explanation), OutcomeTaxonomyV1, trust safeguards (explicit opt-in, autonomy budget, daily digest for Mode 4). Sub-phase plans must implement these.

**Zero Trust:**  
Phase 5 preserves and extends the zero-trust posture from Phase 2 ([ZERO_TRUST_IMPLEMENTATION_PLAN.md](../phase_2/ZERO_TRUST_IMPLEMENTATION_PLAN.md)). All new resources (Lambda, API, DDB, IAM) must follow least privilege and auditability. Phase 5.7 **Tenant Isolation Verification** is mandatory for zero trust (no cross-tenant data/cost; tenant-scoped access; no cross-tenant PII in logs).

**Integration with Phase 4:**  
- Auto-approval is evaluated **after** Phase 3 decision, **before** Phase 4 execution.  
- Auto-execute pipeline: policy returns AUTO_EXECUTE + autonomy budget allows → flow directly into Phase 4 (skip human approval path).  
- Phase 4 Execution Status API is extended as needed for "Autopilot did X" timeline.  
- Ledger and execution outcomes (Phase 4) are inputs for audit and ledger-explanation APIs.

**Repo boundary:**  
Autonomy Control Center **UI** (seller timeline, admin config, kill switches, audit export) is implemented in **cc-dealmind**. **cc-native** provides all APIs (autonomy config, autonomy budget, kill-switch state, audit export, ledger-explanation). See PHASE_5_6 scope.

---

## Implementation Order

### Phase 5.1: Autonomy Modes & Policy
1. Type definitions (AutonomyModeConfigV1, AutoApprovalPolicyResultV1, AutonomyBudgetV1)
2. DynamoDB tables (autonomy config, autonomy budget state)
3. AutonomyModeService
4. AutoApprovalPolicyEngine (Lambda/OPA)
5. Autonomy Budget enforcement service
6. Admin API for autonomy config and budget

### Phase 5.2: Decision Triggering & Scheduling
7. DecisionTrigger registry (types, debounce/cooldown)
8. DecisionCostGate (pre-Phase-3 Lambda or step)
9. DecisionScheduler (EventBridge Scheduler → RUN_DECISION)
10. Integration: Trigger → CostGate → Phase 3

### Phase 5.3: Perception Scheduler
11. Heat scoring (account heat from posture + signals; DDB)
12. Pull orchestration (Step Functions; per-tenant budgets, connector throttles)

### Phase 5.4: Autonomous Execution
13. Auto-execute pipeline (policy AUTO_EXECUTE + budget check → Phase 4; skip human approval path)
14. Idempotency / deduplication alignment with Phase 4

### Phase 5.5: Learning & Evaluation
15. OutcomeTaxonomyV1 type and application
16. Outcome normalization (learning-ready format)
17. Ranking calibration (offline jobs)
18. Learning Shadow Mode (offline scoring; gate production ranking)

### Phase 5.6: Autonomy Control Center
19. APIs: autonomy config, autonomy budget, kill switches, audit export, ledger-explanation
20. Ledger-first APIs (“why did the system do this?”, “what did it know?”, “which policy?”)

### Phase 5.7: Reliability Hardening
21. Connector circuit breakers
22. Per-tool SLOs
23. Replay tooling (“re-run execution from intent”)
24. Backpressure policies; tenant isolation verification

---

## Quick Reference: Component Locations

### Type Definitions
- **Phase 5.1:** `PHASE_5_1_CODE_LEVEL_PLAN.md` — AutonomyTypes (AutonomyModeConfigV1, AutoApprovalPolicyResultV1, AutonomyBudgetV1)
- **Phase 5.2:** `PHASE_5_2_CODE_LEVEL_PLAN.md` — DecisionTrigger types, CostGate result
- **Phase 5.5:** `PHASE_5_5_CODE_LEVEL_PLAN.md` — OutcomeTaxonomyV1, learning types

### Services
- **5.1:** AutonomyModeService, AutoApprovalPolicyEngine, AutonomyBudgetService
- **5.2:** DecisionCostGateService (or Lambda), DecisionScheduler
- **5.3:** HeatScoringService, PerceptionPullOrchestrator
- **5.5:** OutcomeNormalizationService, RankingCalibrationService

### Lambda Handlers / APIs
- **5.1:** Auto-approval policy evaluator; admin API (autonomy config, budget)
- **5.2:** DecisionCostGate (pre-Phase-3); DecisionScheduler trigger handler
- **5.6:** Autonomy Control Center APIs (config, budget, kill switches, audit, ledger-explanation)

### CDK / Infrastructure
- **5.1:** DynamoDB tables (autonomy config, autonomy budget state); API routes
- **5.2:** EventBridge Scheduler; CostGate Lambda; rules for RUN_DECISION
- **5.3:** Step Functions for pull jobs; heat table
- **5.6:** API Gateway routes for Control Center and ledger-explanation

---

## Prerequisites (Before Starting Phase 5)

- Phase 4.5A signed off (execution, status API, E2E, security audit, performance deferred).
- Phase 3 Decision API produces ActionIntentV1 with **confidence score** and risk/context usable by AutoApprovalPolicyV1. Confidence score is **produced by Phase 3 decision synthesis** (not learned in Phase 5).
- Ledger and execution outcome storage (Phase 4) available for audit and learning inputs.

**See:** `PHASE_5_IMPLEMENTATION_PLAN.md` §1 Core Principles and §1.1 Architecture Review (risks and upgrades must be implemented).

---

## References

- **Phase 5 Outline:** [PHASE_5_OUTLINE.md](PHASE_5_OUTLINE.md)
- **Phase 5 Implementation Plan (epics & stories):** [PHASE_5_IMPLEMENTATION_PLAN.md](PHASE_5_IMPLEMENTATION_PLAN.md)
- **Phase 4 completion:** `../phase_4/PHASE_4_5_CODE_LEVEL_PLAN.md`
- **Phase 4 parent:** `../phase_4/PHASE_4_CODE_LEVEL_PLAN.md`
