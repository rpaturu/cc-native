#!/bin/bash
# Script to identify and delete Cognito User Pool from old account
# Usage: ./scripts/cleanup-old-account-cognito.sh <old_account_profile>

set -e

OLD_PROFILE="${1:-}"

if [ -z "$OLD_PROFILE" ]; then
  echo "Usage: $0 <old_account_profile>"
  echo ""
  echo "Available profiles:"
  cat ~/.aws/credentials | grep -E "^\[" | sed 's/\[//g' | sed 's/\]//g' | grep -v "^$"
  echo ""
  echo "Example: $0 default"
  exit 1
fi

REGION="us-west-2"

echo "🔍 Checking profile: $OLD_PROFILE"
echo ""

# Verify profile works
echo "1. Verifying profile access..."
ACCOUNT_ID=$(aws sts get-caller-identity --profile "$OLD_PROFILE" --no-cli-pager --query Account --output text 2>&1)
if [ $? -ne 0 ]; then
  echo "❌ Error: Cannot access profile '$OLD_PROFILE'"
  echo "$ACCOUNT_ID"
  exit 1
fi

echo "✅ Profile accessible. Account ID: $ACCOUNT_ID"
echo ""

# List Cognito User Pools
echo "2. Listing Cognito User Pools..."
POOLS=$(aws cognito-idp list-user-pools --max-results 10 --profile "$OLD_PROFILE" --region "$REGION" --no-cli-pager 2>&1)

if echo "$POOLS" | grep -q "UserPools"; then
  echo "$POOLS" | jq -r '.UserPools[] | "  - \(.Name) (ID: \(.Id))"'
  
  # Find cc-native User Pool
  CC_NATIVE_POOL=$(echo "$POOLS" | jq -r '.UserPools[] | select(.Name == "cc-native-users") | .Id')
  
  if [ -n "$CC_NATIVE_POOL" ]; then
    echo ""
    echo "✅ Found cc-native User Pool: $CC_NATIVE_POOL"
    echo ""
    echo "⚠️  WARNING: This will permanently delete the Cognito User Pool and all users!"
    echo "   Pool ID: $CC_NATIVE_POOL"
    echo "   Account: $ACCOUNT_ID"
    echo ""
    read -p "Are you sure you want to delete this User Pool? (yes/no): " CONFIRM
    
    if [ "$CONFIRM" = "yes" ]; then
      echo ""
      echo "🗑️  Deleting User Pool..."
      aws cognito-idp delete-user-pool \
        --user-pool-id "$CC_NATIVE_POOL" \
        --profile "$OLD_PROFILE" \
        --region "$REGION" \
        --no-cli-pager
      
      echo ""
      echo "✅ User Pool deleted successfully!"
    else
      echo "❌ Deletion cancelled."
    fi
  else
    echo ""
    echo "ℹ️  No 'cc-native-users' User Pool found in this account."
  fi
else
  echo "ℹ️  No Cognito User Pools found in this account, or error occurred:"
  echo "$POOLS"
fi
