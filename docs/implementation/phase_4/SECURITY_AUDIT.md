# Phase 4 — Security Audit (4.5A)

**Purpose:** Capture evidence for the Phase 4.5A security audit. Complete the checklist and fill evidence below (or link to artifacts). Reference this doc in the Phase 4 DoD sign-off.

**See:** `PHASE_4_5_CODE_LEVEL_PLAN.md` §6.

---

## Checklist

- [x] IAM permissions follow Zero Trust (least privilege per role)
- [x] No hardcoded secrets or credentials
- [x] External API calls use OAuth tokens (not stored credentials)
- [x] DynamoDB conditional writes prevent race conditions
- [x] Step Functions execution names enforce idempotency
- [x] Error messages don't leak sensitive information
- [x] All handlers validate tenant/account scope
- [x] Kill switches are accessible without redeploy

---

## Audit evidence

| Item | Evidence / location |
|------|----------------------|
| **IAM policy summaries** | CDK grants per Lambda: execution-starter, tool-invoker, execution-recorder, execution-status-api, internal-adapter. Function names: `ExecutionInfrastructureConfig` (`executionStarter`, `toolInvoker`, `executionRecorder`, `executionStatusApi`). Each handler has scoped DynamoDB/Events/S3/API permissions; Internal Adapter is in VPC with security group allowing only DynamoDB prefix list. See `src/stacks/constructs/ExecutionInfrastructure.ts` (grant* calls per handler). |
| **Tenant/account scope enforcement** | **Execution starter:** Input validated for `tenant_id`, `account_id`; intent loaded from ActionIntent table and scope passed through (`execution-starter-handler.ts`). **Status API:** `tenantId` from JWT authorizer claims; list/get scoped by tenantId and accountId (`execution-status-api-handler.ts`). **Recorder/Tool Invoker:** Receive tenant/account from Step Functions payload (no cross-tenant data). |
| **Kill switches** | **Execution validator** calls `KillSwitchService.isExecutionEnabled(tenant_id, intent.action_type)` before execution proceeds. Config: DynamoDB TenantConfig (`execution_enabled`, `disabled_action_types`); optional env/AppConfig for global kill. No redeploy required—update DynamoDB item or config. See `execution-validator-handler.ts`, `KillSwitchService`; unit tests in `execution-validator-handler.test.ts` (kill switch scenarios). |
| **DynamoDB conditional writes** | **ExecutionAttemptService:** `startAttempt` uses `ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)'` (exactly-once start); `completeAttempt` uses `#status IN (:succeeded, :failed, :cancelled)` and status update uses `#status = :running`. **ExecutionOutcomeService:** `recordOutcome` uses `attribute_not_exists(pk) AND attribute_not_exists(sk)` (exactly-once outcome). **IdempotencyService:** conditional write for idempotency keys. See `src/services/execution/ExecutionAttemptService.ts`, `ExecutionOutcomeService.ts`, `IdempotencyService.ts`. |

**Additional artifacts:** Store screenshots or CloudTrail excerpts in `audit/phase4-evidence/` if desired (e.g. JWT claim in API Gateway logs, kill switch toggle test).
