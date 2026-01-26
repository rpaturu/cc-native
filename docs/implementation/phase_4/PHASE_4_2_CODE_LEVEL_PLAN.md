# Phase 4.2 — Orchestration: Code-Level Implementation Plan

**Status:** 🟡 **PLANNING**  
**Created:** 2026-01-26  
**Last Updated:** 2026-01-26  
**Parent Document:** `PHASE_4_CODE_LEVEL_PLAN.md`  
**Prerequisites:** Phase 4.1 complete

---

## Overview

Phase 4.2 implements the execution orchestration layer:
- Step Functions state machine for execution lifecycle
- Tool mapper handler (action type → tool mapping)
- ToolInvoker Lambda (MCP Gateway client)
- Execution recorder handler
- Compensation handler
- EventBridge rule (ACTION_APPROVED → Step Functions)

**Duration:** Week 2-3  
**Dependencies:** Phase 4.1 complete

---

## Implementation Tasks

1. Tool mapper handler
2. ToolInvoker Lambda (MCP Gateway client)
3. Execution recorder handler
4. Compensation handler
5. Step Functions state machine (CDK)
6. EventBridge rule (ACTION_APPROVED → Step Functions)
7. DLQs for all handlers

---

## 1. Lambda Handlers

### File: `src/handlers/phase4/tool-mapper-handler.ts`

**Purpose:** Map action type to tool (versioned registry lookup)

**Handler:**

```typescript
import { Handler } from 'aws-lambda';
import { Logger } from '../../services/core/Logger';
import { TraceService } from '../../services/core/TraceService';
import { ActionIntentService } from '../../services/decision/ActionIntentService';
import { ActionTypeRegistryService } from '../../services/execution/ActionTypeRegistryService';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { getAWSClientConfig } from '../../utils/aws-client-config';

const logger = new Logger('ToolMapperHandler');
const traceService = new TraceService(logger);

// Initialize AWS clients
const region = process.env.AWS_REGION || 'us-west-2';
const clientConfig = getAWSClientConfig(region);
const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient(clientConfig), {
  marshallOptions: { removeUndefinedValues: true },
});

// Initialize services
const actionIntentService = new ActionIntentService(
  dynamoClient,
  process.env.ACTION_INTENT_TABLE_NAME || 'cc-native-action-intents',
  logger
);

const actionTypeRegistryService = new ActionTypeRegistryService(
  dynamoClient,
  process.env.ACTION_TYPE_REGISTRY_TABLE_NAME || 'cc-native-action-type-registry',
  logger
);

/**
 * Step Functions input: { action_intent_id, tenant_id, account_id, idempotency_key }
 * Step Functions output: { gateway_url, tool_name, tool_arguments, tool_schema_version, idempotency_key, jwt_token, action_intent_id, tenant_id, account_id, trace_id }
 */
export const handler: Handler = async (event: {
  action_intent_id: string;
  tenant_id: string;
  account_id: string;
  idempotency_key: string;
}) => {
  const { action_intent_id, tenant_id, account_id, idempotency_key } = event;
  const traceId = traceService.generateTraceId();
  
  logger.info('Tool mapper invoked', { action_intent_id, tenant_id, account_id, traceId });
  
  try {
    // 1. Fetch ActionIntentV1
    const intent = await actionIntentService.getIntent(action_intent_id, tenant_id, account_id);
    
    if (!intent) {
      throw new Error(`ActionIntent not found: ${action_intent_id}`);
    }
    
    // 2. Get tool mapping from registry
    const toolMapping = await actionTypeRegistryService.getToolMapping(
      intent.action_type,
      intent.parameters_schema_version
    );
    
    if (!toolMapping) {
      throw new Error(`Tool mapping not found for action_type: ${intent.action_type}, schema_version: ${intent.parameters_schema_version}`);
    }
    
    // 3. Map parameters to tool arguments
    const toolArguments = actionTypeRegistryService.mapParametersToToolArguments(
      toolMapping,
      intent.parameters
    );
    
    // 4. Add idempotency_key to tool arguments (for adapter-level idempotency)
    toolArguments.idempotency_key = idempotency_key;
    
    // 5. Get Gateway URL and JWT token (from environment/config)
    const gatewayUrl = process.env.AGENTCORE_GATEWAY_URL || '';
    const jwtToken = await getJwtToken(tenant_id); // Implement JWT token retrieval (Cognito)
    
    // 6. Return for Step Functions
    return {
      gateway_url: gatewayUrl,
      tool_name: toolMapping.tool_name,
      tool_arguments: toolArguments,
      tool_schema_version: toolMapping.tool_schema_version,
      idempotency_key: idempotency_key,
      jwt_token: jwtToken,
      action_intent_id,
      tenant_id,
      account_id,
      trace_id: intent.trace_id,
    };
  } catch (error: any) {
    logger.error('Tool mapping failed', { action_intent_id, error });
    throw error;
  }
};

/**
 * Get JWT token for Gateway authentication (Cognito)
 */
async function getJwtToken(tenantId: string): Promise<string> {
  // TODO: Implement Cognito JWT token retrieval
  // Use Cognito Identity Pool or User Pool client credentials
  throw new Error('JWT token retrieval not implemented');
}
```

