#!/bin/bash

# Script to convert StackCreateListDeletePolicy from inline to managed policy
# This frees up the inline policy quota for test policies

set -e

# Load environment variables from .env.local if it exists
if [ -f .env.local ]; then
  source .env.local
fi

# Use ADMIN_PROFILE from .env.local if available
AWS_PROFILE=${ADMIN_PROFILE:-${AWS_PROFILE:-default}}
IAM_USER_NAME="amplify_admin"
POLICY_NAME="StackCreateListDeletePolicy"

echo "Converting StackCreateListDeletePolicy from inline to managed policy"
echo "Using AWS Profile: $AWS_PROFILE"
echo "IAM User: $IAM_USER_NAME"
echo ""

# Step 1: Get the inline policy document
echo "Step 1: Retrieving inline policy document..."
POLICY_DOC=$(aws iam get-user-policy \
  --profile $AWS_PROFILE \
  --user-name "$IAM_USER_NAME" \
  --policy-name "$POLICY_NAME" \
  --no-cli-pager \
  --query 'PolicyDocument' \
  --output json 2>/dev/null || echo "")

if [ -z "$POLICY_DOC" ] || [ "$POLICY_DOC" == "null" ]; then
  echo "Error: Could not retrieve inline policy '$POLICY_NAME'"
  echo "The policy may not exist or you may not have permissions to read it."
  exit 1
fi

echo "✓ Policy document retrieved"
echo ""

# Step 2: Create managed policy
echo "Step 2: Creating managed policy..."
MANAGED_POLICY_ARN=$(aws iam create-policy \
  --profile $AWS_PROFILE \
  --policy-name "$POLICY_NAME" \
  --policy-document "$POLICY_DOC" \
  --description "CloudFormation stack operations (create, list, delete) - converted from inline policy" \
  --no-cli-pager \
  --query 'Policy.Arn' \
  --output text 2>/dev/null || echo "")

if [ -z "$MANAGED_POLICY_ARN" ] || [ "$MANAGED_POLICY_ARN" == "None" ]; then
  # Policy might already exist, try to get it
  echo "Policy may already exist, checking..."
  MANAGED_POLICY_ARN=$(aws iam list-policies \
    --profile $AWS_PROFILE \
    --scope Local \
    --no-cli-pager \
    --query "Policies[?PolicyName=='$POLICY_NAME'].Arn" \
    --output text 2>/dev/null | head -n 1 || echo "")
  
  if [ -z "$MANAGED_POLICY_ARN" ]; then
    echo "Error: Could not create or find managed policy"
    exit 1
  fi
  echo "✓ Using existing managed policy: $MANAGED_POLICY_ARN"
else
  echo "✓ Managed policy created: $MANAGED_POLICY_ARN"
fi
echo ""

# Step 3: Attach managed policy to user
echo "Step 3: Attaching managed policy to user..."
aws iam attach-user-policy \
  --profile $AWS_PROFILE \
  --user-name "$IAM_USER_NAME" \
  --policy-arn "$MANAGED_POLICY_ARN" \
  --no-cli-pager

echo "✓ Managed policy attached"
echo ""

# Step 4: Delete inline policy
echo "Step 4: Deleting inline policy..."
aws iam delete-user-policy \
  --profile $AWS_PROFILE \
  --user-name "$IAM_USER_NAME" \
  --policy-name "$POLICY_NAME" \
  --no-cli-pager

echo "✓ Inline policy deleted"
echo ""

echo "✅ Conversion complete!"
echo ""
echo "Summary:"
echo "  - Inline policy '$POLICY_NAME' converted to managed policy"
echo "  - Managed policy ARN: $MANAGED_POLICY_ARN"
echo "  - Inline policy quota freed (3525 bytes)"
echo ""
echo "You can now add test policies using:"
echo "  ./scripts/attach-test-policy-inline.sh --user amplify_admin"
