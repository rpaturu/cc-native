# Phase 5.4 Test Plan — Autonomous Execution

**Status:** 🟢 **COMPLETE** (unit tests for allowlist, auto-exec state, gate handler implemented)  
**Created:** 2026-01-28  
**Last Updated:** 2026-01-28  
**Parent:** [PHASE_5_4_CODE_LEVEL_PLAN.md](../PHASE_5_4_CODE_LEVEL_PLAN.md)

---

## Executive Summary

This document outlines the testing strategy for Phase 5.4 (Autonomous Execution). The plan covers **unit tests for AutoExecuteAllowListService, AutoExecStateService, and the auto-approval-gate handler**, plus **Phase 4 pass-through** (approval_source, auto_executed) which is validated by existing execution-starter and execution-recorder tests and schema validation.

**Testing philosophy:**  
Test allowlist resolution and auto-exec state (RESERVED/PUBLISHED) in isolation (unit); validate gate handler reject paths (missing input, intent not found, not allowlisted) with mocked services; rely on existing Phase 4 unit tests and schema for approval_source/auto_executed propagation. Integration tests (gate with real DDB/EventBridge) are optional and env-gated.

### Implementation Status

**✅ Unit tests – AutoExecuteAllowListService: COMPLETE**

- **Test file:** `src/tests/unit/autonomy/AutoExecuteAllowListService.test.ts`
- **Tests:** 6 (getAllowlist account-level, fallback to tenant-level, empty when no config; isAllowlisted true/false; putAllowlist tenant-level)
- **Status:** All passing ✅

**✅ Unit tests – AutoExecStateService: COMPLETE**

- **Test file:** `src/tests/unit/autonomy/AutoExecStateService.test.ts`
- **Tests:** 4 (getState null/present; setReserved with condition; setPublished)
- **Status:** All passing ✅

**✅ Unit tests – auto-approval-gate-handler: COMPLETE**

- **Test file:** `src/tests/unit/handlers/phase5/auto-approval-gate-handler.test.ts`
- **Tests:** 4 (REQUIRE_APPROVAL when action_intent_id missing; when tenant_id missing; when intent not found; when ACTION_TYPE_NOT_ALLOWLISTED)
- **Status:** All passing ✅

**✅ Phase 4 pass-through (approval_source, auto_executed): COVERED**

- **decision-api-handler:** Human approve path sets `approval_source: 'HUMAN'`, `auto_executed: false` in ACTION_APPROVED detail (manual/contract check).
- **ExecutionInfrastructure:** Step Functions input includes `approval_source` and `auto_executed` from event detail.
- **execution-state-schemas:** StartExecutionInputSchema, ValidatorInputSchema, ToolMapperInputSchema, RecorderInputSchema include optional `approval_source`, `auto_executed`.
- **execution-starter-handler:** Passes approval_source and auto_executed in output (covered by existing starter tests when input includes them).
- **execution-recorder-handler:** Passes approval_source and auto_executed to ExecutionOutcomeService.recordOutcome (covered by existing recorder/ExecutionOutcomeService tests).
- **ActionOutcomeV1:** Type includes approval_source and auto_executed; ExecutionOutcomeService persists them (write-once outcome tests remain valid).

**⏸ Integration tests: OPTIONAL (not implemented)**

- **Gate with real DDB/EventBridge:** Invoke gate Lambda with action_intent_id/tenant_id/account_id; allowlist + mode + policy + budget + AUTO_EXEC_STATE in real tables; assert AUTO_EXECUTED or REQUIRE_APPROVAL and EventBridge publish when AUTO_EXECUTED. Can be added when `AUTONOMY_CONFIG_TABLE_NAME`, `AUTONOMY_BUDGET_STATE_TABLE_NAME`, `ACTION_INTENT_TABLE_NAME`, `EVENT_BUS_NAME` are set (e.g. after deploy).

---

## Test Coverage (reified)

Concrete file paths, test counts, and test names as of implementation. Run `npm test` for unit tests (Phase 5.4 unit tests run with the rest of the suite).

### Unit tests — 14 tests across 3 files

| File | Tests | Test names |
|------|-------|------------|
| `src/tests/unit/autonomy/AutoExecuteAllowListService.test.ts` | 6 | `getAllowlist returns account-level list when present`; `getAllowlist falls back to tenant-level when account has no list`; `getAllowlist returns empty array when no config`; `isAllowlisted returns true when action_type is in list`; `isAllowlisted returns false when action_type is not in list`; `putAllowlist writes tenant-level allowlist` |
| `src/tests/unit/autonomy/AutoExecStateService.test.ts` | 4 | `getState returns null when no state`; `getState returns state when present`; `setReserved writes RESERVED with condition`; `setPublished writes PUBLISHED` |
| `src/tests/unit/handlers/phase5/auto-approval-gate-handler.test.ts` | 4 | `returns REQUIRE_APPROVAL when action_intent_id is missing`; `returns REQUIRE_APPROVAL when tenant_id is missing`; `returns REQUIRE_APPROVAL when intent not found`; `returns REQUIRE_APPROVAL with ACTION_TYPE_NOT_ALLOWLISTED when not allowlisted` |

