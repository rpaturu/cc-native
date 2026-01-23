#!/bin/bash

# Script to attach the Test User Policy as INLINE policies to an IAM user or role
# Splits the policy into multiple smaller policies to avoid the 2048 byte limit per inline policy
# This avoids both the 10 managed policy limit and the 2048 byte inline policy limit

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

while [[ "$#" -gt 0 ]]; do
  case $1 in
    --profile) AWS_PROFILE="$2"; shift;;
    --region) AWS_REGION="$2"; shift;;
    --user) IAM_USER_OR_ROLE_NAME="$2"; IAM_ENTITY_TYPE="user"; shift;;
    --role) IAM_USER_OR_ROLE_NAME="$2"; IAM_ENTITY_TYPE="role"; shift;;
    --help) 
      echo "Usage: $0 [--profile <aws_profile>] [--region <aws_region>] --user <iam_user_name> | --role <iam_role_name>"
      echo ""
      echo "Attaches the CC Native Test User Policy as INLINE policies to an IAM user or role."
      echo "Splits into multiple smaller policies to avoid size limits."
      echo "This avoids both the 10 managed policy limit and the 2048 byte inline policy limit."
      echo ""
      echo "Options:"
      echo "  --profile <aws_profile>  AWS profile to use (default: ADMIN_PROFILE from .env.local, or AWS_PROFILE, or default)"
      echo "  --region <aws_region>    AWS region (default: us-west-2)"
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
echo ""

# Get the managed policy document to convert to inline policies
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
POLICY_VERSION=$(aws iam get-policy \
  --profile $AWS_PROFILE \
  --policy-arn "$POLICY_ARN" \
  --no-cli-pager \
  --query 'Policy.DefaultVersionId' \
  --output text)

FULL_POLICY_DOCUMENT=$(aws iam get-policy-version \
  --profile $AWS_PROFILE \
  --policy-arn "$POLICY_ARN" \
  --version-id "$POLICY_VERSION" \
  --no-cli-pager \
  --query 'PolicyVersion.Document' \
  --output json)

echo "Policy document retrieved successfully"
echo ""

# Create compact policies using wildcards - MINIFIED JSON (no whitespace)
# This approach creates the smallest possible policies

# DynamoDB Policy - Minified JSON (use double quotes for variable expansion)
DYNAMODB_POLICY="{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Action\":[\"dynamodb:PutItem\",\"dynamodb:GetItem\",\"dynamodb:UpdateItem\",\"dynamodb:DeleteItem\",\"dynamodb:Query\",\"dynamodb:Scan\",\"dynamodb:BatchGetItem\",\"dynamodb:BatchWriteItem\"],\"Resource\":[\"arn:aws:dynamodb:*:*:table/cc-native-*\",\"arn:aws:dynamodb:*:*:table/cc-native-*/index/*\"]}]}"

# S3 Policy - Minified JSON
S3_POLICY="{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Action\":[\"s3:GetObject\",\"s3:PutObject\",\"s3:DeleteObject\",\"s3:ListBucket\",\"s3:GetObjectVersion\",\"s3:PutObjectVersion\"],\"Resource\":[\"arn:aws:s3:::cc-native-*\",\"arn:aws:s3:::cc-native-*/*\"]}]}"

# EventBridge Policy - Minified JSON
EVENTBRIDGE_POLICY="{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Action\":[\"events:PutEvents\"],\"Resource\":[\"arn:aws:events:*:*:event-bus/cc-native-events\"]}]}"

# Function to put inline policy
put_inline_policy() {
  local policy_name=$1
  local policy_doc=$2
  
  # Validate policy document is not empty
  if [ -z "$policy_doc" ]; then
    echo "  ERROR: Policy document is empty for '$policy_name'"
    return 1
  fi
  
  if [ "$IAM_ENTITY_TYPE" == "user" ]; then
    # Check if policy exists
    EXISTING=$(aws iam list-user-policies \
      --profile $AWS_PROFILE \
      --user-name "$IAM_USER_OR_ROLE_NAME" \
      --no-cli-pager \
      --query "PolicyNames[?@=='$policy_name']" \
      --output text 2>/dev/null || echo "")
    
    if [ -n "$EXISTING" ]; then
      echo "  Updating inline policy '$policy_name'..."
      aws iam put-user-policy \
        --profile $AWS_PROFILE \
        --user-name "$IAM_USER_OR_ROLE_NAME" \
        --policy-name "$policy_name" \
        --policy-document "$policy_doc" \
        --no-cli-pager
    else
      echo "  Creating inline policy '$policy_name'..."
      aws iam put-user-policy \
        --profile $AWS_PROFILE \
        --user-name "$IAM_USER_OR_ROLE_NAME" \
        --policy-name "$policy_name" \
        --policy-document "$policy_doc" \
        --no-cli-pager
    fi
  else
    # Check if policy exists
    EXISTING=$(aws iam list-role-policies \
      --profile $AWS_PROFILE \
      --role-name "$IAM_USER_OR_ROLE_NAME" \
      --no-cli-pager \
      --query "PolicyNames[?@=='$policy_name']" \
      --output text 2>/dev/null || echo "")
    
    if [ -n "$EXISTING" ]; then
      echo "  Updating inline policy '$policy_name'..."
      aws iam put-role-policy \
        --profile $AWS_PROFILE \
        --role-name "$IAM_USER_OR_ROLE_NAME" \
        --policy-name "$policy_name" \
        --policy-document "$policy_doc" \
        --no-cli-pager
    else
      echo "  Creating inline policy '$policy_name'..."
      aws iam put-role-policy \
        --profile $AWS_PROFILE \
        --role-name "$IAM_USER_OR_ROLE_NAME" \
        --policy-name "$policy_name" \
        --policy-document "$policy_doc" \
        --no-cli-pager
    fi
  fi
}

# Attach the policies
echo "Attaching inline policies (using compact wildcard patterns)..."
echo ""

echo "1. DynamoDB Policy (all cc-native-* tables)..."
put_inline_policy "CCNativeTestUserPolicy-DynamoDB" "$DYNAMODB_POLICY"

echo "2. S3 Policy (all cc-native-* buckets)..."
put_inline_policy "CCNativeTestUserPolicy-S3" "$S3_POLICY"

echo "3. EventBridge Policy..."
put_inline_policy "CCNativeTestUserPolicy-EventBridge" "$EVENTBRIDGE_POLICY"

echo ""
echo "✓ All inline policies attached successfully!"
echo ""
echo "The IAM $IAM_ENTITY_TYPE '$IAM_USER_OR_ROLE_NAME' now has permissions to:"
echo "  - Read/Write all DynamoDB tables matching 'cc-native-*' (via CCNativeTestUserPolicy-DynamoDB)"
echo "  - Read/Write all S3 buckets matching 'cc-native-*' (via CCNativeTestUserPolicy-S3)"
echo "  - PutEvents to EventBridge event bus 'cc-native-events' (via CCNativeTestUserPolicy-EventBridge)"
echo ""
echo "You can now run integration tests with this $IAM_ENTITY_TYPE."
