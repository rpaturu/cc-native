# Phase 4.4 — Safety & Outcomes: Code-Level Implementation Plan

**Status:** 🟡 **PLANNING**  
**Created:** 2026-01-26  
**Last Updated:** 2026-01-26  
**Parent Document:** `PHASE_4_CODE_LEVEL_PLAN.md`  
**Prerequisites:** Phase 4.1, 4.2, and 4.3 complete

---

## Overview

Phase 4.4 implements safety controls and outcome visibility:
- Kill switch implementation (already in Phase 4.1, verify integration)
- Signal emission (in execution-recorder-handler)
- Execution status API handler
- CloudWatch alarms
- S3 bucket for raw response artifacts (already in Phase 4.2, verify)

**Duration:** Week 5-6  
**Dependencies:** Phase 4.1, 4.2, and 4.3 complete

---

## Implementation Tasks

1. Implement signal emission (in execution-recorder-handler)
2. Create execution status API handler
3. Add CloudWatch alarms (in CDK)
4. Verify S3 bucket setup
5. End-to-end tests

---

## 1. Signal Emission

### File: `src/handlers/phase4/execution-recorder-handler.ts` (Update)

**Purpose:** Add signal emission to existing handler

**Update Required:**

```typescript
// Add imports
import { SignalService } from '../../services/perception/SignalService';
import { SignalType } from '../../types/SignalTypes';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';

// Initialize SignalService (add to handler initialization)
const eventBridgeClient = new EventBridgeClient(clientConfig);

/**
 * Helper to validate required environment variables with descriptive errors
 */
function requireEnv(name: string, handlerName: string): string {
  const value = process.env[name];
  if (!value) {
    const error = new Error(
      `[${handlerName}] Missing required environment variable: ${name}. ` +
      `This variable must be set in the Lambda function configuration. ` +
      `Check CDK stack definition for ExecutionInfrastructure construct.`
    );
    error.name = 'ConfigurationError';
    throw error;
  }
  return value;
}

// Validate required environment variables for SignalService with better error handling
const signalsTableName = requireEnv('SIGNALS_TABLE_NAME', 'ExecutionRecorderHandler');
const accountsTableName = requireEnv('ACCOUNTS_TABLE_NAME', 'ExecutionRecorderHandler');

const signalService = new SignalService({
  logger,
  signalsTableName,
  accountsTableName,
  lifecycleStateService: null as any, // Not needed for execution signals
  eventPublisher: eventBridgeClient,
  ledgerService: ledgerService,
  region,
});

// In handler, after recording outcome, add:
// 4. Emit signal for Phase 1 perception layer
await signalService.createSignal({
  signalType: status === 'SUCCEEDED' ? SignalType.ACTION_EXECUTED : SignalType.ACTION_FAILED,
  accountId: account_id,
  tenantId: tenant_id,
  data: {
    action_intent_id,
    status,
    external_object_refs: outcome.external_object_refs,
    error_code: outcome.error_code,
    error_class: outcome.error_class,
  },
});
```

**Prerequisite:** Before implementing signal emission, ensure `SignalType` enum includes `ACTION_EXECUTED` and `ACTION_FAILED`. 

**Required Changes to `src/types/SignalTypes.ts`:**
1. Add new SignalType values:
   ```typescript
   ACTION_EXECUTED = 'ACTION_EXECUTED',
   ACTION_FAILED = 'ACTION_FAILED',
   ```

2. Add window key derivation logic to `WINDOW_KEY_DERIVATION`:
   ```typescript
   [SignalType.ACTION_EXECUTED]: (accountId, evidence, timestamp) => {
    const actionIntentId = evidence?.action_intent_id;
    if (!actionIntentId) {
      const error = new Error(
        `[SignalService] Missing required field in evidence: action_intent_id. ` +
        `Cannot create ACTION_EXECUTED signal without action_intent_id. ` +
        `Evidence provided: ${JSON.stringify(evidence)}`
      );
      error.name = 'InvalidEvidenceError';
      throw error;
    }
     return `${accountId}-${actionIntentId}`;
   },
   [SignalType.ACTION_FAILED]: (accountId, evidence, timestamp) => {
    const actionIntentId = evidence?.action_intent_id;
    if (!actionIntentId) {
      const error = new Error(
        `[SignalService] Missing required field in evidence: action_intent_id. ` +
        `Cannot create ACTION_FAILED signal without action_intent_id. ` +
        `Evidence provided: ${JSON.stringify(evidence)}`
      );
      error.name = 'InvalidEvidenceError';
      throw error;
    }
     return `${accountId}-${actionIntentId}`;
   },
   ```

3. Add TTL configuration to `DEFAULT_SIGNAL_TTL`:
   ```typescript
   [SignalType.ACTION_EXECUTED]: { ttlDays: 90, isPermanent: false },
   [SignalType.ACTION_FAILED]: { ttlDays: 90, isPermanent: false },
   ```

