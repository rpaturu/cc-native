#!/bin/bash
# run-tests-on-instance.sh
# Comprehensive script to run all test operations on the EC2 test runner instance
# This script is uploaded to S3 and executed on the instance via SSM
# Usage: ./run-tests-on-instance.sh <action> [options...]
#
# Actions:
#   setup-nodejs     - Install/verify Node.js and npm
#   deploy-code      - Deploy code from S3 (requires S3_BUCKET and S3_KEY)
#   verify-deployment - Verify code deployment
#   verify-deps      - Verify node_modules exists
#   run-tests        - Run Phase 2 integration tests
#   all              - Run all steps in sequence

set -e

ACTION="${1:-help}"
TARGET_DIR="${TARGET_DIR:-/root/cc-native}"

# Function to show usage
show_usage() {
  cat <<EOF
Usage: $0 <action> [options...]

Actions:
  setup-nodejs          Install/verify Node.js and npm
  deploy-code           Deploy code from S3 (requires S3_BUCKET and S3_KEY env vars)
  verify-deployment     Verify code deployment (checks files and directories)
  verify-deps           Verify node_modules exists
  run-tests             Run Phase 2 integration tests
  all                   Run all steps in sequence

Options:
  --verbose, -v         Enable verbose output (for run-tests action)

Environment Variables:
  S3_BUCKET             S3 bucket containing code archive (required for deploy-code)
  S3_KEY                S3 key for code archive (required for deploy-code, default: cc-native-test.tar.gz)
  TARGET_DIR            Target directory for code (default: /root/cc-native)

Examples:
  # Setup Node.js
  $0 setup-nodejs

  # Deploy code
  S3_BUCKET=my-bucket S3_KEY=code.tar.gz $0 deploy-code

  # Verify deployment
  $0 verify-deployment

  # Run tests with verbose output
  $0 run-tests --verbose

  # Run all steps
  S3_BUCKET=my-bucket S3_KEY=code.tar.gz $0 all
EOF
}

# Action: setup-nodejs
# Note: Node.js should already be installed via user-data script during instance launch.
# Node.js 20 is installed directly from Amazon Linux repositories (no nvm needed).
# This step just verifies Node.js is available.
action_setup_nodejs() {
  echo "=========================================="
  echo "Verifying Node.js setup (installed via user-data)"
  echo "=========================================="
  
  # Verify Node.js is available (installed via dnf from Amazon Linux repos)
  if ! command -v node &> /dev/null; then
    echo "⚠️  Warning: Node.js not found (user-data may still be running)"
    echo "   Waiting a moment and checking again..."
    sleep 5
    if ! command -v node &> /dev/null; then
      echo "❌ Node.js still not found after wait"
      echo "   User-data installation may have failed"
      echo "   Cannot install Node.js here (instance has no internet access)"
      exit 1
    fi
  fi
  
  NODE_VERSION=$(node --version)
  echo "✅ Node.js version: $NODE_VERSION"
  
  # Warn if using Node.js < 20 (AWS SDK v3 requires Node.js 18+, but 20+ is recommended)
  if echo "$NODE_VERSION" | grep -qE "^v1[0-8]"; then
    echo "⚠️  Warning: Node.js $NODE_VERSION detected. Node.js 20+ is recommended for AWS SDK v3 compatibility."
  fi
  
  if ! command -v npm &> /dev/null; then
    echo "❌ npm not found"
    exit 1
  fi
  
  echo "✅ npm version: $(npm --version)"
  echo "=========================================="
}

