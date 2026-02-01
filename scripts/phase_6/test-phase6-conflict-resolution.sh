#!/bin/bash
# Phase 6 E2E: conflict resolution — seed two plans (ACTIVE + PAUSED), invoke Plan Lifecycle API resume for PAUSED, expect 409 Conflict; cleanup.
# Requires: .env with REVENUE_PLANS_TABLE_NAME, PLAN_LIFECYCLE_API_FUNCTION_NAME (or default cc-native-plan-lifecycle-api).
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
  echo "Phase 6 E2E requires: AWS_REGION, REVENUE_PLANS_TABLE_NAME (or REVENUE_PLANS_TABLE). Set in .env or environment."
  exit 1
fi

echo "Phase 6 E2E — conflict resolution"
echo "=================================="

# 1. Seed (ACTIVE + PAUSED plans)
echo "1. Seeding two plans (ACTIVE + PAUSED, same account+plan_type)..."
SEED_OUTPUT=$("$SCRIPT_DIR/seed-phase6-conflict-e2e.sh")
PLAN_ACTIVE_ID=$(echo "$SEED_OUTPUT" | grep '^PLAN_ACTIVE_ID=' | cut -d= -f2-)
PLAN_PAUSED_ID=$(echo "$SEED_OUTPUT" | grep '^PLAN_PAUSED_ID=' | cut -d= -f2-)
TENANT_ID=$(echo "$SEED_OUTPUT" | grep '^TENANT_ID=' | cut -d= -f2-)
ACCOUNT_ID=$(echo "$SEED_OUTPUT" | grep '^ACCOUNT_ID=' | cut -d= -f2-)
PK=$(echo "$SEED_OUTPUT" | grep '^PK=' | cut -d= -f2-)
if [ -z "$PLAN_PAUSED_ID" ] || [ -z "$TENANT_ID" ] || [ -z "$ACCOUNT_ID" ]; then
  echo "   Seed did not output required IDs"
  exit 1
fi
echo "   PLAN_PAUSED_ID=$PLAN_PAUSED_ID (resume target)"
echo "   PLAN_ACTIVE_ID=$PLAN_ACTIVE_ID (conflict)"

# 2. Invoke Plan Lifecycle API Lambda (POST /plans/:planId/resume)
echo "2. Invoking Plan Lifecycle API (POST /plans/:planId/resume)..."
RESUME_PAYLOAD=$(jq -cn \
  --arg planId "$PLAN_PAUSED_ID" \
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
    requestContext: {
      authorizer: {
        claims: { "custom:tenant_id": $tenant_id }
      }
    }
  }')
aws lambda invoke --region "$REGION" --function-name "$LIFECYCLE_FN" \
  --payload "$RESUME_PAYLOAD" --cli-binary-format raw-in-base64-out \
  /tmp/p6-resume-out.json --no-cli-pager 2>&1 || true

if [ ! -f /tmp/p6-resume-out.json ]; then
  echo "   Lambda invoke failed (no response file)"
  exit 1
fi

# 3. Parse response: expect statusCode 409, body.error "Conflict", reasons CONFLICT_ACTIVE_PLAN
STATUS=$(jq -r '.statusCode // empty' /tmp/p6-resume-out.json 2>/dev/null)
BODY=$(jq -r '.body // "{}"' /tmp/p6-resume-out.json 2>/dev/null)
ERROR=$(echo "$BODY" | jq -r '.error // empty' 2>/dev/null)
HAS_CONFLICT_REASON=$(echo "$BODY" | jq -r '.reasons // [] | map(select(.code == "CONFLICT_ACTIVE_PLAN")) | length' 2>/dev/null || echo "0")

if [ "$STATUS" != "409" ]; then
  echo "   Expected statusCode 409; got $STATUS. Body: $BODY"
  exit 1
fi
if [ "$ERROR" != "Conflict" ]; then
  echo "   Expected body.error \"Conflict\"; got \"$ERROR\""
  exit 1
