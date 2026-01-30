# Phase 4.5 — Testing & Polish: Code-Level Implementation Plan

**Status:** 🟢 **READY** (use **IN IMPLEMENTATION** when actively running the checklist)  
**Created:** 2026-01-26  
**Last Updated:** 2026-01-28  
**Parent Document:** `PHASE_4_CODE_LEVEL_PLAN.md`  
**Prerequisites:** Phase 4.1, 4.2, 4.3, and 4.4 complete ✅ (all complete as of 2026-01-28)

---

## Tracks: 4.5A Required vs 4.5B Optional

Phase 4.5 is split into two tracks so the sign-off gate is unambiguous.

| Track | Scope | Sign-off |
|-------|--------|----------|
| **4.5A — Required for Phase 4 sign-off** | Unit tests (done), status API integration (done), **one** deterministic E2E path (expanded test **or** executable script), docs (README + architecture), security audit with evidence, performance targets met | **Definition of Done (§8) applies only to 4.5A.** |
| **4.5B — Optional hardening** | Additional integration tests (idempotency, kill-switches recommended; others optional), performance tuning, troubleshooting guide, extra E2E coverage | Nice-to-have; does **not** block Phase 4 sign-off. |

**Bottom line:** Phase 4 is **complete** when 4.5A is done. 4.5B improves robustness and operability but is not required for sign-off.

---

## Current State (Post 4.1–4.4)

Phases 4.1–4.4 are **complete**. The following were delivered after this plan was created:

**Phase 4.4 (Safety & Outcomes):**
- Signal emission in execution-recorder-handler (`buildExecutionOutcomeSignal`, SignalService integration)
- Execution Status API handler (JWT auth, 404 semantics, pagination, CORS)
- CloudWatch alarms (state machine, Lambda errors)
- Unit tests: `execution-signal-helpers.test.ts`, `execution-status-api-handler.test.ts`
- Integration tests: `execution-status-api.test.ts` (11 tests, handler-direct + real DynamoDB), `end-to-end-execution.test.ts` (placeholder, skip when env missing)

**Test documentation:**
- Per-phase test plans: `testing/PHASE_4_2_TEST_PLAN.md`, `PHASE_4_3_TEST_PLAN.md`, `PHASE_4_4_TEST_PLAN.md`, `PHASE_4_4_INTEGRATION_TEST_PLAN.md` (all status COMPLETE)
- Optional entry point: `docs/implementation/phase_4/TESTING.md` — single “How to run tests” doc that links to the phase plans (see §4).

**Unit test coverage (4.1–4.4):** All services, handlers, and adapters listed in §1 have unit test files; see Phase 4.2, 4.3, and 4.4 test plans for counts and coverage notes.

---

## Overview

Phase 4.5 focuses on **4.5A required** work and **4.5B optional** hardening:

- ✅ Unit test coverage — **complete** (see §1)
- ✅ Execution-status-api integration — **complete**
- **4.5A:** One deterministic E2E path (expanded test **or** script), docs, security audit with evidence, performance targets
- **4.5B:** Optional integration expansion (idempotency + kill-switches recommended; others optional), performance tuning, troubleshooting guide

**Duration:** Week 6-7 (or as needed for 4.5A)  
**Dependencies:** Phase 4.1, 4.2, 4.3, and 4.4 complete ✅

---

## 1. Unit Tests

### Status: ✅ Complete (delivered in 4.1–4.4)

All listed files exist and are covered by Phase 4.2, 4.3, and 4.4 test plans. No 4.5 action required.

**Reference:** `testing/PHASE_4_2_TEST_PLAN.md`, `testing/PHASE_4_3_TEST_PLAN.md`, `testing/PHASE_4_4_TEST_PLAN.md`

**State contract (why E2E found schema mismatches):** See `STATE_CONTRACT_AND_TESTING.md` for root cause (unit/integration tests use hand-crafted payloads; state machine chain was only run in E2E) and recommendations (fixtures = previous step output, contract test, checklist for handler changes).

(Full file list retained in prior version; unchanged.)

---

## 2. Integration Tests

### Done (Phase 4.4)

- ✅ `src/tests/integration/execution/execution-status-api.test.ts` — 11 tests (handler-direct + real DynamoDB)
- ✅ `src/tests/integration/execution/end-to-end-execution.test.ts` — placeholder (skip when env missing)

### 4.5B — Recommended (high leverage for execution safety)

- **Recommended:** `src/tests/integration/execution/idempotency.test.ts` — Dual-layer idempotency
- **Recommended:** `src/tests/integration/execution/kill-switches.test.ts` — Kill switch behavior

### 4.5B — Optional (later)