# Action: deploy-code
action_deploy_code() {
  echo "=========================================="
  echo "Deploying code from S3"
  echo "=========================================="
  
  S3_BUCKET_VAL="${S3_BUCKET:-}"
  S3_KEY_VAL="${S3_KEY:-cc-native-test.tar.gz}"
  
  if [ -z "$S3_BUCKET_VAL" ]; then
    echo "❌ Error: S3_BUCKET environment variable is required"
    exit 1
  fi
  
  echo "S3 Bucket: $S3_BUCKET_VAL"
  echo "S3 Key: $S3_KEY_VAL"
  echo "Target Directory: $TARGET_DIR"
  echo ""
  
  # Check and free up disk space
  echo "Checking disk space..."
  df -h /root || df -h /
  echo ""
  
  # Clean up old files in /root to free space
  echo "Cleaning up old test files in /root..."
  # Remove old test archives if they exist
  rm -f /root/cc-native-test.tar.gz* /root/cc-native-*.tar.gz 2>/dev/null || true
  # Remove old extracted directories if they exist (but keep current target)
  if [ "$TARGET_DIR" != "/root/cc-native" ]; then
    rm -rf /root/cc-native-* 2>/dev/null || true
  fi
  # Clean up /tmp as well (might have old files)
  rm -f /tmp/cc-native-test.tar.gz* /tmp/cc-native-*.tar.gz 2>/dev/null || true
  rm -rf /tmp/cc-native-* 2>/dev/null || true
  
  echo "Disk space after cleanup:"
  df -h /root || df -h /
  echo ""
  
  # Download archive from S3 (use /root instead of /tmp to avoid tmpfs space limits)
  LOCAL_ARCHIVE="/root/cc-native-test.tar.gz"
  echo "Downloading code from S3..."
  if ! aws s3 cp "s3://$S3_BUCKET_VAL/$S3_KEY_VAL" "$LOCAL_ARCHIVE"; then
    echo "❌ Failed to download from S3"
    echo "Checking AWS credentials and S3 access..."
    aws sts get-caller-identity || echo "AWS credentials issue"
    aws s3 ls "s3://$S3_BUCKET_VAL/" | head -5 || echo "S3 access issue"
    exit 1
  fi
  
  # Verify archive exists and has content
  if [ ! -f "$LOCAL_ARCHIVE" ]; then
    echo "❌ Error: Archive file not found after download"
    exit 1
  fi
  
  ARCHIVE_SIZE=$(stat -c%s "$LOCAL_ARCHIVE" 2>/dev/null || stat -f%z "$LOCAL_ARCHIVE" 2>/dev/null || echo "0")
  if [ "$ARCHIVE_SIZE" = "0" ] || [ -z "$ARCHIVE_SIZE" ]; then
    echo "❌ Error: Downloaded archive is empty or size could not be determined"
    exit 1
  fi
  
  echo "✅ Archive downloaded successfully"
  echo "Archive size: $(du -h "$LOCAL_ARCHIVE" | cut -f1)"
  echo ""
  
  # Clean up existing deployment before extracting (avoid conflicts with old files)
  if [ -d "$TARGET_DIR" ]; then
    echo "Cleaning up existing deployment at $TARGET_DIR..."
    rm -rf "$TARGET_DIR" || {
      echo "⚠️  Warning: Could not fully remove existing directory, continuing anyway..."
    }
  fi
  
  # Create fresh target directory
  echo "Creating target directory: $TARGET_DIR"
  mkdir -p "$TARGET_DIR" || {
    echo "❌ Failed to create target directory: $TARGET_DIR"
    exit 1
  }
  
  # Extract archive
  echo "Extracting archive to $TARGET_DIR..."
  
  # Extract to target directory (use -C to specify directory)
  # Suppress macOS extended attribute warnings (harmless, just informational)
  echo "Extracting $LOCAL_ARCHIVE to $TARGET_DIR..."
  set +e
  # Suppress stderr warnings about macOS extended attributes (harmless)
  tar -xzf "$LOCAL_ARCHIVE" -C "$TARGET_DIR" 2>/dev/null
  TAR_EXIT=$?
  set -e
  
  if [ $TAR_EXIT -ne 0 ]; then
    echo "❌ Error: Archive extraction failed with exit code $TAR_EXIT"
    echo "Archive: $LOCAL_ARCHIVE"
    echo "Target: $TARGET_DIR"
    echo "Disk space:"
    df -h "$TARGET_DIR" || df -h /
    exit 1
  fi
  
  # Clean up
  rm -f "$LOCAL_ARCHIVE"
  
  echo ""
  echo "Extraction complete"
  echo "Verifying contents of $TARGET_DIR..."
  echo ""
  echo "Key files and directories:"
  ls -la "$TARGET_DIR" | grep -E "(package.json|node_modules|src|\.gitignore|README)" || ls -la "$TARGET_DIR" | head -15
  echo ""
  echo "Total items in directory:"
  ls -1 "$TARGET_DIR" | wc -l
  
  # Create .env file with required environment variables from CloudFormation
  echo ""
  echo "Creating .env file with required environment variables..."
  cd "$TARGET_DIR" || {
    echo "❌ Error: Cannot access $TARGET_DIR"
    exit 1
  }
  
  # Get stack outputs (instance has IAM role, so it can query CloudFormation)
  STACK_NAME="${CLOUDFORMATION_STACK_NAME:-CCNativeStack}"
  REGION="${AWS_REGION:-us-west-2}"
  
  echo "Fetching environment variables from CloudFormation stack: $STACK_NAME"
  echo "(This may take a few seconds...)"
  
  # Get all stack outputs in one call (more efficient)
  echo "Querying CloudFormation stack outputs..."
  STACK_OUTPUTS=$(aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --query "Stacks[0].Outputs" \
    --output json \
    --region "$REGION" \
    --no-cli-pager 2>&1)
  
  # Check if the command failed
  if [ $? -ne 0 ] || [ "$STACK_OUTPUTS" = "[]" ] || [ -z "$STACK_OUTPUTS" ]; then
    echo "⚠️  Warning: Failed to retrieve CloudFormation stack outputs"
    echo "   This may be due to missing IAM permissions or the stack not existing"
    echo "   Error output: $STACK_OUTPUTS"
    echo "   Using default/empty values for environment variables"
    STACK_OUTPUTS="[]"
  else
    echo "✅ Successfully retrieved stack outputs"
  fi
  
  # Extract values using jq if available, otherwise use grep/awk
  if command -v jq >/dev/null 2>&1; then
    NEPTUNE_ENDPOINT=$(echo "$STACK_OUTPUTS" | jq -r '.[] | select(.OutputKey=="NeptuneClusterEndpoint") | .OutputValue' 2>/dev/null || echo "")
    NEPTUNE_PORT=$(echo "$STACK_OUTPUTS" | jq -r '.[] | select(.OutputKey=="NeptuneClusterPort") | .OutputValue' 2>/dev/null || echo "8182")
    SIGNALS_TABLE=$(echo "$STACK_OUTPUTS" | jq -r '.[] | select(.OutputKey=="SignalsTableName") | .OutputValue' 2>/dev/null || echo "cc-native-signals")
    ACCOUNTS_TABLE=$(echo "$STACK_OUTPUTS" | jq -r '.[] | select(.OutputKey=="AccountsTableName") | .OutputValue' 2>/dev/null || echo "cc-native-accounts")
    LEDGER_TABLE=$(echo "$STACK_OUTPUTS" | jq -r '.[] | select(.OutputKey=="LedgerTableName") | .OutputValue' 2>/dev/null || echo "cc-native-ledger")
    EVENT_BUS=$(echo "$STACK_OUTPUTS" | jq -r '.[] | select(.OutputKey=="EventBusName") | .OutputValue' 2>/dev/null || echo "cc-native-events")
    GRAPH_MATERIALIZATION_TABLE=$(echo "$STACK_OUTPUTS" | jq -r '.[] | select(.OutputKey=="GraphMaterializationStatusTableName") | .OutputValue' 2>/dev/null || echo "cc-native-graph-materialization-status")
    ACCOUNT_POSTURE_TABLE=$(echo "$STACK_OUTPUTS" | jq -r '.[] | select(.OutputKey=="AccountPostureStateTableName") | .OutputValue' 2>/dev/null || echo "cc-native-account-posture-state")
  else
    # Fallback: individual queries (slower but works without jq)
    NEPTUNE_ENDPOINT=$(aws cloudformation describe-stacks \
      --stack-name "$STACK_NAME" \
      --query "Stacks[0].Outputs[?OutputKey=='NeptuneClusterEndpoint'].OutputValue" \
      --output text \
      --region "$REGION" \
      --no-cli-pager 2>/dev/null || echo "")
  
  NEPTUNE_PORT=$(aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --query "Stacks[0].Outputs[?OutputKey=='NeptuneClusterPort'].OutputValue" \
    --output text \
    --region "$REGION" \
    --no-cli-pager 2>/dev/null || echo "8182")
  
  # Get DynamoDB table names
  SIGNALS_TABLE=$(aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --query "Stacks[0].Outputs[?OutputKey=='SignalsTableName'].OutputValue" \
    --output text \
    --region "$REGION" \
    --no-cli-pager 2>/dev/null || echo "cc-native-signals")
  
  ACCOUNTS_TABLE=$(aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --query "Stacks[0].Outputs[?OutputKey=='AccountsTableName'].OutputValue" \
    --output text \
    --region "$REGION" \
    --no-cli-pager 2>/dev/null || echo "cc-native-accounts")
  
  LEDGER_TABLE=$(aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --query "Stacks[0].Outputs[?OutputKey=='LedgerTableName'].OutputValue" \
    --output text \
    --region "$REGION" \
    --no-cli-pager 2>/dev/null || echo "cc-native-ledger")
  
  EVENT_BUS=$(aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --query "Stacks[0].Outputs[?OutputKey=='EventBusName'].OutputValue" \
    --output text \
    --region "$REGION" \
    --no-cli-pager 2>/dev/null || echo "cc-native-events")
  
  GRAPH_MATERIALIZATION_TABLE=$(aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --query "Stacks[0].Outputs[?OutputKey=='GraphMaterializationStatusTableName'].OutputValue" \
    --output text \
    --region "$REGION" \
    --no-cli-pager 2>/dev/null || echo "cc-native-graph-materialization-status")
  
  ACCOUNT_POSTURE_TABLE=$(aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --query "Stacks[0].Outputs[?OutputKey=='AccountPostureStateTableName'].OutputValue" \
    --output text \
    --region "$REGION" \
    --no-cli-pager 2>/dev/null || echo "cc-native-account-posture-state")
  fi
  
  # Create .env file
  cat > .env <<EOF
# Environment variables for Phase 2 integration tests
# Generated automatically from CloudFormation stack outputs

AWS_REGION=${REGION}

# Neptune Configuration
NEPTUNE_CLUSTER_ENDPOINT=${NEPTUNE_ENDPOINT}
NEPTUNE_CLUSTER_PORT=${NEPTUNE_PORT}

# DynamoDB Tables
SIGNALS_TABLE_NAME=${SIGNALS_TABLE}
ACCOUNTS_TABLE_NAME=${ACCOUNTS_TABLE}
LEDGER_TABLE_NAME=${LEDGER_TABLE}
GRAPH_MATERIALIZATION_STATUS_TABLE_NAME=${GRAPH_MATERIALIZATION_TABLE}
ACCOUNT_POSTURE_STATE_TABLE_NAME=${ACCOUNT_POSTURE_TABLE}

# EventBridge
EVENT_BUS_NAME=${EVENT_BUS}
EOF
  
  if [ -n "$NEPTUNE_ENDPOINT" ] && [ "$NEPTUNE_ENDPOINT" != "None" ]; then
    echo "✅ Created .env file with Neptune endpoint: $NEPTUNE_ENDPOINT"
  else
    echo "⚠️  Warning: Could not retrieve Neptune endpoint from CloudFormation"
    echo "   Tests will skip Neptune operations"
  fi
  
  echo ""
  echo "=========================================="
  echo "✅ Code deployment complete"
  echo "Location: $TARGET_DIR"
  echo "=========================================="
}

