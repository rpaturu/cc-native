# Phase 4: Handler Change Checklist

**Purpose:** When you change a Phase 4 execution handler's **input** or **output**, use this checklist so state contract breaks are caught in unit/contract tests, not only in E2E.

See [STATE_CONTRACT_AND_TESTING.md](./STATE_CONTRACT_AND_TESTING.md) for why this matters.

---

## Checklist

- [ ] **If you change handler output:** Update the **next** handler's input schema (Zod) and its unit test fixtures.
- [ ] **If you add a new field to output:** Add it to `src/types/ExecutionStateMachineState.ts` (shared state types) and to the **next** handler's schema (required or optional).
- [ ] **Run contract test:** `npm test -- state-machine-contract` (or the Phase 4 contract test suite). Fix any failures.
- [ ] **Run E2E** after any change to a handler's input or output (or rely on CI).

---

## Handler chain reference

| Step              | Handler                         | Input source                    | Output → next step              |
|-------------------|----------------------------------|---------------------------------|---------------------------------|
| StartExecution    | execution-starter-handler       | EventBridge (action_intent_id, tenant_id, account_id) | StateAfterStartExecution → ValidatePreflight |
| ValidatePreflight | execution-validator-handler     | StateAfterStartExecution        | Merged via `resultPath: $.validation_result` → MapActionToTool |
| MapActionToTool   | tool-mapper-handler             | StateAfterValidatePreflight     | StateAfterMapActionToTool → InvokeTool |
| InvokeTool        | tool-invoker-handler            | StateAfterMapActionToTool       | Merged via `resultPath: $.tool_invocation_response` → RecordOutcome |
| RecordOutcome     | execution-recorder-handler      | StateAfterInvokeTool            | —                               |
| RecordFailure     | execution-failure-recorder-handler | Failed step state + `$.error` | —                               |

---

## Where to update

- **Shared state types:** `src/types/ExecutionStateMachineState.ts`
- **Input schemas:** `src/handlers/phase4/execution-state-schemas.ts` — single module for all Phase 4 handler input schemas (handlers import from here; contract test imports from here to avoid loading handler env).
- **Contract test:** `src/tests/contract/phase4/state-machine-contract.test.ts` — add or adjust fixtures so "output of A" is parsed by "input schema of B".
- **Unit test fixtures:** In handler unit tests, use fixtures that match the **real** return value of the previous handler (or the shared types).
