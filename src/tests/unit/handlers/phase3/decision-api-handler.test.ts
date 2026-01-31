/**
 * Decision API Handler Unit Tests - Phase 3
 *
 * Covers: routing, evaluateDecision, getAccountDecisions, approveAction,
 * rejectAction, getEvaluationStatus.
 */

process.env.AWS_REGION = 'us-west-2';
process.env.EVENT_BUS_NAME = 'test-bus';

const mockShouldTriggerDecision = jest.fn();
const mockCanEvaluateDecision = jest.fn();
const mockCreateIntent = jest.fn();
const mockGetProposal = jest.fn();
const mockLedgerAppend = jest.fn().mockResolvedValue({});
const mockLedgerQuery = jest.fn();
const mockEventBridgeSend = jest.fn().mockResolvedValue({});
const mockGenerateTraceId = jest.fn().mockReturnValue('trace-1');

jest.mock('../../../../services/core/Logger');
jest.mock('../../../../services/core/TraceService', () => ({
  TraceService: jest.fn().mockImplementation(() => ({
    generateTraceId: mockGenerateTraceId,
  })),
}));
jest.mock('../../../../utils/aws-client-config', () => ({
  getAWSClientConfig: jest.fn(() => ({})),
}));
jest.mock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: jest.fn() }));
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn(() => ({})) },
}));
jest.mock('../../../../services/synthesis/AccountPostureStateService', () => ({
  AccountPostureStateService: jest.fn().mockImplementation(() => ({})),
}));
jest.mock('../../../../services/perception/SignalService', () => ({
  SignalService: jest.fn().mockImplementation(() => ({})),
}));
jest.mock('../../../../services/decision/DecisionTriggerService', () => ({
  DecisionTriggerService: jest.fn().mockImplementation(() => ({
    shouldTriggerDecision: mockShouldTriggerDecision,
  })),
}));
jest.mock('../../../../services/decision/CostBudgetService', () => ({
  CostBudgetService: jest.fn().mockImplementation(() => ({
    canEvaluateDecision: mockCanEvaluateDecision,
    consumeBudget: jest.fn().mockResolvedValue(undefined),
  })),
}));
jest.mock('../../../../services/decision/ActionIntentService', () => ({
  ActionIntentService: jest.fn().mockImplementation(() => ({
    createIntent: mockCreateIntent,
  })),
}));
jest.mock('../../../../services/decision/DecisionProposalStore', () => ({
  DecisionProposalStore: jest.fn().mockImplementation(() => ({
    getProposal: mockGetProposal,
  })),
}));
jest.mock('../../../../services/ledger/LedgerService', () => ({
  LedgerService: jest.fn().mockImplementation(() => ({
    append: mockLedgerAppend,
    query: mockLedgerQuery,
  })),
}));
jest.mock('@aws-sdk/client-eventbridge', () => ({
  EventBridgeClient: jest.fn().mockImplementation(() => ({ send: mockEventBridgeSend })),
  PutEventsCommand: jest.fn().mockImplementation(function (this: { input: unknown }, input: unknown) {
    this.input = input;
  }),
}));
jest.mock('uuid', () => ({
  v4: jest.fn().mockReturnValue('eval-uuid-1'),
}));

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  handler,
  evaluateDecisionHandler,
  getAccountDecisionsHandler,
  approveActionHandler,
  rejectActionHandler,
  getEvaluationStatusHandler,
} from '../../../../handlers/phase3/decision-api-handler';
import { DecisionTriggerType } from '../../../../types/DecisionTriggerTypes';
import { LedgerEventType } from '../../../../types/LedgerTypes';

async function invoke(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  return await handler(event);
}

function parseBody(res: APIGatewayProxyResult): Record<string, unknown> {
  return JSON.parse(res.body || '{}');
}

