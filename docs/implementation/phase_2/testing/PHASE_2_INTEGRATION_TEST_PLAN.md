# Phase 2 Integration Test Plan

**Status:** 🟢 **COMPLETE**  
**Last Updated:** 2026-01-28  
**Parent:** [PHASE_2_TEST_PLAN.md](PHASE_2_TEST_PLAN.md)

This guide shows you how to set up and run Phase 2 integration tests, which test the Situation Graph (Neptune) and Deterministic Synthesis engine. Since Neptune is deployed in **isolated VPC subnets** (no internet access), tests must run from within the VPC using an EC2 test runner instance.

## Prerequisites

1. **Infrastructure Deployed**: Run `./deploy` to deploy the CDK stack
   - This creates the `.env` file with all required environment variables

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

4. **GitHub Repository** (optional but recommended):
   - Code pushed to GitHub for easy deployment to test runner
   - See [Setting Up GitHub Repository](#setting-up-github-repository) section below

**Note**: The test scripts can automatically set up prerequisites (security group, IAM role, key pair) if you use `run-phase2-integration-tests.sh`.

## Quick Start

### Automated Workflow (Recommended)

Run the complete workflow with a single command:

```bash
# If you have GIT_REPO_URL and GIT_TOKEN in .env.local, you can run:
./scripts/phase_2/run-phase2-integration-tests.sh

# Or specify repository URL:
./scripts/phase_2/run-phase2-integration-tests.sh --repo-url https://github.com/rpaturu/cc-native.git
```

This script will:
1. Set up all prerequisites (security group, IAM role, key pair) - **optional, can be skipped**
2. Launch the EC2 instance (or reuse existing if already running)
3. Configure instance (install Node.js, clone repo, install dependencies)
4. Run Phase 2 integration tests remotely via SSM
5. **Conditionally teardown**: Only if all tests pass
   - ✅ **Tests pass** → Instance automatically terminated
   - ❌ **Tests fail** → Instance retained for debugging

### Using .env.local (Recommended)

For convenience, you can store your repository URL and token in `.env.local`:

```bash
# .env.local
GIT_REPO_URL=https://github.com/rpaturu/cc-native.git
GIT_TOKEN=ghp_your_token_here
```

Then simply run:
```bash
./scripts/phase_2/run-phase2-integration-tests.sh
```

The script will automatically use `GIT_REPO_URL` and `GIT_TOKEN` from `.env.local`.

## Setting Up GitHub Repository

If you haven't set up a GitHub repository yet, follow these steps:

### Step 1: Add GitHub Remote

```bash
# Add the remote (if it doesn't exist)
git remote add origin https://github.com/rpaturu/cc-native.git

# Or update existing remote
git remote set-url origin https://github.com/rpaturu/cc-native.git

# Verify
git remote -v
```

### Step 2: Push Code to GitHub

```bash
# Push main branch
git push -u origin main

# If you get authentication errors, you'll need to set up authentication (see below)
```

### Step 3: Authentication Options

#### Option A: Personal Access Token (Recommended for HTTPS)

1. **Create a GitHub Personal Access Token**:
   - Go to: https://github.com/settings/tokens
   - Click "Generate new token (classic)"
   - Select scopes: `repo` (full control of private repositories)
   - Copy the token (starts with `ghp_`)

2. **Use token for pushing**:
   ```bash
   # Push with token (you'll be prompted for password - use the token)
   git push -u origin main
   
   # Or embed token in URL (less secure, but works)
   git remote set-url origin https://YOUR_TOKEN@github.com/rpaturu/cc-native.git
   git push -u origin main
   ```

3. **Store token in .env.local for test scripts**:
   ```bash
   # Add to .env.local
   GIT_REPO_URL=https://github.com/rpaturu/cc-native.git
   GIT_TOKEN=ghp_your_token_here
   ```

#### Option B: SSH Key (Recommended for SSH)

1. **Generate SSH key** (if you don't have one):
   ```bash
   ssh-keygen -t ed25519 -C "your_email@example.com"
   # Save to ~/.ssh/id_ed25519_github (or use default)
   ```

2. **Add SSH key to GitHub**:
   ```bash
   # Copy public key
   cat ~/.ssh/id_ed25519_github.pub
   ```
   - Go to: https://github.com/settings/keys
   - Click "New SSH key"
   - Paste the public key

3. **Use SSH URL**:
   ```bash
   git remote set-url origin git@github.com:rpaturu/cc-native.git
   git push -u origin main
   ```

4. **Use SSH with test scripts**:
   ```bash
   ./scripts/phase_2/run-phase2-integration-tests.sh \
     --repo-url git@github.com:rpaturu/cc-native.git \
     --git-ssh-key ~/.ssh/id_ed25519_github
   ```

### Step 4: Make Repository Private (Optional)

If you want to make the repository private:

1. Go to: https://github.com/rpaturu/cc-native/settings
2. Scroll down to "Danger Zone"
3. Click "Change visibility"
4. Select "Make private"

## Command-Line Options

The `run-phase2-integration-tests.sh` script supports various options:

```bash
./scripts/phase_2/run-phase2-integration-tests.sh [OPTIONS]
```

**Options**:
- `--repo-url URL` - Git repository URL (HTTPS or SSH)
- `--skip-prerequisites` - Skip prerequisites setup (use existing security group, IAM role, key pair)
- `--setup-prerequisites` - Explicitly run prerequisites setup (default: runs if not skipped)
- `--skip-launch` - Skip instance launch (use existing instance)
- `--git-token TOKEN` - Git token for private HTTPS repos (e.g., GitHub personal access token)
- `--git-ssh-key PATH` - Path to SSH private key for private SSH repos
- `--profile PROFILE` - AWS profile (default: cc-native-account)
- `--region REGION` - AWS region (default: us-west-2)
- `--help, -h` - Show help message

**Examples**:
```bash
# Full workflow (first time - sets up everything)
./scripts/phase_2/run-phase2-integration-tests.sh --repo-url https://github.com/rpaturu/cc-native.git

# Skip prerequisites (already set up)
./scripts/phase_2/run-phase2-integration-tests.sh --skip-prerequisites

# Use existing instance and skip prerequisites
./scripts/phase_2/run-phase2-integration-tests.sh --skip-prerequisites --skip-launch

# Private repository with token
./scripts/phase_2/run-phase2-integration-tests.sh \
  --repo-url https://github.com/rpaturu/cc-native.git \
  --git-token ghp_xxxxx

# Show all options
./scripts/phase_2/run-phase2-integration-tests.sh --help
```

**Environment Variables** (alternative to command-line options):
- `GIT_REPO_URL` - Repository URL (read from .env.local if available)
- `GIT_TOKEN` - Git token for private HTTPS repos (read from .env.local if available)
- `REPO_URL` - Repository URL for cloning (overrides GIT_REPO_URL)
- `SKIP_PREREQUISITES` - Skip prerequisites setup (true/false)
- `SKIP_LAUNCH` - Skip instance launch (true/false)
- `AWS_PROFILE` - AWS profile name
- `AWS_REGION` - AWS region

**Note**: `GIT_REPO_URL` and `GIT_TOKEN` can be set in `.env.local` for convenience.

## Manual Step-by-Step Workflow

If you prefer to run steps manually:

### Step 1: Set Up Prerequisites

```bash
./scripts/setup-test-runner-prerequisites.sh
```

This script will:
- Create a security group for the test runner
- Allow SSH (port 22) from your current IP address
- Allow the test runner to connect to Neptune (port 8182)
- Create IAM role with permissions for Neptune, DynamoDB, S3, and EventBridge
- Create instance profile and attach the IAM role
- Create or reuse EC2 key pair
- Save all configuration to `.env.test-runner` file

### Step 2: Launch EC2 Instance

```bash
./scripts/common/manage-test-runner-instance.sh launch
```

This will:
- Launch an EC2 instance with all prerequisites configured
- Wait for the instance to be running
- Show connection instructions
- Save the instance ID to `.env.test-runner`

**Check instance status**:
```bash
./scripts/common/manage-test-runner-instance.sh status
```

### Step 3: Run Tests

You can run tests in two ways:

#### Option A: Automated (Recommended)

```bash
# Uses GIT_REPO_URL and GIT_TOKEN from .env.local if available
./scripts/common/manage-test-runner-instance.sh test
```

#### Option B: Manual

```bash
# Connect to instance
source .env.test-runner
aws ssm start-session \
  --target $TEST_RUNNER_INSTANCE_ID \
  --profile cc-native-account \
  --region us-west-2

# On the instance:
cd ~/cc-native
npm test -- src/tests/integration/phase2.test.ts
```

### Step 4: Teardown Instance

After testing is complete:

```bash
./scripts/common/manage-test-runner-instance.sh teardown
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

### Can't Connect to Instance

If your instance is in an isolated subnet (no public IP), use AWS Systems Manager Session Manager:

```bash
# Connect via Session Manager
source .env.test-runner
aws ssm start-session \
  --target $TEST_RUNNER_INSTANCE_ID \
  --profile cc-native-account \
  --region us-west-2
```

### Authentication Failed (GitHub)

- **HTTPS**: Ensure token has `repo` scope
- **SSH**: Verify SSH key is added to GitHub and `ssh -T git@github.com` works

### Missing .env.local Variables

If you get warnings about missing repository URL or token:

1. **Option 1**: Set in `.env.local`:
   ```bash
   GIT_REPO_URL=https://github.com/rpaturu/cc-native.git
   GIT_TOKEN=ghp_your_token_here
   ```

2. **Option 2**: Use command-line arguments:
   ```bash
   ./scripts/phase_2/run-phase2-integration-tests.sh \
     --repo-url https://github.com/rpaturu/cc-native.git \
     --git-token ghp_xxxxx
   ```

3. **Option 3**: Use environment variables:
   ```bash
   export GIT_REPO_URL="https://github.com/rpaturu/cc-native.git"
   export GIT_TOKEN="ghp_xxxxx"
   ./scripts/phase_2/run-phase2-integration-tests.sh
   ```

## Local Testing

You can run tests locally, but Neptune-dependent tests will skip gracefully:

```bash
# Run all tests (Neptune tests will skip)
npm test

# Run only unit tests
npm test -- --testPathPattern="unit"

# Run Phase 2 integration tests (Neptune tests will skip)
npm test -- src/tests/integration/phase2.test.ts
```

**Note**: Full Phase 2 tests with Neptune require running on the EC2 instance in the VPC.

## Quick Reference

```bash
# 1. Deploy infrastructure
./deploy

# 2. Set up GitHub repository (optional)
git remote add origin https://github.com/rpaturu/cc-native.git
git push -u origin main

# 3. Add to .env.local (optional but recommended)
GIT_REPO_URL=https://github.com/rpaturu/cc-native.git
GIT_TOKEN=ghp_your_token_here

# 4. Run complete test workflow
./scripts/phase_2/run-phase2-integration-tests.sh
```
