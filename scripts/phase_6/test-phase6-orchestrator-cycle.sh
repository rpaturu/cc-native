#!/bin/bash
# Phase 6 E2E: Orchestrator cycle — seed tenant + APPROVED plan, invoke plan-orchestrator Lambda, assert plan becomes ACTIVE; cleanup.
# Requires: .env with AWS_REGION, REVENUE_PLANS_TABLE_NAME, TENANTS_TABLE_NAME, PLAN_ORCHESTRATOR_FUNCTION_NAME (or default cc-native-plan-orchestrator).
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
TENANTS_TABLE=${TENANTS_TABLE_NAME:-${TENANTS_TABLE:-cc-native-tenants}}
ORCH_FN=${PLAN_ORCHESTRATOR_FUNCTION_NAME:-cc-native-plan-orchestrator}

if [ -z "$REGION" ] || [ -z "$PLANS_TABLE" ]; then
  echo "Phase 6 E2E (orchestrator) requires: AWS_REGION, REVENUE_PLANS_TABLE_NAME (or REVENUE_PLANS_TABLE). Set in .env or environment."
  exit 1
fi

echo "Phase 6 E2E — Orchestrator cycle"
echo "==================================="

# 1. Seed (tenant + one APPROVED plan)
echo "1. Seeding tenant and one APPROVED plan..."
SEED_OUTPUT=$("$SCRIPT_DIR/seed-phase6-orchestrator-e2e.sh")
PLAN_ID=$(echo "$SEED_OUTPUT" | grep '^PLAN_ID=' | cut -d= -f2-)
TENANT_ID=$(echo "$SEED_OUTPUT" | grep '^TENANT_ID=' | cut -d= -f2-)
ACCOUNT_ID=$(echo "$SEED_OUTPUT" | grep '^ACCOUNT_ID=' | cut -d= -f2-)
PK=$(echo "$SEED_OUTPUT" | grep '^PK=' | cut -d= -f2-)
if [ -z "$PLAN_ID" ] || [ -z "$TENANT_ID" ] || [ -z "$ACCOUNT_ID" ]; then
  echo "   Seed did not output required IDs"
  exit 1
fi
echo "   PLAN_ID=$PLAN_ID TENANT_ID=$TENANT_ID"

# 2. Invoke plan-orchestrator Lambda (scheduled-event payload)
echo "2. Invoking plan-orchestrator Lambda..."
ORCH_PAYLOAD=$(jq -cn '{
  version: "0",
  id: "e2e-phase6-orch",
  "detail-type": "Scheduled Event",
  source: "events.amazonaws.com",
  account: "123456789012",
  time: (now | todate),
  region: "us-west-2",
  resources: ["arn:aws:events:us-west-2:123456789012:rule/plan-orchestrator"],
  detail: {}
}')
aws lambda invoke --region "$REGION" --function-name "$ORCH_FN" \
  --payload "$ORCH_PAYLOAD" --cli-binary-format raw-in-base64-out \
  /tmp/p6-orch-out.json --no-cli-pager 2>&1 || true
if [ ! -f /tmp/p6-orch-out.json ]; then
  echo "   Lambda invoke failed (no response file)"
  exit 1
fi
# Orchestrator returns void; check for Lambda errors in stderr / exit code. Invoke succeeds if Lambda runs.
echo "   Orchestrator invoked"

# 3. Assert plan is ACTIVE (re-read from DynamoDB)
echo "3. Verifying plan status ACTIVE..."
PLAN_ITEM=$(aws dynamodb get-item --region "$REGION" --table-name "$PLANS_TABLE" \
  --key "{\"pk\":{\"S\":\"$PK\"},\"sk\":{\"S\":\"PLAN#${PLAN_ID}\"}}" --no-cli-pager 2>/dev/null || true)
PLAN_STATUS=$(echo "$PLAN_ITEM" | jq -r '.Item.plan_status.S // empty' 2>/dev/null)
if [ "$PLAN_STATUS" != "ACTIVE" ]; then
  echo "   Expected plan_status ACTIVE; got $PLAN_STATUS"
  exit 1
fi
echo "   Plan plan_status: ACTIVE"

echo ""
echo "Phase 6 E2E (Orchestrator cycle) PASSED"

# 4. Cleanup
echo "4. Cleaning up E2E seed data..."
aws dynamodb delete-item --region "$REGION" --table-name "$PLANS_TABLE" \
  --key "{\"pk\":{\"S\":\"$PK\"},\"sk\":{\"S\":\"PLAN#${PLAN_ID}\"}}" --no-cli-pager 2>/dev/null || true
aws dynamodb delete-item --region "$REGION" --table-name "$TENANTS_TABLE" \
  --key "{\"tenantId\":{\"S\":\"$TENANT_ID\"}}" --no-cli-pager 2>/dev/null || true
echo "   E2E seed data cleaned up."
