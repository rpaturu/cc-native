# CloudFormation 500-Resource Limit

**Status:** Addressed via Nested Stack. ExecutionInfrastructure lives in **ExecutionInfrastructureNestedStack**.

## Limit

CloudFormation has a **500-resource limit per stack**. CDK may report *"Number of resources: … is approaching allowed maximum of 500"* when the root stack approaches that limit.

## Current approach

**ExecutionInfrastructure** is created inside **ExecutionInfrastructureNestedStack** (`cdk.NestedStack`). The root stack holds one nested-stack resource; the bulk of execution resources (DynamoDB, Lambdas, Step Functions, SQS, Secrets Manager, VPC, etc.) are in the nested stack.

### Moving from root to nested (existing dev stack)

If Execution was previously in the root stack, deploying the nested-stack template will try to create the same physical resource names in the nested stack and fail with "already exists". In **dev** (data loss acceptable):

1. **Destroy the stack:** `./destroy` (or equivalent).
2. **Deploy clean:** `./deploy`. The nested stack and all execution resources are created fresh.

For **production**, use a planned migration (different names in nested stack + data migration, or resource import) instead of destroy-then-deploy.

## If the count grows again

- Move another heavy construct into a Nested Stack (e.g. AutonomyInfrastructure, DecisionInfrastructure).
- Or add more Nested Stacks per domain so each stack stays under 500 resources.

## Reference

- [CloudFormation quotas](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/cloudformation-limits.html)
- cc-native: `src/stacks/CCNativeStack.ts` — `ExecutionInfrastructureNestedStack`
- cc-orchestrator1: `src/stacks/SalesIntelligenceStack.ts` — `ApiGatewayNestedStack`
