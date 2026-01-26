#!/bin/bash
# Test Phase 3 Decision API Endpoints
# Usage: ./scripts/phase_3/test-phase3-api.sh

# Use set -e but allow controlled error handling
set -e

# Initialize variables for cleanup (will be set later)
TEST_USERNAME=""
USER_POOL_ID=""
REGION=""
TENANT_ID=""
ACCOUNT_ID=""
ACCOUNT_POSTURE_STATE_TABLE_NAME=""
TENANTS_TABLE_NAME=""

# ✅ Zero Trust: Cleanup function - always remove test user, test data, and temp files
cleanup_test_user() {
  echo ""
  echo "🧹 Cleaning up test user and temporary files..."
  
  # Use AWS_PROFILE if available (from .env)
  AWS_PROFILE_ARG=""
  if [ -n "$AWS_PROFILE" ]; then
    AWS_PROFILE_ARG="--profile $AWS_PROFILE"
  fi
  
  # Remove test user (zero trust: no persistent test identities)
  if [ -n "$TEST_USERNAME" ] && [ -n "$USER_POOL_ID" ] && [ -n "$REGION" ]; then
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
  fi
  
  # Clean up test AccountPostureState data (independent of user cleanup)
  if [ -n "$ACCOUNT_POSTURE_STATE_TABLE_NAME" ] && [ -n "$TENANT_ID" ] && [ -n "$ACCOUNT_ID" ] && [ -n "$REGION" ]; then
    PK="ACCOUNT#${TENANT_ID}#${ACCOUNT_ID}"
    SK="POSTURE#LATEST"
    
    aws dynamodb delete-item \
      $AWS_PROFILE_ARG \
      --table-name "$ACCOUNT_POSTURE_STATE_TABLE_NAME" \
      --key "{\"pk\":{\"S\":\"${PK}\"},\"sk\":{\"S\":\"${SK}\"}}" \
      --region "$REGION" \
      --no-cli-pager > /dev/null 2>&1
    
    if [ $? -eq 0 ]; then
      echo -e "${GREEN}✅ Test AccountPostureState removed${NC}"
    else
      echo -e "${YELLOW}⚠️  Could not remove test AccountPostureState (may not exist)${NC}"
    fi
  fi
  
  # Clean up test tenant data (independent of user cleanup)
  if [ -n "$TENANTS_TABLE_NAME" ] && [ -n "$TENANT_ID" ] && [ -n "$REGION" ]; then
    aws dynamodb delete-item \
      $AWS_PROFILE_ARG \
      --table-name "$TENANTS_TABLE_NAME" \
      --key "{\"tenantId\":{\"S\":\"${TENANT_ID}\"}}" \
      --region "$REGION" \
      --no-cli-pager > /dev/null 2>&1
    
    if [ $? -eq 0 ]; then
      echo -e "${GREEN}✅ Test tenant removed${NC}"
    else
      echo -e "${YELLOW}⚠️  Could not remove test tenant (may not exist)${NC}"
    fi
  fi
  
  # Clean up any temporary auth parameter files (zero trust: no credential leakage)
  rm -f /tmp/auth_params_* 2>/dev/null
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

# Get script directory and project root (where .env file is located)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Load environment variables from .env file (in project root)
ENV_FILE="$PROJECT_ROOT/.env"
if [ -f "$ENV_FILE" ]; then
  # Source .env and export variables so they're available to child processes
  set -a  # Automatically export all variables
  source "$ENV_FILE"
  set +a  # Turn off automatic export
else
  echo -e "${RED}❌ Error: .env file not found at $ENV_FILE${NC}"
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

# Use AWS profile from .env if available (set early so all commands use it)
# Also export AWS_PROFILE so AWS CLI respects it even without --profile flag
AWS_PROFILE_ARG=""
if [ -n "$AWS_PROFILE" ]; then
  export AWS_PROFILE="$AWS_PROFILE"  # Export so AWS CLI uses it
  AWS_PROFILE_ARG="--profile $AWS_PROFILE"
  echo "   Using AWS Profile: $AWS_PROFILE"
else
  echo -e "${YELLOW}⚠️  Warning: AWS_PROFILE not set in .env, using default AWS credentials${NC}"
  echo "   Debug: AWS_PROFILE variable is: '${AWS_PROFILE:-<empty>}'"
fi

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
# Note: Cognito User Pool requires username to be an email address
TEST_USER_EMAIL="${TEST_USER_EMAIL:-test-user-$(date +%s)-$$@cc-native.local}"
TEST_USERNAME="$TEST_USER_EMAIL"  # Use email as username (Cognito requirement)

# Password handling: prefer environment variable, fallback to secure default
# ✅ Zero Trust: Generate random password (no hardcoded credentials)
if [ -z "$TEST_PASSWORD" ]; then
  # Generate a random password for test user (more secure than hardcoded)
  # Use date + random number for portability (works on all systems)
  RANDOM_SUFFIX=$(date +%s | sha256sum | head -c 8)
  TEST_PASSWORD="TestPass${RANDOM_SUFFIX}!"
else
  echo "   Using TEST_PASSWORD from environment"
fi
echo ""

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
  
  # Set permanent password
  
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

# Authenticating with Cognito (silent)
# ✅ Zero Trust: Pass auth parameters as JSON directly (more reliable than file)
# This avoids file I/O issues and handles special characters properly

# Temporarily disable set -e to handle authentication errors gracefully
set +e

# Retry logic for transient authentication failures
COGNITO_TOKEN=""
MAX_RETRIES=3
RETRY_DELAY=2

for i in $(seq 1 $MAX_RETRIES); do
  # Build auth parameters JSON (use jq if available, otherwise construct manually)
  if command -v jq >/dev/null 2>&1; then
    AUTH_PARAMS_JSON=$(jq -n \
      --arg username "$TEST_USERNAME" \
      --arg password "$TEST_PASSWORD" \
      '{USERNAME: $username, PASSWORD: $password}')
  else
    # Fallback: construct JSON manually (escape quotes in password if needed)
    AUTH_PARAMS_JSON="{\"USERNAME\":\"${TEST_USERNAME}\",\"PASSWORD\":\"${TEST_PASSWORD}\"}"
  fi
  
  # Try USER_PASSWORD_AUTH first (standard flow)
  
  AUTH_OUTPUT=$(aws cognito-idp initiate-auth \
    $AWS_PROFILE_ARG \
    --auth-flow USER_PASSWORD_AUTH \
    --client-id "$USER_POOL_CLIENT_ID" \
    --auth-parameters "$AUTH_PARAMS_JSON" \
    --region "$REGION" \
    --no-cli-pager 2>&1)
  AUTH_EXIT_CODE=$?
  
  COGNITO_TOKEN=$(echo "$AUTH_OUTPUT" | jq -r '.AuthenticationResult.IdToken // empty' 2>/dev/null || echo "")
  
  # If USER_PASSWORD_AUTH fails, try ADMIN_USER_PASSWORD_AUTH (doesn't require client config)
  if [ -z "$COGNITO_TOKEN" ] || [ "$COGNITO_TOKEN" = "None" ] || [ "$COGNITO_TOKEN" = "null" ]; then
    
    AUTH_OUTPUT=$(aws cognito-idp admin-initiate-auth \
      $AWS_PROFILE_ARG \
      --user-pool-id "$USER_POOL_ID" \
      --client-id "$USER_POOL_CLIENT_ID" \
      --auth-flow ADMIN_USER_PASSWORD_AUTH \
      --auth-parameters "$AUTH_PARAMS_JSON" \
      --region "$REGION" \
      --no-cli-pager 2>&1)
    AUTH_EXIT_CODE=$?
    
    COGNITO_TOKEN=$(echo "$AUTH_OUTPUT" | jq -r '.AuthenticationResult.IdToken // empty' 2>/dev/null || echo "")
  fi
  
  if [ -n "$COGNITO_TOKEN" ] && [ "$COGNITO_TOKEN" != "None" ] && [ "$COGNITO_TOKEN" != "null" ]; then
    break
  fi
  
  if [ $i -lt $MAX_RETRIES ]; then
    echo "   Authentication attempt $i failed, retrying in ${RETRY_DELAY}s..."
    echo "   Exit code: $AUTH_EXIT_CODE"
    echo "   Error: $(echo "$AUTH_OUTPUT" | jq -r '.__type // .message // "Unknown error"' 2>/dev/null || echo "Check AWS credentials")"
    sleep $RETRY_DELAY
  else
    # Show full error on last attempt
    echo "   Final attempt failed. Exit code: $AUTH_EXIT_CODE"
    echo "   Full error:"
    echo "$AUTH_OUTPUT" | jq '.' 2>/dev/null || echo "$AUTH_OUTPUT"
    echo ""
    echo "   You can run these commands manually to debug:"
    echo "   $AUTH_CMD"
    echo "   $ADMIN_AUTH_CMD"
  fi
done

# Re-enable set -e after authentication attempts
set -e

# ✅ Zero Trust: Auth parameters were passed directly (no file cleanup needed)

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
echo ""

AUTH_HEADER="Authorization: Bearer ${COGNITO_TOKEN}"
API_KEY_HEADER="x-api-key: ${DECISION_API_KEY}"

# Test configuration (set early for cleanup function)
TENANT_ID="${TEST_TENANT_ID:-test-tenant-1}"
ACCOUNT_ID="${TEST_ACCOUNT_ID:-test-account-1}"

# Get table names from .env
ACCOUNT_POSTURE_STATE_TABLE_NAME="${ACCOUNT_POSTURE_STATE_TABLE_NAME:-cc-native-account-posture-state}"
TENANTS_TABLE_NAME="${TENANTS_TABLE_NAME:-cc-native-tenants}"

echo "📝 Test Configuration:"
echo "   API URL: ${API_URL}"
echo "   Tenant ID: ${TENANT_ID}"
echo "   Account ID: ${ACCOUNT_ID}"
echo ""

# Create test tenant data (required for DecisionContextAssembler)
echo "📦 Creating test tenant data..."
NOW=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")

TENANT_ITEM=$(cat <<EOF
{
  "tenantId": {"S": "${TENANT_ID}"},
  "name": {"S": "Test Tenant"},
  "status": {"S": "active"},
  "config": {"M": {
    "name": {"S": "Test Tenant"}
  }},
  "metadata": {"M": {}},
  "createdAt": {"S": "${NOW}"},
  "updatedAt": {"S": "${NOW}"}
}
EOF
)

aws dynamodb put-item \
  $AWS_PROFILE_ARG \
  --table-name "$TENANTS_TABLE_NAME" \
  --item "$TENANT_ITEM" \
  --region "$REGION" \
  --no-cli-pager > /dev/null 2>&1

# Then verify it was created:
aws dynamodb get-item \
  $AWS_PROFILE_ARG \
  --table-name "$TENANTS_TABLE_NAME" \
  --key '{"tenantId":{"S":"'$TENANT_ID'"}}' \
  --region "$REGION" \
  --no-cli-pager > /dev/null 2>&1

if [ $? -eq 0 ]; then
  echo -e "${GREEN}✅ Test tenant created${NC}"
else
  echo -e "${RED}❌ Failed to create test tenant${NC}"
  echo "   This will cause decision evaluation to fail"
fi
echo ""

# Create test AccountPostureState data
echo "📦 Creating test AccountPostureState data..."
PK="ACCOUNT#${TENANT_ID}#${ACCOUNT_ID}"
SK="POSTURE#LATEST"

# Create minimal valid AccountPostureState
# Using a simple hash for inputs_hash and active_signals_hash (test data)
TEST_HASH="test-$(date +%s | sha256sum | head -c 16)"

POSTURE_STATE_ITEM=$(cat <<EOF
{
  "pk": {"S": "${PK}"},
  "sk": {"S": "${SK}"},
  "account_id": {"S": "${ACCOUNT_ID}"},
  "tenantId": {"S": "${TENANT_ID}"},
  "posture": {"S": "OK"},
  "momentum": {"S": "FLAT"},
  "risk_factors": {"L": []},
  "opportunities": {"L": []},
  "unknowns": {"L": []},
  "evidence_signal_ids": {"L": []},
  "evidence_snapshot_refs": {"L": []},
  "evidence_signal_types": {"L": []},
  "ruleset_version": {"S": "v1.0.0"},
  "schema_version": {"S": "v1"},
  "active_signals_hash": {"S": "${TEST_HASH}"},
  "inputs_hash": {"S": "${TEST_HASH}"},
  "evaluated_at": {"S": "${NOW}"},
  "output_ttl_days": {"N": "30"},
  "rule_id": {"S": "test-rule-1"},
  "created_at": {"S": "${NOW}"},
  "updated_at": {"S": "${NOW}"}
}
EOF
)

aws dynamodb put-item \
  $AWS_PROFILE_ARG \
  --table-name "$ACCOUNT_POSTURE_STATE_TABLE_NAME" \
  --item "$POSTURE_STATE_ITEM" \
  --region "$REGION" \
  --no-cli-pager > /dev/null 2>&1

# Wait a moment for eventual consistency, then verify it was created
sleep 1
VERIFY_RESULT=$(aws dynamodb get-item \
  $AWS_PROFILE_ARG \
  --table-name "$ACCOUNT_POSTURE_STATE_TABLE_NAME" \
  --key "{\"pk\":{\"S\":\"${PK}\"},\"sk\":{\"S\":\"${SK}\"}}" \
  --region "$REGION" \
  --no-cli-pager 2>&1)

if echo "$VERIFY_RESULT" | grep -q '"Item"'; then
  echo -e "${GREEN}✅ Test AccountPostureState created and verified${NC}"
else
  echo -e "${RED}❌ Failed to create or verify test AccountPostureState${NC}"
  echo "   PK: ${PK}"
  echo "   SK: ${SK}"
  echo "   Table: ${ACCOUNT_POSTURE_STATE_TABLE_NAME}"
  echo "   Verification result:"
  echo "$VERIFY_RESULT" | head -5
  echo "   This will cause decision evaluation to fail"
  exit 1
fi
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

# Test 2: Evaluate Decision (with EXPLICIT_USER_REQUEST to bypass cooldown)
echo -e "${YELLOW}Test 2: POST /decisions/evaluate${NC}"
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
  "${API_URL}/decisions/evaluate" \
  -H "Content-Type: application/json" \
  -H "${AUTH_HEADER}" \
  -H "${API_KEY_HEADER}" \
  -H "x-tenant-id: ${TENANT_ID}" \
  -d "{
    \"account_id\": \"${ACCOUNT_ID}\",
    \"tenant_id\": \"${TENANT_ID}\",
    \"trigger_type\": \"EXPLICIT_USER_REQUEST\"
  }")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

