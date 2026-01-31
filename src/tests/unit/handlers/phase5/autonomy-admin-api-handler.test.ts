/**
 * Autonomy Admin API Handler Unit Tests - Phase 5.1 + 5.6
 *
 * Tests route dispatch, validation, and response shapes.
 */

const mockListConfigs = jest.fn();
const mockPutConfig = jest.fn();
const mockGetConfig = jest.fn();
const mockPutBudget = jest.fn();
const mockGetStateForDate = jest.fn();

const mockGetKillSwitchConfig = jest.fn();
const mockUpdateKillSwitchConfig = jest.fn();
const mockGetExplanation = jest.fn();
const mockAuditCreateJob = jest.fn();
const mockAuditGetJob = jest.fn();
const mockEventBridgeSend = jest.fn();
const mockGetSignedUrl = jest.fn();

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

jest.mock('../../../../services/execution/KillSwitchService', () => ({
  KillSwitchService: jest.fn().mockImplementation(() => ({
    getKillSwitchConfig: mockGetKillSwitchConfig,
    updateKillSwitchConfig: mockUpdateKillSwitchConfig,
  })),
}));

jest.mock('../../../../services/autonomy/LedgerExplanationService', () => ({
  LedgerExplanationService: jest.fn().mockImplementation(() => ({
    getExplanation: mockGetExplanation,
  })),
}));

jest.mock('../../../../services/autonomy/AuditExportService', () => ({
  AuditExportService: jest.fn().mockImplementation(() => ({
    createJob: mockAuditCreateJob,
    getJob: mockAuditGetJob,
  })),
}));

