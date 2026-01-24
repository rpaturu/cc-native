# Destroy Phase 0/1 Stack and Migrate to New AWS Account

## ⚠️ Critical Warnings

### 1. S3 Buckets with Object Lock (Cannot Be Deleted)
The following S3 buckets have **Object Lock in Compliance Mode** with **7-year retention**:
- `cc-native-evidence-ledger-{account}-{region}`
- `cc-native-world-state-snapshots-{account}-{region}`
- `cc-native-schema-registry-{account}-{region}`
- `cc-native-ledger-archives-{account}-{region}`

**These buckets CANNOT be deleted until the retention period expires (7 years).**

**Options:**
1. **Leave them in the old account** (recommended) - They'll incur minimal storage costs but won't interfere with new account
2. **Empty them first** (if no data needed) - Delete all objects before destroying stack, but buckets will remain
3. **Wait 7 years** - Not practical

### 2. Cognito User Pool (Retained)
The Cognito User Pool has `RemovalPolicy.RETAIN`, so it will **NOT be deleted** when the stack is destroyed. It will remain in the old account.

**Options:**
1. **Leave it in old account** - If you have users, they'll remain
2. **Manually delete it** - After stack destruction, delete via AWS Console or CLI

---

## Destruction Plan

### Step 1: Verify Current Deployment

```bash
# Check current stack status
aws cloudformation describe-stacks \
  --stack-name CCNativeStack \
  --profile <old_account_profile> \
  --region us-west-2 \
  --no-cli-pager \
  --query "Stacks[0].StackStatus"

# List all resources in the stack
aws cloudformation list-stack-resources \
  --stack-name CCNativeStack \
  --profile <old_account_profile> \
  --region us-west-2 \
  --no-cli-pager
```

### Step 2: Backup Critical Data (Optional)

If you need to preserve any data:

```bash
# Export DynamoDB tables (if needed)
# Example for signals table
aws dynamodb scan \
  --table-name cc-native-signals \
  --profile <old_account_profile> \
  --region us-west-2 \
  --no-cli-pager \
  > signals-backup.json

# Export S3 bucket contents (if needed)
aws s3 sync s3://cc-native-evidence-ledger-{account}-{region} ./backup/evidence-ledger/ \
  --profile <old_account_profile>
```

### Step 3: Empty S3 Buckets (If No Data Needed)

**⚠️ Only do this if you don't need the data!**

```bash
# Empty each bucket (buckets will remain due to Object Lock)
aws s3 rm s3://cc-native-evidence-ledger-{account}-{region} --recursive \
  --profile <old_account_profile>

aws s3 rm s3://cc-native-world-state-snapshots-{account}-{region} --recursive \
  --profile <old_account_profile>

aws s3 rm s3://cc-native-schema-registry-{account}-{region} --recursive \
  --profile <old_account_profile>

aws s3 rm s3://cc-native-ledger-archives-{account}-{region} --recursive \
  --profile <old_account_profile>

# Artifacts bucket (no Object Lock, can be fully deleted)
aws s3 rm s3://cc-native-artifacts-{account}-{region} --recursive \
  --profile <old_account_profile>
```

### Step 4: Destroy the Stack

```bash
# Navigate to project directory
cd /Users/rameshpaturu/Documents/projects/lambda/cc-native

# Run destroy script
./destroy --profile <old_account_profile> --region us-west-2 --force
```

**Expected Behavior:**
- ✅ DynamoDB tables: **Deleted immediately**
- ✅ Lambda functions: **Deleted immediately**
- ✅ EventBridge bus and rules: **Deleted immediately**
- ✅ KMS keys: **Scheduled for deletion** (7-30 day delay)
- ⚠️ S3 buckets with Object Lock: **Will fail to delete** (expected)
- ⚠️ Cognito User Pool: **Will be retained** (expected)

### Step 5: Handle Remaining Resources

After stack destruction, manually handle:

1. **S3 Buckets with Object Lock:**
   - They will remain in the account
   - They'll incur minimal storage costs (empty buckets cost ~$0.023/month)
   - You can ignore them or create a support ticket to request deletion (may not be possible)

2. **Cognito User Pool:**
   ```bash
   # Get User Pool ID from stack outputs or AWS Console
   USER_POOL_ID="<user-pool-id>"
   
   # Delete User Pool (if no users needed)
   aws cognito-idp delete-user-pool \
     --user-pool-id $USER_POOL_ID \
     --profile <old_account_profile> \
     --region us-west-2 \
     --no-cli-pager
   ```

3. **KMS Keys:**
   - They will be scheduled for deletion automatically
   - Wait 7-30 days for final deletion
   - Or manually delete if needed:
   ```bash
   aws kms schedule-key-deletion \
     --key-id <key-id> \
     --pending-window-in-days 7 \
     --profile <old_account_profile> \
     --region us-west-2 \
     --no-cli-pager
   ```

