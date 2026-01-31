#!/bin/bash
#
# Deletes CCNativeStack resources that were retained (DELETE_SKIPPED) after
# ./destroy. By default queries CloudFormation stack resource view (list-stack-
# resources) for DELETE_SKIPPED resources; falls back to a hardcoded list if
# the stack is not found (e.g. deleted >90 days ago).
#
# Usage: ./scripts/delete-retained-resources.sh [--profile PROFILE] [--region REGION] [--force]
#        ./scripts/delete-retained-resources.sh --no-query-stack   use hardcoded list only
#

set -e

if [ -f .env.local ]; then
  source .env.local
fi

PROFILE=${ADMIN_PROFILE:-${AWS_PROFILE:-default}}
REGION=${AWS_REGION:-us-west-2}
FORCE=""
QUERY_STACK=1

while [[ "$#" -gt 0 ]]; do
  case $1 in
    --profile) PROFILE="$2"; shift ;;
    --region)  REGION="$2"; shift ;;
    --force)   FORCE=1 ;;
    --no-query-stack) QUERY_STACK=0 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
  shift
done

# Resolve account (required for bucket names and stack discovery)
if [ -n "$AWS_ACCOUNT_ID" ]; then
  ACCOUNT="$AWS_ACCOUNT_ID"
else
  ACCOUNT=$(aws sts get-caller-identity --profile "$PROFILE" --query Account --output text --no-cli-pager)
fi

# Discover DELETE_SKIPPED from stack resource view (list-stack-resources).
# Use root stack "CCNativeStack" only; pick most recent by CreationTime (multiple DELETE_COMPLETE can exist).
STACK_ID=""
if [ "$QUERY_STACK" -eq 1 ]; then
  STACK_ID=$(aws cloudformation list-stacks --profile "$PROFILE" --region "$REGION" --no-cli-pager \
    --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE UPDATE_ROLLBACK_COMPLETE DELETE_COMPLETE \
    --query "sort_by(StackSummaries[?StackName=='CCNativeStack'], &CreationTime) | [-1].StackId" --output text 2>/dev/null)
  [ -z "$STACK_ID" ] || [ "$STACK_ID" = "None" ] && STACK_ID=""
fi

BUCKETS=()
TABLES=()
LOG_GROUPS=()
KMS_KEYS=()
USER_POOLS=()
FROM_STACK=""

