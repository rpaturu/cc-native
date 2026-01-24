#!/bin/bash
# Delete cc-native-users Cognito User Pool from old account
# This script deletes ONLY the cc-native-users pool, leaving other pools intact

set -e

OLD_PROFILE="${1:-}"

if [ -z "$OLD_PROFILE" ]; then
  echo "Usage: $0 <old_account_profile>"
  echo ""
  echo "This will delete the 'cc-native-users' Cognito User Pool from the old account."
  echo "Other pools (like sales-intelligence-ux-user-pool) will NOT be affected."
  echo ""
  exit 1
fi

REGION="us-west-2"
USER_POOL_ID="us-west-2_30F3esthi"  # From the screenshot
USER_POOL_NAME="cc-native-users"

echo "🔍 Verifying profile and User Pool..."
echo ""

# Verify profile works
ACCOUNT_ID=$(aws sts get-caller-identity --profile "$OLD_PROFILE" --no-cli-pager --query Account --output text 2>&1)
if [ $? -ne 0 ]; then
  echo "❌ Error: Cannot access profile '$OLD_PROFILE'"
  echo "$ACCOUNT_ID"
  exit 1
fi

echo "✅ Profile accessible. Account ID: $ACCOUNT_ID"
echo ""

# Verify the User Pool exists and get its details
echo "📋 Checking User Pool details..."
POOL_INFO=$(aws cognito-idp describe-user-pool \
  --user-pool-id "$USER_POOL_ID" \
  --profile "$OLD_PROFILE" \
  --region "$REGION" \
  --no-cli-pager 2>&1)

if echo "$POOL_INFO" | grep -q "ResourceNotFoundException"; then
  echo "❌ User Pool not found. It may have already been deleted."
  exit 1
fi

POOL_NAME=$(echo "$POOL_INFO" | grep -o '"Name": "[^"]*"' | cut -d'"' -f4)
echo "✅ Found User Pool: $POOL_NAME (ID: $USER_POOL_ID)"
echo ""

# Count users (should be 0, but let's verify)
USER_COUNT=$(aws cognito-idp list-users \
  --user-pool-id "$USER_POOL_ID" \
  --profile "$OLD_PROFILE" \
  --region "$REGION" \
  --no-cli-pager \
  --query "length(Users)" \
  --output text 2>&1)

echo "👥 Users in pool: $USER_COUNT"
echo ""

# List all pools to show what will remain
echo "📋 Current User Pools in this account:"
aws cognito-idp list-user-pools \
  --max-results 10 \
  --profile "$OLD_PROFILE" \
  --region "$REGION" \
  --no-cli-pager \
  --query "UserPools[].[Name, Id]" \
  --output table

echo ""
echo "⚠️  WARNING: This will permanently delete the Cognito User Pool:"
echo "   Name: $USER_POOL_NAME"
echo "   ID: $USER_POOL_ID"
echo "   Account: $ACCOUNT_ID"
echo "   Users: $USER_COUNT"
echo ""
echo "✅ Other pools (like sales-intelligence-ux-user-pool) will NOT be affected."
echo ""

read -p "Are you sure you want to delete this User Pool? (type 'yes' to confirm): " CONFIRM

if [ "$CONFIRM" != "yes" ]; then
  echo "❌ Deletion cancelled."
  exit 0
fi

echo ""
echo "🗑️  Deleting User Pool: $USER_POOL_NAME..."
aws cognito-idp delete-user-pool \
  --user-pool-id "$USER_POOL_ID" \
  --profile "$OLD_PROFILE" \
  --region "$REGION" \
  --no-cli-pager

echo ""
echo "✅ User Pool deleted successfully!"
echo ""
echo "📋 Remaining User Pools:"
aws cognito-idp list-user-pools \
  --max-results 10 \
  --profile "$OLD_PROFILE" \
  --region "$REGION" \
  --no-cli-pager \
  --query "UserPools[].[Name, Id]" \
  --output table
