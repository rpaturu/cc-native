# Phase 4 — Troubleshooting

**Purpose:** Common issues and fixes for Phase 4 (Execution) development and operations.  
**See also:** `PHASE_4_5_CODE_LEVEL_PLAN.md`, `PHASE_4_ARCHITECTURE.md`, `TESTING.md`.

---

## Deployment and environment

### Deploy fails: "Invalid prefix list ID" or DynamoDB prefix list missing

**Cause:** Internal Adapter Lambda is in a VPC and needs the DynamoDB managed prefix list for the region. The deploy script must pass `dynamoDbPrefixListId` via CDK context.

**Fix:** Run `./deploy` (not only `cdk deploy`). The deploy script looks up the prefix list with `aws ec2 describe-managed-prefix-lists` and passes `-c dynamoDbPrefixListId=pl-xxx` to CDK. If deploying manually, run:
```bash
PL_ID=$(aws ec2 describe-managed-prefix-lists --region $AWS_REGION --query "PrefixLists[?PrefixListName=='com.amazonaws.$AWS_REGION.dynamodb'].PrefixListId" --output text)
cdk deploy -c dynamoDbPrefixListId=$PL_ID
```

### Integration or E2E tests fail: "Missing required env"

**Cause:** Table names and event bus name come from stack outputs. Without a prior deploy (or a populated `.env`), required vars are unset.

**Fix:** Run `./deploy` once so it writes `.env` from stack outputs. Or copy `.env.example` (if present) and fill values from AWS Console (DynamoDB tables, EventBridge bus). To skip integration/E2E instead: set `SKIP_EXECUTION_STATUS_API_INTEGRATION=1`, `SKIP_IDEMPOTENCY_INTEGRATION=1`, `SKIP_KILL_SWITCHES_INTEGRATION=1`, or `./deploy --skip-e2e`.

---

## Execution flow

### Step Functions never start (ACTION_APPROVED has no effect)

**Cause:** EventBridge rule may not match, or rule target (Step Functions) input may be wrong.

**Checks:**
1. EventBridge → Custom bus (e.g. `cc-native-events`) → Rules. Find rule for source `cc-native`, detail-type `ACTION_APPROVED`. Ensure it is enabled and target is the execution state machine.
2. Seed script (or Phase 3) must emit `detail.data` with `action_intent_id`, `tenant_id`, `account_id`. The rule passes `$.detail.data` to Step Functions; if shape differs, SFN may not receive valid input.

### Execution starter fails: "Execution already in progress" or "Execution already completed"

**Cause:** Idempotency: a second `startAttempt` for the same `action_intent_id` (with `allow_rerun=false`) is rejected. This is by design (conditional write in `ExecutionAttemptService`).

**Fix:** Do not duplicate ACTION_APPROVED events for the same intent. For intentional re-runs, use the admin path with `allow_rerun=true` (if implemented). For tests, use a fresh `action_intent_id` per run.

### Tool Invoker fails: "InvalidToolResponseError" or "external_object_refs" not found

**Cause:** Gateway (Bedrock AgentCore) may return the tool payload nested inside `result.content[].text` (MCP envelope) instead of at top level.

**Fix:** Tool Invoker uses `getPayloadFromResponse` to accept both top-level and nested payloads. Ensure you are on a version that includes this helper. If a new envelope shape appears, extend the helper in `tool-invoker-handler.ts`.

### Execution recorder: outcome already exists (ConditionalCheckFailedException)

**Cause:** `ExecutionOutcomeService.recordOutcome` uses a conditional write (exactly-once). A second record for the same intent/key returns the existing outcome (idempotent). If you see a different error, check that the same outcome is not being written twice with different payloads.

**Fix:** Retries are safe: the service returns the existing outcome on duplicate write. No application change needed unless the error is something other than conditional check (e.g. validation).

---

## Kill switches and security

### Executions still run after disabling tenant or action type

**Cause:** Kill switch is read in the **execution-validator** step. If the validator is not in the chain, or config is cached, behavior may lag.

**Checks:**
1. Ensure execution flow goes through the validator (Step Functions: StartExecution → ValidateExecution → …).
2. Tenant config: DynamoDB tenants table, item key `tenantId`, attributes `execution_enabled` (boolean), `disabled_action_types` (string list). Update the item and re-run; no redeploy needed.
3. Global kill: set Lambda env `GLOBAL_EXECUTION_STOP=true` for the execution-validator (or all execution Lambdas). Requires redeploy or config update.

### Status API returns 401 Unauthorized

**Cause:** Execution Status API uses JWT authorizer. Request must include a valid JWT with tenant (and optionally account) claims.

**Fix:** Use the same auth as the Phase 3 Decision API or frontend: include `Authorization: Bearer <JWT>`. For local testing, obtain a JWT from Cognito or your IdP and pass it in the header.

---

## Tests

### Unit tests pass but integration tests fail locally

**Cause:** Integration tests hit real DynamoDB (and optionally EventBridge, API). Credentials and env must be set; tables must exist.

**Fix:** Run `./deploy` once in the target account/region so `.env` is populated. Set `AWS_REGION` and ensure AWS credentials (profile or env) have access to the tables. Use skip flags (see above) if you intend to run only unit tests.

### Idempotency or kill-switches integration tests fail in CI

**Cause:** CI may not have AWS credentials or table names.

**Fix:** In CI, set `SKIP_IDEMPOTENCY_INTEGRATION=1` and `SKIP_KILL_SWITCHES_INTEGRATION=1` unless you run integration tests in a deployed environment with credentials.

---

## References

- **Phase 4.5 code plan:** [PHASE_4_5_CODE_LEVEL_PLAN.md](PHASE_4_5_CODE_LEVEL_PLAN.md)
- **Phase 4 architecture:** [PHASE_4_ARCHITECTURE.md](PHASE_4_ARCHITECTURE.md)
- **How to run tests:** [TESTING.md](TESTING.md)
- **E2E script:** [testing/PHASE_4_5_E2E_TEST_PLAN.md](testing/PHASE_4_5_E2E_TEST_PLAN.md)
