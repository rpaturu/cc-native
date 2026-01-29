# Phase 4.4 — Safety & Outcomes: Code-Level Implementation Plan

**Status:** ✅ **READY FOR IMPLEMENTATION**  
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

## Alignment with 4.1–4.3 Implementation

- **SignalTypes.ts:** `ACTION_EXECUTED`, `ACTION_FAILED`, `WINDOW_KEY_DERIVATION`, and `DEFAULT_SIGNAL_TTL` are already implemented. No changes required.
- **ExecutionInfrastructureConfig:** `executionStatusApi` (function name), `defaults.timeout.executionStatusApi`, and `defaults.memorySize?.executionStatusApi` already exist.
- **ExecutionInfrastructure:** Exposes `executionStateMachine`, `executionAttemptsTable`, `executionOutcomesTable`; `actionIntentTable` comes from props. No `apiGateway` prop yet — add in 4.4.
- **execution-recorder-handler:** Uses `requireEnv`, Zod, and records outcome + ledger; does not yet call SignalService. **Decision (4.4):** Signal emission uses **Option A** — extend SignalService with `createExecutionSignal()` that does **not** require lifecycle state; execution outcomes are not coupled to lifecycle state. Use shared helper `buildExecutionOutcomeSignal(outcome, intent, trace_id, now)` for consistent signal shape.
- **ExecutionStatus / ExecutionOutcomeService / ExecutionAttemptService:** Types and `getOutcome` / `getAttempt` signatures match. **listOutcomes** currently returns `Promise<ActionOutcomeV1[]>` with no `nextToken`; doc requires extending to `(tenantId, accountId, limit, nextToken?)` and `{ items, nextToken }` (see §2.3).

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

**Purpose:** Add signal emission to existing handler after recording outcome and ledger event.

**Alignment with 4.1–4.3:**
- **execution-recorder-handler** already uses `requireEnv` and has `logger`, `ledgerService`, `region`, and DynamoDB clients. No duplicate `requireEnv` needed.
- **SignalTypes.ts** — **already implemented.** `SignalType.ACTION_EXECUTED` and `SignalType.ACTION_FAILED` exist; `WINDOW_KEY_DERIVATION` and `DEFAULT_SIGNAL_TTL` already include these types (window key: `accountId-actionIntentId`, TTL: 90 days). **No changes to SignalTypes.ts required.**

**Decision — SignalService coupling (Option A, mandatory):** Extend SignalService with **`createExecutionSignal()`** that does **not** require lifecycle state. Execution outcomes must not be coupled to lifecycle state. This method writes the signal and optionally publishes/ledgers; it does **not** call `getAccountState()` or update AccountState. Implement in `SignalService` (e.g. overload or new method that skips lifecycle state and TransactWrite to accounts table).

**Update required:**

1. **Environment and dependencies**
   - Add env: `SIGNALS_TABLE_NAME`, `EVENT_BUS_NAME` (for EventPublisher). **No ACCOUNTS_TABLE_NAME** required for execution signals (Option A).
   - **EventPublisher:** Use `new EventPublisher(logger, eventBusName, region)` — not raw `EventBridgeClient`. EventPublisher is in `../../services/events/EventPublisher`.
   - **SignalService:** Use new **`createExecutionSignal(evidence, traceId)`** (or equivalent) that only writes to signals table + optional ledger/event; no LifecycleStateService, no accounts table.

2. **Shared helper — signal shape**
   - Add **`buildExecutionOutcomeSignal(outcome, intent, trace_id, now)`** in a shared file (e.g. `src/utils/execution-signal-helpers.ts` or under `src/services/perception/`). It returns a full `Signal` object with correct `suppression`, `detectorVersion`, `metadata`, `evidence`, `dedupeKey`, `windowKey` (via `WINDOW_KEY_DERIVATION`), etc. Handler calls this helper then passes the result to `signalService.createExecutionSignal(signal)` (or equivalent). Keeps the full signal contract consistent and testable.

3. **Placement**
   - After `executionOutcomeService.recordOutcome(...)`, `executionAttemptService.updateStatus(...)`, and `ledgerService.append(...)` (i.e. after the existing "3. Emit ledger event" block). The comment "Note: Signal emission for Phase 1 perception layer is implemented in Phase 4.4" already marks the spot.

4. **Idempotency**
   - Signal emission is safe to retry; **dedupeKey** prevents duplicate signals per `action_intent_id`. (Already implied by the signal model; spelling it out helps future readers.)

