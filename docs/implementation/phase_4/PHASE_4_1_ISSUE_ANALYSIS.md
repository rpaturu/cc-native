# Phase 4.1 Issue Analysis

**Review Date:** 2026-01-26  
**Status:** Analysis Complete - Issues Identified

---

## Issue Verification Results

### ✅ Issue 1: Error Taxonomy Split-Brain Between Handlers

**Status:** ❌ **ISSUE EXISTS**

**Evidence:**
- `execution-validator-handler.ts`: Uses typed `ExecutionError` subclasses (`IntentNotFoundError`, `IntentExpiredError`, `KillSwitchEnabledError`, `ValidationError`)
- `execution-starter-handler.ts`: Uses generic `Error` for:
  - Line 128: `throw new Error('ActionIntent not found: ...')` (should be `IntentNotFoundError`)
  - Line 134: `throw new Error('ActionIntent missing required field: registry_version')` (should be `ValidationError`)
  - Line 149: `throw new Error('Tool mapping not found...')` (should be `ValidationError`)
  - Line 221: Custom `ExecutionAlreadyInProgressError` extends `Error` (not `ExecutionError`)

**Impact:** Step Functions Catch/Retry logic will be inconsistent - starter handler errors won't be properly classified for retry decisions.

**Location:**
- `src/handlers/phase4/execution-starter-handler.ts` (lines 128, 134, 149, 221-227)

---

### ✅ Issue 2: startAttempt Rerun Semantics - No Explicit Rerun Flag

**Status:** ❌ **ISSUE EXISTS**

**Evidence:**
- `ExecutionAttemptService.startAttempt()` signature (line 33-40):
  ```typescript
  async startAttempt(
    actionIntentId: string,
    tenantId: string,
    accountId: string,
    traceId: string,
    idempotencyKey: string,
    stateMachineTimeoutSeconds?: number
  ): Promise<ExecutionAttempt>
  ```
- No `allow_rerun?: boolean` parameter
- Automatically allows rerun if status is terminal (line 99-100 in service)
- `execution-starter-handler.ts` always calls with no rerun flag (line 177)

**Impact:** Accidental duplicate `ACTION_APPROVED` events after success could re-run completed intents if conditional logic changes or item gets into unexpected terminal state.

**Location:**
- `src/services/execution/ExecutionAttemptService.ts` (line 33)
- `src/handlers/phase4/execution-starter-handler.ts` (line 177)

---

### ✅ Issue 3: Idempotency Key Includes action_intent_id

**Status:** ⚠️ **DESIGN CHOICE (Awareness Needed)**

**Evidence:**
- `IdempotencyService.generateIdempotencyKey()` (line 62-76):
  ```typescript
  const input = `${tenantId}:${actionIntentId}:${toolName}:${canonicalParams}:${registryVersion}`;
  ```
- Includes `actionIntentId` in the hash
- No separate `semantic_idempotency_key` method defined

