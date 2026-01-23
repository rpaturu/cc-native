#!/bin/bash

# Script to analyze if StackCreateListDeletePolicy is needed
# and provide recommendations

set -e

# Load environment variables from .env.local if it exists
if [ -f .env.local ]; then
  source .env.local
fi

# Use ADMIN_PROFILE from .env.local if available
AWS_PROFILE=${ADMIN_PROFILE:-${AWS_PROFILE:-default}}

echo "Analyzing StackCreateListDeletePolicy for user: amplify_admin"
echo "Using AWS Profile: $AWS_PROFILE"
echo ""

# Check what profile is used for deployments
echo "Deployment Configuration:"
echo "  AWS_PROFILE in .env.local: ${AWS_PROFILE:-not set}"
echo "  ADMIN_PROFILE in .env.local: ${ADMIN_PROFILE:-not set}"
echo ""

# The deploy script uses AWS_PROFILE (which is amplify_admin)
# So amplify_admin needs CloudFormation permissions for CDK deployments
echo "Analysis:"
echo "  - The 'deploy' script uses AWS_PROFILE (currently: amplify_admin)"
echo "  - CDK deployments require CloudFormation permissions (create, update, delete stacks)"
echo "  - StackCreateListDeletePolicy likely grants these permissions"
echo ""

# Check if we can retrieve the policy
echo "Attempting to retrieve policy document..."
POLICY_DOC=$(aws iam get-user-policy \
  --profile $AWS_PROFILE \
  --user-name amplify_admin \
  --policy-name StackCreateListDeletePolicy \
  --no-cli-pager \
  --query 'PolicyDocument' \
  --output json 2>/dev/null || echo "")

if [ -z "$POLICY_DOC" ] || [ "$POLICY_DOC" == "null" ]; then
  echo "⚠️  Could not retrieve policy (may not exist or network issue)"
  echo ""
  echo "Recommendation:"
  echo "  If the policy doesn't exist, you can safely proceed with removing it."
  echo "  If deployments fail, you'll need to add CloudFormation permissions."
else
  echo "Policy Document:"
  echo "$POLICY_DOC" | python3 -m json.tool 2>/dev/null || echo "$POLICY_DOC"
  echo ""
  
  # Check if it contains CloudFormation permissions
  if echo "$POLICY_DOC" | grep -q "cloudformation"; then
    echo "✓ Policy contains CloudFormation permissions"
    echo ""
    echo "Recommendation:"
    echo "  This policy is NEEDED for CDK deployments using amplify_admin user."
    echo "  However, you have two options:"
    echo ""
    echo "  Option 1: Convert to Managed Policy (Recommended)"
    echo "    - Convert StackCreateListDeletePolicy to a managed policy"
    echo "    - This frees up inline policy quota for test policies"
    echo "    - See docs/testing/INLINE_POLICY_LIMITS.md for instructions"
    echo ""
    echo "  Option 2: Use Different Profile for Deployments"
    echo "    - Modify deploy script to use ADMIN_PROFILE for CDK operations"
    echo "    - Keep amplify_admin only for running tests"
    echo "    - This separates deployment permissions from test permissions"
  else
    echo "⚠️  Policy does not appear to contain CloudFormation permissions"
    echo "   It may be safe to remove if not used elsewhere."
  fi
fi

echo ""
echo "Current Situation:"
echo "  - StackCreateListDeletePolicy: 3525 bytes (exceeds 2048 byte limit)"
echo "  - Cannot add new inline policies due to cumulative size limit"
echo "  - Need to either:"
echo "    1. Convert StackCreateListDeletePolicy to managed policy"
echo "    2. Remove it if not needed"
echo "    3. Use managed policies for test permissions instead"