- `src/tests/integration/execution/execution-flow.test.ts`
- `src/tests/integration/execution/orchestration-flow.test.ts`
- `src/tests/integration/execution/tool-invocation.test.ts`
- `src/tests/integration/execution/connector-adapters.test.ts`
- `src/tests/integration/execution/gateway-integration.test.ts`

**Reference:** `testing/PHASE_4_4_INTEGRATION_TEST_PLAN.md`, `testing/PHASE_4_3_TEST_PLAN.md`

---

## 3. End-to-End: One Deterministic Path Required (4.5A)

**Requirement (4.5A):** At least **one** deterministic E2E path must exist. Choose **either**:

- **(a)** Expand `end-to-end-execution.test.ts` so one full path (e.g. ACTION_APPROVED → Step Functions → outcome recorded) runs and passes when env is present, **or**
- **(b)** Provide an executable E2E script that is **self-contained and runnable** (see below).

### Making E2E deterministic (script option)

The script must not stop at “Set ACTION_INTENT_ID … exit 1.” Use one of:

| Option | Description | When to use |
|--------|-------------|-------------|
| **B1 — Phase 3 API** | Require `DECISION_API_URL` and `DECISION_AUTH_HEADER`. Script calls Phase 3: create ActionIntent → approve → wait → verify (Execution Status API or DDB). | When Phase 3 Decision API is deployed and emits ACTION_APPROVED to EventBridge (or otherwise starts execution). |
| **B2 — Seed + verify** | Companion script `seed-phase4-e2e-intent.sh` writes a minimal action intent to the ActionIntent table and puts an ACTION_APPROVED event to EventBridge; then `test-phase4-execution.sh` waits and verifies. No Phase 3 API needed. | Copy-paste runnable in any deployed environment (dev/stage/prod). |

**Recommended for 4.5A:** Implement **B2** so the E2E path is guaranteed runnable without depending on Phase 3 API availability. B1 can be added later when the Decision API is the primary trigger.

### Prerequisites (all paths)

- **Source of truth for env** — **Preferred:** populate `.env` from CDK outputs (`./deploy` or `cdk deploy` writes stack outputs → `.env`). Do **not** rely on fallbacks outside dev; scripts **fail fast** if required vars are unset.
- **AWS_REGION** — **Required.** Set to the region where the stack is deployed (e.g. `us-east-1`, `us-west-2`). Do not rely on a default; document “set AWS_REGION to the deployed region” in README or run instructions.
- **Script prerequisites (tools)** — **AWS CLI v2** and **jq** are required. Caller must have IAM: `dynamodb:PutItem` (attempts/outcomes/intent tables as used), `events:PutEvents` (custom bus), optionally `states:DescribeExecution` for SFN checks; if using Execution Status API for verification, `execute-api` invoke (or equivalent) for the API.
- Deployed stack; all table names and (for B2) event bus name **required** via env (no fallbacks — fail fast).

### Verification: API first, DDB optional

- **Primary:** Use the **Execution Status API** (curl) to verify execution status by `action_intent_id`. This avoids hardcoded DynamoDB key shapes.
- **Secondary:** If you verify via DynamoDB, do **not** hardcode key prefixes. Use env vars so key format can evolve:
  - `ATTEMPT_SK_PREFIX` (default `EXECUTION#`) — matches `ExecutionAttemptService` / `ExecutionTypes`.
  - `OUTCOME_SK_PREFIX` (default `OUTCOME#`) — matches `ExecutionOutcomeService`.

Current schema (for reference): attempts `sk = EXECUTION#<action_intent_id>`, outcomes `sk = OUTCOME#<action_intent_id>`.

### EventBridge event schema (seed script contract)

The seed script emits: source `cc-native`, detail-type `ACTION_APPROVED`, and `detail` containing `data` with `action_intent_id`, `tenant_id`, `account_id`. The **Rule target (Step Functions) input** must match the real Phase 4 trigger contract: the SFN input is built from `$.detail.data` (see `ExecutionInfrastructure.createExecutionTriggerRule`). The seed script must emit exactly that shape so the Rule passes `action_intent_id`, `tenant_id`, `account_id` into the state machine; otherwise execution will not start.

**Rule name (for sanity-check in AWS Console):** The EventBridge rule is created with construct id `ExecutionTriggerRule` in `ExecutionInfrastructure`; in EventBridge → Rules, select the custom bus (e.g. `cc-native-events`) and find the rule named by the stack (e.g. `CCNativeStack-ExecutionInfra...-ExecutionTriggerRule...`). Pattern: source `cc-native`, detail-type `ACTION_APPROVED`.

### Prior phase alignment (seeding)

Phase 4 E2E seeding is **aligned with Phase 3** (`scripts/phase_3/test-phase3-api.sh`):

