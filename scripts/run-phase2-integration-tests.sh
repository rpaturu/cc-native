#!/bin/bash
# run-phase2-integration-tests.sh
# Complete workflow for running Phase 2 integration tests:
# 1. Set up prerequisites (security group, IAM role, key pair) - optional
# 2. Launch EC2 test runner instance (or reuse existing)
# 3. Configure instance and run tests remotely via SSM
# 4. Conditionally teardown: only if all tests pass

set -e

PROFILE="${AWS_PROFILE:-cc-native-account}"
REGION="${AWS_REGION:-us-west-2}"
SKIP_PREREQUISITES="${SKIP_PREREQUISITES:-false}"
SKIP_LAUNCH="${SKIP_LAUNCH:-false}"
REPO_URL="${REPO_URL:-}"
DEPLOY_METHOD="${DEPLOY_METHOD:-clone}"  # clone, s3, or manual
S3_BUCKET="${S3_BUCKET:-}"  # S3 bucket for code deployment
GIT_TOKEN="${GIT_TOKEN:-}"  # Git token for private repos (HTTPS)
GIT_SSH_KEY="${GIT_SSH_KEY:-}"  # Path to SSH key for private repos

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
    --repo-url)
      REPO_URL="$2"
      DEPLOY_METHOD="clone"
      shift 2
      ;;
    --deploy-method)
      DEPLOY_METHOD="$2"
      shift 2
      ;;
    --s3-bucket)
      S3_BUCKET="$2"
      DEPLOY_METHOD="s3"
      shift 2
      ;;
    --s3-key)
      S3_KEY="$2"
      shift 2
      ;;
    --git-token)
      GIT_TOKEN="$2"
      shift 2
      ;;
    --git-ssh-key)
      GIT_SSH_KEY="$2"
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
      echo "  --repo-url URL         Repository URL for cloning (HTTPS or SSH)"
      echo "  --deploy-method METHOD Deployment method: clone, s3, or manual (default: clone)"
      echo "  --s3-bucket BUCKET     S3 bucket containing code archive (for s3 deploy method)"
      echo "  --s3-key KEY           S3 key/path to code archive (default: cc-native.tar.gz)"
      echo "  --git-token TOKEN      Git token for private HTTPS repos (e.g., GitHub personal access token)"
      echo "  --git-ssh-key PATH     Path to SSH private key for private SSH repos"
      echo "  --profile PROFILE      AWS profile (default: cc-native-account)"
      echo "  --region REGION        AWS region (default: us-west-2)"
      echo "  --help, -h             Show this help message"
      echo ""
      echo "Environment variables:"
      echo "  SKIP_PREREQUISITES     Skip prerequisites setup (true/false)"
      echo "  SKIP_LAUNCH            Skip instance launch (true/false)"
      echo "  REPO_URL               Repository URL for cloning"
      echo "  DEPLOY_METHOD          Deployment method: clone, s3, or manual"
      echo "  S3_BUCKET              S3 bucket for code deployment (s3 method)"
      echo "  S3_KEY                 S3 key/path to code archive (default: cc-native.tar.gz)"
      echo "  GIT_TOKEN              Git token for private HTTPS repos"
      echo "  GIT_SSH_KEY            Path to SSH key for private SSH repos"
      echo "  AWS_PROFILE            AWS profile name"
      echo "  AWS_REGION             AWS region"
      echo ""
      echo "Examples:"
      echo "  # Public repository (HTTPS)"
      echo "  $0 --repo-url https://github.com/your-org/cc-native.git"
      echo ""
      echo "  # Private repository with token (HTTPS)"
      echo "  $0 --repo-url https://github.com/your-org/cc-native.git --git-token ghp_xxxxx"
      echo ""
      echo "  # Private repository with SSH key"
      echo "  $0 --repo-url git@github.com:your-org/cc-native.git --git-ssh-key ~/.ssh/id_rsa"
      echo ""
      echo "  # Deploy from S3 (for local code or private repos)"
      echo "  $0 --deploy-method s3 --s3-bucket my-code-bucket --s3-key cc-native.tar.gz"
      echo ""
      echo "  # Skip prerequisites (already set up)"
      echo "  $0 --skip-prerequisites --repo-url https://github.com/your-org/cc-native.git"
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
echo "Deployment Method: $DEPLOY_METHOD"
if [ "$DEPLOY_METHOD" = "clone" ]; then
  if [ -n "$REPO_URL" ]; then
    echo "Repository URL: $REPO_URL"
    if [ -n "$GIT_TOKEN" ]; then
      echo "Using Git token for authentication (HTTPS)"
    elif [ -n "$GIT_SSH_KEY" ]; then
      echo "Using SSH key: $GIT_SSH_KEY"
    fi
  else
    echo "⚠️  Warning: REPO_URL not set - repository must already exist on instance"
  fi