### File: `src/handlers/phase4/tool-invoker-handler.ts`

**Purpose:** MCP Gateway client (centralizes MCP protocol, auth, retries, timeouts)

**Handler:**

```typescript
import { Handler } from 'aws-lambda';
import { Logger } from '../../services/core/Logger';
import { TraceService } from '../../services/core/TraceService';
import { ToolInvocationRequest, ToolInvocationResponse } from '../../types/ExecutionTypes';
import axios, { AxiosError } from 'axios';

const logger = new Logger('ToolInvokerHandler');
const traceService = new TraceService(logger);

// Note: No DynamoDB client needed - this handler only calls Gateway via HTTP

/**
 * Step Functions input: ToolInvocationRequest
 * Step Functions output: ToolInvocationResponse
 */
export const handler: Handler<ToolInvocationRequest, ToolInvocationResponse> = async (event) => {
  const { gateway_url, tool_name, tool_arguments, idempotency_key, jwt_token, action_intent_id, tenant_id, account_id, trace_id } = event;
  
  logger.info('Tool invoker invoked', { action_intent_id, tool_name, trace_id });
  
  try {
    // 1. Make MCP protocol call to AgentCore Gateway
    const mcpRequest = {
      jsonrpc: '2.0',
      id: `invoke-${Date.now()}`,
      method: 'tools/call',
      params: {
        name: tool_name,
        arguments: tool_arguments,
      },
    };
    
    const toolRunRef = `gateway_invocation_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    
    // 2. Call Gateway with retry logic
    const response = await invokeWithRetry(
      gateway_url,
      mcpRequest,
      jwt_token,
      toolRunRef,
      action_intent_id
    );
    
    // 3. Parse MCP response
    const parsedResponse = parseMCPResponse(response);
    
    // 4. Extract external object refs
    const externalObjectRefs = extractExternalObjectRefs(parsedResponse);
    
    // 5. Classify errors (if any)
    const errorClassification = classifyError(parsedResponse);
    
    // 6. Return structured response
    return {
      success: parsedResponse.success,
      external_object_refs: externalObjectRefs,
      tool_run_ref: toolRunRef,
      raw_response_artifact_ref: parsedResponse.raw_response_artifact_ref,
      error_code: errorClassification?.error_code,
      error_class: errorClassification?.error_class,
      error_message: errorClassification?.error_message,
    };
  } catch (error: any) {
    logger.error('Tool invocation failed', { action_intent_id, tool_name, error });
    
    // Classify error
    const errorClassification = classifyErrorFromException(error);
    
    return {
      success: false,
      tool_run_ref: `gateway_invocation_failed_${Date.now()}`,
      error_code: errorClassification.error_code,
      error_class: errorClassification.error_class,
      error_message: errorClassification.error_message,
    };
  }
};

/**
 * Invoke Gateway with retry logic (exponential backoff)
 */
async function invokeWithRetry(
  gatewayUrl: string,
  mcpRequest: any,
  jwtToken: string,
  toolRunRef: string,
  actionIntentId: string,
  maxRetries: number = 3
): Promise<any> {
  let lastError: any;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await axios.post(
        gatewayUrl,
        mcpRequest,
        {
          headers: {
            'Authorization': `Bearer ${jwtToken}`,
            'Content-Type': 'application/json',
          },
          timeout: 30000, // 30 seconds
        }
      );
      
      return response.data;
    } catch (error: any) {
      lastError = error;
      
      // Check if error is retryable
      if (!isRetryableError(error) || attempt === maxRetries) {
        // Throw with Step Functions-compatible error type
        if (error.response?.status >= 400 && error.response?.status < 500) {
          throw new Error('PermanentError: ' + error.message);
        }
        throw new Error('TransientError: ' + error.message);
      }
      
      // Exponential backoff
      const delay = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
      await new Promise(resolve => setTimeout(resolve, delay));
      
      logger.warn('Tool invocation retry', {
        action_intent_id: actionIntentId,
        attempt: attempt + 1,
        maxRetries,
        error: error.message,
      });
    }
  }
  
  // Throw with appropriate error type for Step Functions
  if (lastError.response?.status >= 400 && lastError.response?.status < 500) {
    throw new Error('PermanentError: ' + lastError.message);
  }
  throw new Error('TransientError: ' + lastError.message);
}

/**
 * Check if error is retryable (transient)
 */
function isRetryableError(error: any): boolean {
  if (error instanceof AxiosError) {
    // 5xx errors are retryable
    if (error.response?.status && error.response.status >= 500) {
      return true;
    }
    
    // Network errors are retryable
    if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
      return true;
    }
  }
  
  return false;
}

/**
 * Parse MCP response
 */
function parseMCPResponse(response: any): any {
  if (response.error) {
    return {
      success: false,
      error: response.error,
    };
  }
  
  if (response.result?.content) {
    // Extract text content
    const textContent = response.result.content.find((c: any) => c.type === 'text');
    if (textContent) {
      try {
        const parsed = JSON.parse(textContent.text);
        return {
          success: parsed.success !== false,
          ...parsed,
        };
      } catch (e) {
        return {
          success: false,
          error: 'Failed to parse MCP response',
        };
      }
    }
  }
  
  return {
    success: false,
    error: 'Invalid MCP response format',
  };
}

