#!/bin/bash
# Phase 5 E2E: policy/budget fallback path.
# Seed intent + autonomy config with budget exhausted -> invoke gate -> expect REQUIRE_APPROVAL (BUDGET_EXCEEDED) -> no execution attempt.
# Requires: .env with ACTION_INTENT_TABLE_NAME, AUTONOMY_CONFIG_TABLE_NAME, AUTONOMY_BUDGET_STATE_TABLE_NAME, EXECUTION_ATTEMPTS_TABLE_NAME, AUTO_APPROVAL_GATE_FUNCTION_NAME (or default).
# See scripts/phase_5/README.md.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
# E2E uses .env only (populated by deploy from stack outputs). .env.local is for deploy inputs only.
ENV_FILE="$PROJECT_ROOT/.env"
if [ -f "$ENV_FILE" ]; then
  set -a
  source "$ENV_FILE"
  set +a
fi

REGION=${AWS_REGION:?}
TENANT_ID=${TENANT_ID:-test-tenant-1}
ACCOUNT_ID=${ACCOUNT_ID:-test-account-1}
ATTEMPTS_TABLE=${EXECUTION_ATTEMPTS_TABLE:-${EXECUTION_ATTEMPTS_TABLE_NAME:?}}
GATE_FN=${AUTO_APPROVAL_GATE_FUNCTION_NAME:-cc-native-auto-approval-gate}
PK="TENANT#${TENANT_ID}#ACCOUNT#${ACCOUNT_ID}"
ATTEMPT_SK_PREFIX=${ATTEMPT_SK_PREFIX:-EXECUTION#}

echo "Phase 5 E2E — policy/budget fallback path"
echo "=========================================="

# 1. Seed (budget exhausted)
ACTION_INTENT_ID=${ACTION_INTENT_ID:-}
if [ -z "$ACTION_INTENT_ID" ]; then
  echo "1. Seeding intent and autonomy config (budget exhausted)..."
  SEED_OUTPUT=$("$SCRIPT_DIR/seed-phase5-fallback.sh")
  ACTION_INTENT_ID=$(echo "$SEED_OUTPUT" | grep '^ACTION_INTENT_ID=' | cut -d= -f2-)
  if [ -z "$ACTION_INTENT_ID" ]; then
    echo "   Seed did not output ACTION_INTENT_ID"
    exit 1
  fi
  echo "   ACTION_INTENT_ID=$ACTION_INTENT_ID"
else
  echo "1. Using ACTION_INTENT_ID=$ACTION_INTENT_ID"
fi

SK_ATTEMPT="${ATTEMPT_SK_PREFIX}${ACTION_INTENT_ID}"

# 2. Invoke gate
echo "2. Invoking auto-approval gate..."
PAYLOAD=$(jq -cn --arg aid "$ACTION_INTENT_ID" --arg tid "$TENANT_ID" --arg acid "$ACCOUNT_ID" '{ action_intent_id: $aid, tenant_id: $tid, account_id: $acid }')
aws lambda invoke --region "$REGION" --function-name "$GATE_FN" --payload "$PAYLOAD" --cli-binary-format raw-in-base64-out /tmp/p5-fallback-out.json --no-cli-pager 2>/dev/null || true
if [ -f /tmp/p5-fallback-out.json ]; then
  GATE_RESULT=$(jq -r '.result // empty' /tmp/p5-fallback-out.json 2>/dev/null)
  REASON=$(jq -r '.reason // empty' /tmp/p5-fallback-out.json 2>/dev/null)
  if [ "$GATE_RESULT" != "REQUIRE_APPROVAL" ]; then
    echo "   Gate result: $GATE_RESULT (expected REQUIRE_APPROVAL). Reason: $REASON"
    exit 1
  fi
  echo "   Gate returned REQUIRE_APPROVAL (reason=$REASON)"
else
  echo "   Lambda invoke failed"
  exit 1
fi

# 3. Verify no execution attempt created
echo "3. Verifying no execution attempt created..."
sleep 5
ATTEMPT=$(aws dynamodb get-item --region "$REGION" --table-name "$ATTEMPTS_TABLE" \
  --key "{\"pk\":{\"S\":\"$PK\"},\"sk\":{\"S\":\"$SK_ATTEMPT\"}}" --no-cli-pager 2>/dev/null || true)
if [ -n "$ATTEMPT" ] && echo "$ATTEMPT" | jq -e '.Item' >/dev/null 2>&1; then
  echo "   Unexpected ExecutionAttempt found (expected none)"
  exit 1
fi
echo "   No attempt record (expected)."

echo ""
echo "Phase 5 E2E (fallback) PASSED"

# 4. Cleanup
echo "4. Cleaning up E2E seed data..."
INTENT_TABLE=${ACTION_INTENT_TABLE_NAME:-}
AUTONOMY_TABLE=${AUTONOMY_CONFIG_TABLE_NAME:-}
BUDGET_TABLE=${AUTONOMY_BUDGET_STATE_TABLE_NAME:-}
if [ -n "$INTENT_TABLE" ]; then
  aws dynamodb delete-item --region "$REGION" --table-name "$INTENT_TABLE" \
    --key "{\"pk\":{\"S\":\"$PK\"},\"sk\":{\"S\":\"ACTION_INTENT#${ACTION_INTENT_ID}\"}}" --no-cli-pager 2>/dev/null || true
fi
if [ -n "$AUTONOMY_TABLE" ]; then
  aws dynamodb delete-item --region "$REGION" --table-name "$AUTONOMY_TABLE" --key "{\"pk\":{\"S\":\"$PK\"},\"sk\":{\"S\":\"ALLOWLIST#AUTO_EXEC\"}}" --no-cli-pager 2>/dev/null || true
  aws dynamodb delete-item --region "$REGION" --table-name "$AUTONOMY_TABLE" --key "{\"pk\":{\"S\":\"$PK\"},\"sk\":{\"S\":\"AUTONOMY#CREATE_INTERNAL_TASK\"}}" --no-cli-pager 2>/dev/null || true
fi
if [ -n "$BUDGET_TABLE" ]; then
  aws dynamodb delete-item --region "$REGION" --table-name "$BUDGET_TABLE" --key "{\"pk\":{\"S\":\"$PK\"},\"sk\":{\"S\":\"BUDGET#CONFIG\"}}" --no-cli-pager 2>/dev/null || true
fi
echo "   E2E seed data cleaned up."
