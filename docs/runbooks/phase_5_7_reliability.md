# Phase 5.7 — Reliability Runbook

Operational guidance when reliability controls trigger. See [PHASE_5_7_CODE_LEVEL_PLAN.md](../implementation/phase_5/PHASE_5_7_CODE_LEVEL_PLAN.md) for contracts.

---

## Verification (don’t get burned)

Two high-leverage checks confirmed in implementation:

### 1) Breaker state transitions are race-safe under burst

- **half_open_probe_in_flight cleared on success:** `recordSuccess` when state is HALF_OPEN does a full Put (state CLOSED, no probe flag); item overwrite clears the flag.
- **half_open_probe_in_flight cleared on failure:** `recordFailure` when state is HALF_OPEN calls `openCircuit`, which Puts state OPEN (no probe flag); item overwrite clears the flag.
- **OPEN → HALF_OPEN:** Single probe enforced via conditional write: `ConditionExpression` requires `state = OPEN` and `(attribute_not_exists(half_open_probe_in_flight) OR half_open_probe_in_flight = false)`. Only one caller wins; others get ConditionalCheckFailed and receive DEFER/retry.
- **TTL vs active OPEN:** TTL is set to `nowSec + stateTtlDays * 86400` (e.g. 14 days). Cooldown uses `open_until_epoch_sec` (e.g. 10–30 s). TTL does not delete active OPEN state prematurely.

### 2) Concurrency limits are connector-scoped

- **Current implementation:** DDB-backed in-flight semaphore per connector. Key: `CONNECTOR#<connector_id>`, sk `CONCURRENCY`. Each connector has its own `in_flight_count`; no shared queue. Tool invoker derives `connectorId` from `tool_name` and passes it to `ConnectorConcurrencyService.tryAcquire(connectorId)`.
- **If moving to SQS later:** Ensure either separate queues per connector or a dispatcher that routes into connector-specific worker pools so limits remain connector-scoped.

---

## Circuit breaker OPEN

- **Do not manually close** without verifying connector health.
- After cooldown, the circuit moves to HALF_OPEN and **one probe** runs automatically.
- If the probe fails, the circuit reopens.
- To **disable a connector entirely**, use Phase 5.6 kill-switches or autonomy config (disable execution for affected action types or tenant); or use connector-level config if available.

---

## Disable a connector

- Use Phase 5.6 kill-switches or autonomy config to disable execution for affected action types or tenant.
- Or use connector-level config if available.

---

## Replay safely

- Use the replay API with **replay_reason** and **requested_by** (audit).
- Confirm **tenant/account from auth only** (JWT `custom:tenant_id`; do not accept tenant/account from query or body for authorization).
- Replay creates a **new execution_id** (trace); check ledger for **REPLAY_*** events.
- Do not replay the same intent repeatedly without checking idempotency at the tool layer.

---

## SLO alarms (tool_latency_ms, tool_error)

- When **tool_latency_ms** or **tool_error** alarms fire:
  - Check connector health and circuit breaker state.
  - Check downstream (CRM, Internal) status.
  - Scale or back off as per runbook.
- Use burn rate or error budget dashboard if implemented.
