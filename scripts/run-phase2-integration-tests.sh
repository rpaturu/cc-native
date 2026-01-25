#!/bin/bash
# run-phase2-integration-tests.sh
# Complete workflow for running Phase 2 integration tests:
# 1. Set up prerequisites (security group, IAM role, key pair) - optional
# 2. Launch EC2 test runner instance (or reuse existing)
# 3. Deploy code to instance via S3 (works in isolated subnets via VPC endpoint)
# 4. Run tests remotely via SSM
# 5. Conditionally teardown: only if all tests pass

set -e

PROFILE="${AWS_PROFILE:-cc-native-account}"
REGION="${AWS_REGION:-us-west-2}"

# Load .env.local if it exists (for local overrides)
if [ -f .env.local ]; then
  source .env.local
fi

# Load .env if it exists (for AWS configuration)
if [ -f .env ]; then
  source .env
fi

SKIP_PREREQUISITES="${SKIP_PREREQUISITES:-false}"
SKIP_LAUNCH="${SKIP_LAUNCH:-false}"
STOP_AFTER_SETUP="${STOP_AFTER_SETUP:-false}"  # Stop after setting up prerequisites (code deployed, ready for manual testing)
DEPLOY_CODE_ONLY="${DEPLOY_CODE_ONLY:-false}"  # Only deploy code: upload to S3 and download/extract to instance, skip prerequisites and tests
ALWAYS_TEARDOWN="${ALWAYS_TEARDOWN:-false}"  # Always tear down instance, even if tests fail (default: keep instance on failure for debugging)
# S3 deployment is the only method (works via VPC endpoint in isolated subnets)
S3_BUCKET="${S3_BUCKET:-}"  # S3 bucket for code deployment (defaults to artifacts bucket)
S3_KEY="${S3_KEY:-cc-native-test.tar.gz}"  # S3 key for code archive

# Parse command-line arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --skip-prerequisites)
      SKIP_PREREQUISITES="true"
      shift
      ;;
    --setup-prerequisites)
      SKIP_PREREQUISITES="false"
      shift
      ;;
    --skip-launch)
      SKIP_LAUNCH="true"
      shift
      ;;
    --stop-after-setup)
      STOP_AFTER_SETUP="true"
      shift
      ;;
    --deploy-code)
      DEPLOY_CODE_ONLY="true"
      SKIP_PREREQUISITES="true"
      SKIP_LAUNCH="true"
      shift
      ;;
    --always-teardown)
      ALWAYS_TEARDOWN="true"
      shift
      ;;
    --s3-bucket)
      S3_BUCKET="$2"
      shift 2
      ;;
    --s3-key)
      S3_KEY="$2"
      shift 2
      ;;
    --profile)
      PROFILE="$2"
      shift 2
      ;;
    --region)
      REGION="$2"
      shift 2
      ;;
    --help|-h)
      echo "Usage: $0 [OPTIONS]"
      echo ""
      echo "Options:"
      echo "  --skip-prerequisites    Skip prerequisites setup (use existing security group, IAM role, key pair)"
      echo "  --setup-prerequisites   Explicitly run prerequisites setup (default: runs if not skipped)"
      echo "  --skip-launch          Skip instance launch (use existing instance)"
      echo "  --stop-after-setup     Stop after setting up prerequisites (code deployed, ready for manual testing)"
      echo "  --deploy-code          Upload code to S3 and deploy to instance, skip prerequisites and tests"
      echo "  --always-teardown      Always tear down instance, even if tests fail (default: keep instance on failure for debugging)"
      echo "  --s3-bucket BUCKET     S3 bucket containing code archive (auto-detected from stack if not specified)"
      echo "  --s3-key KEY           S3 key/path to code archive (default: cc-native-test.tar.gz)"
      echo "  --profile PROFILE      AWS profile (default: cc-native-account)"
      echo "  --region REGION        AWS region (default: us-west-2)"
      echo "  --help, -h             Show this help message"
      echo ""
      echo "Environment variables:"
      echo "  SKIP_PREREQUISITES     Skip prerequisites setup (true/false)"
      echo "  SKIP_LAUNCH            Skip instance launch (true/false)"
      echo "  S3_BUCKET              S3 bucket for code deployment (auto-detected from stack if not specified)"
      echo "  S3_KEY                 S3 key/path to code archive (default: cc-native-test.tar.gz)"
      echo "  AWS_PROFILE            AWS profile name"
      echo "  AWS_REGION             AWS region"
      echo ""
      echo "Examples:"
      echo "  # Deploy from S3 (default, auto-detects bucket from stack)"
      echo "  $0"
      echo ""
      echo "  # Deploy from S3 with custom bucket and key"
      echo "  $0 --s3-bucket my-code-bucket --s3-key cc-native.tar.gz"
      echo ""
      echo "  # Skip prerequisites (already set up)"
      echo "  $0 --skip-prerequisites"
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      echo "Use --help for usage information"
      exit 1
      ;;
  esac
done

