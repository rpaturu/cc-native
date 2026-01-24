# Running Neptune Integration Tests

Neptune is deployed in **isolated VPC subnets** (no internet access), which means it's only accessible from resources within the same VPC. This guide shows you how to set up an EC2 instance in your VPC to run the Phase 2 integration tests.

## Prerequisites

1. **Infrastructure Deployed**: Run `./deploy` to deploy the CDK stack
   - This creates the `.env` file with all required environment variables
   - See [TEST_SCRIPT_DEPENDENCIES.md](./TEST_SCRIPT_DEPENDENCIES.md) for complete dependency list

2. **Environment Variables**: The `.env` file should be populated with:
   - `NEPTUNE_CLUSTER_ENDPOINT`
   - `NEPTUNE_CLUSTER_PORT`
   - `ACCOUNT_POSTURE_STATE_TABLE_NAME`
   - `GRAPH_MATERIALIZATION_STATUS_TABLE_NAME`
   - `VPC_ID` and `NEPTUNE_SUBNET_ID` (for test runner setup)
   - Other required AWS resource names

3. **AWS Credentials**: Configured with the `cc-native-account` profile (or your profile name)
   ```bash
   aws sts get-caller-identity --profile cc-native-account
   ```

**Note**: The test scripts can automatically set up prerequisites (security group, IAM role, key pair) if you use `run-phase2-integration-tests.sh`. See [TEST_SCRIPT_DEPENDENCIES.md](./TEST_SCRIPT_DEPENDENCIES.md) for details.

## Setup and Run Integration Tests

This guide walks you through setting up an EC2 instance in your VPC to run Neptune integration tests.

### Step 1: Get VPC Information

The VPC ID and subnet IDs are automatically stored in your `.env` file after running `./deploy`. You can use them directly:

```bash
# Load from .env file
source .env
echo "VPC ID: $VPC_ID"
echo "Subnet IDs: $NEPTUNE_SUBNET_IDS"
echo "First Subnet ID: $NEPTUNE_SUBNET_ID"
```

### Step 2: Set Up Prerequisites

Before launching the EC2 instance, you need to set up:
1. Security group (allows SSH and Neptune access)
2. IAM role and instance profile (for AWS permissions)
3. Key pair (for SSH access)

#### Step 2a: Create Security Group and IAM Role

Run the prerequisites setup script:

```bash
./scripts/setup-test-runner-prerequisites.sh
```

This script will:
- Create a security group for the test runner
- Allow SSH (port 22) from your current IP address
- Allow the test runner to connect to Neptune (port 8182)
- Create IAM role with permissions for Neptune, DynamoDB, S3, and EventBridge
- Create instance profile and attach the IAM role
- Save all configuration to `.env.test-runner` file

The script uses values from your `.env` file (VPC ID, Neptune cluster ID) and stores the results in `.env.test-runner` for later use.

**Load the configuration**:
```bash
source .env.test-runner
echo "Security Group ID: $TEST_RUNNER_SECURITY_GROUP_ID"
echo "IAM Role: $TEST_RUNNER_IAM_ROLE_NAME"
echo "Instance Profile: $TEST_RUNNER_INSTANCE_PROFILE_NAME"
```

#### Step 2b: Key Pair Setup

The prerequisites script automatically handles key pair setup:
- Creates a new key pair `cc-native-test-runner-key` if it doesn't exist
- Reuses existing key pair if it's already in AWS
- Saves the key to `~/.ssh/cc-native-test-runner-key.pem` (if creating new)
- Stores key name in `.env.test-runner` for later use

**Note**: If the key pair already exists in AWS but you don't have the local `.pem` file, you'll need to either:
- Use a different key pair that you have locally, or
- Download the key from AWS (if you have access to it)

### Step 3: Launch and Configure EC2 Instance

Use the management script to launch the instance:

```bash
./scripts/manage-test-runner-instance.sh launch
```

This script will:
- Launch an EC2 instance with all prerequisites configured
- Wait for the instance to be running
- Show connection instructions
- Save the instance ID to `.env.test-runner`