**See:** `PHASE_4_1_CODE_LEVEL_PLAN.md` - Section 5 (Prerequisites) for complete details.

---

## 2. Execution Status API Handler

### File: `src/handlers/phase4/execution-status-api-handler.ts`

**Purpose:** API endpoints for execution status queries

**Handler:**

```typescript
import { Handler, APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Logger } from '../../services/core/Logger';
import { TraceService } from '../../services/core/TraceService';
import { ExecutionOutcomeService } from '../../services/execution/ExecutionOutcomeService';
import { ExecutionAttemptService } from '../../services/execution/ExecutionAttemptService';
import { ActionIntentService } from '../../services/decision/ActionIntentService';
import { ExecutionStatus } from '../../types/ExecutionTypes';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { getAWSClientConfig } from '../../utils/aws-client-config';

const logger = new Logger('ExecutionStatusAPIHandler');
const traceService = new TraceService(logger);

/**
 * Helper to validate required environment variables with descriptive errors
 */
function requireEnv(name: string, handlerName: string): string {
  const value = process.env[name];
  if (!value) {
    const error = new Error(
      `[${handlerName}] Missing required environment variable: ${name}. ` +
      `This variable must be set in the Lambda function configuration. ` +
      `Check CDK stack definition for ExecutionInfrastructure construct.`
    );
    error.name = 'ConfigurationError';
    throw error;
  }
  return value;
}

// Note: AWS_REGION is automatically set by Lambda runtime (not set in CDK environment variables)
// Validate it exists (should always be present, but fail fast if somehow missing)
const region = requireEnv('AWS_REGION', 'ExecutionStatusAPIHandler');
const executionOutcomesTableName = requireEnv('EXECUTION_OUTCOMES_TABLE_NAME', 'ExecutionStatusAPIHandler');
const executionAttemptsTableName = requireEnv('EXECUTION_ATTEMPTS_TABLE_NAME', 'ExecutionStatusAPIHandler');
const actionIntentTableName = requireEnv('ACTION_INTENT_TABLE_NAME', 'ExecutionStatusAPIHandler');

// Initialize AWS clients
const clientConfig = getAWSClientConfig(region);
const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient(clientConfig), {
  marshallOptions: { removeUndefinedValues: true },
});

// Initialize services
const executionOutcomeService = new ExecutionOutcomeService(
  dynamoClient,
  executionOutcomesTableName,
  logger
);

const executionAttemptService = new ExecutionAttemptService(
  dynamoClient,
  executionAttemptsTableName,
  logger
);

const actionIntentService = new ActionIntentService(
  dynamoClient,
  actionIntentTableName,
  logger
);

/**
 * Helper to add CORS headers
 */
function addCorsHeaders(response: APIGatewayProxyResult): APIGatewayProxyResult {
  return {
    ...response,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Tenant-Id',
      'Access-Control-Allow-Methods': 'GET,OPTIONS',
      ...response.headers,
    },
  };
}

/**
 * GET /executions/{action_intent_id}/status
 * Get execution status for a specific action intent
 */
async function getExecutionStatusHandler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const { action_intent_id } = event.pathParameters || {};
  const tenantId = event.headers['x-tenant-id'];
  const accountId = event.queryStringParameters?.account_id;
  
  if (!action_intent_id || !tenantId || !accountId) {
    return addCorsHeaders({
      statusCode: 400,
      body: JSON.stringify({ error: 'Missing required parameters: action_intent_id, tenant_id, account_id' }),
    });
  }
  
  try {
    // 1. Get execution attempt (for RUNNING status)
    const attempt = await executionAttemptService.getAttempt(action_intent_id, tenantId, accountId);
    
    // 2. Get execution outcome (for terminal status)
    const outcome = await executionOutcomeService.getOutcome(action_intent_id, tenantId, accountId);
    
    // 3. Get action intent (for expiration check)
    const intent = await actionIntentService.getIntent(action_intent_id, tenantId, accountId);
    
    // 4. Determine status
    let status: ExecutionStatus['status'] = 'PENDING';
    let startedAt: string | undefined;
    let completedAt: string | undefined;
    let externalObjectRefs: ExecutionStatus['external_object_refs'];
    let errorMessage: string | undefined;
    let errorClass: ExecutionStatus['error_class'];
    let attemptCount: number | undefined;
    
    if (outcome) {
      // Terminal state
      status = outcome.status;
      startedAt = outcome.started_at;
      completedAt = outcome.completed_at;
      externalObjectRefs = outcome.external_object_refs;
      errorMessage = outcome.error_message;
      errorClass = outcome.error_class;
      attemptCount = outcome.attempt_count;
    } else if (attempt) {
      // Running state
      status = attempt.status === 'RUNNING' ? 'RUNNING' : 'PENDING';
      startedAt = attempt.started_at;
    } else if (intent) {
      // Check expiration
      const now = Math.floor(Date.now() / 1000);
      if (intent.expires_at_epoch <= now) {
        status = 'EXPIRED';
      } else {
        status = 'PENDING';
      }
    }
    
    const executionStatus: ExecutionStatus = {
      action_intent_id,
      status,
      started_at: startedAt,
      completed_at: completedAt,
      external_object_refs: externalObjectRefs,
      error_message: errorMessage,
      error_class: errorClass,
      attempt_count: attemptCount,
    };
    
    return addCorsHeaders({
      statusCode: 200,
      body: JSON.stringify(executionStatus),
    });
  } catch (error: any) {
    logger.error('Failed to get execution status', { action_intent_id, error });
    return addCorsHeaders({
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error' }),
    });
  }
}

/**
 * GET /accounts/{account_id}/executions
 * List executions for an account
 */
async function listAccountExecutionsHandler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const { account_id } = event.pathParameters || {};
  const tenantId = event.headers['x-tenant-id'];
  if (!tenantId) {
    return addCorsHeaders({
      statusCode: 400,
      body: JSON.stringify({ 
        error: 'Missing required header: x-tenant-id',
        message: 'The x-tenant-id header is required for all API requests. Include it in your request headers.',
        path: event.path,
      }),
    });
  }
  
  const limitParam = event.queryStringParameters?.limit;
  const limit = limitParam ? parseInt(limitParam, 10) : 50;
  if (limitParam && (isNaN(limit) || limit < 1 || limit > 100)) {
    return addCorsHeaders({
      statusCode: 400,
      body: JSON.stringify({ 
        error: 'Invalid limit parameter',
        message: 'The limit query parameter must be a number between 1 and 100.',
        provided: limitParam,
        path: event.path,
      }),
    });
  }
  
  if (!account_id || !tenantId) {
    return addCorsHeaders({
      statusCode: 400,
      body: JSON.stringify({ error: 'Missing required parameters: account_id, tenant_id' }),
    });
  }
  
  try {
    const outcomes = await executionOutcomeService.listOutcomes(tenantId, account_id, limit);
    
    const executionStatuses: ExecutionStatus[] = outcomes.map(outcome => ({
      action_intent_id: outcome.action_intent_id,
      status: outcome.status,
      started_at: outcome.started_at,
      completed_at: outcome.completed_at,
      external_object_refs: outcome.external_object_refs,
      error_message: outcome.error_message,
      error_class: outcome.error_class,
      attempt_count: outcome.attempt_count,
    }));
    
    return addCorsHeaders({
      statusCode: 200,
      body: JSON.stringify({ executions: executionStatuses }),
    });
  } catch (error: any) {
    logger.error('Failed to list executions', { account_id, error });
    return addCorsHeaders({
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error' }),
    });
  }
}

/**
 * Main handler - routes API Gateway requests
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const { httpMethod, resource, path, pathParameters } = event;
  const route = resource || path;
  
  logger.info('Execution status API request received', {
    httpMethod,
    route,
    resource,
    path,
  });
  
  try {
    // Handle OPTIONS (CORS preflight)
    if (httpMethod === 'OPTIONS') {
      return addCorsHeaders({
        statusCode: 200,
        body: '',
      });
    }
    
    // GET /executions/{action_intent_id}/status
    if (httpMethod === 'GET' && pathParameters?.action_intent_id && route.includes('/executions/') && route.includes('/status')) {
      return await getExecutionStatusHandler(event);
    }
    
    // GET /accounts/{account_id}/executions
    if (httpMethod === 'GET' && pathParameters?.account_id && route.includes('/accounts/') && route.includes('/executions')) {
      return await listAccountExecutionsHandler(event);
    }
    
    logger.warn('Unknown route', { httpMethod, route, resource, path });
    return addCorsHeaders({
      statusCode: 404,
      body: JSON.stringify({ error: 'Not found', path: route }),
    });
  } catch (error) {
    logger.error('Handler routing failed', { error, httpMethod, route, resource, path });
    return addCorsHeaders({
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error' }),
    });
  }
};
```

