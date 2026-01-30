# Phase 4: State Contract and Why E2E Found Defects Unit/Integration Tests Missed

**Status:** Lessons learned (2026-01-29)  
**Purpose:** Explain why Step Functions input schema mismatches surfaced in E2E and how to catch them earlier.

---

## 1. What Happened

During E2E testing we hit a series of **ValidationError** failures:

- **ExecutionValidatorHandler:** Expected 6 fields; received 8 (missing `attempt_count`, `started_at` in schema).
- **ToolMapperHandler:** Expected flat state; received `valid` + `action_intent` (ValidatePreflight replaced state; fixed with `resultPath`).
- **ExecutionFailureRecorderHandler:** Expected `status: "FAILED"` and no `idempotency_key`/`attempt_count`/`started_at`; Catch passes full state + `error`.
- **ToolInvokerHandler:** Expected minimal ToolInvocationRequest; received full MapActionToTool output (`tool_schema_version`, `registry_version`, `compensation_strategy`, `started_at`).

Each handler’s **input** is the **output of the previous step** (or merged state). Unit and integration tests did not fail because they never asserted this end-to-end contract.

---

## 2. Root Cause: Contract Not Enforced Before E2E

### 2.1 State machine is a chain

```
EventBridge → StartExecution → ValidatePreflight → MapActionToTool → InvokeTool → (Choice) → RecordOutcome / RecordFailure
```

- Each step’s **output** becomes the **input** to the next (or is merged via `resultPath`).
- Changing one handler’s **return value** changes the next handler’s **input**. If the next handler’s schema is not updated, it fails at runtime.

### 2.2 Why unit tests didn’t catch it

- Unit tests use **hand-crafted payloads** that match the schema at the time the test was written.
- They do **not** use the **actual return shape** of the previous handler.
- When we added `attempt_count` and `started_at` to the execution-starter return, the execution-validator **schema** was not updated in the same change, and the validator **unit tests** still used the old 6-field payload—so both handler and tests were wrong together.

### 2.3 Why integration tests didn’t catch it

- Integration tests (e.g. execution-status-api, DynamoDB) typically:
  - Call **one** handler or API with a curated payload, or
  - Seed data and assert on DB/API, **without** running the full Step Functions state machine.
- There was no test that said: “Run step A, take its **real** output, pass it to step B, and assert B accepts it.”

### 2.4 E2E is the first time the full chain ran

- E2E runs: Seed → EventBridge → **real** Step Functions with **real** state propagation.
- So the **first** time every handler saw the **actual** output of the previous step was in E2E, and that’s when schema mismatches appeared.

---

## 3. Recommendations: Code and Test Plan

### 3.1 Single source of truth for state shape (code)

- **Option A:** Define **TypeScript types** (or Zod schemas) for “state after StartExecution”, “state after ValidatePreflight”, “state after MapActionToTool”, etc., in a **shared** module (e.g. `src/types/ExecutionStateMachineState.ts`).
- **Option B:** Document the **exact** output of each handler in the Execution Contract (e.g. PHASE_4_1/4_2_CODE_LEVEL_PLAN) and treat that as the contract; any handler input schema must accept that shape.
- **Rule:** When you change a handler’s **return value**, you must update (1) the next handler’s **input schema** and (2) any shared type/doc.

### 3.2 Unit tests: use “previous step” output (test plan)

- For handlers that receive state from a previous step, unit tests should use a **fixture that matches the previous handler’s real return value**.
- Example: Execution-validator-handler tests should use a `stateFromStartExecution()` that includes **every** field the execution-starter-handler returns (including `attempt_count`, `started_at`). That fixture should be derived from or documented against the starter’s return type.
- **Checklist:** When adding a field to handler A’s return, grep for “A’s output” / “state from A” and update handler B’s schema **and** B’s unit test fixtures.

### 3.3 Contract test: “output of A is valid input for B” (test plan)

- Add a **contract test** (or small integration test) that:
  1. Builds the **real** return value of handler A (e.g. execution-starter’s return object).
  2. Passes it to handler B’s **input schema** (e.g. execution-validator’s Zod schema).
  3. Asserts that B’s schema **accepts** it (e.g. `expect(BInputSchema.safeParse(AOutput)).toHaveProperty('success', true)`).
- This can live next to handler tests or in a dedicated `state-machine-contract.test.ts`. It catches “A added a field, B’s schema wasn’t updated” at **unit/integration** time, not E2E.

### 3.4 Integration test: one path through state machine (test plan)

- If feasible, add an integration test that **starts a Step Functions execution** (or invokes each Lambda in sequence with real state) for **one** path (e.g. happy path through RecordOutcome), and asserts terminal success. That would have caught “ToolInvoker received MapActionToTool output” at integration time. Prefer this in CI so E2E is not the first time the full chain runs.

### 3.5 Checklist for future handler changes

- [ ] If you change **handler output**: update the **next** handler’s input schema and its unit test fixtures.
- [ ] If you add a **new field** to output: add it to shared types/docs and to the **next** handler’s schema (required or optional).
- [ ] Run **contract test** (if added) and **E2E** after any change to a handler’s input or output.

**Implemented (2026-01):**

- **Shared state types:** `src/types/ExecutionStateMachineState.ts` — single source of truth for state after each step.
- **Shared input schemas:** `src/handlers/phase4/execution-state-schemas.ts` — Zod schemas (no env/side effects) so contract tests can import without loading handlers.
- **Contract test:** `src/tests/contract/phase4/state-machine-contract.test.ts` — asserts "output of A is valid input for B" for each step.
- **Checklist:** `docs/implementation/phase_4/HANDLER_CHANGE_CHECKLIST.md` — use when changing handler input/output.

---

## 4. Summary

| Finding | Cause | Fix |
|--------|--------|-----|
| Schema mismatches only in E2E | Unit tests use minimal/custom payloads; integration tests don’t run full SFN chain. | Fixtures = previous step’s real output; add contract test “A output → B input”. |
| No single state shape definition | Each handler defines its own “expected input” in isolation. | Shared types or documented contract; update downstream schema when upstream return changes. |
| E2E as first full run | No test before E2E passed real state step-to-step. | Contract test + optional integration test that runs one SFN path. |

Applying these will align code and test plans so **state contract** breaks are caught in unit or integration tests, not only in E2E.