**Check instance status**:
```bash
./scripts/manage-test-runner-instance.sh status
```

**Show connection instructions**:
```bash
./scripts/manage-test-runner-instance.sh connect
```

**Connect to the instance**:

Since the instance is in an isolated subnet (no public IP), use AWS Systems Manager Session Manager:

```bash
# Load instance ID
source .env.test-runner

# Connect via Session Manager
aws ssm start-session \
  --target $TEST_RUNNER_INSTANCE_ID \
  --profile cc-native-account \
  --region us-west-2
```

**Configure the instance** (once connected):

```bash
# Install Node.js 20
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
source ~/.bashrc
nvm install 20
nvm use 20

# Install git
sudo yum install -y git

# Clone your repository
git clone <YOUR_REPO_URL>
cd cc-native

# Install dependencies
npm install

# Copy .env file (from your local machine)
# The instance uses IAM role for AWS credentials, so no manual AWS config needed
```

### Step 4: Run Tests

Once connected to the instance and configured:

```bash
# Run Phase 2 integration tests
npm test -- src/tests/integration/phase2.test.ts

# Or run all tests
npm test
```

### Step 5: Teardown Instance

After testing is complete, terminate the instance:

```bash
./scripts/manage-test-runner-instance.sh teardown
```

This will:
- Terminate the EC2 instance
- Wait for termination to complete
- Remove the instance ID from `.env.test-runner`



## Troubleshooting

### Tests Skip with "Neptune not accessible"

This means the health check query timed out. Verify:
1. Security groups allow traffic on port 8182
2. EC2 instance is in the same VPC as Neptune
3. IAM permissions are correct
4. Neptune cluster is in `available` state

### Connection Timeout

```bash
# Check Neptune cluster status
aws neptune describe-db-clusters \
  --db-cluster-identifier cc-native-neptune-cluster \
  --profile cc-native-account \
  --region us-west-2

# Verify security group rules
aws ec2 describe-security-groups \
  --group-ids <NEPTUNE_SECURITY_GROUP_ID> \
  --profile cc-native-account \
  --region us-west-2
```

### Can't SSH to Instance

If your instance is in an isolated subnet (no public IP), you have two options:

1. **Use AWS Systems Manager Session Manager** (no SSH required):
   - Add `AmazonSSMManagedInstanceCore` policy to your IAM role
   - Connect via: `aws ssm start-session --target <INSTANCE_ID>`

2. **Use a Bastion Host**:
   - Launch an instance in a public subnet
   - SSH to bastion, then SSH to test runner from bastion

## Quick Reference: All Prerequisites in One Script

Here's a complete script that sets up all prerequisites:

```bash
#!/bin/bash
# setup-test-runner-prerequisites.sh

set -e

PROFILE="cc-native-account"
REGION="us-west-2"
STACK_NAME="CCNativeStack"
KEY_NAME="cc-native-test-runner-key"

# Load .env if available
if [ -f .env ]; then
  source .env
fi

# Get VPC ID
if [ -z "$VPC_ID" ]; then
  VPC_ID=$(aws cloudformation describe-stacks \
    --stack-name $STACK_NAME \
    --query "Stacks[0].Outputs[?OutputKey=='VpcId'].OutputValue" \
    --output text \
    --profile $PROFILE \
    --region $REGION)
fi

# Get subnet ID
if [ -z "$NEPTUNE_SUBNET_ID" ]; then
  NEPTUNE_SUBNET_ID=$(aws cloudformation describe-stacks \
    --stack-name $STACK_NAME \
    --query "Stacks[0].Outputs[?OutputKey=='NeptuneSubnetId'].OutputValue" \
    --output text \
    --profile $PROFILE \
    --region $REGION)
fi

# Get Neptune cluster ID
NEPTUNE_CLUSTER_ID=$(aws cloudformation describe-stacks \
  --stack-name $STACK_NAME \
  --query "Stacks[0].Outputs[?OutputKey=='NeptuneClusterIdentifier'].OutputValue" \
  --output text \
  --profile $PROFILE \
  --region $REGION)

# Get account ID
ACCOUNT_ID=$(aws sts get-caller-identity \
  --query "Account" \
  --output text \
  --profile $PROFILE)

echo "VPC ID: $VPC_ID"
echo "Subnet ID: $NEPTUNE_SUBNET_ID"
echo "Neptune Cluster ID: $NEPTUNE_CLUSTER_ID"
echo "Account ID: $ACCOUNT_ID"

# 1. Create Security Group
echo "Creating security group..."
MY_IP=$(curl -s https://checkip.amazonaws.com)
echo "Your IP: $MY_IP"

SG_ID=$(aws ec2 create-security-group \
  --group-name cc-native-test-runner-sg \
  --description "Security group for integration test runner" \
  --vpc-id $VPC_ID \
  --query "GroupId" \
  --output text \
  --profile $PROFILE \
  --region $REGION 2>/dev/null || \
  aws ec2 describe-security-groups \
    --filters "Name=group-name,Values=cc-native-test-runner-sg" "Name=vpc-id,Values=$VPC_ID" \
    --query "SecurityGroups[0].GroupId" \
    --output text \
    --profile $PROFILE \
    --region $REGION)

echo "Security Group ID: $SG_ID"

# Allow SSH from your IP
aws ec2 authorize-security-group-ingress \
  --group-id $SG_ID \
  --protocol tcp \
  --port 22 \
  --cidr $MY_IP/32 \
  --profile $PROFILE \
  --region $REGION 2>/dev/null || echo "SSH rule may already exist"

# Allow access to Neptune
NEPTUNE_SG_ID=$(aws ec2 describe-security-groups \
  --filters "Name=group-name,Values=*NeptuneSecurityGroup*" "Name=vpc-id,Values=$VPC_ID" \
  --query "SecurityGroups[0].GroupId" \
  --output text \
  --profile $PROFILE \
  --region $REGION)

aws ec2 authorize-security-group-ingress \
  --group-id $NEPTUNE_SG_ID \
  --protocol tcp \
  --port 8182 \
  --source-group $SG_ID \
  --profile $PROFILE \
  --region $REGION 2>/dev/null || echo "Neptune rule may already exist"

# 2. Create IAM Role
echo "Creating IAM role..."
aws iam create-role \
  --role-name cc-native-test-runner-role \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Principal": {"Service": "ec2.amazonaws.com"},
      "Action": "sts:AssumeRole"
    }]
  }' \
  --profile $PROFILE 2>/dev/null || echo "IAM role may already exist"

# Create and attach policy
cat > /tmp/neptune-test-policy.json << EOF
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
      "Action": ["dynamodb:*"],
      "Resource": "arn:aws:dynamodb:$REGION:$ACCOUNT_ID:table/cc-native-*"
    },
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject", "s3:ListBucket"],
      "Resource": ["arn:aws:s3:::cc-native-*", "arn:aws:s3:::cc-native-*/*"]
    },
    {
      "Effect": "Allow",
      "Action": ["events:PutEvents"],
      "Resource": "arn:aws:events:$REGION:$ACCOUNT_ID:event-bus/cc-native-events"
    }
  ]
}
EOF

aws iam put-role-policy \
  --role-name cc-native-test-runner-role \
  --policy-name NeptuneTestRunnerPolicy \
  --policy-document file:///tmp/neptune-test-policy.json \
  --profile $PROFILE

# 3. Create Instance Profile
echo "Creating instance profile..."
aws iam create-instance-profile \
  --instance-profile-name cc-native-test-instance-profile \
  --profile $PROFILE 2>/dev/null || echo "Instance profile may already exist"

aws iam add-role-to-instance-profile \
  --instance-profile-name cc-native-test-instance-profile \
  --role-name cc-native-test-runner-role \
  --profile $PROFILE 2>/dev/null || echo "Role may already be attached"

# 4. Create Key Pair
echo "Creating key pair..."
aws ec2 create-key-pair \
  --key-name $KEY_NAME \
  --query "KeyMaterial" \
  --output text \
  --profile $PROFILE \
  --region $REGION > ~/.ssh/$KEY_NAME.pem 2>/dev/null || echo "Key pair may already exist"

if [ -f ~/.ssh/$KEY_NAME.pem ]; then
  chmod 400 ~/.ssh/$KEY_NAME.pem
  echo "Key pair saved to ~/.ssh/$KEY_NAME.pem"
fi

echo ""
echo "✅ Prerequisites setup complete!"
echo ""
echo "Summary:"
echo "  Security Group ID: $SG_ID (saved to .env.test-runner)"
echo "  IAM Role: cc-native-test-runner-role"
echo "  Instance Profile: cc-native-test-instance-profile"
echo "  Key Pair: $KEY_NAME"
echo ""
echo "You can now launch an EC2 instance with:"
echo "  source .env.test-runner"
echo "  --subnet-id $NEPTUNE_SUBNET_ID"
echo "  --security-group-ids \$TEST_RUNNER_SECURITY_GROUP_ID"
echo "  --iam-instance-profile Name=cc-native-test-instance-profile"
echo "  --key-name $KEY_NAME"
```