# Action: verify-deployment
action_verify_deployment() {
  echo "=========================================="
  echo "Verifying code deployment"
  echo "=========================================="
  echo "Target directory: $TARGET_DIR"
  
  cd "$TARGET_DIR" || {
    echo "❌ Error: Cannot access $TARGET_DIR"
    exit 1
  }
  
  echo "Current directory: $(pwd)"
  
  # Check package.json
  if [ ! -f "package.json" ]; then
    echo "❌ Error: package.json not found"
    exit 1
  fi
  echo "✅ package.json found"
  
  PACKAGE_NAME=$(grep -E '"name"' package.json | head -1 | cut -d'"' -f4 || echo "unknown")
  echo "   Package: $PACKAGE_NAME"
  
  # Check src directory
  if [ ! -d "src" ]; then
    echo "❌ Error: src directory not found"
    exit 1
  fi
  echo "✅ src directory found"
  
  SRC_FILES=$(find src -type f 2>/dev/null | wc -l | tr -d " ")
  echo "   Source files: $SRC_FILES"
  
  # Check node_modules
  if [ ! -d "node_modules" ]; then
    echo "❌ Error: node_modules directory not found"
    exit 1
  fi
  echo "✅ node_modules directory found"
  
  NODE_MODULES_COUNT=$(find node_modules -type f 2>/dev/null | wc -l | tr -d " ")
  if [ "$NODE_MODULES_COUNT" -lt 10 ]; then
    echo "⚠️  Warning: node_modules seems empty or incomplete (only $NODE_MODULES_COUNT files)"
  else
    echo "✅ node_modules contains $NODE_MODULES_COUNT files"
  fi
  
  # Check test file
  if [ ! -f "src/tests/integration/phase2.test.ts" ]; then
    echo "❌ Error: Test file src/tests/integration/phase2.test.ts not found"
    exit 1
  fi
  echo "✅ Test file src/tests/integration/phase2.test.ts found"
  
  # Check Node.js
  if ! command -v node >/dev/null 2>&1; then
    echo "❌ Error: Node.js not found"
    exit 1
  fi
  NODE_VERSION=$(node --version 2>/dev/null || echo "unknown")
  echo "✅ Node.js version: $NODE_VERSION"
  
  # Check npm
  if ! command -v npm >/dev/null 2>&1; then
    echo "❌ Error: npm not found"
    exit 1
  fi
  NPM_VERSION=$(npm --version 2>/dev/null || echo "unknown")
  echo "✅ npm version: $NPM_VERSION"
  
  echo "=========================================="
  echo "✅ Code deployment verification complete - all checks passed"
  echo "=========================================="
}

