#!/bin/bash

# Script to remove StackCreateListDeletePolicy from amplify_admin user
# This frees up inline policy quota for test policies

set -e

# Load environment variables from .env.local if it exists
if [ -f .env.local ]; then
  source .env.local
fi

# Use ADMIN_PROFILE from .env.local if available
AWS_PROFILE=${ADMIN_PROFILE:-${AWS_PROFILE:-default}}
IAM_USER_NAME="amplify_admin"
POLICY_NAME="StackCreateListDeletePolicy"

echo "Removing StackCreateListDeletePolicy from user: $IAM_USER_NAME"
echo "Using AWS Profile: $AWS_PROFILE"
echo ""

# Check if policy exists
echo "Checking if policy exists..."
POLICY_EXISTS=$(aws iam list-user-policies \
  --profile $AWS_PROFILE \
  --user-name "$IAM_USER_NAME" \
  --no-cli-pager \
  --query "PolicyNames[?@=='$POLICY_NAME']" \
  --output text 2>/dev/null || echo "")

if [ -z "$POLICY_EXISTS" ]; then
  echo "Policy '$POLICY_NAME' does not exist. Nothing to remove."
  exit 0
fi

echo "✓ Policy found"
echo ""

# Show what the policy grants (for reference)
echo "Retrieving policy document for reference..."
POLICY_DOC=$(aws iam get-user-policy \
  --profile $AWS_PROFILE \
  --user-name "$IAM_USER_NAME" \
  --policy-name "$POLICY_NAME" \
  --no-cli-pager \
  --query 'PolicyDocument' \
  --output json 2>/dev/null || echo "")

if [ -n "$POLICY_DOC" ] && [ "$POLICY_DOC" != "null" ]; then
  echo "Policy grants:"
  echo "$POLICY_DOC" | python3 -c "
import sys, json
doc = json.load(sys.stdin)
for stmt in doc.get('Statement', []):
    actions = stmt.get('Action', [])
    if isinstance(actions, str):
        actions = [actions]
    for action in actions:
        print(f'  - {action}')
" 2>/dev/null || echo "  (Could not parse policy document)"
  echo ""
fi

# Confirm deletion
echo "⚠️  WARNING: This will remove CloudFormation deployment permissions from amplify_admin"
echo "   If you use amplify_admin for CDK deployments (./deploy), you'll need:"
echo "   - cloudformation:CreateStack"
echo "   - cloudformation:UpdateStack"
echo "   - cloudformation:DeleteStack"
echo "   - cloudformation:DescribeStacks"
echo "   - cloudformation:ListStacks"
echo "   - And other CloudFormation permissions"
echo ""
echo "   Alternative: Use ADMIN_PROFILE (iamadminrp) for deployments instead"
echo ""

read -p "Are you sure you want to remove this policy? (type 'yes' to confirm): " confirmation

if [ "$confirmation" != "yes" ]; then
  echo "Removal cancelled."
  exit 0
fi

# Delete the policy
echo ""
echo "Deleting inline policy..."
aws iam delete-user-policy \
  --profile $AWS_PROFILE \
  --user-name "$IAM_USER_NAME" \
  --policy-name "$POLICY_NAME" \
  --no-cli-pager

echo "✓ Policy removed successfully!"
echo ""
echo "You can now add test policies:"
echo "  ./scripts/attach-test-policy-inline.sh --user amplify_admin"
echo ""
echo "Note: If CDK deployments fail, you may need to:"
echo "  1. Use ADMIN_PROFILE for deployments: ./deploy --profile iamadminrp"
echo "  2. Or add CloudFormation permissions back as a managed policy"