Save this script as `setup-test-runner-prerequisites.sh`, make it executable, and run it:

```bash
chmod +x setup-test-runner-prerequisites.sh
./setup-test-runner-prerequisites.sh
```


## Quick Start

### Option 1: Automated Workflow Script

Run the complete workflow with a single command:

```bash
# Full workflow (setup prerequisites, launch instance, run tests)
./scripts/run-phase2-integration-tests.sh --repo-url https://github.com/your-org/cc-native.git
```

This script will:
1. Set up all prerequisites (security group, IAM role, key pair) - **optional, can be skipped**
2. Launch the EC2 instance (or reuse existing if already running)
3. Configure instance (install Node.js, clone repo, install dependencies)
4. Run Phase 2 integration tests remotely via SSM
5. **Conditionally teardown**: Only if all tests pass
   - ✅ **Tests pass** → Instance automatically terminated
   - ❌ **Tests fail** → Instance retained for debugging

**Command-Line Options**:
- `--repo-url URL` - Git repository URL (required if repo not on instance)
- `--skip-prerequisites` - Skip prerequisites setup (use existing security group, IAM role, key pair)
- `--setup-prerequisites` - Explicitly run prerequisites setup (default: runs if not skipped)
- `--skip-launch` - Skip instance launch (use existing instance)
- `--profile PROFILE` - AWS profile (default: cc-native-account)
- `--region REGION` - AWS region (default: us-west-2)
- `--help, -h` - Show help message

**Examples**:
```bash
# Full workflow (first time - sets up everything)
./scripts/run-phase2-integration-tests.sh --repo-url https://github.com/your-org/cc-native.git

# Skip prerequisites (already set up)
./scripts/run-phase2-integration-tests.sh --skip-prerequisites --repo-url https://github.com/your-org/cc-native.git

# Use existing instance and skip prerequisites
./scripts/run-phase2-integration-tests.sh --skip-prerequisites --skip-launch --repo-url https://github.com/your-org/cc-native.git

# Show all options
./scripts/run-phase2-integration-tests.sh --help
```

**Environment Variables** (alternative to command-line options):
- `REPO_URL` - Git repository URL (required for first run)
- `SKIP_PREREQUISITES=true` - Skip prerequisites setup (use existing)
- `SKIP_LAUNCH=true` - Skip launch (use existing instance)
- `AWS_PROFILE` - AWS profile name
- `AWS_REGION` - AWS region

### Option 2: Manual Step-by-Step

```bash
# 1. Set up prerequisites
./scripts/setup-test-runner-prerequisites.sh

# 2. Launch instance
./scripts/manage-test-runner-instance.sh launch

# 3. Connect and run tests (see Step 4)

# 4. Teardown when done
./scripts/manage-test-runner-instance.sh teardown
```

The tests will automatically detect if Neptune is accessible and skip gracefully if not, so you can verify your setup is working correctly.
