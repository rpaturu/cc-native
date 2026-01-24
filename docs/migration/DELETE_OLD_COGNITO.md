# Delete Cognito User Pool from Old Account

## ⚠️ Important: Verify Account First

**Before deleting, make sure you're targeting the OLD account, not the new one!**

- **New Account ID:** `661268174397` (profile: `cc-native-account`)
- **Old Account ID:** `<your-old-account-id>` (profile: `<old-profile-name>`)

## Step 1: Identify the Old Account Profile

If you don't know which profile is the old account, check all profiles:

```bash
# List all profiles
cat ~/.aws/credentials | grep -E "^\[" | sed 's/\[//g' | sed 's/\]//g'

# Check account ID for each profile
for profile in <profile1> <profile2> <profile3>; do
  echo "Profile: $profile"
  aws sts get-caller-identity --profile "$profile" --no-cli-pager --query Account --output text
done
```

**The old account should NOT be `661268174397`** (that's your new account).

## Step 2: List Cognito User Pools in Old Account

```bash
aws cognito-idp list-user-pools \
  --max-results 10 \
  --profile <old_account_profile> \
  --region us-west-2 \
  --no-cli-pager
```

Look for a pool named `cc-native-users` and note its `Id` (User Pool ID).

## Step 3: Verify It's Safe to Delete

Since you confirmed there are **0 users** in the pool, it's safe to delete.

**Double-check:**
```bash
# List users in the pool (should show 0)
aws cognito-idp list-users \
  --user-pool-id <USER_POOL_ID> \
  --profile <old_account_profile> \
  --region us-west-2 \
  --no-cli-pager \
  --query "Users" \
  --output json
```

## Step 4: Delete the User Pool

```bash
aws cognito-idp delete-user-pool \
  --user-pool-id <USER_POOL_ID> \
  --profile <old_account_profile> \
  --region us-west-2 \
  --no-cli-pager
```

**Expected output:** (no output on success)

## Step 5: Verify Deletion

```bash
aws cognito-idp list-user-pools \
  --max-results 10 \
  --profile <old_account_profile> \
  --region us-west-2 \
  --no-cli-pager
```

The `cc-native-users` pool should no longer appear in the list.

## Alternative: Use the Cleanup Script

```bash
./scripts/cleanup-old-account-cognito.sh <old_account_profile>
```

The script will:
1. Verify the profile works
2. List all Cognito pools
3. Find `cc-native-users`
4. Ask for confirmation
5. Delete it

## What Gets Deleted

- ✅ User Pool (`cc-native-users`)
- ✅ All User Pool Clients
- ✅ All configuration (password policies, MFA settings, etc.)
- ✅ **All users** (but you confirmed there are 0)

## Cost Impact

- **Before:** $0/month (empty pool has no cost)
- **After:** $0/month (deleted = no cost)

## Next Steps After Deletion

1. ✅ Cognito cleanup complete
2. ⚠️ S3 buckets with Object Lock remain (cannot be deleted for 7 years)
3. ⚠️ KMS keys may still be scheduled for deletion (7-30 day delay)

---

**Note:** If you're unsure which account is which, check the account ID first:
```bash
aws sts get-caller-identity --profile <profile_name> --no-cli-pager
```