echo "=========================================="
echo "Phase 2 Integration Test Workflow"
echo "=========================================="
echo "AWS Profile: $PROFILE"
echo "AWS Region: $REGION"
echo "Skip Prerequisites: $SKIP_PREREQUISITES"
echo "Skip Launch: $SKIP_LAUNCH"
echo "Deployment Method: S3 (via VPC endpoint)"
if [ -n "$S3_BUCKET" ]; then
  echo "S3 Bucket: $S3_BUCKET"
  echo "S3 Key: $S3_KEY"
else
  echo "S3 Bucket: (will be auto-detected from CloudFormation stack)"
  echo "S3 Key: $S3_KEY"
fi
echo "Always Teardown: $ALWAYS_TEARDOWN"
echo ""

# Show workflow summary
if [ "$DEPLOY_CODE_ONLY" != "true" ] && [ "$STOP_AFTER_SETUP" != "true" ]; then
  echo "Workflow steps:"
  if [ "$SKIP_PREREQUISITES" != "true" ]; then
    echo "  1. ✅ Set up prerequisites (security group, IAM role, key pair)"
  else
    echo "  1. ⏭️  Skip prerequisites (using existing setup)"
  fi
  echo "  2. ✅ Prepare and upload code archive to S3"
  if [ "$SKIP_LAUNCH" != "true" ]; then
    echo "  3. ✅ Launch EC2 test runner instance"
  else
    echo "  3. ⏭️  Skip launch (using existing instance)"
  fi
  echo "  4. ✅ Deploy code to instance from S3"
  echo "  5. ✅ Run Phase 2 integration tests"
  if [ "$ALWAYS_TEARDOWN" = "true" ]; then
    echo "  6. ✅ Tear down instance (always, regardless of test results)"
  else
    echo "  6. ✅ Tear down instance (only if tests pass; kept on failure for debugging)"
  fi
  echo ""
fi

# Function to show manual instructions (fallback)
show_manual_instructions() {
  echo ""
  echo "=========================================="
  echo "Manual Test Execution Instructions"
  echo "=========================================="
  echo ""
  echo "1. Connect to the instance:"
  echo "   aws ssm start-session --target $TEST_RUNNER_INSTANCE_ID --profile $PROFILE --region $REGION"
  echo ""
  echo "2. On the instance, run:"
  echo "   cd ~/cc-native"
  echo "   npm test -- src/tests/integration/phase2.test.ts"
  echo ""
  echo "3. If tests pass, teardown:"
  echo "   ./scripts/manage-test-runner-instance.sh teardown"
  echo ""
}

# Step 1: Set up prerequisites
if [ "$SKIP_PREREQUISITES" != "true" ]; then
  echo "Step 1: Setting up prerequisites..."
  if ! ./scripts/setup-test-runner-prerequisites.sh; then
    echo "❌ Failed to set up prerequisites"
    exit 1
  fi
  echo ""
else
  echo "Step 1: Skipping prerequisites (using existing setup)"
  echo ""
fi

# Step 2: Prepare code archive and upload to S3 (do this before launch so user-data can download it)
echo "Step 2: Preparing code archive..."
echo ""

# Prepare code archive and upload to S3
if [ -z "$S3_BUCKET" ]; then
  # Try to get artifacts bucket from .env or CloudFormation
  if [ -f .env ] && grep -q "ARTIFACTS_BUCKET" .env; then
    S3_BUCKET=$(grep "ARTIFACTS_BUCKET" .env | cut -d'=' -f2 | tr -d '"' | tr -d "'")
  else
    # Query CloudFormation for artifacts bucket
    S3_BUCKET=$(aws cloudformation describe-stacks \
      --stack-name CCNativeStack \
      --query "Stacks[0].Outputs[?OutputKey=='ArtifactsBucketName'].OutputValue" \
      --output text \
      --profile $PROFILE \
      --region $REGION \
      --no-cli-pager 2>/dev/null || echo "")
  fi
  
  if [ -z "$S3_BUCKET" ] || [ "$S3_BUCKET" = "None" ]; then
    echo "❌ Error: S3_BUCKET not specified and could not be determined from stack"
    echo "   Please set S3_BUCKET environment variable or use --s3-bucket option"
    exit 1
  fi
fi

echo "Preparing code archive for S3 deployment..."
echo "S3 Bucket: $S3_BUCKET"
echo "S3 Key: $S3_KEY"

# Create temporary directory for archive
TEMP_DIR=$(mktemp -d)
ARCHIVE_FILE="$TEMP_DIR/cc-native.tar.gz"