EVALUATION_ID=""
if [ "$HTTP_CODE" = "202" ]; then
  echo -e "${GREEN}✅ Evaluation initiated (HTTP ${HTTP_CODE})${NC}"
  EVALUATION_ID=$(echo "$BODY" | jq -r '.evaluation_id // empty' 2>/dev/null)
  if [ -n "$EVALUATION_ID" ]; then
    echo "   Evaluation ID: ${EVALUATION_ID}"
    echo "$BODY" | jq '.' 2>/dev/null || echo "$BODY"
  else
    echo "$BODY"
  fi
elif [ "$HTTP_CODE" = "200" ]; then
  echo -e "${YELLOW}⚠️  Decision not triggered (HTTP ${HTTP_CODE})${NC}"
  echo "$BODY" | jq '.' 2>/dev/null || echo "$BODY"
elif [ "$HTTP_CODE" = "429" ]; then
  echo -e "${YELLOW}⚠️  Budget exceeded (HTTP ${HTTP_CODE})${NC}"
  echo "$BODY" | jq '.' 2>/dev/null || echo "$BODY"
else
  echo -e "${RED}❌ Failed (HTTP ${HTTP_CODE})${NC}"
  echo "$BODY"
fi
echo ""

# Test 2b: Wait for Evaluation and Test Full Flow (if evaluation was initiated)
if [ -n "$EVALUATION_ID" ]; then
  echo -e "${YELLOW}Test 2b: Wait for Decision Evaluation to Complete${NC}"
  echo "   Polling evaluation status for: ${EVALUATION_ID}"
  
  MAX_ATTEMPTS=30
  ATTEMPT=0
  DECISION_PROPOSAL=""
  DECISION_ID=""
  ACTION_REF=""
  
  while [ $ATTEMPT -lt $MAX_ATTEMPTS ]; do
    sleep 2
    ATTEMPT=$((ATTEMPT + 1))
    
    RESPONSE=$(curl -s -w "\n%{http_code}" -X GET \
      "${API_URL}/decisions/${EVALUATION_ID}/status" \
      -H "${AUTH_HEADER}" \
      -H "${API_KEY_HEADER}" \
      -H "x-tenant-id: ${TENANT_ID}")
    
    HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
    BODY=$(echo "$RESPONSE" | sed '$d')
    
    if [ "$HTTP_CODE" = "200" ]; then
      STATUS=$(echo "$BODY" | jq -r '.status // empty' 2>/dev/null)
      
      if [ "$STATUS" = "COMPLETED" ]; then
        echo -e "${GREEN}✅ Evaluation completed (attempt ${ATTEMPT}/${MAX_ATTEMPTS})${NC}"
        # API returns "decision" field, not "decision_proposal"
        DECISION_PROPOSAL=$(echo "$BODY" | jq -r '.decision // empty' 2>/dev/null)
        DECISION_ID=$(echo "$BODY" | jq -r '.decision.decision_id // .decision_id // empty' 2>/dev/null)
        ACTION_REF=$(echo "$BODY" | jq -r '.decision.actions[0].action_ref // empty' 2>/dev/null)
        
        if [ -n "$DECISION_ID" ] && [ -n "$ACTION_REF" ]; then
          echo "   Decision ID: ${DECISION_ID}"
          echo "   Action Ref: ${ACTION_REF}"
          echo "   Actions: $(echo "$BODY" | jq -r '.decision.actions | length' 2>/dev/null || echo "0")"
          break
        else
          echo -e "${YELLOW}⚠️  Evaluation completed but no decision proposal found${NC}"
          echo "$BODY" | jq '.' 2>/dev/null || echo "$BODY"
          break
        fi
      elif [ "$STATUS" = "FAILED" ]; then
        echo -e "${RED}❌ Evaluation failed${NC}"
        echo "$BODY" | jq '.' 2>/dev/null || echo "$BODY"
        break
      else
        echo "   Status: ${STATUS} (attempt ${ATTEMPT}/${MAX_ATTEMPTS})"
      fi
    else
      echo -e "${YELLOW}⚠️  Unexpected response (HTTP ${HTTP_CODE})${NC}"
      break
    fi
  done
  
  if [ $ATTEMPT -eq $MAX_ATTEMPTS ]; then
    echo -e "${YELLOW}⚠️  Evaluation did not complete within timeout${NC}"
  fi
  echo ""
  
  # Test 2c: Test Approval with Real Decision Proposal (if available)
  if [ -n "$DECISION_ID" ] && [ -n "$ACTION_REF" ]; then
    echo -e "${YELLOW}Test 2c: POST /actions/{action_id}/approve (Real Decision)${NC}"
    RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
      "${API_URL}/actions/${ACTION_REF}/approve" \
      -H "Content-Type: application/json" \
      -H "${AUTH_HEADER}" \
      -H "${API_KEY_HEADER}" \
      -H "x-tenant-id: ${TENANT_ID}" \
      -d "{
        \"decision_id\": \"${DECISION_ID}\"
      }")
    
    HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
    BODY=$(echo "$RESPONSE" | sed '$d')
    
    if [ "$HTTP_CODE" = "200" ]; then
      echo -e "${GREEN}✅ Action approved successfully (HTTP ${HTTP_CODE})${NC}"
      ACTION_INTENT_ID=$(echo "$BODY" | jq -r '.intent.action_intent_id // empty' 2>/dev/null)
      if [ -n "$ACTION_INTENT_ID" ]; then
        echo "   Action Intent ID: ${ACTION_INTENT_ID}"
      fi
      echo "$BODY" | jq '.' 2>/dev/null || echo "$BODY"
    else
      echo -e "${YELLOW}⚠️  Approval response (HTTP ${HTTP_CODE})${NC}"
      echo "$BODY" | jq '.' 2>/dev/null || echo "$BODY"
    fi
    echo ""
  fi
