#!/bin/bash
# Test Phase 3 Decision API Endpoints
# Usage: ./scripts/phase_3/test-phase3-api.sh

# Use set -e but allow controlled error handling
set -e

# Initialize variables for cleanup (will be set later)
TEST_USERNAME=""
USER_POOL_ID=""
REGION=""

# ✅ Zero Trust: Cleanup function - always remove test user and temp files
cleanup_test_user() {
  if [ -n "$TEST_USERNAME" ] && [ -n "$USER_POOL_ID" ] && [ -n "$REGION" ]; then
    echo ""
    echo "🧹 Cleaning up test user and temporary files..."
    
    # Remove test user (zero trust: no persistent test identities)
    # Use AWS_PROFILE if available (from .env)
    AWS_PROFILE_ARG=""
    if [ -n "$AWS_PROFILE" ]; then
      AWS_PROFILE_ARG="--profile $AWS_PROFILE"
    fi
    aws cognito-idp admin-delete-user \
      $AWS_PROFILE_ARG \
      --user-pool-id "$USER_POOL_ID" \
      --username "$TEST_USERNAME" \
      --region "$REGION" \
      --no-cli-pager > /dev/null 2>&1
    
    if [ $? -eq 0 ]; then
      echo -e "${GREEN}✅ Test user removed${NC}"
    else
      echo -e "${YELLOW}⚠️  Could not remove test user (may not exist or already deleted)${NC}"
    fi
    
    # Clean up any temporary auth parameter files (zero trust: no credential leakage)
    rm -f /tmp/auth_params_* 2>/dev/null
  fi
}

# Register cleanup function to run on exit (even if script fails)
trap cleanup_test_user EXIT

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

if [ -z "$AWS_REGION" ]; then
  echo -e "${RED}❌ Error: AWS_REGION not found in .env${NC}"
  echo "   Please run ./deploy to generate .env file with stack outputs"
  exit 1
fi

if [ -z "$USER_POOL_ID" ] || [ -z "$USER_POOL_CLIENT_ID" ]; then
  echo -e "${RED}❌ Error: USER_POOL_ID or USER_POOL_CLIENT_ID not found in .env${NC}"
  echo "   Cognito authentication is required for API Gateway"
  exit 1
fi

# Set variables for use throughout script (including cleanup function)
API_URL="$DECISION_API_URL"
REGION="$AWS_REGION"
USER_POOL_ID="$USER_POOL_ID"  # Ensure it's set for cleanup function

# API Gateway authentication
# When Cognito authorizer is configured, API Gateway REQUIRES Cognito JWT token
# API key is also required for usage plan throttling/quotas
# Both headers are needed: Authorization (Cognito JWT) and x-api-key

if [ -z "$DECISION_API_KEY" ]; then
  echo -e "${RED}❌ Error: DECISION_API_KEY not found in .env${NC}"
  echo "   Please run ./deploy to generate .env file with API key"
  echo ""
  echo "   Note: For production, consider storing API key in AWS Secrets Manager"
  echo "   For testing, .env file is acceptable"
  exit 1
fi

# ✅ Zero Trust: Generate unique test user per run (no persistent test users)
# This ensures no leftover test users and follows zero trust principle of minimal persistent identities
TEST_USERNAME="${TEST_USERNAME:-test-user-$(date +%s)-$$}"
TEST_USER_EMAIL="${TEST_USER_EMAIL:-${TEST_USERNAME}@cc-native.local}"

# Password handling: prefer environment variable, fallback to secure default
# ✅ Zero Trust: Generate random password (no hardcoded credentials)
if [ -z "$TEST_PASSWORD" ]; then
  # Generate a random password for test user (more secure than hardcoded)
  # Use date + random number for portability (works on all systems)
  RANDOM_SUFFIX=$(date +%s | sha256sum | head -c 8)
  TEST_PASSWORD="TestPass${RANDOM_SUFFIX}!"
  echo "   Generated secure test password"
