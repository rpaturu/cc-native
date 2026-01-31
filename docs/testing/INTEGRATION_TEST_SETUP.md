# Integration Test Setup Guide

This guide explains how to set up IAM permissions for running integration tests against real AWS resources.

## Overview

Integration tests use **real AWS resources** (DynamoDB, S3, EventBridge) and require proper IAM permissions. The test suite includes a CDK construct that creates an IAM managed policy with all necessary permissions.

## Prerequisites

1. **Infrastructure Deployed**: Run `./deploy` to deploy the CDK stack
2. **AWS Credentials Configured**: Set `AWS_PROFILE` in `.env.local` or use `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`
3. **IAM User or Role**: You need an IAM user or role to attach the policy to

## Quick Setup

### Step 1: Deploy Infrastructure

```bash
./deploy
```

This creates the `TestUserPolicy` IAM managed policy and outputs its ARN.

### Step 2: Attach Policy to Your IAM User

**Option A: Managed Policy (Recommended - Use this if you have < 10 managed policies)**

```bash
# For IAM user
./scripts/attach-test-policy.sh --user amplify_admin

# For IAM role
./scripts/attach-test-policy.sh --role MyTestRole

# With custom profile/region
./scripts/attach-test-policy.sh --profile dev --region us-east-1 --user my-test-user
```

**Note**: If you already have an inline policy (like `StackCreateListDeletePolicy`), you should use managed policies for test permissions to avoid the 2048-byte cumulative inline policy limit.

**Option B: Inline Policy (Only if you have < 10 managed policies AND no existing inline policies)**

If you get the error `LimitExceeded: Cannot exceed quota for PoliciesPerUser: 10`, and you don't have existing inline policies, you can use inline policies:

```bash
# For IAM user (inline policy - no quota limit)
./scripts/attach-test-policy-inline.sh --user amplify_admin

# For IAM role
./scripts/attach-test-policy-inline.sh --role MyTestRole
```

**Important**: Inline policies have a **cumulative 2048-byte limit** across ALL inline policies per user. If you already have inline policies (like `StackCreateListDeletePolicy` at 3525 bytes), you cannot add more inline policies. Use managed policies instead.

### Step 3: Verify Permissions

```bash
# Check attached policies
aws iam list-attached-user-policies --user-name amplify_admin --no-cli-pager

# Or for roles
aws iam list-attached-role-policies --role-name MyTestRole --no-cli-pager
```

### Step 4: Run Tests

**Unit tests only** (default; run before deploy):
```bash
npm test
# or: npm run test:unit
```

**Integration tests only** (run after deploy; uses `.env` from deploy):
```bash
npm run test:integration
```

**All tests** (unit + integration):
```bash
npm run test:all
```

Integration tests are also run automatically **after** a successful `./deploy` (unless you pass `--skip-integration-tests`). Use `./deploy --skip-integration-tests` to deploy without running integration tests.

## Manual Setup (Alternative)

If you prefer to attach the policy manually:

### 1. Get Policy ARN from Stack Outputs

```bash
aws cloudformation describe-stacks \
  --stack-name CCNativeStack \
  --query 'Stacks[0].Outputs[?OutputKey==`TestUserPolicyArn`].OutputValue' \
  --output text \
  --no-cli-pager
```

### 2. Attach Policy to IAM User

```bash
aws iam attach-user-policy \
  --user-name amplify_admin \
  --policy-arn <POLICY_ARN_FROM_STEP_1> \
  --no-cli-pager
```

### 3. Attach Policy to IAM Role (if using role)

```bash
aws iam attach-role-policy \
  --role-name MyTestRole \
  --policy-arn <POLICY_ARN_FROM_STEP_1> \
  --no-cli-pager
```

## What Permissions Are Granted?

The `TestUserPolicy` grants the following permissions:

### DynamoDB
- Full access (PutItem, GetItem, UpdateItem, DeleteItem, Query, Scan, Batch operations) to all tables:
  - `cc-native-tenants`
  - `cc-native-evidence-index`
  - `cc-native-world-state`
  - `cc-native-snapshots-index`
  - `cc-native-schema-registry`
  - `cc-native-critical-field-registry`
  - `cc-native-ledger`
  - `cc-native-cache`
  - `cc-native-accounts`
  - `cc-native-signals`
  - `cc-native-tool-runs`
  - `cc-native-approval-requests`
  - `cc-native-action-queue`
  - `cc-native-policy-config`
  - `cc-native-methodology`
  - `cc-native-assessment`
  - `cc-native-identities`
- Access to all Global Secondary Indexes (GSIs) on these tables

### S3
- Full access (GetObject, PutObject, DeleteObject, ListBucket, GetObjectVersion, PutObjectVersion) to all buckets:
  - Evidence Ledger Bucket
  - World State Snapshots Bucket
  - Schema Registry Bucket
  - Artifacts Bucket
  - Ledger Archives Bucket

### EventBridge
- `PutEvents` permission on the `cc-native-events` event bus

## Troubleshooting

### Error: "User is not authorized to perform: events:PutEvents"

