#!/bin/bash

# Script to attach the Test User Policy to an IAM user or role
# This grants permissions needed for running integration tests

set -e

# Load environment variables from .env.local if it exists
if [ -f .env.local ]; then
  source .env.local
fi

# Parse arguments
AWS_PROFILE=${AWS_PROFILE:-default}
AWS_REGION=${AWS_REGION:-us-west-2}
IAM_USER_OR_ROLE_NAME=""
IAM_ENTITY_TYPE="user"  # 'user' or 'role'

while [[ "$#" -gt 0 ]]; do
  case $1 in
    --profile) AWS_PROFILE="$2"; shift;;
    --region) AWS_REGION="$2"; shift;;
    --user) IAM_USER_OR_ROLE_NAME="$2"; IAM_ENTITY_TYPE="user"; shift;;
    --role) IAM_USER_OR_ROLE_NAME="$2"; IAM_ENTITY_TYPE="role"; shift;;
    --help) 
      echo "Usage: $0 [--profile <aws_profile>] [--region <aws_region>] --user <iam_user_name> | --role <iam_role_name>"
      echo ""
      echo "Attaches the CC Native Test User Policy to an IAM user or role."
      echo "This policy grants permissions needed for running integration tests."
      echo ""
      echo "Options:"
      echo "  --profile <aws_profile>  AWS profile to use (default: default)"
      echo "  --region <aws_region>    AWS region (default: us-west-2)"
      echo "  --user <iam_user_name>   IAM user name to attach policy to"
      echo "  --role <iam_role_name>   IAM role name to attach policy to"
      echo ""
      echo "Example:"
      echo "  $0 --profile dev --user amplify_admin"
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
echo ""

# Get the policy ARN from stack outputs
echo "Getting Test User Policy ARN from stack outputs..."
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

# Attach the policy
if [ "$IAM_ENTITY_TYPE" == "user" ]; then
  echo "Attaching policy to IAM user: $IAM_USER_OR_ROLE_NAME"
  aws iam attach-user-policy \
    --profile $AWS_PROFILE \
    --user-name "$IAM_USER_OR_ROLE_NAME" \
    --policy-arn "$POLICY_ARN" \
    --no-cli-pager
  
  echo "✓ Policy attached successfully!"
  echo ""
  echo "The IAM user '$IAM_USER_OR_ROLE_NAME' now has permissions to:"
  echo "  - Read/Write all DynamoDB tables"
  echo "  - Read/Write all S3 buckets"
  echo "  - PutEvents to EventBridge event bus"
  echo ""
  echo "You can now run integration tests with this user."
else
  echo "Attaching policy to IAM role: $IAM_USER_OR_ROLE_NAME"
  aws iam attach-role-policy \
    --profile $AWS_PROFILE \
    --role-name "$IAM_USER_OR_ROLE_NAME" \
    --policy-arn "$POLICY_ARN" \
    --no-cli-pager
  
  echo "✓ Policy attached successfully!"
  echo ""
  echo "The IAM role '$IAM_USER_OR_ROLE_NAME' now has permissions to:"
  echo "  - Read/Write all DynamoDB tables"
  echo "  - Read/Write all S3 buckets"
  echo "  - PutEvents to EventBridge event bus"
  echo ""
  echo "You can now run integration tests with this role."
fi