# Action: verify-deps
action_verify_deps() {
  echo "=========================================="
  echo "Verifying dependencies"
  echo "=========================================="
  
  cd "$TARGET_DIR" || {
    echo "❌ Error: Cannot access $TARGET_DIR"
    exit 1
  }
  
  if [ ! -d "node_modules" ]; then
    echo "⚠️  Warning: node_modules not found in archive"
    echo "Instance has no internet access for npm install"
    exit 1
  else
    echo "✅ Dependencies already included in archive (node_modules present)"
    ls -ld node_modules
  fi
}

# Action: run-tests
action_run_tests() {
  echo "=========================================="
  echo "Running Phase 2 integration tests"
  echo "=========================================="
  
  # Check for verbose flag
  VERBOSE=""
  if [ "$2" = "--verbose" ] || [ "$2" = "-v" ]; then
    VERBOSE="--verbose"
    echo "Verbose mode enabled"
  fi
  
  cd "$TARGET_DIR" || {
    echo "❌ Error: Cannot access $TARGET_DIR"
    exit 1
  }
  
  echo "Current directory: $(pwd)"
  echo "Listing directory contents:"
  ls -la | head -20
  echo ""
  
  # Check if test file exists
  if [ ! -f "src/tests/integration/phase2.test.ts" ]; then
    echo "❌ Error: Test file not found: src/tests/integration/phase2.test.ts"
    echo "Available test files:"
    find src/tests -name "*.test.ts" 2>/dev/null | head -10 || echo "No test files found"
    exit 1
  fi
  
  # Check if node_modules exists
  if [ ! -d "node_modules" ]; then
    echo "❌ Error: node_modules not found"
    exit 1
  fi
  
  # Check if jest is available
  if [ ! -f "node_modules/.bin/jest" ]; then
    echo "❌ Error: jest not found in node_modules/.bin"
    echo "Available binaries:"
    ls node_modules/.bin/ | head -10
    exit 1
  fi
  
  echo "✅ Prerequisites check passed"
  echo ""
  
  # Verify Node.js is available (installed via dnf, no nvm needed)
  if ! command -v node &> /dev/null; then
    echo "❌ Node.js not found"
    exit 1
  fi
  echo "Using Node.js: $(node --version)"
  
  # Ensure node_modules/.bin is in PATH
  export PATH="$PATH:$(pwd)/node_modules/.bin"
  
  # Build test command
  TEST_CMD="npm test -- src/tests/integration/phase2.test.ts"
  if [ -n "$VERBOSE" ]; then
    TEST_CMD="$TEST_CMD --verbose"
  fi
  
  echo "Running: $TEST_CMD"
  echo "This may take several minutes..."
  echo ""
  
  # Increase Node.js heap size for t3.micro (1GB RAM) - default is ~512MB, increase to ~768MB
  # Leave some memory for the OS and other processes
  # Add --experimental-vm-modules to support dynamic imports in Jest
  export NODE_OPTIONS="--max-old-space-size=768 --experimental-vm-modules"
  
  echo "Node.js heap size: 768MB (NODE_OPTIONS=$NODE_OPTIONS)"
  echo ""
  
  # Add Jest diagnostics to help debug hangs
  export NODE_OPTIONS="$NODE_OPTIONS --trace-warnings"
  
  echo "Starting Jest (this may take a moment to compile TypeScript)..."
  echo ""
  echo "Note: Network packets out are normal - AWS SDK makes calls to DynamoDB/EventBridge/Neptune via VPC endpoints"
  echo ""
  echo "If Jest hangs, it's likely during TypeScript compilation. This can take 2-5 minutes on t3.micro."
  echo ""
  
  # Run tests with unbuffered output (stdbuf if available)
  # Use stdbuf to disable output buffering if available
  # Add --detectOpenHandles to help identify what Jest is waiting for
  # Add --logHeapUsage to see memory usage
  # Add --no-cache to avoid cache issues
  # Note: --showConfig causes Jest to exit without running tests, so removed
  JEST_ARGS="--detectOpenHandles --forceExit --logHeapUsage --no-cache"
  if [ -n "$VERBOSE" ]; then
    JEST_ARGS="$JEST_ARGS --verbose"
  fi
  
  # Try to get some output immediately by running Jest directly instead of through npm
  # This gives us more control and better output
  echo "Running Jest directly (bypassing npm for better output)..."
  echo ""
  
  if command -v stdbuf >/dev/null 2>&1; then
    stdbuf -oL -eL ./node_modules/.bin/jest src/tests/integration/phase2.test.ts $JEST_ARGS
  else
    # Fallback: run jest directly
    ./node_modules/.bin/jest src/tests/integration/phase2.test.ts $JEST_ARGS
  fi
}

# Action: all (run all steps)
action_all() {
  echo "=========================================="
  echo "Running complete test workflow"
  echo "=========================================="
  echo ""
  
  action_setup_nodejs
  echo ""
  
  action_deploy_code
  echo ""
  
  action_verify_deployment
  echo ""
  
  action_verify_deps
  echo ""
  
  action_run_tests
}

# Main action dispatcher
case "$ACTION" in
  setup-nodejs)
    action_setup_nodejs
    ;;
  deploy-code)
    action_deploy_code
    ;;
  verify-deployment)
    action_verify_deployment
    ;;
  verify-deps)
    action_verify_deps
    ;;
  run-tests)
    action_run_tests
    ;;
  all)
    action_all
    ;;
  help|--help|-h)
    show_usage
    exit 0
    ;;
  *)
    echo "❌ Error: Unknown action: $ACTION"
    echo ""
    show_usage
    exit 1
    ;;
esac
