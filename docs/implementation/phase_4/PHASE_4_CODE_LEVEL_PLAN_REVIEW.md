# Phase 4 Code-Level Plan Review & Corrections

**Review Date:** 2026-01-26  
**Status:** 🔴 **CORRECTIONS REQUIRED**

---

## Critical Errors Found

### 1. ❌ ActionIntentService.getIntent() is Private

**Location:** Multiple handlers (execution-starter, execution-validator, tool-mapper)

**Issue:** The plan calls `actionIntentService.getIntent()` but the method is `private` in the actual implementation.

**Current Code:**
```typescript
// src/services/decision/ActionIntentService.ts
private async getIntent(intentId: string, tenantId: string, accountId: string): Promise<ActionIntentV1 | null>
```

**Fix Options:**
1. **Option A (Recommended):** Make `getIntent()` public in `ActionIntentService`
2. **Option B:** Add a new public method `getIntentForExecution()` that wraps the private method

**Correction:**
```typescript
// In ActionIntentService.ts - change private to public
public async getIntent(intentId: string, tenantId: string, accountId: string): Promise<ActionIntentV1 | null> {
  // ... existing implementation
}
```

---

### 2. ❌ Missing LedgerEventType Values

**Location:** 
- `execution-starter-handler.ts` (line 884): `LedgerEventType.EXECUTION_STARTED`
- `execution-recorder-handler.ts` (lines 1538-1539): `LedgerEventType.ACTION_EXECUTED`, `LedgerEventType.ACTION_FAILED`

**Issue:** These enum values don't exist in `LedgerEventType`. The enum only has:
- `ACTION` (generic)
- `ACTION_APPROVED`
- `ACTION_REJECTED`
- `ACTION_EDITED`

**Current Enum:**
```typescript
export enum LedgerEventType {
  INTENT = 'INTENT',
  SIGNAL = 'SIGNAL',
  TOOL_CALL = 'TOOL_CALL',
  VALIDATION = 'VALIDATION',
  DECISION = 'DECISION',
  ACTION = 'ACTION',
  APPROVAL = 'APPROVAL',
  DECISION_EVALUATION_REQUESTED = 'DECISION_EVALUATION_REQUESTED',
  DECISION_PROPOSED = 'DECISION_PROPOSED',
  POLICY_EVALUATED = 'POLICY_EVALUATED',
  ACTION_APPROVED = 'ACTION_APPROVED',
  ACTION_REJECTED = 'ACTION_REJECTED',
  ACTION_EDITED = 'ACTION_EDITED',
}
```

**Fix:** Add new enum values to `src/types/LedgerTypes.ts`:
```typescript
export enum LedgerEventType {
  // ... existing values ...
  EXECUTION_STARTED = 'EXECUTION_STARTED',
  ACTION_EXECUTED = 'ACTION_EXECUTED',
  ACTION_FAILED = 'ACTION_FAILED',
}
```

**Alternative:** Use existing `ACTION` enum and include status in `data` field.

---

### 3. ❌ Missing UpdateCommand Import

**Location:** `src/services/execution/ExecutionAttemptService.ts` (line 401)

**Issue:** `updateStatus()` method uses `UpdateCommand` but it's not imported.

**Fix:** Add to imports:
```typescript
import { DynamoDBDocumentClient, PutCommand, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
```

---

### 4. ❌ Tenants Table Key Structure Mismatch

**Location:** `src/services/execution/KillSwitchService.ts` (line 744)

**Issue:** The plan uses composite key `pk: TENANT#${tenantId}`, but the actual tenants table uses `tenantId` as the partition key directly.

**Current Table Definition:**
```typescript
// CCNativeStack.ts
this.tenantsTable = new dynamodb.Table(this, 'TenantsTable', {
  tableName: 'cc-native-tenants',
  partitionKey: { name: 'tenantId', type: dynamodb.AttributeType.STRING },
  // No sort key
});
```

