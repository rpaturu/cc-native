/**
 * ExecutionStatusAPIHandler Unit Tests - Phase 4.4
 *
 * Tests routing, auth, params, status mapping (RETRYING->RUNNING), and error paths.
 */

process.env.AWS_REGION = 'us-west-2';
process.env.EXECUTION_OUTCOMES_TABLE_NAME = 'test-execution-outcomes';
process.env.EXECUTION_ATTEMPTS_TABLE_NAME = 'test-execution-attempts';
process.env.ACTION_INTENT_TABLE_NAME = 'test-action-intent';

const mockGetOutcome = jest.fn();
const mockListOutcomes = jest.fn();
const mockGetAttempt = jest.fn();
const mockGetIntent = jest.fn();

jest.mock('../../../../services/core/Logger');
jest.mock('../../../../utils/aws-client-config', () => ({
  getAWSClientConfig: jest.fn(() => ({})),
}));
jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(),
}));
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn(() => ({})) },
}));
jest.mock('../../../../services/execution/ExecutionOutcomeService', () => ({
  ExecutionOutcomeService: jest.fn().mockImplementation(() => ({
    getOutcome: mockGetOutcome,
    listOutcomes: mockListOutcomes,
  })),
}));
jest.mock('../../../../services/execution/ExecutionAttemptService', () => ({
  ExecutionAttemptService: jest.fn().mockImplementation(() => ({
    getAttempt: mockGetAttempt,
  })),
}));
jest.mock('../../../../services/decision/ActionIntentService', () => ({
  ActionIntentService: jest.fn().mockImplementation(() => ({
    getIntent: mockGetIntent,
  })),
}));

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { handler } from '../../../../handlers/phase4/execution-status-api-handler';

/** Handler may be typed with callback; we always await and get a result. */
async function invokeHandler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  return (await handler(event, {} as any, () => {})) as APIGatewayProxyResult;
}

function authClaims(tenantId: string, accountIds?: string[]): Record<string, string> {
  const claims: Record<string, string> = { 'custom:tenant_id': tenantId };
  if (accountIds !== undefined) {
    claims['custom:account_ids'] = JSON.stringify(accountIds);
  }
  return claims;
}

function createEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return {
    httpMethod: 'GET',
    path: '/executions/ai_123/status',
    resource: '/executions/{action_intent_id}/status',
    pathParameters: { action_intent_id: 'ai_123' },
    queryStringParameters: { account_id: 'acc_1' },
    requestContext: {
      authorizer: { claims: authClaims('tenant_1') },
    },
    ...overrides,
  } as unknown as APIGatewayProxyEvent;
}

