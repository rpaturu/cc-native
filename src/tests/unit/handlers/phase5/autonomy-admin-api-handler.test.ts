/**
 * Autonomy Admin API Handler Unit Tests - Phase 5.1
 *
 * Tests route dispatch, validation, and response shapes.
 */

const mockListConfigs = jest.fn();
const mockPutConfig = jest.fn();
const mockGetConfig = jest.fn();
const mockPutBudget = jest.fn();
const mockGetStateForDate = jest.fn();

jest.mock('../../../../services/autonomy/AutonomyModeService', () => ({
  AutonomyModeService: jest.fn().mockImplementation(() => ({
    listConfigs: mockListConfigs,
    putConfig: mockPutConfig,
  })),
}));

jest.mock('../../../../services/autonomy/AutonomyBudgetService', () => ({
  AutonomyBudgetService: jest.fn().mockImplementation(() => ({
    getConfig: mockGetConfig,
    putConfig: mockPutBudget,
    getStateForDate: mockGetStateForDate,
  })),
}));

import { handler } from '../../../../handlers/phase5/autonomy-admin-api-handler';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

const mockContext = {} as any;
const mockCallback = jest.fn();

async function invokeHandler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const result = await handler(event, mockContext, mockCallback);
  return result as APIGatewayProxyResult;
}

function makeEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return {
    httpMethod: 'GET',
    path: '/config',
    pathParameters: null,
    queryStringParameters: null,
    headers: {},
    body: null,
    isBase64Encoded: false,
    requestContext: {} as APIGatewayProxyEvent['requestContext'],
    resource: '',
    stageVariables: null,
    ...overrides,
  } as APIGatewayProxyEvent;
}

