#!/bin/bash

# Script to remove CCNativeStack-TestUserPolicy managed policy
# This policy is no longer needed since test permissions are now covered by:
# - AmazonDynamoDBFullAccess (DynamoDB)
# - AmazonS3FullAccess (S3)
# - cognito-policy (EventBridge)

set -e

# Load environment variables from .env.local if it exists
if [ -f .env.local ]; then
  source .env.local
fi

# Use ADMIN_PROFILE from .env.local if available
AWS_PROFILE=${ADMIN_PROFILE:-${AWS_PROFILE:-default}}
AWS_REGION=${AWS_REGION:-us-west-2}
POLICY_NAME_PREFIX="CCNativeStack-TestUserPolicy"

echo "Removing TestUserPolicy managed policy"
echo "Using AWS Profile: $AWS_PROFILE"
echo "Using AWS Region: $AWS_REGION"
echo ""

# Get the policy ARN from stack outputs
echo "Getting TestUserPolicy ARN from stack outputs..."
POLICY_ARN=$(aws cloudformation describe-stacks \
  --profile $AWS_PROFILE \
  --region $AWS_REGION \
  --no-cli-pager \
  --stack-name CCNativeStack \
  --query 'Stacks[0].Outputs[?OutputKey==`TestUserPolicyArn`].OutputValue' \
  --output text 2>/dev/null || echo "")

if [ -z "$POLICY_ARN" ] || [ "$POLICY_ARN" == "None" ]; then
  echo "Policy not found in stack outputs. Trying to find by name..."
  # Try to find by name pattern
  POLICY_ARN=$(aws iam list-policies \
    --profile $AWS_PROFILE \
    --scope Local \
    --no-cli-pager \
    --query "Policies[?starts_with(PolicyName, '$POLICY_NAME_PREFIX')].Arn" \
    --output text 2>/dev/null | head -n 1 || echo "")
fi

if [ -z "$POLICY_ARN" ]; then
  echo "✓ TestUserPolicy not found. It may have already been removed."
  exit 0
fi

echo "Found policy ARN: $POLICY_ARN"
echo ""

# Check if policy is attached to any users or roles
echo "Checking if policy is attached to any users or roles..."
ATTACHED_USERS=$(aws iam list-entities-for-policy \
  --profile $AWS_PROFILE \
  --policy-arn "$POLICY_ARN" \
  --no-cli-pager \
  --query 'PolicyUsers[].UserName' \
  --output text 2>/dev/null || echo "")

ATTACHED_ROLES=$(aws iam list-entities-for-policy \
  --profile $AWS_PROFILE \
  --policy-arn "$POLICY_ARN" \
  --no-cli-pager \
  --query 'PolicyRoles[].RoleName' \
  --output text 2>/dev/null || echo "")

if [ -n "$ATTACHED_USERS" ] || [ -n "$ATTACHED_ROLES" ]; then
  echo "⚠️  Warning: Policy is attached to:"
  if [ -n "$ATTACHED_USERS" ]; then
    echo "   Users: $ATTACHED_USERS"
  fi
  if [ -n "$ATTACHED_ROLES" ]; then
    echo "   Roles: $ATTACHED_ROLES"
  fi
  echo ""
  echo "Detaching policy first..."
  
  # Detach from users
  for user in $ATTACHED_USERS; do
    echo "  Detaching from user: $user"
    aws iam detach-user-policy \
      --profile $AWS_PROFILE \
      --user-name "$user" \
      --policy-arn "$POLICY_ARN" \
      --no-cli-pager || echo "    (Failed or already detached)"
  done
  
  # Detach from roles
  for role in $ATTACHED_ROLES; do
    echo "  Detaching from role: $role"
    aws iam detach-role-policy \
      --profile $AWS_PROFILE \
      --role-name "$role" \
      --policy-arn "$POLICY_ARN" \
      --no-cli-pager || echo "    (Failed or already detached)"
  done
fi

# Delete all non-default policy versions first
echo ""
echo "Deleting old policy versions..."
VERSIONS=$(aws iam list-policy-versions \
  --profile $AWS_PROFILE \
  --policy-arn "$POLICY_ARN" \
  --no-cli-pager \
  --query 'Versions[?IsDefaultVersion==`false`].VersionId' \
  --output text 2>/dev/null || echo "")

for version in $VERSIONS; do
  echo "  Deleting version: $version"
  aws iam delete-policy-version \
    --profile $AWS_PROFILE \
    --policy-arn "$POLICY_ARN" \
    --version-id "$version" \
    --no-cli-pager || echo "    (Failed or already deleted)"
done

# Delete the policy
echo ""
echo "Deleting policy..."
aws iam delete-policy \
  --profile $AWS_PROFILE \
  --policy-arn "$POLICY_ARN" \
  --no-cli-pager

echo "✓ TestUserPolicy removed successfully!"
echo ""
echo "Test permissions are now provided by:"
echo "  - AmazonDynamoDBFullAccess (DynamoDB)"
echo "  - AmazonS3FullAccess (S3)"
echo "  - cognito-policy (EventBridge)"
