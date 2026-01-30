# Phase 5.7 — Reliability Hardening: Code-Level Plan

**Status:** 🟡 **PLANNING**  
**Created:** 2026-01-28  
**Last Updated:** 2026-01-28  
**Parent:** [PHASE_5_CODE_LEVEL_PLAN.md](PHASE_5_CODE_LEVEL_PLAN.md)

---

## Overview

Phase 5.7 stabilizes the system for production:

- **Connector circuit breakers** — fail fast when a connector is unhealthy; avoid cascading failures
- **Per-tool SLOs** — latency/error rate targets; alerting when breached
- **Replay tooling** — "re-run execution from intent" for recovery or debugging
- **Backpressure policies** — throttle or queue when downstream is saturated
- **Tenant isolation verification** — ensure no cross-tenant data or cost bleed

**Placement:** Ongoing; can be implemented in parallel with 5.1–5.6 or after. May touch Phase 4 connectors and execution path.

---

## Implementation Tasks

1. Connector circuit breakers
2. Per-tool SLOs
3. Replay tooling ("re-run execution from intent")
4. Backpressure policies
5. Tenant isolation verification

---

## 1. Connector Circuit Breakers

**Purpose:** When a connector (e.g. CRM, Internal) is failing repeatedly, stop calling it and fail fast; optionally retry after cooldown.

**Location:** Wrapper around connector invocations (e.g. in Tool Invoker or adapter layer). State: OPEN / CLOSED / HALF_OPEN; store in DDB or in-memory with TTL.

**File:** `src/services/connector/CircuitBreakerService.ts` or equivalent; integrate with `src/adapters` or Phase 4 tool-invoker path.

**Acceptance:** After N failures, circuit opens; no calls until cooldown; after cooldown, probe (HALF_OPEN); on success close, on failure reopen.

---

## 2. Per-Tool SLOs

**Purpose:** Define latency and error-rate targets per tool (e.g. internal.create_task < 5s p99, < 1% error). Alert when breached.

**Location:** CloudWatch metrics (existing or new); alarms per tool or per connector. Optional: SLO dashboard (CloudWatch or external).

**Implementation:** Instrument Phase 4 tool-invoker (and adapters) to emit latency and success/failure metrics with dimension `tool_name` or `connector_id`. Create alarms from PHASE_5_7_CODE_LEVEL_PLAN or runbook.

---

## 3. Replay Tooling

**Purpose:** "Re-run execution from intent" — given an action_intent_id (and tenant/account), optionally re-trigger Phase 4 execution (e.g. put ACTION_APPROVED or invoke starter with idempotency). For recovery or debugging.

**Location:** Admin-only API or CLI; Lambda or script that loads ActionIntentV1 (from Phase 3 store or copy), then triggers Phase 4 entry (EventBridge or direct Step Functions start) with same intent. **Idempotency:** Phase 4 already uses action_intent_id; replay may use same id and let Phase 4 dedupe, or use a replay flag and new execution trace for audit.

**File:** `src/handlers/phase5/replay-execution-handler.ts` or script in `scripts/phase_5/`.

**Acceptance:** Replay does not double-execute without intent; audit log records replay.

---

## 4. Backpressure Policies

**Purpose:** When downstream (e.g. Gateway, connector) is saturated or rate-limited, throttle or queue instead of failing all requests.

**Location:** Configurable limits (per tenant, per connector); queue (SQS) or throttle (token bucket) before calling downstream. Integrate with DecisionCostGate or tool-invoker layer.

**Acceptance:** Under backpressure, requests are deferred or queued; no thundering herd.

---

## 5. Tenant Isolation Verification

**Purpose:** Ensure no cross-tenant data or cost bleed (IAM, DDB access, logging).

**Implementation:** IAM policies scoped by tenant where applicable; DDB PK always includes tenant_id; logging never includes other tenants' PII. Optional: automated check (e.g. integration test or script) that verifies tenant_id in all reads/writes for a given execution.

**Acceptance:** All Phase 4/5 data access is tenant-scoped; verification runbook or test exists.

---

## 6. Test Strategy (placeholder)

Unit tests for CircuitBreakerService, replay handler. Integration tests for circuit breaker with mock connector failures (optional). SLO alarms validated in staging. Formal test plan after implementation.

---

## References

- Parent: [PHASE_5_CODE_LEVEL_PLAN.md](PHASE_5_CODE_LEVEL_PLAN.md)
- Implementation Plan: [PHASE_5_IMPLEMENTATION_PLAN.md](PHASE_5_IMPLEMENTATION_PLAN.md) (5.7 implied in outline)
- Phase 4 execution: `../phase_4/PHASE_4_2_CODE_LEVEL_PLAN.md`