/**
 * Extract external object refs from parsed response
 */
function extractExternalObjectRefs(parsedResponse: any): ToolInvocationResponse['external_object_refs'] {
  if (!parsedResponse.success || !parsedResponse.external_object_id) {
    return undefined;
  }
  
  // Infer system from tool name or response
  const system = inferSystemFromTool(parsedResponse.tool_name);
  
  return [{
    system,
    object_type: parsedResponse.object_type || 'Unknown',
    object_id: parsedResponse.external_object_id,
    object_url: parsedResponse.object_url,
  }];
}

/**
 * Infer system from tool name
 */
function inferSystemFromTool(toolName: string): 'CRM' | 'CALENDAR' | 'INTERNAL' {
  if (toolName.startsWith('crm.')) {
    return 'CRM';
  }
  if (toolName.startsWith('calendar.')) {
    return 'CALENDAR';
  }
  return 'INTERNAL';
}

/**
 * Classify error from MCP response
 */
function classifyError(parsedResponse: any): {
  error_code?: string;
  error_class?: ToolInvocationResponse['error_class'];
  error_message?: string;
} {
  if (parsedResponse.success) {
    return {};
  }
  
  const error = parsedResponse.error || parsedResponse;
  const errorMessage = error.message || error.error || 'Unknown error';
  
  // Classify by error message patterns
  if (errorMessage.includes('authentication') || errorMessage.includes('unauthorized')) {
    return {
      error_code: 'AUTH_FAILED',
      error_class: 'AUTH',
      error_message: errorMessage,
    };
  }
  
  if (errorMessage.includes('rate limit') || errorMessage.includes('throttle')) {
    return {
      error_code: 'RATE_LIMIT',
      error_class: 'RATE_LIMIT',
      error_message: errorMessage,
    };
  }
  
  if (errorMessage.includes('validation') || errorMessage.includes('invalid')) {
    return {
      error_code: 'VALIDATION_ERROR',
      error_class: 'VALIDATION',
      error_message: errorMessage,
    };
  }
  
  if (errorMessage.includes('timeout')) {
    return {
      error_code: 'TIMEOUT',
      error_class: 'TIMEOUT',
      error_message: errorMessage,
    };
  }
  
  return {
    error_code: 'UNKNOWN_ERROR',
    error_class: 'UNKNOWN',
    error_message: errorMessage,
  };
}

/**
 * Classify error from exception
 */
function classifyErrorFromException(error: any): {
  error_code: string;
  error_class: ToolInvocationResponse['error_class'];
  error_message: string;
} {
  return classifyError({ success: false, error: error.message || String(error) });
}
```

### File: `src/handlers/phase4/execution-recorder-handler.ts`

**Purpose:** Record structured execution outcome

**Handler:**

```typescript
import { Handler } from 'aws-lambda';
import { Logger } from '../../services/core/Logger';
import { TraceService } from '../../services/core/TraceService';
import { ExecutionOutcomeService } from '../../services/execution/ExecutionOutcomeService';
import { ExecutionAttemptService } from '../../services/execution/ExecutionAttemptService';
import { LedgerService } from '../../services/ledger/LedgerService';
import { LedgerEventType } from '../../types/LedgerTypes';
import { ToolInvocationResponse } from '../../types/ExecutionTypes';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { getAWSClientConfig } from '../../utils/aws-client-config';

const logger = new Logger('ExecutionRecorderHandler');
const traceService = new TraceService(logger);

// Initialize AWS clients
const region = process.env.AWS_REGION || 'us-west-2';
const clientConfig = getAWSClientConfig(region);
const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient(clientConfig), {
  marshallOptions: { removeUndefinedValues: true },
});

// Initialize services
const executionOutcomeService = new ExecutionOutcomeService(
  dynamoClient,
  process.env.EXECUTION_OUTCOMES_TABLE_NAME || 'cc-native-execution-outcomes',
  logger
);

const executionAttemptService = new ExecutionAttemptService(
  dynamoClient,
  process.env.EXECUTION_ATTEMPTS_TABLE_NAME || 'cc-native-execution-attempts',
  logger
);

const ledgerService = new LedgerService(
  logger,
  process.env.LEDGER_TABLE_NAME || 'cc-native-ledger',
  region
);

/**
 * Step Functions input: {
 *   action_intent_id,
 *   tenant_id,
 *   account_id,
 *   trace_id,
 *   tool_invocation_response: ToolInvocationResponse,
 *   tool_name,
 *   tool_schema_version,
 *   attempt_count,
 *   started_at
 * }
 */