if [ -n "$STACK_ID" ]; then
  echo "Querying stack resource view for DELETE_SKIPPED resources..."
  # Output: one line per resource, "ResourceType\tPhysicalResourceId"
  RES_TXT=$(aws cloudformation list-stack-resources --stack-name "$STACK_ID" --profile "$PROFILE" \
    --region "$REGION" --no-cli-pager \
    --query "StackResourceSummaries[?ResourceStatus=='DELETE_SKIPPED'].[ResourceType,PhysicalResourceId]" \
    --output text 2>/dev/null) || RES_TXT=""
  if [ -n "$RES_TXT" ]; then
    while IFS= read -r line; do
      [ -z "$line" ] && continue
      rtype=$(echo "$line" | awk '{print $1}')
      phys=$(echo "$line" | awk '{$1=""; print $0}' | sed 's/^ *//')
      [ -z "$phys" ] && continue
      [ "$phys" = "None" ] && continue
      if [ "$rtype" = "AWS::DynamoDB::Table" ]; then
        tname="${phys##*table/}"
        [ -z "$tname" ] && tname="$phys"
        [ -n "$tname" ] && TABLES+=("$tname")
      fi
      if [ "$rtype" = "AWS::S3::Bucket" ]; then
        if [[ "$phys" != arn:* ]]; then
          BUCKETS+=("$phys")
        else
          bname="${phys#*:::}"
          bname="${bname%%/*}"
          [ -n "$bname" ] && BUCKETS+=("$bname")
        fi
      fi
      if [ "$rtype" = "AWS::Logs::LogGroup" ]; then
        [ -n "$phys" ] && LOG_GROUPS+=("$phys")
      fi
      if [ "$rtype" = "AWS::KMS::Key" ]; then
        [ -n "$phys" ] && KMS_KEYS+=("$phys")
      fi
      if [ "$rtype" = "AWS::Cognito::UserPool" ]; then
        [ -n "$phys" ] && USER_POOLS+=("$phys")
      fi
    done < <(echo "$RES_TXT")
    if [ ${#TABLES[@]} -gt 0 ] || [ ${#BUCKETS[@]} -gt 0 ] || [ ${#LOG_GROUPS[@]} -gt 0 ] || [ ${#KMS_KEYS[@]} -gt 0 ] || [ ${#USER_POOLS[@]} -gt 0 ]; then
      FROM_STACK=1
      echo "Found from resource view: ${#BUCKETS[@]} bucket(s), ${#TABLES[@]} table(s), ${#LOG_GROUPS[@]} log group(s), ${#KMS_KEYS[@]} KMS key(s), ${#USER_POOLS[@]} user pool(s) (DELETE_SKIPPED)."
    fi
  fi
fi

# Fallback: hardcoded lists when stack not found or no DELETE_SKIPPED (e.g. deleted >90 days ago)
if [ -z "$FROM_STACK" ]; then
  echo "Using hardcoded resource list (stack not found or no DELETE_SKIPPED in resource view). Use --no-query-stack to skip query."
  BUCKETS=(
    "cc-native-evidence-ledger-${ACCOUNT}-${REGION}"
    "cc-native-world-state-snapshots-${ACCOUNT}-${REGION}"
    "cc-native-schema-registry-${ACCOUNT}-${REGION}"
    "cc-native-artifacts-${ACCOUNT}-${REGION}"
    "cc-native-ledger-archives-${ACCOUNT}-${REGION}"
  )
  TABLES=(
    "cc-native-account-posture-state"
    "cc-native-accounts"
    "cc-native-action-intent"
    "cc-native-action-queue"
    "cc-native-action-type-registry"
    "cc-native-approval-requests"
    "cc-native-assessment"
    "cc-native-audit-export"
    "cc-native-autonomy-budget-state"
    "cc-native-autonomy-config"
    "cc-native-cache"
    "cc-native-connector-config"
    "cc-native-critical-field-registry"
    "cc-native-decision-budget"
    "cc-native-decision-idempotency-store"
    "cc-native-decision-proposal"
    "cc-native-decision-run-state"
    "cc-native-evidence-index"
    "cc-native-execution-attempts"
    "cc-native-execution-outcomes"
    "cc-native-external-write-dedupe"
    "cc-native-graph-materialization-status"
    "cc-native-identities"
    "cc-native-internal-notes"
    "cc-native-internal-tasks"
    "cc-native-ledger"
    "cc-native-methodology"
    "cc-native-perception-scheduler"
    "cc-native-policy-config"
    "cc-native-pull-idempotency-store"
    "cc-native-resilience"
    "cc-native-schema-registry"
    "cc-native-signals"
    "cc-native-snapshots-index"
    "cc-native-tenants"
    "cc-native-tool-runs"
    "cc-native-world-state"
  )
fi

echo "Profile: $PROFILE"
echo "Region:  $REGION"
echo "Account: $ACCOUNT"
echo ""
echo "S3 buckets to delete:"
for b in "${BUCKETS[@]}"; do echo "  - $b"; done
echo ""
echo "DynamoDB tables to delete:"
for t in "${TABLES[@]}"; do echo "  - $t"; done
if [ ${#LOG_GROUPS[@]} -gt 0 ]; then
  echo ""
  echo "Log groups to delete:"
  for lg in "${LOG_GROUPS[@]}"; do echo "  - $lg"; done
fi
if [ ${#KMS_KEYS[@]} -gt 0 ]; then
  echo ""
  echo "KMS keys to schedule for deletion (7-day pending):"
  for k in "${KMS_KEYS[@]}"; do echo "  - $k"; done
fi
if [ ${#USER_POOLS[@]} -gt 0 ]; then
  echo ""
  echo "Cognito user pools to delete:"
  for up in "${USER_POOLS[@]}"; do echo "  - $up"; done
fi
echo ""

if [ -z "$FORCE" ]; then
  read -p "Delete these retained resources? (type 'yes' to confirm): " confirm
  if [ "$confirm" != "yes" ]; then
    echo "Aborted."
    exit 0
  fi
fi

FAILED=0

# Timeouts so we never hang (seconds)
LIST_VERSIONS_TIMEOUT=20
DELETE_OBJECTS_TIMEOUT=60
S3_RB_TIMEOUT=30

# Run a command with a timeout; output to stdout. Returns 124 on timeout.
run_with_timeout() {
  local timeout_sec="$1"
  shift
  "$@" &
  local pid=$!
  local count=0
  while [ $count -lt "$timeout_sec" ]; do
    kill -0 "$pid" 2>/dev/null || break
    sleep 1
    count=$((count + 1))
  done
  if kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null
    sleep 1
    kill -9 "$pid" 2>/dev/null
    wait "$pid" 2>/dev/null
    return 124
  fi
  wait "$pid" 2>/dev/null
  return $?
}

# Empty all object versions and delete markers (one page per round, --no-paginate so we don't hang).
# Commands run (for manual debugging):
#   List:  aws s3api list-object-versions --bucket BUCKET --profile PROFILE --region REGION --max-keys 1000 --no-paginate --no-cli-pager --query 'Versions[].{Key:Key,VersionId:VersionId}' --output json
#   List:  aws s3api list-object-versions --bucket BUCKET --profile PROFILE --region REGION --max-keys 1000 --no-paginate --no-cli-pager --query 'DeleteMarkers[].{Key:Key,VersionId:VersionId}' --output json
#   Delete: aws s3api delete-objects --bucket BUCKET --profile PROFILE --region REGION --no-cli-pager --delete '{"Objects":[...],"Quiet":true}'
empty_bucket_versions_then_delete() {
  local bucket="$1"
  local profile="$2"
  local region="${REGION:-us-west-2}"
  local round=0
  echo "  Emptying bucket (list + delete per round, ${LIST_VERSIONS_TIMEOUT}s timeout, CLI read 15s)..."
  while [ "$round" -lt 200 ]; do
    round=$((round + 1))
    local vers dms
    echo "  Round $round: listing versions..."
    vers=$(run_with_timeout "$LIST_VERSIONS_TIMEOUT" aws s3api list-object-versions \
      --bucket "$bucket" --profile "$profile" --region "$region" \
      --max-keys 1000 --no-paginate --no-cli-pager \
      --cli-read-timeout 15 --cli-connect-timeout 5 \
      --query 'Versions[].{Key:Key,VersionId:VersionId}' --output json 2>/dev/null)
    local rc_vers=$?
    [ $rc_vers -eq 124 ] && echo "  Timed out listing versions. Empty the bucket in the AWS Console (Show versions, delete all), then re-run." && return 1
    [ -z "$vers" ] && vers="[]"
    echo "  Round $round: listing delete markers..."
    dms=$(run_with_timeout "$LIST_VERSIONS_TIMEOUT" aws s3api list-object-versions \
      --bucket "$bucket" --profile "$profile" --region "$region" \
      --max-keys 1000 --no-paginate --no-cli-pager \
      --cli-read-timeout 15 --cli-connect-timeout 5 \
      --query 'DeleteMarkers[].{Key:Key,VersionId:VersionId}' --output json 2>/dev/null)
    local rc_dms=$?
    [ $rc_dms -eq 124 ] && echo "  Timed out listing delete markers. Empty the bucket in the AWS Console (Show versions, delete all), then re-run." && return 1
    [ -z "$dms" ] && dms="[]"
    vers="${vers//[$'\r\n']/}"
    dms="${dms//[$'\r\n']/}"
    [ -z "$vers" ] && vers="[]"
    [ "$vers" = "null" ] && vers="[]"
    [ -z "$dms" ] && dms="[]"
    [ "$dms" = "null" ] && dms="[]"
    if [ "$vers" != "[]" ] || [ "$dms" != "[]" ]; then
      if [ "$vers" != "[]" ] && [ -n "$vers" ]; then
        echo "  Round $round: deleting versions (timeout ${DELETE_OBJECTS_TIMEOUT}s)..."
        run_with_timeout "$DELETE_OBJECTS_TIMEOUT" aws s3api delete-objects --bucket "$bucket" --profile "$profile" \
          --region "$region" --no-cli-pager --delete "{\"Objects\":$vers,\"Quiet\":true}" 2>/dev/null || true
      fi
      if [ "$dms" != "[]" ] && [ -n "$dms" ]; then
        echo "  Round $round: deleting delete-markers (timeout ${DELETE_OBJECTS_TIMEOUT}s)..."
        run_with_timeout "$DELETE_OBJECTS_TIMEOUT" aws s3api delete-objects --bucket "$bucket" --profile "$profile" \
          --region "$region" --no-cli-pager --delete "{\"Objects\":$dms,\"Quiet\":true}" 2>/dev/null || true
      fi
      [ $((round % 10)) -eq 0 ] && echo "  ... round $round done"
    else
      break
    fi
  done
  echo "  Removing bucket (s3 rb --force, timeout ${S3_RB_TIMEOUT}s)..."
  aws s3 rb "s3://${bucket}" --profile "$profile" --region "$region" --force --no-cli-pager 2>&1 &
  local pid=$!
  local count=0
  while [ $count -lt $S3_RB_TIMEOUT ]; do
    kill -0 "$pid" 2>/dev/null || break
    sleep 1
    count=$((count + 1))
  done
  if kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null
    wait "$pid" 2>/dev/null
    echo "  Timed out removing bucket. Re-run this script to try again."
    return 1
  fi
  wait "$pid" 2>/dev/null
  local rc=$?
  if [ $rc -ne 0 ]; then
    echo "  Bucket delete failed. Empty in AWS Console (Show versions, delete all) then re-run."
    return 1
  fi
  return 0
}

# Delete S3 buckets (suppress head-bucket JSON)
for bucket in "${BUCKETS[@]}"; do
  if aws s3api head-bucket --bucket "$bucket" --profile "$PROFILE" --no-cli-pager >/dev/null 2>/dev/null; then
    echo "Deleting bucket: $bucket"
    if empty_bucket_versions_then_delete "$bucket" "$PROFILE"; then
      echo "  Deleted $bucket"
    else
      FAILED=1
    fi
  else
    echo "Bucket not found (skip): $bucket"
  fi
done

# Delete DynamoDB tables
for table in "${TABLES[@]}"; do
  if aws dynamodb describe-table --table-name "$table" --profile "$PROFILE" --region "$REGION" --no-cli-pager >/dev/null 2>&1; then
    echo "Deleting table: $table"
    if aws dynamodb delete-table --table-name "$table" --profile "$PROFILE" --region "$REGION" --no-cli-pager >/dev/null 2>&1; then
      echo "  Deleted $table"
    else
      echo "  FAILED to delete $table"
      FAILED=1
    fi
  else
    echo "Table not found (skip): $table"
  fi
done

# Delete CloudWatch Log Groups (from resource view only)
for lg in "${LOG_GROUPS[@]}"; do
  echo "Deleting log group: $lg"
  if aws logs delete-log-group --log-group-name "$lg" --profile "$PROFILE" --region "$REGION" --no-cli-pager 2>/dev/null; then
    echo "  Deleted $lg"
  else
    echo "  Skip or failed (may already be deleted): $lg"
  fi
done

# Schedule KMS keys for deletion (7-day minimum pending window; from resource view only)
for key_id in "${KMS_KEYS[@]}"; do
  if aws kms describe-key --key-id "$key_id" --profile "$PROFILE" --region "$REGION" --no-cli-pager >/dev/null 2>&1; then
    echo "Scheduling KMS key for deletion: $key_id"
    if aws kms schedule-key-deletion --key-id "$key_id" --pending-window-in-days 7 --profile "$PROFILE" --region "$REGION" --no-cli-pager >/dev/null 2>&1; then
      echo "  Scheduled $key_id (deletes in 7 days)"
    else
      echo "  FAILED to schedule $key_id"
      FAILED=1
    fi
  else
    echo "KMS key not found (skip): $key_id"
  fi
done

# Delete Cognito User Pools (from resource view only)
for pool_id in "${USER_POOLS[@]}"; do
  if aws cognito-idp describe-user-pool --user-pool-id "$pool_id" --profile "$PROFILE" --region "$REGION" --no-cli-pager >/dev/null 2>&1; then
    echo "Deleting user pool: $pool_id"
    if aws cognito-idp delete-user-pool --user-pool-id "$pool_id" --profile "$PROFILE" --region "$REGION" --no-cli-pager 2>/dev/null; then
      echo "  Deleted $pool_id"
    else
      echo "  FAILED to delete $pool_id"
      FAILED=1
    fi
  else
    echo "User pool not found (skip): $pool_id"
  fi
done

if [ $FAILED -eq 0 ]; then
  echo ""
  echo "Done. You can run ./deploy for a clean deploy."
else
  echo ""
  echo "Some resources could not be deleted. Check output above."
  exit 1
fi
