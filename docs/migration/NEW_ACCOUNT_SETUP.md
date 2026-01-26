# New AWS Account Setup Guide

## Prerequisites

- New AWS account created
- Root user access (temporary - we'll create IAM user)
- AWS CLI installed (`aws --version`)
- Node.js and npm installed
- CDK CLI installed (`npm install -g aws-cdk`)

---

## Step 1: Create IAM User for CDK Deployment

**⚠️ Important:** Never use root user for daily operations. Create an IAM user with appropriate permissions.

### 1.1 Sign in as Root User

1. Go to AWS Console: https://console.aws.amazon.com/
2. Sign in with root credentials
3. Navigate to **IAM** service

### 1.2 Create IAM User

1. Go to **Users** → **Create user**
2. User name: `cc-native-deployer` (or your preferred name)
3. **Access type:** Select "Access key - Programmatic access"
4. Click **Next: Permissions**

### 1.3 Attach Permissions

**Option A: Administrator Access (Easiest for Development)**
- Select "Attach policies directly"
- Check `AdministratorAccess` policy
- Click **Next: Tags** (optional)
- Click **Next: Review**
- Click **Create user**

**Option B: Least Privilege (Recommended for Production)**
- Create a custom policy with CDK deployment permissions
- See "Custom IAM Policy" section below

### 1.4 Save Access Keys

**⚠️ CRITICAL: Save these immediately - you won't see them again!**

1. **Access Key ID:** Copy and save securely
2. **Secret Access Key:** Copy and save securely
3. Click **Close**

---

## Step 2: Configure AWS CLI Profile

### 2.1 Add Profile to AWS CLI

```bash
aws configure --profile cc-native-account
```

**Enter the following when prompted:**
- **AWS Access Key ID:** [Paste from Step 1.4]
- **AWS Secret Access Key:** [Paste from Step 1.4]
- **Default region name:** `us-west-2` (or your preferred region)
- **Default output format:** `json` (or `text`)

### 2.2 Verify Profile

```bash
# Test the profile
aws sts get-caller-identity --profile cc-native-account --no-cli-pager

# Should return:
# {
#   "UserId": "...",
#   "Account": "123456789012",  # Your new account ID
#   "Arn": "arn:aws:iam::123456789012:user/cc-native-deployer"
# }
```

**Note the Account ID** - you'll need it for CDK bootstrap.

---

## Step 3: Set Up Project Configuration

### 3.1 Create .env.local

```bash
cd /Users/rameshpaturu/Documents/projects/lambda/cc-native

# Create .env.local file
cat > .env.local << 'EOF'
# AWS Configuration for New Account
AWS_PROFILE=cc-native-account
ADMIN_PROFILE=cc-native-account
AWS_REGION=us-west-2
AWS_ACCOUNT_ID=<YOUR_NEW_ACCOUNT_ID>

# Environment
NODE_ENV=development
LOG_LEVEL=info

# S3 Buckets (will be created automatically - leave empty)
# EVIDENCE_LEDGER_BUCKET=
# WORLD_STATE_SNAPSHOTS_BUCKET=
# SCHEMA_REGISTRY_BUCKET=
# ARTIFACTS_BUCKET=
# LEDGER_ARCHIVES_BUCKET=
EOF
```

**Replace `<YOUR_NEW_ACCOUNT_ID>`** with the account ID from Step 2.2.

### 3.2 Verify Configuration

```bash
# Check that profile is set correctly
aws configure get region --profile cc-native-account

# Should return: us-west-2
```

---

## Step 4: Bootstrap CDK

CDK needs to be bootstrapped once per account/region combination.

### 4.1 Get Account ID

```bash
# Get account ID from profile
ACCOUNT_ID=$(aws sts get-caller-identity --profile cc-native-account --no-cli-pager --query Account --output text)
echo "Account ID: $ACCOUNT_ID"
```

### 4.2 Bootstrap CDK

```bash
cd /Users/rameshpaturu/Documents/projects/lambda/cc-native

# Bootstrap CDK (one-time setup)
npx cdk bootstrap \
  --profile cc-native-account \
  --region us-west-2 \
  aws://${ACCOUNT_ID}/us-west-2
```

**Expected output:**
```
 ⏳  Bootstrapping environment aws://123456789012/us-west-2...
 ✅  Environment aws://123456789012/us-west-2 bootstrapped
```

**This may take 2-5 minutes** - CDK creates:
- S3 bucket for CDK assets
- IAM roles for CDK deployments
- CloudFormation stack for CDK toolkit

---

## Step 5: Verify Project Build

### 5.1 Install Dependencies (if needed)

```bash
cd /Users/rameshpaturu/Documents/projects/lambda/cc-native

# Install dependencies
npm install
```

### 5.2 Build Project

```bash
# Build TypeScript
npm run build
```

**Should complete without errors.**

### 5.3 Verify CDK Can See Stack

```bash
# List stacks (should show CCNativeStack)
npx cdk list --profile cc-native-account --region us-west-2
```

**Expected output:**
```
CCNativeStack
```

---

## Step 6: Deploy Phase 0/1 Stack

### 6.1 Review Stack (Optional)

```bash
# See what will be deployed
npx cdk diff --profile cc-native-account --region us-west-2 CCNativeStack
```

### 6.2 Deploy Stack

```bash
# Deploy using the deploy script (recommended)
./deploy --profile cc-native-account --region us-west-2 --env development

# OR deploy directly with CDK
npx cdk deploy --profile cc-native-account --region us-west-2 CCNativeStack --require-approval never
```

**Expected duration:** 10-15 minutes for first deployment

**What gets created:**
- 5 S3 buckets (versioned, encrypted, no Object Lock)
- 17 DynamoDB tables
- 1 EventBridge custom bus
- 1 KMS key
- 1 Cognito User Pool
- 3 Lambda functions
- 3 DLQ queues
- 2 EventBridge rules
- IAM roles and policies

### 6.3 Monitor Deployment

Watch CloudFormation console or terminal output. Deployment will show:
- Creating resources...
- Waiting for stack to stabilize...
- Stack creation complete

---

## Step 7: Verify Deployment

### 7.1 Check Stack Status

```bash
aws cloudformation describe-stacks \
  --stack-name CCNativeStack \
  --profile cc-native-account \
  --region us-west-2 \
  --no-cli-pager \
  --query "Stacks[0].StackStatus"
```

**Should return:** `"CREATE_COMPLETE"`

### 7.2 List Resources

```bash
# List DynamoDB tables
aws dynamodb list-tables \
  --profile cc-native-account \
  --region us-west-2 \
  --no-cli-pager \
  --query "TableNames[?starts_with(@, 'cc-native-')]"

# List S3 buckets
aws s3 ls --profile cc-native-account --region us-west-2 --no-cli-pager | grep cc-native

# List Lambda functions
aws lambda list-functions \
  --profile cc-native-account \
  --region us-west-2 \
  --no-cli-pager \
  --query "Functions[?starts_with(FunctionName, 'cc-native-')].FunctionName"
```

### 7.3 Get Stack Outputs

```bash
aws cloudformation describe-stacks \
  --stack-name CCNativeStack \
  --profile cc-native-account \
  --region us-west-2 \
  --no-cli-pager \
  --query "Stacks[0].Outputs"
```

---

## Step 8: Run Tests (Optional)

### 8.1 Run Integration Tests

```bash
cd /Users/rameshpaturu/Documents/projects/lambda/cc-native

# Set environment variables for tests
export AWS_PROFILE=cc-native-account
export AWS_REGION=us-west-2

# Run tests
npm test
```

---

## Troubleshooting

### Issue: "Access Denied" during bootstrap

**Solution:**
- Verify IAM user has `AdministratorAccess` policy
- Check AWS credentials are correct: `aws sts get-caller-identity --profile cc-native-account`

### Issue: "CDK bootstrap already exists"

**Solution:**
- This is fine - bootstrap only needs to run once per account/region
- Proceed to deployment

### Issue: "Stack already exists" during deploy

**Solution:**
- Stack might exist from previous attempt
- Check CloudFormation console
- Delete stack if needed: `aws cloudformation delete-stack --stack-name CCNativeStack --profile cc-native-account --region us-west-2`

### Issue: "Bucket name already exists"

**Solution:**
- S3 bucket names are globally unique
- Update bucket names in `.env.local` or CDK will auto-generate unique names

### Issue: Deployment fails with IAM errors

**Solution:**
- Ensure IAM user has `AdministratorAccess` policy
- Or create custom policy with required permissions (see below)

---

## Custom IAM Policy (Optional - Least Privilege)

If you want to use least-privilege instead of AdministratorAccess:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "cloudformation:*",
        "s3:*",
        "dynamodb:*",
        "lambda:*",
        "events:*",
        "kms:*",
        "cognito-idp:*",
        "iam:*",
        "logs:*",
        "ssm:*",
        "sts:GetCallerIdentity",
        "bedrock:*",
        "aws-marketplace:ViewSubscriptions",
        "aws-marketplace:Subscribe"
      ],
      "Resource": "*"
    }
  ]
}
```

**Bedrock Permissions Explained:**
- `bedrock:*` - Full Bedrock access (for model management and invocation)
- `aws-marketplace:ViewSubscriptions` - View Marketplace subscriptions (needed for first-time model enablement)
- `aws-marketplace:Subscribe` - Subscribe to Marketplace products (needed for first-time model enablement)

**Note:** Marketplace permissions are only needed for the IAM user to enable models. Lambda execution roles only need `bedrock:InvokeModel` (which is already configured in the CDK stack).

**Note:** For development, `AdministratorAccess` is simpler and acceptable. Use least-privilege for production.

---

## Step 9: Enable Bedrock Model Access (Required for Phase 3)

**⚠️ Important:** Before using Bedrock models (Phase 3), you must enable model access in your AWS account.

### 9.1 Grant Bedrock Permissions to IAM User

The IAM user needs permissions to view and enable Bedrock models:

**Option A: If using AdministratorAccess**
- ✅ Already has all Bedrock permissions - skip to Step 9.2

**Option B: If using Custom Policy (Least Privilege)**
- Add the following permissions to your custom IAM policy:

```json
{
  "Effect": "Allow",
  "Action": [
    "bedrock:ListFoundationModels",
    "bedrock:GetFoundationModel",
    "bedrock:GetFoundationModelAvailability",
    "bedrock:CreateFoundationModelAgreement",
    "bedrock:PutUseCaseForModelAccess",
    "bedrock:ListFoundationModelAgreementOffers",
    "aws-marketplace:ViewSubscriptions",
    "aws-marketplace:Subscribe"
  ],
  "Resource": "*"
}
```

**Note:** Marketplace permissions are only needed for first-time model enablement. Once enabled, only `bedrock:InvokeModel` is needed (which Lambda roles already have).

### 9.2 Enable Models in AWS Console

1. **Sign in to AWS Console** with your `cc-native-account` profile
2. **Navigate to:** Amazon Bedrock → **Model access**
3. **For Anthropic models (first time only):**
   - Select an Anthropic model (e.g., Claude 3.5 Sonnet)
   - Click **"Submit use case details"**
   - Fill out the form:
     - Company name
     - Company website
     - Intended users (Internal/External/Both)
     - Industry
     - Use cases
   - Click **"Submit form"**
   - Wait for approval (usually immediate)

4. **Enable your model:**
   - Find `anthropic.claude-3-5-sonnet-20240620-v1:0` (or your chosen model)
   - Check the box to enable it
   - Click **"Save changes"**
   - Wait 2-3 minutes for propagation

### 9.3 Verify Model Access (Optional)

```bash
# Check if model is available
aws bedrock get-foundation-model-availability \
  --model-id anthropic.claude-3-5-sonnet-20240620-v1:0 \
  --profile cc-native-account \
  --region us-west-2 \
  --no-cli-pager