# Create archive (include node_modules since instance has no internet access)
# Exclude .git, .env files, build artifacts, but INCLUDE node_modules
# Exclude .vscode directories in node_modules (can cause permission issues)
echo "Creating archive (including node_modules for offline installation)..."
# Create archive, excluding macOS extended attributes if possible
# Note: --exclude patterns need to match the full path from the archive root
# ._* files are macOS resource fork files (AppleDouble) that store extended attributes
TAR_EXCLUDE_ARGS=(
  --exclude='.git'
  --exclude='.env*'
  --exclude='cdk.out'
  --exclude='*.log'
  --exclude='.DS_Store'
  --exclude='.cursor'
  --exclude='node_modules/.cache'
  --exclude='node_modules/**/.vscode'
  --exclude='**/.vscode'
  --exclude='._*'
  --exclude='**/._*'
  --exclude='.AppleDouble'
  --exclude='**/.AppleDouble'
)

# Add --no-xattrs and --disable-copyfile to prevent macOS extended attributes
# These prevent "Ignoring unknown extended header keyword" warnings on Linux
# Both flags are supported by macOS tar (bsdtar)
# Reference: https://aruljohn.com/blog/macos-created-tar-files-linux-errors/
TAR_EXCLUDE_ARGS+=(--no-xattrs --disable-copyfile)

# Verify node_modules exists before creating archive
if [ ! -d "node_modules" ]; then
  echo "❌ Error: node_modules directory not found locally"
  echo "   Please run 'npm install' first to create node_modules"
  exit 1
fi

echo "Creating archive (node_modules size: $(du -sh node_modules | cut -f1))..."
tar -czf "$ARCHIVE_FILE" "${TAR_EXCLUDE_ARGS[@]}" -C "$(pwd)" .

# Verify node_modules is in the archive
echo "Verifying node_modules is in archive..."
if tar -tzf "$ARCHIVE_FILE" | grep -qE "(^|\./)node_modules/"; then
  echo "✅ node_modules found in archive"
  ARCHIVE_SIZE=$(du -h "$ARCHIVE_FILE" | cut -f1)
  echo "Archive size: $ARCHIVE_SIZE"
  NODE_MODULES_COUNT=$(tar -tzf "$ARCHIVE_FILE" | grep -cE "(^|\./)node_modules/" || echo "0")
  echo "node_modules entries in archive: $NODE_MODULES_COUNT"
else
  echo "⚠️  Warning: node_modules not found in archive listing"
  echo "First 20 files in archive:"
  tar -tzf "$ARCHIVE_FILE" | head -20
fi

# Upload to S3
echo "Uploading to S3..."
if ! aws s3 cp "$ARCHIVE_FILE" "s3://$S3_BUCKET/$S3_KEY" \
  --profile $PROFILE \
  --region $REGION \
  --no-cli-pager; then
  echo "❌ Failed to upload archive to S3"
  rm -rf "$TEMP_DIR"
  exit 1
fi

# Verify upload was successful
echo "Verifying S3 upload..."

# Get local file size (cross-platform)
if [ -f "$ARCHIVE_FILE" ]; then
  LOCAL_SIZE=$(stat -f%z "$ARCHIVE_FILE" 2>/dev/null || stat -c%s "$ARCHIVE_FILE" 2>/dev/null || echo "0")
  if [ "$LOCAL_SIZE" = "0" ] || [ -z "$LOCAL_SIZE" ]; then
    echo "❌ Error: Could not determine local archive size"
    rm -rf "$TEMP_DIR"
    exit 1
  fi
else
  echo "❌ Error: Local archive file not found: $ARCHIVE_FILE"
  rm -rf "$TEMP_DIR"
  exit 1
fi

# Get S3 object size
S3_SIZE=$(aws s3 ls "s3://$S3_BUCKET/$S3_KEY" \
  --profile $PROFILE \
  --region $REGION \
  --no-cli-pager 2>/dev/null | awk '{print $3}' || echo "0")

if [ -z "$S3_SIZE" ] || [ "$S3_SIZE" = "0" ] || [ "$S3_SIZE" = "None" ]; then
  echo "❌ Error: Failed to verify S3 upload - object not found or size is 0"
  echo "   Local archive size: $LOCAL_SIZE bytes"
  echo "   S3 object size: $S3_SIZE bytes"
  rm -rf "$TEMP_DIR"
  exit 1
fi

# Compare sizes (allow small difference due to potential metadata differences)
if [ "$LOCAL_SIZE" != "$S3_SIZE" ]; then
  echo "⚠️  Warning: Size mismatch between local archive and S3 object"
  echo "   Local archive size: $LOCAL_SIZE bytes"
  echo "   S3 object size: $S3_SIZE bytes"
  if [ "$LOCAL_SIZE" -gt 0 ] && [ "$S3_SIZE" -gt 0 ] 2>/dev/null; then
    DIFF=$((LOCAL_SIZE - S3_SIZE))
    echo "   Difference: $DIFF bytes"
  fi
  # Don't fail on size mismatch - S3 may add metadata, but log it
else
  echo "✅ Size verification passed: $LOCAL_SIZE bytes"
fi

# Verify object is accessible (simple check)
if ! aws s3 ls "s3://$S3_BUCKET/$S3_KEY" \
  --profile $PROFILE \
  --region $REGION \
  --no-cli-pager >/dev/null 2>&1; then
  echo "❌ Error: S3 object is not accessible"
  echo "   Bucket: $S3_BUCKET"
  echo "   Key: $S3_KEY"
  rm -rf "$TEMP_DIR"
  exit 1
