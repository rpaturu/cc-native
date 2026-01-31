# Phase 5.7 — Reliability Hardening: Code-Level Plan

**Status:** 🟢 **IMPLEMENTED** (circuit breaker, SLO metrics, resilience wrapper, replay, runbook, tenant verification placeholder)  
**Created:** 2026-01-28  
**Last Updated:** 2026-01-28 (final pass: OPEN-by-call-type table, SQS-first backpressure, TTL 7–30d, tenant_id sampling rule)  
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

**Dependencies / alignment:** Phase 5.6 (Control Center) is complete: AuthZ (tenant from JWT `custom:tenant_id`, account in scope), audit export owner-scoped, ledger explanation tenant/account-scoped. Phase 5.7 replay and tenant isolation verification must align with 5.6 contracts. Phase 5.5 (learning) data (ranking weights, normalized outcomes) is tenant-scoped; include in verification scope.

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

**Location:** Wrapper around connector invocations (e.g. in Tool Invoker or adapter layer). Integrate via `invokeWithResilience` (§7) so all connector calls go through breaker + backpressure + metrics.

**State:** OPEN / CLOSED / HALF_OPEN. **Persistence:** DDB record with TTL (not in-memory only), so all Lambda invocations share state.

**Keying (contract):** **Global per connector** (recommended) for upstream outages; optional tenant override later if needed. Key: `(connector_id)` → single circuit per connector.

**Failure window:** “N failures in T seconds” (e.g. 5 failures in 60s), not just “N failures.” Reset failure_count when window expires or circuit closes.

**Probe behavior (HALF_OPEN):** **Strict:** exactly 1 request per cooldown window in HALF_OPEN. Use **conditional writes** (e.g. `half_open_probe_in_flight` only set when not already set) to prevent concurrent probes (“half-open stampedes”).

**State contract (minimal):**

```text
CircuitBreakerStateV1 {
  pk: "CONNECTOR#<connector_id>",
  sk: "STATE",
  state: "CLOSED" | "OPEN" | "HALF_OPEN",
  failure_count: number,
  window_start_epoch_sec: number,
  open_until_epoch_sec?: number,
  half_open_probe_in_flight?: boolean,
  ttl_epoch_sec?: number
}
```

**File:** `src/services/connector/CircuitBreakerService.ts` or equivalent; integrate with Phase 4 tool-invoker path.

**When breaker is OPEN — default behavior by call-type (contract):**

| Call type | Default when OPEN | Rationale |
|-----------|-------------------|-----------|
| **Phase 4 execution calls** | **FAIL_FAST** | Surface error, record outcome; do not hide failure from execution path. |
| **Phase 5.3 perception pulls** | **DEFER** (+ `retry_after_seconds`) | Allow caller to back off and retry; avoid surfacing as hard failure for perception. |

A 2-row table avoids inconsistent behavior across teams. Implement in `invokeWithResilience` by call context.

**TTL (contract):** Breaker state record in DDB must have **TTL 7–30 days** (e.g. 14 days) so state does not grow unbounded; enough for incident review. Idempotency stores are specified in other phases; keep consistent.

**Acceptance:** After N failures in T seconds, circuit opens; no calls until cooldown; after cooldown, single probe (HALF_OPEN); on success close, on failure reopen; conditional writes prevent concurrent probes. OPEN behavior follows the table above; breaker state TTL is set.

---

## 2. Per-Tool SLOs

**Purpose:** Define latency and error-rate targets per tool (e.g. internal.create_task < 5s p99, < 1% error). Alert when breached.

**Where metrics are emitted:** Phase 4 tool-invoker wrapper (same layer as circuit breaker and backpressure; ideally inside `invokeWithResilience` §7). All connector calls must flow through this path so metrics are consistent.

**Metric names (contract):**

| Metric name       | Type    | Description                    |
|-------------------|---------|--------------------------------|
| `tool_latency_ms`| Histogram / PutMetricData | Latency of tool call (ms) |
| `tool_success`   | Count   | Successful tool completions   |
| `tool_error`     | Count   | Failed tool calls (e.g. 5xx, timeout) |

**Required dimensions:**

| Dimension      | Required | Notes |
|----------------|----------|--------|
| `tool_name`    | Yes      | e.g. internal.create_task |
| `connector_id` | Yes      | e.g. crm_salesforce, internal |
| `tenant_id`    | Optional | **Sampling rule:** Emit `tenant_id` dimension on **errors only** (or e.g. 1% sampled successes). Never emit on every success to avoid CloudWatch cost inflation. |

**Alarm definition approach:**

- **Latency:** p99 (or p95) above threshold (e.g. 5000 ms) over 5–15 min evaluation period.
- **Errors:** 5xx (or failure) percentage above threshold (e.g. 1%) over 5–15 min.
- **Optional later:** “Burn rate” style alerts for fast detection.

**Location:** CloudWatch metrics; alarms per tool or per connector; optional SLO dashboard.

