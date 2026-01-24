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

# Load configuration files
if [ -f .env ]; then
  source .env
fi

if [ -f .env.test-runner ]; then
  source .env.test-runner
else
  echo "Error: .env.test-runner not found. Run ./scripts/setup-test-runner-prerequisites.sh first"
  exit 1
fi

# Validate required variables
if [ -z "$TEST_RUNNER_SECURITY_GROUP_ID" ] || [ -z "$TEST_RUNNER_INSTANCE_PROFILE_NAME" ] || [ -z "$TEST_RUNNER_KEY_NAME" ]; then
  echo "Error: Missing required configuration. Run ./scripts/setup-test-runner-prerequisites.sh first"
  exit 1
fi

if [ -z "$NEPTUNE_SUBNET_ID" ]; then
  echo "Error: NEPTUNE_SUBNET_ID not found in .env"
  exit 1
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

  # Get latest Amazon Linux 2023 AMI ID
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

  echo "Using AMI: $AMI_ID"
  echo ""

  # Launch instance
  echo "Launching instance..."
  INSTANCE_ID=$(aws ec2 run-instances \
    --image-id $AMI_ID \
    --instance-type t3.micro \
    --subnet-id $NEPTUNE_SUBNET_ID \
    --security-group-ids $TEST_RUNNER_SECURITY_GROUP_ID \
    --iam-instance-profile Name=$TEST_RUNNER_INSTANCE_PROFILE_NAME \
    --key-name $TEST_RUNNER_KEY_NAME \
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
  echo "⚠️  Note: Configuration must be done manually via SSH"
  echo ""
  echo "Once connected, run these commands:"
  echo ""
  echo "# Install Node.js 20"
  echo "curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash"
  echo "source ~/.bashrc"
  echo "nvm install 20"
  echo "nvm use 20"
  echo ""
  echo "# Install git"
  echo "sudo yum install -y git"
  echo ""
  echo "# Clone repository"
  echo "git clone <YOUR_REPO_URL>"
  echo "cd cc-native"
  echo ""
  echo "# Install dependencies"
  echo "npm install"
  echo ""
  echo "# Copy .env file (from your local machine)"
  echo "# The instance will use IAM role for AWS credentials"
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
    echo "  ./scripts/manage-test-runner-instance.sh launch"
    return
  fi

  show_connection_info $INSTANCE_ID
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
  
  # Allow non-interactive teardown if FORCE_TEARDOWN is set
  if [ "${FORCE_TEARDOWN:-false}" != "true" ]; then
    read -p "Are you sure you want to terminate this instance? (yes/no): " CONFIRM
    
    if [ "$CONFIRM" != "yes" ]; then
      echo "Cancelled"
      return
    fi
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
Usage: ./scripts/manage-test-runner-instance.sh [ACTION]

Actions:
  launch    Launch and configure a new EC2 test runner instance
  status    Check the status of the test runner instance
  connect   Show connection instructions for the instance
  teardown  Terminate the test runner instance
  help      Show this help message

Examples:
  # Launch instance
  ./scripts/manage-test-runner-instance.sh launch

  # Check status
  ./scripts/manage-test-runner-instance.sh status

  # Show connection info
  ./scripts/manage-test-runner-instance.sh connect

  # Terminate instance
  ./scripts/manage-test-runner-instance.sh teardown

Prerequisites:
  - Run ./scripts/setup-test-runner-prerequisites.sh first
  - Ensure .env and .env.test-runner files exist

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