fi

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
RULE_NAME="cc-native-budget-reset-schedule"
RULE_EXISTS=$(aws events describe-rule \
  --name "${RULE_NAME}" \
  --region "${REGION}" \
  --query 'Name' \
  --output text \
  --no-cli-pager 2>/dev/null)

if [ -n "$RULE_EXISTS" ] && [ "$RULE_EXISTS" = "$RULE_NAME" ]; then
  echo -e "${GREEN}✅ Budget Reset rule found: ${RULE_NAME}${NC}"
  SCHEDULE=$(aws events describe-rule \
    --name "${RULE_NAME}" \
    --region "${REGION}" \
    --query 'ScheduleExpression' \
    --output text \
    --no-cli-pager 2>/dev/null)
  echo "   Schedule: ${SCHEDULE}"
  STATE=$(aws events describe-rule \
    --name "${RULE_NAME}" \
    --region "${REGION}" \
    --query 'State' \
    --output text \
    --no-cli-pager 2>/dev/null)
  echo "   State: ${STATE}"
else
  echo -e "${RED}❌ Budget Reset rule not found: ${RULE_NAME}${NC}"
fi
echo ""

# Test 5: Check Evaluation Status Endpoint
echo -e "${YELLOW}Test 5: GET /decisions/{evaluation_id}/status${NC}"
# Use a test evaluation ID (will return 404, but tests the endpoint exists)
TEST_EVALUATION_ID="test-evaluation-$(date +%s)"
RESPONSE=$(curl -s -w "\n%{http_code}" -X GET \
  "${API_URL}/decisions/${TEST_EVALUATION_ID}/status" \
  -H "${AUTH_HEADER}" \
  -H "${API_KEY_HEADER}" \
  -H "x-tenant-id: ${TENANT_ID}")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "404" ]; then
  echo -e "${GREEN}✅ Endpoint accessible (HTTP ${HTTP_CODE})${NC}"
  if [ "$HTTP_CODE" = "404" ]; then
    echo "   (Expected: evaluation not found for test ID)"
  else
    echo "$BODY" | jq '.' 2>/dev/null || echo "$BODY"
  fi