**Acceptance:** All tool invocations emit the above metrics with required dimensions; alarms are created from this contract; no tool path bypasses the wrapper.

---

## 3. Replay Tooling

**Purpose:** "Re-run execution from intent" — given an action_intent_id (and tenant/account), re-trigger Phase 4 execution for recovery or debugging. **Replay must have explicit semantics** to avoid double-execute vs no-op confusion.

**Replay semantics (enterprise-safe contract):**

- Replay creates a **new execution_id** but references the same `action_intent_id`. Do **not** reuse the same execution_id (that would either be deduped away or double-execute without trace separation).
- **Required fields:** `replay_reason`, `requested_by` (audit).
- Execution path treats replay as **allowed duplicate attempt** for the same intent: idempotent at the external side via per-tool idempotency keys where possible; internally, execution and ledger are keyed by the new execution_id so replay is traceable.
- **Ledger records:** Emit `REPLAY_REQUESTED`, `REPLAY_STARTED`, `REPLAY_COMPLETED` (and `REPLAY_FAILED` if applicable) so replay is auditable and distinct from original execution.

**Location:** Admin-only API or CLI; Lambda or script that loads ActionIntentV1 (from Phase 3 store or copy), then triggers Phase 4 entry (EventBridge or direct Step Functions start) with same intent and replay metadata (new execution_id, replay_reason, requested_by).

**AuthZ:** Replay API must use the same AuthZ contract as Control Center (5.6): tenant from JWT (`custom:tenant_id`), account in caller’s scope; do not accept tenant/account from query or body for authorization. See [PHASE_5_6_CODE_LEVEL_PLAN.md](PHASE_5_6_CODE_LEVEL_PLAN.md) §3 and §8.

**File:** `src/handlers/phase5/replay-execution-handler.ts` or script in `scripts/phase_5/`.

**Acceptance:** Replay always creates new execution_id and replay ledger trail; does not double-execute without intent; audit log and ledger record replay.

---

## 4. Backpressure Policies

**Purpose:** When downstream (e.g. Gateway, connector) is saturated or rate-limited, throttle or queue instead of failing all requests. **No thundering herd.**

**Primary location (contract):** **Tool invoker** (recommended). Backpressure lives at the same layer as circuit breaker and SLO metrics so all connector calls are protected regardless of caller (Phase 4, 5.3 pulls, etc.). Optional: DecisionCostGate also observes backpressure and returns DEFER so decision layer can back off.

**Outcomes (contract):**

- **DEFER:** Return (or signal) `DEFER` with `retry_after_seconds` so callers can back off and retry later.
- **Or enqueue:** Put request into SQS with delay; worker consumes when capacity allows.

**No thundering herd — primary mechanism (ship first):**

- **SQS concurrency limits per connector** — ship this first (simpler ops). Limit concurrent executions that call a given connector so downstream is not overwhelmed.
- **Token bucket** (DDB or Redis, per connector, optionally per tenant) — add later if finer-grained shaping is needed. Prefer one implemented path to avoid two half-implementations.

**Acceptance:** Under backpressure, requests are deferred (DEFER + retry_after_seconds) or queued; primary mechanism is SQS concurrency per connector; mechanism is explicit and deterministic; no stampede.

---

## 5. Tenant Isolation Verification (Zero Trust)

**Purpose:** Ensure no cross-tenant data or cost bleed — a **zero-trust** requirement. No identity or component may access another tenant's data or incur cost to another tenant.

**Zero-trust criteria:**
- **IAM:** Roles and policies are tenant-scoped where applicable; no single role has broad cross-tenant access without explicit, auditable justification.
- **DynamoDB:** Partition key (and sort key where relevant) always includes `tenant_id`; no query or scan without tenant scope.
- **Logging:** Logs must never contain another tenant's PII or identifiers in clear text; use tenant_id only where needed for support, and redact in export.
- **Execution/cost:** Execution traces, ledger entries, and cost attribution are keyed by tenant; autonomy budget and cost gates are per-tenant.

**In scope for verification:** Phase 4 execution path; Phase 5 Control Center APIs (5.6)—audit export GET (owner-scoped by tenant), ledger explanation (tenant/account from auth), kill-switches; Phase 5 learning (5.5)—ranking weights registry and normalized outcomes are tenant-scoped. Confirm Control Center and learning tables/queries never allow cross-tenant access.

**Verification harness (contract):**

- **Automated check:** A script or integration test that runs **one execution for Tenant A** and confirms:
  - All DDB keys (reads/writes) contain Tenant A’s tenant_id (or approved prefix); no query or scan without tenant scope.
  - Ledger and outcome records for that execution reference Tenant A only; no foreign tenant_id in the same trace.
- **Log scan rule:** On sampled logs, detect foreign tenant IDs in the same request/trace; any occurrence is a failure (PII/scope leak).
- **Pass/fail:** Any cross-tenant access in the harness is a **build failure in CI** (or blocks promotion to prod). Define explicitly: harness must pass before 5.7 is considered operationally ready.

