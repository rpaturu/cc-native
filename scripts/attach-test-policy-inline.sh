#!/bin/bash

# Script to attach the Test User Policy as an INLINE policy to an IAM user or role
# This avoids the 10 managed policy limit per IAM user
# Inline policies don't count toward the managed policy quota

set -e

# Load environment variables from .env.local if it exists
if [ -f .env.local ]; then
  source .env.local
fi

# Parse arguments
# Use ADMIN_PROFILE from .env.local if available, otherwise AWS_PROFILE, otherwise default
AWS_PROFILE=${ADMIN_PROFILE:-${AWS_PROFILE:-default}}
AWS_REGION=${AWS_REGION:-us-west-2}
IAM_USER_OR_ROLE_NAME=""
IAM_ENTITY_TYPE="user"  # 'user' or 'role'
POLICY_NAME="CCNativeTestUserPolicy"

while [[ "$#" -gt 0 ]]; do
  case $1 in
    --profile) AWS_PROFILE="$2"; shift;;
    --region) AWS_REGION="$2"; shift;;
    --user) IAM_USER_OR_ROLE_NAME="$2"; IAM_ENTITY_TYPE="user"; shift;;
    --role) IAM_USER_OR_ROLE_NAME="$2"; IAM_ENTITY_TYPE="role"; shift;;
    --policy-name) POLICY_NAME="$2"; shift;;
    --help) 
      echo "Usage: $0 [--profile <aws_profile>] [--region <aws_region>] [--policy-name <name>] --user <iam_user_name> | --role <iam_role_name>"
      echo ""
      echo "Attaches the CC Native Test User Policy as an INLINE policy to an IAM user or role."
      echo "This avoids the 10 managed policy limit per IAM user."
      echo ""
      echo "Options:"
      echo "  --profile <aws_profile>  AWS profile to use (default: ADMIN_PROFILE from .env.local, or AWS_PROFILE, or default)"
      echo "  --region <aws_region>    AWS region (default: us-west-2)"
      echo "  --policy-name <name>     Name for the inline policy (default: CCNativeTestUserPolicy)"
      echo "  --user <iam_user_name>   IAM user name to attach policy to"
      echo "  --role <iam_role_name>   IAM role name to attach policy to"
      echo ""
      echo "The script automatically uses ADMIN_PROFILE from .env.local if available."
      echo ""
      echo "Examples:"
      echo "  $0 --user amplify_admin  # Uses ADMIN_PROFILE from .env.local"
      echo "  $0 --profile dev --user amplify_admin  # Override with custom profile"
      exit 0;;
    *) echo "Unknown parameter: $1"; exit 1;;
  esac
  shift
done

if [ -z "$IAM_USER_OR_ROLE_NAME" ]; then
  echo "Error: Must specify either --user or --role"
  echo "Run '$0 --help' for usage information"
  exit 1
fi

echo "Using AWS Profile: $AWS_PROFILE"
echo "Using AWS Region: $AWS_REGION"
echo "IAM Entity Type: $IAM_ENTITY_TYPE"
echo "IAM Entity Name: $IAM_USER_OR_ROLE_NAME"
echo "Inline Policy Name: $POLICY_NAME"
echo ""

# Get the managed policy document to convert to inline policy
echo "Getting Test User Policy document from stack..."
POLICY_ARN=$(aws cloudformation describe-stacks \
  --profile $AWS_PROFILE \
  --region $AWS_REGION \
  --no-cli-pager \
  --stack-name CCNativeStack \
  --query 'Stacks[0].Outputs[?OutputKey==`TestUserPolicyArn`].OutputValue' \
  --output text)

if [ -z "$POLICY_ARN" ] || [ "$POLICY_ARN" == "None" ]; then
  echo "Error: Could not find TestUserPolicyArn in stack outputs."
  echo "Make sure the stack is deployed and includes the TestUserPolicy output."
  exit 1
fi

echo "Found policy ARN: $POLICY_ARN"
echo ""