**Current Code (Plan):**
```typescript
await this.dynamoClient.send(new GetCommand({
  TableName: this.configTableName,
  Key: {
    pk: `TENANT#${tenantId}`,  // ❌ WRONG
    sk: 'KILL_SWITCH_CONFIG',   // ❌ WRONG (no sort key)
  },
}));
```

**Fix:**
```typescript
await this.dynamoClient.send(new GetCommand({
  TableName: this.configTableName,
  Key: {
    tenantId: tenantId,  // ✅ Correct partition key
  },
}));

// If kill switch config is stored as a separate item, use a different pattern:
// Option A: Store as attribute in tenant item
// Option B: Use a separate table with composite key
// Option C: Use tenantId as PK and 'KILL_SWITCH_CONFIG' as a GSI key
```

**Recommended Fix:** Store kill switch config as an attribute in the tenant item, or use a separate table with proper key structure.

---

### 5. ❌ ExternalWriteDedupe SK Pattern Issue

**Location:** `src/services/execution/IdempotencyService.ts` (lines 573-577, 604)

**Issue:** Using `TIMESTAMP#${Date.now()}` for SK in both `checkExternalWriteDedupe()` and `recordExternalWriteDedupe()` will never match because timestamps are different.

**Current Code (Plan):**
```typescript
// checkExternalWriteDedupe - uses current timestamp
Key: {
  pk: `IDEMPOTENCY_KEY#${idempotencyKey}`,
  sk: `TIMESTAMP#${Date.now()}`,  // ❌ Different timestamp each time
}

// recordExternalWriteDedupe - uses current timestamp
sk: `TIMESTAMP#${Date.now()}`,  // ❌ Different timestamp
```

**Fix Options:**

**Option A (Recommended):** Use fixed SK pattern:
```typescript
// Check
Key: {
  pk: `IDEMPOTENCY_KEY#${idempotencyKey}`,
  sk: 'LATEST',  // Fixed SK
}

