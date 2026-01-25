#!/bin/bash
# manage-test-runner-instance.sh
# Manages the test runner EC2 instance lifecycle:
#   launch   - Launch and configure EC2 instance
#   status   - Check instance status
#   connect  - Show connection instructions
#   teardown - Terminate the instance

set -e

PROFILE="${AWS_PROFILE:-cc-native-account}"
REGION="${AWS_REGION:-us-west-2}"
ACTION="${1:-help}"
# Optional: Specify Amazon Linux 2023 release version (e.g., "2023.10.20260105")
# If not set, uses the latest available AMI
AL2023_VERSION="${AL2023_VERSION:-}"

# Load .env.local if it exists (for local overrides like GIT_REPO_URL, GIT_TOKEN)
if [ -f .env.local ]; then
  source .env.local
fi

# Load .env if it exists (for AWS configuration)
if [ -f .env ]; then
  source .env
fi

# Load .env.test-runner if it exists (required for launch, optional for teardown/status)
if [ -f .env.test-runner ]; then
  source .env.test-runner
fi

# Load .env if it exists (for NEPTUNE_SUBNET_ID and other config)
if [ -f .env ]; then
  source .env
fi

# Validate required variables (only for actions that need them)
if [ "$ACTION" = "launch" ] || [ "$ACTION" = "test" ] || [ "$ACTION" = "configure" ]; then
  if [ -z "$TEST_RUNNER_SECURITY_GROUP_ID" ] || [ -z "$TEST_RUNNER_INSTANCE_PROFILE_NAME" ] || [ -z "$TEST_RUNNER_KEY_NAME" ]; then
    echo "Error: Missing required configuration. Run ./scripts/common/setup-test-runner-prerequisites.sh first"
    exit 1
  fi
  
  if [ -z "$NEPTUNE_SUBNET_ID" ]; then
    echo "Error: NEPTUNE_SUBNET_ID not found in .env"
    exit 1
  fi
fi

# Function to get instance ID from tag
get_instance_id() {
  aws ec2 describe-instances \
    --filters "Name=tag:Name,Values=cc-native-test-runner" "Name=instance-state-name,Values=running,stopped,pending" \
    --query "Reservations[0].Instances[0].InstanceId" \
    --output text \
    --profile $PROFILE \
    --region $REGION \
    --no-cli-pager 2>/dev/null || echo ""
}