# Should return:
# {
#   "modelId": "anthropic.claude-3-5-sonnet-20240620-v1:0",
#   "agreementAvailability": {
#     "status": "AVAILABLE"
#   },
#   "authorizationStatus": "AUTHORIZED",
#   "entitlementAvailability": "AVAILABLE",
#   "regionAvailability": "AVAILABLE"
# }
```

### 9.4 Alternative: Enable via CLI (Programmatic)

If you prefer CLI over Console:

```bash
# 1. List available agreement offers
aws bedrock list-foundation-model-agreement-offers \
  --model-id anthropic.claude-3-5-sonnet-20240620-v1:0 \
  --profile cc-native-account \
  --region us-west-2 \
  --no-cli-pager

# 2. For Anthropic models: Submit use case (one-time, base64 encoded JSON)
# See AWS docs for form data format

# 3. Create foundation model agreement
aws bedrock create-foundation-model-agreement \
  --model-id anthropic.claude-3-5-sonnet-20240620-v1:0 \
  --offer-token <OFFER_TOKEN_FROM_STEP_1> \
  --profile cc-native-account \
  --region us-west-2 \
  --no-cli-pager
```

**Note:** Console method is recommended for first-time setup as it's simpler.

---

## Next Steps After Deployment

1. ✅ **Verify all resources created successfully**
2. ✅ **Run integration tests** to ensure functionality
3. ✅ **Proceed with Phase 2 implementation** (Neptune + Synthesis)
4. ✅ **Set up monitoring/alerts** (optional)
5. ✅ **Document any custom configurations**

---

## Quick Reference Commands

```bash
# Set profile for session
export AWS_PROFILE=cc-native-account
export AWS_REGION=us-west-2

