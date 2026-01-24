# Test Script Dependencies

This document outlines the dependencies and prerequisites for running the Phase 2 integration test scripts.

## Required Dependencies

### 1. Infrastructure Deployment

**Must run first**: `./deploy`

The deploy script:
- Deploys the CDK stack (`CCNativeStack`) with all AWS resources
- Creates `.env` file with all required environment variables:
  - `VPC_ID` - VPC ID for Neptune cluster
  - `NEPTUNE_SUBNET_ID` - Subnet ID for test runner instance
  - `NEPTUNE_SUBNET_IDS` - Comma-separated list of subnet IDs
  - `NEPTUNE_CLUSTER_ENDPOINT` - Neptune cluster endpoint
  - `NEPTUNE_CLUSTER_PORT` - Neptune cluster port
  - `NEPTUNE_CLUSTER_ID` - Neptune cluster identifier (from CloudFormation)
  - `ACCOUNT_POSTURE_STATE_TABLE_NAME` - DynamoDB table name
  - `GRAPH_MATERIALIZATION_STATUS_TABLE_NAME` - DynamoDB table name
  - `SIGNALS_TABLE_NAME` - DynamoDB table name
  - `ACCOUNTS_TABLE_NAME` - DynamoDB table name
  - `LEDGER_TABLE_NAME` - DynamoDB table name
  - `EVENT_BUS_NAME` - EventBridge event bus name
  - `AWS_REGION` - AWS region
  - `AWS_PROFILE` - AWS profile name

### 2. AWS Credentials

**Required**: AWS CLI configured with appropriate profile

```bash
# Verify AWS credentials are configured
aws sts get-caller-identity --profile cc-native-account

# Or set environment variable
export AWS_PROFILE=cc-native-account
```

### 3. Test Runner Prerequisites (Optional - can be automated)

**Option A**: Let `run-phase2-integration-tests.sh` handle it automatically
- Script will run `setup-test-runner-prerequisites.sh` if not skipped
- Creates `.env.test-runner` file with:
  - `TEST_RUNNER_SECURITY_GROUP_ID` - Security group for test runner
  - `TEST_RUNNER_IAM_ROLE_NAME` - IAM role name
  - `TEST_RUNNER_INSTANCE_PROFILE_NAME` - Instance profile name
  - `TEST_RUNNER_KEY_NAME` - EC2 key pair name
  - `TEST_RUNNER_KEY_FILE` - Path to private key file
  - `NEPTUNE_SECURITY_GROUP_ID` - Neptune security group ID

**Option B**: Run manually first
```bash
./scripts/setup-test-runner-prerequisites.sh
```

This script requires:
- `.env` file (from deploy script)
- AWS credentials with permissions to:
  - Create/describe security groups
  - Create/describe IAM roles and instance profiles
  - Create/describe EC2 key pairs
  - Query CloudFormation stack outputs

## Script Dependencies

### `setup-test-runner-prerequisites.sh`

**Dependencies:**
- ✅ `.env` file (from `./deploy`)
  - Uses: `VPC_ID`, `NEPTUNE_CLUSTER_ID` (or queries CloudFormation)
- ✅ AWS credentials configured
- ✅ AWS CLI access to:
  - EC2 (security groups, key pairs)
  - IAM (roles, instance profiles, policies)
  - CloudFormation (stack outputs)
  - STS (get account ID)

**Creates:**
- `.env.test-runner` file with test runner configuration

### `manage-test-runner-instance.sh`

**Dependencies:**
- ✅ `.env` file (from `./deploy`)
  - Requires: `NEPTUNE_SUBNET_ID`
- ✅ `.env.test-runner` file (from `setup-test-runner-prerequisites.sh`)
  - Requires: `TEST_RUNNER_SECURITY_GROUP_ID`, `TEST_RUNNER_INSTANCE_PROFILE_NAME`, `TEST_RUNNER_KEY_NAME`
- ✅ AWS credentials configured
- ✅ AWS CLI access to:
  - EC2 (describe/launch/terminate instances, describe images)
  - SSM (for `test` action - send commands)

**Actions:**
- `launch` - Creates EC2 instance
- `status` - Checks instance status
- `connect` - Shows connection instructions
- `test` - Runs tests remotely via SSM
- `teardown` - Terminates instance

### `run-phase2-integration-tests.sh`

**Dependencies:**
- ✅ `.env` file (from `./deploy`)
- ✅ `.env.test-runner` file (if `--skip-prerequisites` is used)
- ✅ AWS credentials configured
- ✅ `REPO_URL` environment variable or `--repo-url` flag (for first run)

**Optional:**
- Can run `setup-test-runner-prerequisites.sh` automatically (unless `--skip-prerequisites`)
- Can launch instance automatically (unless `--skip-launch`)

