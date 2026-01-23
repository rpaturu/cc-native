# AWS IAM Inline Policy Limits

## The Problem

AWS IAM has strict limits on inline policies:

1. **Per Policy Limit**: Each individual inline policy cannot exceed **2048 bytes**
2. **Cumulative Limit**: The **total size of ALL inline policies** for a user cannot exceed **2048 bytes**

## Current Situation

Your IAM user `amplify_admin` already has:
- `StackCreateListDeletePolicy`: **3525 bytes** (exceeds the limit!)

This means you cannot add any new inline policies because the existing policy alone exceeds the 2048-byte cumulative limit.

## Solutions

### Option 1: Remove Existing Inline Policy (Recommended)

If `StackCreateListDeletePolicy` is no longer needed, remove it:

```bash
aws iam delete-user-policy \
  --profile iamadminrp \
  --user-name amplify_admin \
  --policy-name StackCreateListDeletePolicy \
  --no-cli-pager
```

Then run the attach script again:
```bash
./scripts/attach-test-policy-inline.sh --user amplify_admin
```

### Option 2: Convert to Managed Policy

If you need to keep `StackCreateListDeletePolicy`, convert it to a managed policy:

1. Get the policy document:
```bash
aws iam get-user-policy \
  --profile iamadminrp \
  --user-name amplify_admin \
  --policy-name StackCreateListDeletePolicy \
  --no-cli-pager \
  --query 'PolicyDocument' \
  --output json > /tmp/stack-policy.json
```

2. Create a managed policy:
```bash
aws iam create-policy \
  --profile iamadminrp \
  --policy-name StackCreateListDeletePolicy \
  --policy-document file:///tmp/stack-policy.json \
  --no-cli-pager
```

3. Attach the managed policy:
```bash
POLICY_ARN=$(aws iam list-policies \
  --profile iamadminrp \
  --scope Local \
  --query 'Policies[?PolicyName==`StackCreateListDeletePolicy`].Arn' \
  --output text \
  --no-cli-pager)

aws iam attach-user-policy \
  --profile iamadminrp \
  --user-name amplify_admin \
  --policy-arn "$POLICY_ARN" \
  --no-cli-pager
```

4. Delete the inline policy:
```bash
aws iam delete-user-policy \
  --profile iamadminrp \
  --user-name amplify_admin \
  --policy-name StackCreateListDeletePolicy \
  --no-cli-pager
```

### Option 3: Use Managed Policies for Test Permissions

Instead of inline policies, use the managed policy approach (if you have fewer than 10 managed policies):

```bash
./scripts/attach-test-policy.sh --user amplify_admin
```

## Why This Happens

AWS enforces these limits to:
- Prevent policy bloat
- Ensure IAM performance
- Encourage use of managed policies (which are reusable and don't have these limits)

## Best Practices

1. **Use Managed Policies**: For reusable permissions, always use managed policies
2. **Use Inline Policies Sparingly**: Only for user-specific, one-off permissions
3. **Monitor Policy Sizes**: Regularly check total inline policy size
4. **Consolidate When Possible**: Combine related permissions into single policies

## References

- [AWS IAM Limits](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_iam-quotas.html)
- [Inline vs Managed Policies](https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies_managed-vs-inline.html)