# Deploy
./deploy --profile cc-native-account --region us-west-2

# Destroy (if needed)
./destroy --profile cc-native-account --region us-west-2 --force

# Check stack status
aws cloudformation describe-stacks --stack-name CCNativeStack --profile cc-native-account --region us-west-2 --no-cli-pager --query "Stacks[0].StackStatus"
```

---

## Security Best Practices

1. **✅ Done:** Created IAM user (not using root)
2. **⚠️ TODO:** Enable MFA on IAM user
3. **⚠️ TODO:** Set up CloudTrail for audit logging
4. **⚠️ TODO:** Configure billing alerts
5. **⚠️ TODO:** Set up AWS Budgets for cost monitoring

---

## Summary Checklist

- [ ] Created IAM user with programmatic access
- [ ] Saved Access Key ID and Secret Access Key securely
- [ ] Configured AWS CLI profile (`cc-native-account`)
- [ ] Verified profile works (`aws sts get-caller-identity`)
- [ ] Created `.env.local` with account ID
- [ ] Bootstrapped CDK in new account
- [ ] Built project (`npm run build`)
- [ ] Deployed stack (`./deploy`)
- [ ] Verified deployment (checked resources)
- [ ] Enabled Bedrock model access (Console or CLI)
- [ ] Verified model availability (optional CLI check)
- [ ] Ready for Phase 2/3 implementation

---

**Ready to proceed?** Start with Step 1 above!
