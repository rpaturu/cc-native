#!/bin/bash
# Phase 5 E2E: auto-execute happy path.
# Seed intent + autonomy config -> invoke gate -> expect AUTO_EXECUTED -> wait for Phase 4 execution -> verify outcome approval_source=POLICY, auto_executed=true.
# Requires: .env with ACTION_INTENT_TABLE_NAME, AUTONOMY_CONFIG_TABLE_NAME, AUTONOMY_BUDGET_STATE_TABLE_NAME, EVENT_BUS_NAME, EXECUTION_ATTEMPTS_TABLE_NAME, EXECUTION_OUTCOMES_TABLE_NAME, AUTO_APPROVAL_GATE_FUNCTION_NAME (or default cc-native-auto-approval-gate).
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

REGION=${AWS_REGION:?Set AWS_REGION}
TENANT_ID=${TENANT_ID:-test-tenant-1}
ACCOUNT_ID=${ACCOUNT_ID:-test-account-1}
ATTEMPTS_TABLE=${EXECUTION_ATTEMPTS_TABLE:-${EXECUTION_ATTEMPTS_TABLE_NAME:?}}
OUTCOMES_TABLE=${EXECUTION_OUTCOMES_TABLE:-${EXECUTION_OUTCOMES_TABLE_NAME:?}}
GATE_FN=${AUTO_APPROVAL_GATE_FUNCTION_NAME:-cc-native-auto-approval-gate}
PK="TENANT#${TENANT_ID}#ACCOUNT#${ACCOUNT_ID}"
ATTEMPT_SK_PREFIX=${ATTEMPT_SK_PREFIX:-EXECUTION#}
OUTCOME_SK_PREFIX=${OUTCOME_SK_PREFIX:-OUTCOME#}

echo "Phase 5 E2E — auto-execute happy path"
echo "====================================="

# 1. Seed
ACTION_INTENT_ID=${ACTION_INTENT_ID:-}
if [ -z "$ACTION_INTENT_ID" ]; then
  echo "1. Seeding action intent and autonomy config..."
  SEED_OUTPUT=$("$SCRIPT_DIR/seed-phase5-autoexec.sh")
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
SK_OUTCOME="${OUTCOME_SK_PREFIX}${ACTION_INTENT_ID}"

# 2. Invoke auto-approval gate
echo "2. Invoking auto-approval gate Lambda..."
PAYLOAD=$(jq -cn --arg aid "$ACTION_INTENT_ID" --arg tid "$TENANT_ID" --arg acid "$ACCOUNT_ID" '{ action_intent_id: $aid, tenant_id: $tid, account_id: $acid }')
INVOKE_OUT=$(aws lambda invoke --region "$REGION" --function-name "$GATE_FN" --payload "$PAYLOAD" --cli-binary-format raw-in-base64-out /tmp/p5-gate-out.json --no-cli-pager 2>&1) || true
if [ -f /tmp/p5-gate-out.json ]; then
  GATE_RESULT=$(jq -r '.result // empty' /tmp/p5-gate-out.json 2>/dev/null) || GATE_RESULT=""
  if [ "$GATE_RESULT" != "AUTO_EXECUTED" ]; then
    echo "   Gate result: $GATE_RESULT (expected AUTO_EXECUTED). Payload: $(cat /tmp/p5-gate-out.json 2>/dev/null)"
    exit 1
  fi
  echo "   Gate returned AUTO_EXECUTED"
else
  echo "   Lambda invoke failed or no response file"
  exit 1
fi

# 3. Wait for attempt/outcome (same as Phase 4)
echo "3. Waiting for Step Functions execution (poll DynamoDB, max 90s)..."
MAX_WAIT=90
POLL_INTERVAL=10
ELAPSED=0
STATUS=""
while [ $ELAPSED -lt $MAX_WAIT ]; do
  ATTEMPT=$(aws dynamodb get-item --region "$REGION" --table-name "$ATTEMPTS_TABLE" \
    --key "{\"pk\":{\"S\":\"$PK\"},\"sk\":{\"S\":\"$SK_ATTEMPT\"}}" --no-cli-pager 2>/dev/null || true)
  if [ -n "$ATTEMPT" ] && echo "$ATTEMPT" | jq -e '.Item' >/dev/null 2>&1; then
    STATUS=$(echo "$ATTEMPT" | jq -r '.Item.status.S')
    if [ "$STATUS" != "RUNNING" ] && [ -n "$STATUS" ]; then
      echo "   ExecutionAttempt status: $STATUS (after ${ELAPSED}s)"
      break
    fi
  fi
  echo "   Waiting ${POLL_INTERVAL}s..."
  sleep "$POLL_INTERVAL"
  ELAPSED=$((ELAPSED + POLL_INTERVAL))
done

if [ "$STATUS" != "SUCCEEDED" ]; then
  echo "   Expected SUCCEEDED; got $STATUS"
  exit 1
fi

# 4. Verify outcome and approval_source / auto_executed
echo "4. Verifying ActionOutcome (approval_source=POLICY, auto_executed=true)..."
OUTCOME=$(aws dynamodb get-item --region "$REGION" --table-name "$OUTCOMES_TABLE" \
  --key "{\"pk\":{\"S\":\"$PK\"},\"sk\":{\"S\":\"$SK_OUTCOME\"}}" --no-cli-pager 2>/dev/null || true)
if [ -z "$OUTCOME" ] || ! echo "$OUTCOME" | jq -e '.Item' >/dev/null 2>&1; then
  echo "   ActionOutcome not found"
  exit 1
fi
OUT_STATUS=$(echo "$OUTCOME" | jq -r '.Item.status.S')
APPROVAL_SRC=$(echo "$OUTCOME" | jq -r '.Item.approval_source.S // empty')
AUTO_EXEC=$(echo "$OUTCOME" | jq -r '.Item.auto_executed.BOOL // empty')
if [ "$OUT_STATUS" != "SUCCEEDED" ]; then
  echo "   Outcome status expected SUCCEEDED; got $OUT_STATUS"
  exit 1
fi
if [ "$APPROVAL_SRC" != "POLICY" ]; then
  echo "   approval_source expected POLICY; got $APPROVAL_SRC"
  exit 1
fi
if [ "$AUTO_EXEC" != "true" ]; then
  echo "   auto_executed expected true; got $AUTO_EXEC"
  exit 1
fi
echo "   Outcome: status=$OUT_STATUS, approval_source=$APPROVAL_SRC, auto_executed=$AUTO_EXEC"

echo ""
echo "Phase 5 E2E (auto-exec) PASSED"

# 5. Cleanup
echo "5. Cleaning up E2E seed data..."
INTENT_TABLE=${ACTION_INTENT_TABLE_NAME:-}
AUTONOMY_TABLE=${AUTONOMY_CONFIG_TABLE_NAME:-}
BUDGET_TABLE=${AUTONOMY_BUDGET_STATE_TABLE_NAME:-}
aws dynamodb delete-item --region "$REGION" --table-name "$ATTEMPTS_TABLE" \
  --key "{\"pk\":{\"S\":\"$PK\"},\"sk\":{\"S\":\"$SK_ATTEMPT\"}}" --no-cli-pager 2>/dev/null || true
aws dynamodb delete-item --region "$REGION" --table-name "$OUTCOMES_TABLE" \
  --key "{\"pk\":{\"S\":\"$PK\"},\"sk\":{\"S\":\"$SK_OUTCOME\"}}" --no-cli-pager 2>/dev/null || true
if [ -n "$INTENT_TABLE" ]; then
  aws dynamodb delete-item --region "$REGION" --table-name "$INTENT_TABLE" \
    --key "{\"pk\":{\"S\":\"$PK\"},\"sk\":{\"S\":\"ACTION_INTENT#${ACTION_INTENT_ID}\"}}" --no-cli-pager 2>/dev/null || true
fi
if [ -n "$AUTONOMY_TABLE" ]; then
  aws dynamodb delete-item --region "$REGION" --table-name "$AUTONOMY_TABLE" \
    --key "{\"pk\":{\"S\":\"$PK\"},\"sk\":{\"S\":\"ALLOWLIST#AUTO_EXEC\"}}" --no-cli-pager 2>/dev/null || true
  aws dynamodb delete-item --region "$REGION" --table-name "$AUTONOMY_TABLE" \
    --key "{\"pk\":{\"S\":\"$PK\"},\"sk\":{\"S\":\"AUTONOMY#CREATE_INTERNAL_TASK\"}}" --no-cli-pager 2>/dev/null || true
fi
if [ -n "$BUDGET_TABLE" ]; then
  DATE_KEY=$(date -u +%Y-%m-%d)
  aws dynamodb delete-item --region "$REGION" --table-name "$BUDGET_TABLE" \
    --key "{\"pk\":{\"S\":\"$PK\"},\"sk\":{\"S\":\"BUDGET#CONFIG\"}}" --no-cli-pager 2>/dev/null || true
  aws dynamodb delete-item --region "$REGION" --table-name "$BUDGET_TABLE" \
    --key "{\"pk\":{\"S\":\"$PK\"},\"sk\":{\"S\":\"BUDGET_STATE#${DATE_KEY}\"}}" --no-cli-pager 2>/dev/null || true
fi
echo "   E2E seed data cleaned up."
