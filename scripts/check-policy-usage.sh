#!/bin/bash

# Script to check if StackCreateListDeletePolicy is still needed
# and show what permissions it grants

set -e

# Load environment variables from .env.local if it exists
if [ -f .env.local ]; then
  source .env.local
fi

# Use ADMIN_PROFILE from .env.local if available
AWS_PROFILE=${ADMIN_PROFILE:-${AWS_PROFILE:-default}}

echo "Checking StackCreateListDeletePolicy for user: amplify_admin"
echo "Using AWS Profile: $AWS_PROFILE"
echo ""

# Get the policy document
echo "Retrieving policy document..."
POLICY_DOC=$(aws iam get-user-policy \
  --profile $AWS_PROFILE \
  --user-name amplify_admin \
  --policy-name StackCreateListDeletePolicy \
  --no-cli-pager \
  --query 'PolicyDocument' \
  --output json 2>/dev/null || echo "")

if [ -z "$POLICY_DOC" ] || [ "$POLICY_DOC" == "null" ]; then
  echo "Policy not found or error retrieving it."
  exit 1
fi

# Display the policy
echo "Policy Document:"
echo "$POLICY_DOC" | python3 -m json.tool 2>/dev/null || echo "$POLICY_DOC"
echo ""

# Check size
POLICY_SIZE=$(echo "$POLICY_DOC" | wc -c | tr -d ' ')
echo "Policy size: $POLICY_SIZE bytes"
echo ""

# Analyze what it grants
echo "This policy likely grants permissions for:"
echo "  - CloudFormation stack operations (create, update, delete, list)"
echo "  - CDK deployment operations"
echo ""
echo "If you're using CDK/CloudFormation to deploy infrastructure, you need these permissions."
echo "However, you can:"
echo "  1. Convert this to a managed policy (doesn't count toward inline policy limit)"
echo "  2. Use a different IAM user/role for deployments (separate from test user)"
echo "  3. Remove it if you're not using CDK/CloudFormation anymore"
echo ""
