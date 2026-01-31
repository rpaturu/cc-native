#!/bin/bash
# Phase 5 E2E seed (auto-exec path): write one action intent + autonomy config (allowlist, mode, budget).
# Does NOT put ACTION_APPROVED; the auto-approval gate will do that after policy allows.
# Requires: AWS_REGION, ACTION_INTENT_TABLE_NAME, AUTONOMY_CONFIG_TABLE_NAME, AUTONOMY_BUDGET_STATE_TABLE_NAME.
# Outputs: ACTION_INTENT_ID.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
# Seed uses .env only (populated by deploy from stack outputs). .env.local is for deploy inputs only.
ENV_FILE="$PROJECT_ROOT/.env"
if [ -f "$ENV_FILE" ]; then
  set -a
  source "$ENV_FILE"
  set +a
fi

REGION=${AWS_REGION:?Set AWS_REGION}
INTENT_TABLE=${ACTION_INTENT_TABLE_NAME:?ACTION_INTENT_TABLE_NAME required}
AUTONOMY_TABLE=${AUTONOMY_CONFIG_TABLE_NAME:?AUTONOMY_CONFIG_TABLE_NAME required}
BUDGET_TABLE=${AUTONOMY_BUDGET_STATE_TABLE_NAME:?AUTONOMY_BUDGET_STATE_TABLE_NAME required}
TENANT_ID=${TENANT_ID:-test-tenant-1}
ACCOUNT_ID=${ACCOUNT_ID:-test-account-1}

ACTION_INTENT_ID="ai_p5_autoexec_$(date +%s)_$$"
PK="TENANT#${TENANT_ID}#ACCOUNT#${ACCOUNT_ID}"
SK_INTENT="ACTION_INTENT#${ACTION_INTENT_ID}"
EXPIRES_AT=$(date -u -v+7d 2>/dev/null || date -u -d '+7 days' 2>/dev/null || date -u +%Y-%m-%dT%H:%M:%SZ)
EXPIRES_EPOCH=$(date -u -v+7d +%s 2>/dev/null || date -u -d '+7 days' +%s 2>/dev/null || echo $(( $(date +%s) + 604800 )))
NOW_ISO=$(date -u +%Y-%m-%dT%H:%M:%SZ)
DATE_KEY=$(date -u +%Y-%m-%d)

echo "Phase 5 E2E seed (auto-exec) — intent $ACTION_INTENT_ID"
echo "==========================================="

# 1. Action intent (no approval yet)
INTENT_ITEM=$(jq -cn \
  --arg pk "$PK" \
  --arg sk "$SK_INTENT" \
  --arg aid "$ACTION_INTENT_ID" \
  --arg tid "$TENANT_ID" \
  --arg acid "$ACCOUNT_ID" \
  --arg exp "$EXPIRES_AT" \
  --argjson epoch "$EXPIRES_EPOCH" \
  --arg now "$NOW_ISO" \
  '{
    pk: { S: $pk },
    sk: { S: $sk },
    action_intent_id: { S: $aid },
    action_type: { S: "CREATE_INTERNAL_TASK" },
    target: { M: {} },
    parameters: { M: { title: { S: "Phase 5 E2E auto-exec" }, description: { S: "E2E seed" } } },
    parameters_schema_version: { S: "1" },
    execution_policy: { M: { retry_count: { N: "3" }, timeout_seconds: { N: "300" }, max_attempts: { N: "1" } } },
    expires_at: { S: $exp },
    expires_at_epoch: { N: ($epoch | tostring) },
    original_decision_id: { S: "e2e-p5" },
    original_proposal_id: { S: "e2e-p5" },
    edited_fields: { L: [] },
    tenant_id: { S: $tid },
    account_id: { S: $acid },
    trace_id: { S: "e2e-p5-trace" },
    registry_version: { N: "1" },
    confidence_score: { N: "0.9" },
    risk_level: { S: "LOW" }
  }')
aws dynamodb put-item --region "$REGION" --table-name "$INTENT_TABLE" --item "$INTENT_ITEM" --no-cli-pager
echo "1. ActionIntent written to $INTENT_TABLE"

# 2. Allowlist (CREATE_INTERNAL_TASK allowed for tenant+account)
ALLOWLIST_ITEM=$(jq -cn \
  --arg pk "$PK" \
  --arg tid "$TENANT_ID" \
  --arg acid "$ACCOUNT_ID" \
  --arg now "$NOW_ISO" \
  '{
    pk: { S: $pk },
    sk: { S: "ALLOWLIST#AUTO_EXEC" },
    tenant_id: { S: $tid },
    account_id: { S: $acid },
    action_types: { L: [{ S: "CREATE_INTERNAL_TASK" }] },
    updated_at: { S: $now }
  }')
aws dynamodb put-item --region "$REGION" --table-name "$AUTONOMY_TABLE" --item "$ALLOWLIST_ITEM" --no-cli-pager
echo "2. Allowlist written to $AUTONOMY_TABLE"

# 3. Mode AUTO_EXECUTE for CREATE_INTERNAL_TASK
MODE_ITEM=$(jq -cn \
  --arg pk "$PK" \
  --arg tid "$TENANT_ID" \
  --arg acid "$ACCOUNT_ID" \
  --arg now "$NOW_ISO" \
  '{
    pk: { S: $pk },
    sk: { S: "AUTONOMY#CREATE_INTERNAL_TASK" },
    tenant_id: { S: $tid },
    account_id: { S: $acid },
    mode: { S: "AUTO_EXECUTE" },
    updated_at: { S: $now },
    policy_version: { S: "AutonomyModeConfigV1" }
  }')
aws dynamodb put-item --region "$REGION" --table-name "$AUTONOMY_TABLE" --item "$MODE_ITEM" --no-cli-pager
echo "3. Autonomy mode written to $AUTONOMY_TABLE"

# Clear today's budget state so this E2E run can consume (avoids BUDGET_EXCEEDED from prior runs)
aws dynamodb delete-item --region "$REGION" --table-name "$BUDGET_TABLE" \
  --key "{\"pk\":{\"S\":\"$PK\"},\"sk\":{\"S\":\"BUDGET_STATE#${DATE_KEY}\"}}" --no-cli-pager
echo "3b. Budget state for today cleared (if any)"

# 4. Budget config (1 per day)
BUDGET_ITEM=$(jq -cn \
  --arg pk "$PK" \
  --arg tid "$TENANT_ID" \
  --arg acid "$ACCOUNT_ID" \
  --arg now "$NOW_ISO" \
  '{
    pk: { S: $pk },
    sk: { S: "BUDGET#CONFIG" },
    tenant_id: { S: $tid },
    account_id: { S: $acid },
    max_autonomous_per_day: { N: "1" },
    updated_at: { S: $now }
  }')
aws dynamodb put-item --region "$REGION" --table-name "$BUDGET_TABLE" --item "$BUDGET_ITEM" --no-cli-pager
echo "4. Budget config written to $BUDGET_TABLE"

echo ""
echo "ACTION_INTENT_ID=$ACTION_INTENT_ID"