fi

echo "✅ S3 object is accessible"

# Try to get ETag for integrity check (optional - may fail due to permissions)
# Note: ETag retrieval may fail, so we make this non-fatal
S3_ETAG=$(aws s3api head-object \
  --bucket "$S3_BUCKET" \
  --key "$S3_KEY" \
  --profile $PROFILE \
  --region $REGION \
  --query "ETag" \
  --output text \
  --no-cli-pager 2>/dev/null | tr -d '"' || echo "")

if [ -z "$S3_ETAG" ]; then
  echo "⚠️  Warning: Could not retrieve ETag from S3 (using s3api head-object)"
  echo "   This may be due to permissions. Size verification passed, proceeding..."
  S3_ETAG=""
else
  echo "✅ ETag retrieved for integrity check"
  
  # Verify integrity by comparing MD5 (ETag for single-part uploads is the MD5 hash)
  if command -v md5sum >/dev/null 2>&1; then
    LOCAL_MD5=$(md5sum "$ARCHIVE_FILE" | awk '{print $1}')
  elif command -v md5 >/dev/null 2>&1; then
    LOCAL_MD5=$(md5 -q "$ARCHIVE_FILE")
  else
    LOCAL_MD5=""
  fi
  
  if [ -n "$LOCAL_MD5" ] && [ "$LOCAL_MD5" = "$S3_ETAG" ]; then
    echo "✅ Integrity verification passed: MD5 checksum matches"
  elif [ -n "$LOCAL_MD5" ]; then
    echo "⚠️  Warning: MD5 checksum mismatch"
    echo "   Local MD5: $LOCAL_MD5"
    echo "   S3 ETag: $S3_ETAG"
    echo "   (This may be normal for multi-part uploads, size verification passed)"
  else
    echo "ℹ️  MD5 checksum verification skipped (md5/md5sum not available)"
  fi
fi

# Format size for human readability
if command -v numfmt >/dev/null 2>&1; then
  HUMAN_SIZE=$(numfmt --to=iec-i --suffix=B $S3_SIZE 2>/dev/null || echo "$S3_SIZE bytes")
else
  # Fallback: convert bytes to KB/MB/GB manually
  if [ $S3_SIZE -ge 1073741824 ]; then
    HUMAN_SIZE=$(awk "BEGIN {printf \"%.2f GB\", $S3_SIZE/1073741824}")
  elif [ $S3_SIZE -ge 1048576 ]; then
    HUMAN_SIZE=$(awk "BEGIN {printf \"%.2f MB\", $S3_SIZE/1048576}")
  elif [ $S3_SIZE -ge 1024 ]; then
    HUMAN_SIZE=$(awk "BEGIN {printf \"%.2f KB\", $S3_SIZE/1024}")
  else
    HUMAN_SIZE="$S3_SIZE bytes"
  fi
fi

# Clean up local archive
rm -rf "$TEMP_DIR"

echo "✅ Code uploaded and verified in S3"
echo "   S3 Location: s3://$S3_BUCKET/$S3_KEY"
echo "   Size: $S3_SIZE bytes ($HUMAN_SIZE)"
echo ""

# Upload test runner script to S3 (comprehensive script for all operations)
TEST_SCRIPT_KEY="scripts/run-tests-on-instance.sh"
echo "Uploading test runner script to S3..."
if ! aws s3 cp "scripts/run-tests-on-instance.sh" "s3://$S3_BUCKET/$TEST_SCRIPT_KEY" \
  --profile $PROFILE \
  --region $REGION \
  --no-cli-pager; then
  echo "❌ Failed to upload test runner script to S3"
  rm -rf "$TEMP_DIR"
  exit 1
fi
echo "✅ Test runner script uploaded to S3"
echo "   S3 Location: s3://$S3_BUCKET/$TEST_SCRIPT_KEY"
echo ""

# Prepare test commands
TEST_COMMANDS_FILE="/tmp/test-commands-$$.json"

# Function to escape JSON strings properly
# JSON only needs to escape: backslash and double quotes
# Note: $ does NOT need escaping in JSON (only in bash)
json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g' | sed 's/"/\\"/g'
}

# Build command to download and execute the comprehensive test script
# This avoids all JSON escaping issues - we just download and run the script
S3_KEY="${S3_KEY:-cc-native-test.tar.gz}"
TEST_SCRIPT_KEY="scripts/run-tests-on-instance.sh"
TEST_SCRIPT_PATH="/root/run-tests-on-instance.sh"
TARGET_DIR="/root/cc-native"

