# Phase 4 Low Coverage Plan — Tool Invoker Handler (61%)

**Status:** 🟡 In progress  
**Parent:** [PROJECT_TEST_COVERAGE_REVIEW.md](../../../testing/PROJECT_TEST_COVERAGE_REVIEW.md)  
**Related:** [PHASE_4_COVERAGE_TEST_PLAN.md](PHASE_4_COVERAGE_TEST_PLAN.md)  
**Scope:** Raise **tool-invoker-handler** from **71.9%** statements / 57.14% branches toward ≥80%.

---

## Current gaps (tool-invoker-handler)

**Uncovered blocks (summary):**

- **117–148:** Resilience path — when `RESILIENCE_TABLE_NAME` is set, use `invokeWithResilience` (DynamoDB + Gateway). Tests need env set and mocks for Dynamo + axios/nock.
- **177–211:** Direct axios path — when no resilience table, call Gateway via axios; cover 200 + MCP result, 200 with success:false, 4xx/5xx.
- **312–315, 335, 349, 353, 359, 362:** JWT / auth — getJwtToken success/failure, 401/403 handling.
- **376–397:** MCP response parsing — result extraction, error result.
- **445–464, 478–482, 512, 527–543, …:** TransientError vs PermanentError, tool-level success:false, validation error naming.
- **675–679, 703–705, 709–717, 728–730, 736–738, 742–745:** Error mapping (AxiosError, timeout, non-2xx), final throw with correct error name.

---

## Test cases to add

**Test file:** `src/tests/unit/execution/tool-invoker-handler.test.ts`

1. **ValidationError:** Invalid event (missing gateway_url, invalid URL, tool_arguments null) → throw with name ValidationError, message references schema.
2. **200 with success:false:** Nock Gateway 200 with body `{ success: false, error: { message: 'Tool failed' } }` → handler returns ToolInvocationResponse with success:false (no throw).
3. **Resilience path:** Set `process.env.RESILIENCE_TABLE_NAME`, mock DynamoDB and invokeWithResilience (or mock the module to return resolved response) → assert Gateway called via resilience wrapper.
4. **401 response:** Nock 401 → handler throws with PermanentError or AUTH.
5. **5xx response:** Nock 500 → handler throws TransientError.
6. **Timeout / network error:** Nock timeout or ECONNABORTED → handler throws TransientError.
7. **tool_arguments not plain object:** Array or null → ValidationError.
8. **tool_arguments exceeds 200KB:** Refinement fails → ValidationError.

---

## Verification

```bash
npm test -- --coverage --testPathIgnorePatterns=integration
```

Target: tool-invoker-handler ≥80% statements (stretch 85%).