# Function to launch instance
launch_instance() {
  echo "=========================================="
  echo "Launching test runner EC2 instance"
  echo "=========================================="
  echo "Subnet ID: $NEPTUNE_SUBNET_ID"
  echo "Security Group: $TEST_RUNNER_SECURITY_GROUP_ID"
  echo "Instance Profile: $TEST_RUNNER_INSTANCE_PROFILE_NAME"
  echo "Key Pair: $TEST_RUNNER_KEY_NAME"
  echo ""

  # Check if instance already exists
  EXISTING_INSTANCE=$(get_instance_id)
  if [ -n "$EXISTING_INSTANCE" ] && [ "$EXISTING_INSTANCE" != "None" ]; then
    echo "⚠️  Instance already exists: $EXISTING_INSTANCE"
    echo "Use 'teardown' to terminate it first, or 'status' to check its state"
    exit 1
  fi

  # Get Amazon Linux 2023 AMI ID
  if [ -n "$AL2023_VERSION" ]; then
    echo "Finding Amazon Linux 2023 AMI version: $AL2023_VERSION..."
    AMI_FILTER="al2023-ami-${AL2023_VERSION}*"
    AMI_ID=$(aws ec2 describe-images \
      --owners amazon \
      --filters "Name=name,Values=$AMI_FILTER" "Name=architecture,Values=x86_64" \
      --query "Images | sort_by(@, &CreationDate) | [-1].ImageId" \
      --output text \
      --profile $PROFILE \
      --region $REGION \
      --no-cli-pager)
    
    if [ -z "$AMI_ID" ] || [ "$AMI_ID" == "None" ]; then
      echo "Error: Could not find Amazon Linux 2023 AMI version: $AL2023_VERSION"
      echo "Available versions can be found at: https://docs.aws.amazon.com/linux/al2023/release-notes/relnotes.html"
      exit 1
    fi
    echo "Using AMI version $AL2023_VERSION: $AMI_ID"
  else
    echo "Finding latest Amazon Linux 2023 AMI..."
    AMI_ID=$(aws ec2 describe-images \
      --owners amazon \
      --filters "Name=name,Values=al2023-ami-2023*" "Name=architecture,Values=x86_64" \
      --query "Images | sort_by(@, &CreationDate) | [-1].ImageId" \
      --output text \
      --profile $PROFILE \
      --region $REGION \
      --no-cli-pager)
    
    if [ -z "$AMI_ID" ] || [ "$AMI_ID" == "None" ]; then
      echo "Error: Could not find Amazon Linux 2023 AMI"
      exit 1
    fi
    
    # Get the AMI name to show which version we're using
    AMI_NAME=$(aws ec2 describe-images \
      --image-ids "$AMI_ID" \
      --query "Images[0].Name" \
      --output text \
      --profile $PROFILE \
      --region $REGION \
      --no-cli-pager)
    echo "Using latest AMI: $AMI_ID"
    echo "AMI Name: $AMI_NAME"
  fi
  echo ""

  # Create user-data script to pre-install Node.js and npm
  # This makes test runs faster and more reliable
  USER_DATA_SCRIPT=$(cat <<'EOF'
#!/bin/bash
# User data script to pre-install required tools for test runner
set -e

echo "=========================================="
echo "Installing test runner prerequisites"
echo "=========================================="

# Install Node.js 20 directly from Amazon Linux repositories
# This works via VPC endpoints and doesn't require internet access
# Amazon Linux 2023 includes nodejs20 package (see release notes)
# Note: Some AMIs may have older Node.js versions pre-installed, so we remove them first
echo "Checking for existing Node.js installations..."
if command -v node &> /dev/null; then
  EXISTING_VERSION=$(node --version)
  echo "Found existing Node.js: $EXISTING_VERSION"
  if ! echo "$EXISTING_VERSION" | grep -qE "^v20"; then
    echo "Removing older Node.js version to install Node.js 20..."
    dnf remove -y nodejs nodejs18 nodejs16 2>/dev/null || true
  fi
fi

echo "Installing Node.js 20 from Amazon Linux repositories..."
dnf install -y nodejs20

# Verify Node.js 20 is installed and being used
echo ""
echo "Installation complete:"
NODE_VERSION=$(node --version 2>/dev/null || echo "not found")
echo "Node.js version: $NODE_VERSION"

# Check if we're using Node.js 20
if echo "$NODE_VERSION" | grep -qE "^v20"; then
  echo "✅ Node.js 20 is active"
elif echo "$NODE_VERSION" | grep -qE "^v1[0-8]"; then
  echo "⚠️  Warning: Node.js $NODE_VERSION detected instead of Node.js 20"
  echo "   Checking available Node.js versions..."
  dnf list installed | grep nodejs || echo "No nodejs packages found"
  echo "   Attempting to ensure nodejs20 is the active version..."
  # nodejs20 should be in PATH, but if not, we may need to use alternatives
  which node || echo "node command not found in PATH"
fi

npm --version || echo "npm installation failed"

echo "=========================================="
echo "Test runner prerequisites installed"
echo "=========================================="
EOF
)

  # Encode user-data in base64 (required by AWS)
  # Remove newlines from base64 output for compatibility
  USER_DATA_B64=$(echo "$USER_DATA_SCRIPT" | base64 | tr -d '\n')

  # Launch instance with user-data
  # Use t3.medium (2 vCPU, 4GB RAM) for better performance with Jest + TypeScript compilation
  # t3.micro (1 vCPU, 1GB RAM) is too small and causes Jest to hang during compilation
  # Since instance is torn down after testing, using t3.medium is cost-effective
  INSTANCE_TYPE="${TEST_RUNNER_INSTANCE_TYPE:-t3.medium}"
  echo "Launching instance with pre-installed tools (Node.js, npm)..."
  echo "Instance type: $INSTANCE_TYPE (2 vCPU, 4GB RAM - good for Jest/TypeScript compilation)"
  INSTANCE_ID=$(aws ec2 run-instances \
    --image-id $AMI_ID \
    --instance-type $INSTANCE_TYPE \
    --subnet-id $NEPTUNE_SUBNET_ID \
    --security-group-ids $TEST_RUNNER_SECURITY_GROUP_ID \
    --iam-instance-profile Name=$TEST_RUNNER_INSTANCE_PROFILE_NAME \
    --key-name $TEST_RUNNER_KEY_NAME \
    --user-data "$USER_DATA_B64" \
    --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=cc-native-test-runner}]' \
    --query "Instances[0].InstanceId" \
    --output text \
    --profile $PROFILE \
    --region $REGION \
    --no-cli-pager)

  if [ -z "$INSTANCE_ID" ] || [ "$INSTANCE_ID" == "None" ]; then
    echo "Error: Failed to launch instance"
    exit 1
  fi

  echo "Instance launched: $INSTANCE_ID"
  echo "Waiting for instance to be running..."
  aws ec2 wait instance-running \
    --instance-ids $INSTANCE_ID \
    --profile $PROFILE \
    --region $REGION \
    --no-cli-pager

  echo "Waiting for user-data script to complete (installing Node.js, npm)..."
  echo "This may take 1-2 minutes..."
  sleep 30  # Give user-data script time to start

  # Save instance ID to .env.test-runner
  echo "TEST_RUNNER_INSTANCE_ID=$INSTANCE_ID" >> .env.test-runner

  echo ""
  echo "✅ Instance is running!"
  echo ""
  echo "Instance ID: $INSTANCE_ID"
  echo ""

  # Get connection info
  show_connection_info $INSTANCE_ID
}

