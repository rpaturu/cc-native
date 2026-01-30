# Phase 4 — Security Audit (4.5A)

**Purpose:** Capture evidence for the Phase 4.5A security audit. Complete the checklist and fill evidence below (or link to artifacts). Reference this doc in the Phase 4 DoD sign-off.

**See:** `PHASE_4_5_CODE_LEVEL_PLAN.md` §6.

---

## Checklist

- [ ] IAM permissions follow Zero Trust (least privilege per role)
- [ ] No hardcoded secrets or credentials
- [ ] External API calls use OAuth tokens (not stored credentials)
- [ ] DynamoDB conditional writes prevent race conditions
- [ ] Step Functions execution names enforce idempotency
- [ ] Error messages don’t leak sensitive information
- [ ] All handlers validate tenant/account scope
- [ ] Kill switches are accessible without redeploy

---

## Audit evidence

| Item | Evidence / location |
|------|----------------------|
| IAM policy summaries | By role (e.g. execution-starter, tool-invoker, recorder, status-api); document or link to CDK/CloudFormation. |
| Tenant/account scope enforcement | Sample CloudTrail or logs showing tenant binding (e.g. tenantId from JWT, accountId validated). |
| Kill switches | Proof kill switches work without redeploy (screenshot or log of toggle + behavior). |
| DynamoDB conditional writes | Code references or test names that demonstrate conditional writes (e.g. ExecutionAttemptService, idempotency). |

**Action:** Fill or link evidence above; store additional artifacts in `audit/phase4-evidence/` if desired.