jest.mock('@aws-sdk/client-eventbridge', () => ({
  EventBridgeClient: jest.fn().mockImplementation(() => ({ send: mockEventBridgeSend })),
  PutEventsCommand: jest.fn(),
}));

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: (...args: unknown[]) => mockGetSignedUrl(...args),
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
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    mockListConfigs.mockResolvedValue([]);
    mockPutConfig.mockResolvedValue(undefined);
    mockGetConfig.mockResolvedValue(null);
    mockPutBudget.mockResolvedValue(undefined);
    mockGetStateForDate.mockResolvedValue(null);
    mockGetKillSwitchConfig.mockResolvedValue({ tenant_id: 't1', execution_enabled: true, disabled_action_types: [] });
    mockUpdateKillSwitchConfig.mockResolvedValue(undefined);
    mockGetExplanation.mockResolvedValue(null);
    mockAuditCreateJob.mockResolvedValue({ export_id: 'exp-abc123', status: 'PENDING' });
    mockAuditGetJob.mockResolvedValue(null);
    mockEventBridgeSend.mockResolvedValue({ FailedEntryCount: 0 });
    mockGetSignedUrl.mockResolvedValue('https://presigned.example.com/key');
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
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
      const body = JSON.parse(res.body);
      expect(body).toMatchObject({ config });
      expect(typeof body.remaining_today).toBe('number');
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
      expect(JSON.parse(res.body)).toEqual({ config: null, remaining_today: 0 });
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

  describe('Phase 5.6: kill-switches', () => {
    it('returns 503 when Phase 5.6 not configured (no TENANTS_TABLE_NAME)', async () => {
      delete process.env.TENANTS_TABLE_NAME;

      const res = await invokeHandler(
        makeEvent({
          httpMethod: 'GET',
          path: '/kill-switches',
          queryStringParameters: { tenant_id: 't1' },
        })
      );

      expect(res.statusCode).toBe(503);
      expect(JSON.parse(res.body).error).toContain('not configured');
    });

    it('returns 400 when tenant_id missing for kill-switches', async () => {
      process.env.TENANTS_TABLE_NAME = 'tenants-table';

      const res = await invokeHandler(
        makeEvent({
          httpMethod: 'GET',
          path: '/kill-switches',
          queryStringParameters: null,
        })
      );

      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error).toContain('tenant_id');
    });

    it('returns 200 and config when GET /kill-switches and service configured', async () => {
      process.env.TENANTS_TABLE_NAME = 'tenants-table';
      mockGetKillSwitchConfig.mockResolvedValue({
        tenant_id: 't1',
        execution_enabled: false,
        disabled_action_types: ['SEND_EMAIL'],
        global_emergency_stop: false,
      });

      const res = await invokeHandler(
        makeEvent({
          httpMethod: 'GET',
          path: '/kill-switches',
          queryStringParameters: { tenant_id: 't1' },
        })
      );

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).execution_enabled).toBe(false);
      expect(mockGetKillSwitchConfig).toHaveBeenCalledWith('t1');
    });

    it('returns 200 when PUT /kill-switches and service configured', async () => {
      process.env.TENANTS_TABLE_NAME = 'tenants-table';

      const res = await invokeHandler(
        makeEvent({
          httpMethod: 'PUT',
          path: '/kill-switches',
          queryStringParameters: { tenant_id: 't1' },
          body: JSON.stringify({ execution_enabled: false }),
        })
      );

      expect(res.statusCode).toBe(200);
      expect(mockUpdateKillSwitchConfig).toHaveBeenCalledWith('t1', { execution_enabled: false, disabled_action_types: undefined });
    });
  });

  describe('Phase 5.6: ledger/explanation', () => {
    it('returns 503 when Phase 5.6 not configured for ledger explanation', async () => {
      delete process.env.LEDGER_TABLE_NAME;
      delete process.env.EXECUTION_OUTCOMES_TABLE_NAME;

      const res = await invokeHandler(
        makeEvent({
          httpMethod: 'GET',
          path: '/ledger/explanation',
          queryStringParameters: { tenant_id: 't1', account_id: 'a1', action_intent_id: 'intent-1' },
        })
      );

      expect(res.statusCode).toBe(503);
    });

    it('returns 400 when tenant_id or account_id missing for ledger explanation', async () => {
      process.env.LEDGER_TABLE_NAME = 'ledger';
      process.env.EXECUTION_OUTCOMES_TABLE_NAME = 'outcomes';

      const res = await invokeHandler(
        makeEvent({
          httpMethod: 'GET',
          path: '/ledger/explanation',
          queryStringParameters: { tenant_id: 't1', action_intent_id: 'intent-1' },
        })
      );

      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error).toContain('tenant_id and account_id');
    });

    it('returns 200 when GET /ledger/explanation and explanation found', async () => {
      process.env.LEDGER_TABLE_NAME = 'ledger';
      process.env.EXECUTION_OUTCOMES_TABLE_NAME = 'outcomes';
      mockGetExplanation.mockResolvedValue({
        execution_id: 'intent-1',
        account_id: 'a1',
        tenant_id: 't1',
        why: { policy_decision: 'AUTO_EXECUTE', explanation: 'OK' },
        which_policy: { policy_version: 'v1' },
      });

      const res = await invokeHandler(
        makeEvent({
          httpMethod: 'GET',
          path: '/ledger/explanation',
          queryStringParameters: { tenant_id: 't1', account_id: 'a1', action_intent_id: 'intent-1' },
        })
      );

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).execution_id).toBe('intent-1');
    });

    it('returns 404 when explanation not found', async () => {
      process.env.LEDGER_TABLE_NAME = 'ledger';
      process.env.EXECUTION_OUTCOMES_TABLE_NAME = 'outcomes';
      mockGetExplanation.mockResolvedValue(null);

      const res = await invokeHandler(
        makeEvent({
          httpMethod: 'GET',
          path: '/ledger/explanation',
          queryStringParameters: { tenant_id: 't1', account_id: 'a1', action_intent_id: 'intent-1' },
        })
      );

      expect(res.statusCode).toBe(404);
    });
  });

  describe('Phase 5.6: audit exports', () => {
    it('returns 503 when Phase 5.6 not configured for audit exports', async () => {
      delete process.env.AUDIT_EXPORT_TABLE_NAME;

      const res = await invokeHandler(
        makeEvent({
          httpMethod: 'POST',
          path: '/audit/exports',
          queryStringParameters: { tenant_id: 't1' },
          body: JSON.stringify({ from: '2026-01-01', to: '2026-01-31' }),
        })
      );

      expect(res.statusCode).toBe(503);
    });

    it('returns 202 and export_id when POST /audit/exports and service configured', async () => {
      process.env.AUDIT_EXPORT_TABLE_NAME = 'audit-export';
      process.env.EVENT_BUS_NAME = 'my-event-bus';

      const res = await invokeHandler(
        makeEvent({
          httpMethod: 'POST',
          path: '/audit/exports',
          queryStringParameters: { tenant_id: 't1' },
          body: JSON.stringify({ from: '2026-01-01', to: '2026-01-31' }),
        })
      );

      expect(res.statusCode).toBe(202);
      expect(JSON.parse(res.body).export_id).toBe('exp-abc123');
      expect(JSON.parse(res.body).status).toBe('PENDING');
      expect(mockAuditCreateJob).toHaveBeenCalled();
      expect(mockEventBridgeSend).toHaveBeenCalled();
    });

    it('returns 404 when GET /audit/exports/:id and job not found', async () => {
      process.env.AUDIT_EXPORT_TABLE_NAME = 'audit-export';
      mockAuditGetJob.mockResolvedValue(null);

      const res = await invokeHandler(
        makeEvent({
          httpMethod: 'GET',
          path: '/audit/exports/exp-abc123',
          queryStringParameters: { tenant_id: 't1' },
        })
      );

      expect(res.statusCode).toBe(404);
    });

    it('returns 200 with presigned_url when GET /audit/exports/:id and job COMPLETED', async () => {
      process.env.AUDIT_EXPORT_TABLE_NAME = 'audit-export';
      mockAuditGetJob.mockResolvedValue({
        export_id: 'exp-abc123',
        status: 'COMPLETED',
        s3_bucket: 'my-bucket',
        s3_key: 'audit-exports/t1/exp-abc123.json',
      });

      const res = await invokeHandler(
        makeEvent({
          httpMethod: 'GET',
          path: '/audit/exports/exp-abc123',
          queryStringParameters: { tenant_id: 't1' },
        })
      );

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.status).toBe('COMPLETED');
      expect(body.presigned_url).toBe('https://presigned.example.com/key');
      expect(body.expires_at).toBeDefined();
      expect(body.s3_bucket).toBeUndefined();
      expect(body.s3_key).toBeUndefined();
    });
  });
});
