/**
 * Plan Lifecycle API Handler — Phase 6.1 route and response coverage.
 */

process.env.REVENUE_PLANS_TABLE_NAME = 'RevenuePlans';
process.env.PLAN_LEDGER_TABLE_NAME = 'PlanLedger';
process.env.AWS_REGION = 'us-east-1';

const mockGetPlan = jest.fn();
const mockPutPlan = jest.fn();
const mockExistsActivePlanForAccountAndType = jest.fn();
const mockValidateForApproval = jest.fn();
const mockEvaluateCanActivate = jest.fn();
const mockTransition = jest.fn();
const mockGenerateProposal = jest.fn();
const mockLedgerAppend = jest.fn();

jest.mock('../../../../services/core/Logger');
jest.mock('../../../../utils/aws-client-config', () => ({ getAWSClientConfig: jest.fn(() => ({})) }));
jest.mock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: jest.fn() }));
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn(() => ({ send: jest.fn() })) },
}));
jest.mock('../../../../services/plan/PlanRepositoryService', () => ({
  PlanRepositoryService: jest.fn().mockImplementation(() => ({
    getPlan: mockGetPlan,
    putPlan: mockPutPlan,
    existsActivePlanForAccountAndType: mockExistsActivePlanForAccountAndType,
  })),
}));
jest.mock('../../../../services/plan/PlanLedgerService', () => ({
  PlanLedgerService: jest.fn().mockImplementation(() => ({
    append: mockLedgerAppend,
  })),
}));
jest.mock('../../../../services/plan/PlanProposalGeneratorService', () => ({
  PlanProposalGeneratorService: jest.fn().mockImplementation(() => ({
    generateProposal: mockGenerateProposal,
  })),
}));
jest.mock('../../../../services/plan/PlanPolicyGateService', () => ({
  PlanPolicyGateService: jest.fn().mockImplementation(() => ({
    validateForApproval: mockValidateForApproval,
    evaluateCanActivate: mockEvaluateCanActivate,
  })),
}));
jest.mock('../../../../services/plan/PlanLifecycleService', () => ({
  PlanLifecycleService: jest.fn().mockImplementation(() => ({
    transition: mockTransition,
  })),
}));

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { handler } from '../../../../handlers/phase6/plan-lifecycle-api-handler';
import { RevenuePlanV1 } from '../../../../types/plan/PlanTypes';

