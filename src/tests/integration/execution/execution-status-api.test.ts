/**
 * Phase 4.4 — Execution Status API Integration Tests
 *
 * Invokes the Execution Status API handler directly with real DynamoDB tables.
 * Requires deployed stack and env (EXECUTION_OUTCOMES_TABLE_NAME, etc.) from .env.
 *
 * Skip only when explicitly requested: SKIP_EXECUTION_STATUS_API_INTEGRATION=1.
 * If required env is missing and skip is not set, the suite fails (run ./deploy or set the skip flag).
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { getAWSClientConfig } from '../../../utils/aws-client-config';
import { ExecutionOutcomeService } from '../../../services/execution/ExecutionOutcomeService';
import { Logger } from '../../../services/core/Logger';
import { ActionIntentV1 } from '../../../types/DecisionTypes';

const loadEnv = (): void => {
  try {
    require('dotenv').config({ path: '.env.local' });
    require('dotenv').config({ path: '.env' });
  } catch {
    // dotenv not available
  }
};

loadEnv();

const requiredEnvVars = [
  'EXECUTION_OUTCOMES_TABLE_NAME',
  'EXECUTION_ATTEMPTS_TABLE_NAME',
  'ACTION_INTENT_TABLE_NAME',
];
const hasRequiredEnv = requiredEnvVars.every((name) => process.env[name]);
const skipIntegration = process.env.SKIP_EXECUTION_STATUS_API_INTEGRATION === '1';

const region = process.env.AWS_REGION || 'us-west-2';
const outcomesTable = process.env.EXECUTION_OUTCOMES_TABLE_NAME || 'cc-native-execution-outcomes';
const attemptsTable = process.env.EXECUTION_ATTEMPTS_TABLE_NAME || 'cc-native-execution-attempts';
const intentTable = process.env.ACTION_INTENT_TABLE_NAME || 'cc-native-action-intent';

const testTenantId = `test-tenant-exec-status-${Date.now()}`;
const testAccountId = `test-account-exec-status-${Date.now()}`;

function makeClaims(tenantId: string, accountIds?: string[]): Record<string, string> {
  const claims: Record<string, string> = { 'custom:tenant_id': tenantId };
  if (accountIds !== undefined) {
    claims['custom:account_ids'] = JSON.stringify(accountIds);
  }
  return claims;
}

function createStatusEvent(options: {
  httpMethod: string;
  pathParameters?: Record<string, string>;
  queryStringParameters?: Record<string, string>;
  authorizer?: { claims: Record<string, string> };
  resource?: string;
  path?: string;
}): APIGatewayProxyEvent {
  const {
    httpMethod,
    pathParameters,
    queryStringParameters,
    authorizer,
    resource = '/executions/xxx/status',
    path = '/executions/xxx/status',
  } = options;
  return {
    httpMethod,
    path,
    resource,
    pathParameters: pathParameters || null,
    queryStringParameters: queryStringParameters || null,
    requestContext: {
      authorizer: authorizer ? { claims: authorizer.claims } : undefined,
    },
  } as unknown as APIGatewayProxyEvent;
}

function createListEvent(options: {
  httpMethod: string;
  pathParameters?: Record<string, string>;
  queryStringParameters?: Record<string, string>;
  authorizer?: { claims: Record<string, string> };
  resource?: string;
  path?: string;
}): APIGatewayProxyEvent {
  const {
    httpMethod,
    pathParameters,
    queryStringParameters,
    authorizer,
    resource = '/accounts/xxx/executions',
    path = '/accounts/xxx/executions',
  } = options;
  return {
    httpMethod,
    path,
    resource,
    pathParameters: pathParameters || null,
    queryStringParameters: queryStringParameters || null,
    requestContext: {
      authorizer: authorizer ? { claims: authorizer.claims } : undefined,
    },
  } as unknown as APIGatewayProxyEvent;
}

(skipIntegration ? describe.skip : describe)(
  'Execution Status API Integration Tests',
  () => {
  let invoke: (event: APIGatewayProxyEvent) => Promise<APIGatewayProxyResult>;
  let dynamoClient: DynamoDBDocumentClient;
  let outcomeService: ExecutionOutcomeService;
  const logger = new Logger('ExecutionStatusAPIIntegrationTest');

  beforeAll(async () => {
    if (!hasRequiredEnv) {
      const missing = requiredEnvVars.filter((name) => !process.env[name]);
      throw new Error(
        `[Execution Status API integration] Missing required env: ${missing.join(', ')}. ` +
          'Set them (e.g. run ./deploy to write .env) or set SKIP_EXECUTION_STATUS_API_INTEGRATION=1 to skip this suite.'
      );
    }
    const mod = await import('../../../handlers/phase4/execution-status-api-handler');
    invoke = (mod.handler as (e: APIGatewayProxyEvent) => Promise<APIGatewayProxyResult>);

    const clientConfig = getAWSClientConfig(region);
    const baseClient = new DynamoDBClient(clientConfig);
    dynamoClient = DynamoDBDocumentClient.from(baseClient, {
      marshallOptions: { removeUndefinedValues: true },
    });
    outcomeService = new ExecutionOutcomeService(
      dynamoClient,
      outcomesTable,
      logger
    );
  });

  it.each([
    ['no auth', undefined],
    ['invalid auth', { claims: {} }],
  ])('GET /executions/{id}/status — %s → 401', async (_, authorizer) => {
    const event = createStatusEvent({
      httpMethod: 'GET',
      pathParameters: { action_intent_id: 'ai_fake_123' },
      queryStringParameters: { account_id: testAccountId },
      authorizer: authorizer as { claims: Record<string, string> } | undefined,
      resource: '/executions/ai_fake_123/status',
      path: '/executions/ai_fake_123/status',
    });
    const result = await invoke(event);
    expect(result.statusCode).toBe(401);
    const body = JSON.parse(result.body || '{}');
    expect(body.error).toBe('Unauthorized');
  });

  it('GET /executions/{id}/status — missing account_id → 400', async () => {
    const event = createStatusEvent({
      httpMethod: 'GET',
      pathParameters: { action_intent_id: 'ai_fake_123' },
      queryStringParameters: undefined,
      authorizer: { claims: makeClaims(testTenantId) },
      resource: '/executions/ai_fake_123/status',
      path: '/executions/ai_fake_123/status',
    });
    const result = await invoke(event);
    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body || '{}');
    expect(body.error).toContain('action_intent_id');
    expect(body.error).toContain('account_id');
  });

  it('GET /executions/{id}/status — not found → 404', async () => {
    const event = createStatusEvent({
      httpMethod: 'GET',
      pathParameters: { action_intent_id: 'ai_nonexistent_999' },
      queryStringParameters: { account_id: testAccountId },
      authorizer: { claims: makeClaims(testTenantId) },
      resource: '/executions/ai_nonexistent_999/status',
      path: '/executions/ai_nonexistent_999/status',
    });
    const result = await invoke(event);
    expect(result.statusCode).toBe(404);
    const body = JSON.parse(result.body || '{}');
    expect(body.error).toBe('Execution not found');
  });

  it('GET /executions/{id}/status — outcome wins over attempt → 200 SUCCEEDED', async () => {
    const actionIntentId = `ai_outcome_wins_${Date.now()}`;
    const now = new Date().toISOString();
    const pk = `TENANT#${testTenantId}#ACCOUNT#${testAccountId}`;

    await outcomeService.recordOutcome({
      action_intent_id: actionIntentId,
      tenant_id: testTenantId,
      account_id: testAccountId,
      status: 'SUCCEEDED',
      external_object_refs: [],
      attempt_count: 1,
      tool_name: 'crm.create_task',
      tool_schema_version: 'v1.0',
      registry_version: 1,
      tool_run_ref: 'run_1',
      started_at: now,
      completed_at: now,
      compensation_status: 'NONE',
      trace_id: 'trace_1',
    });

    await dynamoClient.send(
      new PutCommand({
        TableName: attemptsTable,
        Item: {
          pk,
          sk: `EXECUTION#${actionIntentId}`,
          gsi1pk: `ACTION_INTENT#${actionIntentId}`,
          gsi1sk: `UPDATED_AT#${now}`,
          gsi2pk: `TENANT#${testTenantId}`,
          gsi2sk: `UPDATED_AT#${now}`,
          action_intent_id: actionIntentId,
          attempt_count: 1,
          last_attempt_id: 'attempt_1',
          status: 'RUNNING',
          idempotency_key: 'key1',
          started_at: now,
          updated_at: now,
          tenant_id: testTenantId,
          account_id: testAccountId,
          trace_id: 'trace_1',
        },
      })
    );

    const event = createStatusEvent({
      httpMethod: 'GET',
      pathParameters: { action_intent_id: actionIntentId },
      queryStringParameters: { account_id: testAccountId },
      authorizer: { claims: makeClaims(testTenantId) },
      resource: `/executions/${actionIntentId}/status`,
      path: `/executions/${actionIntentId}/status`,
    });
    const result = await invoke(event);
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body || '{}');
    expect(body.status).toBe('SUCCEEDED');
    expect(body.action_intent_id).toBe(actionIntentId);
  });

  it('GET /executions/{id}/status — only intent, not expired → 200 PENDING', async () => {
    const actionIntentId = `ai_pending_${Date.now()}`;
    const futureEpoch = Math.floor(Date.now() / 1000) + 3600;
    const expiresAt = new Date((futureEpoch + 3600) * 1000).toISOString();
    const pk = `TENANT#${testTenantId}#ACCOUNT#${testAccountId}`;
    const sk = `ACTION_INTENT#${actionIntentId}`;

    const intent: ActionIntentV1 = {
      action_intent_id: actionIntentId,
      action_type: 'CREATE_INTERNAL_NOTE',
      target: { entity_type: 'ACCOUNT', entity_id: testAccountId },
      parameters: {},
      approved_by: 'test-user',
      approval_timestamp: new Date().toISOString(),
      execution_policy: { retry_count: 3, timeout_seconds: 300, max_attempts: 1 },
      expires_at: expiresAt,
      expires_at_epoch: futureEpoch,
      original_decision_id: 'dec_1',
      original_proposal_id: 'dec_1',
      edited_fields: [],
      tenant_id: testTenantId,
      account_id: testAccountId,
      trace_id: 'trace_1',
      registry_version: 1,
    };

    await dynamoClient.send(
      new PutCommand({
        TableName: intentTable,
        Item: { ...intent, pk, sk },
      })
    );

    const event = createStatusEvent({
      httpMethod: 'GET',
      pathParameters: { action_intent_id: actionIntentId },
      queryStringParameters: { account_id: testAccountId },
      authorizer: { claims: makeClaims(testTenantId) },
      resource: `/executions/${actionIntentId}/status`,
      path: `/executions/${actionIntentId}/status`,
    });
    const result = await invoke(event);
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body || '{}');
    expect(body.status).toBe('PENDING');
    expect(body.action_intent_id).toBe(actionIntentId);
  });

  it('GET /executions/{id}/status — only intent, expired → 200 EXPIRED', async () => {
    const actionIntentId = `ai_expired_${Date.now()}`;
    // Expire 1s ago so intent is logically expired but TTL is less likely to have deleted it yet
    // (table TTL on expires_at_epoch can remove items soon after they expire)
    const pastEpoch = Math.floor(Date.now() / 1000) - 1;
    const expiresAt = new Date(pastEpoch * 1000).toISOString();
    const pk = `TENANT#${testTenantId}#ACCOUNT#${testAccountId}`;
    const sk = `ACTION_INTENT#${actionIntentId}`;

    const intent: ActionIntentV1 = {
      action_intent_id: actionIntentId,
      action_type: 'CREATE_INTERNAL_NOTE',
      target: { entity_type: 'ACCOUNT', entity_id: testAccountId },
      parameters: {},
      approved_by: 'test-user',
      approval_timestamp: new Date().toISOString(),
      execution_policy: { retry_count: 3, timeout_seconds: 300, max_attempts: 1 },
      expires_at: expiresAt,
      expires_at_epoch: pastEpoch,
      original_decision_id: 'dec_1',
      original_proposal_id: 'dec_1',
      edited_fields: [],
      tenant_id: testTenantId,
      account_id: testAccountId,
      trace_id: 'trace_1',
      registry_version: 1,
    };

    await dynamoClient.send(
      new PutCommand({
        TableName: intentTable,
        Item: { ...intent, pk, sk },
      })
    );

    const event = createStatusEvent({
      httpMethod: 'GET',
      pathParameters: { action_intent_id: actionIntentId },
      queryStringParameters: { account_id: testAccountId },
      authorizer: { claims: makeClaims(testTenantId) },
      resource: `/executions/${actionIntentId}/status`,
      path: `/executions/${actionIntentId}/status`,
    });
    const result = await invoke(event);
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body || '{}');
    expect(body.status).toBe('EXPIRED');
  });

  it('GET /accounts/{account_id}/executions — list and pagination', async () => {
    const baseId = `ai_list_${Date.now()}`;
    const now = new Date().toISOString();
    for (let i = 0; i < 3; i++) {
      await outcomeService.recordOutcome({
        action_intent_id: `${baseId}_${i}`,
        tenant_id: testTenantId,
        account_id: testAccountId,
        status: 'SUCCEEDED',
        external_object_refs: [],
        attempt_count: 1,
        tool_name: 'crm.create_task',
        tool_schema_version: 'v1.0',
        registry_version: 1,
        tool_run_ref: `run_${i}`,
        started_at: now,
        completed_at: now,
        compensation_status: 'NONE',
        trace_id: `trace_${i}`,
      });
    }

    const event = createListEvent({
      httpMethod: 'GET',
      pathParameters: { account_id: testAccountId },
      queryStringParameters: { limit: '2' },
      authorizer: { claims: makeClaims(testTenantId) },
      resource: `/accounts/${testAccountId}/executions`,
      path: `/accounts/${testAccountId}/executions`,
    });
    const result = await invoke(event);
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body || '{}');
    expect(Array.isArray(body.executions)).toBe(true);
    expect(body.executions.length).toBeLessThanOrEqual(2);
    if (body.executions.length === 2) {
      expect(body.next_token).toBeDefined();
    }
  });

  it.each([
    ['limit=0', '0'],
    ['limit=101', '101'],
  ])('GET /accounts/{account_id}/executions — invalid limit %s → 400', async (_, limitVal) => {
    const event = createListEvent({
      httpMethod: 'GET',
      pathParameters: { account_id: testAccountId },
      queryStringParameters: { limit: limitVal },
      authorizer: { claims: makeClaims(testTenantId) },
      resource: `/accounts/${testAccountId}/executions`,
      path: `/accounts/${testAccountId}/executions`,
    });
    const result = await invoke(event);
    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body || '{}');
    expect(body.error).toContain('limit');
  });

  it('OPTIONS — CORS 200 and headers', async () => {
    const event = createStatusEvent({
      httpMethod: 'OPTIONS',
      resource: '/executions/xxx/status',
      path: '/executions/xxx/status',
    });
    const result = await invoke(event);
    expect(result.statusCode).toBe(200);
    expect(result.headers?.['Access-Control-Allow-Origin']).toBe('*');
    expect(result.headers?.['Access-Control-Allow-Methods']).toContain('GET');
  });
});