// Record
sk: 'LATEST',  // Fixed SK (overwrites previous)
```

**Option B:** Query for latest by timestamp:
```typescript
// Check - query for latest
const result = await dynamoClient.send(new QueryCommand({
  TableName: tableName,
  KeyConditionExpression: 'pk = :pk',
  ExpressionAttributeValues: {
    ':pk': `IDEMPOTENCY_KEY#${idempotencyKey}`,
  },
  ScanIndexForward: false, // Descending order
  Limit: 1,
}));
```

**Option C:** Use idempotency_key as both PK and SK (simpler):
```typescript
// Table: PK = idempotency_key (no SK needed)
Key: {
  pk: idempotencyKey,
}
```

---

### 6. ❌ Unused dynamoClient in ToolInvokerHandler

**Location:** `src/handlers/phase4/tool-invoker-handler.ts` (lines 1138-1142)

**Issue:** Creates `dynamoClient` but never uses it.

**Fix:** Remove unused client initialization:
```typescript
// Remove these lines:
const region = process.env.AWS_REGION || 'us-west-2';
const clientConfig = getAWSClientConfig(region);
const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient(clientConfig), {
  marshallOptions: { removeUndefinedValues: true },
});
```

---

### 7. ❌ Missing GetCommand Import in ExecutionAttemptService

**Location:** `src/services/execution/ExecutionAttemptService.ts` (line 413)

**Issue:** `getAttempt()` uses `GetCommand` but it's not imported.

**Fix:** Add to imports:
```typescript
import { DynamoDBDocumentClient, PutCommand, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
```

---

### 8. ❌ Missing GetCommand Import in ActionTypeRegistryService

**Location:** `src/services/execution/ActionTypeRegistryService.ts` (lines 450, 461)

**Issue:** Uses `GetCommand` and `QueryCommand` but may not be imported.

**Fix:** Ensure imports include:
```typescript
import { DynamoDBDocumentClient, GetCommand, QueryCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
```

---

### 9. ❌ Missing GetCommand Import in ExecutionOutcomeService

**Location:** `src/services/execution/ExecutionOutcomeService.ts` (lines 666, 685)

**Issue:** Uses `GetCommand` and `QueryCommand` but may not be imported.

**Fix:** Ensure imports include:
```typescript
import { DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
```

---

### 10. ❌ Missing GetCommand Import in KillSwitchService

**Location:** `src/services/execution/KillSwitchService.ts` (line 744)

**Issue:** Uses `GetCommand` but may not be imported.

**Fix:** Ensure imports include:
```typescript
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
```

---

### 11. ⚠️ Step Functions State Machine Definition Mismatch

**Location:** `src/stacks/constructs/ExecutionInfrastructure.ts` (buildStateMachineDefinition method)

**Issue:** The CDK code shows a simplified chain, but the JSON definition in the plan is more complex with error handling, retries, and compensation.

**Current CDK Code (Plan):**
```typescript
return startExecution
  .next(validatePreflight)
  .next(mapActionToTool)
  .next(invokeTool)
  .next(recordOutcome);
```

**JSON Definition (Plan):** Includes `Catch` blocks, `Retry` blocks, `CompensateAction` state, `RecordFailure` state.

**Fix:** Update CDK code to match JSON definition with proper error handling:
```typescript
// Add error handling, retries, and compensation states
const compensateAction = new stepfunctionsTasks.LambdaInvoke(this, 'CompensateAction', {
  lambdaFunction: this.compensationHandler, // Need to create this
  outputPath: '$',
});

const recordFailure = new stepfunctionsTasks.LambdaInvoke(this, 'RecordFailure', {
  lambdaFunction: this.executionRecorderHandler,
  outputPath: '$',
});

// Add Catch blocks to states
invokeTool.addCatch(compensateAction, {
  errors: ['PermanentError'],
  resultPath: '$.error',
});

invokeTool.addCatch(recordFailure, {
  errors: ['States.ALL'],
  resultPath: '$.error',
});
```

---

### 12. ⚠️ ExecutionAttemptService Conditional Write Syntax

**Location:** `src/services/execution/ExecutionAttemptService.ts` (line 380)

**Issue:** The conditional expression syntax may be incorrect for DynamoDB.

**Current Code (Plan):**
```typescript
ConditionExpression: 
  'attribute_not_exists(action_intent_id) OR status IN (:succeeded, :failed, :cancelled)',
```

**Issue:** DynamoDB doesn't support `OR` in ConditionExpression. Need to use separate conditions or a different approach.

**Fix Options:**

**Option A (Recommended):** Use separate conditional checks:
```typescript
// First, try to get existing attempt
const existing = await this.getAttempt(actionIntentId, tenantId, accountId);

if (existing) {
  // Check if status is terminal
  if (!['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(existing.status)) {
    throw new Error(`Execution already in progress for action_intent_id: ${actionIntentId}`);
  }
  // If terminal, allow overwrite (or create new attempt_id)
}

// Then do unconditional put (or conditional put with attribute_not_exists)
await this.dynamoClient.send(new PutCommand({
  TableName: this.tableName,
  Item: attempt,
  ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)',
}));
```

**Option B:** Use UpdateCommand with conditional update:
```typescript
// Try to update status to RUNNING only if it's terminal
await this.dynamoClient.send(new UpdateCommand({
  TableName: this.tableName,
  Key: { pk, sk },
  UpdateExpression: 'SET #status = :status, attempt_id = :attempt_id, ...',
  ConditionExpression: 'attribute_not_exists(pk) OR status IN (:succeeded, :failed, :cancelled)',
  // ...
}));
```

**Option C (Simplest):** Use `attribute_not_exists(pk)` only, and handle race conditions with retries:
```typescript
ConditionExpression: 'attribute_not_exists(pk)',
```

---

### 13. ⚠️ ActionTypeRegistryService Query Without GSI

**Location:** `src/services/execution/ActionTypeRegistryService.ts` (line 461)

**Issue:** Queries by `pk` only, but to get "latest version" by `created_at`, need either:
1. A GSI with `pk` and `created_at` as sort key
2. Query all versions and sort in application code

**Current Code (Plan):**
```typescript
const result = await this.dynamoClient.send(new QueryCommand({
  TableName: this.tableName,
  KeyConditionExpression: 'pk = :pk',
  ExpressionAttributeValues: {
    ':pk': `ACTION_TYPE#${actionType}`,
  },
  ScanIndexForward: false, // Descending order
  Limit: 1,
}));
```

**Issue:** `ScanIndexForward: false` only works if there's a sort key. Since `sk` is `VERSION#${schemaVersion}`, this will sort by `sk` (version string), not by `created_at`.

**Fix Options:**

**Option A (Recommended):** Add GSI with `created_at` as sort key:
```typescript
// In CDK, add GSI:
table.addGlobalSecondaryIndex({
  indexName: 'created-at-index',
  partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
  sortKey: { name: 'created_at', type: dynamodb.AttributeType.STRING },
});

// In service, query GSI:
const result = await this.dynamoClient.send(new QueryCommand({
  TableName: this.tableName,
  IndexName: 'created-at-index',
  KeyConditionExpression: 'pk = :pk',
  ExpressionAttributeValues: {
    ':pk': `ACTION_TYPE#${actionType}`,
  },
  ScanIndexForward: false, // Descending order (newest first)
  Limit: 1,
}));
```

**Option B:** Query all versions and sort in code (less efficient):
```typescript
const result = await this.dynamoClient.send(new QueryCommand({
  TableName: this.tableName,
  KeyConditionExpression: 'pk = :pk',
  ExpressionAttributeValues: {
    ':pk': `ACTION_TYPE#${actionType}`,
  },
}));

