#!/bin/bash
# Phase 6 E2E: Plans API happy path — seed one PAUSED plan, GET /plans, GET /plans/:id, POST resume → 200, plan becomes ACTIVE; cleanup.
# Requires: .env with AWS_REGION, REVENUE_PLANS_TABLE_NAME, PLAN_LIFECYCLE_API_FUNCTION_NAME (or default cc-native-plan-lifecycle-api).
# See scripts/phase_6/README.md.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENV_FILE="$PROJECT_ROOT/.env"
if [ -f "$ENV_FILE" ]; then
  set -a
  source "$ENV_FILE"
  set +a
fi

REGION=${AWS_REGION:-}
PLANS_TABLE=${REVENUE_PLANS_TABLE_NAME:-${REVENUE_PLANS_TABLE:-}}
LIFECYCLE_FN=${PLAN_LIFECYCLE_API_FUNCTION_NAME:-cc-native-plan-lifecycle-api}

if [ -z "$REGION" ] || [ -z "$PLANS_TABLE" ]; then
  echo "Phase 6 E2E (plans happy) requires: AWS_REGION, REVENUE_PLANS_TABLE_NAME (or REVENUE_PLANS_TABLE). Set in .env or environment."
  exit 1
fi

echo "Phase 6 E2E — Plans API happy path"
echo "==================================="

# 1. Seed (one PAUSED plan)
echo "1. Seeding one PAUSED plan..."
SEED_OUTPUT=$("$SCRIPT_DIR/seed-phase6-plans-happy-e2e.sh")
PLAN_ID=$(echo "$SEED_OUTPUT" | grep '^PLAN_ID=' | cut -d= -f2-)
TENANT_ID=$(echo "$SEED_OUTPUT" | grep '^TENANT_ID=' | cut -d= -f2-)
ACCOUNT_ID=$(echo "$SEED_OUTPUT" | grep '^ACCOUNT_ID=' | cut -d= -f2-)
PK=$(echo "$SEED_OUTPUT" | grep '^PK=' | cut -d= -f2-)
if [ -z "$PLAN_ID" ] || [ -z "$TENANT_ID" ] || [ -z "$ACCOUNT_ID" ]; then
  echo "   Seed did not output required IDs"
  exit 1
fi
echo "   PLAN_ID=$PLAN_ID"

# 2. GET /plans (list)
echo "2. Invoking GET /plans..."
LIST_PAYLOAD=$(jq -cn \
  --arg account_id "$ACCOUNT_ID" \
  --arg tenant_id "$TENANT_ID" \
  '{
    httpMethod: "GET",
    path: "/plans",
    resource: "/plans",
    pathParameters: null,
    queryStringParameters: { account_id: $account_id },
    multiValueQueryStringParameters: null,
    body: null,
    isBase64Encoded: false,
    requestContext: { authorizer: { claims: { "custom:tenant_id": $tenant_id } } }
  }')
aws lambda invoke --region "$REGION" --function-name "$LIFECYCLE_FN" \
  --payload "$LIST_PAYLOAD" --cli-binary-format raw-in-base64-out \
  /tmp/p6-list-out.json --no-cli-pager 2>&1 || true
if [ ! -f /tmp/p6-list-out.json ]; then
  echo "   Lambda invoke failed (no response file)"
  exit 1
fi
LIST_STATUS=$(jq -r '.statusCode // empty' /tmp/p6-list-out.json 2>/dev/null)
LIST_BODY=$(jq -r '.body // "{}"' /tmp/p6-list-out.json 2>/dev/null)
if [ "$LIST_STATUS" != "200" ]; then
  echo "   Expected GET /plans status 200; got $LIST_STATUS. Body: $LIST_BODY"
  exit 1
fi
PLANS_COUNT=$(echo "$LIST_BODY" | jq -r '.plans // [] | length' 2>/dev/null || echo "0")
if [ "${PLANS_COUNT:-0}" -lt 1 ] 2>/dev/null; then
  echo "   Expected at least one plan in list; got: $LIST_BODY"
  exit 1
fi
echo "   GET /plans: 200, plans count >= 1"

# 3. GET /plans/:planId
echo "3. Invoking GET /plans/:planId..."
GET_PAYLOAD=$(jq -cn \
  --arg planId "$PLAN_ID" \
  --arg account_id "$ACCOUNT_ID" \
  --arg tenant_id "$TENANT_ID" \
  '{
    httpMethod: "GET",
    path: ("/plans/" + $planId),
    resource: "/plans/{planId}",
    pathParameters: { planId: $planId },
    queryStringParameters: { account_id: $account_id },
    multiValueQueryStringParameters: null,
    body: null,
    isBase64Encoded: false,
    requestContext: { authorizer: { claims: { "custom:tenant_id": $tenant_id } } }
  }')
