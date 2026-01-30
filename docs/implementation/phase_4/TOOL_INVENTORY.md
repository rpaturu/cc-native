# Execution Tool Inventory

## Purpose

Single source of truth for **execution tool names** so Gateway registration, Action Type Registry, adapters, and tests stay in sync. Name mismatches cause "Unknown tool" errors at runtime.

---

## Code-Level Constants

**File:** `src/constants/ExecutionToolNames.ts`

- `INTERNAL_CREATE_NOTE` = `'internal.create_note'`
- `INTERNAL_CREATE_TASK` = `'internal.create_task'`
- `CRM_CREATE_TASK` = `'crm.create_task'`
- `EXECUTION_TOOL_NAMES` = array of all known tools
- `ExecutionToolName` = type

**Use these constants in:**

- **ExecutionInfrastructure** – Gateway target registration and tool schema `name` (done).
- **Action Type Registry seed data** – DynamoDB records must use the same string for `tool_name` (e.g. seed scripts, fixtures).
- **Tests and fixtures** – Prefer importing constants instead of string literals.

---

## How the Inventory Is Maintained

| Layer | Source of truth | Notes |
|-------|-----------------|--------|
| **Constants** | `src/constants/ExecutionToolNames.ts` | Add new tools here first; then Gateway + registry + tests. |
| **Gateway** | CDK `registerGatewayTarget(..., toolName, schema)` | `toolName` and schema `name` must match the constant. |
| **Action Type Registry** | DynamoDB `action_type` → `tool_name` | `tool_name` must equal a constant (e.g. `internal.create_task`). |
| **Adapters** | Handlers route by tool name | Internal/CRM adapters expect namespaced names (e.g. `internal.create_task`). |

**Adding a new tool:**

1. Add constant in `ExecutionToolNames.ts` (e.g. `CALENDAR_CREATE_EVENT = 'calendar.create_event'`).
2. Register Gateway target in `ExecutionInfrastructure` with that constant and a schema whose `name` is the same constant.
3. Add Action Type Registry record(s) mapping `action_type` → `tool_name` = that constant.
4. Implement or extend adapter to handle the tool name; add tests.

---

## Strategy Doc References

Strategy docs describe **what** the system does, not a literal tool list:

- **DEAL_LIFECYCLE_ACTION_MAP_v2.md** – Action classes across the lifecycle (e.g. discovery prep, re-engagement, value articulation). Execution is **tool-agnostic**: the system "drives the right actions at the right moments"; tools are the mechanism.
- **AUTONOMOUS_REVENUE_DECISION_LOOP.md** – Action proposals include `action_type`; "the system selects tools dynamically" and execution is policy-gated. No enumerated tool inventory there; the **Action Type Registry** (action_type → tool_name) is the runtime mapping.
- **SCHEMA_REGISTRY_IMPLEMENTATION.md** – Entity schemas (Account, Contract, etc.) and versioning; separate from execution tools.

So: **strategy** = action classes and autonomy rules; **tool inventory** = code constants + Gateway + Action Type Registry, kept in sync via `ExecutionToolNames.ts` and this doc.

---

## Naming Convention

- **Format:** `{namespace}.{action}` (e.g. `internal.create_task`, `crm.create_task`).
- **Namespace** aligns with adapter/system: `internal`, `crm`, `calendar`, etc.
- **Action** is verb + noun; same action in different systems can share the suffix (e.g. `internal.create_task` vs `crm.create_task`).

---

## Checklist When Changing Tools

- [ ] Constant added or updated in `ExecutionToolNames.ts`.
- [ ] Gateway target and schema `name` use the constant (`ExecutionInfrastructure`).
- [ ] Action Type Registry seed/fixtures use the same `tool_name` string.
- [ ] Adapter handles the tool name (internal-adapter-handler, crm-adapter-handler, or new adapter).
- [ ] Tests/fixtures use the constant where applicable.
