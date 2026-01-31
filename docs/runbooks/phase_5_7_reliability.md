# Phase 5.7 — Reliability Runbook

Operational guidance when reliability controls trigger. See [PHASE_5_7_CODE_LEVEL_PLAN.md](../implementation/phase_5/PHASE_5_7_CODE_LEVEL_PLAN.md) for contracts.

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