---

## New Account Setup

### Step 1: Configure AWS Profile for New Account

```bash
# Add new account profile to ~/.aws/credentials
aws configure --profile cc-native-account

# Or edit ~/.aws/credentials directly:
[cc-native-account]
aws_access_key_id = <new_account_access_key>
aws_secret_access_key = <new_account_secret_key>
region = us-west-2
```

### Step 2: Update Project Configuration

Create or update `.env.local`:

```bash
cd /Users/rameshpaturu/Documents/projects/lambda/cc-native

# Create .env.local if it doesn't exist
cat > .env.local << EOF
# AWS Configuration for New Account
AWS_PROFILE=cc-native-account
ADMIN_PROFILE=cc-native-account
AWS_REGION=us-west-2
AWS_ACCOUNT_ID=<new_account_id>

# Environment
NODE_ENV=development
LOG_LEVEL=info

# S3 Buckets (will be created automatically)
# Leave empty to auto-generate names
# EVIDENCE_LEDGER_BUCKET=
# WORLD_STATE_SNAPSHOTS_BUCKET=
# SCHEMA_REGISTRY_BUCKET=
# ARTIFACTS_BUCKET=
# LEDGER_ARCHIVES_BUCKET=
EOF
```

### Step 3: Verify New Account Access

```bash
# Test profile
aws sts get-caller-identity --profile cc-native-account --no-cli-pager

# Verify region
aws configure get region --profile cc-native-account
```

### Step 4: Bootstrap CDK in New Account

```bash
# Bootstrap CDK (one-time setup for new account)
npx cdk bootstrap \
  --profile cc-native-account \
  --region us-west-2 \
  aws://<new_account_id>/us-west-2
```

### Step 5: Deploy Phase 0/1 to New Account

```bash
# Deploy Phase 0/1 stack to new account
./deploy --profile cc-native-account --region us-west-2 --env development
```

### Step 6: Verify Deployment

```bash
# Check stack status
aws cloudformation describe-stacks \
  --stack-name CCNativeStack \
  --profile cc-native-account \
  --region us-west-2 \
  --no-cli-pager \
  --query "Stacks[0].StackStatus"

# List DynamoDB tables
aws dynamodb list-tables \
  --profile cc-native-account \
  --region us-west-2 \
  --no-cli-pager \
  --query "TableNames[?starts_with(@, 'cc-native-')]"

# List S3 buckets
aws s3 ls \
  --profile cc-native-account \
  --region us-west-2 \
  | grep cc-native-
```

---

## Cost Considerations

### Old Account (After Destruction)
- **S3 Buckets (Object Lock):** ~$0.023/month per empty bucket (4 buckets = ~$0.09/month)
- **Cognito User Pool:** $0/month (if empty)
- **KMS Keys:** $1/month per key (until deleted)

**Total:** ~$1-2/month until KMS keys are deleted

### New Account
- Same costs as before (Phase 0/1 resources)
- Will add Phase 2 costs (Neptune cluster, additional tables, Lambda functions)

---

## Troubleshooting

### Stack Destruction Fails

If stack destruction fails due to S3 Object Lock:

1. **This is expected** - Object Lock buckets cannot be deleted
2. **Continue anyway** - Other resources will be deleted
3. **Manual cleanup** - Leave buckets in old account (minimal cost)

### CDK Bootstrap Fails

```bash
# Check IAM permissions
aws iam get-user --profile cc-native-account --no-cli-pager

# Bootstrap with explicit account/region
npx cdk bootstrap \
  --profile cc-native-account \
  --region us-west-2 \
  --trust <account_id> \
  aws://<new_account_id>/us-west-2
```

### Deployment Fails in New Account

1. **Check IAM permissions** - Ensure profile has CloudFormation, DynamoDB, S3, Lambda, EventBridge permissions
2. **Check service quotas** - Verify DynamoDB, Lambda, S3 limits
3. **Check region** - Ensure all resources are in the same region

---

## Next Steps After Migration

1. ✅ Verify Phase 0/1 deployment in new account
2. ✅ Run integration tests to verify functionality
3. ✅ Update any external integrations (if any)
4. ✅ Proceed with Phase 2 implementation in new account

---

## Summary Checklist

- [ ] Backup critical data (if needed)
- [ ] Empty S3 buckets (if no data needed)
- [ ] Destroy stack in old account
- [ ] Handle remaining resources (S3 buckets, Cognito, KMS)
- [ ] Configure AWS profile for new account
- [ ] Update `.env.local` with new account details
- [ ] Bootstrap CDK in new account
- [ ] Deploy Phase 0/1 to new account
- [ ] Verify deployment
- [ ] Run tests
- [ ] Proceed with Phase 2
