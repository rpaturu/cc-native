# Cognito User Pool: UPDATE_ROLLBACK_FAILED Fix

## Assessment

**What happened**

1. A previous deploy added `customAttributes` (service_type, created_by) to the Cognito User Pool in CDK.
2. CloudFormation tried to update the **existing** User Pool to add those attributes.
3. Cognito rejected: *"Existing schema attributes cannot be modified or deleted."* (Cognito does not allow schema changes after creation.)
4. The update failed. CloudFormation started rollback; the User Pool update (or its revert) also failed during rollback, leaving the stack in **UPDATE_ROLLBACK_FAILED**.

**Current code state (Option 1 applied)**

- **User Pool**: Custom attributes have been **removed** from `CCNativeStack.ts`. The User Pool is defined with only standard settings (signInAliases, passwordPolicy, etc.); no `customAttributes`.
- **Gateway service user**: The custom resource uses email-format username `gateway-service@cc-native.local` and only standard attributes (`email`, `email_verified`); no custom attributes required.

So the **template** no longer requests any User Pool schema changes. You still cannot deploy until the stack leaves UPDATE_ROLLBACK_FAILED.

---

## Fix: Unblock the Stack

CloudFormation will not run a new update while the stack is in `UPDATE_ROLLBACK_FAILED`. You must **complete the rollback** and optionally **skip** the resources that cannot roll back (User Pool and, if needed, the custom resource).

### Step 1: Continue update rollback and skip failed resources

Use the AWS CLI (replace `CCNativeStack` and region if different):

```bash
aws cloudformation continue-update-rollback \
  --stack-name CCNativeStack \
  --resources-to-skip UserPool6BA7E5F2
```

If the custom resource also blocks rollback, add it:

```bash
aws cloudformation describe-stack-events \
  --stack-name CCNativeStack \
  --query "StackEvents[?ResourceStatus=='UPDATE_FAILED'].LogicalResourceId" \
  --output text --no-cli-pager
```

Then skip both (use the logical IDs from your stack, e.g. `ExecutionInfrastructureCognitoGatewa...`):

```bash
aws cloudformation continue-update-rollback \
  --stack-name CCNativeStack \
  --resources-to-skip UserPool6BA7E5F2 ExecutionInfrastructureCognitoGatewa...
```

(Use the exact logical resource ID for the custom resource from `describe-stack-events` or the CloudFormation console.)

### Step 2: Wait for rollback to complete

Check status:

```bash
aws cloudformation describe-stacks \
  --stack-name CCNativeStack \
  --query "Stacks[0].StackStatus" --output text --no-cli-pager
```

Wait until status is **UPDATE_ROLLBACK_COMPLETE**.

### Step 3: Deploy again

```bash
./deploy
```

- The **User Pool** template no longer has custom attributes, so CloudFormation will not try to add or remove schema attributes. The update should succeed if the live pool’s schema was never changed.
- The **custom resource** will create the gateway user with `gateway-service@cc-native.local` and only standard attributes.

---

## If User Pool update still fails after rollback

If the **next** deploy fails again on the User Pool with the same schema error (e.g. CloudFormation tries to “remove” attributes and Cognito rejects it):

- **Option A**: Leave the User Pool as-is in the console; do not change its schema. Ensure the CDK User Pool definition matches the **current** pool (no custom attributes). If the pool was created long ago with a different schema, you may need to **import** the existing pool into the stack instead of updating it (advanced).
- **Option B (data loss)**: If the pool has no important users, delete it and redeploy so CloudFormation creates a new pool with the current template:

  ```bash
  # Get pool ID from stack outputs or console
  aws cognito-idp delete-user-pool --user-pool-id <your-pool-id>
  # Then remove the User Pool from the stack (e.g. comment out in CDK, deploy to remove resource), then re-add and deploy; or use retain and create new pool with a new logical ID.
  ```

  Prefer Option A when possible.

---

## Summary

| Item | Status |
|------|--------|
| Remove custom attributes from User Pool (Option 1) | Done in `CCNativeStack.ts` |
| Custom resource: email username + standard attrs only | Done |
| Unblock stack (UPDATE_ROLLBACK_FAILED) | Run `continue-update-rollback` with `--resources-to-skip` |
| Then | Run `./deploy` |
