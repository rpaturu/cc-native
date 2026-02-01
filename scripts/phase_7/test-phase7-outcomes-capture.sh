#!/bin/bash
# Phase 7 E2E: Outcomes capture — requires OUTCOMES_TABLE_NAME (set by deploy into .env).
# Verifies the Outcomes table exists and is accessible; does not skip.
# See scripts/phase_7/README.md; PHASE_7_E2E_TEST_PLAN.md.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENV_FILE="$PROJECT_ROOT/.env"
if [ -f "$ENV_FILE" ]; then
  set -a
  source "$ENV_FILE"
  set +a
fi

OUTCOMES_TABLE=${OUTCOMES_TABLE_NAME:-}
AWS_REGION=${AWS_REGION:-us-east-1}
AWS_PROFILE=${AWS_PROFILE:-}

echo "Phase 7 E2E — Outcomes capture"
echo "==============================="

if [ -z "$OUTCOMES_TABLE" ]; then
  echo "ERROR: OUTCOMES_TABLE_NAME is not set. Run deploy to populate .env (extracts ExecutionOutcomesTableName as OUTCOMES_TABLE_NAME)."
  exit 1
fi

echo "Verifying Outcomes table: $OUTCOMES_TABLE"
if [ -n "$AWS_PROFILE" ]; then
  aws dynamodb describe-table --table-name "$OUTCOMES_TABLE" --region "$AWS_REGION" --profile "$AWS_PROFILE" --no-cli-pager --query 'Table.TableName' --output text
else
  aws dynamodb describe-table --table-name "$OUTCOMES_TABLE" --region "$AWS_REGION" --no-cli-pager --query 'Table.TableName' --output text
fi
echo "Phase 7 E2E (Outcomes capture): table verified."
exit 0
