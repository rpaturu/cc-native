#!/bin/bash
# run-phase2-integration-tests.sh
# Complete workflow for running Phase 2 integration tests:
# 1. Set up prerequisites (security group, IAM role, key pair)
# 2. Launch EC2 test runner instance (or reuse existing)
# 3. Configure instance and run tests remotely via SSM
# 4. Conditionally teardown: only if all tests pass

set -e

PROFILE="${AWS_PROFILE:-cc-native-account}"
REGION="${AWS_REGION:-us-west-2}"
SKIP_PREREQUISITES="${SKIP_PREREQUISITES:-false}"
SKIP_LAUNCH="${SKIP_LAUNCH:-false}"
REPO_URL="${REPO_URL:-}"

echo "=========================================="
echo "Phase 2 Integration Test Workflow"
echo "=========================================="
echo ""

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

# Step 2: Launch or reuse instance
if [ "$SKIP_LAUNCH" != "true" ]; then
  # Check if instance already exists
  source .env.test-runner 2>/dev/null || true
  EXISTING_INSTANCE=$(aws ec2 describe-instances \
    --filters "Name=tag:Name,Values=cc-native-test-runner" "Name=instance-state-name,Values=running" \
    --query "Reservations[0].Instances[0].InstanceId" \
    --output text \
    --profile $PROFILE \
    --region $REGION \
    --no-cli-pager 2>/dev/null || echo "")

  if [ -n "$EXISTING_INSTANCE" ] && [ "$EXISTING_INSTANCE" != "None" ]; then
    echo "Step 2: Reusing existing instance: $EXISTING_INSTANCE"
    echo "TEST_RUNNER_INSTANCE_ID=$EXISTING_INSTANCE" >> .env.test-runner
  else
    echo "Step 2: Launching test runner instance..."
    if ! ./scripts/manage-test-runner-instance.sh launch; then
      echo "❌ Failed to launch instance"
      exit 1
    fi
  fi
  echo ""
else
  echo "Step 2: Skipping launch (using existing instance)"
  echo ""
fi

# Load instance ID
source .env.test-runner
if [ -z "$TEST_RUNNER_INSTANCE_ID" ]; then
  echo "❌ Instance ID not found in .env.test-runner"
  exit 1
fi

echo "Instance ID: $TEST_RUNNER_INSTANCE_ID"
echo ""

# Step 3: Run tests remotely
echo "Step 3: Running tests on instance..."
echo ""

# Prepare test commands with REPO_URL substitution
TEST_COMMANDS_FILE="/tmp/test-commands-$$.json"

# Escape REPO_URL for JSON
ESCAPED_REPO_URL=$(echo "$REPO_URL" | sed 's/"/\\"/g')

cat > $TEST_COMMANDS_FILE << EOF
{
  "commands": [
    "cd ~ || exit 1",
    "if ! command -v node &> /dev/null; then echo 'Installing Node.js 20...'; curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash; export NVM_DIR=\\\"\\\$HOME/.nvm\\\"; [ -s \\\"\\\$NVM_DIR/nvm.sh\\\" ] && . \\\"\\\$NVM_DIR/nvm.sh\\\"; nvm install 20; nvm use 20; fi",
    "if [ ! -d \\\"cc-native\\\" ]; then if [ -z \\\"$ESCAPED_REPO_URL\\\" ]; then echo 'Error: Repository not found and REPO_URL not set'; exit 1; fi; echo 'Cloning repository...'; git clone \\\"$ESCAPED_REPO_URL\\\" cc-native; fi",
    "cd cc-native || exit 1",
    "if [ ! -d \\\"node_modules\\\" ]; then echo 'Installing dependencies...'; npm install; fi",
    "echo 'Running Phase 2 integration tests...'",
    "npm test -- src/tests/integration/phase2.test.ts"
  ]
}
EOF

# Send command to instance
echo "Sending test command to instance..."
if [ -n "$REPO_URL" ]; then
  echo "Repository URL: $REPO_URL"