**See:** `PHASE_4_1_CODE_LEVEL_PLAN.md` Section 5; `src/types/SignalTypes.ts` (Signal, WINDOW_KEY_DERIVATION, DEFAULT_SIGNAL_TTL); `src/services/perception/SignalService.ts` (add createExecutionSignal).

---

## 2. Execution Status API Handler

### File: `src/handlers/phase4/execution-status-api-handler.ts`

**Purpose:** API endpoints for execution status queries.

---

### 2.1 Auth (mandatory — zero-trust)

**Problem:** Trusting `x-tenant-id` and `account_id` from the caller allows anyone with API access to enumerate other tenants/accounts by guessing IDs.

**Fix (mandatory):**

- Put the API behind a **JWT authorizer** (Cognito or existing auth). In API Gateway, attach a Cognito User Pool authorizer (or Lambda authorizer) to the execution status API methods.
- **Derive `tenantId` from token claims** (e.g. `event.requestContext.authorizer.claims['custom:tenant_id']` or equivalent), **not** from `x-tenant-id` header.
- **Validate account access:** Either (a) derive allowed `accountIds` from token claims (e.g. `custom:account_ids`), or (b) validate that the requested `account_id` belongs to the tenant via a lookup (e.g. tenant/account table or identity service). Reject with 403 if account is not allowed for the authenticated tenant.
- If `x-tenant-id` is kept for internal tooling, make it **disabled in prod** (e.g. only honored when request is from an internal authorizer or specific role), or remove it from public API.

**Handler responsibilities:** Read `event.requestContext.authorizer` (set by API Gateway after JWT validation); extract tenantId and optionally allowed account IDs; do not trust headers for tenant/account identity.

---

### 2.2 Not-found semantics (mandatory)

**Problem:** Returning `PENDING` or `EXPIRED` when the `action_intent_id` does not exist is bad UX and a security leak (allows probing which IDs exist).

**Fix (mandatory):**

- If **`intent == null && attempt == null && outcome == null`** → return **404** with a generic message (e.g. `"Execution not found"`). Do **not** return 200 with `status: 'PENDING'` or `status: 'EXPIRED'` in this case.

**Status determinism (race conditions):** If both attempt and outcome exist, **outcome wins**. Attempt is informational only. This prevents "why does it sometimes show RUNNING after completion?" bugs when outcome is written slightly after attempt is updated.

---

### 2.3 Pagination (important)

**Problem:** `listOutcomes` returns only a fixed slice; real accounts will exceed 50/100.

**Fix:**

- **ExecutionOutcomeService.listOutcomes:** Extend signature to accept optional `nextToken?: string` and return `{ items: ActionOutcomeV1[], nextToken?: string }` (use DynamoDB `ExclusiveStartKey` / `LastEvaluatedKey`).
- **List endpoint:** Accept `next_token` query param; return `next_token` in response when there are more results. Response shape: `{ executions: ExecutionStatus[], next_token?: string }`.

---

### 2.4 Handler implementation (reference)

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
 * Helper to validate required environment variables with descriptive errors.
 * Do not use this helper for AWS-provided runtime variables like AWS_REGION
 * (use process.env and a runtime-specific error message instead).
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

// AWS_REGION is set by Lambda runtime; do not set in CDK. If missing, fail with a runtime-specific message.
const region = process.env.AWS_REGION;
if (!region) {
  const err = new Error('[ExecutionStatusAPIHandler] AWS_REGION is not set. This is normally set by the Lambda runtime; check that the function is running in a Lambda environment.');
  err.name = 'ConfigurationError';
  throw err;
}
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
 * Helper to add CORS headers.
 * Note: Allow-Origin '*' is acceptable for Phase 4.4. Future hardening: restrict
 * to known UI origins or move CORS config to API Gateway level.
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
 * Derive tenantId (and optionally allowed account IDs) from JWT authorizer.
 * Do not trust x-tenant-id header for production.
 */
function getTenantFromAuthorizer(event: APIGatewayProxyEvent): { tenantId: string; accountIds?: string[] } | null {
  const claims = event.requestContext?.authorizer?.claims as Record<string, string> | undefined;
  if (!claims) return null;
  const tenantId = claims['custom:tenant_id'] ?? claims['tenant_id'];
  let accountIds: string[] | undefined;
  try {
    const raw = claims['custom:account_ids'];
    accountIds = raw ? (JSON.parse(raw) as string[]) : undefined;
  } catch {
    // Invalid JSON or missing claim — treat as no accountIds restriction (or could 403)
    accountIds = undefined;
  }
  return tenantId ? { tenantId, accountIds } : null;
}