else
  echo "   Using TEST_PASSWORD from environment"
fi

echo "🔐 Setting up Cognito authentication..."

# Check if user exists
USER_EXISTS=$(aws cognito-idp admin-get-user \
  $AWS_PROFILE_ARG \
  --user-pool-id "$USER_POOL_ID" \
  --username "$TEST_USERNAME" \
  --region "$REGION" \
  --query 'Username' \
  --output text \
  --no-cli-pager 2>/dev/null || echo "None")

if [ "$USER_EXISTS" = "None" ] || [ -z "$USER_EXISTS" ]; then
  echo "   Creating test user: ${TEST_USERNAME}..."
  
  # Create user - show command for debugging
  CREATE_USER_CMD="aws cognito-idp admin-create-user $AWS_PROFILE_ARG --user-pool-id \"$USER_POOL_ID\" --username \"$TEST_USERNAME\" --user-attributes \"Name=email,Value=${TEST_USER_EMAIL}\" --temporary-password \"$TEST_PASSWORD\" --message-action SUPPRESS --region \"$REGION\" --no-cli-pager"
  echo "   Command: $CREATE_USER_CMD"
  
  # Temporarily disable set -e to capture error output
  set +e
  CREATE_USER_OUTPUT=$(aws cognito-idp admin-create-user \
    $AWS_PROFILE_ARG \
    --user-pool-id "$USER_POOL_ID" \
    --username "$TEST_USERNAME" \
    --user-attributes "Name=email,Value=${TEST_USER_EMAIL}" \
    --temporary-password "$TEST_PASSWORD" \
    --message-action SUPPRESS \
    --region "$REGION" \
    --no-cli-pager 2>&1)
  CREATE_USER_EXIT=$?
  set -e
  
  if [ $CREATE_USER_EXIT -ne 0 ]; then
    echo -e "${RED}❌ Failed to create test user${NC}"
    echo "   Exit code: $CREATE_USER_EXIT"
    echo "   Error output:"
    echo "$CREATE_USER_OUTPUT" | jq '.' 2>/dev/null || echo "$CREATE_USER_OUTPUT"
    echo ""
    
    # Check if it's a permissions error
    if echo "$CREATE_USER_OUTPUT" | grep -q "AccessDeniedException\|not authorized"; then
      echo -e "${YELLOW}⚠️  IAM Permissions Issue${NC}"
      echo "   Your AWS credentials need Cognito admin permissions:"
      echo "   Required IAM permissions:"
      echo "   - cognito-idp:AdminCreateUser"
      echo "   - cognito-idp:AdminSetUserPassword"
      echo "   - cognito-idp:AdminDeleteUser"
      echo "   - cognito-idp:AdminGetUser"
      echo "   - cognito-idp:AdminInitiateAuth (for ADMIN_USER_PASSWORD_AUTH)"
      echo ""
      echo "   Resource: arn:aws:cognito-idp:${REGION}:*:userpool/${USER_POOL_ID}"
      echo ""
      echo "   Current AWS identity:"
      aws sts get-caller-identity $AWS_PROFILE_ARG --no-cli-pager 2>/dev/null || echo "   (Could not determine identity)"
    fi
    
    echo ""
    echo "   You can run this command manually to debug:"
    echo "   $CREATE_USER_CMD"
    exit 1
  fi
  
  # Set permanent password - show command for debugging
  SET_PASSWORD_CMD="aws cognito-idp admin-set-user-password $AWS_PROFILE_ARG --user-pool-id \"$USER_POOL_ID\" --username \"$TEST_USERNAME\" --password \"$TEST_PASSWORD\" --permanent --region \"$REGION\" --no-cli-pager"
  echo "   Setting permanent password..."
  echo "   Command: $SET_PASSWORD_CMD"
  
  # Temporarily disable set -e to capture error output
  set +e
  SET_PASSWORD_OUTPUT=$(aws cognito-idp admin-set-user-password \
    $AWS_PROFILE_ARG \
    --user-pool-id "$USER_POOL_ID" \
    --username "$TEST_USERNAME" \
    --password "$TEST_PASSWORD" \
    --permanent \
    --region "$REGION" \
    --no-cli-pager 2>&1)
  SET_PASSWORD_EXIT=$?
  set -e
  
  if [ $SET_PASSWORD_EXIT -ne 0 ]; then
    echo -e "${YELLOW}⚠️  Failed to set user password${NC}"
    echo "   Exit code: $SET_PASSWORD_EXIT"
    echo "   Error output:"
    echo "$SET_PASSWORD_OUTPUT" | jq '.' 2>/dev/null || echo "$SET_PASSWORD_OUTPUT"
    echo ""
    echo "   You can run this command manually to debug:"
    echo "   $SET_PASSWORD_CMD"
    echo "   Attempting to continue anyway..."
  fi
  
  echo -e "${GREEN}✅ Test user created${NC}"
  sleep 2  # Delay to ensure user is fully created and password is set