describe('DecisionAPIHandler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('routing', () => {
    it('POST /decisions/evaluate dispatches to evaluateDecisionHandler', async () => {
      mockShouldTriggerDecision.mockResolvedValue({ should_evaluate: false, reason: 'test' });
      const event = {
        httpMethod: 'POST',
        resource: '/decisions/evaluate',
        path: '/decisions/evaluate',
        body: JSON.stringify({ account_id: 'a1', tenant_id: 't1' }),
        pathParameters: null,
        headers: {},
      } as unknown as APIGatewayProxyEvent;
      const res = await invoke(event);
      expect(res.statusCode).toBe(200);
      expect(parseBody(res).message).toBe('Decision not triggered');
    });

    it('GET /decisions/{id}/status dispatches to getEvaluationStatusHandler', async () => {
      mockLedgerQuery.mockResolvedValue([]);
      const event = {
        httpMethod: 'GET',
        resource: '/decisions/eval_1/status',
        path: '/decisions/eval_1/status',
        pathParameters: { evaluation_id: 'eval_1' },
        headers: { 'x-tenant-id': 't1' },
      } as unknown as APIGatewayProxyEvent;
      const res = await invoke(event);
      expect(res.statusCode).toBe(404);
      expect(parseBody(res).error).toBe('Evaluation not found');
    });

    it('GET /accounts/{id}/decisions dispatches to getAccountDecisionsHandler', async () => {
      mockLedgerQuery.mockResolvedValue([{ eventType: LedgerEventType.DECISION_PROPOSED }]);
      const event = {
        httpMethod: 'GET',
        resource: '/accounts/acc1/decisions',
        path: '/accounts/acc1/decisions',
        pathParameters: { account_id: 'acc1' },
        headers: { 'x-tenant-id': 't1' },
      } as unknown as APIGatewayProxyEvent;
      const res = await invoke(event);
      expect(res.statusCode).toBe(200);
      expect(parseBody(res).decisions).toHaveLength(1);
    });

    it('POST /actions/{id}/approve dispatches to approveActionHandler', async () => {
      mockGetProposal.mockResolvedValue(null);
      const event = {
        httpMethod: 'POST',
        resource: '/actions/act1/approve',
        path: '/actions/act1/approve',
        pathParameters: { action_id: 'act1' },
        body: JSON.stringify({ decision_id: 'dec1' }),
        headers: { 'x-tenant-id': 't1' },
        requestContext: { authorizer: { userId: 'u1' } },
      } as unknown as APIGatewayProxyEvent;
      const res = await invoke(event);
      expect(res.statusCode).toBe(404);
      expect(parseBody(res).error).toBe('Decision not found');
    });

    it('POST /actions/{id}/reject dispatches to rejectActionHandler', async () => {
      mockGetProposal.mockResolvedValue(null);
      const event = {
        httpMethod: 'POST',
        resource: '/actions/act1/reject',
        path: '/actions/act1/reject',
        pathParameters: { action_id: 'act1' },
        body: JSON.stringify({ decision_id: 'dec1' }),
        headers: { 'x-tenant-id': 't1' },
        requestContext: { authorizer: { userId: 'u1' } },
      } as unknown as APIGatewayProxyEvent;
      const res = await invoke(event);
      expect(res.statusCode).toBe(404);
    });

    it('returns 404 for unknown route', async () => {
      const event = {
        httpMethod: 'GET',
        resource: '/other',
        path: '/other',
        pathParameters: null,
        headers: {},
      } as unknown as APIGatewayProxyEvent;
      const res = await invoke(event);
      expect(res.statusCode).toBe(404);
      expect(parseBody(res).error).toBe('Not found');
    });
  });

  describe('evaluateDecisionHandler', () => {
    it('returns 200 when should_evaluate false', async () => {
      mockShouldTriggerDecision.mockResolvedValue({ should_evaluate: false, reason: 'cooldown' });
      const event = {
        body: JSON.stringify({ account_id: 'a1', tenant_id: 't1', trigger_type: DecisionTriggerType.LIFECYCLE_TRANSITION }),
        pathParameters: null,
        headers: {},
      } as unknown as APIGatewayProxyEvent;
      const res = await evaluateDecisionHandler(event);
      expect(res.statusCode).toBe(200);
      expect(parseBody(res).reason).toBe('cooldown');
      expect(mockEventBridgeSend).not.toHaveBeenCalled();
    });

    it('returns 429 when budget not allowed', async () => {
      mockShouldTriggerDecision.mockResolvedValue({ should_evaluate: true });
      mockCanEvaluateDecision.mockResolvedValue({ allowed: false, reason: 'daily limit' });
      const event = {
        body: JSON.stringify({ account_id: 'a1', tenant_id: 't1' }),
        pathParameters: null,
        headers: {},
      } as unknown as APIGatewayProxyEvent;
      const res = await evaluateDecisionHandler(event);
      expect(res.statusCode).toBe(429);
      expect(parseBody(res).message).toBe('Budget exceeded');
      expect(mockEventBridgeSend).not.toHaveBeenCalled();
    });

    it('returns 202 and publishes event when allowed', async () => {
      mockShouldTriggerDecision.mockResolvedValue({ should_evaluate: true });
      mockCanEvaluateDecision.mockResolvedValue({ allowed: true });
      const event = {
        body: JSON.stringify({ account_id: 'a1', tenant_id: 't1', trigger_type: DecisionTriggerType.EXPLICIT_USER_REQUEST }),
        pathParameters: null,
        headers: {},
      } as unknown as APIGatewayProxyEvent;
      const res = await evaluateDecisionHandler(event);
      expect(res.statusCode).toBe(202);
      const body = parseBody(res);
      expect(body.evaluation_id).toBeDefined();
      expect(body.status).toBe('PENDING');
      expect(body.status_url).toContain(body.evaluation_id);
      expect(mockEventBridgeSend).toHaveBeenCalledTimes(1);
      const sent = mockEventBridgeSend.mock.calls[0][0];
      const entries = (sent as { input?: { Entries?: Array<{ Detail?: string }> } }).input?.Entries ?? [];
      expect(entries.length).toBe(1);
      const detail = JSON.parse(entries[0]?.Detail ?? '{}');
      expect(detail.account_id).toBe('a1');
      expect(detail.tenant_id).toBe('t1');
      expect(mockLedgerAppend).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: LedgerEventType.DECISION_EVALUATION_REQUESTED,
          tenantId: 't1',
          accountId: 'a1',
        })
      );
    });

    it('returns 500 when trigger service throws', async () => {
      mockShouldTriggerDecision.mockRejectedValue(new Error('Trigger failed'));
      const event = {
        body: JSON.stringify({ account_id: 'a1', tenant_id: 't1' }),
        pathParameters: null,
        headers: {},
      } as unknown as APIGatewayProxyEvent;
      const res = await evaluateDecisionHandler(event);
      expect(res.statusCode).toBe(500);
      expect(parseBody(res).error).toBe('Internal server error');
    });
  });

  describe('getAccountDecisionsHandler', () => {
    it('returns 400 when account_id or tenant_id missing', async () => {
      const event = {
        pathParameters: {},
        headers: {},
      } as unknown as APIGatewayProxyEvent;
      const res = await getAccountDecisionsHandler(event);
      expect(res.statusCode).toBe(400);
      expect(parseBody(res).error).toContain('Missing');
    });

    it('returns 200 with decisions from ledger', async () => {
      mockLedgerQuery.mockResolvedValue([{ eventType: LedgerEventType.DECISION_PROPOSED, data: {} }]);
      const event = {
        pathParameters: { account_id: 'acc1' },
        headers: { 'x-tenant-id': 't1' },
      } as unknown as APIGatewayProxyEvent;
      const res = await getAccountDecisionsHandler(event);
      expect(res.statusCode).toBe(200);
      expect(parseBody(res).decisions).toHaveLength(1);
    });

    it('returns 500 when ledger query throws', async () => {
      mockLedgerQuery.mockRejectedValue(new Error('Dynamo error'));
      const event = {
        pathParameters: { account_id: 'acc1' },
        headers: { 'x-tenant-id': 't1' },
      } as unknown as APIGatewayProxyEvent;
      const res = await getAccountDecisionsHandler(event);
      expect(res.statusCode).toBe(500);
    });
  });

  describe('approveActionHandler', () => {
    const proposal = {
      decision_id: 'dec1',
      account_id: 'acc1',
      tenant_id: 't1',
      trace_id: 'trace1',
      actions: [{ action_ref: 'act1', action_type: 'EMAIL', target: 'user@example.com', why: ['reason'] }],
    };
    const intent = { action_intent_id: 'intent_1', edited_fields: [] };

    it('returns 400 when action_id, decision_id or tenant_id missing', async () => {
      const event = {
        pathParameters: { action_id: 'act1' },
        body: JSON.stringify({ decision_id: 'dec1' }),
        headers: {},
        requestContext: { authorizer: { userId: 'u1' } },
      } as unknown as APIGatewayProxyEvent;
      const res = await approveActionHandler(event);
      expect(res.statusCode).toBe(400);
    });

    it('returns 404 when decision not found', async () => {
      mockGetProposal.mockResolvedValue(null);
      const event = {
        pathParameters: { action_id: 'act1' },
        body: JSON.stringify({ decision_id: 'dec1' }),
        headers: { 'x-tenant-id': 't1' },
        requestContext: { authorizer: { userId: 'u1' } },
      } as unknown as APIGatewayProxyEvent;
      const res = await approveActionHandler(event);
      expect(res.statusCode).toBe(404);
      expect(parseBody(res).error).toBe('Decision not found');
    });

    it('returns 404 when action not in proposal', async () => {
      mockGetProposal.mockResolvedValue(proposal);
      const event = {
        pathParameters: { action_id: 'other_ref' },
        body: JSON.stringify({ decision_id: 'dec1' }),
        headers: { 'x-tenant-id': 't1' },
        requestContext: { authorizer: { userId: 'u1' } },
      } as unknown as APIGatewayProxyEvent;
      const res = await approveActionHandler(event);
      expect(res.statusCode).toBe(404);
      expect(parseBody(res).error).toBe('Action proposal not found in decision');
    });

    it('returns 200 and publishes ACTION_APPROVED on success', async () => {
      mockGetProposal.mockResolvedValue(proposal);
      mockCreateIntent.mockResolvedValue(intent);
      const event = {
        pathParameters: { action_id: 'act1' },
        body: JSON.stringify({ decision_id: 'dec1' }),
        headers: { 'x-tenant-id': 't1' },
        requestContext: { authorizer: { userId: 'u1' } },
      } as unknown as APIGatewayProxyEvent;
      const res = await approveActionHandler(event);
      expect(res.statusCode).toBe(200);
      expect(parseBody(res).intent).toEqual(intent);
      expect(mockLedgerAppend).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: LedgerEventType.ACTION_APPROVED })
      );
      expect(mockEventBridgeSend).toHaveBeenCalledTimes(1);
      const sent = mockEventBridgeSend.mock.calls[0][0];
      const entries = (sent as { input?: { Entries?: Array<{ Detail?: string }> } }).input?.Entries ?? [];
      const detail = JSON.parse(entries[0]?.Detail ?? '{}');
      expect(detail.data?.approval_source).toBe('HUMAN');
      expect(detail.data?.auto_executed).toBe(false);
    });

    it('returns 500 when createIntent throws', async () => {
      mockGetProposal.mockResolvedValue(proposal);
      mockCreateIntent.mockRejectedValue(new Error('Intent failed'));
      const event = {
        pathParameters: { action_id: 'act1' },
        body: JSON.stringify({ decision_id: 'dec1' }),
        headers: { 'x-tenant-id': 't1' },
        requestContext: { authorizer: { userId: 'u1' } },
      } as unknown as APIGatewayProxyEvent;
      const res = await approveActionHandler(event);
      expect(res.statusCode).toBe(500);
    });
  });

  describe('rejectActionHandler', () => {
    const proposal = {
      decision_id: 'dec1',
      account_id: 'acc1',
      tenant_id: 't1',
      trace_id: 'trace1',
      actions: [{ action_ref: 'act1', action_type: 'EMAIL', target: 'user@example.com', why: ['reason'] }],
    };

    it('returns 400 when required fields missing', async () => {
      const event = {
        pathParameters: { action_id: 'act1' },
        body: JSON.stringify({ decision_id: 'dec1' }),
        headers: {},
        requestContext: { authorizer: { userId: 'u1' } },
      } as unknown as APIGatewayProxyEvent;
      const res = await rejectActionHandler(event);
      expect(res.statusCode).toBe(400);
    });

    it('returns 404 when decision not found', async () => {
      mockGetProposal.mockResolvedValue(null);
      const event = {
        pathParameters: { action_id: 'act1' },
        body: JSON.stringify({ decision_id: 'dec1' }),
        headers: { 'x-tenant-id': 't1' },
        requestContext: { authorizer: { userId: 'u1' } },
      } as unknown as APIGatewayProxyEvent;
      const res = await rejectActionHandler(event);
      expect(res.statusCode).toBe(404);
    });

    it('returns 404 when action not in proposal', async () => {
      mockGetProposal.mockResolvedValue(proposal);
      const event = {
        pathParameters: { action_id: 'other' },
        body: JSON.stringify({ decision_id: 'dec1' }),
        headers: { 'x-tenant-id': 't1' },
        requestContext: { authorizer: { userId: 'u1' } },
      } as unknown as APIGatewayProxyEvent;
      const res = await rejectActionHandler(event);
      expect(res.statusCode).toBe(404);
    });

    it('returns 200 and appends ACTION_REJECTED on success', async () => {
      mockGetProposal.mockResolvedValue(proposal);
      const event = {
        pathParameters: { action_id: 'act1' },
        body: JSON.stringify({ decision_id: 'dec1', reason: 'not needed' }),
        headers: { 'x-tenant-id': 't1' },
        requestContext: { authorizer: { userId: 'u1' } },
      } as unknown as APIGatewayProxyEvent;
      const res = await rejectActionHandler(event);
      expect(res.statusCode).toBe(200);
      expect(parseBody(res).message).toBe('Action rejected');
      expect(mockLedgerAppend).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: LedgerEventType.ACTION_REJECTED })
      );
    });

    it('returns 500 when ledger throws', async () => {
      mockGetProposal.mockResolvedValue(proposal);
      mockLedgerAppend.mockRejectedValueOnce(new Error('Ledger failed'));
      const event = {
        pathParameters: { action_id: 'act1' },
        body: JSON.stringify({ decision_id: 'dec1' }),
        headers: { 'x-tenant-id': 't1' },
        requestContext: { authorizer: { userId: 'u1' } },
      } as unknown as APIGatewayProxyEvent;
      const res = await rejectActionHandler(event);
      expect(res.statusCode).toBe(500);
    });
  });

  describe('getEvaluationStatusHandler', () => {
    it('returns 400 when evaluation_id or tenant_id missing', async () => {
      const event = {
        pathParameters: {},
        headers: {},
      } as unknown as APIGatewayProxyEvent;
      const res = await getEvaluationStatusHandler(event);
      expect(res.statusCode).toBe(400);
    });

    it('returns 404 when evaluation not in ledger', async () => {
      mockLedgerQuery.mockResolvedValue([]);
      const event = {
        pathParameters: { evaluation_id: 'eval_1' },
        headers: { 'x-tenant-id': 't1' },
      } as unknown as APIGatewayProxyEvent;
      const res = await getEvaluationStatusHandler(event);
      expect(res.statusCode).toBe(404);
    });

    it('returns 200 PENDING when only REQUESTED event exists', async () => {
      mockLedgerQuery
        .mockResolvedValueOnce([
          { data: { evaluation_id: 'eval_1' }, accountId: 'acc1', traceId: 'trace1', timestamp: '2025-01-01T00:00:00Z' },
        ])
        .mockResolvedValueOnce([]);
      const event = {
        pathParameters: { evaluation_id: 'eval_1' },
        headers: { 'x-tenant-id': 't1' },
      } as unknown as APIGatewayProxyEvent;
      const res = await getEvaluationStatusHandler(event);
      expect(res.statusCode).toBe(200);
      expect(parseBody(res).status).toBe('PENDING');
    });

    it('returns 200 COMPLETED when REQUESTED and PROPOSED exist', async () => {
      const evaluationEvent = {
        data: { evaluation_id: 'eval_1' },
        accountId: 'acc1',
        traceId: 'trace1',
        timestamp: '2025-01-01T00:00:00Z',
      };
      const decisionEvent = {
        data: { evaluation_id: 'eval_1', decision_id: 'dec1' },
        timestamp: '2025-01-01T00:01:00Z',
      };
      const proposal = { decision_id: 'dec1', account_id: 'acc1' };
      mockLedgerQuery
        .mockResolvedValueOnce([evaluationEvent])
        .mockResolvedValueOnce([decisionEvent]);
      mockGetProposal.mockResolvedValue(proposal);
      const event = {
        pathParameters: { evaluation_id: 'eval_1' },
        headers: { 'x-tenant-id': 't1' },
      } as unknown as APIGatewayProxyEvent;
      const res = await getEvaluationStatusHandler(event);
      expect(res.statusCode).toBe(200);
      const body = parseBody(res);
      expect(body.status).toBe('COMPLETED');
      expect(body.decision_id).toBe('dec1');
      expect(body.decision).toEqual(proposal);
    });

    it('returns 500 when ledger query throws', async () => {
      mockLedgerQuery.mockRejectedValue(new Error('Query failed'));
      const event = {
        pathParameters: { evaluation_id: 'eval_1' },
        headers: { 'x-tenant-id': 't1' },
      } as unknown as APIGatewayProxyEvent;
      const res = await getEvaluationStatusHandler(event);
      expect(res.statusCode).toBe(500);
    });
  });
});