---

## 3. CloudWatch Alarms

### File: `src/stacks/constructs/ExecutionInfrastructure.ts` (Phase 4.4 Additions)

**Purpose:** Add CloudWatch alarms for execution monitoring

**Phase 4.4 Additions:**

```typescript
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';

// Add to ExecutionInfrastructure class

/**
 * Create CloudWatch alarms for execution monitoring
 */
private createCloudWatchAlarms(): void {
  // Alarm for execution failures
  new cloudwatch.Alarm(this, 'ExecutionFailureAlarm', {
    metric: this.executionStateMachine.metricFailed(),
    threshold: 5,
    evaluationPeriods: 1,
    alarmDescription: 'Alert when execution failures exceed threshold',
  });
  
  // Alarm for execution duration
  new cloudwatch.Alarm(this, 'ExecutionDurationAlarm', {
    metric: this.executionStateMachine.metricExecutionTime(),
    threshold: 300000, // 5 minutes
    evaluationPeriods: 1,
    alarmDescription: 'Alert when execution duration exceeds threshold',
  });
  
  // Alarm for execution throttles
  new cloudwatch.Alarm(this, 'ExecutionThrottleAlarm', {
    metric: this.executionStateMachine.metricThrottled(),
    threshold: 10,
    evaluationPeriods: 1,
    alarmDescription: 'Alert when execution throttles exceed threshold',
  });
}

// Call in constructor:
constructor(scope: Construct, id: string, props: ExecutionInfrastructureProps) {
  // ... existing code ...
  
  // Phase 4.4: Create CloudWatch alarms
  this.createCloudWatchAlarms();
}
```