**Implementation:** Apply the zero-trust criteria in Phase 4/5 code paths; implement the verification harness and run it in CI or pre-prod gate.

**Acceptance:** All Phase 4/5 data access is tenant-scoped; zero-trust criteria are documented and met; verification harness exists and is enforced (CI fail or prod gate).

---

## 6. Resilience Wrapper (recommended)

**Purpose:** Centralize breaker, backpressure, and metrics so no connector path bypasses hardening.

**Contract:** A single wrapper used for all connector calls:

```text
invokeWithResilience(toolName, tenantId, connectorId, fn): Promise<Result>
```

1. Check circuit breaker (connector_id); if OPEN, apply default by call-type: Phase 4 execution → FAIL_FAST; Phase 5.3 perception → DEFER + retry_after_seconds (see §1 table).
2. Check backpressure (token bucket or concurrency); if saturated, return DEFER with retry_after_seconds or enqueue.
3. Execute `fn()` (the actual connector call).
4. Record SLO metrics (tool_latency_ms, tool_success / tool_error) with tool_name, connector_id, optional tenant_id.
5. Update breaker state (on success/failure, conditional probe in HALF_OPEN).

**Location:** Phase 4 tool-invoker (and any adapter that calls connectors). All connector invocations must go through this wrapper.

**Acceptance:** No direct connector call bypasses invokeWithResilience; breaker, backpressure, and metrics are applied consistently.

---

## 7. Runbook (recommended)

**Purpose:** Operators know what to do when reliability controls trigger.

**Minimum content (~10 lines):**

- **Circuit breaker OPEN:** Do not manually close without verifying connector health. Check downstream status; after cooldown, circuit will move to HALF_OPEN and one probe will run. If probe fails, circuit reopens. To disable a connector entirely, use kill-switch or config (5.6 Control Center).
- **Disable a connector:** Use Phase 5.6 kill-switches or autonomy config to disable execution for affected action types or tenant; or use connector-level config if available.
- **Replay safely:** Use replay API with replay_reason and requested_by; confirm tenant/account from auth only. Replay creates new execution_id; check ledger for REPLAY_* events. Do not replay the same intent repeatedly without checking idempotency at the tool layer.
- **SLO alarms:** When tool_latency_ms or tool_error alarms fire, check connector health and circuit breaker state; check downstream (CRM, Internal) status; scale or back off as per runbook. Use burn rate or error budget dashboard if implemented.

**File:** `docs/runbooks/phase_5_7_reliability.md` or a section in the main ops runbook.

---

## 8. Test Strategy (placeholder)

Unit tests for CircuitBreakerService, replay handler. Integration tests for circuit breaker with mock connector failures (optional). SLO alarms validated in staging. Tenant isolation verification harness in CI. Formal test plan after implementation.

---

## 9. Summary: Five Hard Contracts (before implementation)

1. **Circuit breaker:** Persistent state (DDB + TTL 7–30 days); keying global per connector; failure window (N in T seconds); strict single probe in HALF_OPEN; conditional writes to prevent stampedes; OPEN → FAIL_FAST for Phase 4 execution, DEFER for Phase 5.3 perception.
2. **SLOs:** Metric names (`tool_latency_ms`, `tool_success`, `tool_error`); required dimensions (tool_name, connector_id); tenant_id on errors only (or 1% sampled successes); alarm approach (p99 + 5xx % over 5–15 min); emit from tool-invoker wrapper only.
3. **Replay:** New execution_id per replay; same action_intent_id; replay_reason + requested_by; ledger REPLAY_REQUESTED / REPLAY_STARTED / REPLAY_COMPLETED; no reuse of execution_id.
4. **Backpressure:** Primary location = tool invoker; outcome = DEFER with retry_after_seconds or SQS enqueue; **primary mechanism = SQS concurrency per connector** (ship first); token bucket later if needed.
5. **Tenant isolation:** Verification harness = one execution for Tenant A + DDB key/query scope check + log scan for foreign tenant; pass/fail = CI failure or prod gate.

---

## References

- Parent: [PHASE_5_CODE_LEVEL_PLAN.md](PHASE_5_CODE_LEVEL_PLAN.md)
- [PHASE_5_6_CODE_LEVEL_PLAN.md](PHASE_5_6_CODE_LEVEL_PLAN.md) — Control Center AuthZ, audit export owner-scope, JWT claim (§3, §8); align replay and tenant verification.
- [PHASE_5_5_CODE_LEVEL_PLAN.md](PHASE_5_5_CODE_LEVEL_PLAN.md) — Learning (tenant-scoped registry/outcomes); in scope for tenant isolation verification.
- Implementation Plan: [PHASE_5_IMPLEMENTATION_PLAN.md](PHASE_5_IMPLEMENTATION_PLAN.md) (5.7 implied in outline)
- Phase 4 execution: `../phase_4/PHASE_4_2_CODE_LEVEL_PLAN.md`
