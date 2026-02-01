#!/bin/bash
# Phase 6 E2E seed (orchestrator cycle): write one tenant to Tenants and one APPROVED plan to RevenuePlans.
# Orchestrator runCycle should activate the plan (APPROVED → ACTIVE).
# Requires: AWS_REGION, REVENUE_PLANS_TABLE_NAME (or REVENUE_PLANS_TABLE), TENANTS_TABLE_NAME (or TENANTS_TABLE).
# Outputs: PLAN_ID, TENANT_ID, ACCOUNT_ID, PK (for cleanup).

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
if [ -z "$REGION" ] || [ -z "$PLANS_TABLE" ]; then
  echo "Phase 6 E2E seed (orchestrator) requires: AWS_REGION, REVENUE_PLANS_TABLE_NAME (or REVENUE_PLANS_TABLE). Set in .env or environment."
  exit 1
fi
TENANT_ID=${TENANT_ID:-e2e-p6-orch-tenant}
ACCOUNT_ID=${ACCOUNT_ID:-e2e-p6-orch-account}
PLAN_TYPE="RENEWAL_DEFENSE"
TS=$(date +%s)
PLAN_ID="e2e-p6-orch-${TS}"
PK="TENANT#${TENANT_ID}#ACCOUNT#${ACCOUNT_ID}"
NOW_ISO=$(date -u +%Y-%m-%dT%H:%M:%SZ)

echo "Phase 6 E2E seed (orchestrator) — TENANT_ID=$TENANT_ID PLAN_ID=$PLAN_ID"
echo "==========================================="

# 1. Tenant (orchestrator scans Tenants for tenantId)
TENANT_ITEM=$(jq -cn \
  --arg tenant_id "$TENANT_ID" \
  --arg now "$NOW_ISO" \
  '{
    tenantId: { S: $tenant_id },
    created_at: { S: $now }
  }')
aws dynamodb put-item --region "$REGION" --table-name "$TENANTS_TABLE" --item "$TENANT_ITEM" --no-cli-pager
echo "1. Tenant written: $TENANT_ID"

# 2. APPROVED plan (orchestrator lists by status APPROVED, then activates)
PLAN_ITEM=$(jq -cn \
  --arg pk "$PK" \
  --arg sk "PLAN#${PLAN_ID}" \
  --arg gsi1pk "TENANT#${TENANT_ID}#STATUS#APPROVED" \
  --arg gsi1sk "$NOW_ISO" \
  --arg gsi2pk "TENANT#${TENANT_ID}" \
  --arg gsi2sk "ACCOUNT#${ACCOUNT_ID}#${NOW_ISO}" \
  --arg plan_id "$PLAN_ID" \
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
    objective: { S: "E2E orchestrator cycle" },
    plan_status: { S: "APPROVED" },
    steps: { L: [ { M: { step_id: { S: "s1" }, action_type: { S: "EMAIL" }, status: { S: "PENDING" }, sequence: { N: "1" } } } ] },
    expires_at: { S: $now },
    created_at: { S: $now },
    updated_at: { S: $now }
  }')
aws dynamodb put-item --region "$REGION" --table-name "$PLANS_TABLE" --item "$PLAN_ITEM" --no-cli-pager
echo "2. Plan APPROVED written: $PLAN_ID"

echo "PLAN_ID=$PLAN_ID"
echo "TENANT_ID=$TENANT_ID"
echo "ACCOUNT_ID=$ACCOUNT_ID"
echo "PK=$PK"