---

## 4. API Gateway Integration

### File: `src/stacks/constructs/ExecutionInfrastructure.ts` (Phase 4.4 Additions)

**Purpose:** Add execution status API to API Gateway

**Phase 4.4 Additions:**

```typescript
// Add to ExecutionInfrastructureProps
export interface ExecutionInfrastructureProps {
  // ... existing props ...
  readonly apiGateway?: apigateway.RestApi; // Existing API Gateway (if shared)
}

// Add to ExecutionInfrastructure class
public readonly executionStatusApiHandler: lambda.Function;
public readonly executionStatusApiResource?: apigateway.Resource;

// In constructor:
private createExecutionStatusAPI(
  props: ExecutionInfrastructureProps,
  config: ExecutionInfrastructureConfig
): void {
  // Create Lambda handler
  this.executionStatusApiHandler = new lambdaNodejs.NodejsFunction(this, 'ExecutionStatusAPIHandler', {
    functionName: config.functionNames.executionStatusApi,
    entry: 'src/handlers/phase4/execution-status-api-handler.ts',
    handler: 'handler',
    runtime: lambda.Runtime.NODEJS_20_X,
    timeout: cdk.Duration.seconds(config.defaults.timeout.executionStatusApi),
    memorySize: config.defaults.memorySize?.executionStatusApi,
    environment: {
      EXECUTION_OUTCOMES_TABLE_NAME: this.executionOutcomesTable.tableName,
      EXECUTION_ATTEMPTS_TABLE_NAME: this.executionAttemptsTable.tableName,
      ACTION_INTENT_TABLE_NAME: props.actionIntentTable.tableName,
      // Note: AWS_REGION is automatically set by Lambda runtime and should not be set manually
    },
  });
  
  // Grant permissions
  this.executionOutcomesTable.grantReadData(this.executionStatusApiHandler);
  this.executionAttemptsTable.grantReadData(this.executionStatusApiHandler);
  props.actionIntentTable.grantReadData(this.executionStatusApiHandler);
  
  // Add to API Gateway (if provided)
  if (props.apiGateway) {
    const executionsResource = props.apiGateway.root.addResource('executions');
    const statusResource = executionsResource.addResource('{action_intent_id}').addResource('status');
    
    statusResource.addMethod('GET', new apigateway.LambdaIntegration(this.executionStatusApiHandler));
    
    const accountsResource = props.apiGateway.root.addResource('accounts');
    const accountExecutionsResource = accountsResource.addResource('{account_id}').addResource('executions');
    
    accountExecutionsResource.addMethod('GET', new apigateway.LambdaIntegration(this.executionStatusApiHandler));
  }
}
```

---

## 5. Testing

### End-to-End Tests

**Files to Create:**
- `src/tests/integration/execution/end-to-end-execution.test.ts` - Full execution flow
- `src/tests/integration/execution/execution-status-api.test.ts` - Status API tests

---

## 6. Implementation Checklist

- [ ] Implement signal emission (in execution-recorder-handler)
- [ ] Verify SignalType enum includes ACTION_EXECUTED and ACTION_FAILED
- [ ] Create execution status API handler (`src/handlers/phase4/execution-status-api-handler.ts`)
- [ ] Add execution status API to API Gateway
- [ ] Add CloudWatch alarms (in CDK)
- [ ] Verify S3 bucket setup (from Phase 4.2)
- [ ] End-to-end tests

---

## 7. Next Steps

After Phase 4.4 completion:
- ✅ Safety controls and outcome visibility complete
- ⏳ Proceed to Phase 4.5 (Testing & Polish) - Complete test coverage, documentation, performance testing

---

**See:** `PHASE_4_CODE_LEVEL_PLAN.md` for complete Phase 4 overview and cross-references.