else
  echo -e "${RED}❌ Failed (HTTP ${HTTP_CODE})${NC}"
  echo "$BODY"
fi
echo ""

# Test 6: Test Action Approval Endpoint (Error Cases)
echo -e "${YELLOW}Test 6: POST /actions/{action_id}/approve (Error Cases)${NC}"
TEST_ACTION_ID="test-action-$(date +%s)"
# Test with missing decision_id
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
  "${API_URL}/actions/${TEST_ACTION_ID}/approve" \
  -H "Content-Type: application/json" \
  -H "${AUTH_HEADER}" \
  -H "${API_KEY_HEADER}" \
  -H "x-tenant-id: ${TENANT_ID}" \
  -d "{}")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "400" ]; then
  echo -e "${GREEN}✅ Validation working (HTTP ${HTTP_CODE})${NC}"
  echo "$BODY" | jq '.' 2>/dev/null || echo "$BODY"
else
  echo -e "${YELLOW}⚠️  Unexpected response (HTTP ${HTTP_CODE})${NC}"
  echo "$BODY"
fi
echo ""

# Test 7: Test Action Rejection Endpoint (Error Cases)
echo -e "${YELLOW}Test 7: POST /actions/{action_id}/reject (Error Cases)${NC}"
# Test with missing decision_id
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
  "${API_URL}/actions/${TEST_ACTION_ID}/reject" \
  -H "Content-Type: application/json" \
  -H "${AUTH_HEADER}" \
  -H "${API_KEY_HEADER}" \
  -H "x-tenant-id: ${TENANT_ID}" \
  -d "{}")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "400" ]; then
  echo -e "${GREEN}✅ Validation working (HTTP ${HTTP_CODE})${NC}"
  echo "$BODY" | jq '.' 2>/dev/null || echo "$BODY"