# Simple command: download script and execute with action and environment variables
# No complex escaping needed!
ESCAPED_SETUP_NODEJS=$(json_escape "aws s3 cp s3://$S3_BUCKET/$TEST_SCRIPT_KEY $TEST_SCRIPT_PATH && chmod +x $TEST_SCRIPT_PATH && $TEST_SCRIPT_PATH setup-nodejs")
ESCAPED_DEPLOY_CODE=$(json_escape "aws s3 cp s3://$S3_BUCKET/$TEST_SCRIPT_KEY $TEST_SCRIPT_PATH && chmod +x $TEST_SCRIPT_PATH && S3_BUCKET=$S3_BUCKET S3_KEY=$S3_KEY TARGET_DIR=$TARGET_DIR $TEST_SCRIPT_PATH deploy-code")
ESCAPED_VERIFY_DEPLOYMENT=$(json_escape "aws s3 cp s3://$S3_BUCKET/$TEST_SCRIPT_KEY $TEST_SCRIPT_PATH && chmod +x $TEST_SCRIPT_PATH && TARGET_DIR=$TARGET_DIR $TEST_SCRIPT_PATH verify-deployment")
ESCAPED_VERIFY_DEPS=$(json_escape "aws s3 cp s3://$S3_BUCKET/$TEST_SCRIPT_KEY $TEST_SCRIPT_PATH && chmod +x $TEST_SCRIPT_PATH && TARGET_DIR=$TARGET_DIR $TEST_SCRIPT_PATH verify-deps")
ESCAPED_RUN_TESTS=$(json_escape "aws s3 cp s3://$S3_BUCKET/$TEST_SCRIPT_KEY $TEST_SCRIPT_PATH && chmod +x $TEST_SCRIPT_PATH && TARGET_DIR=$TARGET_DIR $TEST_SCRIPT_PATH run-tests")

