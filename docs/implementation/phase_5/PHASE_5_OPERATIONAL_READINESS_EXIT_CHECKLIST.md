# Phase 5 — Operational Readiness Exit Checklist

One-page gate before declaring Phase 5 production-ready. Complete each item and link evidence (dashboards, CI, docs).

**Parent:** [PHASE_5_CODE_LEVEL_PLAN.md](PHASE_5_CODE_LEVEL_PLAN.md) | [Phase 5.7 Runbook](../../runbooks/phase_5_7_reliability.md)

---

## 1. Dashboards & Alarms

| Item | Link / Evidence |
|------|-----------------|
| Tool SLO metrics visible | CloudWatch namespace `CCNative/Execution`: `tool_latency_ms`, `tool_success`, `tool_error` |
| Alarms defined | p99/p95 latency + error % over 5–15 min windows (see 5.7 code-level plan) |
| Alarm runbook | [Phase 5.7 Runbook — SLO alarms](../../runbooks/phase_5_7_reliability.md#slo-alarms-tool_latency_ms-tool_error) |

---

## 2. Circuit Breaker State View (Control Center)

| Item | Link / Evidence |
|------|-----------------|
| Breaker state observable | Control Center (5.6) or ops view: per-connector state (CLOSED / OPEN / HALF_OPEN) |
| OPEN → operator action | Runbook: [Circuit breaker OPEN](../../runbooks/phase_5_7_reliability.md#circuit-breaker-open) — do not manually close; use kill-switches to disable if needed |

---

## 3. Replay Permission & Audit

| Item | Link / Evidence |
|------|-----------------|
| Replay API authZ | Tenant from JWT `custom:tenant_id` only; account in scope; no tenant/account from query or body |
| Replay audit trail | Ledger: `REPLAY_REQUESTED`, `REPLAY_STARTED`, `REPLAY_COMPLETED` / `REPLAY_FAILED`; `replay_reason` + `requested_by` |
| Permission tests | Manual or automated: replay only for authorized tenant/account; 404 for missing intent |

---

## 4. Tenant Isolation Harness (CI / Prod Gate)

| Item | Link / Evidence |
|------|-----------------|
| Harness exists | Script: [scripts/phase_5/verify-tenant-isolation.sh](../../../scripts/phase_5/verify-tenant-isolation.sh) (placeholder — implement: run one Tenant A execution, verify DDB keys/queries tenant-scoped) |
| Log scan | Detect foreign tenant IDs in a trace (optional: log pipeline rule) |
| Gate | CI failure or blocks promotion to prod when harness fails |

---

## 5. Budget & Cost per Tenant

| Item | Link / Evidence |
|------|-----------------|
| Autonomy budget visibility | Per-account/tenant budget consumption (5.1/5.4) — config and state tables |
| Cost reports | Per-tenant or per-connector cost view (billing tags / Cost Explorer; link dashboard or report) |

---

## Sign-off

| Role | Done | Date |
|------|------|------|
| Eng (reliability) | ☐ | |
| Ops / SRE | ☐ | |
| Security / Compliance | ☐ | |

*Once all rows are checked and linked, Phase 5 is operationally ready for production.*