// Sort by created_at in code
const sorted = (result.Items || []).sort((a, b) => 
  new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
);
return sorted[0] as ActionTypeRegistry | null;
```

---

### 14. ⚠️ ExecutionOutcomeService GSI Definition Mismatch

**Location:** `src/stacks/constructs/ExecutionInfrastructure.ts` (line 1668)

**Issue:** The plan defines GSI with `gsi1pk` and `gsi1sk`, but the service code doesn't use it. The `listOutcomes()` method queries by `pk` directly.

**Current Code (Plan):**
```typescript
// CDK
table.addGlobalSecondaryIndex({
  indexName: 'gsi1-index',
  partitionKey: { name: 'gsi1pk', type: dynamodb.AttributeType.STRING },
  sortKey: { name: 'gsi1sk', type: dynamodb.AttributeType.STRING },
});

// Service - doesn't use GSI
async listOutcomes(...) {
  const result = await this.dynamoClient.send(new QueryCommand({
    TableName: this.tableName,
    KeyConditionExpression: 'pk = :pk',  // Uses main table, not GSI
    // ...
  }));
}
```

**Fix:** Either:
1. Remove the GSI if not needed
2. Update service to use GSI if querying by `action_intent_id` is needed
3. Add `gsi1pk` and `gsi1sk` attributes when writing outcomes

---

### 15. ⚠️ Missing Compensation Handler

**Location:** Step Functions state machine definition

**Issue:** The JSON definition includes a `CompensateAction` state that calls `cc-native-compensation-handler`, but this Lambda is not defined in the CDK construct.

**Fix:** Add compensation handler to CDK:
```typescript
private createCompensationHandler(props: ExecutionInfrastructureProps): lambda.Function {
  const handler = new lambdaNodejs.NodejsFunction(this, 'CompensationHandler', {
    functionName: 'cc-native-compensation-handler',
    entry: 'src/handlers/phase4/compensation-handler.ts',
    handler: 'handler',
    runtime: lambda.Runtime.NODEJS_20_X,
    timeout: cdk.Duration.seconds(60),
    environment: {
      AWS_REGION: props.region || 'us-west-2',
    },
  });
  
  return handler;
}
```

---

## Completeness Issues

### 16. ❌ Missing MCP Types Definition

**Location:** Multiple files reference `MCPToolInvocation` and `MCPResponse` from `'../../types/MCPTypes'`

**Issue:** The file `src/types/MCPTypes.ts` doesn't exist in the plan.

**Files Affected:**
- `src/adapters/IConnectorAdapter.ts` (line 2075)
- `src/adapters/internal/InternalConnectorAdapter.ts` (line 2113)
- `src/adapters/crm/CrmConnectorAdapter.ts` (line 2179)

**Fix:** Create `src/types/MCPTypes.ts`:
```typescript
/**
 * MCP (Model Context Protocol) Types
 * JSON-RPC 2.0 based protocol for tool invocation
 */