### Coverage summary

| Layer | Files | Tests | Notes |
|-------|-------|-------|--------|
| AutoExecuteAllowListService | 1 | 6 | getAllowlist (account/tenant/empty); isAllowlisted; putAllowlist |
| AutoExecStateService | 1 | 4 | getState; setReserved (conditional); setPublished |
| auto-approval-gate-handler | 1 | 4 | Missing input; intent not found; not allowlisted |
| Phase 4 pass-through | (existing) | — | Schemas + starter/recorder/outcome; approval_source/auto_executed optional |
| **Total (5.4 unit)** | **3** | **14** | |

### Gaps / future tests (optional)

- **Gate success path (AUTO_EXECUTED):** Policy AUTO_EXECUTE + budget consumed + RESERVED → publish → PUBLISHED; requires mocking getIntent, isAllowlisted, getMode, evaluateAutoApprovalPolicy, getState, checkAndConsume, setReserved, PutEventsCommand, setPublished. Can be added as unit test with full mocks.
- **Gate idempotency (PUBLISHED):** getState returns PUBLISHED → result AUTO_EXECUTED, already_published; no consume, no publish.
- **Gate idempotency (RESERVED retry publish):** getState returns RESERVED → retry publish only, then setPublished.
- **Gate policy/budget reject:** Policy returns REQUIRE_APPROVAL or budget checkAndConsume false → REQUIRE_APPROVAL with reason.
- **Integration:** Gate with real autonomy config table, budget state table, action intent table, EventBridge (env-gated).

---

## Testing Strategy Overview

### 1. Unit tests (implemented)

- **AutoExecuteAllowListService:** getAllowlist (account-level, tenant fallback, empty); isAllowlisted (true/false); putAllowlist (tenant-level). Mocked DynamoDBDocumentClient via `__mocks__/aws-sdk-clients`.
- **AutoExecStateService:** getState (null, present); setReserved (conditional put RESERVED); setPublished (put PUBLISHED). Mocked DynamoDB.
- **auto-approval-gate-handler:** Missing action_intent_id or tenant_id → REQUIRE_APPROVAL MISSING_INPUT; intent not found (getIntent null) → REQUIRE_APPROVAL INTENT_NOT_FOUND; not allowlisted (isAllowlisted false) → REQUIRE_APPROVAL ACTION_TYPE_NOT_ALLOWLISTED. Handler loaded after setting process.env in beforeAll and jest.resetModules() so gate sees test table/bus names; all services mocked.

### 2. Phase 4 pass-through (covered by existing tests + schema)

- **Schemas:** StartExecutionInputSchema, RecorderInputSchema (and Validator/ToolMapper) include optional approval_source, auto_executed; contract tests or handler tests that pass these fields validate propagation.
- **ExecutionOutcomeService:** recordOutcome accepts outcome with approval_source and auto_executed; existing write-once and getOutcome tests remain valid; new fields are persisted when provided.
- **Human path:** decision-api-handler approve path sets approval_source HUMAN, auto_executed false in event detail (code review / manual verification).

### 3. Integration tests (optional)

- Invoke auto-approval-gate Lambda with event { action_intent_id, tenant_id, account_id }; seed allowlist, autonomy mode, policy (via mode), budget config and state, and optionally AUTO_EXEC_STATE; assert result AUTO_EXECUTED or REQUIRE_APPROVAL and, when AUTO_EXECUTED, that ACTION_APPROVED was published with approval_source POLICY and auto_executed true. Requires deployed stack or local DDB + EventBridge.

### 4. Out of scope for 5.4

- End-to-end from Phase 3 proposal → gate → Phase 4 execution (orchestration not implemented; gate is invoked with intent id).
- Load or chaos tests.
- Allowlist admin API (Phase 5.6 or follow-up).

---

## Execution

- **Unit tests (default):** `npm test` — excludes integration; all Phase 5.4 unit tests (AutoExecuteAllowListService, AutoExecStateService, auto-approval-gate-handler) run with the rest of the suite.
- **Unit tests filtered to 5.4:** `npm test -- --testPathPattern="AutoExecuteAllowListService|AutoExecStateService|auto-approval-gate-handler"` — runs only Phase 5.4 unit tests.
- **Integration tests:** No Phase 5.4–specific integration suite yet; optional suite would be env-gated on AUTONOMY_CONFIG_TABLE_NAME, AUTONOMY_BUDGET_STATE_TABLE_NAME, ACTION_INTENT_TABLE_NAME, EVENT_BUS_NAME.

---

## References

- **Code-level plan:** [PHASE_5_4_CODE_LEVEL_PLAN.md](../PHASE_5_4_CODE_LEVEL_PLAN.md)
- **Implementation plan:** [PHASE_5_IMPLEMENTATION_PLAN.md](../PHASE_5_IMPLEMENTATION_PLAN.md) EPIC 5.4