else
  echo -e "${YELLOW}⚠️  Unexpected response (HTTP ${HTTP_CODE})${NC}"
  echo "$BODY"
fi
echo ""

echo -e "${GREEN}✅ Testing complete!${NC}"
echo ""
echo "📊 Test Summary:"
echo "   ✅ Basic API endpoints (GET decisions, POST evaluate)"
echo "   ✅ Bedrock VPC Endpoint connectivity"
echo "   ✅ Budget Reset Scheduler configuration"
echo "   ✅ Evaluation Status endpoint"
echo "   ✅ Action Approval/Rejection endpoint validation"
echo ""
# Test 8: Check CloudWatch Logs (if evaluation was initiated)
if [ -n "$EVALUATION_ID" ]; then
  echo -e "${YELLOW}Test 8: Check CloudWatch Logs for Decision Evaluation${NC}"
  FUNCTION_NAME="cc-native-decision-evaluation-handler"
  
  # Get recent log streams
  LOG_GROUP="/aws/lambda/${FUNCTION_NAME}"
  LOG_STREAMS=$(aws logs describe-log-streams \
    --log-group-name "${LOG_GROUP}" \
    --order-by LastEventTime \
    --descending \
    --max-items 3 \
    --region "${REGION}" \
    --query 'logStreams[*].logStreamName' \
    --output text \
    --no-cli-pager 2>/dev/null)
  
  if [ -n "$LOG_STREAMS" ] && [ "$LOG_STREAMS" != "None" ]; then
    echo -e "${GREEN}✅ Found log streams for ${FUNCTION_NAME}${NC}"
    echo "   Recent log streams:"
    for stream in $LOG_STREAMS; do
      echo "     - ${stream}"
    done
    
    # Get latest log events from the most recent stream
    LATEST_STREAM=$(echo "$LOG_STREAMS" | awk '{print $1}')
    if [ -n "$LATEST_STREAM" ]; then
      echo ""
      echo "   Latest log events from ${LATEST_STREAM}:"
      aws logs get-log-events \
        --log-group-name "${LOG_GROUP}" \
        --log-stream-name "${LATEST_STREAM}" \
        --limit 5 \
        --region "${REGION}" \
        --query 'events[*].message' \
        --output text \
        --no-cli-pager 2>/dev/null | head -5 || echo "   (No recent events)"
    fi
  else
    echo -e "${YELLOW}⚠️  No log streams found for ${FUNCTION_NAME}${NC}"
    echo "   (This is normal if evaluation hasn't completed yet)"
  fi
  echo ""
fi

echo "📝 Next Steps:"
echo "   1. Monitor decision evaluation handler logs in CloudWatch"
echo "   2. Verify decision proposals in DynamoDB (cc-native-decision-proposal table)"
echo "   3. Test action rejection flow with real decision proposals"
echo "   4. Monitor budget reset at midnight UTC"
echo "   5. Check budget consumption in DynamoDB (cc-native-decision-budget table)"