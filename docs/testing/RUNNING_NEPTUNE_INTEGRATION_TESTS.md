# Running Neptune Integration Tests

Neptune is deployed in **isolated VPC subnets** (no internet access), which means it's only accessible from resources within the same VPC. This guide covers several methods to run the Phase 2 integration tests that require Neptune access.

## Prerequisites

1. **Infrastructure Deployed**: Run `./deploy` to deploy the CDK stack
2. **Environment Variables**: The `.env` file should be populated with:
   - `NEPTUNE_CLUSTER_ENDPOINT`
   - `NEPTUNE_CLUSTER_PORT`
   - `ACCOUNT_POSTURE_STATE_TABLE_NAME`
   - `GRAPH_MATERIALIZATION_STATUS_TABLE_NAME`
   - Other required AWS resource names

3. **AWS Credentials**: Configured with the `cc-native-account` profile (or your profile name)

## Method 1: EC2 Instance in VPC (Recommended)

This is the most straightforward approach for running tests.

### Step 1: Get VPC Information

The VPC ID and subnet IDs are automatically stored in your `.env` file after running `./deploy`. You can use them directly:

```bash
# Load from .env file
source .env
echo "VPC ID: $VPC_ID"
echo "Subnet IDs: $NEPTUNE_SUBNET_IDS"
echo "First Subnet ID: $NEPTUNE_SUBNET_ID"
```

Alternatively, you can query them from CloudFormation:

```bash
# Get VPC ID from stack outputs
aws cloudformation describe-stacks \
  --stack-name CCNativeStack \
  --query "Stacks[0].Outputs[?OutputKey=='VpcId'].OutputValue" \
  --output text \
  --profile cc-native-account \
  --region us-west-2

# Get subnet IDs (comma-separated)
aws cloudformation describe-stacks \
  --stack-name CCNativeStack \
  --query "Stacks[0].Outputs[?OutputKey=='NeptuneSubnetIds'].OutputValue" \
  --output text \
  --profile cc-native-account \
  --region us-west-2

# Or get individual subnet details
aws ec2 describe-subnets \
  --filters "Name=vpc-id,Values=<VPC_ID>" \
  --query "Subnets[*].[SubnetId,AvailabilityZone]" \
  --output table \
  --profile cc-native-account \
  --region us-west-2
```

### Step 2: Launch EC2 Instance

```bash
# Launch an EC2 instance in one of the isolated subnets
aws ec2 run-instances \
  --image-id ami-0c65adc9a5c1b5d7c \  # Amazon Linux 2023 (adjust for your region)
  --instance-type t3.micro \
  --subnet-id <SUBNET_ID> \
  --security-group-ids <SECURITY_GROUP_ID> \
  --iam-instance-profile Name=cc-native-test-instance-profile \
  --key-name <YOUR_KEY_PAIR> \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=cc-native-test-runner}]' \
  --profile cc-native-account \
  --region us-west-2
```

**Note**: You'll need to:
- Create a security group that allows SSH (port 22) from your IP
- Create an IAM instance profile with permissions to access Neptune, DynamoDB, etc.
- Have a key pair for SSH access

### Step 3: Configure EC2 Instance

```bash
# SSH into the instance
ssh -i <YOUR_KEY>.pem ec2-user@<EC2_PUBLIC_IP>

# Install Node.js 20
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
source ~/.bashrc
nvm install 20
nvm use 20

# Install git
sudo yum install -y git

# Clone your repository (or copy files)
git clone <YOUR_REPO_URL>
cd cc-native

# Install dependencies
npm install

# Configure AWS credentials (use IAM role or configure manually)
aws configure --profile cc-native-account

# Copy .env file or set environment variables
# The deploy script should have populated .env with Neptune endpoint
```

### Step 4: Run Tests

```bash
# Run Phase 2 integration tests
npm test -- src/tests/integration/phase2.test.ts

# Or run all tests
npm test
```

## Method 2: AWS Systems Manager Session Manager (No SSH Required)

This method doesn't require SSH keys or public IPs.

### Step 1: Create EC2 Instance with SSM Agent