export const handler: Handler = async (event: {
  action_intent_id: string;
  tenant_id: string;
  account_id: string;
  trace_id: string;
  tool_invocation_response: ToolInvocationResponse;
  tool_name: string;
  tool_schema_version: string;
  attempt_count: number;
  started_at: string;
}) => {
  const {
    action_intent_id,
    tenant_id,
    account_id,
    trace_id,
    tool_invocation_response,
    tool_name,
    tool_schema_version,
    attempt_count,
    started_at,
  } = event;
  
  logger.info('Execution recorder invoked', { action_intent_id, trace_id });
  
  try {
    const completedAt = new Date().toISOString();
    const status = tool_invocation_response.success ? 'SUCCEEDED' : 'FAILED';
    
    // 1. Record outcome
    const outcome = await executionOutcomeService.recordOutcome({
      action_intent_id,
      status,
      external_object_refs: tool_invocation_response.external_object_refs || [],
      error_code: tool_invocation_response.error_code,
      error_class: tool_invocation_response.error_class,
      error_message: tool_invocation_response.error_message,
      attempt_count,
      tool_name,
      tool_schema_version,
      tool_run_ref: tool_invocation_response.tool_run_ref,
      raw_response_artifact_ref: tool_invocation_response.raw_response_artifact_ref,
      started_at,
      completed_at: completedAt,
      compensation_status: 'NONE', // Compensation handled separately
      tenant_id,
      account_id,
      trace_id,
    });
    
    // 2. Update execution attempt status
    await executionAttemptService.updateStatus(
      action_intent_id,
      tenant_id,
      account_id,
      status
    );
    
    // 3. Emit ledger event
    const ledgerEventType = status === 'SUCCEEDED' 
      ? LedgerEventType.ACTION_EXECUTED 
      : LedgerEventType.ACTION_FAILED;
    
    await ledgerService.append({
      eventType: ledgerEventType,
      tenantId: tenant_id,
      accountId: account_id,
      traceId: trace_id,
      data: {
        action_intent_id,
        status,
        external_object_refs: outcome.external_object_refs,
        error_code: outcome.error_code,
        error_class: outcome.error_class,
        attempt_count,
      },
    });
    
    // 4. Emit signal for Phase 1 perception layer
    // Note: SignalService initialization should be added to handler
    // import { SignalService } from '../../services/perception/SignalService';
    // import { SignalType } from '../../types/SignalTypes';
    // 
    // const signalService = new SignalService({
    //   logger,
    //   signalsTableName: process.env.SIGNALS_TABLE_NAME || 'cc-native-signals',
    //   accountsTableName: process.env.ACCOUNTS_TABLE_NAME || 'cc-native-accounts',
    //   // ... other dependencies
    // });
    // 
    // await signalService.createSignal({
    //   signalType: status === 'SUCCEEDED' ? SignalType.ACTION_EXECUTED : SignalType.ACTION_FAILED,
    //   accountId: account_id,
    //   tenantId: tenant_id,
    //   data: {
    //     action_intent_id,
    //     status,
    //     external_object_refs: outcome.external_object_refs,
    //   },
    // });
    
    // 5. Return outcome
    return {
      outcome,
    };
  } catch (error: any) {
    logger.error('Execution recording failed', { action_intent_id, error });
    
    // Return structured error for Step Functions
    throw new Error(JSON.stringify({
      errorType: error.name || 'Error',
      errorMessage: error.message,
      action_intent_id,
    }));
  }
};
```

### File: `src/handlers/phase4/compensation-handler.ts`

**Purpose:** Handle compensation (rollback) for failed executions

**Handler:**

```typescript
import { Handler } from 'aws-lambda';
import { Logger } from '../../services/core/Logger';
import { TraceService } from '../../services/core/TraceService';
import { ActionIntentService } from '../../services/decision/ActionIntentService';
import { ActionTypeRegistryService } from '../../services/execution/ActionTypeRegistryService';
import { ExecutionOutcomeService } from '../../services/execution/ExecutionOutcomeService';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { getAWSClientConfig } from '../../utils/aws-client-config';

const logger = new Logger('CompensationHandler');
const traceService = new TraceService(logger);

// Initialize AWS clients
const region = process.env.AWS_REGION || 'us-west-2';
const clientConfig = getAWSClientConfig(region);
const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient(clientConfig), {
  marshallOptions: { removeUndefinedValues: true },
});

// Initialize services
const actionIntentService = new ActionIntentService(
  dynamoClient,
  process.env.ACTION_INTENT_TABLE_NAME || 'cc-native-action-intents',
  logger
);

const actionTypeRegistryService = new ActionTypeRegistryService(
  dynamoClient,
  process.env.ACTION_TYPE_REGISTRY_TABLE_NAME || 'cc-native-action-type-registry',
  logger
);

const executionOutcomeService = new ExecutionOutcomeService(
  dynamoClient,
  process.env.EXECUTION_OUTCOMES_TABLE_NAME || 'cc-native-execution-outcomes',
  logger
);

/**
 * Step Functions input: {
 *   action_intent_id,
 *   tenant_id,
 *   account_id,
 *   execution_result: ToolInvocationResponse
 * }
 */