# Get the policy document
echo "Retrieving policy document..."
POLICY_DOCUMENT=$(aws iam get-policy \
  --profile $AWS_PROFILE \
  --policy-arn "$POLICY_ARN" \
  --no-cli-pager \
  --query 'Policy.DefaultVersionId' \
  --output text)

POLICY_DOCUMENT_JSON=$(aws iam get-policy-version \
  --profile $AWS_PROFILE \
  --policy-arn "$POLICY_ARN" \
  --version-id "$POLICY_DOCUMENT" \
  --no-cli-pager \
  --query 'PolicyVersion.Document' \
  --output json)

echo "Policy document retrieved successfully"
echo ""

# Check if inline policy already exists
if [ "$IAM_ENTITY_TYPE" == "user" ]; then
  EXISTING_POLICIES=$(aws iam list-user-policies \
    --profile $AWS_PROFILE \
    --user-name "$IAM_USER_OR_ROLE_NAME" \
    --no-cli-pager \
    --query 'PolicyNames' \
    --output json 2>/dev/null || echo "[]")
  
  if echo "$EXISTING_POLICIES" | grep -q "\"$POLICY_NAME\""; then
    echo "Inline policy '$POLICY_NAME' already exists. Updating..."
    aws iam put-user-policy \
      --profile $AWS_PROFILE \
      --user-name "$IAM_USER_OR_ROLE_NAME" \
      --policy-name "$POLICY_NAME" \
      --policy-document "$POLICY_DOCUMENT_JSON" \
      --no-cli-pager
    
    echo "✓ Inline policy updated successfully!"
  else
    echo "Creating inline policy '$POLICY_NAME'..."
    aws iam put-user-policy \
      --profile $AWS_PROFILE \
      --user-name "$IAM_USER_OR_ROLE_NAME" \
      --policy-name "$POLICY_NAME" \
      --policy-document "$POLICY_DOCUMENT_JSON" \
      --no-cli-pager
    
    echo "✓ Inline policy attached successfully!"
  fi
  
  echo ""
  echo "The IAM user '$IAM_USER_OR_ROLE_NAME' now has permissions to:"
  echo "  - Read/Write all DynamoDB tables"
  echo "  - Read/Write all S3 buckets"
  echo "  - PutEvents to EventBridge event bus"
  echo ""
  echo "You can now run integration tests with this user."
else
  EXISTING_POLICIES=$(aws iam list-role-policies \
    --profile $AWS_PROFILE \
    --role-name "$IAM_USER_OR_ROLE_NAME" \
    --no-cli-pager \
    --query 'PolicyNames' \
    --output json 2>/dev/null || echo "[]")
  
  if echo "$EXISTING_POLICIES" | grep -q "\"$POLICY_NAME\""; then
    echo "Inline policy '$POLICY_NAME' already exists. Updating..."
    aws iam put-role-policy \
      --profile $AWS_PROFILE \
      --role-name "$IAM_USER_OR_ROLE_NAME" \
      --policy-name "$POLICY_NAME" \
      --policy-document "$POLICY_DOCUMENT_JSON" \
      --no-cli-pager
    
    echo "✓ Inline policy updated successfully!"
  else
    echo "Creating inline policy '$POLICY_NAME'..."
    aws iam put-role-policy \
      --profile $AWS_PROFILE \
      --role-name "$IAM_USER_OR_ROLE_NAME" \
      --policy-name "$POLICY_NAME" \
      --policy-document "$POLICY_DOCUMENT_JSON" \
      --no-cli-pager
    
    echo "✓ Inline policy attached successfully!"
  fi
  
  echo ""
  echo "The IAM role '$IAM_USER_OR_ROLE_NAME' now has permissions to:"
  echo "  - Read/Write all DynamoDB tables"
  echo "  - Read/Write all S3 buckets"
  echo "  - PutEvents to EventBridge event bus"
  echo ""
  echo "You can now run integration tests with this role."
fi