describe('autonomy-admin-api-handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockListConfigs.mockResolvedValue([]);
    mockPutConfig.mockResolvedValue(undefined);
    mockGetConfig.mockResolvedValue(null);
    mockPutBudget.mockResolvedValue(undefined);
    mockGetStateForDate.mockResolvedValue(null);
  });

  describe('OPTIONS', () => {
    it('returns 204 with CORS', async () => {
      const res = await invokeHandler(makeEvent({ httpMethod: 'OPTIONS' }));

      expect(res.statusCode).toBe(204);
      expect(res.headers?.['Access-Control-Allow-Origin']).toBe('*');
    });
  });

  describe('GET /config', () => {
    it('returns 200 and configs when tenant_id present', async () => {
      const configs = [{ pk: 'TENANT#t1', sk: 'AUTONOMY#DEFAULT', tenant_id: 't1', mode: 'APPROVAL_REQUIRED', updated_at: '2026-01-28', policy_version: 'v1' }];
      mockListConfigs.mockResolvedValue(configs);

      const res = await invokeHandler(
        makeEvent({
          httpMethod: 'GET',
          path: '/config',
          queryStringParameters: { tenant_id: 't1' },
        })
      );

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ configs });
      expect(mockListConfigs).toHaveBeenCalledWith('t1', undefined);
    });

    it('returns 400 when tenant_id missing', async () => {
      const res = await invokeHandler(
        makeEvent({ httpMethod: 'GET', path: '/config', queryStringParameters: {} })
      );

      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error).toContain('tenant_id');
      expect(mockListConfigs).not.toHaveBeenCalled();
    });

    it('uses X-Tenant-Id header when query tenant_id absent', async () => {
      mockListConfigs.mockResolvedValue([]);

      await invokeHandler(
        makeEvent({
          httpMethod: 'GET',
          path: '/config',
          queryStringParameters: null,
          headers: { 'x-tenant-id': 't1' },
        })
      );

      expect(mockListConfigs).toHaveBeenCalledWith('t1', undefined);
    });
  });

  describe('PUT /config', () => {
    it('returns 200 and config when body has tenant_id and mode', async () => {
      const body = { tenant_id: 't1', mode: 'APPROVAL_REQUIRED', updated_at: '2026-01-28' };

      const res = await invokeHandler(
        makeEvent({
          httpMethod: 'PUT',
          path: '/config',
          body: JSON.stringify(body),
        })
      );

      expect(res.statusCode).toBe(200);
      expect(mockPutConfig).toHaveBeenCalled();
      expect(JSON.parse(res.body).config).toBeDefined();
    });

    it('returns 400 when tenant_id or mode missing', async () => {
      const res = await invokeHandler(
        makeEvent({
          httpMethod: 'PUT',
          path: '/config',
          body: JSON.stringify({ tenant_id: 't1' }),
        })
      );

      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error).toContain('tenant_id or mode');
      expect(mockPutConfig).not.toHaveBeenCalled();
    });
  });

  describe('GET /budget', () => {
    it('returns 200 and config when budget config exists', async () => {
      const config = {
        pk: 'TENANT#t1#ACCOUNT#a1',
        sk: 'BUDGET#CONFIG',
        tenant_id: 't1',
        account_id: 'a1',
        max_autonomous_per_day: 5,
        updated_at: '2026-01-28',
      };
      mockGetConfig.mockResolvedValue(config);

      const res = await invokeHandler(
        makeEvent({
          httpMethod: 'GET',
          path: '/budget',
          queryStringParameters: { tenant_id: 't1', account_id: 'a1' },
        })
      );

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ config });
      expect(mockGetConfig).toHaveBeenCalledWith('t1', 'a1');
    });

    it('returns 200 with config null when no budget config', async () => {
      mockGetConfig.mockResolvedValue(null);

      const res = await invokeHandler(
        makeEvent({
          httpMethod: 'GET',
          path: '/budget',
          queryStringParameters: { tenant_id: 't1', account_id: 'a1' },
        })
      );

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ config: null });
      expect(mockGetConfig).toHaveBeenCalledWith('t1', 'a1');
    });

    it('returns 400 when tenant_id or account_id missing', async () => {
      const res = await invokeHandler(
        makeEvent({
          httpMethod: 'GET',
          path: '/budget',
          queryStringParameters: { tenant_id: 't1' },
        })
      );

      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error).toContain('tenant_id and account_id');
      expect(mockGetConfig).not.toHaveBeenCalled();
    });
  });

  describe('PUT /budget', () => {
    it('returns 200 when body has tenant_id, account_id, max_autonomous_per_day', async () => {
      const body = {
        tenant_id: 't1',
        account_id: 'a1',
        max_autonomous_per_day: 10,
        updated_at: '2026-01-28',
      };

      const res = await invokeHandler(
        makeEvent({
          httpMethod: 'PUT',
          path: '/budget',
          body: JSON.stringify(body),
        })
      );

      expect(res.statusCode).toBe(200);
      expect(mockPutBudget).toHaveBeenCalled();
      expect(JSON.parse(res.body).config).toBeDefined();
    });

    it('returns 400 when required fields missing', async () => {
      const res = await invokeHandler(
        makeEvent({
          httpMethod: 'PUT',
          path: '/budget',
          body: JSON.stringify({ tenant_id: 't1' }),
        })
      );

      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error).toContain('tenant_id, account_id, or max_autonomous_per_day');
      expect(mockPutBudget).not.toHaveBeenCalled();
    });
  });

  describe('GET /budget/state', () => {
    it('returns 200 and state when tenant_id, account_id present', async () => {
      mockGetStateForDate.mockResolvedValue({
        pk: 'TENANT#t1#ACCOUNT#a1',
        sk: 'BUDGET_STATE#2026-01-28',
        date_key: '2026-01-28',
        total: 2,
        counts: { CREATE_INTERNAL_NOTE: 2 },
      });

      const res = await invokeHandler(
        makeEvent({
          httpMethod: 'GET',
          path: '/budget/state',
          queryStringParameters: { tenant_id: 't1', account_id: 'a1', date: '2026-01-28' },
        })
      );

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).state).toBeDefined();
      expect(mockGetStateForDate).toHaveBeenCalledWith('t1', 'a1', '2026-01-28');
    });

    it('returns 400 when tenant_id or account_id missing', async () => {
      const res = await invokeHandler(
        makeEvent({
          httpMethod: 'GET',
          path: '/budget/state',
          queryStringParameters: { tenant_id: 't1' },
        })
      );

      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error).toContain('tenant_id and account_id required');
      expect(mockGetStateForDate).not.toHaveBeenCalled();
    });
  });

  describe('routing', () => {
    it('returns 404 for unknown path', async () => {
      const res = await invokeHandler(
        makeEvent({ httpMethod: 'GET', path: '/unknown' })
      );

      expect(res.statusCode).toBe(404);
      expect(JSON.parse(res.body).error).toBe('Not found');
    });
  });

  describe('error handling', () => {
    it('returns 500 and no stack when handler throws', async () => {
      mockListConfigs.mockRejectedValue(new Error('DynamoDB error'));

      const res = await invokeHandler(
        makeEvent({
          httpMethod: 'GET',
          path: '/config',
          queryStringParameters: { tenant_id: 't1' },
        })
      );

      expect(res.statusCode).toBe(500);
      expect(JSON.parse(res.body).error).toBe('Internal server error');
      expect(res.body).not.toContain('DynamoDB error');
      expect(res.body).not.toContain('stack');
    });
  });
});