```bash
# Launch instance with SSM access (IAM role must have SSM permissions)
aws ec2 run-instances \
  --image-id ami-0c65adc9a5c1b5d7c \
  --instance-type t3.micro \
  --subnet-id <SUBNET_ID> \
  --iam-instance-profile Name=cc-native-test-runner-with-ssm \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=cc-native-test-runner}]' \
  --profile cc-native-account \
  --region us-west-2
```

**IAM Role Requirements**:
- `AmazonSSMManagedInstanceCore` policy
- Neptune access permissions
- DynamoDB access permissions

### Step 2: Connect via Session Manager

```bash
# Get instance ID
INSTANCE_ID=$(aws ec2 describe-instances \
  --filters "Name=tag:Name,Values=cc-native-test-runner" \
  --query "Reservations[0].Instances[0].InstanceId" \
  --output text \
  --profile cc-native-account \
  --region us-west-2)

# Start session
aws ssm start-session \
  --target $INSTANCE_ID \
  --profile cc-native-account \
  --region us-west-2
```

### Step 3: Run Tests

Once connected, follow the same steps as Method 1 (install Node.js, clone repo, run tests).

## Method 3: Test Lambda Function

Create a Lambda function that runs the tests and invokes it.

### Step 1: Create Test Lambda Function

Create a new file: `src/handlers/testing/integration-test-runner.ts`

```typescript
import { Handler } from 'aws-lambda';

export const handler: Handler = async (event) => {
  // Import and run tests programmatically
  // This is more complex but allows running tests in Lambda environment
  // Note: Jest may not work well in Lambda, consider using a test framework
  // that can run in Lambda or use a container-based approach
};
```

### Step 2: Deploy Test Lambda

Add to CDK stack:

```typescript
const testRunner = new lambdaNodejs.NodejsFunction(this, 'TestRunner', {
  functionName: 'cc-native-integration-test-runner',
  entry: 'src/handlers/testing/integration-test-runner.ts',
  handler: 'handler',
  runtime: lambda.Runtime.NODEJS_20_X,
  timeout: cdk.Duration.minutes(15),
  memorySize: 3008,
  vpc: this.vpc,
  vpcSubnets: { subnets: this.vpc.isolatedSubnets },
  securityGroups: [neptuneLambdaSecurityGroup],
  environment: {
    NEPTUNE_CLUSTER_ENDPOINT: this.neptuneCluster.attrEndpoint,
    NEPTUNE_CLUSTER_PORT: this.neptuneCluster.attrPort,
    // ... other env vars
  },
});
```

### Step 3: Invoke Test Lambda

```bash
aws lambda invoke \
  --function-name cc-native-integration-test-runner \
  --payload '{}' \
  --profile cc-native-account \
  --region us-west-2 \
  response.json
```

**Note**: This approach requires adapting tests to run in Lambda (Jest may not work well). Consider using a container-based approach instead.

## Method 4: AWS Cloud9 IDE

AWS Cloud9 can be launched in your VPC.

### Step 1: Create Cloud9 Environment

```bash
aws cloud9 create-environment-ec2 \
  --name cc-native-test-environment \
  --instance-type t3.micro \
  --subnet-id <SUBNET_ID> \
  --automatic-stop-time-minutes 60 \
  --profile cc-native-account \
  --region us-west-2
```

### Step 2: Access Cloud9

1. Go to AWS Console → Cloud9
2. Open the environment
3. Clone repository and run tests in the Cloud9 terminal

## Method 5: VPN Connection

If you have a VPN connection to the VPC, you can run tests from your local machine.

### Prerequisites

1. VPN endpoint configured in your VPC
2. VPN client connected
3. Route tables configured to route Neptune traffic through VPN

### Run Tests Locally

Once VPN is connected:

```bash
# Verify you can reach Neptune (optional)
# The endpoint should resolve to a private IP

# Run tests
npm test -- src/tests/integration/phase2.test.ts
```

## Method 6: Bastion Host

Set up a bastion host in a public subnet that can access the isolated subnets.

### Step 1: Create Bastion Host

