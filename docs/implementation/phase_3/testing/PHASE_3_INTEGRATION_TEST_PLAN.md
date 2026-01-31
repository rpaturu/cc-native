# Phase 3 Integration Test Plan

**Status:** 🟢 **COMPLETE**  
**Created:** 2026-01-25  
**Last Updated:** 2026-01-28  
**Parent:** [PHASE_3_TEST_PLAN.md](PHASE_3_TEST_PLAN.md)

---

## Overview

This document outlines integration and manual testing for Phase 3 - Autonomous Decision + Action Proposal (Human-in-the-Loop).

**Testing Objectives:**
1. ✅ Verify Decision API endpoints are functional
2. ✅ Verify Bedrock VPC endpoint connectivity
3. ✅ Test decision evaluation flow end-to-end
4. ✅ Verify budget reset scheduler is working

---

## Prerequisites

- AWS CLI configured with appropriate credentials
- API Gateway endpoint URL (from deployment outputs)
- API Key ID (from deployment outputs)
- Test tenant and account data in DynamoDB
- Access to CloudWatch Logs for debugging

**Required Information from Deployment:**
```bash
# Get from stack outputs
DecisionApiUrl=https://m50nppoghk.execute-api.us-west-2.amazonaws.com/prod/
DecisionApiKeyId=afzdktebhk
```

---

## 1. Test Decision API Endpoints

### 1.1 Get API Key Value

First, retrieve the actual API key value (not just the ID):

```bash
# Get API key value
aws apigateway get-api-key \
  --api-key afzdktebhk \
  --include-value \
  --region us-west-2 \
  --query 'value' \
  --output text \
  --no-cli-pager
```

Save this value as `DECISION_API_KEY` for use in tests.

### 1.2 Test POST /decisions/evaluate

**Purpose:** Trigger a decision evaluation for an account

**Request:**
```bash
curl -X POST \
  "https://m50nppoghk.execute-api.us-west-2.amazonaws.com/prod/decisions/evaluate" \
  -H "Content-Type: application/json" \
  -H "x-api-key: ${DECISION_API_KEY}" \
  -H "x-tenant-id: test-tenant-1" \
  -d '{
    "account_id": "test-account-1",
    "trigger_type": "SELLER_REQUEST"
  }'
```

**Expected Response:**
- Status: 200
- Body: `{ "decision_id": "...", "status": "proposed" }`

**Validation:**
- Check CloudWatch Logs for decision evaluation handler
- Verify decision proposal stored in `cc-native-decision-proposal` table
- Verify ledger event `DECISION_PROPOSED` created

### 1.3 Test GET /accounts/{id}/decisions

**Purpose:** Retrieve decision history for an account

**Request:**
```bash
curl -X GET \
  "https://m50nppoghk.execute-api.us-west-2.amazonaws.com/prod/accounts/test-account-1/decisions" \
  -H "x-api-key: ${DECISION_API_KEY}" \
  -H "x-tenant-id: test-tenant-1"
```

**Expected Response:**
- Status: 200
- Body: `{ "decisions": [...] }`

**Validation:**
- Verify decisions are returned in chronological order
- Check that decision proposals include all required fields

### 1.4 Test POST /actions/{id}/approve

**Purpose:** Approve an action proposal

**Prerequisites:**
- A decision proposal must exist (from step 1.2)
- Get `action_ref` from the decision proposal

**Request:**
```bash
curl -X POST \
  "https://m50nppoghk.execute-api.us-west-2.amazonaws.com/prod/actions/{action_ref}/approve" \
  -H "Content-Type: application/json" \
  -H "x-api-key: ${DECISION_API_KEY}" \
  -H "x-tenant-id: test-tenant-1" \
  -d '{
    "decision_id": "dec_...",
    "edits": {}
  }'
```

**Expected Response:**
- Status: 200
- Body: `{ "intent": { "action_intent_id": "...", ... } }`

