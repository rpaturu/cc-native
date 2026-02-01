#!/bin/bash
# Phase 6 E2E seed (conflict-resolution): write two plans to RevenuePlans — one ACTIVE, one PAUSED (same tenant_id, account_id, plan_type).
# Resume of the PAUSED plan should be rejected with 409 Conflict.
# Requires: AWS_REGION, REVENUE_PLANS_TABLE_NAME (canonical; or REVENUE_PLANS_TABLE for backward compat).
# Outputs: PLAN_ACTIVE_ID, PLAN_PAUSED_ID, TENANT_ID, ACCOUNT_ID, PK (for cleanup).

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
if [ -z "$REGION" ] || [ -z "$PLANS_TABLE" ]; then
  echo "Phase 6 E2E seed requires: AWS_REGION, REVENUE_PLANS_TABLE_NAME (or REVENUE_PLANS_TABLE). Set in .env or environment."
  exit 1
fi
TENANT_ID=${TENANT_ID:-e2e-p6-tenant}
ACCOUNT_ID=${ACCOUNT_ID:-e2e-p6-account}
PLAN_TYPE="RENEWAL_DEFENSE"
TS=$(date +%s)
PLAN_ACTIVE_ID="e2e-p6-active-${TS}"
PLAN_PAUSED_ID="e2e-p6-paused-${TS}"
PK="TENANT#${TENANT_ID}#ACCOUNT#${ACCOUNT_ID}"
NOW_ISO=$(date -u +%Y-%m-%dT%H:%M:%SZ)
NOW2_ISO=$(date -u +%Y-%m-%dT%H:%M:%SZ)

echo "Phase 6 E2E seed (conflict) — ACTIVE=$PLAN_ACTIVE_ID PAUSED=$PLAN_PAUSED_ID"
echo "==========================================="

# Plan A: ACTIVE
PLAN_ACTIVE_ITEM=$(jq -cn \
  --arg pk "$PK" \
  --arg sk "PLAN#${PLAN_ACTIVE_ID}" \
  --arg gsi1pk "TENANT#${TENANT_ID}#STATUS#ACTIVE" \
  --arg gsi1sk "$NOW_ISO" \
  --arg gsi2pk "TENANT#${TENANT_ID}" \
  --arg gsi2sk "ACCOUNT#${ACCOUNT_ID}#${NOW_ISO}" \
  --arg plan_id "$PLAN_ACTIVE_ID" \
  --arg plan_type "$PLAN_TYPE" \
  --arg account_id "$ACCOUNT_ID" \
  --arg tenant_id "$TENANT_ID" \
  --arg now "$NOW_ISO" \
  '{
    pk: { S: $pk },
    sk: { S: $sk },
    gsi1pk: { S: $gsi1pk },
    gsi1sk: { S: $gsi1sk },
    gsi2pk: { S: $gsi2pk },
    gsi2sk: { S: $gsi2sk },
    plan_id: { S: $plan_id },
    plan_type: { S: $plan_type },
    account_id: { S: $account_id },
    tenant_id: { S: $tenant_id },
    objective: { S: "E2E conflict test active" },
    plan_status: { S: "ACTIVE" },
    steps: { L: [ { M: { step_id: { S: "s1" }, action_type: { S: "EMAIL" }, status: { S: "PENDING" }, sequence: { N: "1" } } } ] },
    expires_at: { S: $now },
    created_at: { S: $now },
    updated_at: { S: $now }
  }')
aws dynamodb put-item --region "$REGION" --table-name "$PLANS_TABLE" --item "$PLAN_ACTIVE_ITEM" --no-cli-pager
echo "1. Plan ACTIVE written: $PLAN_ACTIVE_ID"

# Plan B: PAUSED (same account + plan_type)
PLAN_PAUSED_ITEM=$(jq -cn \
  --arg pk "$PK" \
  --arg sk "PLAN#${PLAN_PAUSED_ID}" \
  --arg gsi1pk "TENANT#${TENANT_ID}#STATUS#PAUSED" \
  --arg gsi1sk "$NOW2_ISO" \
  --arg gsi2pk "TENANT#${TENANT_ID}" \
  --arg gsi2sk "ACCOUNT#${ACCOUNT_ID}#${NOW2_ISO}" \
  --arg plan_id "$PLAN_PAUSED_ID" \
  --arg plan_type "$PLAN_TYPE" \
  --arg account_id "$ACCOUNT_ID" \
  --arg tenant_id "$TENANT_ID" \
  --arg now "$NOW2_ISO" \
  '{
    pk: { S: $pk },
    sk: { S: $sk },
    gsi1pk: { S: $gsi1pk },
    gsi1sk: { S: $gsi1sk },
    gsi2pk: { S: $gsi2pk },
    gsi2sk: { S: $gsi2sk },
    plan_id: { S: $plan_id },
    plan_type: { S: $plan_type },
    account_id: { S: $account_id },
    tenant_id: { S: $tenant_id },
    objective: { S: "E2E conflict test paused" },
    plan_status: { S: "PAUSED" },
    steps: { L: [ { M: { step_id: { S: "s1" }, action_type: { S: "EMAIL" }, status: { S: "PENDING" }, sequence: { N: "1" } } } ] },
    expires_at: { S: $now },
    created_at: { S: $now },
    updated_at: { S: $now }
  }')
aws dynamodb put-item --region "$REGION" --table-name "$PLANS_TABLE" --item "$PLAN_PAUSED_ITEM" --no-cli-pager
echo "2. Plan PAUSED written: $PLAN_PAUSED_ID"

echo "PLAN_ACTIVE_ID=$PLAN_ACTIVE_ID"
echo "PLAN_PAUSED_ID=$PLAN_PAUSED_ID"
echo "TENANT_ID=$TENANT_ID"
echo "ACCOUNT_ID=$ACCOUNT_ID"
echo "PK=$PK"
