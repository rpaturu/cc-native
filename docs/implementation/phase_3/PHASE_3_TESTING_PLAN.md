# Phase 3 Testing Plan

**Status:** 🟡 **IN PROGRESS**  
**Created:** 2026-01-25  
**Last Updated:** 2026-01-25

---

## Overview

This document outlines the testing strategy for Phase 3 - Autonomous Decision + Action Proposal (Human-in-the-Loop) implementation.

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

### 2.3 Verify Private DNS

```bash
# SSH into a test instance in the VPC (if available)
# Or check Lambda environment variables

# From within VPC, Bedrock should resolve to VPC endpoint IP
# Not to public Bedrock endpoint
```

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

**Via API:**
```bash
# Use step 1.2 to trigger evaluation
```

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
     --since 5m \
     --region us-west-2 \
     --no-cli-pager
   ```

2. **Decision Evaluation Requested Event:**
   ```bash
   # Check EventBridge for DECISION_EVALUATION_REQUESTED event
   ```

3. **Decision Evaluation Handler Executed:**
   ```bash
   aws logs tail /aws/lambda/cc-native-decision-evaluation-handler \
     --since 5m \
     --region us-west-2 \
     --no-cli-pager
   ```

4. **Decision Proposal Created:**
   ```bash
   # Check cc-native-decision-proposal table
   aws dynamodb query \
     --table-name cc-native-decision-proposal \
     --key-condition-expression "pk = :pk" \
     --expression-attribute-values '{":pk":{"S":"TENANT#test-tenant-1#ACCOUNT#test-account-1"}}' \
     --region us-west-2 \
     --no-cli-pager
   ```

5. **Budget Consumed:**
   ```bash
   # Check cc-native-decision-budget table
   aws dynamodb get-item \
     --table-name cc-native-decision-budget \
     --key '{"pk":{"S":"TENANT#test-tenant-1#ACCOUNT#test-account-1"},"sk":{"S":"BUDGET"}}' \
     --region us-west-2 \
     --no-cli-pager
   ```

6. **Ledger Events Created:**
   ```bash
   # Check cc-native-ledger table for DECISION_PROPOSED event
   ```

### 3.4 Verify Policy Gate

**Test different action types:**
- High-risk action (should require approval)
- Low-risk action (may auto-allow if confidence high)
- Unknown action type (should be blocked)

**Check policy evaluation results in logs**

---

## 4. Verify Budget Reset Scheduler

### 4.1 Check EventBridge Rule

```bash
# Verify scheduled rule exists
aws events list-rules \
  --name-prefix BudgetReset \
  --region us-west-2 \
  --no-cli-pager
```

**Expected:**
- Rule name: `CCNativeStack-BudgetResetScheduleRule-...`
- Schedule: `cron(0 0 * * ? *)` (midnight UTC daily)
- Target: `cc-native-budget-reset-handler` Lambda

### 4.2 Manually Trigger Budget Reset

**For testing, manually invoke the handler:**
```bash
aws lambda invoke \
  --function-name cc-native-budget-reset-handler \
  --region us-west-2 \
  --payload '{}' \
  response.json \
  --no-cli-pager

cat response.json
```

**Expected:**
- Status: 200
- All account budgets reset to default daily limit

### 4.3 Verify Budget Reset

**Before reset:**
```bash
# Check budget for test account
aws dynamodb get-item \
  --table-name cc-native-decision-budget \
  --key '{"pk":{"S":"TENANT#test-tenant-1#ACCOUNT#test-account-1"},"sk":{"S":"BUDGET"}}' \
  --region us-west-2 \
  --no-cli-pager
```

**After reset:**
- `daily_remaining` should be reset to `daily_limit`
- `last_reset_at` should be updated

### 4.4 Check CloudWatch Logs

```bash
aws logs tail /aws/lambda/cc-native-budget-reset-handler \
  --since 1h \
  --region us-west-2 \
  --no-cli-pager
```

**Look for:**
- Successful budget resets
- Number of accounts processed
- Any errors

---

## 5. Integration Test Script

Create a comprehensive test script:

```bash
#!/bin/bash
# scripts/test-phase3-endpoints.sh

set -e

API_URL="${DECISION_API_URL:-https://m50nppoghk.execute-api.us-west-2.amazonaws.com/prod}"
API_KEY="${DECISION_API_KEY}"
TENANT_ID="test-tenant-1"
ACCOUNT_ID="test-account-1"

echo "🧪 Testing Phase 3 Decision API Endpoints"
echo "=========================================="

# Test 1: Evaluate Decision
echo "1. Testing POST /decisions/evaluate..."
RESPONSE=$(curl -s -X POST \
  "${API_URL}/decisions/evaluate" \
  -H "Content-Type: application/json" \
  -H "x-api-key: ${API_KEY}" \
  -H "x-tenant-id: ${TENANT_ID}" \
  -d "{\"account_id\":\"${ACCOUNT_ID}\",\"trigger_type\":\"SELLER_REQUEST\"}")

DECISION_ID=$(echo $RESPONSE | jq -r '.decision_id')
echo "✅ Decision created: ${DECISION_ID}"

# Test 2: Get Account Decisions
echo "2. Testing GET /accounts/${ACCOUNT_ID}/decisions..."
curl -s -X GET \
  "${API_URL}/accounts/${ACCOUNT_ID}/decisions" \
  -H "x-api-key: ${API_KEY}" \
  -H "x-tenant-id: ${TENANT_ID}" | jq '.'
echo "✅ Account decisions retrieved"

# Test 3: Approve Action (if decision has actions)
echo "3. Testing POST /actions/{id}/approve..."
# Get action_ref from decision proposal first
# Then approve...

echo "✅ All tests completed"
```

---

## 6. Troubleshooting

### Common Issues

**1. API Gateway 403 Forbidden:**
- Check API key is valid
- Verify API key is associated with usage plan
- Check throttling limits

**2. Bedrock Connection Errors:**
- Verify VPC endpoint is `available`
- Check security group egress rules
- Verify IAM permissions
- Check Lambda is in correct VPC subnets

**3. Decision Evaluation Fails:**
- Check CloudWatch Logs for errors
- Verify test data exists (account, signals, posture state)
- Check budget hasn't been exhausted
- Verify EventBridge rules are configured

**4. Budget Reset Not Working:**
- Check EventBridge rule schedule
- Verify Lambda has permissions to read/write budget table
- Check CloudWatch Logs for errors

---

## 7. Success Criteria

✅ **All tests pass when:**
- [ ] All API endpoints return expected responses
- [ ] Bedrock calls succeed via VPC endpoint (no internet required)
- [ ] End-to-end decision flow completes successfully
- [ ] Budget reset runs daily at midnight UTC
- [ ] All ledger events are created correctly
- [ ] Decision proposals are stored and retrievable
- [ ] Action intents are created on approval
- [ ] Policy gate correctly evaluates actions

---

## Next Steps After Testing

1. **Performance Testing:** Load test API endpoints
2. **Error Handling:** Test error scenarios and edge cases
3. **Security Testing:** Verify Zero Trust compliance
4. **UI Integration:** Connect frontend to API endpoints
5. **Monitoring:** Set up CloudWatch alarms and dashboards

---

**Last Updated:** 2026-01-25