**Workflow:**
1. Optionally sets up prerequisites (security group, IAM role, key pair)
2. Optionally launches EC2 instance
3. Runs tests remotely via SSM
4. Conditionally tears down instance (only if tests pass)

## Quick Start Checklist

Before running test scripts, ensure:

- [ ] **Infrastructure deployed**: `./deploy` completed successfully
- [ ] **`.env` file exists**: Contains all required variables (VPC_ID, NEPTUNE_SUBNET_ID, etc.)
- [ ] **AWS credentials configured**: `aws sts get-caller-identity` works
- [ ] **AWS profile set** (if not using default): `export AWS_PROFILE=cc-native-account`
- [ ] **Repository URL available** (for first run): `export REPO_URL="https://github.com/your-org/cc-native.git"`

## Minimal Workflow

```bash
# 1. Deploy infrastructure (creates .env)
./deploy

# 2. Run complete test workflow (handles prerequisites automatically)
./scripts/run-phase2-integration-tests.sh --repo-url https://github.com/your-org/cc-native.git
```

That's it! The script will:
- Set up prerequisites (security group, IAM role, key pair)
- Launch EC2 instance
- Run tests
- Tear down instance if tests pass

## Manual Step-by-Step (if needed)

```bash
# 1. Deploy infrastructure
./deploy

# 2. Set up prerequisites
./scripts/setup-test-runner-prerequisites.sh

# 3. Launch instance
./scripts/manage-test-runner-instance.sh launch

# 4. Run tests
./scripts/manage-test-runner-instance.sh test

# 5. Teardown when done
./scripts/manage-test-runner-instance.sh teardown
```

## Repository Deployment Options

### Option 1: Public Repository (HTTPS)
```bash
./scripts/run-phase2-integration-tests.sh --repo-url https://github.com/your-org/cc-native.git
```

### Option 2: Private Repository with Token (HTTPS)
```bash
# GitHub personal access token
./scripts/run-phase2-integration-tests.sh \
  --repo-url https://github.com/your-org/cc-native.git \
  --git-token ghp_xxxxxxxxxxxxx

# Or via environment variable
export GIT_TOKEN="ghp_xxxxxxxxxxxxx"
./scripts/run-phase2-integration-tests.sh --repo-url https://github.com/your-org/cc-native.git
```

### Option 3: Private Repository with SSH Key
```bash
# Note: SSH key must be copied to instance manually first
# Connect to instance and set up SSH key, then use:
./scripts/run-phase2-integration-tests.sh \
  --repo-url git@github.com:your-org/cc-native.git \
  --git-ssh-key ~/.ssh/id_rsa
```

### Option 4: Deploy from S3 (Local Code or Private Repos)
```bash
# 1. Create code archive locally
tar -czf cc-native.tar.gz --exclude=node_modules --exclude=.git .

# 2. Upload to S3
aws s3 cp cc-native.tar.gz s3://your-code-bucket/cc-native.tar.gz --profile cc-native-account

# 3. Run tests with S3 deployment
./scripts/run-phase2-integration-tests.sh \
  --deploy-method s3 \
  --s3-bucket your-code-bucket \
  --s3-key cc-native.tar.gz
```

### Option 5: Manual Deployment
```bash
# 1. Connect to instance
aws ssm start-session --target <INSTANCE_ID> --profile cc-native-account

# 2. On instance, clone or copy code manually
# 3. Run tests with manual method
./scripts/run-phase2-integration-tests.sh --deploy-method manual
```

## Troubleshooting

### Missing .env file
```bash
# Run deploy script to create .env
./deploy
```

### Missing .env.test-runner file
```bash
# Run prerequisites setup
./scripts/setup-test-runner-prerequisites.sh
```

### AWS credentials not configured
```bash
# Configure AWS credentials
aws configure --profile cc-native-account

# Or set environment variables
export AWS_ACCESS_KEY_ID=...
export AWS_SECRET_ACCESS_KEY=...
export AWS_SESSION_TOKEN=...  # if using temporary credentials
```

### Private repository authentication fails
- **HTTPS**: Ensure token has `repo` scope (GitHub) or equivalent permissions
- **SSH**: Copy SSH key to instance manually and configure `~/.ssh/config`
- **S3**: Ensure IAM role on instance has S3 read permissions

### Missing permissions
Ensure your AWS credentials have permissions for:
- EC2 (create/describe security groups, instances, key pairs)
- IAM (create/describe roles, instance profiles, policies)
- CloudFormation (describe stacks)
- SSM (send commands to instances)
- Neptune (connect, query - via IAM role on instance)
- S3 (if using S3 deployment method - read access)