fi
if [ "${HAS_CONFLICT_REASON:-0}" -lt 1 ] 2>/dev/null; then
  echo "   Expected body.reasons to include CONFLICT_ACTIVE_PLAN; got: $BODY"
  exit 1
fi
echo "   Response: 409 Conflict, error=Conflict, CONFLICT_ACTIVE_PLAN in reasons"

# 3b. Assert Plan B remained PAUSED (no transition)
echo "3. Verifying Plan B still PAUSED (no transition)..."
PLAN_B_ITEM=$(aws dynamodb get-item --region "$REGION" --table-name "$PLANS_TABLE" \
  --key "{\"pk\":{\"S\":\"$PK\"},\"sk\":{\"S\":\"PLAN#${PLAN_PAUSED_ID}\"}}" --no-cli-pager 2>/dev/null || true)
PLAN_B_STATUS=$(echo "$PLAN_B_ITEM" | jq -r '.Item.plan_status.S // empty' 2>/dev/null)
if [ "$PLAN_B_STATUS" != "PAUSED" ]; then
  echo "   Expected Plan B plan_status PAUSED; got: $PLAN_B_STATUS"
  exit 1
fi
echo "   Plan B plan_status: PAUSED (no transition)"

# 3c. If Plan Ledger table present, assert PLAN_ACTIVATION_REJECTED event (caller resume, conflicting_plan_ids contains Plan A)
LEDGER_TABLE=${PLAN_LEDGER_TABLE_NAME:-${PLAN_LEDGER_TABLE:-}}
if [ -n "$LEDGER_TABLE" ]; then
  echo "3. Verifying Plan Ledger PLAN_ACTIVATION_REJECTED (caller=resume, conflicting_plan_ids contains Plan A)..."
  LEDGER_QUERY=$(aws dynamodb query --region "$REGION" --table-name "$LEDGER_TABLE" \
    --key-condition-expression "pk = :pk AND begins_with(sk, :prefix)" \
    --expression-attribute-values "{\":pk\":{\"S\":\"PLAN#${PLAN_PAUSED_ID}\"},\":prefix\":{\"S\":\"EVENT#\"}}" \
    --max-items 20 --no-cli-pager 2>/dev/null || true)
  FOUND_REJECTED=$(echo "$LEDGER_QUERY" | jq -r --arg et "PLAN_ACTIVATION_REJECTED" --arg caller "resume" --arg aid "$PLAN_ACTIVE_ID" '
    [.Items[]? | select(.event_type.S == $et and (.data.M.caller.S // "") == $caller) |
     select((.data.M.conflicting_plan_ids.L // [] | map(.S) | index($aid)) != null)] | length
  ' 2>/dev/null || echo "0")
  if [ "${FOUND_REJECTED:-0}" -lt 1 ] 2>/dev/null; then
    echo "   Expected at least one ledger event PLAN_ACTIVATION_REJECTED (caller=resume, conflicting_plan_ids contains $PLAN_ACTIVE_ID)"
    exit 1
  fi
  echo "   Ledger event PLAN_ACTIVATION_REJECTED found (caller=resume, conflicting_plan_ids contains Plan A)"
else
  echo "3. Skipping ledger assertion (PLAN_LEDGER_TABLE_NAME not set)"
fi

echo ""
echo "Phase 6 E2E (conflict resolution) PASSED"

# 4. Cleanup
echo "4. Cleaning up E2E seed data..."
aws dynamodb delete-item --region "$REGION" --table-name "$PLANS_TABLE" \
  --key "{\"pk\":{\"S\":\"$PK\"},\"sk\":{\"S\":\"PLAN#${PLAN_ACTIVE_ID}\"}}" --no-cli-pager 2>/dev/null || true
aws dynamodb delete-item --region "$REGION" --table-name "$PLANS_TABLE" \
  --key "{\"pk\":{\"S\":\"$PK\"},\"sk\":{\"S\":\"PLAN#${PLAN_PAUSED_ID}\"}}" --no-cli-pager 2>/dev/null || true
echo "   E2E seed data cleaned up."