# Function to show connection info
show_connection_info() {
  local INSTANCE_ID=$1
  if [ -z "$INSTANCE_ID" ]; then
    INSTANCE_ID=$(get_instance_id)
  fi

  if [ -z "$INSTANCE_ID" ] || [ "$INSTANCE_ID" == "None" ]; then
    echo "No running instance found"
    return
  fi

  # Get instance details
  PUBLIC_IP=$(aws ec2 describe-instances \
    --instance-ids $INSTANCE_ID \
    --query "Reservations[0].Instances[0].PublicIpAddress" \
    --output text \
    --profile $PROFILE \
    --region $REGION \
    --no-cli-pager)

  PRIVATE_IP=$(aws ec2 describe-instances \
    --instance-ids $INSTANCE_ID \
    --query "Reservations[0].Instances[0].PrivateIpAddress" \
    --output text \
    --profile $PROFILE \
    --region $REGION \
    --no-cli-pager)

  STATE=$(aws ec2 describe-instances \
    --instance-ids $INSTANCE_ID \
    --query "Reservations[0].Instances[0].State.Name" \
    --output text \
    --profile $PROFILE \
    --region $REGION \
    --no-cli-pager)

  echo "Instance Status:"
  echo "  Instance ID: $INSTANCE_ID"
  echo "  State: $STATE"
  echo "  Private IP: $PRIVATE_IP"
  echo "  Public IP: $PUBLIC_IP"
  echo ""

  if [ "$PUBLIC_IP" != "None" ] && [ -n "$PUBLIC_IP" ]; then
    echo "SSH Connection:"
    echo "  ssh -i $TEST_RUNNER_KEY_FILE ec2-user@$PUBLIC_IP"
  else
    echo "⚠️  Instance is in isolated subnet (no public IP)"
    echo ""
    echo "Connection options:"
    echo "  1. AWS Systems Manager Session Manager:"
    echo "     aws ssm start-session --target $INSTANCE_ID --profile $PROFILE --region $REGION"
    echo ""
    echo "  2. Use a bastion host in a public subnet"
  fi
}

# Function to configure instance (user-data script)
configure_instance() {
  local INSTANCE_ID=$1
  if [ -z "$INSTANCE_ID" ]; then
    INSTANCE_ID=$(get_instance_id)
  fi

  if [ -z "$INSTANCE_ID" ] || [ "$INSTANCE_ID" == "None" ]; then
    echo "Error: No running instance found"
    exit 1
  fi

  echo "=========================================="
  echo "Configuring test runner instance"
  echo "=========================================="
  echo "Instance ID: $INSTANCE_ID"
  echo ""
  echo "✅ Node.js and npm are pre-installed via user-data"
  echo ""
  echo "⚠️  Note: Additional configuration can be done manually via SSM"
  echo ""
  echo "Once connected, you can verify installations:"
  echo ""
  echo "  node --version"
  echo "  npm --version"
  echo ""
  echo "The instance uses IAM role for AWS credentials (no .env needed)"
  echo ""
  
  show_connection_info $INSTANCE_ID
}

# Function to check status
check_status() {
  echo "=========================================="
  echo "Test Runner Instance Status"
  echo "=========================================="
  
  INSTANCE_ID=$(get_instance_id)
  
  if [ -z "$INSTANCE_ID" ] || [ "$INSTANCE_ID" == "None" ]; then
    echo "No test runner instance found"
    echo ""
    echo "To launch an instance, run:"
    echo "  ./scripts/common/manage-test-runner-instance.sh launch"
    return
  fi

  show_connection_info $INSTANCE_ID
}