# Function to run a single SSM command and wait for completion with output streaming
# Usage: run_ssm_command "Step Name" "command to run" [timeout_seconds]
# Note: Command should already be JSON-escaped if it contains special characters
run_ssm_command() {
  local STEP_NAME="$1"
  local COMMAND="$2"
  local MAX_WAIT="${3:-300}"  # Default 5 minutes timeout
  
  echo ""
  echo "=========================================="
  echo "Step: $STEP_NAME"
  echo "=========================================="
  echo "Command preview (first 200 chars):"
  echo "$COMMAND" | head -c 200
  echo "..."
  echo ""
  
  # Create temporary JSON file for this command
  # The command is already JSON-escaped, so we can use it directly in the JSON
  local TEMP_CMD_FILE="/tmp/ssm-cmd-$$-$(date +%s).json"
  # Use jq if available for safe JSON creation, otherwise use printf
  if command -v jq >/dev/null 2>&1; then
    echo "$COMMAND" | jq -R '{commands: [.]}' > "$TEMP_CMD_FILE"
  else
    # Use printf to create JSON - command is already JSON-escaped so %s is safe
    printf '{"commands":["%s"]}\n' "$COMMAND" > "$TEMP_CMD_FILE"
  fi
  
  # Show JSON file for debugging (first 500 chars)
  echo "Sending command to instance $TEST_RUNNER_INSTANCE_ID..."
  echo "JSON file contents (first 500 chars):"
  head -c 500 "$TEMP_CMD_FILE" 2>/dev/null || cat "$TEMP_CMD_FILE" | head -c 500
  echo "..."
  echo ""
  
  # Send command with better error handling
  set +e
  CMD_OUTPUT=$(aws ssm send-command \
    --instance-ids "$TEST_RUNNER_INSTANCE_ID" \
    --document-name "AWS-RunShellScript" \
    --parameters file://"$TEMP_CMD_FILE" \
    --profile $PROFILE \
    --region $REGION \
    --no-cli-pager 2>&1)
  SSM_EXIT_CODE=$?
  set -e
  
  rm -f "$TEMP_CMD_FILE"
  
  if [ $SSM_EXIT_CODE -ne 0 ]; then
    echo "❌ Failed to send command for step: $STEP_NAME"
    echo "Exit code: $SSM_EXIT_CODE"
    echo "Error output:"
    echo "$CMD_OUTPUT"
    echo ""
    echo "Command that failed:"
    echo "$COMMAND" | head -c 500
    echo "..."
    return 1
  fi
  
  # Extract CommandId from output
  CMD_ID=$(echo "$CMD_OUTPUT" | grep -o '"CommandId":"[^"]*' | head -1 | cut -d'"' -f4 || echo "")
  if [ -z "$CMD_ID" ]; then
    # Try query method
    CMD_ID=$(echo "$CMD_OUTPUT" | jq -r '.Command.CommandId' 2>/dev/null || echo "")
  fi
  
  if [ -z "$CMD_ID" ] || [ "$CMD_ID" = "None" ] || [ "$CMD_ID" = "null" ]; then
    echo "❌ Failed to get CommandId from SSM response"
    echo "Full SSM response:"
    echo "$CMD_OUTPUT"
    return 1
  fi
  
  echo "✅ Command sent successfully"
  echo "Command ID: $CMD_ID"
  echo "Waiting for command to complete (max ${MAX_WAIT}s)..."
  echo ""
  
  # Wait for command to complete and stream output
  local ELAPSED=0
  local LAST_OUTPUT_LENGTH=0
  local LAST_ERROR_LENGTH=0
  local STATUS=""
  local LAST_STATUS=""
  local STATUS_CHECK_COUNT=0
  
  while [ $ELAPSED -lt $MAX_WAIT ]; do
    STATUS_CHECK_COUNT=$((STATUS_CHECK_COUNT + 1))
    
    STATUS=$(aws ssm get-command-invocation \
      --command-id "$CMD_ID" \
      --instance-id "$TEST_RUNNER_INSTANCE_ID" \
      --query "Status" \
      --output text \
      --profile $PROFILE \
      --region $REGION \
      --no-cli-pager 2>/dev/null || echo "Unknown")
    
    # Show status on first check or when it changes
    if [ "$STATUS_CHECK_COUNT" -eq 1 ]; then
      echo "Status: $STATUS"
    elif [ "$STATUS" != "$LAST_STATUS" ]; then
      echo ""
      echo "Status changed: $LAST_STATUS -> $STATUS"
    fi
    
    # Show progress indicator every 10 seconds
    if [ $((ELAPSED % 10)) -eq 0 ] && [ $ELAPSED -gt 0 ] && [ "$STATUS" = "InProgress" ]; then
      echo -n "[${ELAPSED}s elapsed, still running...] "
    fi
    
    LAST_STATUS="$STATUS"
    
    # Get output
    local CURRENT_OUTPUT=$(aws ssm get-command-invocation \
      --command-id "$CMD_ID" \
      --instance-id "$TEST_RUNNER_INSTANCE_ID" \
      --query "StandardOutputContent" \
      --output text \
      --profile $PROFILE \
      --region $REGION \
      --no-cli-pager 2>/dev/null || echo "")
    
    local CURRENT_ERROR=$(aws ssm get-command-invocation \
      --command-id "$CMD_ID" \
      --instance-id "$TEST_RUNNER_INSTANCE_ID" \
      --query "StandardErrorContent" \
      --output text \
      --profile $PROFILE \
      --region $REGION \
      --no-cli-pager 2>/dev/null || echo "")
    
    # Print new output
    if [ -n "$CURRENT_OUTPUT" ] && [ "$CURRENT_OUTPUT" != "None" ]; then
      local CURRENT_OUTPUT_LENGTH=${#CURRENT_OUTPUT}
      if [ $CURRENT_OUTPUT_LENGTH -gt $LAST_OUTPUT_LENGTH ]; then
        local NEW_OUTPUT="${CURRENT_OUTPUT:$LAST_OUTPUT_LENGTH}"
        if [ -n "$NEW_OUTPUT" ]; then
          echo -n "$NEW_OUTPUT"
        fi
        LAST_OUTPUT_LENGTH=$CURRENT_OUTPUT_LENGTH
      fi
    fi
    
    # Print new error
    if [ -n "$CURRENT_ERROR" ] && [ "$CURRENT_ERROR" != "None" ]; then
      local CURRENT_ERROR_LENGTH=${#CURRENT_ERROR}
      if [ $CURRENT_ERROR_LENGTH -gt $LAST_ERROR_LENGTH ]; then
        local NEW_ERROR="${CURRENT_ERROR:$LAST_ERROR_LENGTH}"
        if [ -n "$NEW_ERROR" ]; then
          echo -n "[stderr] $NEW_ERROR" >&2
        fi
        LAST_ERROR_LENGTH=$CURRENT_ERROR_LENGTH
      fi
    fi
    
    # Check if complete
    if [ "$STATUS" = "Success" ] || [ "$STATUS" = "Failed" ] || [ "$STATUS" = "Cancelled" ] || [ "$STATUS" = "TimedOut" ]; then
      # Print any remaining output
      if [ -n "$CURRENT_OUTPUT" ] && [ "$CURRENT_OUTPUT" != "None" ]; then
        local CURRENT_OUTPUT_LENGTH=${#CURRENT_OUTPUT}
        if [ $CURRENT_OUTPUT_LENGTH -gt $LAST_OUTPUT_LENGTH ]; then
          local NEW_OUTPUT="${CURRENT_OUTPUT:$LAST_OUTPUT_LENGTH}"
          if [ -n "$NEW_OUTPUT" ]; then
            echo "$NEW_OUTPUT"
          fi
        fi
      fi
      break
    fi
    
    sleep 2
    ELAPSED=$((ELAPSED + 2))
  done
  
  echo ""
  if [ "$STATUS" != "$LAST_STATUS" ]; then
    echo "Final Status: $STATUS"
  fi
  
  # Get exit code
  local EXIT_CODE=$(aws ssm get-command-invocation \
    --command-id "$CMD_ID" \
    --instance-id "$TEST_RUNNER_INSTANCE_ID" \
    --query "ResponseCode" \
    --output text \
    --profile $PROFILE \
    --region $REGION \
    --no-cli-pager 2>/dev/null || echo "1")
  
  # Get final error output if failed
  if [ "$STATUS" != "Success" ] || [ "$EXIT_CODE" != "0" ]; then
    local FINAL_ERROR=$(aws ssm get-command-invocation \
      --command-id "$CMD_ID" \
      --instance-id "$TEST_RUNNER_INSTANCE_ID" \
      --query "StandardErrorContent" \
      --output text \
      --profile $PROFILE \
      --region $REGION \
      --no-cli-pager 2>/dev/null || echo "")
    
    if [ -n "$FINAL_ERROR" ] && [ "$FINAL_ERROR" != "None" ]; then
      echo "Error output:"
      echo "$FINAL_ERROR"
    fi
    
    echo "❌ Step '$STEP_NAME' failed with exit code: $EXIT_CODE"
    return 1
  fi
  
  echo "✅ Step '$STEP_NAME' completed successfully"
  return 0
}

# Launch or get test runner instance
if [ "$SKIP_LAUNCH" != "true" ]; then
  echo "Step 3: Launching test runner instance..."
  ./scripts/manage-test-runner-instance.sh launch || exit 1
  echo ""
fi

# Get instance ID
echo "Getting test runner instance ID..."
TEST_RUNNER_INSTANCE_ID=$(aws ec2 describe-instances \
  --filters "Name=tag:Name,Values=cc-native-test-runner" "Name=instance-state-name,Values=running,stopped,pending" \
  --query "Reservations[0].Instances[0].InstanceId" \
  --output text \
  --profile $PROFILE \
  --region $REGION \
  --no-cli-pager 2>/dev/null || echo "")

if [ -z "$TEST_RUNNER_INSTANCE_ID" ] || [ "$TEST_RUNNER_INSTANCE_ID" = "None" ]; then
  echo "❌ Error: Could not find test runner instance"
  exit 1
fi

echo "✅ Instance ID: $TEST_RUNNER_INSTANCE_ID"
echo ""

# Wait for SSM agent to be ready (can take 1-2 minutes after instance launch)
echo "Waiting for SSM agent to be ready on instance..."
echo "This may take 1-2 minutes after instance launch..."
MAX_SSM_WAIT=120  # 2 minutes (reduced since we're just checking if we can send commands)
SSM_ELAPSED=0
SSM_READY=false
CHECK_INTERVAL=5  # Check every 5 seconds

# Try to verify SSM is ready by checking if we can send a command
# If we can send a command and get a CommandId, SSM is ready
while [ $SSM_ELAPSED -lt $MAX_SSM_WAIT ]; do
  # Show progress every 15 seconds
  if [ $((SSM_ELAPSED % 15)) -eq 0 ] && [ $SSM_ELAPSED -gt 0 ]; then
    echo ""
    echo "[${SSM_ELAPSED}s elapsed] Still waiting for SSM agent..."
  fi
  
  # Try sending a simple test command to verify SSM is working
  set +e
  TEST_CMD_OUTPUT=$(aws ssm send-command \
    --instance-ids "$TEST_RUNNER_INSTANCE_ID" \
    --document-name "AWS-RunShellScript" \
    --parameters '{"commands":["echo test"]}' \
    --profile $PROFILE \
    --region $REGION \
    --no-cli-pager 2>&1)
  SSM_SEND_EXIT=$?
  set -e
  
  if [ $SSM_SEND_EXIT -eq 0 ]; then
    # Extract CommandId
    TEST_CMD_ID=$(echo "$TEST_CMD_OUTPUT" | grep -o '"CommandId":"[^"]*' | head -1 | cut -d'"' -f4 || echo "")
    if [ -z "$TEST_CMD_ID" ]; then
      TEST_CMD_ID=$(echo "$TEST_CMD_OUTPUT" | jq -r '.Command.CommandId' 2>/dev/null || echo "")
    fi
    
    if [ -n "$TEST_CMD_ID" ] && [ "$TEST_CMD_ID" != "None" ] && [ "$TEST_CMD_ID" != "null" ]; then
      SSM_READY=true
      echo ""
      echo "✅ SSM agent is ready"
      break
    else
      echo -n "."
    fi
  else
    echo -n "."
  fi
  
  sleep $CHECK_INTERVAL
  SSM_ELAPSED=$((SSM_ELAPSED + CHECK_INTERVAL))
done

echo ""

if [ "$SSM_READY" != "true" ]; then
  echo "⚠️  Warning: SSM agent check timed out after ${MAX_SSM_WAIT} seconds"
  echo "The instance was recently launched. SSM agent typically takes 1-2 minutes to be ready."
  echo ""
  echo "Diagnostic information:"
  echo "  Instance ID: $TEST_RUNNER_INSTANCE_ID"
  echo "  Region: $REGION"
  echo "  Profile: $PROFILE"
  echo ""
  
  # Try to get instance status
  INSTANCE_STATE=$(aws ec2 describe-instances \
    --instance-ids "$TEST_RUNNER_INSTANCE_ID" \
    --query "Reservations[0].Instances[0].State.Name" \
    --output text \
    --profile $PROFILE \
    --region $REGION \
    --no-cli-pager 2>/dev/null || echo "Unknown")
  echo "  Instance state: $INSTANCE_STATE"
  
  echo ""
  echo "Attempting to proceed anyway (SSM might work even if check failed)..."
  # Don't exit - try to proceed anyway since SSM might work
else
  echo "✅ SSM agent check complete"
fi
echo ""

# Execute commands sequentially for better visibility
echo "Executing test workflow steps sequentially..."
echo ""

# Step 1: Setup Node.js
if ! run_ssm_command "Setup Node.js" "$ESCAPED_SETUP_NODEJS"; then
  echo "❌ Failed at step 1"
  exit 1
fi

# Step 2: Deploy code from S3
if ! run_ssm_command "Deploy code from S3" "$ESCAPED_DEPLOY_CODE"; then
  echo "❌ Failed at step 2: Code deployment failed"
  exit 1
fi

# Step 3: Verify deployment
if ! run_ssm_command "Verify code deployment" "$ESCAPED_VERIFY_DEPLOYMENT"; then
  echo "❌ Failed at step 3: Code verification failed"
  exit 1
fi

# Step 4: Verify dependencies
if ! run_ssm_command "Verify dependencies" "$ESCAPED_VERIFY_DEPS"; then
  echo "❌ Failed at step 4: Dependencies verification failed"
  exit 1
fi

# Check if we should stop after code deployment only
if [ "$DEPLOY_CODE_ONLY" = "true" ]; then
  echo ""
  echo "=========================================="
  echo "✅ Code deployment complete"
  echo "=========================================="
  echo ""
  echo "Code has been uploaded to S3 and deployed to the instance."
  echo ""
  echo "Instance ID: $TEST_RUNNER_INSTANCE_ID"
  echo ""
  echo "To connect and run tests manually:"
  echo "  aws ssm start-session --target $TEST_RUNNER_INSTANCE_ID --profile $PROFILE --region $REGION"
  echo ""
  echo "On the instance, run:"
  echo "  cd /root/cc-native"
  echo "  npm test -- src/tests/integration/phase2.test.ts"
  echo ""
  echo "To teardown when done:"
  echo "  ./scripts/manage-test-runner-instance.sh teardown"
  echo ""
  exit 0
fi

# Check if we should stop after setup
if [ "$STOP_AFTER_SETUP" = "true" ]; then
  echo ""
  echo "=========================================="
  echo "✅ Prerequisites setup complete"
  echo "=========================================="
  echo ""
  echo "Instance is ready for manual testing."
  echo ""
  echo "Instance ID: $TEST_RUNNER_INSTANCE_ID"
  echo ""
  echo "To connect and run tests manually:"
  echo "  aws ssm start-session --target $TEST_RUNNER_INSTANCE_ID --profile $PROFILE --region $REGION"
  echo ""
  echo "On the instance, run:"
  echo "  cd /root/cc-native"
  echo "  npm test -- src/tests/integration/phase2.test.ts"
  echo ""
  echo "To teardown when done:"
  echo "  ./scripts/manage-test-runner-instance.sh teardown"
  echo ""
  exit 0
fi

# Step 5: Run tests
TESTS_PASSED=true
if ! run_ssm_command "Run Phase 2 integration tests" "$ESCAPED_RUN_TESTS" 600; then
  TESTS_PASSED=false
  echo ""
  echo "=========================================="
  echo "❌ Tests failed"
  echo "=========================================="
  echo ""
  
  if [ "$ALWAYS_TEARDOWN" = "true" ]; then
    echo "Tearing down instance (--always-teardown flag set)..."
    FORCE_TEARDOWN=true ./scripts/manage-test-runner-instance.sh teardown
    echo ""
    echo "✅ Instance terminated"
    exit 1
  else
    echo "⚠️  Instance retained for debugging"
    echo ""
    echo "Instance ID: $TEST_RUNNER_INSTANCE_ID"
    echo ""
    echo "To connect and debug:"
    echo "  aws ssm start-session --target $TEST_RUNNER_INSTANCE_ID --profile $PROFILE --region $REGION"
    echo ""
    echo "To manually run tests:"
    echo "  cd ~/cc-native"
    echo "  npm test -- src/tests/integration/phase2.test.ts"
    echo ""
    echo "To teardown when done:"
    echo "  ./scripts/manage-test-runner-instance.sh teardown"
    echo ""
    echo "To always tear down on failure, use: $0 --always-teardown"
    echo ""
    exit 1
  fi
fi

# All steps completed successfully
echo ""
echo "=========================================="
echo "✅ All tests passed!"
echo "=========================================="
echo ""
echo "Step 4: Tearing down instance (tests passed)..."
FORCE_TEARDOWN=true ./scripts/manage-test-runner-instance.sh teardown
echo ""
echo "✅ Workflow complete - instance terminated"
exit 0