- **.env from project root** — Both scripts load `.env` from the repo root when present (e.g. after `./deploy`). **Fail fast:** all required table names and event bus name must be set (no fallbacks outside dev).
- **DynamoDB put-item for seed data** — Phase 3 seeds tenant + AccountPostureState via `aws dynamodb put-item` (AttributeValue format); Phase 4 seeds one action intent the same way.
- **Cleanup** — Phase 3 cleans up test tenant and posture state on exit (trap). Phase 4 leaves seeded intent and execution data for inspection. If running in shared environments, consider a cleanup script or tags to avoid long-term clutter.

Phase 4 adds: **EventBridge put-events** to trigger execution (ACTION_APPROVED), so the flow is seed → trigger → verify.

### Scripts (B2: seed + verify)

- **`scripts/phase_4/seed-phase4-e2e-intent.sh`** — Writes one minimal action intent to the ActionIntent table and puts ACTION_APPROVED to EventBridge (source `cc-native`, detail-type `ACTION_APPROVED`, `detail.data`: `action_intent_id`, `tenant_id`, `account_id` — must match SFN input contract above). Outputs `ACTION_INTENT_ID` for the verify script. Loads `.env` from project root if present. **Required (fail fast):** `AWS_REGION`, `EVENT_BUS_NAME`, `ACTION_INTENT_TABLE_NAME`. See **Script prerequisites** above for tools (AWS CLI v2, jq).
- **`scripts/phase_4/test-phase4-execution.sh`** — Loads `.env` from project root if present. If `ACTION_INTENT_ID` is not set and `DECISION_API_URL` is not set, runs the seed script and captures `ACTION_INTENT_ID`. Then waits (e.g. 30–60 s), then verifies via Execution Status API (curl) if `EXECUTION_STATUS_API_URL` and auth are set; otherwise verifies via DynamoDB using `EXECUTION_ATTEMPTS_TABLE` / `EXECUTION_OUTCOMES_TABLE` and optional `ATTEMPT_SK_PREFIX` / `OUTCOME_SK_PREFIX`. **Required (fail fast):** `AWS_REGION`, `EXECUTION_ATTEMPTS_TABLE` or `EXECUTION_ATTEMPTS_TABLE_NAME`, `EXECUTION_OUTCOMES_TABLE` or `EXECUTION_OUTCOMES_TABLE_NAME`; for B2 seed step also `EVENT_BUS_NAME`, `ACTION_INTENT_TABLE_NAME`. For API verification also `EXECUTION_STATUS_API_URL` and auth. See **Script prerequisites** above for tools.

**Usage (B2):** Populate `.env` from CDK outputs (preferred); or set `AWS_REGION`, `EVENT_BUS_NAME`, `EXECUTION_ATTEMPTS_TABLE` (or `EXECUTION_ATTEMPTS_TABLE_NAME`), `EXECUTION_OUTCOMES_TABLE` (or `EXECUTION_OUTCOMES_TABLE_NAME`), `ACTION_INTENT_TABLE_NAME`, and optionally `EXECUTION_STATUS_API_URL` + auth. Run `./scripts/phase_4/test-phase4-execution.sh`; it will seed then verify. No manual ACTION_INTENT_ID needed.

---

## 4. Documentation (4.5A Required)

### Required updates

- **README.md** — Phase 4 execution overview (what runs, how to deploy, how to run tests).
- **Architecture / implementation status** — `docs/implementation/phase_4/PHASE_4_ARCHITECTURE.md` and/or `PHASE_4_IMPLEMENTATION_PLAN.md` updated to “complete” or current status when Phase 4 is signed off.

### Optional entry point (nice-to-have)

- **`docs/implementation/phase_4/TESTING.md`** — Short “How to run Phase 4 tests” doc (created); links to:
  - `testing/PHASE_4_2_TEST_PLAN.md` (unit 4.1+4.2)
  - `testing/PHASE_4_3_TEST_PLAN.md` (unit 4.3)
  - `testing/PHASE_4_4_TEST_PLAN.md` (unit 4.4)
  - `testing/PHASE_4_4_INTEGRATION_TEST_PLAN.md` (integration + E2E placeholder)

### 4.5B Optional

- `docs/implementation/phase_4/PHASE_4_TROUBLESHOOTING.md` — Common issues and fixes.

---

## 5. Performance (4.5A: Targets Required; 4.5B: Tuning)

### 4.5A — Minimal success criteria (required for DoD)

Define and meet **at least** these so “performance meets requirements” is objective:

| Metric | Target (example; set to your SLOs) |
|--------|-------------------------------------|
| p95 end-to-end execution latency | Approval → outcome recorded ≤ X s (e.g. 60 s) |
| Max concurrent executions | No throttling below N (e.g. 10) concurrent executions |
| Tool invocation p95 latency | Gateway → adapter → response ≤ Y s (e.g. 5 s) |
| Retry / error rate | Acceptable retry rate ≤ Z% (e.g. 5%) under normal load |