/**
 * MCP Tool Invocation (Gateway → Lambda Adapter)
 */
export interface MCPToolInvocation {
  jsonrpc: '2.0';
  id: string;
  method: 'tools/call';
  params: {
    name: string; // Tool name (e.g., "crm.create_task")
    arguments: Record<string, any>; // Tool parameters
  };
  identity?: {
    accessToken: string; // OAuth token from AgentCore Identity
    tenantId: string;
    userId?: string;
  };
}

/**
 * MCP Tool Response (Lambda Adapter → Gateway)
 */
export interface MCPResponse {
  jsonrpc: '2.0';
  id: string;
  result?: {
    content: Array<{
      type: 'text';
      text: string; // JSON stringified result
    }>;
  };
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

/**
 * MCP Tools List Response
 */
export interface MCPToolsListResponse {
  jsonrpc: '2.0';
  id: string;
  result: {
    tools: Array<{
      name: string;
      description: string;
      inputSchema: Record<string, any>; // JSON Schema
    }>;
  };
}
```

---

### 17. ❌ Missing Dead Letter Queues (DLQs)

**Location:** All Lambda handlers in CDK construct

**Issue:** Phase 3 pattern includes DLQs for all Lambda functions, but Phase 4 plan doesn't define them.

**Current Pattern (Phase 3):**
```typescript
// Create DLQ
this.decisionEvaluationDlq = new sqs.Queue(this, 'DecisionEvaluationDlq', {
  queueName: config.queueNames.decisionEvaluationDlq,
  retentionPeriod: cdk.Duration.days(config.lambda.dlqRetentionDays),
});

// Use in Lambda
deadLetterQueue: this.decisionEvaluationDlq,
deadLetterQueueEnabled: true,
retryAttempts: config.lambda.retryAttempts,
```

**Fix:** Add DLQs for all Phase 4 handlers:
```typescript
// In ExecutionInfrastructure constructor
this.executionStarterDlq = new sqs.Queue(this, 'ExecutionStarterDlq', {
  queueName: 'cc-native-execution-starter-handler-dlq',
  retentionPeriod: cdk.Duration.days(14),
});

this.executionValidatorDlq = new sqs.Queue(this, 'ExecutionValidatorDlq', {
  queueName: 'cc-native-execution-validator-handler-dlq',
  retentionPeriod: cdk.Duration.days(14),
});

// ... similar for all handlers

// Add to each Lambda function:
deadLetterQueue: this.executionStarterDlq,
deadLetterQueueEnabled: true,
retryAttempts: 2,
```

---

### 18. ❌ Missing Compensation Handler Implementation

**Location:** Step Functions references `cc-native-compensation-handler` but handler doesn't exist

**Issue:** The JSON definition includes `CompensateAction` state, but:
1. Handler file not defined
2. Handler not created in CDK
3. No compensation logic implemented

**Fix:** Add compensation handler:
```typescript
// File: src/handlers/phase4/compensation-handler.ts
// Implementation for compensation logic

// In CDK:
private createCompensationHandler(props: ExecutionInfrastructureProps): lambda.Function {
  const handler = new lambdaNodejs.NodejsFunction(this, 'CompensationHandler', {
    functionName: 'cc-native-compensation-handler',
    entry: 'src/handlers/phase4/compensation-handler.ts',
    handler: 'handler',
    runtime: lambda.Runtime.NODEJS_20_X,
    timeout: cdk.Duration.seconds(60),
    environment: {
      EXTERNAL_WRITE_DEDUPE_TABLE_NAME: this.externalWriteDedupeTable.tableName,
      AWS_REGION: props.region || 'us-west-2',
    },
    deadLetterQueue: this.compensationDlq,
    deadLetterQueueEnabled: true,
    retryAttempts: 2,
  });
  
  this.externalWriteDedupeTable.grantReadWriteData(handler);
  // Grant permissions to call compensation tools via Gateway
  
  return handler;
}
```

---

### 19. ❌ Missing Execution Status API Handler

**Location:** Checklist mentions "Create execution status API handler" but no implementation

**Issue:** EPIC 4.5 requires execution status API, but no handler is defined.

**Fix:** Add execution status API handler:
```typescript
// File: src/handlers/phase4/execution-status-api-handler.ts
// GET /executions/{action_intent_id}/status
// GET /accounts/{account_id}/executions

// Add to CDK construct or extend existing API Gateway
```

---

### 20. ❌ Missing Signal Emission Implementation

**Location:** Checklist mentions "Implement signal emission" but no code provided

**Issue:** Architecture mentions emitting signals for execution outcomes, but no implementation.

**Fix:** Add signal emission to `execution-recorder-handler.ts`:
```typescript
// After recording outcome, emit signal
import { SignalService } from '../../services/perception/SignalService';
import { SignalType } from '../../types/SignalTypes';

const signalService = new SignalService({
  logger,
  signalsTableName: process.env.SIGNALS_TABLE_NAME || 'cc-native-signals',
  accountsTableName: process.env.ACCOUNTS_TABLE_NAME || 'cc-native-accounts',
  // ... other dependencies
});

// Emit signal
await signalService.createSignal({
  signalType: status === 'SUCCEEDED' ? SignalType.ACTION_EXECUTED : SignalType.ACTION_FAILED,
  accountId: account_id,
  tenantId: tenant_id,
  data: {
    action_intent_id,
    status,
    external_object_refs: outcome.external_object_refs,
  },
});
```

---

### 21. ❌ Missing CloudWatch Alarms

**Location:** Checklist mentions "Add CloudWatch alarms" but no implementation

**Issue:** Architecture mentions alarms for execution failures, but no CDK code.

**Fix:** Add CloudWatch alarms in CDK:
```typescript
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';

// Alarm for execution failures
new cloudwatch.Alarm(this, 'ExecutionFailureAlarm', {
  metric: this.executionStateMachine.metricFailed(),
  threshold: 5,
  evaluationPeriods: 1,
  alarmDescription: 'Alert when execution failures exceed threshold',
});
```

---

### 22. ❌ Missing Step Functions Execution Name Pattern

**Location:** Architecture mentions `exec-{action_intent_id}` but CDK doesn't set it

**Issue:** EventBridge rule doesn't set execution name for idempotency.

**Fix:** Update EventBridge rule target:
```typescript
rule.addTarget(new eventsTargets.SfnStateMachine(this.executionStateMachine, {
  input: events.RuleTargetInput.fromObject({
    action_intent_id: events.EventField.fromPath('$.detail.data.action_intent_id'),
    tenant_id: events.EventField.fromPath('$.detail.data.tenant_id'),
    account_id: events.EventField.fromPath('$.detail.data.account_id'),
  }),
  // Add execution name for idempotency
  executionName: events.EventField.fromPath('$.detail.data.action_intent_id'),
}));
```

**Note:** Step Functions execution names must be unique. Using `action_intent_id` ensures idempotency.

---

### 23. ❌ Missing IAM Permissions for Step Functions

**Location:** Step Functions state machine needs permissions to invoke Lambda functions

**Issue:** CDK doesn't explicitly grant Step Functions permission to invoke Lambda functions.

**Fix:** CDK automatically grants permissions when using `LambdaInvoke` task, but verify:
```typescript
// CDK automatically grants invoke permissions, but ensure:
this.executionStateMachine.grantStartExecution(new iam.ServicePrincipal('events.amazonaws.com'));
```

---

### 24. ❌ Missing S3 Bucket for Raw Response Artifacts

**Location:** `ActionOutcomeV1` includes `raw_response_artifact_ref?: string` (S3 pointer)

**Issue:** No S3 bucket defined for storing large response artifacts.

**Fix:** Add S3 bucket to CDK (or reuse existing artifacts bucket):
```typescript
// In ExecutionInfrastructureProps
readonly artifactsBucket?: s3.IBucket; // Reuse existing or create new

// Or create new bucket:
this.executionArtifactsBucket = new s3.Bucket(this, 'ExecutionArtifactsBucket', {
  bucketName: `cc-native-execution-artifacts-${cdk.Aws.ACCOUNT_ID}-${cdk.Aws.REGION}`,
  versioned: true,
  encryption: s3.BucketEncryption.S3_MANAGED,
});

// Grant write permissions to ToolInvokerHandler
this.executionArtifactsBucket.grantWrite(this.toolInvokerHandler);
```

---

### 25. ❌ Missing AgentCore Gateway CDK Setup

**Location:** Architecture mentions Gateway but no CDK code provided

**Issue:** Plan references Gateway but doesn't show how to create it in CDK.

**Fix:** Add Gateway creation (if CDK supports it, or use L1 construct):
```typescript
// Check if bedrock-agentcore CDK construct exists
// If not, use L1 CfnResource or AWS SDK calls

// Example (if construct exists):
import * as bedrockAgentCore from '@aws-cdk/aws-bedrock-agentcore-alpha';

const executionGateway = new bedrockAgentCore.Gateway(this, 'ExecutionGateway', {
  name: 'cc-native-execution-gateway',
  protocolType: 'MCP',
  authorizerType: 'CUSTOM_JWT',
  authorizerConfiguration: {
    customJWTAuthorizer: {
      allowedClients: [props.userPool?.userPoolClientId || ''],
      discoveryUrl: props.userPool?.userPoolProviderUrl || '',
    },
  },
  roleArn: executionGatewayRole.roleArn,
});
```

---

### 26. ❌ Missing Error Handling in InternalConnectorAdapter

**Location:** `src/adapters/internal/InternalConnectorAdapter.ts` (line 2142)

**Issue:** `createNote()` references `invocation.id` but `invocation` is not in scope.

**Fix:**
```typescript
private async createNote(args: Record<string, any>, invocationId: string): Promise<MCPResponse> {
  // ... implementation
  return {
    jsonrpc: '2.0',
    id: invocationId, // Use parameter instead of invocation.id
    // ...
  };
}

// Update execute method:
async execute(invocation: MCPToolInvocation): Promise<MCPResponse> {
  const { name, arguments: args, id } = invocation.params;
  
  if (name === 'internal.create_note') {
    return await this.createNote(args, id);
  }
  // ...
}
```

---

### 27. ❌ Missing Error Handling Patterns

**Location:** All handlers

**Issue:** Handlers don't follow Phase 3 error handling patterns (structured errors, proper logging).

**Fix:** Add consistent error handling:
```typescript
// In each handler, add:
catch (error: any) {
  logger.error('Handler failed', {
    action_intent_id,
    error: {
      name: error.name,
      message: error.message,
      stack: error.stack,
    },
    traceId,
  });
  
  // Return structured error for Step Functions
  throw new Error(JSON.stringify({
    errorType: error.name || 'Error',
    errorMessage: error.message,
    action_intent_id,
  }));
}
```

---

### 28. ❌ Missing ActionTypeRegistry Initial Data

**Location:** No seed data or initialization script

**Issue:** Plan doesn't show how to populate initial ActionTypeRegistry entries.

**Fix:** Add initialization script or CDK custom resource:
```typescript
// File: scripts/phase_4/seed-action-type-registry.sh
// Or CDK custom resource to seed initial mappings
```

---

### 29. ❌ Missing Step Functions Error Types

**Location:** Step Functions JSON uses `TransientError` and `PermanentError` but handlers don't throw them

**Issue:** Handlers throw generic errors, but Step Functions expects specific error types.

**Fix:** Update handlers to throw Step Functions-compatible errors:
```typescript
// In tool-invoker-handler.ts
if (error.response?.status >= 500) {
  throw new Error('TransientError: ' + error.message);
}
if (error.response?.status >= 400 && error.response?.status < 500) {
  throw new Error('PermanentError: ' + error.message);
}
```

---

### 30. ❌ Missing Execution Status Query Implementation

**Location:** `ExecutionOutcomeService.listOutcomes()` doesn't use GSI

**Issue:** GSI is defined but not used in service method.

**Fix:** Update service to use GSI if querying by action_intent_id:
```typescript
async listOutcomesByActionIntent(
  actionIntentId: string,
  limit: number = 50
): Promise<ActionOutcomeV1[]> {
  const result = await this.dynamoClient.send(new QueryCommand({
    TableName: this.tableName,
    IndexName: 'gsi1-index',
    KeyConditionExpression: 'gsi1pk = :pk',
    ExpressionAttributeValues: {
      ':pk': `OUTCOME#${actionIntentId}`,
    },
    Limit: limit,
  }));
  
  return (result.Items || []) as ActionOutcomeV1[];
}
```

---

## Summary of Required Changes

### High Priority (Blocking)
1. ✅ Make `ActionIntentService.getIntent()` public
2. ✅ Add missing `LedgerEventType` values (`EXECUTION_STARTED`, `ACTION_EXECUTED`, `ACTION_FAILED`)
3. ✅ Fix tenants table key structure in `KillSwitchService`
4. ✅ Fix `ExternalWriteDedupe` SK pattern
5. ✅ Add missing imports (`UpdateCommand`, `GetCommand`, `QueryCommand`)
6. ✅ Create `src/types/MCPTypes.ts` with MCP type definitions

### Medium Priority (Functional Issues)
7. ✅ Fix `ExecutionAttemptService` conditional write logic
8. ✅ Fix `ActionTypeRegistryService` query for latest version (add GSI or sort in code)
9. ✅ Remove unused `dynamoClient` in `ToolInvokerHandler`
10. ✅ Add compensation handler (file + CDK)
11. ✅ Update Step Functions state machine to match JSON definition
12. ✅ Add DLQs for all Lambda functions
13. ✅ Add Step Functions execution name pattern
14. ✅ Fix `InternalConnectorAdapter` scope issue (`invocation.id`)

### Low Priority (Completeness)
15. ⚠️ Add execution status API handler
16. ⚠️ Add signal emission implementation
17. ⚠️ Add CloudWatch alarms
18. ⚠️ Add S3 bucket for raw response artifacts
19. ⚠️ Add AgentCore Gateway CDK setup
20. ⚠️ Add error handling patterns
21. ⚠️ Add ActionTypeRegistry seed data
22. ⚠️ Add Step Functions error type handling
23. ⚠️ Review GSI usage in `ExecutionOutcomesTable`
24. ⚠️ Add execution status query methods

---

## Next Steps

1. Update `PHASE_4_CODE_LEVEL_PLAN.md` with all corrections
2. Create implementation checklist with these fixes
3. Begin implementation with corrections applied