**Solution**: The IAM user/role doesn't have the TestUserPolicy attached. Run:
```bash
./scripts/attach-test-policy.sh --user <your-iam-user-name>
```

Or if you're hitting the managed policy limit:
```bash
./scripts/attach-test-policy-inline.sh --user <your-iam-user-name>
```

### Error: "LimitExceeded: Cannot exceed quota for PoliciesPerUser: 10"

**Solution**: AWS limits IAM users to 10 managed policies. Use the inline policy script instead:
```bash
./scripts/attach-test-policy-inline.sh --user <your-iam-user-name>
```

Inline policies don't count toward this limit.

### Error: "Maximum policy size of 2048 bytes exceeded"

**Solution**: AWS limits inline policies to 2048 bytes. The script automatically splits the policy into 3 smaller policies:
- `CCNativeTestUserPolicy-DynamoDB`
- `CCNativeTestUserPolicy-S3`
- `CCNativeTestUserPolicy-EventBridge`

Each policy is under the limit and provides the same permissions when combined.

### Error: "Could not find TestUserPolicyArn in stack outputs"

**Solution**: The stack needs to be redeployed to include the TestUserPolicy. Run:
```bash
./deploy
```

### Error: "AccessDeniedException" for DynamoDB or S3

**Solution**: Verify the policy is attached and the resource names match:
```bash
# Check attached policies
aws iam list-attached-user-policies --user-name <your-user> --no-cli-pager

# Verify policy exists
aws iam get-policy --policy-arn <policy-arn> --no-cli-pager
```

### Policy Not Taking Effect

**Solution**: IAM policy changes can take a few seconds to propagate. Wait 10-30 seconds and try again. If still not working, verify:
1. Policy is attached to the correct user/role
2. You're using the correct AWS credentials
3. The policy ARN matches the one in stack outputs

## Security Considerations

⚠️ **Important**: The TestUserPolicy grants **full access** to all CC Native resources. This is intentional for integration tests, but:

1. **Only attach to test users/roles** - Never attach to production IAM entities
2. **Use separate AWS account** - Run integration tests in a dedicated sandbox account
3. **Rotate credentials regularly** - Test credentials should be rotated periodically
4. **Monitor usage** - Review CloudTrail logs for unexpected access

## Removing Permissions

To remove the policy:

```bash
# For IAM user
aws iam detach-user-policy \
  --user-name amplify_admin \
  --policy-arn <POLICY_ARN> \
  --no-cli-pager

# For IAM role
aws iam detach-role-policy \
  --role-name MyTestRole \
  --policy-arn <POLICY_ARN> \
  --no-cli-pager
```

## Next Steps

After setting up permissions:
1. Run `npm test` to verify all tests pass
2. Review test output to ensure no permission errors
3. Check CloudWatch Logs if tests fail unexpectedly

## Phase 4.4 Execution Integration Tests

Phase 4.4 adds integration tests in `src/tests/integration/execution/`:

- **execution-status-api.test.ts** — 11 tests; invokes the Execution Status API handler directly with real DynamoDB. Requires `.env` to contain `EXECUTION_OUTCOMES_TABLE_NAME`, `EXECUTION_ATTEMPTS_TABLE_NAME`, and `ACTION_INTENT_TABLE_NAME`. These are written to `.env` by `./deploy`.
- **end-to-end-execution.test.ts** — Placeholder suite (skipped when env missing).

**Run execution-status-api integration tests only:**
```bash
npm test -- --testPathPattern="execution/execution-status-api"
```

If the suite is skipped, ensure you have run `./deploy` at least once so `.env` includes the execution table names. To skip these tests (e.g. in CI without AWS), set `SKIP_EXECUTION_STATUS_API_INTEGRATION=1`. See **docs/implementation/phase_4/testing/PHASE_4_4_TEST_PLAN.md** for full details.

## Integration test suites (current)

As of the latest run, `npm run test:integration` runs **13 suites** and **60 tests**, including:

- **Phase 0:** phase0.test.ts (tenant, evidence→state→snapshot, event→ledger, schema registry)
- **Phase 2:** phase2.test.ts (graph materialization, synthesis, failure semantics, determinism)
- **Methodology:** methodology.test.ts (workflow, supersession, autonomy tier cap)
- **Phase 3:** decision-api.test.ts (HTTP contract tests for Decision API; POST /decisions/evaluate, GET status, GET account decisions; x-api-key auth)
- **Phase 4 execution:** execution-flow, idempotency, kill-switches, connector-adapters, tool-invocation, execution-status-api, end-to-end-execution (placeholder)
- **Phase 5.2:** decision-scheduling.test.ts (DecisionRunState, IdempotencyStore; env-gated)
- **Phase 5.3:** perception-scheduler.test.ts (PullBudget, PullIdempotency; env-gated)

Phase 3 Decision API suite requires `DECISION_API_URL` and `DECISION_API_KEY` (from `.env` after `./deploy`). Set `SKIP_DECISION_API_INTEGRATION=1` to skip. Phase 5.2/5.3 suites run when their table names are in `.env` (deploy writes them).