**Validation:**
- Verify action intent created in `cc-native-action-intent` table
- Verify ledger event `ACTION_APPROVED` created
- Check that `original_decision_id` and `original_proposal_id` are set correctly

### 1.5 Test POST /actions/{id}/reject

**Purpose:** Reject an action proposal

**Request:**
```bash
curl -X POST \
  "https://m50nppoghk.execute-api.us-west-2.amazonaws.com/prod/actions/{action_ref}/reject" \
  -H "Content-Type: application/json" \
  -H "x-api-key: ${DECISION_API_KEY}" \
  -H "x-tenant-id: test-tenant-1" \
  -d '{
    "decision_id": "dec_...",
    "reason": "Not appropriate at this time"
  }'
```

**Expected Response:**
- Status: 200
- Body: `{ "status": "rejected" }`

**Validation:**
- Verify ledger event `ACTION_REJECTED` created
- Check that rejection reason is stored in ledger

---

## 2. Verify Bedrock VPC Endpoint Connectivity

### 2.1 Check VPC Endpoint Status

```bash
# Get VPC ID from stack outputs
VPC_ID=vpc-0e8f782bc4c4cf79d

# List VPC endpoints
aws ec2 describe-vpc-endpoints \
  --filters "Name=vpc-id,Values=${VPC_ID}" \
  --filters "Name=service-name,Values=com.amazonaws.us-west-2.bedrock-runtime" \
  --region us-west-2 \
  --query 'VpcEndpoints[0].{State:State,ServiceName:ServiceName}' \
  --output json \
  --no-cli-pager
```

**Expected:**
- State: `available`
- ServiceName: `com.amazonaws.us-west-2.bedrock-runtime`

### 2.2 Test Bedrock Invoke from Lambda

**Method:** Trigger decision evaluation and check CloudWatch Logs

```bash
# Trigger decision evaluation (from step 1.2)
# Then check CloudWatch Logs for decision evaluation handler

aws logs tail /aws/lambda/cc-native-decision-evaluation-handler \
  --follow \
  --region us-west-2 \
  --no-cli-pager
```

**Look for:**
- No connection errors
- Successful Bedrock API calls
- Response from Bedrock model

**If errors occur:**
- Check security group egress rules (should allow HTTPS 443 to VPC CIDR)
- Verify IAM permissions for Bedrock
- Check VPC endpoint DNS resolution

---

## 3. Test Decision Evaluation Flow End-to-End

### 3.1 Setup Test Data

**Create test account with posture state:**
```bash
# Use AWS CLI or DynamoDB console to create:
# - Account in cc-native-accounts table
# - Account posture state in cc-native-account-posture-state table
# - Signals in cc-native-signals table
```

**Example test account:**
```json
{
  "pk": "TENANT#test-tenant-1#ACCOUNT#test-account-1",
  "sk": "ACCOUNT",
  "account_id": "test-account-1",
  "tenant_id": "test-tenant-1",
  "lifecycle_state": "CUSTOMER",
  "name": "Test Account"
}
```

### 3.2 Trigger Decision Evaluation

**Via API:** Use step 1.2 to trigger evaluation.

**Via EventBridge (simulate lifecycle change):**
```bash
aws events put-events \
  --entries '[{
    "Source": "cc-native.perception",
    "DetailType": "LIFECYCLE_STATE_CHANGED",
    "Detail": "{\"account_id\":\"test-account-1\",\"tenant_id\":\"test-tenant-1\",\"old_state\":\"SUSPECT\",\"new_state\":\"CUSTOMER\"}"
  }]' \
  --event-bus-name cc-native-events \
  --region us-west-2 \
  --no-cli-pager
```

### 3.3 Verify Complete Flow

**Check each step:**

1. **Trigger Handler Executed:**
   ```bash
   aws logs tail /aws/lambda/cc-native-decision-trigger-handler \
     --since 5m --region us-west-2 --no-cli-pager
   ```

