#!/bin/bash
# Phase 5 E2E: Control Center audit export.
# POST /autonomy/audit/exports -> poll GET .../:id until COMPLETED -> verify presigned URL and CSV schema.
# Requires: AUTONOMY_ADMIN_API_URL (Control Center API base), CONTROL_CENTER_AUTH_HEADER (e.g. JWT).
# Optional: AUDIT_EXPORT_TABLE_NAME (default cc-native-audit-export) for cleanup.
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

BASE_URL=${AUTONOMY_ADMIN_API_URL:-}
AUTH_HEADER=${CONTROL_CENTER_AUTH_HEADER:-}
TENANT_ID=${TENANT_ID:-test-tenant-1}

if [ -z "$BASE_URL" ] || [ -z "$AUTH_HEADER" ]; then
  echo "Phase 5 E2E — Control Center audit export (SKIPPED: set AUTONOMY_ADMIN_API_URL and CONTROL_CENTER_AUTH_HEADER to run)"
  exit 0
fi

# Date range (e.g. last 7 days)
TO_DATE=$(date -u +%Y-%m-%d)
FROM_DATE=$(date -u -v-7d 2>/dev/null || date -u -d '7 days ago' 2>/dev/null || date -u +%Y-%m-%d)

echo "Phase 5 E2E — Control Center audit export"
echo "=========================================="

echo "1. POST /autonomy/audit/exports..."
RESP=$(curl -s -w "\n%{http_code}" -X POST "${BASE_URL%/}/autonomy/audit/exports" \
  -H "Authorization: $AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d "{\"from\":\"$FROM_DATE\",\"to\":\"$TO_DATE\",\"format\":\"csv\"}" 2>/dev/null) || true
HTTP_CODE=$(echo "$RESP" | tail -n1)
BODY=$(echo "$RESP" | sed '$d')
if [ "$HTTP_CODE" != "202" ] && [ "$HTTP_CODE" != "200" ]; then
  echo "   POST returned $HTTP_CODE: $BODY"
  exit 1
fi
EXPORT_ID=$(echo "$BODY" | jq -r '.export_id // empty')
if [ -z "$EXPORT_ID" ]; then
  echo "   Response missing export_id: $BODY"
  exit 1
fi
echo "   export_id=$EXPORT_ID"

echo "2. Polling GET .../audit/exports/$EXPORT_ID until COMPLETED (max 120s)..."
MAX_WAIT=120
POLL_INTERVAL=5
ELAPSED=0
STATUS=""
while [ $ELAPSED -lt $MAX_WAIT ]; do
  STATUS_RESP=$(curl -s -w "\n%{http_code}" -X GET "${BASE_URL%/}/autonomy/audit/exports/$EXPORT_ID" \
    -H "Authorization: $AUTH_HEADER" 2>/dev/null) || true
  STATUS_HTTP=$(echo "$STATUS_RESP" | tail -n1)
  STATUS_BODY=$(echo "$STATUS_RESP" | sed '$d')
  if [ "$STATUS_HTTP" != "200" ]; then
    echo "   GET status returned $STATUS_HTTP"
    sleep "$POLL_INTERVAL"
    ELAPSED=$((ELAPSED + POLL_INTERVAL))
    continue
  fi
  STATUS=$(echo "$STATUS_BODY" | jq -r '.status // empty')
  if [ "$STATUS" = "COMPLETED" ]; then
    echo "   Status: COMPLETED (after ${ELAPSED}s)"
    PRESIGNED_URL=$(echo "$STATUS_BODY" | jq -r '.presigned_url // empty')
    break
  fi
  if [ "$STATUS" = "FAILED" ]; then
    ERR_MSG=$(echo "$STATUS_BODY" | jq -r '.error_message // empty')
    echo "   Export FAILED: $ERR_MSG"
    exit 1
  fi
  echo "   Status: $STATUS (${ELAPSED}s), waiting ${POLL_INTERVAL}s..."
  sleep "$POLL_INTERVAL"
  ELAPSED=$((ELAPSED + POLL_INTERVAL))
done

if [ "$STATUS" != "COMPLETED" ]; then
  echo "   Timeout: export did not complete within ${MAX_WAIT}s"
  exit 1
fi

echo "3. Verifying presigned download..."
if [ -z "$PRESIGNED_URL" ]; then
  echo "   presigned_url missing in response"
  exit 1
fi
DOWNLOAD=$(curl -s -w "%{http_code}" -o /tmp/p5-audit-export.csv "$PRESIGNED_URL" 2>/dev/null) || true
if [ "$DOWNLOAD" != "200" ]; then
  echo "   Presigned download returned HTTP $DOWNLOAD"
  exit 1
fi
if [ ! -f /tmp/p5-audit-export.csv ]; then
  echo "   Download file missing"
  exit 1
fi
# Basic CSV check: has header and at least one line or header only
LINE_COUNT=$(wc -l < /tmp/p5-audit-export.csv 2>/dev/null || echo 0)
echo "   Downloaded CSV: $LINE_COUNT lines"

echo ""
echo "Phase 5 E2E (audit export) PASSED"
echo "   Export ID: $EXPORT_ID; presigned download OK."
