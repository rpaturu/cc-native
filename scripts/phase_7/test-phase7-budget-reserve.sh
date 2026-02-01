#!/bin/bash
# Phase 7 E2E: Budget reserve — seed one plan (for plan_id), invoke governance E2E Lambda (budget_reserve), GET ledger, assert BUDGET_RESERVE; cleanup.
# Requires: .env with AWS_REGION, REVENUE_PLANS_TABLE_NAME, PLAN_LIFECYCLE_API_FUNCTION_NAME, PLAN_LEDGER_TABLE_NAME (Lambda env; E2E uses Lifecycle for GET ledger).
# Optional: PHASE7_GOVERNANCE_E2E_FUNCTION_NAME (default cc-native-phase7-governance-e2e).
# See scripts/phase_7/README.md.

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
GOV_E2E_FN=${PHASE7_GOVERNANCE_E2E_FUNCTION_NAME:-cc-native-phase7-governance-e2e}

if [ -z "$REGION" ] || [ -z "$PLANS_TABLE" ]; then
  echo "Phase 7 E2E (budget reserve) requires: AWS_REGION, REVENUE_PLANS_TABLE_NAME (or REVENUE_PLANS_TABLE). Set in .env or environment."
  exit 1
fi

echo "Phase 7 E2E — Budget reserve (governance Lambda → BUDGET_RESERVE in ledger)"
echo "============================================================================"

# 1. Seed (one PAUSED plan for plan_id / tenant / account)
echo "1. Seeding one PAUSED plan..."
SEED_OUTPUT=$("$SCRIPT_DIR/seed-phase7-ledger-e2e.sh")
PLAN_ID=$(echo "$SEED_OUTPUT" | grep '^PLAN_ID=' | cut -d= -f2-)
TENANT_ID=$(echo "$SEED_OUTPUT" | grep '^TENANT_ID=' | cut -d= -f2-)
ACCOUNT_ID=$(echo "$SEED_OUTPUT" | grep '^ACCOUNT_ID=' | cut -d= -f2-)
PK=$(echo "$SEED_OUTPUT" | grep '^PK=' | cut -d= -f2-)
if [ -z "$PLAN_ID" ] || [ -z "$TENANT_ID" ] || [ -z "$ACCOUNT_ID" ]; then
  echo "   Seed did not output required IDs"
  exit 1
fi
echo "   PLAN_ID=$PLAN_ID"

# 2. Invoke Phase 7 governance E2E Lambda (action=budget_reserve)
echo "2. Invoking Phase 7 governance E2E Lambda (budget_reserve)..."
BODY=$(jq -cn \
  --arg plan_id "$PLAN_ID" \
  --arg tenant_id "$TENANT_ID" \
  --arg account_id "$ACCOUNT_ID" \
  '{ action: "budget_reserve", plan_id: $plan_id, tenant_id: $tenant_id, account_id: $account_id }')
PAYLOAD=$(jq -cn --arg body "$BODY" '{ body: $body }')
aws lambda invoke --region "$REGION" --function-name "$GOV_E2E_FN" \
  --payload "$PAYLOAD" --cli-binary-format raw-in-base64-out \
  /tmp/p7-budget-out.json --no-cli-pager 2>&1 || true
if [ ! -f /tmp/p7-budget-out.json ]; then
  echo "   Lambda invoke failed (no response file)"
  exit 1
fi
BUDGET_STATUS=$(jq -r '.statusCode // empty' /tmp/p7-budget-out.json 2>/dev/null)
if [ "$BUDGET_STATUS" != "200" ]; then
  echo "   Expected governance E2E Lambda status 200; got $BUDGET_STATUS. Body: $(jq -r '.body // "{}"' /tmp/p7-budget-out.json 2>/dev/null)"
  exit 1
fi
echo "   Governance E2E Lambda: 200"

# 3. GET /plans/:planId/ledger — assert at least one BUDGET_RESERVE
echo "3. Invoking GET /plans/:planId/ledger..."
LEDGER_PAYLOAD=$(jq -cn \
  --arg planId "$PLAN_ID" \
  --arg account_id "$ACCOUNT_ID" \
  --arg tenant_id "$TENANT_ID" \
  '{
    httpMethod: "GET",
    path: ("/plans/" + $planId + "/ledger"),
    resource: "/plans/{planId}/ledger",
    pathParameters: { planId: $planId },
    queryStringParameters: { account_id: $account_id },
    multiValueQueryStringParameters: null,
    body: null,
    isBase64Encoded: false,
    requestContext: { authorizer: { claims: { "custom:tenant_id": $tenant_id } } }
  }')
aws lambda invoke --region "$REGION" --function-name "$LIFECYCLE_FN" \
  --payload "$LEDGER_PAYLOAD" --cli-binary-format raw-in-base64-out \
  /tmp/p7-budget-ledger-out.json --no-cli-pager 2>&1 || true
if [ ! -f /tmp/p7-budget-ledger-out.json ]; then
  echo "   Lambda invoke failed (no response file)"
  exit 1
fi
LEDGER_STATUS=$(jq -r '.statusCode // empty' /tmp/p7-budget-ledger-out.json 2>/dev/null)
LEDGER_BODY=$(jq -r '.body // "{}"' /tmp/p7-budget-ledger-out.json 2>/dev/null)
if [ "$LEDGER_STATUS" != "200" ]; then
  echo "   Expected GET /plans/:id/ledger status 200; got $LEDGER_STATUS. Body: $LEDGER_BODY"
  exit 1
fi
BUDGET_RESERVE_COUNT=$(echo "$LEDGER_BODY" | jq -r '[.entries[]? | select(.event_type == "BUDGET_RESERVE")] | length' 2>/dev/null || echo "0")
if [ "${BUDGET_RESERVE_COUNT:-0}" -lt 1 ] 2>/dev/null; then
  echo "   Expected at least one BUDGET_RESERVE in ledger; got: $LEDGER_BODY"
  exit 1
fi
echo "   GET /plans/:id/ledger: 200, BUDGET_RESERVE count >= 1"

echo ""
echo "Phase 7 E2E (Budget reserve) PASSED"

# 4. Cleanup
echo "4. Cleaning up E2E seed data..."
aws dynamodb delete-item --region "$REGION" --table-name "$PLANS_TABLE" \
  --key "{\"pk\":{\"S\":\"$PK\"},\"sk\":{\"S\":\"PLAN#${PLAN_ID}\"}}" --no-cli-pager 2>/dev/null || true
echo "   E2E seed data cleaned up."