2. **Decision Evaluation Handler Executed:**
   ```bash
   aws logs tail /aws/lambda/cc-native-decision-evaluation-handler \
     --since 5m --region us-west-2 --no-cli-pager
   ```

3. **Decision Proposal Created:** Query `cc-native-decision-proposal` table.

4. **Budget Consumed:** Check `cc-native-decision-budget` table.

5. **Ledger Events Created:** Check `cc-native-ledger` for DECISION_PROPOSED.

### 3.4 Verify Policy Gate

**Test different action types:**
- High-risk action (should require approval)
- Low-risk action (may auto-allow if confidence high)
- Unknown action type (should be blocked)

---

## 4. Verify Budget Reset Scheduler

### 4.1 Check EventBridge Rule

```bash
aws events list-rules --name-prefix BudgetReset --region us-west-2 --no-cli-pager
```

**Expected:** Rule targeting `cc-native-budget-reset-handler`, schedule `cron(0 0 * * ? *)` (midnight UTC daily).

### 4.2 Manually Trigger Budget Reset

```bash
aws lambda invoke \
  --function-name cc-native-budget-reset-handler \
  --region us-west-2 \
  --payload '{}' \
  response.json \
  --no-cli-pager

cat response.json
```

**Expected:** Status 200; all account budgets reset to default daily limit.

### 4.3 Verify Budget Reset

Before/after: Check `cc-native-decision-budget`; `daily_remaining` should reset to `daily_limit`, `last_reset_at` updated.

---

## 5. Jest HTTP Integration Suite (Decision API)

**File:** `src/tests/integration/decision/decision-api.test.ts`

**Purpose:** Contract tests against the real Decision API (API Gateway) over HTTP with `x-api-key` auth. Runs as part of `npm run test:integration` when env is set.

**Required env (from .env after `./deploy`):**
- `DECISION_API_URL` — API Gateway base URL (e.g. `https://xxx.execute-api.region.amazonaws.com/prod`)
- `DECISION_API_KEY` — API key value (deploy script retrieves and writes to .env)

**Skip:** Set `SKIP_DECISION_API_INTEGRATION=1` to skip this suite (e.g. CI without deployed API). If env is missing and skip is not set, the suite is skipped via `describe.skip`.

**Tests:**
- **POST /decisions/evaluate** — Returns 200 (not triggered), 202 (initiated), or 429 (budget exceeded); body has `message` and optional `reason` / `evaluation_id`.
- **POST /decisions/evaluate** (invalid body) — Returns 4xx/5xx with error shape.
- **GET /decisions/{evaluation_id}/status** — Returns 400 when x-tenant-id missing; 200 or 404 for known id.
- **GET /accounts/{account_id}/decisions** — Returns 200 with `{ decisions }` array; 400 when x-tenant-id missing.
- **Contract: API key required** — Returns 403 when x-api-key missing.

**Run:**
```bash
npm run test:integration
# Or only Decision API integration:
npm test -- --testPathPattern="decision/decision-api"
```

---

## 6. Integration Test Script (shell)

See `scripts/phase_3/test-phase3-api.sh` for a comprehensive test script (DECISION_API_URL, DECISION_API_KEY, tenant/account IDs).

---

## 7. Troubleshooting

**API Gateway 403:** Check API key, usage plan, throttling.

**Bedrock errors:** Verify VPC endpoint state, security groups, IAM, Lambda VPC.

**Decision evaluation fails:** CloudWatch Logs, test data (account/signals/posture), budget, EventBridge rules.

**Budget reset not working:** EventBridge schedule, Lambda permissions, CloudWatch Logs.

---

## 8. Success Criteria

✅ All API endpoints return expected responses  
✅ Bedrock calls succeed via VPC endpoint  
✅ End-to-end decision flow completes  
✅ Budget reset runs daily at midnight UTC  
✅ Ledger events and decision proposals correct  
✅ Policy gate evaluates actions correctly  

---

**Last Updated:** 2026-01-28