export const handler: Handler = async (event: {
  action_intent_id: string;
  tenant_id: string;
  account_id: string;
  execution_result: any;
}) => {
  const { action_intent_id, tenant_id, account_id, execution_result } = event;
  const traceId = traceService.generateTraceId();
  
  logger.info('Compensation handler invoked', { action_intent_id, traceId });
  
  try {
    // 1. Fetch ActionIntentV1
    const intent = await actionIntentService.getIntent(action_intent_id, tenant_id, account_id);
    
    if (!intent) {
      throw new Error(`ActionIntent not found: ${action_intent_id}`);
    }
    
    // 2. Get tool mapping to determine compensation strategy
    const toolMapping = await actionTypeRegistryService.getToolMapping(
      intent.action_type,
      intent.parameters_schema_version
    );
    
    if (!toolMapping) {
      throw new Error(`Tool mapping not found for action_type: ${intent.action_type}`);
    }
    
    // 3. Check if compensation is supported
    if (toolMapping.compensation_strategy === 'NONE') {
      logger.warn('Compensation not supported for this action type', {
        action_intent_id,
        action_type: intent.action_type,
      });
      return {
        compensation_status: 'NONE',
        reason: 'Compensation not supported for this action type',
      };
    }
    
    // 4. Get external object refs from execution result
    const externalObjectRefs = execution_result.external_object_refs || [];
    
    if (externalObjectRefs.length === 0) {
      logger.info('No external objects to compensate', { action_intent_id });
      return {
        compensation_status: 'COMPLETED',
        reason: 'No external objects created',
      };
    }
    
    // 5. Call compensation tool via Gateway (if automatic)
    // TODO: Implement compensation tool invocation via Gateway
    // For now, mark as pending manual compensation
    if (toolMapping.compensation_strategy === 'AUTOMATIC') {
      // TODO: Invoke compensation tool via Gateway
      logger.info('Automatic compensation not yet implemented', {
        action_intent_id,
        external_object_refs: externalObjectRefs,
      });
      
      return {
        compensation_status: 'PENDING',
        reason: 'Automatic compensation not yet implemented',
      };
    }
    
    // Manual compensation
    return {
      compensation_status: 'PENDING',
      reason: 'Requires manual compensation',
    };
  } catch (error: any) {
    logger.error('Compensation failed', { action_intent_id, error });
    
    return {
      compensation_status: 'FAILED',
      compensation_error: error.message,
    };
  }
};
```

---

## 2. CDK Infrastructure

### File: `src/stacks/constructs/ExecutionInfrastructure.ts` (Phase 4.2 Additions)

**Purpose:** Add orchestration components to existing Phase 4.1 construct

**Phase 4.2 Additions:**

```typescript
// Add to existing ExecutionInfrastructure class

// Additional Lambda Functions (Phase 4.2)
public readonly toolMapperHandler: lambda.Function;
public readonly toolInvokerHandler: lambda.Function;
public readonly executionRecorderHandler: lambda.Function;
public readonly compensationHandler: lambda.Function;

// Additional Dead Letter Queues (Phase 4.2)
public readonly toolMapperDlq: sqs.Queue;
public readonly toolInvokerDlq: sqs.Queue;
public readonly executionRecorderDlq: sqs.Queue;
public readonly compensationDlq: sqs.Queue;

// Step Functions
public readonly executionStateMachine: stepfunctions.StateMachine;

// EventBridge Rule
public readonly executionTriggerRule: events.Rule;

// S3 Bucket (for raw response artifacts)
public readonly executionArtifactsBucket?: s3.IBucket;

// In constructor, add Phase 4.2 components:
constructor(scope: Construct, id: string, props: ExecutionInfrastructureProps) {
  super(scope, id);

  // ... Phase 4.1 components ...
  
  // Phase 4.2: Additional DLQs
  this.toolMapperDlq = this.createDlq('ToolMapperDlq', 'cc-native-tool-mapper-handler-dlq');
  this.toolInvokerDlq = this.createDlq('ToolInvokerDlq', 'cc-native-tool-invoker-handler-dlq');
  this.executionRecorderDlq = this.createDlq('ExecutionRecorderDlq', 'cc-native-execution-recorder-handler-dlq');
  this.compensationDlq = this.createDlq('CompensationDlq', 'cc-native-compensation-handler-dlq');
  
  // Phase 4.2: Additional Lambda Functions
  this.toolMapperHandler = this.createToolMapperHandler(props);
  this.toolInvokerHandler = this.createToolInvokerHandler(props);
  this.executionRecorderHandler = this.createExecutionRecorderHandler(props);
  this.compensationHandler = this.createCompensationHandler(props);
  
  // Phase 4.2: S3 Bucket (if not provided)
  if (!props.artifactsBucket) {
    this.executionArtifactsBucket = new s3.Bucket(this, 'ExecutionArtifactsBucket', {
      bucketName: `cc-native-execution-artifacts-${cdk.Aws.ACCOUNT_ID}-${cdk.Aws.REGION}`,
      versioned: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
    });
  } else {
    this.executionArtifactsBucket = props.artifactsBucket;
  }
  
  // Phase 4.2: Step Functions State Machine
  this.executionStateMachine = this.createExecutionStateMachine();
  
  // Phase 4.2: EventBridge Rule
  this.executionTriggerRule = this.createExecutionTriggerRule(props);
}

