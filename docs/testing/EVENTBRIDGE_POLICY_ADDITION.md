# Adding EventBridge Permissions - Simple Solution

## Current Situation

- **Test permissions needed:**
  - DynamoDB: ✅ Covered by `AmazonDynamoDBFullAccess`
  - S3: ✅ Covered by `AmazonS3FullAccess`
  - EventBridge: ❌ **NOT COVERED** - This is the only missing permission

- **Problem:**
  - Cannot add inline EventBridge policy because `StackCreateListDeletePolicy` (3525 bytes) already exceeds 2048-byte limit
  - Cannot attach new managed policy because user already has 10 managed policies

## Simple Solution: Add EventBridge to cognito-policy

**cognito-policy** is a **customer managed policy** - we can modify it!

### What to Add

Add this statement to `cognito-policy.json`:

```json
{
  "Effect": "Allow",
  "Action": [
    "events:PutEvents"
  ],
  "Resource": [
    "arn:aws:events:*:*:event-bus/cc-native-events"
  ]
}
```

### Steps

1. **Update cognito-policy.json** - Add EventBridge statement
2. **Update the managed policy in AWS** - Use `aws iam create-policy-version` or update via CDK/console
3. **Done!** - Test permissions now complete

### Benefits

- ✅ Simple - just add one statement
- ✅ No need to merge StackCreateListDeletePolicy
- ✅ No need to free up managed policy slots
- ✅ DynamoDB and S3 already covered by AWS managed policies
- ✅ EventBridge is the only missing piece

### Policy Size Impact

- Current `cognito-policy`: ~57 lines
- Adding EventBridge: +6 lines
- Total impact: Minimal

### Alternative: Check if Any AWS Managed Policy Covers EventBridge

Let me check the AWS managed policies:
- `AmplifyBackendDeployFullAccess` - Might include EventBridge
- Others - Unlikely to include EventBridge

**Recommendation:** Add to `cognito-policy` - it's customer managed and we control it.
