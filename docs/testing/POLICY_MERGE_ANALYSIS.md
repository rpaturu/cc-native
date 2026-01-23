# IAM Policy Merge Analysis

## Current Situation

**Managed Policies (10 - at limit):**
1. AmazonBedrockFullAccess (AWS managed)
2. AmazonDynamoDBFullAccess (AWS managed)
3. AmazonS3FullAccess (AWS managed)
4. AmplifyBackendDeployFullAccess (AWS managed)
5. AWSCloudFormationFullAccess (AWS managed)
6. AWSLambdaDynamoDBExecutionRole (AWS managed)
7. AWSLambdaRole (AWS managed)
8. AWSStepFunctionsFullAccess (AWS managed)
9. AWSStepFunctionsReadOnlyAccess (AWS managed)
10. cognito-policy (Customer managed)

**Inline Policies:**
- StackCreateListDeletePolicy (3525 bytes - exceeds 2048-byte cumulative limit)

## Problem

1. **Cannot attach new managed policy**: User already has 10 managed policies (AWS limit)
2. **Cannot add inline test policies**: StackCreateListDeletePolicy (3525 bytes) already exceeds the 2048-byte cumulative limit for all inline policies

## Merge Opportunities

### Option 1: Merge StackCreateListDeletePolicy with AWSCloudFormationFullAccess

**Analysis:**
- `StackCreateListDeletePolicy` (inline, 3525 bytes) - CloudFormation stack operations
- `AWSCloudFormationFullAccess` (AWS managed) - Full CloudFormation access

**Assessment:**
- `AWSCloudFormationFullAccess` likely already includes all permissions in `StackCreateListDeletePolicy`
- If true, we can:
  1. Remove `StackCreateListDeletePolicy` (inline) - frees 3525 bytes
  2. Keep `AWSCloudFormationFullAccess` (managed) - no change needed
  3. This frees up inline policy quota for test policies

**Risk:** Low - AWS managed policy should have broader permissions

**Action:** Verify that `AWSCloudFormationFullAccess` includes all operations needed for CDK deployments

### Option 2: Merge Test Permissions with Existing AWS Managed Policies

**Analysis:**
- TestUserPolicy needs:
  - DynamoDB: Full access to `cc-native-*` tables
  - S3: Full access to `cc-native-*` buckets  
  - EventBridge: PutEvents on `cc-native-events` bus

- Existing policies:
  - `AmazonDynamoDBFullAccess` - Already grants full DynamoDB access (broader than needed)
  - `AmazonS3FullAccess` - Already grants full S3 access (broader than needed)
  - No EventBridge policy exists

**Assessment:**
- DynamoDB: ✅ Covered by `AmazonDynamoDBFullAccess`
- S3: ✅ Covered by `AmazonS3FullAccess`
- EventBridge: ❌ Not covered - need to add this

**Action:** 
- Test policies only need EventBridge permissions
- Can create a small inline policy just for EventBridge (well under 2048 bytes)
- Or create a customer managed policy for EventBridge and merge with one existing policy

### Option 3: Merge cognito-policy with Other Policies

**Analysis:**
- `cognito-policy` is customer managed - we can modify it
- Could potentially merge with other customer policies or test permissions

**Assessment:**
- Need to see what `cognito-policy` contains
- If it's small and related, could merge with test permissions
- Risk: Medium - depends on what cognito-policy does

## Recommended Solution

### Step 1: Remove StackCreateListDeletePolicy (if AWSCloudFormationFullAccess covers it)

**Verification needed:**
- Check if `AWSCloudFormationFullAccess` includes:
  - `cloudformation:CreateStack`
  - `cloudformation:UpdateStack`
  - `cloudformation:DeleteStack`
  - `cloudformation:ListStacks`
  - `cloudformation:DescribeStacks`
  - Other CDK deployment permissions

**If yes:**
1. Remove `StackCreateListDeletePolicy` inline policy
2. This frees 3525 bytes of inline policy quota
3. Can now add test policies as inline (EventBridge only needed)

### Step 2: Create Minimal Test Policy

Since DynamoDB and S3 are already covered by AWS managed policies, test policy only needs:

**EventBridge Policy (inline, ~120 bytes):**
```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["events:PutEvents"],
    "Resource": ["arn:aws:events:*:*:event-bus/cc-native-events"]
  }]
}
```

This is well under 2048 bytes and can be added as inline policy.

## Alternative: Create Customer Managed Policy for EventBridge

If we want to avoid inline policies entirely:
1. Create customer managed policy: `CCNativeEventBridgeTestPolicy`
2. Attach to user
3. But this requires removing one existing managed policy first

## Summary

**Best Approach:**
1. Verify `AWSCloudFormationFullAccess` covers all CDK deployment needs
2. If yes, remove `StackCreateListDeletePolicy` inline policy
3. Add minimal EventBridge inline policy (~120 bytes) for test permissions
4. DynamoDB and S3 permissions already covered by AWS managed policies

**Verification Commands:**
```bash
# Check what AWSCloudFormationFullAccess includes
aws iam get-policy --policy-arn arn:aws:iam::aws:policy/AWSCloudFormationFullAccess --no-cli-pager

# Check what StackCreateListDeletePolicy includes
aws iam get-user-policy --user-name amplify_admin --policy-name StackCreateListDeletePolicy --no-cli-pager
```