private createToolMapperHandler(props: ExecutionInfrastructureProps): lambda.Function {
  const handler = new lambdaNodejs.NodejsFunction(this, 'ToolMapperHandler', {
    functionName: 'cc-native-tool-mapper',
    entry: 'src/handlers/phase4/tool-mapper-handler.ts',
    handler: 'handler',
    runtime: lambda.Runtime.NODEJS_20_X,
    timeout: cdk.Duration.seconds(30),
    environment: {
      ACTION_INTENT_TABLE_NAME: props.actionIntentTable.tableName,
      ACTION_TYPE_REGISTRY_TABLE_NAME: this.actionTypeRegistryTable.tableName,
      AGENTCORE_GATEWAY_URL: process.env.AGENTCORE_GATEWAY_URL || '', // TODO: Get from Gateway construct
      AWS_REGION: props.region || 'us-west-2',
    },
    deadLetterQueue: this.toolMapperDlq,
    deadLetterQueueEnabled: true,
    retryAttempts: 2,
  });
  
  // Grant permissions
  props.actionIntentTable.grantReadData(handler);
  this.actionTypeRegistryTable.grantReadData(handler);
  
  // Grant Cognito permissions for JWT token (if userPool provided)
  if (props.userPool) {
    handler.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['cognito-idp:GetUser', 'cognito-idp:InitiateAuth'],
      resources: [props.userPool.userPoolArn],
    }));
  }
  
  return handler;
}

private createToolInvokerHandler(props: ExecutionInfrastructureProps): lambda.Function {
  const handler = new lambdaNodejs.NodejsFunction(this, 'ToolInvokerHandler', {
    functionName: 'cc-native-tool-invoker',
    entry: 'src/handlers/phase4/tool-invoker-handler.ts',
    handler: 'handler',
    runtime: lambda.Runtime.NODEJS_20_X,
    timeout: cdk.Duration.seconds(60), // Longer timeout for external calls
    environment: {
      EXECUTION_ARTIFACTS_BUCKET: this.executionArtifactsBucket?.bucketName || '',
      AWS_REGION: props.region || 'us-west-2',
    },
    deadLetterQueue: this.toolInvokerDlq,
    deadLetterQueueEnabled: true,
    retryAttempts: 2,
  });
  
  // Grant S3 permissions (for raw response artifacts)
  if (this.executionArtifactsBucket) {
    this.executionArtifactsBucket.grantWrite(handler);
  }
  
  return handler;
}

private createExecutionRecorderHandler(props: ExecutionInfrastructureProps): lambda.Function {
  const handler = new lambdaNodejs.NodejsFunction(this, 'ExecutionRecorderHandler', {
    functionName: 'cc-native-execution-recorder',
    entry: 'src/handlers/phase4/execution-recorder-handler.ts',
    handler: 'handler',
    runtime: lambda.Runtime.NODEJS_20_X,
    timeout: cdk.Duration.seconds(30),
    environment: {
      EXECUTION_OUTCOMES_TABLE_NAME: this.executionOutcomesTable.tableName,
      EXECUTION_ATTEMPTS_TABLE_NAME: this.executionAttemptsTable.tableName,
      LEDGER_TABLE_NAME: props.ledgerTable.tableName,
      SIGNALS_TABLE_NAME: process.env.SIGNALS_TABLE_NAME || 'cc-native-signals',
      ACCOUNTS_TABLE_NAME: process.env.ACCOUNTS_TABLE_NAME || 'cc-native-accounts',
      EVENT_BUS_NAME: props.eventBus.eventBusName,
      AWS_REGION: props.region || 'us-west-2',
    },
    deadLetterQueue: this.executionRecorderDlq,
    deadLetterQueueEnabled: true,
    retryAttempts: 2,
  });
  
  // Grant permissions
  this.executionOutcomesTable.grantWriteData(handler);
  this.executionAttemptsTable.grantWriteData(handler);
  props.ledgerTable.grantWriteData(handler);
  props.eventBus.grantPutEventsTo(handler);
  
  return handler;
}

private createCompensationHandler(props: ExecutionInfrastructureProps): lambda.Function {
  const handler = new lambdaNodejs.NodejsFunction(this, 'CompensationHandler', {
    functionName: 'cc-native-compensation-handler',
    entry: 'src/handlers/phase4/compensation-handler.ts',
    handler: 'handler',
    runtime: lambda.Runtime.NODEJS_20_X,
    timeout: cdk.Duration.seconds(60),
    environment: {
      ACTION_INTENT_TABLE_NAME: props.actionIntentTable.tableName,
      ACTION_TYPE_REGISTRY_TABLE_NAME: this.actionTypeRegistryTable.tableName,
      EXECUTION_OUTCOMES_TABLE_NAME: this.executionOutcomesTable.tableName,
      EXTERNAL_WRITE_DEDUPE_TABLE_NAME: this.externalWriteDedupeTable.tableName,
      AWS_REGION: props.region || 'us-west-2',
    },
    deadLetterQueue: this.compensationDlq,
    deadLetterQueueEnabled: true,
    retryAttempts: 2,
  });
  
  // Grant permissions
  props.actionIntentTable.grantReadData(handler);
  this.actionTypeRegistryTable.grantReadData(handler);
  this.executionOutcomesTable.grantReadWriteData(handler);
  this.externalWriteDedupeTable.grantReadData(handler);
  
  return handler;
}

