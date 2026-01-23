# IAM Policy Merge Assessment

## Policy Analysis

### 1. StackCreateListDeletePolicy vs AWSCloudFormationFullAccess

**StackCreateListDeletePolicy** grants:
- CloudFormation: `CreateStack`, `DeleteStack`, `TagResource`, `UntagResource`, `ListStacks`
- ECR: `*` (all ECR operations)
- Logs: `*` (all CloudWatch Logs operations)
- SQS: `ListQueues`, `GetQueueAttributes`, `GetQueueUrl`, `ReceiveMessage`, `DeleteMessage`, `PurgeQueue`, `ChangeMessageVisibility`
- Batch: `*` (all AWS Batch operations)
- ECS: `*` (all ECS operations)
- EC2: `Describe*` (read-only EC2 operations)
- IAM: `CreateRole`, `DeleteRole`, `AttachRolePolicy`, `DetachRolePolicy`, `GetRole`, `UpdateAssumeRolePolicy`, `CreateServiceLinkedRole`, `PassRole`
- Step Functions: `ListExecutions` (for specific state machine)
- RDS Data: `ExecuteStatement`, `BatchExecuteStatement`, `BeginTransaction`, `CommitTransaction`, `RollbackTransaction`
- Secrets Manager: `GetSecretValue`
- CloudFront: `CreateInvalidation`, `GetInvalidation`, `ListInvalidations`, `GetDistribution`, `ListDistributions`

**AWSCloudFormationFullAccess** grants:
- CloudFormation: `*` (all CloudFormation operations)

**Assessment:**
- ✅ CloudFormation permissions: `AWSCloudFormationFullAccess` covers all CloudFormation needs (includes `CreateStack`, `DeleteStack`, `ListStacks`, etc.)
- ❌ Other permissions: `StackCreateListDeletePolicy` has many non-CloudFormation permissions (ECR, Batch, ECS, IAM, etc.) that are NOT in `AWSCloudFormationFullAccess`

**Conclusion:** 
- `StackCreateListDeletePolicy` is **NOT redundant** with `AWSCloudFormationFullAccess`
- It provides additional permissions for ECR, Batch, ECS, IAM role management, etc.
- **Cannot simply remove it** - it serves purposes beyond CloudFormation

### 2. Test Permissions Coverage

**TestUserPolicy needs:**
1. DynamoDB: Full access to `cc-native-*` tables
2. S3: Full access to `cc-native-*` buckets
3. EventBridge: `PutEvents` on `cc-native-events` bus

**Existing Policy Coverage:**

**AmazonDynamoDBFullAccess:**
- Grants: `dynamodb:*` (all DynamoDB operations)
- Resource: `*` (all resources)
- ✅ **FULLY COVERS** test DynamoDB needs

**AmazonS3FullAccess:**
- Grants: `s3:*`, `s3-object-lambda:*` (all S3 operations)
- Resource: `*` (all resources)
- ✅ **FULLY COVERS** test S3 needs

**EventBridge:**
- ❌ **NOT COVERED** by any existing policy
- Need to add: `events:PutEvents` for `arn:aws:events:*:*:event-bus/cc-native-events`

### 3. Merge Opportunities

#### Option A: Add EventBridge to cognito-policy (Customer Managed)

**cognito-policy** currently has:
- Cognito IDP operations
- Glue operations
- Athena operations
- S3 operations (for athena-results bucket only)

**Assessment:**
- ✅ Can add EventBridge permissions here
- ✅ Would free up inline policy quota
- ⚠️ Policy name is misleading (not just Cognito)
- ⚠️ Would need to update existing managed policy

**Action:** Add EventBridge statement to `cognito-policy.json`:
```json
{
  "Effect": "Allow",
  "Action": ["events:PutEvents"],
  "Resource": ["arn:aws:events:*:*:event-bus/cc-native-events"]
}
```

#### Option B: Create Minimal EventBridge Inline Policy

**Assessment:**
- ✅ Small policy (~120 bytes) - well under 2048-byte limit
- ✅ Can add after removing `StackCreateListDeletePolicy`
- ⚠️ But `StackCreateListDeletePolicy` has other needed permissions (ECR, Batch, ECS, etc.)

**Problem:** Cannot remove `StackCreateListDeletePolicy` because it has non-CloudFormation permissions that may be needed.

#### Option C: Merge StackCreateListDeletePolicy into cognito-policy

**Assessment:**
- ✅ Would free up inline policy quota (3525 bytes)
- ✅ Would free up one managed policy slot (if we remove the managed version we just created)
- ⚠️ Large policy merge - cognito-policy would become much larger
- ⚠️ Policy name becomes even more misleading

**Action:** Add all `StackCreateListDeletePolicy` statements to `cognito-policy.json`, then:
1. Delete inline `StackCreateListDeletePolicy`
2. Delete managed `StackCreateListDeletePolicy` (if created)
3. Add EventBridge permissions to `cognito-policy`

## Recommended Solution

### Best Approach: Merge Everything into cognito-policy

1. **Add EventBridge permissions** to `cognito-policy`
2. **Add StackCreateListDeletePolicy permissions** to `cognito-policy`
3. **Delete inline StackCreateListDeletePolicy** (frees 3525 bytes)
4. **Delete managed StackCreateListDeletePolicy** (if it exists, frees one managed policy slot)
5. **Rename cognito-policy** to something more accurate (e.g., `CCNativeDeploymentPolicy`)

**Benefits:**
- ✅ Frees inline policy quota (3525 bytes)
- ✅ Frees managed policy slot (can attach TestUserPolicy)
- ✅ Consolidates related permissions
- ✅ Test permissions (DynamoDB/S3) already covered by AWS managed policies

**Alternative:** If you want to keep policies separate:
1. Keep `StackCreateListDeletePolicy` as-is (inline)
2. Add minimal EventBridge inline policy (~120 bytes)
3. Total inline: 3525 + 120 = 3645 bytes (still exceeds 2048 limit) ❌ **Won't work**

## Conclusion

**The only viable solution is to merge policies:**
- Merge `StackCreateListDeletePolicy` + EventBridge into `cognito-policy`
- This frees both inline quota and managed policy slot
- Test permissions (DynamoDB/S3) already covered by AWS managed policies
