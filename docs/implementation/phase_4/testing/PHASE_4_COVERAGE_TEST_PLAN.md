# Phase 4 Coverage Test Plan — Tool Invoker & Execution State Schemas

**Status:** 🟡 In progress  
**Parent:** [PROJECT_TEST_COVERAGE_REVIEW.md](../../../testing/PROJECT_TEST_COVERAGE_REVIEW.md)  
**Scope:** Raise unit coverage for Phase 4 tool-invoker-handler (61.15%) and execution-state-schemas (66.66%).

---

## Current gaps (from PROJECT_TEST_COVERAGE_REVIEW)

| Component | Stmts | Branch | Uncovered focus |
|-----------|-------|--------|-----------------|
| **tool-invoker-handler** | 61.15 | 51.29 | 117–148, 177–211, 312–315, 335, 349, 353, 359, 362, 376–397, 445–464, 478–482, 512, 527–543, 551, 554, 571, 581–587, 600, 616, 675–679, 703–705, 709–717, 728–730, 736–738, 742–745 |
| **execution-state-schemas** | 66.66 | 64.28 | 19–22 |

---

## 1. execution-state-schemas

**Test file:** Create `src/tests/unit/handlers/phase4/execution-state-schemas.test.ts` (or add to existing Phase 4 schema test if present).  
**Source:** `src/handlers/phase4/execution-state-schemas.ts`

### Uncovered lines 19–22

`autoExecutedOptional` preprocess: coerce `'true'` → true, `'false'` → false (string inputs). Current tests likely only hit boolean and undefined.

### Test cases to add

- **StartExecutionInputSchema** with `auto_executed: 'true'` → parsed as `true`.
- **StartExecutionInputSchema** with `auto_executed: 'false'` → parsed as `false`.
- **StartExecutionInputSchema** with `auto_executed: ''` or null → parsed as `undefined`.
- **StartExecutionInputSchema** with `approval_source: ''` or null → parsed as `undefined`.

**Strategy:** Import schemas, call `.parse()` / `.safeParse()` with the above inputs and assert parsed values.

---

## 2. tool-invoker-handler

**Test file:** `src/tests/unit/execution/tool-invoker-handler.test.ts`  
**Source:** `src/handlers/phase4/tool-invoker-handler.ts`

### Uncovered blocks (summary)

- **117–148:** Resilience path — when `RESILIENCE_TABLE_NAME` is set, use `invokeWithResilience` (DynamoDB-backed circuit breaker / retry). Tests need to set env and mock DynamoDB + Gateway response.
- **177–211:** Direct axios path — when resilience table not set, call Gateway via axios; cover success, 200 with success:false, 4xx/5xx, timeouts.
- **312–315, 335, 349, 353, 359, 362:** JWT / auth branches — getJwtToken success/failure, 401/403 handling.
- **376–397:** Response parsing — MCP jsonrpc response success, result extraction, error result.
- **445–464, 478–482, 512, 527–543, 551, 554, 571, 581–587, 600, 616:** TransientError vs PermanentError, tool-level failure (success:false), validation error naming.
- **675–679, 703–705, 709–717, 728–730, 736–738, 742–745:** Error mapping (AxiosError, timeout, non-2xx), final throw with correct error name.

### Test cases to add

1. **Resilience path (117–148):** Set `process.env.RESILIENCE_TABLE_NAME` and mock DynamoDBDocumentClient + invokeWithResilience; assert Gateway called via resilience wrapper and response returned.
2. **Direct axios path (177–211):** No resilience table; mock axios to return 200 + MCP result; assert response shape and success path.
3. **200 with success:false:** Mock Gateway 200 with body `{ success: false, error_code: '...' }`; assert handler returns ToolInvocationResponse with success:false (no throw).
4. **getJwtToken throw:** Mock Cognito to throw; assert handler throws (TransientError or PermanentError).
5. **401/403:** Mock axios to return 401 or 403; assert handler throws with appropriate error name.
6. **Timeout / network error:** Mock axios to throw with code ECONNABORTED or network error; assert TransientError.
7. **ValidationError:** Invalid event (missing gateway_url, invalid URL, etc.); assert throw with name ValidationError and message referencing ToolInvocationRequestSchema.
8. **tool_arguments refinement (70–80):** Payload not plain object or >200KB; assert validation failure.

**Strategy:** Mock CognitoIdentityProviderClient, SecretsManagerClient, DynamoDBClient (when resilience set), and axios. Invoke handler with valid ToolInvocationRequest; vary mocks to hit each branch.

---

## Verification

```bash
npm test -- --coverage --testPathIgnorePatterns=integration
```

Target: execution-state-schemas 100% for lines 19–22; tool-invoker-handler ≥80% statements (stretch 90%).