elif [ "$DEPLOY_METHOD" = "s3" ]; then
  if [ -n "$S3_BUCKET" ]; then
    echo "S3 Bucket: $S3_BUCKET"
    echo "S3 Key: ${S3_KEY:-cc-native.tar.gz}"
  else
    echo "⚠️  Warning: S3_BUCKET not set"
  fi
elif [ "$DEPLOY_METHOD" = "manual" ]; then
  echo "⚠️  Manual deployment - ensure code is already on instance"
fi
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

# Prepare test commands based on deployment method
TEST_COMMANDS_FILE="/tmp/test-commands-$$.json"

# Build deployment commands based on method
DEPLOY_COMMANDS=""

case "$DEPLOY_METHOD" in
  clone)
    if [ -z "$REPO_URL" ]; then
      echo "❌ Error: REPO_URL required for clone deployment method"
      exit 1
    fi
    
    ESCAPED_REPO_URL=$(echo "$REPO_URL" | sed 's/"/\\"/g')
    
    # Handle private repositories
    if [ -n "$GIT_TOKEN" ]; then
      # HTTPS with token: embed token in URL
      if [[ "$REPO_URL" =~ ^https:// ]]; then
        # Insert token into URL: https://github.com/... -> https://TOKEN@github.com/...
        ESCAPED_REPO_URL=$(echo "$REPO_URL" | sed "s|https://|https://$GIT_TOKEN@|" | sed 's/"/\\"/g')
      fi
      DEPLOY_COMMANDS="if [ ! -d \\\"cc-native\\\" ]; then echo 'Cloning repository (with token)...'; git clone \\\"$ESCAPED_REPO_URL\\\" cc-native; fi"
    elif [ -n "$GIT_SSH_KEY" ]; then
      # SSH with key: need to copy key to instance first
      echo "⚠️  SSH key deployment requires manual setup"
      echo "Please connect to instance and set up SSH key manually, or use HTTPS with token"
      DEPLOY_COMMANDS="if [ ! -d \\\"cc-native\\\" ]; then if [ -z \\\"$ESCAPED_REPO_URL\\\" ]; then echo 'Error: Repository not found and REPO_URL not set'; exit 1; fi; echo 'Cloning repository (SSH)...'; GIT_SSH_COMMAND=\\\"ssh -i ~/.ssh/id_rsa -o StrictHostKeyChecking=no\\\" git clone \\\"$ESCAPED_REPO_URL\\\" cc-native; fi"
    else
      # Public repository or assume credentials are configured
      DEPLOY_COMMANDS="if [ ! -d \\\"cc-native\\\" ]; then if [ -z \\\"$ESCAPED_REPO_URL\\\" ]; then echo 'Error: Repository not found and REPO_URL not set'; exit 1; fi; echo 'Cloning repository...'; git clone \\\"$ESCAPED_REPO_URL\\\" cc-native; fi"
    fi
    ;;
  s3)
    if [ -z "$S3_BUCKET" ]; then
      echo "❌ Error: S3_BUCKET required for s3 deployment method"
      exit 1
    fi
    S3_KEY="${S3_KEY:-cc-native.tar.gz}"
    ESCAPED_S3_BUCKET=$(echo "$S3_BUCKET" | sed 's/"/\\"/g')
    ESCAPED_S3_KEY=$(echo "$S3_KEY" | sed 's/"/\\"/g')
    DEPLOY_COMMANDS="if [ ! -d \\\"cc-native\\\" ]; then echo 'Downloading code from S3...'; aws s3 cp s3://$ESCAPED_S3_BUCKET/$ESCAPED_S3_KEY /tmp/cc-native.tar.gz; mkdir -p cc-native; cd cc-native; tar -xzf /tmp/cc-native.tar.gz; cd ~; rm /tmp/cc-native.tar.gz; fi"
    ;;
  manual)
    DEPLOY_COMMANDS="if [ ! -d \\\"cc-native\\\" ]; then echo 'Error: Repository not found. Please deploy code manually.'; exit 1; fi"
    echo "⚠️  Using manual deployment - ensure code is already on instance"
    ;;
  *)
    echo "❌ Error: Unknown deployment method: $DEPLOY_METHOD"
    echo "Valid methods: clone, s3, manual"
    exit 1
    ;;
esac

cat > $TEST_COMMANDS_FILE << EOF
{
  "commands": [
    "cd ~ || exit 1",
    "if ! command -v node &> /dev/null; then echo 'Installing Node.js 20...'; curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash; export NVM_DIR=\\\"\\\$HOME/.nvm\\\"; [ -s \\\"\\\$NVM_DIR/nvm.sh\\\" ] && . \\\"\\\$NVM_DIR/nvm.sh\\\"; nvm install 20; nvm use 20; fi",
    "$DEPLOY_COMMANDS",
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