**Impact:** 
- Two ActionIntents with identical params will have different idempotency keys (won't dedupe)
- If goal is "never double-write externally" across duplicate intents, current design won't achieve that

**Location:**
- `src/services/execution/IdempotencyService.ts` (line 74)

**Note:** This is a valid design choice for execution-layer idempotency, but semantic key may be needed for adapter-level dedupe if product goal is "no duplicate external writes".

---

### ✅ Issue 4: ExecutionAttempt TTL Deletion Can Hide Stuck Executions

**Status:** ❌ **ISSUE EXISTS**

**Evidence:**
- TTL is set (line 49 in `ExecutionAttemptService.ts`)
- TTL = `started_at + SFN timeout + 15min buffer`
- No operational sweeper/stale execution detector mentioned
- Only reference to "stuck" is in error message (line 1788 in plan doc)

**Impact:** TTL deletion means forensic evidence of "stuck RUNNING" states can be lost before investigation.

**Location:**
- `src/services/execution/ExecutionAttemptService.ts` (line 49)
- Plan doc mentions TTL for cleanup but no operational path

---

### ✅ Issue 5: DynamoDB Keying Pattern Could Limit Future Querying

**Status:** ❌ **ISSUE EXISTS**

**Evidence:**
- `ExecutionAttemptsTable` has only `gsi1` (by `action_intent_id`)
- `ExecutionOutcomesTable` has only `gsi1` (by `action_intent_id`)
- No GSI for:
  - "all executions for tenant (all accounts)"
  - "recent failures across tenant"
  - "by action_type"
  - "by tool_name"

**Impact:** Will need to scan tables for operational queries (e.g., "show me all failed executions for tenant X").

**Location:**
- `src/stacks/constructs/ExecutionInfrastructure.ts` (lines 86-90, 108-112)
- Only `gsi1-index` defined, no `gsi2-index`

---

### ✅ Issue 6: Ledger Event Types - Missing CANCELLED/EXPIRED

**Status:** ❌ **ISSUE EXISTS**

**Evidence:**
- `LedgerTypes.ts` has:
  - `EXECUTION_STARTED` ✅
  - `ACTION_EXECUTED` ✅
  - `ACTION_FAILED` ✅
- Missing:
  - `EXECUTION_CANCELLED` (for kill switch / manual cancel)
  - `EXECUTION_EXPIRED` (for intent expiration)

**Impact:** "Why didn't it run?" becomes ambiguous - can't distinguish between "failed" vs "cancelled" vs "expired".

**Location:**
- `src/types/LedgerTypes.ts` (lines 29-31)

---

### ✅ Issue 7: ActionTypeRegistry Latest Lookup - registry_version Validation

**Status:** ⚠️ **POTENTIAL ISSUE**

**Evidence:**
- `ActionTypeRegistryService.getToolMapping()` (line 65):
  ```typescript
  .sort((a, b) => (b.registry_version || 0) - (a.registry_version || 0));
  ```
- Uses `|| 0` fallback if `registry_version` is missing/null/undefined
- No explicit validation that `registry_version` is numeric and present

**Impact:** Bad data (missing `registry_version`) could be silently treated as version 0, causing wrong mapping selection.

**Location:**
- `src/services/execution/ActionTypeRegistryService.ts` (line 65)

---

### ✅ Issue 8: Parameter Mapping Validation - Should Be ValidationError

**Status:** ❌ **ISSUE EXISTS**

**Evidence:**
- `ActionTypeRegistryService.mapParametersToToolArguments()` (line 84):
  ```typescript
  throw new Error(`Required parameter missing: ${actionParam}`);
  ```
- Throws generic `Error`, not `ValidationError`

**Impact:** SFN will treat this as unknown error and may retry (should be terminal, not retryable).

**Location:**
- `src/services/execution/ActionTypeRegistryService.ts` (line 84)

---

### ✅ Issue 9: ExternalWriteDedupe Write Ordering - No History Query Fallback

**Status:** ❌ **ISSUE EXISTS**

**Evidence:**
- `IdempotencyService.checkExternalWriteDedupe()` (line 121):
  ```typescript
  // TODO: Implement history query fallback if needed (for Phase 4.1, LATEST should always exist)
  return null;
  ```
- If LATEST pointer is missing, returns `null` instead of querying history items
- Comment says "LATEST should always exist" but no fallback implemented

**Impact:** If LATEST write fails (network issue, partial write), `checkExternalWriteDedupe()` won't find existing records, leading to duplicate external writes.

**Location:**
- `src/services/execution/IdempotencyService.ts` (line 119-123)

---

## Summary

| Issue # | Issue | Status | Severity | Location |
|---------|-------|--------|----------|----------|
| 1 | Error taxonomy split-brain | ❌ EXISTS | High | execution-starter-handler.ts |
| 2 | No explicit rerun flag | ❌ EXISTS | Medium | ExecutionAttemptService.ts |
| 3 | Idempotency key design | ⚠️ DESIGN CHOICE | Low | IdempotencyService.ts |
| 4 | TTL deletion hides stuck executions | ❌ EXISTS | Medium | ExecutionAttemptService.ts |
| 5 | Limited DynamoDB querying | ❌ EXISTS | Medium | ExecutionInfrastructure.ts |
| 6 | Missing ledger event types | ❌ EXISTS | Low | LedgerTypes.ts |
| 7 | registry_version validation | ⚠️ POTENTIAL | Low | ActionTypeRegistryService.ts |
| 8 | Parameter validation error type | ❌ EXISTS | Medium | ActionTypeRegistryService.ts |
| 9 | No history query fallback | ❌ EXISTS | Medium | IdempotencyService.ts |

**Total Issues:** 7 confirmed, 2 design choices/awareness items

---

## Recommended Priority

**High Priority (Fix Before Phase 4.2):**
1. Issue 1: Unify error handling (starter uses typed errors)
2. Issue 2: Add explicit rerun flag to startAttempt()

**Medium Priority (Fix Soon):**
3. Issue 4: Add operational sweeper/stale execution detector
4. Issue 5: Add tenant-level GSI for operational queries
5. Issue 8: Change parameter validation to ValidationError
6. Issue 9: Implement history query fallback in checkExternalWriteDedupe()

**Low Priority (Nice to Have):**
7. Issue 6: Add EXECUTION_CANCELLED and EXECUTION_EXPIRED ledger events
8. Issue 7: Add explicit registry_version validation

**Design Decision (Product/Architecture):**
9. Issue 3: Decide if semantic idempotency key needed for adapter-level dedupe