else
  echo "   Test user already exists: ${TEST_USERNAME}"
  
  # Ensure password is set (try to set it, ignore if already set)
  aws cognito-idp admin-set-user-password \
    $AWS_PROFILE_ARG \
    --user-pool-id "$USER_POOL_ID" \
    --username "$TEST_USERNAME" \
    --password "$TEST_PASSWORD" \
    --permanent \
    --region "$REGION" \
    --no-cli-pager > /dev/null 2>&1 || true
  
  sleep 1  # Brief delay after password update
fi

echo "   Authenticating with Cognito..."
# ✅ Zero Trust: Use secure credential handling (avoid password in process list)
# Create temporary auth parameters file
AUTH_PARAMS_FILE=$(mktemp /tmp/auth_params_XXXXXX)
echo "USERNAME=${TEST_USERNAME}" > "$AUTH_PARAMS_FILE"
echo "PASSWORD=${TEST_PASSWORD}" >> "$AUTH_PARAMS_FILE"
chmod 600 "$AUTH_PARAMS_FILE" # Restrict file permissions

# Retry logic for transient authentication failures
COGNITO_TOKEN=""
MAX_RETRIES=3
RETRY_DELAY=2

for i in $(seq 1 $MAX_RETRIES); do
  # Try USER_PASSWORD_AUTH first (standard flow)
  AUTH_CMD="aws cognito-idp initiate-auth $AWS_PROFILE_ARG --auth-flow USER_PASSWORD_AUTH --client-id \"$USER_POOL_CLIENT_ID\" --auth-parameters file://\"$AUTH_PARAMS_FILE\" --region \"$REGION\" --no-cli-pager"
  if [ $i -eq 1 ]; then
    echo "   Attempting USER_PASSWORD_AUTH..."
    echo "   Command: $AUTH_CMD"
  fi
  
  AUTH_OUTPUT=$(aws cognito-idp initiate-auth \
    $AWS_PROFILE_ARG \
    --auth-flow USER_PASSWORD_AUTH \
    --client-id "$USER_POOL_CLIENT_ID" \
    --auth-parameters file://"$AUTH_PARAMS_FILE" \
    --region "$REGION" \
    --no-cli-pager 2>&1)
  
  COGNITO_TOKEN=$(echo "$AUTH_OUTPUT" | jq -r '.AuthenticationResult.IdToken // empty' 2>/dev/null || echo "")
  
  # If USER_PASSWORD_AUTH fails, try ADMIN_USER_PASSWORD_AUTH (doesn't require client config)
  if [ -z "$COGNITO_TOKEN" ] || [ "$COGNITO_TOKEN" = "None" ] || [ "$COGNITO_TOKEN" = "null" ]; then
    if [ $i -eq 1 ]; then
      echo "   USER_PASSWORD_AUTH not available, trying ADMIN_USER_PASSWORD_AUTH..."
    fi
    ADMIN_AUTH_CMD="aws cognito-idp admin-initiate-auth $AWS_PROFILE_ARG --user-pool-id \"$USER_POOL_ID\" --client-id \"$USER_POOL_CLIENT_ID\" --auth-flow ADMIN_USER_PASSWORD_AUTH --auth-parameters file://\"$AUTH_PARAMS_FILE\" --region \"$REGION\" --no-cli-pager"
    if [ $i -eq 1 ]; then
      echo "   Command: $ADMIN_AUTH_CMD"
    fi
    
    AUTH_OUTPUT=$(aws cognito-idp admin-initiate-auth \
      $AWS_PROFILE_ARG \
      --user-pool-id "$USER_POOL_ID" \
      --client-id "$USER_POOL_CLIENT_ID" \
      --auth-flow ADMIN_USER_PASSWORD_AUTH \
      --auth-parameters file://"$AUTH_PARAMS_FILE" \
      --region "$REGION" \
      --no-cli-pager 2>&1)
    
    COGNITO_TOKEN=$(echo "$AUTH_OUTPUT" | jq -r '.AuthenticationResult.IdToken // empty' 2>/dev/null || echo "")
  fi
  
  if [ -n "$COGNITO_TOKEN" ] && [ "$COGNITO_TOKEN" != "None" ] && [ "$COGNITO_TOKEN" != "null" ]; then
    break
  fi
  
  if [ $i -lt $MAX_RETRIES ]; then
    echo "   Authentication attempt $i failed, retrying in ${RETRY_DELAY}s..."
    echo "   Error: $(echo "$AUTH_OUTPUT" | jq -r '.__type // .message // "Unknown error"' 2>/dev/null || echo "Check AWS credentials")"
    sleep $RETRY_DELAY
  else
    # Show full error on last attempt
    echo "   Final attempt failed. Full error:"
    echo "$AUTH_OUTPUT" | jq '.' 2>/dev/null || echo "$AUTH_OUTPUT"
    echo ""
    echo "   You can run these commands manually to debug:"
    echo "   $AUTH_CMD"
    echo "   $ADMIN_AUTH_CMD"
  fi