**Action:** Replace placeholders (X, N, Y, Z) with real targets before sign-off. If no load testing is done, **explicitly defer** performance measurement to 4.5B: fill `docs/implementation/phase_4/PERFORMANCE_DEFERRAL.md` (created) with rationale + ticket, or document in §5. Without that, the DoD is not met.

### 4.5B — Test scenarios (optional)

1. Concurrent executions
2. Retry behavior
3. Idempotency under race conditions
4. Gateway latency
5. Step Functions throughput

---

## 6. Security Audit (4.5A Required + Evidence)

### Checklist (unchanged)

- [ ] IAM permissions follow Zero Trust (least privilege per role)
- [ ] No hardcoded secrets or credentials
- [ ] External API calls use OAuth tokens (not stored credentials)
- [ ] DynamoDB conditional writes prevent race conditions
- [ ] Step Functions execution names enforce idempotency
- [ ] Error messages don’t leak sensitive information
- [ ] All handlers validate tenant/account scope
- [ ] Kill switches are accessible without redeploy

### 4.5A — Audit evidence (required for sign-off)

Capture the following so the audit is reviewable:

| Item | Evidence / location |
|------|----------------------|
| IAM policy summaries | By role (e.g. execution-starter, tool-invoker, recorder, status-api); document or link to CDK/CloudFormation. |
| Tenant/account scope enforcement | Sample CloudTrail or logs showing tenant binding (e.g. tenantId from JWT, accountId validated). |
| Kill switches | Proof kill switches work without redeploy (screenshot or log of toggle + behavior). |
| DynamoDB conditional writes | Code references or test names that demonstrate conditional writes (e.g. ExecutionAttemptService, idempotency). |

**Action:** Store evidence in `docs/implementation/phase_4/SECURITY_AUDIT.md` (checklist + evidence table; created) or `audit/phase4-evidence/`, and reference it in the DoD sign-off.

---

## 7. Implementation Checklist

### 4.5A — Required (all must be done for Phase 4 sign-off)

- [x] Unit test coverage complete (4.1–4.4)
- [x] Execution-status-api integration tests pass
- [ ] **One** deterministic E2E path: either expanded `end-to-end-execution.test.ts` **or** executable script (e.g. `test-phase4-execution.sh`) — choose one
- [ ] README + architecture/implementation docs updated
- [ ] Security audit checklist completed **and** evidence documented (see §6)
- [ ] Performance targets defined **and** met, or explicitly deferred to 4.5B with rationale + ticket

### 4.5B — Optional (do not block sign-off)

- [ ] Recommended: `idempotency.test.ts`, `kill-switches.test.ts`
- [ ] Other integration tests (orchestration, gateway, adapters)
- [ ] Optional: `TESTING.md` entry point, `PHASE_4_TROUBLESHOOTING.md`
- [ ] Performance tuning beyond minimal targets
- [ ] Additional E2E coverage

---

## 8. Definition of Done — 4.5A Only (Phase 4 Sign-Off Gate)

Phase 4 is **complete** when **all** of the following are true (4.5A only):

1. **Unit tests** — All unit tests pass (already delivered in 4.1–4.4).
2. **Status API integration** — Execution-status-api integration tests pass (already delivered in 4.4).
3. **One deterministic E2E path** — Either (a) expanded `end-to-end-execution.test.ts` with one full path passing when env is present, or (b) an executable E2E script (e.g. `test-phase4-execution.sh`) that passes in a deployed environment.
4. **Docs** — README and architecture/implementation status updated.
5. **Security audit** — Checklist in §6 completed and evidence documented (IAM, tenant binding, kill switches, conditional writes).
6. **Performance** — Minimal targets in §5 defined and met, or **explicitly deferred to 4.5B with rationale + ticket** (e.g. “Performance measurement deferred to 4.5B; rationale: …; ticket: …”).

**4.5B** (optional integration tests, troubleshooting guide, extra performance work) is **not** required for Phase 4 sign-off.

---

## 9. Next Steps

After 4.5A is complete and Phase 4 is signed off:

- Phase 4 is production-ready.
- Proceed to Phase 5 (if defined) or production deployment.
- 4.5B can be done in parallel or later for hardening.

---

**See also:** `PHASE_4_CODE_LEVEL_PLAN.md`, `PHASE_4_4_CODE_LEVEL_PLAN.md`, `testing/PHASE_4_2_TEST_PLAN.md`, `testing/PHASE_4_3_TEST_PLAN.md`, `testing/PHASE_4_4_TEST_PLAN.md`, `testing/PHASE_4_4_INTEGRATION_TEST_PLAN.md`.
