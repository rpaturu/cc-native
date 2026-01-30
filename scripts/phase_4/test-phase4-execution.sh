#!/bin/bash
# Phase 4 E2E: one deterministic path (seed -> EventBridge -> execution -> outcome).
# Follows production: seed puts ACTION_APPROVED to EventBridge; rule starts Step Functions. We discover the
# execution via list-executions + describe-execution (match input.action_intent_id), then track with describe-execution until SUCCEEDED/FAILED.
# Requires (fail fast): AWS_REGION, table names (EXECUTION_ATTEMPTS_TABLE or EXECUTION_ATTEMPTS_TABLE_NAME, same for OUTCOMES); for seed also EVENT_BUS_NAME, ACTION_INTENT_TABLE_NAME. jq.
# Optional: EXECUTION_STATUS_API_URL + EXECUTION_STATUS_API_AUTH_HEADER (JWT) to verify Status API; SIGNALS_TABLE_NAME to verify signal emission; EXECUTION_STATE_MACHINE_ARN (else resolved by name).
# After a successful verify, cleans up E2E seed data (intent, attempt, outcome).
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
TENANT_ID=${TENANT_ID:-test-tenant-1}
ACCOUNT_ID=${ACCOUNT_ID:-test-account-1}

ATTEMPTS_TABLE=${EXECUTION_ATTEMPTS_TABLE:-${EXECUTION_ATTEMPTS_TABLE_NAME:?EXECUTION_ATTEMPTS_TABLE or EXECUTION_ATTEMPTS_TABLE_NAME required}}
OUTCOMES_TABLE=${EXECUTION_OUTCOMES_TABLE:-${EXECUTION_OUTCOMES_TABLE_NAME:?EXECUTION_OUTCOMES_TABLE or EXECUTION_OUTCOMES_TABLE_NAME required}}
ATTEMPT_SK_PREFIX=${ATTEMPT_SK_PREFIX:-EXECUTION#}
OUTCOME_SK_PREFIX=${OUTCOME_SK_PREFIX:-OUTCOME#}

STATUS_API_URL=${EXECUTION_STATUS_API_URL:-}
AUTH_HEADER=${EXECUTION_STATUS_API_AUTH_HEADER:-}
DECISION_API_URL=${DECISION_API_URL:-}
SIGNALS_TABLE=${SIGNALS_TABLE:-${SIGNALS_TABLE_NAME:-}}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Phase 4 E2E — deterministic path"
echo "=================================="

# Obtain ACTION_INTENT_ID: from env, or Phase 3 API, or seed script (B2)
ACTION_INTENT_ID=${ACTION_INTENT_ID:-}
if [ -z "$ACTION_INTENT_ID" ]; then
  if [ -n "$DECISION_API_URL" ] && [ -n "$AUTH_HEADER" ]; then
    echo "1. Creating and approving action intent via Phase 3 API..."
    echo "   (Implement curl calls to create decision + approve; set DECISION_API_URL and auth.)"
    echo "   For B2, set EVENT_BUS_NAME and ACTION_INTENT_TABLE_NAME and leave DECISION_API_URL unset to run seed."
    exit 1
  fi
  if [ -n "$EVENT_BUS_NAME" ] && [ -n "$ACTION_INTENT_TABLE_NAME" ]; then
    echo "1. Seeding action intent and putting ACTION_APPROVED (B2)..."
    export AWS_REGION TENANT_ID ACCOUNT_ID EVENT_BUS_NAME ACTION_INTENT_TABLE_NAME
    SEED_OUTPUT=$("$SCRIPT_DIR/seed-phase4-e2e-intent.sh")
    ACTION_INTENT_ID=$(echo "$SEED_OUTPUT" | grep '^ACTION_INTENT_ID=' | cut -d= -f2-)
    if [ -z "$ACTION_INTENT_ID" ]; then
      echo "   Seed script did not output ACTION_INTENT_ID"
      exit 1
    fi
    echo "   ACTION_INTENT_ID=$ACTION_INTENT_ID"
  else
    echo "   Set ACTION_INTENT_ID, or set EVENT_BUS_NAME and ACTION_INTENT_TABLE_NAME for B2 seed, or DECISION_API_URL + auth for B1."
    exit 1
  fi
fi

echo "   Using ACTION_INTENT_ID=$ACTION_INTENT_ID"

PK="TENANT#${TENANT_ID}#ACCOUNT#${ACCOUNT_ID}"
SK_ATTEMPT="${ATTEMPT_SK_PREFIX}${ACTION_INTENT_ID}"
SK_OUTCOME="${OUTCOME_SK_PREFIX}${ACTION_INTENT_ID}"

# Resolve state machine ARN for early SFN failure detection (optional)
STATE_MACHINE_ARN=${EXECUTION_STATE_MACHINE_ARN:-}
if [ -z "$STATE_MACHINE_ARN" ]; then
  STATE_MACHINE_ARN=$(aws stepfunctions list-state-machines --region "$REGION" --no-cli-pager \
    --query "stateMachines[?name=='cc-native-execution-orchestrator'].stateMachineArn" --output text 2>/dev/null || true)
fi

# Wait for Step Functions execution to reach a terminal state (poll DynamoDB + optionally SFN for early FAILED)
echo "2. Waiting for Step Functions execution (polling until attempt not RUNNING or SFN terminal, max 90s)..."
MAX_WAIT=90
POLL_INTERVAL=10
ELAPSED=0
STATUS=""
SFN_EXEC_ARN=""
while [ $ELAPSED -lt $MAX_WAIT ]; do
  # 1) Check DynamoDB attempt
  ATTEMPT=$(aws dynamodb get-item \
    --region "$REGION" \
    --table-name "$ATTEMPTS_TABLE" \
    --key "{\"pk\":{\"S\":\"$PK\"},\"sk\":{\"S\":\"$SK_ATTEMPT\"}}" \
    --no-cli-pager 2>/dev/null || true)
  if [ -n "$ATTEMPT" ] && echo "$ATTEMPT" | jq -e '.Item' >/dev/null 2>&1; then
    STATUS=$(echo "$ATTEMPT" | jq -r '.Item.status.S')
    if [ "$STATUS" != "RUNNING" ] && [ -n "$STATUS" ]; then
      echo "   ExecutionAttempt status: $STATUS (after ${ELAPSED}s)"
      break
    fi
  else
    STATUS=""
  fi

  # 2) Discover execution via list-executions + describe-execution (match input.action_intent_id), then track with describe-execution
  if [ -n "$STATE_MACHINE_ARN" ]; then
    if [ -z "$SFN_EXEC_ARN" ]; then
      LIST=$(aws stepfunctions list-executions --region "$REGION" --state-machine-arn "$STATE_MACHINE_ARN" \
        --max-results 10 --no-cli-pager --output json 2>/dev/null || true)
      if [ -n "$LIST" ]; then
        for EXEC_ARN in $(echo "$LIST" | jq -r '.executions[].executionArn'); do
          if [ -z "$EXEC_ARN" ] || [ "$EXEC_ARN" = "null" ]; then continue; fi
          DESC=$(aws stepfunctions describe-execution --region "$REGION" --execution-arn "$EXEC_ARN" \
            --no-cli-pager --output json 2>/dev/null || true)
          AID=$(echo "$DESC" | jq -r --arg aid "$ACTION_INTENT_ID" '.input | if type == "string" then . | fromjson else . end | .action_intent_id // empty' 2>/dev/null || true)
          if [ "$AID" = "$ACTION_INTENT_ID" ]; then
            SFN_EXEC_ARN="$EXEC_ARN"
            break
          fi
        done
      fi
    fi
    if [ -n "$SFN_EXEC_ARN" ]; then
      SFN_STATUS=$(aws stepfunctions describe-execution --region "$REGION" --execution-arn "$SFN_EXEC_ARN" \
        --no-cli-pager --query 'status' --output text 2>/dev/null || true)
      if [ "$SFN_STATUS" = "FAILED" ]; then
        CAUSE=$(aws stepfunctions describe-execution --region "$REGION" --execution-arn "$SFN_EXEC_ARN" \
          --no-cli-pager --query 'cause' --output text 2>/dev/null || true)
        echo "   Step Functions execution FAILED (after ${ELAPSED}s). Cause: $CAUSE"
        exit 1
      fi
      if [ "$SFN_STATUS" = "SUCCEEDED" ]; then
        echo "   Step Functions execution SUCCEEDED (after ${ELAPSED}s)"
        STATUS="SUCCEEDED"
        break
      fi
    fi
  fi

  if [ "$STATUS" != "RUNNING" ] && [ -n "$STATUS" ]; then
    break
  fi
  echo "   Attempt status RUNNING (${ELAPSED}s), waiting ${POLL_INTERVAL}s..."
  sleep "$POLL_INTERVAL"
  ELAPSED=$((ELAPSED + POLL_INTERVAL))
done

if [ "$STATUS" = "RUNNING" ] || [ -z "$STATUS" ]; then
  echo "   Timeout: execution still RUNNING or attempt not found after ${MAX_WAIT}s"
  exit 1
fi

if [ "$STATUS" != "SUCCEEDED" ]; then
  echo "   E2E expects SUCCEEDED; got $STATUS"
  exit 1
fi

# Ensure attempt actually succeeded (SFN can SUCCEED via RecordFailure path; then attempt status is FAILED)
ATTEMPT=$(aws dynamodb get-item --region "$REGION" --table-name "$ATTEMPTS_TABLE" \
  --key "{\"pk\":{\"S\":\"$PK\"},\"sk\":{\"S\":\"$SK_ATTEMPT\"}}" --no-cli-pager 2>/dev/null || true)
ATTEMPT_STATUS=$(echo "$ATTEMPT" | jq -r '.Item.status.S // empty')
if [ "$ATTEMPT_STATUS" = "FAILED" ]; then
  echo "   Execution took failure path (attempt status FAILED); E2E expects success path."
  exit 1
fi

# 3. Verify ExecutionAttempt (DynamoDB) — already have STATUS from wait
echo "3. Verifying ExecutionAttempt (DynamoDB)..."
echo "   ExecutionAttempt status: $STATUS"

# 4. Verify ActionOutcome (DynamoDB)
echo "4. Verifying ActionOutcome (DynamoDB)..."
OUTCOME=$(aws dynamodb get-item \
  --region "$REGION" \
  --table-name "$OUTCOMES_TABLE" \
  --key "{\"pk\":{\"S\":\"$PK\"},\"sk\":{\"S\":\"$SK_OUTCOME\"}}" \
  --no-cli-pager 2>/dev/null || true)
if [ -z "$OUTCOME" ] || ! echo "$OUTCOME" | jq -e '.Item' >/dev/null 2>&1; then
  echo "   ActionOutcome not found (table=$OUTCOMES_TABLE, sk=$SK_OUTCOME)"
  exit 1
fi
OUTCOME_STATUS=$(echo "$OUTCOME" | jq -r '.Item.status.S')
echo "   ActionOutcome status: $OUTCOME_STATUS"

# 5. Verify Execution Status API (optional; requires EXECUTION_STATUS_API_URL + auth)
if [ -n "$STATUS_API_URL" ] && [ -n "$AUTH_HEADER" ]; then
  echo "5. Verifying Execution Status API..."
  STATUS_URL="${STATUS_API_URL%/}/executions/$ACTION_INTENT_ID/status?account_id=$ACCOUNT_ID"
  RESP=$(curl -s -w "\n%{http_code}" -X GET "$STATUS_URL" -H "Authorization: $AUTH_HEADER" 2>/dev/null || true)
  HTTP_CODE=$(echo "$RESP" | tail -n1)
  BODY=$(echo "$RESP" | sed '$d')
  if [ "$HTTP_CODE" != "200" ]; then
    echo "   Execution Status API returned $HTTP_CODE: $BODY"
    exit 1
  fi
  API_STATUS=$(echo "$BODY" | jq -r '.status // empty')
  if [ "$API_STATUS" != "SUCCEEDED" ]; then
    echo "   Execution Status API status expected SUCCEEDED, got: $API_STATUS"
    exit 1
  fi
  echo "   Execution Status API: 200, status=$API_STATUS"
else
  echo "5. Skipping Execution Status API (set EXECUTION_STATUS_API_URL and EXECUTION_STATUS_API_AUTH_HEADER to verify)."
fi

# 6. Verify execution signal (optional; requires SIGNALS_TABLE_NAME in .env)
if [ -n "$SIGNALS_TABLE" ]; then
  echo "6. Verifying execution signal (signals table)..."
  SIGNAL_ID="exec-${ACTION_INTENT_ID}-${ACCOUNT_ID}-ACTION_EXECUTED"
  SIGNAL=$(aws dynamodb get-item \
    --region "$REGION" \
    --table-name "$SIGNALS_TABLE" \
    --key "{\"tenantId\":{\"S\":\"$TENANT_ID\"},\"signalId\":{\"S\":\"$SIGNAL_ID\"}}" \
    --no-cli-pager 2>/dev/null || true)
  if [ -z "$SIGNAL" ] || ! echo "$SIGNAL" | jq -e '.Item' >/dev/null 2>&1; then
    echo "   Execution signal not found (table=$SIGNALS_TABLE, signalId=$SIGNAL_ID)"
    exit 1
  fi
  echo "   Execution signal found: signalType=$(echo "$SIGNAL" | jq -r '.Item.signalType.S // empty')"
else
  echo "6. Skipping execution signal check (set SIGNALS_TABLE_NAME in .env to verify)."
fi

echo ""
echo "Phase 4 E2E (one path) PASSED"

# Clean up E2E seed data (intent, attempt, outcome) after successful verify
echo ""
echo "7. Cleaning up E2E seed data..."
PK="TENANT#${TENANT_ID}#ACCOUNT#${ACCOUNT_ID}"
SK_ATTEMPT="${ATTEMPT_SK_PREFIX}${ACTION_INTENT_ID}"
SK_OUTCOME="${OUTCOME_SK_PREFIX}${ACTION_INTENT_ID}"
INTENT_TABLE=${ACTION_INTENT_TABLE_NAME:-}
aws dynamodb delete-item --region "$REGION" --table-name "$ATTEMPTS_TABLE" \
  --key "{\"pk\":{\"S\":\"$PK\"},\"sk\":{\"S\":\"$SK_ATTEMPT\"}}" --no-cli-pager 2>/dev/null || true
aws dynamodb delete-item --region "$REGION" --table-name "$OUTCOMES_TABLE" \
  --key "{\"pk\":{\"S\":\"$PK\"},\"sk\":{\"S\":\"$SK_OUTCOME\"}}" --no-cli-pager 2>/dev/null || true
if [ -n "$INTENT_TABLE" ]; then
  SK_INTENT="ACTION_INTENT#${ACTION_INTENT_ID}"
  aws dynamodb delete-item --region "$REGION" --table-name "$INTENT_TABLE" \
    --key "{\"pk\":{\"S\":\"$PK\"},\"sk\":{\"S\":\"$SK_INTENT\"}}" --no-cli-pager 2>/dev/null || true
fi
echo "   E2E seed data cleaned up (attempt, outcome, intent if table set)."
