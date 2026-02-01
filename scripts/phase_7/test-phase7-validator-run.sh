#!/bin/bash
# Phase 7 E2E: Validator run — seed one PAUSED plan, POST resume, GET ledger, assert VALIDATOR_RUN or VALIDATOR_RUN_SUMMARY; cleanup.
# Requires: .env with AWS_REGION, REVENUE_PLANS_TABLE_NAME, PLAN_LIFECYCLE_API_FUNCTION_NAME (or default cc-native-plan-lifecycle-api).
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

if [ -z "$REGION" ] || [ -z "$PLANS_TABLE" ]; then
  echo "Phase 7 E2E (validator run) requires: AWS_REGION, REVENUE_PLANS_TABLE_NAME (or REVENUE_PLANS_TABLE). Set in .env or environment."
  exit 1
fi

echo "Phase 7 E2E — Validator run (resume → VALIDATOR_RUN in ledger)"
echo "=============================================================="

# 1. Seed (one PAUSED plan)
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

# 2. POST /plans/:planId/resume (200)
echo "2. Invoking POST /plans/:planId/resume..."
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
  /tmp/p7-validator-resume-out.json --no-cli-pager 2>&1 || true
if [ ! -f /tmp/p7-validator-resume-out.json ]; then
  echo "   Lambda invoke failed (no response file)"
  exit 1
fi
RESUME_STATUS=$(jq -r '.statusCode // empty' /tmp/p7-validator-resume-out.json 2>/dev/null)
if [ "$RESUME_STATUS" != "200" ]; then
  echo "   Expected POST resume status 200; got $RESUME_STATUS. Body: $(jq -r '.body // "{}"' /tmp/p7-validator-resume-out.json 2>/dev/null)"
  exit 1
fi
echo "   POST resume: 200"

# 3. GET /plans/:planId/ledger — assert at least one VALIDATOR_RUN or VALIDATOR_RUN_SUMMARY
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
  /tmp/p7-validator-ledger-out.json --no-cli-pager 2>&1 || true
if [ ! -f /tmp/p7-validator-ledger-out.json ]; then
  echo "   Lambda invoke failed (no response file)"
  exit 1
fi
LEDGER_STATUS=$(jq -r '.statusCode // empty' /tmp/p7-validator-ledger-out.json 2>/dev/null)
LEDGER_BODY=$(jq -r '.body // "{}"' /tmp/p7-validator-ledger-out.json 2>/dev/null)
if [ "$LEDGER_STATUS" != "200" ]; then
  echo "   Expected GET /plans/:id/ledger status 200; got $LEDGER_STATUS. Body: $LEDGER_BODY"
  exit 1
fi
VALIDATOR_RUN_COUNT=$(echo "$LEDGER_BODY" | jq -r '[.entries[]? | select(.event_type == "VALIDATOR_RUN" or .event_type == "VALIDATOR_RUN_SUMMARY")] | length' 2>/dev/null || echo "0")
if [ "${VALIDATOR_RUN_COUNT:-0}" -lt 1 ] 2>/dev/null; then
  echo "   Expected at least one VALIDATOR_RUN or VALIDATOR_RUN_SUMMARY in ledger; got: $LEDGER_BODY"
  exit 1
fi
echo "   GET /plans/:id/ledger: 200, validator events count >= 1"

echo ""
echo "Phase 7 E2E (Validator run) PASSED"

# 4. Cleanup
echo "4. Cleaning up E2E seed data..."
aws dynamodb delete-item --region "$REGION" --table-name "$PLANS_TABLE" \
  --key "{\"pk\":{\"S\":\"$PK\"},\"sk\":{\"S\":\"PLAN#${PLAN_ID}\"}}" --no-cli-pager 2>/dev/null || true
echo "   E2E seed data cleaned up."
