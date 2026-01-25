#!/bin/bash
# Test Phase 3 Decision API Endpoints
# Usage: ./scripts/phase_3/test-phase3-api.sh

set -e

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}🧪 Phase 3 Decision API Testing${NC}"
echo "=========================================="
echo ""

# Load environment variables from .env file
if [ -f .env ]; then
  source .env
else
  echo -e "${RED}❌ Error: .env file not found${NC}"
  echo "   Please run ./deploy first to generate .env file"
  exit 1
fi

# Get API URL and Key ID from .env (required, no fallbacks)
if [ -z "$DECISION_API_URL" ]; then
  echo -e "${RED}❌ Error: DECISION_API_URL not found in .env${NC}"
  echo "   Please run ./deploy to generate .env file with stack outputs"
  exit 1
fi

if [ -z "$DECISION_API_KEY_ID" ]; then
  echo -e "${RED}❌ Error: DECISION_API_KEY_ID not found in .env${NC}"
  echo "   Please run ./deploy to generate .env file with stack outputs"
  exit 1
fi

if [ -z "$AWS_REGION" ]; then
  echo -e "${RED}❌ Error: AWS_REGION not found in .env${NC}"
  echo "   Please run ./deploy to generate .env file with stack outputs"
  exit 1
fi

API_URL="$DECISION_API_URL"
API_KEY_ID="$DECISION_API_KEY_ID"
REGION="$AWS_REGION"

# Get API key value
echo "📋 Retrieving API key value..."
API_KEY=$(aws apigateway get-api-key \
  --api-key "${API_KEY_ID}" \
  --include-value \
  --region "${REGION}" \
  --query 'value' \
  --output text \
  --no-cli-pager 2>/dev/null)

if [ -z "$API_KEY" ]; then
  echo -e "${RED}❌ Failed to retrieve API key. Please check:${NC}"
  echo "   - AWS credentials are configured"
  echo "   - API key ID is correct: ${API_KEY_ID}"
  echo "   - Region is correct: ${REGION}"
  exit 1
fi

echo -e "${GREEN}✅ API key retrieved${NC}"
echo ""

# Test configuration
TENANT_ID="${TEST_TENANT_ID:-test-tenant-1}"
ACCOUNT_ID="${TEST_ACCOUNT_ID:-test-account-1}"

echo "📝 Test Configuration:"
echo "   API URL: ${API_URL}"
echo "   Tenant ID: ${TENANT_ID}"
echo "   Account ID: ${ACCOUNT_ID}"
echo ""

# Test 1: Health Check (GET /accounts/{id}/decisions)
echo -e "${YELLOW}Test 1: GET /accounts/${ACCOUNT_ID}/decisions${NC}"
RESPONSE=$(curl -s -w "\n%{http_code}" -X GET \
  "${API_URL}/accounts/${ACCOUNT_ID}/decisions" \
  -H "x-api-key: ${API_KEY}" \
  -H "x-tenant-id: ${TENANT_ID}")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "200" ]; then
  echo -e "${GREEN}✅ Success (HTTP ${HTTP_CODE})${NC}"
  echo "$BODY" | jq '.' 2>/dev/null || echo "$BODY"
else
  echo -e "${RED}❌ Failed (HTTP ${HTTP_CODE})${NC}"
  echo "$BODY"
fi
echo ""

# Test 2: Evaluate Decision
echo -e "${YELLOW}Test 2: POST /decisions/evaluate${NC}"
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
  "${API_URL}/decisions/evaluate" \
  -H "Content-Type: application/json" \
  -H "x-api-key: ${API_KEY}" \
  -H "x-tenant-id: ${TENANT_ID}" \
  -d "{
    \"account_id\": \"${ACCOUNT_ID}\",
    \"trigger_type\": \"SELLER_REQUEST\"
  }")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "200" ]; then
  echo -e "${GREEN}✅ Success (HTTP ${HTTP_CODE})${NC}"
  DECISION_ID=$(echo "$BODY" | jq -r '.decision_id // empty' 2>/dev/null)
  if [ -n "$DECISION_ID" ]; then
    echo "   Decision ID: ${DECISION_ID}"
    echo "$BODY" | jq '.' 2>/dev/null || echo "$BODY"
  else
    echo "$BODY"
  fi
else
  echo -e "${RED}❌ Failed (HTTP ${HTTP_CODE})${NC}"
  echo "$BODY"
fi
echo ""

# Test 3: Verify Bedrock VPC Endpoint
echo -e "${YELLOW}Test 3: Verify Bedrock VPC Endpoint${NC}"
VPC_ID=$(aws cloudformation describe-stacks \
  --stack-name CCNativeStack \
  --region "${REGION}" \
  --query 'Stacks[0].Outputs[?OutputKey==`VpcId`].OutputValue' \
  --output text \
  --no-cli-pager 2>/dev/null)

if [ -n "$VPC_ID" ]; then
  ENDPOINT_STATE=$(aws ec2 describe-vpc-endpoints \
    --filters "Name=vpc-id,Values=${VPC_ID}" \
              "Name=service-name,Values=com.amazonaws.${REGION}.bedrock-runtime" \
    --region "${REGION}" \
    --query 'VpcEndpoints[0].State' \
    --output text \
    --no-cli-pager 2>/dev/null)
  
  if [ "$ENDPOINT_STATE" = "available" ]; then
    echo -e "${GREEN}✅ Bedrock VPC Endpoint is available${NC}"
  else
    echo -e "${RED}❌ Bedrock VPC Endpoint state: ${ENDPOINT_STATE}${NC}"
  fi
else
  echo -e "${YELLOW}⚠️  Could not retrieve VPC ID from stack${NC}"
fi
echo ""

# Test 4: Check Budget Reset Scheduler
echo -e "${YELLOW}Test 4: Verify Budget Reset Scheduler${NC}"
RULE_NAME=$(aws events list-rules \
  --name-prefix BudgetReset \
  --region "${REGION}" \
  --query 'Rules[0].Name' \
  --output text \
  --no-cli-pager 2>/dev/null)

if [ -n "$RULE_NAME" ] && [ "$RULE_NAME" != "None" ]; then
  echo -e "${GREEN}✅ Budget Reset rule found: ${RULE_NAME}${NC}"
  SCHEDULE=$(aws events describe-rule \
    --name "${RULE_NAME}" \
    --region "${REGION}" \
    --query 'ScheduleExpression' \
    --output text \
    --no-cli-pager 2>/dev/null)
  echo "   Schedule: ${SCHEDULE}"
else
  echo -e "${RED}❌ Budget Reset rule not found${NC}"
fi
echo ""

echo -e "${GREEN}✅ Testing complete!${NC}"
echo ""
echo "📊 Next Steps:"
echo "   1. Check CloudWatch Logs for decision evaluation handler"
echo "   2. Verify decision proposal in DynamoDB table"
echo "   3. Test action approval/rejection endpoints"
echo "   4. Monitor budget reset at midnight UTC"
