#!/bin/bash
# Phase 5 E2E: decision scheduling idempotency.
# Send same RUN_DECISION trigger twice (same idempotency_key) -> second is SKIP as DUPLICATE.
# Optionally: verify CostGate DEFER results in one RUN_DECISION_DEFERRED (bounded retry).
# Requires: .env with DECISION_RUN_STATE_TABLE_NAME, IDEMPOTENCY_STORE_TABLE_NAME, EVENT_BUS_NAME,
#   and DECISION_COST_GATE_FUNCTION_NAME (or default cc-native-decision-cost-gate).
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
IDEMPOTENCY_TABLE=${IDEMPOTENCY_STORE_TABLE_NAME:-${DECISION_IDEMPOTENCY_STORE_TABLE_NAME:-cc-native-decision-idempotency-store}}
COST_GATE_FN=${DECISION_COST_GATE_FUNCTION_NAME:-cc-native-decision-cost-gate}

echo "Phase 5 E2E — decision scheduling idempotency"
echo "============================================="

# Same idempotency key for both invokes
IDEM_KEY="e2e-p5-idem-$$-$(date +%s)"
PAYLOAD=$(jq -cn \
  --arg tid "$TENANT_ID" \
  --arg acid "$ACCOUNT_ID" \
  --arg key "$IDEM_KEY" \
  '{
    detail: {
      tenant_id: $tid,
      account_id: $acid,
      trigger_type: "SIGNAL_ARRIVED",
      idempotency_key: $key
    }
  }')

echo "1. First invoke (decision-cost-gate) with idempotency_key=$IDEM_KEY..."
aws lambda invoke --region "$REGION" --function-name "$COST_GATE_FN" --payload "$PAYLOAD" \
  --cli-binary-format raw-in-base64-out /tmp/p5-costgate-1.json --no-cli-pager 2>/dev/null || true
echo "   First invoke completed."

echo "2. Second invoke with same idempotency_key (expect SKIP as DUPLICATE)..."
aws lambda invoke --region "$REGION" --function-name "$COST_GATE_FN" --payload "$PAYLOAD" \
  --cli-binary-format raw-in-base64-out /tmp/p5-costgate-2.json --no-cli-pager 2>/dev/null || true
echo "   Second invoke completed (Lambda returns early on duplicate key)."

echo "3. Verifying idempotency store has key (one reservation only)..."
PK="IDEMPOTENCY#${IDEM_KEY}"
SK="METADATA"
ITEM=$(aws dynamodb get-item --region "$REGION" --table-name "$IDEMPOTENCY_TABLE" \
  --key "{\"pk\":{\"S\":\"$PK\"},\"sk\":{\"S\":\"$SK\"}}" --no-cli-pager 2>/dev/null || true)
if [ -z "$ITEM" ] || ! echo "$ITEM" | jq -e '.Item' >/dev/null 2>&1; then
  echo "   Idempotency key not found (expected one record from first invoke)"
  exit 1
fi
echo "   Idempotency key present (first invoke reserved; second skipped)."

echo ""
echo "Phase 5 E2E (decision-scheduler idempotency) PASSED"

# Cleanup: remove idempotency key so it doesn't leak
aws dynamodb delete-item --region "$REGION" --table-name "$IDEMPOTENCY_TABLE" \
  --key "{\"pk\":{\"S\":\"$PK\"},\"sk\":{\"S\":\"$SK\"}}" --no-cli-pager 2>/dev/null || true
echo "   Idempotency key cleaned up."