# Function to run tests on instance
run_tests() {
  echo "=========================================="
  echo "Running Phase 2 Integration Tests"
  echo "=========================================="
  
  INSTANCE_ID=$(get_instance_id)
  
  if [ -z "$INSTANCE_ID" ] || [ "$INSTANCE_ID" == "None" ]; then
    echo "Error: No running instance found"
    echo "Launch an instance first: ./scripts/common/manage-test-runner-instance.sh launch"
    exit 1
  fi

  echo "Instance ID: $INSTANCE_ID"
  echo ""

  # Load REPO_URL from environment, .env.local, or .env.test-runner
  # .env.local takes precedence (already loaded above)
  # Then check .env.test-runner
  if [ -f .env.test-runner ]; then
    source .env.test-runner
  fi

  # Use GIT_REPO_URL from .env.local if REPO_URL not set
  REPO_URL="${REPO_URL:-${GIT_REPO_URL:-}}"
  if [ -z "$REPO_URL" ]; then
    echo "⚠️  Warning: REPO_URL not set"
    echo "Tests will fail if repository is not already cloned on the instance"
    echo "Set REPO_URL environment variable or clone repository manually"
    echo ""
  fi

  # Prepare test commands
  TEST_COMMANDS_FILE="/tmp/test-commands-$$.json"
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

  # Wait for SSM agent to be ready (can take 1-2 minutes after instance launch)
  echo "Waiting for SSM agent to be ready on instance..."
  echo "This may take 1-2 minutes after instance launch..."
  MAX_SSM_WAIT=180  # 3 minutes
  SSM_ELAPSED=0
  SSM_READY=false

  while [ $SSM_ELAPSED -lt $MAX_SSM_WAIT ]; do
    if aws ssm describe-instance-information \
      --filters "Key=InstanceIds,Values=$INSTANCE_ID" \
      --query "InstanceInformationList[0].PingStatus" \
      --output text \
      --profile $PROFILE \
      --region $REGION \
      --no-cli-pager 2>/dev/null | grep -q "Online"; then
      SSM_READY=true
      break
    fi
    sleep 10
    SSM_ELAPSED=$((SSM_ELAPSED + 10))
    echo -n "."
  done
  echo ""

  if [ "$SSM_READY" != "true" ]; then
    echo "⚠️  Warning: SSM agent may not be ready yet"
    echo "The instance was recently launched. SSM agent typically takes 1-2 minutes to be ready."
    echo "You can wait a bit longer and try again, or connect manually."
    echo ""
    echo "To connect manually:"
    echo "  aws ssm start-session --target $INSTANCE_ID --profile $PROFILE --region $REGION"
    exit 1
  fi

  echo "✅ SSM agent is ready"
  echo ""

  # Send command to instance
  echo "Sending test command to instance..."
  if [ -n "$REPO_URL" ]; then
    echo "Repository URL: $REPO_URL"
  fi

  set +e  # Temporarily disable exit on error to capture full error message
  COMMAND_OUTPUT=$(aws ssm send-command \
    --instance-ids "$INSTANCE_ID" \
    --document-name "AWS-RunShellScript" \
    --parameters file://$TEST_COMMANDS_FILE \
    --profile $PROFILE \
    --region $REGION \
    --no-cli-pager 2>&1)
  SSM_EXIT_CODE=$?
  set -e  # Re-enable exit on error

  if [ $SSM_EXIT_CODE -ne 0 ]; then
    echo "❌ Failed to send command to instance"
    echo "Exit code: $SSM_EXIT_CODE"
    echo "Error output:"
    echo "$COMMAND_OUTPUT"
    echo ""
    echo "Possible causes:"
    echo "1. SSM agent not ready (wait 1-2 minutes after instance launch)"
    echo "2. IAM permissions issue (instance profile needs SSM permissions)"
    echo "3. Network connectivity issue"
    echo ""
    rm -f $TEST_COMMANDS_FILE
    exit 1
  fi

  COMMAND_ID=$(echo "$COMMAND_OUTPUT" | grep -o '"CommandId":"[^"]*' | head -1 | cut -d'"' -f4 || echo "")

  if [ -z "$COMMAND_ID" ]; then
    echo "❌ Failed to get command ID from SSM"
    rm -f $TEST_COMMANDS_FILE
    exit 1
  fi

  echo "Command ID: $COMMAND_ID"
  echo "Waiting for command to complete (this may take a few minutes)..."

  # Wait for command to complete
  MAX_WAIT=600  # 10 minutes
  ELAPSED=0
  while [ $ELAPSED -lt $MAX_WAIT ]; do
    STATUS=$(aws ssm get-command-invocation \
      --command-id "$COMMAND_ID" \
      --instance-id "$INSTANCE_ID" \
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
    --instance-id "$INSTANCE_ID" \
    --query "StandardOutputContent" \
    --output text \
    --profile $PROFILE \
    --region $REGION \
    --no-cli-pager 2>/dev/null || echo "")

  echo "$OUTPUT"

  # Get error output if any
  ERROR_OUTPUT=$(aws ssm get-command-invocation \
    --command-id "$COMMAND_ID" \
    --instance-id "$INSTANCE_ID" \
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
    --instance-id "$INSTANCE_ID" \
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
    exit 0
  else
    echo "❌ Tests failed or encountered errors"
    echo "=========================================="
    echo ""
    echo "Exit Code: $EXIT_CODE"
    echo "Status: $STATUS"
    echo ""
    echo "Instance retained for debugging"
    echo "Connect with: aws ssm start-session --target $INSTANCE_ID --profile $PROFILE --region $REGION"
    exit 1
  fi
}

# Function to teardown instance
teardown_instance() {
  echo "=========================================="
  echo "Terminating test runner instance"
  echo "=========================================="
  
  INSTANCE_ID=$(get_instance_id)
  
  if [ -z "$INSTANCE_ID" ] || [ "$INSTANCE_ID" == "None" ]; then
    echo "No test runner instance found to terminate"
    return
  fi

  echo "Instance ID: $INSTANCE_ID"
  echo ""
  
  # Allow non-interactive teardown if FORCE_TEARDOWN is set or if running non-interactively
  if [ "${FORCE_TEARDOWN:-false}" != "true" ] && [ -t 0 ]; then
    read -p "Are you sure you want to terminate this instance? (yes/no): " CONFIRM
    
    if [ "$CONFIRM" != "yes" ]; then
      echo "Cancelled"
      return
    fi
  else
    echo "Terminating instance (non-interactive mode)..."
  fi

  echo "Terminating instance..."
  aws ec2 terminate-instances \
    --instance-ids $INSTANCE_ID \
    --profile $PROFILE \
    --region $REGION \
    --no-cli-pager

  echo "Waiting for instance to terminate..."
  aws ec2 wait instance-terminated \
    --instance-ids $INSTANCE_ID \
    --profile $PROFILE \
    --region $REGION \
    --no-cli-pager

  # Remove instance ID from .env.test-runner
  if [ -f .env.test-runner ]; then
    sed -i.bak '/^TEST_RUNNER_INSTANCE_ID=/d' .env.test-runner
    rm -f .env.test-runner.bak
  fi

  echo ""
  echo "✅ Instance terminated"
}

# Function to show help
show_help() {
  cat << EOF
Usage: ./scripts/common/manage-test-runner-instance.sh [ACTION]

Actions:
  launch    Launch and configure a new EC2 test runner instance
  status    Check the status of the test runner instance
  connect   Show connection instructions for the instance
  test      Run Phase 2 integration tests on the instance
  teardown  Terminate the test runner instance
  help      Show this help message

Examples:
  # Launch instance
  ./scripts/common/manage-test-runner-instance.sh launch

  # Check status
  ./scripts/common/manage-test-runner-instance.sh status

  # Show connection info
  ./scripts/common/manage-test-runner-instance.sh connect

  # Run tests
  export REPO_URL="https://github.com/your-org/cc-native.git"
  ./scripts/common/manage-test-runner-instance.sh test

  # Terminate instance
  ./scripts/common/manage-test-runner-instance.sh teardown

Prerequisites:
  - Run ./scripts/common/setup-test-runner-prerequisites.sh first
  - Ensure .env and .env.test-runner files exist

Environment Variables:
  AL2023_VERSION    Optional: Specify Amazon Linux 2023 release version (e.g., "2023.10.20260105")
                    If not set, uses the latest available AMI
                    See: https://docs.aws.amazon.com/linux/al2023/release-notes/relnotes.html

Examples:
  # Use specific AMI version
  AL2023_VERSION="2023.10.20260105" ./scripts/common/manage-test-runner-instance.sh launch

  # Use latest AMI (default)
  ./scripts/common/manage-test-runner-instance.sh launch

EOF
}

# Main action handler
case "$ACTION" in
  launch)
    launch_instance
    ;;
  status)
    check_status
    ;;
  connect)
    show_connection_info
    ;;
  test)
    run_tests
    ;;
  teardown)
    teardown_instance
    ;;
  help|--help|-h)
    show_help
    ;;
  *)
    echo "Unknown action: $ACTION"
    echo ""
    show_help
    exit 1
    ;;
esac
