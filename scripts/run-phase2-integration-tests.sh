#!/bin/bash
# run-phase2-integration-tests.sh
# Complete workflow for running Phase 2 integration tests:
# 1. Set up prerequisites (security group, IAM role, key pair)
# 2. Launch EC2 test runner instance
# 3. Wait for instance to be ready
# 4. Connect and run tests (manual step - user connects and runs tests)
# 5. Optionally teardown instance

set -e

PROFILE="${AWS_PROFILE:-cc-native-account}"
REGION="${AWS_REGION:-us-west-2}"
TEARDOWN="${TEARDOWN:-false}"

echo "=========================================="
echo "Phase 2 Integration Test Workflow"
echo "=========================================="
echo ""

# Step 1: Set up prerequisites
echo "Step 1: Setting up prerequisites..."
if ! ./scripts/setup-test-runner-prerequisites.sh; then
  echo "❌ Failed to set up prerequisites"
  exit 1
fi
echo ""

# Step 2: Launch instance
echo "Step 2: Launching test runner instance..."
if ! ./scripts/manage-test-runner-instance.sh launch; then
  echo "❌ Failed to launch instance"
  exit 1
fi
echo ""

# Load instance ID
source .env.test-runner
if [ -z "$TEST_RUNNER_INSTANCE_ID" ]; then
  echo "❌ Instance ID not found in .env.test-runner"
  exit 1
fi

echo "=========================================="
echo "✅ Instance is ready!"
echo "=========================================="
echo ""
echo "Instance ID: $TEST_RUNNER_INSTANCE_ID"
echo ""
echo "Next steps:"
echo "1. Connect to the instance using Session Manager:"
echo "   aws ssm start-session --target $TEST_RUNNER_INSTANCE_ID --profile $PROFILE --region $REGION"
echo ""
echo "2. On the instance, configure and run tests:"
echo "   # Install Node.js 20"
echo "   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash"
echo "   source ~/.bashrc"
echo "   nvm install 20"
echo "   nvm use 20"
echo ""
echo "   # Install git"
echo "   sudo yum install -y git"
echo ""
echo "   # Clone repository"
echo "   git clone <YOUR_REPO_URL>"
echo "   cd cc-native"
echo ""
echo "   # Install dependencies"
echo "   npm install"
echo ""
echo "   # Run tests"
echo "   npm test -- src/tests/integration/phase2.test.ts"
echo ""
echo "3. When done, teardown the instance:"
echo "   ./scripts/manage-test-runner-instance.sh teardown"
echo ""

# Optionally wait for user to complete tests and teardown
if [ "$TEARDOWN" = "true" ]; then
  echo "Waiting for tests to complete..."
  echo "Press Enter when tests are done to teardown the instance..."
  read
  
  echo ""
  echo "Step 3: Tearing down instance..."
  ./scripts/manage-test-runner-instance.sh teardown
fi
