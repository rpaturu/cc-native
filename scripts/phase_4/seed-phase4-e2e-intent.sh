#!/bin/bash
# Phase 4 E2E seed: write one action intent to ActionIntent table and put ACTION_APPROVED to EventBridge.
# Matches production: EventBridge rule starts Step Functions. Outputs ACTION_INTENT_ID for test-phase4-execution.sh.
# Requires (fail fast): AWS_REGION, EVENT_BUS_NAME, ACTION_INTENT_TABLE_NAME (e.g. from .env / CDK outputs). CLI: aws (v2), jq.
# See docs/implementation/phase_4/PHASE_4_5_CODE_LEVEL_PLAN.md §3.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENV_FILE="$PROJECT_ROOT/.env"
if [ -f "$ENV_FILE" ]; then
  set -a
  source "$ENV_FILE"
  set +a
fi

REGION=${AWS_REGION:?Set AWS_REGION to the deployed region (e.g. us-east-1)}
EVENT_BUS=${EVENT_BUS_NAME:?EVENT_BUS_NAME required (e.g. from .env / CDK outputs)}
INTENT_TABLE=${ACTION_INTENT_TABLE_NAME:?ACTION_INTENT_TABLE_NAME required (e.g. from .env / CDK outputs)}
TENANT_ID=${TENANT_ID:-test-tenant-1}
ACCOUNT_ID=${ACCOUNT_ID:-test-account-1}
TRACE_ID=${TRACE_ID:-e2e-trace}

ACTION_INTENT_ID="ai_e2e_$(date +%s)_$$"
PK="TENANT#${TENANT_ID}#ACCOUNT#${ACCOUNT_ID}"
SK="ACTION_INTENT#${ACTION_INTENT_ID}"
EXPIRES_AT=$(date -u -v+7d 2>/dev/null || date -u -d '+7 days' 2>/dev/null || date -u +%Y-%m-%dT%H:%M:%SZ)
EXPIRES_EPOCH=$(date -u -v+7d +%s 2>/dev/null || date -u -d '+7 days' +%s 2>/dev/null || echo $(( $(date +%s) + 604800 )))

echo "Phase 4 E2E seed — intent $ACTION_INTENT_ID"
echo "==========================================="

# Put minimal action intent (DynamoDB AttributeValue format)
# execution-starter and downstream need: action_intent_id, action_type, target, parameters, registry_version, tenant_id, account_id, trace_id, expires_at_epoch, etc.
ITEM=$(jq -cn \
  --arg pk "$PK" \
  --arg sk "$SK" \
  --arg aid "$ACTION_INTENT_ID" \
  --arg tid "$TENANT_ID" \
  --arg acid "$ACCOUNT_ID" \
  --arg trid "$TRACE_ID" \
  --arg exp "$EXPIRES_AT" \
  --argjson epoch "$EXPIRES_EPOCH" \
  '{
    pk: { S: $pk },
    sk: { S: $sk },
    action_intent_id: { S: $aid },
    action_type: { S: "CREATE_INTERNAL_TASK" },
    target: { M: {} },
    parameters: { M: { title: { S: "E2E test" }, description: { S: "Phase 4 E2E seed" } } },
    parameters_schema_version: { S: "1" },
    approved_by: { S: "e2e-script" },
    approval_timestamp: { S: (now | strftime("%Y-%m-%dT%H:%M:%SZ")) },
    execution_policy: { M: { retry_count: { N: "3" }, timeout_seconds: { N: "300" }, max_attempts: { N: "1" } } },
    expires_at: { S: $exp },
    expires_at_epoch: { N: ($epoch | tostring) },
    original_decision_id: { S: "e2e-decision" },
    original_proposal_id: { S: "e2e-decision" },
    edited_fields: { L: [] },
    tenant_id: { S: $tid },
    account_id: { S: $acid },
    trace_id: { S: $trid },
    registry_version: { N: "1" }
  }')

aws dynamodb put-item \
  --region "$REGION" \
  --table-name "$INTENT_TABLE" \
  --item "$ITEM" \
  --no-cli-pager

echo "1. ActionIntent written to $INTENT_TABLE"

# Put ACTION_APPROVED to EventBridge (production path: rule starts Step Functions)
DETAIL=$(jq -cn \
  --arg aid "$ACTION_INTENT_ID" \
  --arg tid "$TENANT_ID" \
  --arg acid "$ACCOUNT_ID" \
  '{ data: { action_intent_id: $aid, tenant_id: $tid, account_id: $acid } }')
ENTRIES=$(jq -cn \
  --arg detail "$DETAIL" \
  --arg bus "$EVENT_BUS" \
  '[{ Source: "cc-native", DetailType: "ACTION_APPROVED", Detail: $detail, EventBusName: $bus }]')
aws events put-events \
  --region "$REGION" \
  --entries "$ENTRIES" \
  --no-cli-pager

echo "2. ACTION_APPROVED put to EventBus $EVENT_BUS"
echo ""
echo "ACTION_INTENT_ID=$ACTION_INTENT_ID"
