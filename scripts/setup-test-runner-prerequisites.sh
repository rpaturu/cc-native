#!/bin/bash
# setup-test-runner-prerequisites.sh
# Sets up all prerequisites for running integration tests on EC2:
# - Security group (SSH and Neptune access)
# - IAM role and instance profile (Neptune, DynamoDB, S3, EventBridge permissions)
# - Stores configuration in .env.test-runner for later use

set -e

PROFILE="${AWS_PROFILE:-cc-native-account}"
REGION="${AWS_REGION:-us-west-2}"
STACK_NAME="CCNativeStack"

# Load .env file if it exists
if [ -f .env ]; then
  source .env
fi

echo "=========================================="
echo "Setting up test runner prerequisites"
echo "=========================================="
echo "AWS Profile: $PROFILE"
echo "AWS Region: $REGION"
echo ""

# Get VPC ID (from .env or query CloudFormation)
if [ -z "$VPC_ID" ]; then
  echo "VPC_ID not found in .env, querying CloudFormation..."
  VPC_ID=$(aws cloudformation describe-stacks \
    --stack-name $STACK_NAME \
    --query "Stacks[0].Outputs[?OutputKey=='VpcId'].OutputValue" \
    --output text \
    --profile $PROFILE \
    --region $REGION \
    --no-cli-pager)
fi

if [ -z "$VPC_ID" ]; then
  echo "Error: Could not determine VPC ID"
  exit 1
fi

# Get Neptune cluster ID
if [ -z "$NEPTUNE_CLUSTER_ID" ]; then
  NEPTUNE_CLUSTER_ID=$(aws cloudformation describe-stacks \
    --stack-name $STACK_NAME \
    --query "Stacks[0].Outputs[?OutputKey=='NeptuneClusterIdentifier'].OutputValue" \
    --output text \
    --profile $PROFILE \
    --region $REGION \
    --no-cli-pager)
fi

# Get account ID
ACCOUNT_ID=$(aws sts get-caller-identity \
  --query "Account" \
  --output text \
  --profile $PROFILE \
  --no-cli-pager)

echo "VPC ID: $VPC_ID"
echo "Neptune Cluster ID: $NEPTUNE_CLUSTER_ID"
echo "Account ID: $ACCOUNT_ID"
echo ""

# ==========================================
# Step 1: Create Security Group
# ==========================================
echo "Step 1: Creating security group..."

MY_IP=$(curl -s https://checkip.amazonaws.com)
echo "Your IP: $MY_IP"

SG_ID=$(aws ec2 create-security-group \
  --group-name cc-native-test-runner-sg \
  --description "Security group for integration test runner - allows SSH from your IP" \
  --vpc-id $VPC_ID \
  --query "GroupId" \
  --output text \
  --profile $PROFILE \
  --region $REGION \
  --no-cli-pager 2>/dev/null || \
  aws ec2 describe-security-groups \
    --filters "Name=group-name,Values=cc-native-test-runner-sg" "Name=vpc-id,Values=$VPC_ID" \
    --query "SecurityGroups[0].GroupId" \
    --output text \
    --profile $PROFILE \
    --region $REGION \
    --no-cli-pager)

if [ -z "$SG_ID" ] || [ "$SG_ID" == "None" ]; then
  echo "Error: Could not create or find security group"
  exit 1
fi

echo "Security Group ID: $SG_ID"

# Allow SSH from your IP (idempotent)
echo "Adding SSH rule (port 22) from your IP..."
aws ec2 authorize-security-group-ingress \
  --group-id $SG_ID \
  --protocol tcp \
  --port 22 \
  --cidr $MY_IP/32 \
  --profile $PROFILE \
  --region $REGION \
  --no-cli-pager 2>/dev/null || echo "  ✓ SSH rule may already exist"

# Get Neptune security group ID
echo "Finding Neptune security group..."
NEPTUNE_SG_ID=$(aws ec2 describe-security-groups \
  --filters "Name=group-name,Values=*NeptuneSecurityGroup*" "Name=vpc-id,Values=$VPC_ID" \
  --query "SecurityGroups[0].GroupId" \
  --output text \
  --profile $PROFILE \
  --region $REGION \
  --no-cli-pager)

if [ -z "$NEPTUNE_SG_ID" ] || [ "$NEPTUNE_SG_ID" == "None" ]; then
  echo "Warning: Could not find Neptune security group"
  echo "You may need to manually allow access from security group $SG_ID to Neptune on port 8182"
else
  echo "Neptune Security Group ID: $NEPTUNE_SG_ID"
  
  # Allow test runner to connect to Neptune (port 8182)
  echo "Adding rule to allow test runner to access Neptune (port 8182)..."
  aws ec2 authorize-security-group-ingress \
    --group-id $NEPTUNE_SG_ID \
    --protocol tcp \
    --port 8182 \
    --source-group $SG_ID \
    --profile $PROFILE \
    --region $REGION \
    --no-cli-pager 2>/dev/null || echo "  ✓ Neptune access rule may already exist"
fi

echo "✓ Security group setup complete"
echo ""

# ==========================================
# Step 2: Create IAM Role and Instance Profile
# ==========================================
echo "Step 2: Creating IAM role and instance profile..."

# Create IAM role for EC2 instance
echo "Creating IAM role..."
aws iam create-role \
  --role-name cc-native-test-runner-role \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [
      {
        "Effect": "Allow",
        "Principal": {
          "Service": "ec2.amazonaws.com"
        },
        "Action": "sts:AssumeRole"
      }
    ]
  }' \
  --profile $PROFILE \
  --no-cli-pager 2>/dev/null || echo "  ✓ IAM role may already exist"

