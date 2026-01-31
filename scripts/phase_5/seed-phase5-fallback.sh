#!/bin/bash
# Phase 5 E2E seed (fallback path): intent + autonomy config with budget exhausted (max_autonomous_per_day=0).
# Gate should return REQUIRE_APPROVAL (BUDGET_EXCEEDED); no execution attempt.
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
INTENT_TABLE=${ACTION_INTENT_TABLE_NAME:?}
AUTONOMY_TABLE=${AUTONOMY_CONFIG_TABLE_NAME:?}
BUDGET_TABLE=${AUTONOMY_BUDGET_STATE_TABLE_NAME:?}
TENANT_ID=${TENANT_ID:-test-tenant-1}
ACCOUNT_ID=${ACCOUNT_ID:-test-account-1}

ACTION_INTENT_ID="ai_p5_fallback_$(date +%s)_$$"
PK="TENANT#${TENANT_ID}#ACCOUNT#${ACCOUNT_ID}"
SK_INTENT="ACTION_INTENT#${ACTION_INTENT_ID}"
EXPIRES_AT=$(date -u -v+7d 2>/dev/null || date -u -d '+7 days' 2>/dev/null || date -u +%Y-%m-%dT%H:%M:%SZ)
EXPIRES_EPOCH=$(date -u -v+7d +%s 2>/dev/null || date -u -d '+7 days' +%s 2>/dev/null || echo $(( $(date +%s) + 604800 )))
NOW_ISO=$(date -u +%Y-%m-%dT%H:%M:%SZ)

echo "Phase 5 E2E seed (fallback) — intent $ACTION_INTENT_ID"
echo "==========================================="

# 1. Action intent
INTENT_ITEM=$(jq -cn \
  --arg pk "$PK" --arg sk "$SK_INTENT" --arg aid "$ACTION_INTENT_ID" --arg tid "$TENANT_ID" --arg acid "$ACCOUNT_ID" \
  --arg exp "$EXPIRES_AT" --argjson epoch "$EXPIRES_EPOCH" --arg now "$NOW_ISO" \
  '{
    pk: { S: $pk }, sk: { S: $sk }, action_intent_id: { S: $aid }, action_type: { S: "CREATE_INTERNAL_TASK" },
    target: { M: {} }, parameters: { M: { title: { S: "Phase 5 E2E fallback" }, description: { S: "E2E" } } },
    parameters_schema_version: { S: "1" }, execution_policy: { M: { retry_count: { N: "3" }, timeout_seconds: { N: "300" }, max_attempts: { N: "1" } } },
    expires_at: { S: $exp }, expires_at_epoch: { N: ($epoch | tostring) }, original_decision_id: { S: "e2e-p5" }, original_proposal_id: { S: "e2e-p5" },
    edited_fields: { L: [] }, tenant_id: { S: $tid }, account_id: { S: $acid }, trace_id: { S: "e2e-p5-fb" }, registry_version: { N: "1" },
    confidence_score: { N: "0.9" }, risk_level: { S: "LOW" }
  }')
aws dynamodb put-item --region "$REGION" --table-name "$INTENT_TABLE" --item "$INTENT_ITEM" --no-cli-pager
echo "1. ActionIntent written"

# 2. Allowlist
ALLOWLIST_ITEM=$(jq -cn --arg pk "$PK" --arg tid "$TENANT_ID" --arg acid "$ACCOUNT_ID" --arg now "$NOW_ISO" \
  '{ pk: { S: $pk }, sk: { S: "ALLOWLIST#AUTO_EXEC" }, tenant_id: { S: $tid }, account_id: { S: $acid }, action_types: { L: [{ S: "CREATE_INTERNAL_TASK" }] }, updated_at: { S: $now } }')
aws dynamodb put-item --region "$REGION" --table-name "$AUTONOMY_TABLE" --item "$ALLOWLIST_ITEM" --no-cli-pager
echo "2. Allowlist written"

# 3. Mode AUTO_EXECUTE
MODE_ITEM=$(jq -cn --arg pk "$PK" --arg tid "$TENANT_ID" --arg acid "$ACCOUNT_ID" --arg now "$NOW_ISO" \
  '{ pk: { S: $pk }, sk: { S: "AUTONOMY#CREATE_INTERNAL_TASK" }, tenant_id: { S: $tid }, account_id: { S: $acid }, mode: { S: "AUTO_EXECUTE" }, updated_at: { S: $now }, policy_version: { S: "AutonomyModeConfigV1" } }')
aws dynamodb put-item --region "$REGION" --table-name "$AUTONOMY_TABLE" --item "$MODE_ITEM" --no-cli-pager
echo "3. Autonomy mode written"

# 4. Budget config: max_autonomous_per_day=0 so gate returns BUDGET_EXCEEDED
BUDGET_ITEM=$(jq -cn --arg pk "$PK" --arg tid "$TENANT_ID" --arg acid "$ACCOUNT_ID" --arg now "$NOW_ISO" \
  '{ pk: { S: $pk }, sk: { S: "BUDGET#CONFIG" }, tenant_id: { S: $tid }, account_id: { S: $acid }, max_autonomous_per_day: { N: "0" }, updated_at: { S: $now } }')
aws dynamodb put-item --region "$REGION" --table-name "$BUDGET_TABLE" --item "$BUDGET_ITEM" --no-cli-pager
echo "4. Budget config (exhausted) written"

echo ""
echo "ACTION_INTENT_ID=$ACTION_INTENT_ID"