aws lambda invoke --region "$REGION" --function-name "$LIFECYCLE_FN" \
  --payload "$GET_PAYLOAD" --cli-binary-format raw-in-base64-out \
  /tmp/p6-get-out.json --no-cli-pager 2>&1 || true
if [ ! -f /tmp/p6-get-out.json ]; then
  echo "   Lambda invoke failed (no response file)"
  exit 1
fi
GET_STATUS=$(jq -r '.statusCode // empty' /tmp/p6-get-out.json 2>/dev/null)
GET_BODY=$(jq -r '.body // "{}"' /tmp/p6-get-out.json 2>/dev/null)
if [ "$GET_STATUS" != "200" ]; then
  echo "   Expected GET /plans/:id status 200; got $GET_STATUS. Body: $GET_BODY"
  exit 1
fi
GET_PLAN_STATUS=$(echo "$GET_BODY" | jq -r '.plan.plan_status // empty' 2>/dev/null)
if [ "$GET_PLAN_STATUS" != "PAUSED" ]; then
  echo "   Expected plan_status PAUSED; got $GET_PLAN_STATUS"
  exit 1
fi
echo "   GET /plans/:id: 200, plan_status PAUSED"

# 4. POST /plans/:planId/resume (no conflict → 200)
echo "4. Invoking POST /plans/:planId/resume..."
RESUME_PAYLOAD=$(jq -cn \
  --arg planId "$PLAN_ID" \
  --arg account_id "$ACCOUNT_ID" \
  --arg tenant_id "$TENANT_ID" \
  '{
    httpMethod: "POST",
    path: ("/plans/" + $planId + "/resume"),
    resource: "/plans/{planId}/resume",
    pathParameters: { planId: $planId },
    queryStringParameters: { account_id: $account_id },
    multiValueQueryStringParameters: null,
    body: "{}",
    isBase64Encoded: false,
    requestContext: { authorizer: { claims: { "custom:tenant_id": $tenant_id } } }
  }')
aws lambda invoke --region "$REGION" --function-name "$LIFECYCLE_FN" \
  --payload "$RESUME_PAYLOAD" --cli-binary-format raw-in-base64-out \
  /tmp/p6-resume-happy-out.json --no-cli-pager 2>&1 || true
if [ ! -f /tmp/p6-resume-happy-out.json ]; then
  echo "   Lambda invoke failed (no response file)"
  exit 1
fi
RESUME_STATUS=$(jq -r '.statusCode // empty' /tmp/p6-resume-happy-out.json 2>/dev/null)
if [ "$RESUME_STATUS" != "200" ]; then
  echo "   Expected POST resume status 200; got $RESUME_STATUS. Body: $(jq -r '.body // "{}"' /tmp/p6-resume-happy-out.json 2>/dev/null)"
  exit 1
fi
echo "   POST resume: 200"

# 5. Assert plan is ACTIVE (re-read from DynamoDB)
echo "5. Verifying plan status ACTIVE..."
PLAN_ITEM=$(aws dynamodb get-item --region "$REGION" --table-name "$PLANS_TABLE" \
  --key "{\"pk\":{\"S\":\"$PK\"},\"sk\":{\"S\":\"PLAN#${PLAN_ID}\"}}" --no-cli-pager 2>/dev/null || true)
PLAN_STATUS=$(echo "$PLAN_ITEM" | jq -r '.Item.plan_status.S // empty' 2>/dev/null)
if [ "$PLAN_STATUS" != "ACTIVE" ]; then
  echo "   Expected plan_status ACTIVE; got $PLAN_STATUS"
  exit 1
fi
echo "   Plan plan_status: ACTIVE"

echo ""
echo "Phase 6 E2E (Plans API happy path) PASSED"

# 6. Cleanup
echo "6. Cleaning up E2E seed data..."
aws dynamodb delete-item --region "$REGION" --table-name "$PLANS_TABLE" \
  --key "{\"pk\":{\"S\":\"$PK\"},\"sk\":{\"S\":\"PLAN#${PLAN_ID}\"}}" --no-cli-pager 2>/dev/null || true
echo "   E2E seed data cleaned up."