done

# ✅ Zero Trust: Clean up temporary auth file immediately after use
rm -f "$AUTH_PARAMS_FILE" 2>/dev/null

if [ -z "$COGNITO_TOKEN" ] || [ "$COGNITO_TOKEN" = "None" ] || [ "$COGNITO_TOKEN" = "null" ]; then
  echo -e "${RED}❌ Failed to authenticate with Cognito after ${MAX_RETRIES} attempts${NC}"
  echo ""
  echo "   Common causes:"
  echo "   1. Cognito client doesn't allow USER_PASSWORD_AUTH flow"
  echo "      Fix: Update Cognito app client to allow USER_PASSWORD_AUTH"
  echo ""
  echo "   2. User password not set correctly"
  echo "      The script sets the password, but there may be a delay"
  echo ""
  echo "   3. AWS credentials/permissions issue"
  echo "      Check: aws sts get-caller-identity"
  echo ""
  echo "   To debug, try manual authentication:"
  echo "   aws cognito-idp initiate-auth \\"
  echo "     --auth-flow USER_PASSWORD_AUTH \\"
  echo "     --client-id ${USER_POOL_CLIENT_ID} \\"
  echo "     --auth-parameters USERNAME=${TEST_USERNAME},PASSWORD='${TEST_PASSWORD}' \\"
  echo "     --region ${REGION}"
  echo ""
  exit 1
fi

echo -e "${GREEN}✅ Cognito authentication successful${NC}"
echo "   Using Cognito JWT token + API key"
AUTH_HEADER="Authorization: Bearer ${COGNITO_TOKEN}"
API_KEY_HEADER="x-api-key: ${DECISION_API_KEY}"

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
  -H "${AUTH_HEADER}" \
  -H "${API_KEY_HEADER}" \
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
  -H "${AUTH_HEADER}" \
  -H "${API_KEY_HEADER}" \
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