```bash
# Launch instance in public subnet (or create NAT gateway)
# Configure security groups to allow SSH from your IP
# Ensure bastion can reach isolated subnets
```

### Step 2: SSH Tunnel (if needed)

```bash
# Create SSH tunnel to Neptune (if direct access not possible)
ssh -L 8182:<NEPTUNE_PRIVATE_IP>:8182 ec2-user@<BASTION_IP>
```

### Step 3: Run Tests

SSH into bastion and run tests, or configure local tests to use the tunnel.

## Security Group Configuration

Ensure your test runner (EC2, Lambda, etc.) has a security group that:

1. **Allows outbound to Neptune**: Port 8182 (Gremlin)
2. **Allows outbound to DynamoDB**: HTTPS (443)
3. **Allows outbound to S3**: HTTPS (443)
4. **Allows SSH** (if using EC2): Port 22 from your IP

The Neptune security group should allow inbound from your test runner's security group on port 8182.

## IAM Permissions

Your test runner needs:

```json
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
      "Resource": "arn:aws:neptune-db:us-west-2:ACCOUNT_ID:cc-native-neptune-cluster/*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "dynamodb:*",
        "s3:*",
        "events:PutEvents"
      ],
      "Resource": "*"
    }
  ]
}
```

## Troubleshooting

### Tests Skip with "Neptune not accessible"

This means the health check query timed out. Verify:
1. Security groups allow traffic on port 8182
2. Test runner is in the same VPC or connected via VPN
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

### DNS Resolution Issues

Neptune endpoint should resolve to a private IP within the VPC. If using VPN, ensure DNS resolution is configured correctly.

## Recommended Approach

For **development/testing**: Use **Method 1 (EC2 Instance)** or **Method 2 (Session Manager)** - they're straightforward and allow interactive debugging.

For **CI/CD**: Consider **Method 3 (Test Lambda)** or use **AWS CodeBuild** with a VPC configuration.

For **quick testing**: Use **Method 4 (Cloud9)** if you need an IDE environment.

## Example: Complete EC2 Setup Script

```bash
#!/bin/bash
# setup-test-runner.sh

set -e

PROFILE="cc-native-account"
REGION="us-west-2"
STACK_NAME="CCNativeStack"

# Get VPC and subnet info
VPC_ID=$(aws cloudformation describe-stacks \
  --stack-name $STACK_NAME \
  --query "Stacks[0].Outputs[?OutputKey=='VpcId'].OutputValue" \
  --output text \
  --profile $PROFILE \
  --region $REGION)

SUBNET_ID=$(aws ec2 describe-subnets \
  --filters "Name=vpc-id,Values=$VPC_ID" "Name=tag:Name,Values=*NeptuneIsolated*" \
  --query "Subnets[0].SubnetId" \
  --output text \
  --profile $PROFILE \
  --region $REGION)

# Create security group for test runner
SG_ID=$(aws ec2 create-security-group \
  --group-name cc-native-test-runner-sg \
  --description "Security group for integration test runner" \
  --vpc-id $VPC_ID \
  --query "GroupId" \
  --output text \
  --profile $PROFILE \
  --region $REGION)

# Allow SSH from your IP (replace with your IP)
MY_IP=$(curl -s https://checkip.amazonaws.com)
aws ec2 authorize-security-group-ingress \
  --group-id $SG_ID \
  --protocol tcp \
  --port 22 \
  --cidr $MY_IP/32 \
  --profile $PROFILE \
  --region $REGION

# Allow outbound to Neptune (port 8182)
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
  --region $REGION

echo "Security group created: $SG_ID"
echo "Subnet ID: $SUBNET_ID"
echo "Now launch EC2 instance with:"
echo "  --subnet-id $SUBNET_ID"
echo "  --security-group-ids $SG_ID"
```

## Next Steps

1. Choose a method based on your needs
2. Set up the test runner environment
3. Run `npm test -- src/tests/integration/phase2.test.ts`
4. Review test results

The tests will automatically detect if Neptune is accessible and skip gracefully if not, so you can verify your setup is working correctly.