private createExecutionStateMachine(): stepfunctions.StateMachine {
  const definition = this.buildStateMachineDefinition();
  
  return new stepfunctions.StateMachine(this, 'ExecutionStateMachine', {
    stateMachineName: 'cc-native-execution-orchestrator',
    definition,
    timeout: cdk.Duration.hours(1),
  });
}

private buildStateMachineDefinition(): stepfunctions.IChainable {
  // START_EXECUTION
  const startExecution = new stepfunctionsTasks.LambdaInvoke(this, 'StartExecution', {
    lambdaFunction: this.executionStarterHandler,
    outputPath: '$',
  });
  
  // VALIDATE_PREFLIGHT
  const validatePreflight = new stepfunctionsTasks.LambdaInvoke(this, 'ValidatePreflight', {
    lambdaFunction: this.executionValidatorHandler,
    outputPath: '$',
  });
  
  // MAP_ACTION_TO_TOOL
  const mapActionToTool = new stepfunctionsTasks.LambdaInvoke(this, 'MapActionToTool', {
    lambdaFunction: this.toolMapperHandler,
    outputPath: '$',
  });
  
  // INVOKE_TOOL (with retry)
  const invokeTool = new stepfunctionsTasks.LambdaInvoke(this, 'InvokeTool', {
    lambdaFunction: this.toolInvokerHandler,
    outputPath: '$',
    retryOnServiceExceptions: true,
  }).addRetry({
    errors: ['TransientError'],
    interval: cdk.Duration.seconds(2),
    maxAttempts: 3,
    backoffRate: 2.0,
  });
  
  // COMPENSATE_ACTION (for permanent errors)
  const compensateAction = new stepfunctionsTasks.LambdaInvoke(this, 'CompensateAction', {
    lambdaFunction: this.compensationHandler,
    outputPath: '$',
  });
  
  // RECORD_OUTCOME
  const recordOutcome = new stepfunctionsTasks.LambdaInvoke(this, 'RecordOutcome', {
    lambdaFunction: this.executionRecorderHandler,
    outputPath: '$',
  });
  
  // RECORD_FAILURE (for errors in early states)
  const recordFailure = new stepfunctionsTasks.LambdaInvoke(this, 'RecordFailure', {
    lambdaFunction: this.executionRecorderHandler,
    outputPath: '$',
  });
  
  // Add error handling
  startExecution.addCatch(recordFailure, {
    errors: ['States.ALL'],
    resultPath: '$.error',
  });
  
  validatePreflight.addCatch(recordFailure, {
    errors: ['States.ALL'],
    resultPath: '$.error',
  });
  
  mapActionToTool.addCatch(recordFailure, {
    errors: ['States.ALL'],
    resultPath: '$.error',
  });
  
  invokeTool.addCatch(compensateAction, {
    errors: ['PermanentError'],
    resultPath: '$.error',
  });
  
  invokeTool.addCatch(recordFailure, {
    errors: ['States.ALL'],
    resultPath: '$.error',
  });
  
  // Build chain
  return startExecution
    .next(validatePreflight)
    .next(mapActionToTool)
    .next(invokeTool)
    .next(recordOutcome);
}