describe('ExecutionStatusAPIHandler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('routing', () => {
    it('returns 200 for OPTIONS (CORS)', async () => {
      const event = createEvent({ httpMethod: 'OPTIONS' });
      const res = await invokeHandler(event);
      expect(res.statusCode).toBe(200);
      expect(res.headers?.['Access-Control-Allow-Origin']).toBe('*');
    });

    it('returns 404 for unknown route', async () => {
      const event = createEvent({
        httpMethod: 'GET',
        path: '/unknown',
        resource: '/unknown',
        pathParameters: null,
      });
      const res = await invokeHandler(event);
      expect(res.statusCode).toBe(404);
      const body = JSON.parse(res.body || '{}');
      expect(body.error).toBe('Not found');
    });
  });

  describe('GET /executions/{action_intent_id}/status', () => {
    it('returns 401 when authorizer has no claims', async () => {
      const event = createEvent({
        requestContext: { authorizer: undefined },
      } as any);
      const res = await invokeHandler(event);
      expect(res.statusCode).toBe(401);
      expect(JSON.parse(res.body || '{}').error).toBe('Unauthorized');
    });

    it('returns 400 when account_id missing (query param)', async () => {
      const noAccount = createEvent({
        pathParameters: { action_intent_id: 'ai_123' },
        queryStringParameters: null,
      });
      const res = await invokeHandler(noAccount);
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body || '{}').error).toContain('action_intent_id');
      expect(JSON.parse(res.body || '{}').error).toContain('account_id');
    });

    it('returns 404 when pathParameters missing (route not matched)', async () => {
      const noIntent = createEvent({
        pathParameters: null,
        queryStringParameters: { account_id: 'acc_1' },
      });
      const res = await invokeHandler(noIntent);
      expect(res.statusCode).toBe(404);
    });

    it('returns 403 when account_id not in authorizer account_ids', async () => {
      const event = createEvent({
        queryStringParameters: { account_id: 'other_account' },
        requestContext: {
          authorizer: { claims: authClaims('tenant_1', ['acc_1']) },
        },
      } as any);
      const res = await invokeHandler(event);
      expect(res.statusCode).toBe(403);
      expect(JSON.parse(res.body || '{}').error).toBe('Forbidden');
    });

    it('returns 404 when outcome, attempt, and intent are all null', async () => {
      mockGetOutcome.mockResolvedValue(null);
      mockGetAttempt.mockResolvedValue(null);
      mockGetIntent.mockResolvedValue(null);
      const event = createEvent();
      const res = await invokeHandler(event);
      expect(res.statusCode).toBe(404);
      expect(JSON.parse(res.body || '{}').error).toBe('Execution not found');
    });

    it('returns 200 with status from outcome (SUCCEEDED)', async () => {
      mockGetOutcome.mockResolvedValue({
        action_intent_id: 'ai_123',
        status: 'SUCCEEDED',
        started_at: '2026-01-01T00:00:00Z',
        completed_at: '2026-01-01T00:01:00Z',
        attempt_count: 1,
      });
      mockGetAttempt.mockResolvedValue(null);
      mockGetIntent.mockResolvedValue(null);
      const event = createEvent();
      const res = await invokeHandler(event);
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body || '{}');
      expect(body.action_intent_id).toBe('ai_123');
      expect(body.status).toBe('SUCCEEDED');
      expect(body.started_at).toBe('2026-01-01T00:00:00Z');
      expect(body.completed_at).toBe('2026-01-01T00:01:00Z');
    });

    it('maps RETRYING to RUNNING in response status', async () => {
      mockGetOutcome.mockResolvedValue({
        action_intent_id: 'ai_123',
        status: 'RETRYING',
        started_at: '2026-01-01T00:00:00Z',
        attempt_count: 2,
      });
      mockGetAttempt.mockResolvedValue(null);
      mockGetIntent.mockResolvedValue(null);
      const event = createEvent();
      const res = await invokeHandler(event);
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body || '{}').status).toBe('RUNNING');
    });

    it('returns 200 with RUNNING when only attempt exists', async () => {
      mockGetOutcome.mockResolvedValue(null);
      mockGetAttempt.mockResolvedValue({
        action_intent_id: 'ai_123',
        status: 'RUNNING',
        started_at: '2026-01-01T00:00:00Z',
      });
      mockGetIntent.mockResolvedValue(null);
      const event = createEvent();
      const res = await invokeHandler(event);
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body || '{}').status).toBe('RUNNING');
    });

    it('returns 200 with EXPIRED when only intent exists and expired', async () => {
      mockGetOutcome.mockResolvedValue(null);
      mockGetAttempt.mockResolvedValue(null);
      mockGetIntent.mockResolvedValue({
        action_intent_id: 'ai_123',
        expires_at_epoch: Math.floor(Date.now() / 1000) - 60,
      });
      const event = createEvent();
      const res = await invokeHandler(event);
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body || '{}').status).toBe('EXPIRED');
    });

    it('returns 200 with PENDING when only intent exists and not expired', async () => {
      mockGetOutcome.mockResolvedValue(null);
      mockGetAttempt.mockResolvedValue(null);
      mockGetIntent.mockResolvedValue({
        action_intent_id: 'ai_123',
        expires_at_epoch: Math.floor(Date.now() / 1000) + 3600,
      });
      const event = createEvent();
      const res = await invokeHandler(event);
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body || '{}').status).toBe('PENDING');
    });

    it('returns 500 when getOutcome throws', async () => {
      mockGetOutcome.mockRejectedValue(new Error('DynamoDB error'));
      mockGetAttempt.mockResolvedValue(null);
      mockGetIntent.mockResolvedValue(null);
      const event = createEvent();
      const res = await invokeHandler(event);
      expect(res.statusCode).toBe(500);
      expect(JSON.parse(res.body || '{}').error).toBe('Internal server error');
    });
  });

  describe('GET /accounts/{account_id}/executions', () => {
    function createListEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
      return {
        httpMethod: 'GET',
        path: '/accounts/acc_1/executions',
        resource: '/accounts/{account_id}/executions',
        pathParameters: { account_id: 'acc_1' },
        queryStringParameters: null,
        requestContext: { authorizer: { claims: authClaims('tenant_1') } },
        ...overrides,
      } as unknown as APIGatewayProxyEvent;
    }

    it('returns 401 when authorizer has no claims', async () => {
      const event = createListEvent({
        requestContext: { authorizer: undefined },
      } as any);
      const res = await invokeHandler(event);
      expect(res.statusCode).toBe(401);
    });

    it('returns 404 when pathParameters missing (route not matched)', async () => {
      const event = createListEvent({ pathParameters: null });
      const res = await invokeHandler(event);
      expect(res.statusCode).toBe(404);
    });

    it('returns 403 when account_id not in authorizer account_ids', async () => {
      const event = createListEvent({
        pathParameters: { account_id: 'other' },
        requestContext: {
          authorizer: { claims: authClaims('tenant_1', ['acc_1']) },
        },
      } as any);
      const res = await invokeHandler(event);
      expect(res.statusCode).toBe(403);
    });

    it('returns 400 for invalid limit (non-numeric)', async () => {
      mockListOutcomes.mockResolvedValue({ items: [], nextToken: undefined });
      const event = createListEvent({
        queryStringParameters: { limit: 'abc' },
      });
      const res = await invokeHandler(event);
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body || '{}').error).toBe('Invalid limit parameter');
    });

    it('returns 400 for limit out of range', async () => {
      const event = createListEvent({
        queryStringParameters: { limit: '0' },
      });
      const res = await invokeHandler(event);
      expect(res.statusCode).toBe(400);
    });

    it('returns 200 with executions and next_token', async () => {
      mockListOutcomes.mockResolvedValue({
        items: [
          {
            action_intent_id: 'ai_1',
            status: 'SUCCEEDED',
            started_at: '2026-01-01T00:00:00Z',
            completed_at: '2026-01-01T00:01:00Z',
            attempt_count: 1,
          },
        ],
        nextToken: 'token_abc',
      });
      const event = createListEvent();
      const res = await invokeHandler(event);
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body || '{}');
      expect(body.executions).toHaveLength(1);
      expect(body.executions[0].action_intent_id).toBe('ai_1');
      expect(body.executions[0].status).toBe('SUCCEEDED');
      expect(body.next_token).toBe('token_abc');
      expect(mockListOutcomes).toHaveBeenCalledWith('tenant_1', 'acc_1', 50, undefined);
    });

    it('passes limit and next_token to listOutcomes', async () => {
      mockListOutcomes.mockResolvedValue({ items: [], nextToken: undefined });
      const event = createListEvent({
        queryStringParameters: { limit: '10', next_token: 'prev' },
      });
      await invokeHandler(event);
      expect(mockListOutcomes).toHaveBeenCalledWith('tenant_1', 'acc_1', 10, 'prev');
    });

    it('maps RETRYING to RUNNING in list response', async () => {
      mockListOutcomes.mockResolvedValue({
        items: [
          {
            action_intent_id: 'ai_1',
            status: 'RETRYING',
            started_at: '2026-01-01T00:00:00Z',
            attempt_count: 2,
          },
        ],
        nextToken: undefined,
      });
      const event = createListEvent();
      const res = await invokeHandler(event);
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body || '{}').executions[0].status).toBe('RUNNING');
    });

    it('returns 500 when listOutcomes throws', async () => {
      mockListOutcomes.mockRejectedValue(new Error('DynamoDB error'));
      const event = createListEvent();
      const res = await invokeHandler(event);
      expect(res.statusCode).toBe(500);
      expect(JSON.parse(res.body || '{}').error).toBe('Internal server error');
    });
  });

  describe('CORS', () => {
    it('adds CORS headers to GET status response', async () => {
      mockGetOutcome.mockResolvedValue({
        action_intent_id: 'ai_123',
        status: 'SUCCEEDED',
        attempt_count: 1,
      });
      mockGetAttempt.mockResolvedValue(null);
      mockGetIntent.mockResolvedValue(null);
      const event = createEvent();
      const res = await invokeHandler(event);
      expect(res.headers?.['Access-Control-Allow-Origin']).toBe('*');
      expect(res.headers?.['Access-Control-Allow-Methods']).toContain('GET');
    });
  });
});