function plan(overrides: Partial<RevenuePlanV1> = {}): RevenuePlanV1 {
  const now = new Date().toISOString();
  return {
    plan_id: 'plan-1',
    plan_type: 'RENEWAL_DEFENSE',
    account_id: 'acc-1',
    tenant_id: 't1',
    objective: 'Renew',
    plan_status: 'DRAFT',
    steps: [],
    expires_at: now,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

/** Handler may be typed with callback; we await and get a result. */
async function invokeHandler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  return (await handler(event, {} as never, () => {})) as APIGatewayProxyResult;
}

function event(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return {
    httpMethod: 'POST',
    path: '/plans/plan-1/approve',
    resource: '/plans/{planId}/approve',
    pathParameters: { planId: 'plan-1' },
    queryStringParameters: { account_id: 'acc-1' },
    body: null,
    requestContext: {
      authorizer: {
        claims: { 'custom:tenant_id': 't1' },
      },
    } as unknown as APIGatewayProxyEvent['requestContext'],
    ...overrides,
  } as APIGatewayProxyEvent;
}

describe('plan-lifecycle-api-handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetPlan.mockResolvedValue(null);
    mockPutPlan.mockResolvedValue(undefined);
    mockLedgerAppend.mockResolvedValue({});
    mockValidateForApproval.mockResolvedValue({ valid: true, reasons: [] });
    mockEvaluateCanActivate.mockResolvedValue({ can_activate: true, reasons: [] });
    mockExistsActivePlanForAccountAndType.mockResolvedValue({ exists: false });
    mockTransition.mockResolvedValue(undefined);
  });

  describe('shared / edge (run first for 503)', () => {
    it('503: Service not configured when env missing (getServices catch)', async () => {
      const saved = process.env.REVENUE_PLANS_TABLE_NAME;
      delete process.env.REVENUE_PLANS_TABLE_NAME;
      const res = await invokeHandler(event({
        path: '/plans/propose',
        resource: '/plans/propose',
        pathParameters: null,
        body: JSON.stringify({ tenant_id: 't1', account_id: 'acc-1', plan_type: 'RENEWAL_DEFENSE' }),
      }));
      expect(res.statusCode).toBe(503);
      expect(JSON.parse(res.body || '{}').error).toBe('Service not configured');
      if (saved !== undefined) process.env.REVENUE_PLANS_TABLE_NAME = saved;
      else process.env.REVENUE_PLANS_TABLE_NAME = 'RevenuePlans';
    });

    it('parseBody invalid JSON returns empty object (propose with invalid body still defaults plan_type)', async () => {
      mockGenerateProposal.mockResolvedValue({ plan: plan({ plan_id: 'p1', plan_status: 'DRAFT' }) });
      const res = await invokeHandler(event({
        path: '/plans/propose',
        resource: '/plans/propose',
        pathParameters: null,
        body: '{',
      }));
      expect(res.statusCode).toBe(201);
      expect(mockGenerateProposal).toHaveBeenCalledWith(
        expect.objectContaining({ plan_type: 'RENEWAL_DEFENSE', tenant_id: 't1', account_id: 'acc-1' })
      );
    });
  });

  describe('POST /plans/propose (6.2)', () => {
    it('201: valid RENEWAL_DEFENSE proposal; plan persisted and ledger appended', async () => {
      const draftPlan = plan({
        plan_id: 'proposed-1',
        plan_status: 'DRAFT',
        plan_type: 'RENEWAL_DEFENSE',
      });
      mockGenerateProposal.mockResolvedValue({ plan: draftPlan });
      const res = await invokeHandler(event({
        path: '/plans/propose',
        resource: '/plans/propose',
        pathParameters: null,
        body: JSON.stringify({
          tenant_id: 't1',
          account_id: 'acc-1',
          plan_type: 'RENEWAL_DEFENSE',
        }),
      }));
      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body || '{}');
      expect(body.plan).toBeDefined();
      expect(body.plan.plan_id).toBe('proposed-1');
      expect(body.plan.plan_status).toBe('DRAFT');
      expect(mockPutPlan).toHaveBeenCalledWith(draftPlan);
      expect(mockLedgerAppend).toHaveBeenCalledWith(
        expect.objectContaining({
          plan_id: 'proposed-1',
          tenant_id: 't1',
          account_id: 'acc-1',
          event_type: 'PLAN_CREATED',
        })
      );
    });

    it('400: invalid plan_type (not RENEWAL_DEFENSE)', async () => {
      const res = await invokeHandler(event({
        path: '/plans/propose',
        resource: '/plans/propose',
        pathParameters: null,
        body: JSON.stringify({
          tenant_id: 't1',
          account_id: 'acc-1',
          plan_type: 'OTHER_TYPE',
        }),
      }));
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body || '{}').error).toContain('RENEWAL_DEFENSE');
      expect(mockGenerateProposal).not.toHaveBeenCalled();
    });

    it('403: tenant_id or account_id does not match auth', async () => {
      const res = await invokeHandler(event({
        path: '/plans/propose',
        resource: '/plans/propose',
        pathParameters: null,
        body: JSON.stringify({
          tenant_id: 'other-tenant',
          account_id: 'acc-1',
          plan_type: 'RENEWAL_DEFENSE',
        }),
      }));
      expect(res.statusCode).toBe(403);
      expect(mockGenerateProposal).not.toHaveBeenCalled();
    });

    it('500: generateProposal throws generic error', async () => {
      mockGenerateProposal.mockRejectedValue(new Error('DB error'));
      const res = await invokeHandler(event({
        path: '/plans/propose',
        resource: '/plans/propose',
        pathParameters: null,
        body: JSON.stringify({
          tenant_id: 't1',
          account_id: 'acc-1',
          plan_type: 'RENEWAL_DEFENSE',
        }),
      }));
      expect(res.statusCode).toBe(500);
      expect(JSON.parse(res.body || '{}').error).toBe('Internal server error');
    });

    it('400: generateProposal throws with message containing "not supported"', async () => {
      mockGenerateProposal.mockRejectedValue(new Error('Plan type X is not supported.'));
      const res = await invokeHandler(event({
        path: '/plans/propose',
        resource: '/plans/propose',
        pathParameters: null,
        body: JSON.stringify({
          tenant_id: 't1',
          account_id: 'acc-1',
          plan_type: 'RENEWAL_DEFENSE',
        }),
      }));
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body || '{}').error).toContain('not supported');
    });
  });

  describe('POST /plans/:planId/approve', () => {
    it('200: Plan in DRAFT; validateForApproval valid; transition called; response success', async () => {
      const p = plan({ plan_status: 'DRAFT' });
      mockGetPlan.mockResolvedValue(p);
      const res = await invokeHandler(event({ resource: '/plans/{planId}/approve', path: '/plans/plan-1/approve' }));
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body || '{}').success).toBe(true);
      expect(mockTransition).toHaveBeenCalledWith(p, 'APPROVED');
    });

    it('400: Plan in DRAFT but validateForApproval invalid; response includes reasons', async () => {
      const p = plan({ plan_status: 'DRAFT' });
      mockGetPlan.mockResolvedValue(p);
      mockValidateForApproval.mockResolvedValue({ valid: false, reasons: [{ code: 'INVALID_PLAN_TYPE', message: 'x' }] });
      const res = await invokeHandler(event({ resource: '/plans/{planId}/approve', path: '/plans/plan-1/approve' }));
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body || '{}').reasons).toHaveLength(1);
      expect(mockTransition).not.toHaveBeenCalled();
    });

    it('404: Plan not found', async () => {
      mockGetPlan.mockResolvedValue(null);
      const res = await invokeHandler(event({ resource: '/plans/{planId}/approve', path: '/plans/plan-1/approve' }));
      expect(res.statusCode).toBe(404);
      expect(mockTransition).not.toHaveBeenCalled();
    });

    it('400: Plan not in DRAFT (e.g. already APPROVED)', async () => {
      mockGetPlan.mockResolvedValue(plan({ plan_status: 'APPROVED' }));
      const res = await invokeHandler(event({ resource: '/plans/{planId}/approve', path: '/plans/plan-1/approve' }));
      expect(res.statusCode).toBe(400);
      expect(mockTransition).not.toHaveBeenCalled();
    });
  });

  describe('POST /plans/:planId/pause', () => {
    it('200: Plan in ACTIVE; transition(PAUSED) called', async () => {
      const p = plan({ plan_status: 'ACTIVE' });
      mockGetPlan.mockResolvedValue(p);
      const res = await invokeHandler(event({
        resource: '/plans/{planId}/pause',
        path: '/plans/plan-1/pause',
        body: JSON.stringify({ reason: 'Manual' }),
      }));
      expect(res.statusCode).toBe(200);
      expect(mockTransition).toHaveBeenCalledWith(p, 'PAUSED', { reason: 'Manual' });
    });

    it('400: Plan not ACTIVE', async () => {
      mockGetPlan.mockResolvedValue(plan({ plan_status: 'DRAFT' }));
      const res = await invokeHandler(event({ resource: '/plans/{planId}/pause', path: '/plans/plan-1/pause' }));
      expect(res.statusCode).toBe(400);
      expect(mockTransition).not.toHaveBeenCalled();
    });
  });

  describe('POST /plans/:planId/resume', () => {
    it('200: Plan in PAUSED; evaluateCanActivate true; transition(ACTIVE) called', async () => {
      const p = plan({ plan_status: 'PAUSED' });
      mockGetPlan.mockResolvedValue(p);
      mockEvaluateCanActivate.mockResolvedValue({ can_activate: true, reasons: [] });
      const res = await invokeHandler(event({ resource: '/plans/{planId}/resume', path: '/plans/plan-1/resume' }));
      expect(res.statusCode).toBe(200);
      expect(mockTransition).toHaveBeenCalledWith(p, 'ACTIVE');
    });

    it('400: Plan in PAUSED but can_activate false; response includes reasons; transition not called', async () => {
      const p = plan({ plan_status: 'PAUSED' });
      mockGetPlan.mockResolvedValue(p);
      mockEvaluateCanActivate.mockResolvedValue({
        can_activate: false,
        reasons: [{ code: 'PRECONDITIONS_UNMET', message: 'x' }],
      });
      const res = await invokeHandler(event({ resource: '/plans/{planId}/resume', path: '/plans/plan-1/resume' }));
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body || '{}').reasons).toHaveLength(1);
      expect(mockTransition).not.toHaveBeenCalled();
    });

    it('404: Plan not found', async () => {
      mockGetPlan.mockResolvedValue(null);
      const res = await invokeHandler(event({ resource: '/plans/{planId}/resume', path: '/plans/plan-1/resume' }));
      expect(res.statusCode).toBe(404);
      expect(mockTransition).not.toHaveBeenCalled();
    });

    it('400: Plan not PAUSED (e.g. DRAFT) to resume', async () => {
      mockGetPlan.mockResolvedValue(plan({ plan_status: 'DRAFT' }));
      const res = await invokeHandler(event({ resource: '/plans/{planId}/resume', path: '/plans/plan-1/resume' }));
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body || '{}').error).toContain('PAUSED');
      expect(mockTransition).not.toHaveBeenCalled();
    });
  });

  describe('POST /plans/:planId/abort', () => {
    it('200: Plan in ACTIVE; transition(ABORTED) called', async () => {
      const p = plan({ plan_status: 'ACTIVE' });
      mockGetPlan.mockResolvedValue(p);
      const res = await invokeHandler(event({
        resource: '/plans/{planId}/abort',
        path: '/plans/plan-1/abort',
        body: JSON.stringify({ reason: 'Cancelled' }),
      }));
      expect(res.statusCode).toBe(200);
      expect(mockTransition).toHaveBeenCalledWith(p, 'ABORTED', expect.objectContaining({ reason: 'Cancelled' }));
    });

    it('400: Plan already terminal (COMPLETED)', async () => {
      mockGetPlan.mockResolvedValue(plan({ plan_status: 'COMPLETED' }));
      const res = await invokeHandler(event({ resource: '/plans/{planId}/abort', path: '/plans/plan-1/abort' }));
      expect(res.statusCode).toBe(400);
      expect(mockTransition).not.toHaveBeenCalled();
    });
  });

  describe('auth and routing', () => {
    it('401: Unauthorized when no tenant_id/account_id', async () => {
      const res = await invokeHandler(event({
        requestContext: { authorizer: {} } as unknown as APIGatewayProxyEvent['requestContext'],
        queryStringParameters: null,
        body: null,
      }));
      expect(res.statusCode).toBe(401);
      expect(mockGetPlan).not.toHaveBeenCalled();
    });

    it('400: Missing planId', async () => {
      const res = await invokeHandler(event({ pathParameters: null }));
      expect(res.statusCode).toBe(400);
    });

    it('404: Unknown route', async () => {
      const res = await invokeHandler(event({
        resource: '/plans/{planId}/unknown',
        path: '/plans/plan-1/unknown',
        httpMethod: 'POST',
      }));
      expect(res.statusCode).toBe(404);
    });

    it('500: Service throws; no stack in body', async () => {
      mockGetPlan.mockRejectedValue(new Error('DB error'));
      const res = await invokeHandler(event({ resource: '/plans/{planId}/approve', path: '/plans/plan-1/approve' }));
      expect(res.statusCode).toBe(500);
      const body = JSON.parse(res.body || '{}');
      expect(body.error).toBe('Internal server error');
      expect(body.stack).toBeUndefined();
    });
  });
});