private createExecutionTriggerRule(props: ExecutionInfrastructureProps): events.Rule {
  const rule = new events.Rule(this, 'ExecutionTriggerRule', {
    eventBus: props.eventBus,
    eventPattern: {
      source: ['cc-native'],
      detailType: ['ACTION_APPROVED'],
    },
  });
  
  // Trigger Step Functions with action_intent_id
  // Note: Execution name uses action_intent_id for idempotency (Step Functions enforces uniqueness)
  rule.addTarget(new eventsTargets.SfnStateMachine(this.executionStateMachine, {
    input: events.RuleTargetInput.fromObject({
      action_intent_id: events.EventField.fromPath('$.detail.data.action_intent_id'),
      tenant_id: events.EventField.fromPath('$.detail.data.tenant_id'),
      account_id: events.EventField.fromPath('$.detail.data.account_id'),
    }),
  }));
  
  // Grant Step Functions permission to be invoked by EventBridge
  this.executionStateMachine.grantStartExecution(new iam.ServicePrincipal('events.amazonaws.com'));
  
  return rule;
}
```

---

## 3. Step Functions State Machine Definition

**File:** `src/stacks/constructs/ExecutionInfrastructure.ts` (in `buildStateMachineDefinition` method)

**State Machine JSON (for reference):**

```json
{
  "Comment": "Action Intent Execution Orchestrator",
  "StartAt": "StartExecution",
  "States": {
    "StartExecution": {
      "Type": "Task",
      "Resource": "arn:aws:states:::lambda:invoke",
      "Parameters": {
        "FunctionName": "cc-native-execution-starter",
        "Payload": {
          "action_intent_id": "$.action_intent_id"
        }
      },
      "Next": "ValidatePreflight",
      "Catch": [
        {
          "ErrorEquals": ["States.ALL"],
          "Next": "RecordFailure",
          "ResultPath": "$.error"
        }
      ]
    },
    "ValidatePreflight": {
      "Type": "Task",
      "Resource": "arn:aws:states:::lambda:invoke",
      "Parameters": {
        "FunctionName": "cc-native-execution-validator",
        "Payload": {
          "action_intent_id": "$.action_intent_id",
          "tenant_id": "$.tenant_id",
          "account_id": "$.account_id"
        }
      },
      "Next": "MapActionToTool",
      "Catch": [
        {
          "ErrorEquals": ["States.ALL"],
          "Next": "RecordFailure",
          "ResultPath": "$.error"
        }
      ]
    },
    "MapActionToTool": {
      "Type": "Task",
      "Resource": "arn:aws:states:::lambda:invoke",
      "Parameters": {
        "FunctionName": "cc-native-tool-mapper",
        "Payload": {
          "action_intent_id": "$.action_intent_id",
          "tenant_id": "$.tenant_id",
          "account_id": "$.account_id",
          "idempotency_key": "$.idempotency_key"
        }
      },
      "Next": "InvokeTool",
      "Catch": [
        {
          "ErrorEquals": ["States.ALL"],
          "Next": "RecordFailure",
          "ResultPath": "$.error"
        }
      ]
    },
    "InvokeTool": {
      "Type": "Task",
      "Resource": "arn:aws:states:::lambda:invoke",
      "Parameters": {
        "FunctionName": "cc-native-tool-invoker",
        "Payload": {
          "gateway_url": "$.gateway_url",
          "tool_name": "$.tool_name",
          "tool_arguments": "$.tool_arguments",
          "idempotency_key": "$.idempotency_key",
          "jwt_token": "$.jwt_token",
          "action_intent_id": "$.action_intent_id",
          "tenant_id": "$.tenant_id",
          "account_id": "$.account_id",
          "trace_id": "$.trace_id"
        }
      },
      "Retry": [
        {
          "ErrorEquals": ["TransientError"],
          "IntervalSeconds": 2,
          "MaxAttempts": 3,
          "BackoffRate": 2.0
        }
      ],
      "Catch": [
        {
          "ErrorEquals": ["PermanentError"],
          "Next": "CompensateAction"
        },
        {
          "ErrorEquals": ["States.ALL"],
          "Next": "RecordFailure",
          "ResultPath": "$.error"
        }
      ],
      "Next": "RecordOutcome"
    },
    "CompensateAction": {
      "Type": "Task",
      "Resource": "arn:aws:states:::lambda:invoke",
      "Parameters": {
        "FunctionName": "cc-native-compensation-handler",
        "Payload": {
          "action_intent_id": "$.action_intent_id",
          "tenant_id": "$.tenant_id",
          "account_id": "$.account_id",
          "execution_result": "$"
        }
      },
      "Next": "RecordOutcome"
    },
    "RecordOutcome": {
      "Type": "Task",
      "Resource": "arn:aws:states:::lambda:invoke",
      "Parameters": {
        "FunctionName": "cc-native-execution-recorder",
        "Payload": {
          "action_intent_id": "$.action_intent_id",
          "tenant_id": "$.tenant_id",
          "account_id": "$.account_id",
          "trace_id": "$.trace_id",
          "tool_invocation_response": "$.tool_invocation_response",
          "tool_name": "$.tool_name",
          "tool_schema_version": "$.tool_schema_version",
          "attempt_count": 1,
          "started_at": "$.started_at"
        }
      },
      "End": true
    },
    "RecordFailure": {
      "Type": "Task",
      "Resource": "arn:aws:states:::lambda:invoke",
      "Parameters": {
        "FunctionName": "cc-native-execution-recorder",
        "Payload": {
          "action_intent_id": "$.action_intent_id",
          "tenant_id": "$.tenant_id",
          "account_id": "$.account_id",
          "trace_id": "$.trace_id",
          "status": "FAILED",
          "error": "$.error"
        }
      },
      "End": true
    }
  }
}
```

---

## 4. Testing

### Integration Tests

**Files to Create:**
- `src/tests/integration/execution/orchestration-flow.test.ts` - Step Functions execution flow
- `src/tests/integration/execution/tool-invocation.test.ts` - ToolInvoker → Gateway → Adapter flow

---

## 5. Implementation Checklist

- [ ] Create `src/handlers/phase4/tool-mapper-handler.ts`
- [ ] Create `src/handlers/phase4/tool-invoker-handler.ts`
- [ ] Create `src/handlers/phase4/execution-recorder-handler.ts`
- [ ] Create `src/handlers/phase4/compensation-handler.ts`
- [ ] Add Phase 4.2 handlers to CDK construct
- [ ] Add Phase 4.2 DLQs to CDK construct
- [ ] Add S3 bucket for raw response artifacts
- [ ] Create Step Functions state machine in CDK (with error handling)
- [ ] Create EventBridge rule (ACTION_APPROVED → Step Functions)
- [ ] Integration tests for orchestration

---

## 6. Next Steps

After Phase 4.2 completion:
- ✅ Orchestration layer complete
- ⏳ Proceed to Phase 4.3 (Connectors) - Adapter interface, Internal adapter, CRM adapter, AgentCore Gateway

---

**See:** `PHASE_4_CODE_LEVEL_PLAN.md` for complete Phase 4 overview and cross-references.