/**
 * GET /executions/{action_intent_id}/status
 * Get execution status for a specific action intent.
 * Auth: tenantId from JWT claims; validate account_id belongs to tenant (or is in allowed list).
 */
async function getExecutionStatusHandler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const auth = getTenantFromAuthorizer(event);
  if (!auth) {
    return addCorsHeaders({ statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) });
  }
  const { tenantId, accountIds } = auth;
  const { action_intent_id } = event.pathParameters || {};
  const accountId = event.queryStringParameters?.account_id;

  if (!action_intent_id || !accountId) {
    return addCorsHeaders({
      statusCode: 400,
      body: JSON.stringify({ error: 'Missing required parameters: action_intent_id, account_id' }),
    });
  }
  if (accountIds && !accountIds.includes(accountId)) {
    return addCorsHeaders({ statusCode: 403, body: JSON.stringify({ error: 'Forbidden' }) });
  }

  try {
    const attempt = await executionAttemptService.getAttempt(action_intent_id, tenantId, accountId);
    const outcome = await executionOutcomeService.getOutcome(action_intent_id, tenantId, accountId);
    const intent = await actionIntentService.getIntent(action_intent_id, tenantId, accountId);

    // Mandatory: not found → 404 (do not return PENDING/EXPIRED for unknown IDs)
    if (!outcome && !attempt && !intent) {
      return addCorsHeaders({
        statusCode: 404,
        body: JSON.stringify({ error: 'Execution not found' }),
      });
    }

    let status: ExecutionStatus['status'] = 'PENDING';
    let startedAt: string | undefined;
    let completedAt: string | undefined;
    let externalObjectRefs: ExecutionStatus['external_object_refs'];
    let errorMessage: string | undefined;
    let errorClass: ExecutionStatus['error_class'];
    let attemptCount: number | undefined;

    // Outcome is source of truth for terminal status. If both attempt and outcome exist, outcome wins; attempt is informational only.
    if (outcome) {
      status = outcome.status;
      startedAt = outcome.started_at;
      completedAt = outcome.completed_at;
      externalObjectRefs = outcome.external_object_refs;
      errorMessage = outcome.error_message;
      errorClass = outcome.error_class;
      attemptCount = outcome.attempt_count;
    } else if (attempt) {
      // Only attempt, no outcome: RUNNING → RUNNING; anything else (FAILED/SUCCEEDED/CANCELLED) → PENDING to avoid invalid API status.
      status = attempt.status === 'RUNNING' ? 'RUNNING' : 'PENDING';
      startedAt = attempt.started_at;
    } else if (intent) {
      const now = Math.floor(Date.now() / 1000);
      status = intent.expires_at_epoch <= now ? 'EXPIRED' : 'PENDING';
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
 * List executions for an account. Supports pagination via next_token.
 */
async function listAccountExecutionsHandler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const auth = getTenantFromAuthorizer(event);
  if (!auth) {
    return addCorsHeaders({ statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) });
  }
  const { tenantId, accountIds } = auth;
  const { account_id } = event.pathParameters || {};
  if (!account_id) {
    return addCorsHeaders({
      statusCode: 400,
      body: JSON.stringify({ error: 'Missing required parameter: account_id' }),
    });
  }
  if (accountIds && !accountIds.includes(account_id)) {
    return addCorsHeaders({ statusCode: 403, body: JSON.stringify({ error: 'Forbidden' }) });
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
      }),
    });
  }
  const nextToken = event.queryStringParameters?.next_token ?? undefined;

  try {
    const result = await executionOutcomeService.listOutcomes(tenantId, account_id, limit, nextToken);

    const executionStatuses: ExecutionStatus[] = result.items.map(outcome => ({
      action_intent_id: outcome.action_intent_id,
      status: outcome.status,
      started_at: outcome.started_at,
      completed_at: outcome.completed_at,
      external_object_refs: outcome.external_object_refs,
      error_message: outcome.error_message,
      error_class: outcome.error_class,
      attempt_count: outcome.attempt_count,
    }));

    const body: { executions: ExecutionStatus[]; next_token?: string } = { executions: executionStatuses };
    if (result.nextToken) body.next_token = result.nextToken;

    return addCorsHeaders({
      statusCode: 200,
      body: JSON.stringify(body),
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
    // Route matching uses includes(); ensure API Gateway resource paths are stable so this doesn't surprise. Optional later: match on resource pattern.
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

**Alignment with 4.1–4.3:** The construct already exposes `public readonly executionStateMachine: stepfunctions.StateMachine` (line ~71). Use `this.executionStateMachine` for metrics.

**Phase 4.4 Additions:**

- **State machine alarms:** Set **period** (e.g. 1–5 minutes) and **statistic: Sum** explicitly. Use `this.executionStateMachine` for metrics.
- **Lambda error alarms:** Add alarms for key Lambdas so failures are visible without relying only on SFN: **tool-invoker**, **execution-recorder**, **execution-failure-recorder**; optionally **internal-adapter**, **crm-adapter**.

```typescript
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';

const ALARM_PERIOD = cdk.Duration.minutes(5);
const STATISTIC = 'Sum';

private createCloudWatchAlarms(): void {
  // Step Functions — period and statistic on the metric (not on Alarm)
  new cloudwatch.Alarm(this, 'ExecutionFailureAlarm', {
    metric: this.executionStateMachine.metricFailed({ period: ALARM_PERIOD, statistic: STATISTIC }),
    threshold: 5,
    evaluationPeriods: 1,
    alarmDescription: 'Alert when execution failures exceed threshold',
  });
  new cloudwatch.Alarm(this, 'ExecutionDurationAlarm', {
    metric: this.executionStateMachine.metricExecutionTime({ period: ALARM_PERIOD, statistic: 'Average' }),
    threshold: 300000, // 5 minutes
    evaluationPeriods: 1,
    alarmDescription: 'Alert when execution duration exceeds threshold',
  });
  new cloudwatch.Alarm(this, 'ExecutionThrottleAlarm', {
    metric: this.executionStateMachine.metricThrottled({ period: ALARM_PERIOD, statistic: STATISTIC }),
    threshold: 10,
    evaluationPeriods: 1,
    alarmDescription: 'Alert when execution throttles exceed threshold',
  });

  // Lambda error alarms (so you see failures without relying only on SFN)
  this.createLambdaErrorAlarm(this.toolInvokerHandler, 'ToolInvokerErrors');
  this.createLambdaErrorAlarm(this.executionRecorderHandler, 'ExecutionRecorderErrors');
  this.createLambdaErrorAlarm(this.executionFailureRecorderHandler, 'ExecutionFailureRecorderErrors');
  // Optional: this.createLambdaErrorAlarm(this.internalAdapterHandler, 'InternalAdapterErrors');
  // Optional: this.createLambdaErrorAlarm(this.crmAdapterHandler, 'CrmAdapterErrors');
}

private createLambdaErrorAlarm(fn: lambda.Function, id: string): void {
  new cloudwatch.Alarm(this, id, {
    metric: fn.metricErrors({ period: ALARM_PERIOD, statistic: 'Sum' }),
    threshold: 1,
    evaluationPeriods: 1,
    alarmDescription: `Alert when ${fn.functionName} reports errors`,
  });
}

// Call in constructor:
constructor(scope: Construct, id: string, props: ExecutionInfrastructureProps) {
  // ... existing code ...
  this.createCloudWatchAlarms();
}
```

---

## 4. API Gateway Integration

### File: `src/stacks/constructs/ExecutionInfrastructure.ts` (Phase 4.4 Additions)

**Purpose:** Add execution status API to API Gateway

**Alignment with 4.1–4.3:** `ExecutionInfrastructureProps` does not currently include `apiGateway`. Add optional `apiGateway` and/or **reusable resources** to avoid duplicate routes when other constructs also add `executions` / `accounts` under root.

**Resource reuse (mandatory):** Calling `props.apiGateway.root.addResource('executions')` and `addResource('accounts')` will **conflict** if another construct already created them (can throw). **Fix (pick one):** (a) **Require parent to pass resources** — when `apiGateway` is set, require `executionsResource` and `accountsResource` as props and do not fall back to `addResource` (best; parent stack owns the tree). (b) **Find-or-create** — use `api.root.node.tryFindChild('executions')` (or equivalent) and only call `addResource` if not found. Prefer (a).

**Phase 4.4 Additions:**

```typescript
// Add import
import * as apigateway from 'aws-cdk-lib/aws-apigateway';

// Add to ExecutionInfrastructureProps
export interface ExecutionInfrastructureProps {
  // ... existing props ...
  readonly apiGateway?: apigateway.RestApi;
  /** JWT authorizer for execution status API (Cognito or Lambda authorizer). Required for zero-trust auth. */
  readonly executionStatusAuthorizer?: apigateway.IAuthorizer;
  /** Required when apiGateway is set. Parent stack must create and pass these to avoid duplicate addResource. */
  readonly executionsResource?: apigateway.IResource;
  readonly accountsResource?: apigateway.IResource;
}

// Add to ExecutionInfrastructure class
public readonly executionStatusApiHandler: lambda.Function;
public readonly executionStatusApiResource?: apigateway.Resource;

private createExecutionStatusAPI(
  props: ExecutionInfrastructureProps,
  config: ExecutionInfrastructureConfig
): void {
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
    },
  });

  this.executionOutcomesTable.grantReadData(this.executionStatusApiHandler);
  this.executionAttemptsTable.grantReadData(this.executionStatusApiHandler);
  props.actionIntentTable.grantReadData(this.executionStatusApiHandler);

  if (!props.apiGateway) return;

  // Require parent to pass resources (no addResource fallback — avoids duplicate routes if another construct created them).
  if (!props.executionsResource || !props.accountsResource) {
    throw new Error('When apiGateway is set, executionsResource and accountsResource must be provided by the parent stack. Do not call addResource here to avoid route collisions.');
  }
  const executionsResource = props.executionsResource;
  const accountsResource = props.accountsResource;

  const statusResource = executionsResource.addResource('{action_intent_id}').addResource('status');
  statusResource.addMethod('GET', new apigateway.LambdaIntegration(this.executionStatusApiHandler), {
    authorizer: props.executionStatusAuthorizer,
  });

  const accountExecutionsResource = accountsResource.addResource('{account_id}').addResource('executions');
  accountExecutionsResource.addMethod('GET', new apigateway.LambdaIntegration(this.executionStatusApiHandler), {
    authorizer: props.executionStatusAuthorizer,
  });
}
```

**Auth:** Add `executionStatusAuthorizer?: apigateway.IAuthorizer` to props and attach it to both GET methods so the status API is behind JWT (Cognito or Lambda authorizer).

---

## 5. Testing

### End-to-End Tests

**Files to Create:**
- `src/tests/integration/execution/end-to-end-execution.test.ts` - Full execution flow
- `src/tests/integration/execution/execution-status-api.test.ts` - Status API tests

---

## 6. Implementation Checklist

**Signal emission**
- [ ] Extend SignalService with `createExecutionSignal()` (no lifecycle state; no accounts table).
- [ ] Add shared helper `buildExecutionOutcomeSignal(outcome, intent, trace_id, now)` (e.g. in `src/utils/execution-signal-helpers.ts` or under perception).
- [ ] Wire signal emission in execution-recorder-handler after outcome + attempt + ledger; use EventPublisher + SignalService.createExecutionSignal + buildExecutionOutcomeSignal.
- [ ] ~~Verify SignalType enum~~ — **Already in SignalTypes.ts (4.1–4.3)**

**Status API**
- [ ] Create execution status API handler with **JWT auth** (derive tenantId from authorizer claims; validate account access).
- [ ] **404 rule:** If intent == null && attempt == null && outcome == null → return 404 (not PENDING/EXPIRED).
- [ ] **Pagination:** Extend ExecutionOutcomeService.listOutcomes to accept nextToken and return `{ items, nextToken }`; add next_token query/response to list endpoint.
- [ ] **AWS_REGION:** Do not use requireEnv for region; use process.env.AWS_REGION with a runtime-specific error message if missing.
- [ ] Add execution status API Lambda; API Gateway integration with **reuse** of executionsResource/accountsResource (or accept as props); attach **JWT authorizer** to GET methods.

**Alarms**
- [ ] CloudWatch alarms: period (e.g. 5 min), statistic (Sum); add Lambda error alarms for tool-invoker, execution-recorder, execution-failure-recorder (optional: adapters).

**Other**
- [x] Verify S3 bucket setup (from Phase 4.2). Bucket created/used in ExecutionInfrastructure; tool-invoker has EXECUTION_ARTIFACTS_BUCKET and grantWrite; recorder receives raw_response_artifact_ref only (no S3 env).
- [ ] End-to-end tests.

---

## 7. Next Steps

After Phase 4.4 completion:
- ✅ Safety controls and outcome visibility complete
- ⏳ Proceed to Phase 4.5 (Testing & Polish) - Complete test coverage, documentation, performance testing

---

**See:** `PHASE_4_CODE_LEVEL_PLAN.md` for complete Phase 4 overview and cross-references.

---

## Appendix A: Comparison with Current Implementation

This appendix compares the Phase 4.4 doc with the **current codebase** for accuracy and completeness. Use it to avoid drift when implementing.

### 1. Signal emission (§1)

| Doc says | Current implementation | Accuracy / completeness |
|----------|------------------------|--------------------------|
| Add signal emission **after** outcome + attempt + ledger in execution-recorder-handler | Recorder has outcome + attempt + ledger; **no** SignalService or signal emission. Comment at ~line 204: "Signal emission for Phase 1 perception layer is implemented in Phase 4.4" | ✅ Doc accurate. **Not implemented.** |
| Extend SignalService with `createExecutionSignal()` (no lifecycle, no accounts table) | SignalService has only `createSignal(signal: Signal)`; requires LifecycleStateService and accounts table. **No** `createExecutionSignal` | ✅ Doc accurate. **Not implemented.** |
| Shared helper `buildExecutionOutcomeSignal(outcome, intent, trace_id, now)` | **No** such helper in `src/utils/` or perception. Only `src/utils/aws-client-config.ts` exists | ✅ Doc accurate. **Not implemented.** |
| Recorder env: add SIGNALS_TABLE_NAME, EVENT_BUS_NAME | Recorder Lambda env (ExecutionInfrastructure) has only EXECUTION_OUTCOMES_TABLE_NAME, EXECUTION_ATTEMPTS_TABLE_NAME, ACTION_INTENT_TABLE_NAME, LEDGER_TABLE_NAME. **No** SIGNALS_TABLE_NAME or EVENT_BUS_NAME | ✅ Doc accurate. **Not implemented.** ExecutionInfrastructure already has `props.eventBus`; use `props.eventBus.eventBusName` for EVENT_BUS_NAME when adding. |
| SignalTypes.ts ACTION_EXECUTED, ACTION_FAILED, WINDOW_KEY_DERIVATION, DEFAULT_SIGNAL_TTL | Present in `src/types/SignalTypes.ts` | ✅ Doc accurate. **Already implemented.** |
| EventPublisher(logger, eventBusName, region) | Constructor in `src/services/events/EventPublisher.ts` is `(logger, eventBusName, region?)` | ✅ Doc accurate. |

### 2. Execution status API (§2)

| Doc says | Current implementation | Accuracy / completeness |
|----------|------------------------|--------------------------|
| New handler `execution-status-api-handler.ts` | **File does not exist.** Handlers under `src/handlers/phase4/` do not include it | ✅ Doc accurate. **Not implemented.** |
| JWT authorizer; tenantId from claims; accountIds validation; 404 when intent+attempt+outcome all null; pagination next_token | N/A (handler not implemented) | Doc is the spec. |
| ExecutionOutcomeService.listOutcomes(tenantId, accountId, limit, nextToken?) → { items, nextToken } | `ExecutionOutcomeService.listOutcomes(tenantId, accountId, limit = 50)` returns `Promise<ActionOutcomeV1[]>`; **no** nextToken param or return shape | ⚠️ **Gap:** Doc requires extending listOutcomes. Current signature does not match. |
| ExecutionAttemptService.getAttempt(actionIntentId, tenantId, accountId) | Exists with that signature in `ExecutionAttemptService.ts` | ✅ Doc accurate. |
| ActionIntentService.getIntent(intentId, tenantId, accountId) | Exists as `getIntent(intentId, tenantId, accountId)` in `ActionIntentService.ts` | ✅ Doc accurate. |
| ExecutionStatus type (status, started_at, completed_at, …) | Defined in `src/types/ExecutionTypes.ts` with status, started_at, completed_at, external_object_refs, error_message, error_class, attempt_count | ✅ Doc accurate. |
| ExecutionAttempt.started_at | ExecutionAttempt interface has `started_at: string` in ExecutionTypes.ts | ✅ Doc accurate. |

### 3. CloudWatch alarms (§3)

| Doc says | Current implementation | Accuracy / completeness |
|----------|------------------------|--------------------------|
| createCloudWatchAlarms(); period/statistic on metric; Lambda error alarms for toolInvoker, executionRecorder, executionFailureRecorder | **No** createCloudWatchAlarms in ExecutionInfrastructure. **No** cloudwatch import or alarms | ✅ Doc accurate. **Not implemented.** |
| this.executionStateMachine, this.toolInvokerHandler, this.executionRecorderHandler, this.executionFailureRecorderHandler | All exist on ExecutionInfrastructure | ✅ Doc accurate. |

### 4. API Gateway integration (§4)

| Doc says | Current implementation | Accuracy / completeness |
|----------|------------------------|--------------------------|
| Props: apiGateway?, executionStatusAuthorizer?, executionsResource?, accountsResource? | ExecutionInfrastructureProps has **none** of these. No apigateway import | ✅ Doc accurate. **Not implemented.** |
| When apiGateway set, require executionsResource and accountsResource (no addResource fallback) | N/A | Doc is the spec. |
| executionStatusApiHandler Lambda; entry execution-status-api-handler.ts | **No** executionStatusApiHandler on construct. Config has `functionNames.executionStatusApi` and timeout/memorySize | ✅ Doc accurate. **Not implemented.** |

### 5. Config and infrastructure

| Doc says | Current implementation | Accuracy / completeness |
|----------|------------------------|--------------------------|
| ExecutionInfrastructureConfig: executionStatusApi, timeout.executionStatusApi, memorySize?.executionStatusApi | All present in `ExecutionInfrastructureConfig.ts` | ✅ Doc accurate. |
| executionStateMachine, executionAttemptsTable, executionOutcomesTable, actionIntentTable | All exist on ExecutionInfrastructure / props | ✅ Doc accurate. |
| S3 bucket (Phase 4.2) | executionArtifactsBucket created in ExecutionInfrastructure if !props.artifactsBucket | ✅ Doc accurate. |

### 6. Testing (§5)

| Doc says | Current implementation | Accuracy / completeness |
|----------|------------------------|--------------------------|
| Create `src/tests/integration/execution/end-to-end-execution.test.ts`, `execution-status-api.test.ts` | **No** `src/tests/integration/execution/` directory. Integration tests exist only as methodology.test.ts, phase0.test.ts, phase2.test.ts | ✅ Doc accurate. **Not implemented.** |

### 7. Recorder: AWS_REGION

| Doc says | Current implementation | Accuracy / completeness |
|----------|------------------------|--------------------------|
| (Status API) Do not use requireEnv for AWS_REGION; use process.env + runtime-specific message | Status API not implemented. **Recorder** currently uses `requireEnv('AWS_REGION', 'ExecutionRecorderHandler')` | Doc applies to **status API** only. Recorder can keep requireEnv for region unless you standardize later. |

### 8. Event bus for signal emission

| Doc says | Current implementation | Accuracy / completeness |
|----------|------------------------|--------------------------|
| EVENT_BUS_NAME for EventPublisher in recorder | ExecutionInfrastructure receives `props.eventBus` (EventBus); other constructs pass `EVENT_BUS_NAME: props.eventBus.eventBusName` to Lambdas. Recorder does **not** currently get EVENT_BUS_NAME | ✅ When implementing §1, add EVENT_BUS_NAME to recorder env from `props.eventBus.eventBusName` and grant eventBus.grantPutEventsTo(handler) if SignalService/EventPublisher publish to EventBridge. |

### Summary

- **Accurate:** Doc matches existing types, services (getOutcome, getAttempt, getIntent), config, ExecutionInfrastructure shape, SignalTypes, EventPublisher, LedgerService, and placement of signal emission in the recorder. No contradictions found.
- **Gaps (to implement):** (1) SignalService.createExecutionSignal + buildExecutionOutcomeSignal + recorder wiring; (2) execution-status-api-handler.ts + JWT auth, 404, pagination; (3) ExecutionOutcomeService.listOutcomes extended with nextToken; (4) CloudWatch alarms; (5) API Gateway props + executionStatusApiHandler Lambda + resource reuse; (6) integration tests under `execution/`.
- **Completeness:** Doc does not reference any removed or renamed files. One implementation detail: API Gateway path parameter keys may be lowercased by the runtime (e.g. `action_intent_id` might appear as `action_intent_id` or in lowercase); the handler should read from `event.pathParameters` using the same key as in the API Gateway resource definition.
