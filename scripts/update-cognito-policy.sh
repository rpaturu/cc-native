#!/bin/bash

# Script to update cognito-policy managed policy with EventBridge permissions
# This adds the missing EventBridge PutEvents permission for integration tests

set -e

# Load environment variables from .env.local if it exists
if [ -f .env.local ]; then
  source .env.local
fi

# Use ADMIN_PROFILE from .env.local if available
AWS_PROFILE=${ADMIN_PROFILE:-${AWS_PROFILE:-default}}
POLICY_NAME="cognito-policy"
POLICY_FILE="policies/cognito-policy.json"

echo "Updating cognito-policy with EventBridge permissions"
echo "Using AWS Profile: $AWS_PROFILE"
echo ""

# Check if policy file exists
if [ ! -f "$POLICY_FILE" ]; then
  echo "Error: Policy file not found: $POLICY_FILE"
  exit 1
fi

# Get the current managed policy ARN
echo "Finding cognito-policy managed policy..."
POLICY_ARN=$(aws iam list-policies \
  --profile $AWS_PROFILE \
  --scope Local \
  --no-cli-pager \
  --query "Policies[?PolicyName=='$POLICY_NAME'].Arn" \
  --output text 2>/dev/null | head -n 1 || echo "")

if [ -z "$POLICY_ARN" ]; then
  echo "Error: Managed policy '$POLICY_NAME' not found"
  echo "You may need to create it first or check the policy name"
  exit 1
fi

echo "Found policy ARN: $POLICY_ARN"
echo ""

# Read the updated policy document
echo "Reading updated policy document from $POLICY_FILE..."
POLICY_DOCUMENT=$(cat "$POLICY_FILE")

# Create new policy version
echo "Creating new policy version..."
aws iam create-policy-version \
  --profile $AWS_PROFILE \
  --policy-arn "$POLICY_ARN" \
  --policy-document "file://$POLICY_FILE" \
  --set-as-default \
  --no-cli-pager

echo "✓ Policy updated successfully!"
echo ""
echo "The cognito-policy now includes EventBridge PutEvents permission."
echo "Test permissions are now complete:"
echo "  - DynamoDB: ✅ Covered by AmazonDynamoDBFullAccess"
echo "  - S3: ✅ Covered by AmazonS3FullAccess"
echo "  - EventBridge: ✅ Covered by cognito-policy (just added)"
echo ""
echo "You can now run integration tests:"
echo "  npm test"