# Create policy for Neptune, DynamoDB, S3, and EventBridge access
echo "Creating IAM policy..."
POLICY_FILE="/tmp/neptune-test-policy-$$.json"
cat > $POLICY_FILE << EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "neptune-db:connect",
        "neptune-db:ReadDataViaQuery",
        "neptune-db:WriteDataViaQuery"
      ],
      "Resource": "arn:aws:neptune-db:$REGION:$ACCOUNT_ID:$NEPTUNE_CLUSTER_ID/*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "dynamodb:GetItem",
        "dynamodb:PutItem",
        "dynamodb:UpdateItem",
        "dynamodb:DeleteItem",
        "dynamodb:Query",
        "dynamodb:Scan",
        "dynamodb:BatchGetItem",
        "dynamodb:BatchWriteItem"
      ],
      "Resource": [
        "arn:aws:dynamodb:$REGION:$ACCOUNT_ID:table/cc-native-*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::cc-native-*",
        "arn:aws:s3:::cc-native-*/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "events:PutEvents"
      ],
      "Resource": "arn:aws:events:$REGION:$ACCOUNT_ID:event-bus/cc-native-events"
    }
  ]
}
EOF

# Attach policy to role
aws iam put-role-policy \
  --role-name cc-native-test-runner-role \
  --policy-name NeptuneTestRunnerPolicy \
  --policy-document file://$POLICY_FILE \
  --profile $PROFILE \
  --no-cli-pager

# Clean up temp file
rm -f $POLICY_FILE

echo "  ✓ IAM policy attached"

# Create instance profile
echo "Creating instance profile..."
aws iam create-instance-profile \
  --instance-profile-name cc-native-test-instance-profile \
  --profile $PROFILE \
  --no-cli-pager 2>/dev/null || echo "  ✓ Instance profile may already exist"

# Attach role to instance profile
aws iam add-role-to-instance-profile \
  --instance-profile-name cc-native-test-instance-profile \
  --role-name cc-native-test-runner-role \
  --profile $PROFILE \
  --no-cli-pager 2>/dev/null || echo "  ✓ Role may already be attached to instance profile"

echo "  ✓ Waiting for instance profile to propagate..."
sleep 10

echo "✓ IAM role and instance profile setup complete"
echo ""

# ==========================================
# Save configuration to .env.test-runner
# ==========================================
ENV_FILE=".env.test-runner"
cat > $ENV_FILE << EOF
# Test Runner Configuration
# Generated by setup-test-runner-prerequisites.sh on $(date)

TEST_RUNNER_SECURITY_GROUP_ID=$SG_ID
TEST_RUNNER_MY_IP=$MY_IP
TEST_RUNNER_IAM_ROLE_NAME=cc-native-test-runner-role
TEST_RUNNER_INSTANCE_PROFILE_NAME=cc-native-test-instance-profile
EOF

if [ -n "$NEPTUNE_SG_ID" ] && [ "$NEPTUNE_SG_ID" != "None" ]; then
  echo "NEPTUNE_SECURITY_GROUP_ID=$NEPTUNE_SG_ID" >> $ENV_FILE
fi

echo "=========================================="
echo "✅ Prerequisites setup complete!"
echo "=========================================="
echo ""
echo "Configuration saved to: $ENV_FILE"
echo ""
echo "Summary:"
echo "  Security Group ID: $SG_ID"
echo "  IAM Role: cc-native-test-runner-role"
echo "  Instance Profile: cc-native-test-instance-profile"
echo ""
echo "You can load these variables with:"
echo "  source $ENV_FILE"
echo ""
echo "Next step: Create a key pair (Step 2c) and launch EC2 instance (Step 3)"