fi
COMMAND_OUTPUT=$(aws ssm send-command \
  --instance-ids "$TEST_RUNNER_INSTANCE_ID" \
  --document-name "AWS-RunShellScript" \
  --parameters file://$TEST_COMMANDS_FILE \
  --profile $PROFILE \
  --region $REGION \
  --no-cli-pager 2>&1)

if [ $? -ne 0 ]; then
  echo "❌ Failed to send command to instance"
  echo "Error: $COMMAND_OUTPUT"
  rm -f $TEST_COMMANDS_FILE
  show_manual_instructions
  exit 1
fi

COMMAND_ID=$(echo "$COMMAND_OUTPUT" | grep -o '"CommandId":"[^"]*' | head -1 | cut -d'"' -f4 || echo "")

if [ -z "$COMMAND_ID" ]; then
  echo "❌ Failed to get command ID from SSM"
  echo "Falling back to manual instructions..."
  rm -f $TEST_COMMANDS_FILE
  show_manual_instructions
  exit 1
fi

echo "Command ID: $COMMAND_ID"
echo "Waiting for command to complete (this may take a few minutes)..."

# Wait for command to complete (with timeout)
MAX_WAIT=600  # 10 minutes
ELAPSED=0
while [ $ELAPSED -lt $MAX_WAIT ]; do
  STATUS=$(aws ssm get-command-invocation \
    --command-id "$COMMAND_ID" \
    --instance-id "$TEST_RUNNER_INSTANCE_ID" \
    --query "Status" \
    --output text \
    --profile $PROFILE \
    --region $REGION \
    --no-cli-pager 2>/dev/null || echo "Unknown")

  if [ "$STATUS" = "Success" ] || [ "$STATUS" = "Failed" ] || [ "$STATUS" = "Cancelled" ] || [ "$STATUS" = "TimedOut" ]; then
    break
  fi
  sleep 5
  ELAPSED=$((ELAPSED + 5))
  echo -n "."
done
echo ""

# Get command output
echo ""
echo "Test Output:"
echo "=========================================="
OUTPUT=$(aws ssm get-command-invocation \
  --command-id "$COMMAND_ID" \
  --instance-id "$TEST_RUNNER_INSTANCE_ID" \
  --query "StandardOutputContent" \
  --output text \
  --profile $PROFILE \
  --region $REGION \
  --no-cli-pager 2>/dev/null || echo "")

echo "$OUTPUT"

# Get error output if any
ERROR_OUTPUT=$(aws ssm get-command-invocation \
  --command-id "$COMMAND_ID" \
  --instance-id "$TEST_RUNNER_INSTANCE_ID" \
  --query "StandardErrorContent" \
  --output text \
  --profile $PROFILE \
  --region $REGION \
  --no-cli-pager 2>/dev/null || echo "")

if [ -n "$ERROR_OUTPUT" ] && [ "$ERROR_OUTPUT" != "None" ]; then
  echo ""
  echo "Error Output:"
  echo "=========================================="
  echo "$ERROR_OUTPUT"
fi

# Get exit code
EXIT_CODE=$(aws ssm get-command-invocation \
  --command-id "$COMMAND_ID" \
  --instance-id "$TEST_RUNNER_INSTANCE_ID" \
  --query "ResponseCode" \
  --output text \
  --profile $PROFILE \
  --region $REGION \
  --no-cli-pager 2>/dev/null || echo "1")

# Clean up
rm -f $TEST_COMMANDS_FILE

echo ""
echo "=========================================="
if [ "$STATUS" = "Success" ] && [ "$EXIT_CODE" = "0" ]; then
  echo "✅ All tests passed!"
  echo "=========================================="
  echo ""
  echo "Step 4: Tearing down instance (tests passed)..."
  FORCE_TEARDOWN=true ./scripts/manage-test-runner-instance.sh teardown
  echo ""
  echo "✅ Workflow complete - instance terminated"
  exit 0
else
  echo "❌ Tests failed or encountered errors"
  echo "=========================================="
  echo ""
  echo "Exit Code: $EXIT_CODE"
  echo "Status: $STATUS"
  echo ""
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
  exit 1
fi
