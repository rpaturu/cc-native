/**
 * Decision Evaluation Handler Unit Tests - Phase 3
 *
 * Covers: budget block, happy path (synthesis, store, ledger, EventBridge), error paths.
 */

process.env.AWS_REGION = 'us-west-2';
process.env.EVENT_BUS_NAME = 'test-bus';

const mockAssembleContext = jest.fn();
const mockCanEvaluateDecision = jest.fn();
const mockConsumeBudget = jest.fn().mockResolvedValue(undefined);
const mockSynthesizeDecision = jest.fn();
const mockEvaluateDecisionProposal = jest.fn();
const mockStoreProposal = jest.fn().mockResolvedValue(undefined);
const mockLedgerAppend = jest.fn().mockResolvedValue({});
const mockEventBridgeSend = jest.fn().mockResolvedValue({});

jest.mock('../../../../services/core/Logger');
jest.mock('../../../../services/core/TraceService', () => ({
  TraceService: jest.fn().mockImplementation(() => ({
    generateTraceId: jest.fn().mockReturnValue('trace-1'),
  })),
}));
jest.mock('../../../../utils/aws-client-config', () => ({
  getAWSClientConfig: jest.fn(() => ({})),
}));
jest.mock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: jest.fn() }));
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn(() => ({})) },
}));
jest.mock('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: jest.fn(),
}));
jest.mock('@aws-sdk/client-eventbridge', () => ({
  EventBridgeClient: jest.fn().mockImplementation(() => ({ send: mockEventBridgeSend })),
  PutEventsCommand: jest.fn().mockImplementation(function (this: { input: unknown }, input: unknown) {
    this.input = input;
  }),
}));
jest.mock('../../../../services/ledger/LedgerService', () => ({
  LedgerService: jest.fn().mockImplementation(() => ({
    append: mockLedgerAppend,
    query: jest.fn().mockResolvedValue([]),
  })),
}));
jest.mock('../../../../services/synthesis/AccountPostureStateService', () => ({
  AccountPostureStateService: jest.fn().mockImplementation(() => ({})),
}));
jest.mock('../../../../services/perception/SignalService', () => ({
  SignalService: jest.fn().mockImplementation(() => ({})),
}));
jest.mock('../../../../services/graph/NeptuneConnection', () => ({
  NeptuneConnection: {
    getInstance: jest.fn().mockReturnValue({
      initialize: jest.fn().mockResolvedValue(undefined),
    }),
  },
}));
jest.mock('../../../../services/graph/GraphService', () => ({
  GraphService: jest.fn().mockImplementation(() => ({})),
}));
jest.mock('../../../../services/core/TenantService', () => ({
  TenantService: jest.fn().mockImplementation(() => ({})),
}));
jest.mock('../../../../services/decision/DecisionContextAssembler', () => ({
  DecisionContextAssembler: jest.fn().mockImplementation(() => ({
    assembleContext: mockAssembleContext,
  })),
}));
jest.mock('../../../../services/decision/DecisionSynthesisService', () => ({
  DecisionSynthesisService: jest.fn().mockImplementation(() => ({
    synthesizeDecision: mockSynthesizeDecision,
  })),
}));
jest.mock('../../../../services/decision/PolicyGateService', () => ({
  PolicyGateService: jest.fn().mockImplementation(() => ({
    evaluateDecisionProposal: mockEvaluateDecisionProposal,
  })),
}));
jest.mock('../../../../services/decision/CostBudgetService', () => ({
  CostBudgetService: jest.fn().mockImplementation(() => ({
    canEvaluateDecision: mockCanEvaluateDecision,
    consumeBudget: mockConsumeBudget,
  })),
}));
jest.mock('../../../../services/decision/DecisionProposalStore', () => ({
  DecisionProposalStore: jest.fn().mockImplementation(() => ({
    storeProposal: mockStoreProposal,
  })),
}));

import { handler } from '../../../../handlers/phase3/decision-evaluation-handler';
import { LedgerEventType } from '../../../../types/LedgerTypes';

const minimalContext = {
  account_id: 'acc1',
  tenant_id: 't1',
  trace_id: 'trace-1',
  posture_state: {} as any,
  risk_factors: [],
  opportunities: [],
  unknowns: [],
  active_signals: [],
  policy_context: {
    min_confidence_threshold: 0.7,
    action_type_permissions: {} as any,
  },
};

const minimalProposal = {
  decision_id: 'dec_1',
  account_id: 'acc1',
  tenant_id: 't1',
  trace_id: 'trace-1',
  decision_type: 'PROPOSE_ACTIONS' as const,
  summary: 'Test proposal',
  actions: [{ action_ref: 'act_1', action_type: 'CREATE_INTERNAL_NOTE', target: 'note', why: ['reason'] }],
  decision_reason_codes: [],
  decision_version: 'v1',
  schema_version: 'v1',
  created_at: new Date().toISOString(),
  proposal_fingerprint: 'fp1',
};

function makeEvent(overrides: Record<string, unknown> = {}) {
  return {
    source: 'cc-native.decision',
    'detail-type': 'DECISION_EVALUATION_REQUESTED',
    detail: {
      account_id: 'acc1',
      tenant_id: 't1',
      trigger_type: 'LIFECYCLE_TRANSITION',
      evaluation_id: 'eval_1',
      trace_id: 'trace-1',
      ...overrides,
    },
  };
}

describe('DecisionEvaluationHandler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAssembleContext.mockResolvedValue(minimalContext);
    mockCanEvaluateDecision.mockResolvedValue({ allowed: true });
    mockSynthesizeDecision.mockResolvedValue(minimalProposal);
    mockEvaluateDecisionProposal.mockResolvedValue([{ policy_id: 'p1', allowed: true }]);
  });

  it('returns early when budget not allowed', async () => {
    mockCanEvaluateDecision.mockResolvedValue({ allowed: false, reason: 'daily limit' });
    const event = makeEvent();

    await handler(event as any, {} as any, jest.fn());

    expect(mockAssembleContext).toHaveBeenCalled();
    expect(mockCanEvaluateDecision).toHaveBeenCalledWith('acc1', 't1');
    expect(mockSynthesizeDecision).not.toHaveBeenCalled();
    expect(mockStoreProposal).not.toHaveBeenCalled();
    expect(mockEventBridgeSend).not.toHaveBeenCalled();
  });

  it('synthesizes, stores, appends ledger, and publishes DECISION_PROPOSED on success', async () => {
    const event = makeEvent();

    await handler(event as any, {} as any, jest.fn());

    expect(mockAssembleContext).toHaveBeenCalledWith('acc1', 't1', 'trace-1');
    expect(mockCanEvaluateDecision).toHaveBeenCalledWith('acc1', 't1');
    expect(mockSynthesizeDecision).toHaveBeenCalledWith(minimalContext);
    expect(mockConsumeBudget).toHaveBeenCalledWith('acc1', 't1', 1);
    expect(mockStoreProposal).toHaveBeenCalledWith(minimalProposal);
    expect(mockLedgerAppend).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: LedgerEventType.DECISION_PROPOSED,
        tenantId: 't1',
        accountId: 'acc1',
        data: expect.objectContaining({ decision_id: 'dec_1', evaluation_id: 'eval_1' }),
      })
    );
    expect(mockEventBridgeSend).toHaveBeenCalledTimes(1);
    const sent = mockEventBridgeSend.mock.calls[0][0];
    const entries = (sent as { input?: { Entries?: Array<{ Detail?: string }> } }).input?.Entries ?? [];
    expect(entries.length).toBe(1);
    const detail = JSON.parse(entries[0]?.Detail ?? '{}');
    expect(detail.decision.decision_id).toBe('dec_1');
    expect(detail.policy_evaluations).toHaveLength(1);
  });

  it('appends POLICY_EVALUATED for each policy result', async () => {
    mockEvaluateDecisionProposal.mockResolvedValue([
      { policy_id: 'p1', allowed: true },
      { policy_id: 'p2', allowed: false },
    ]);
    const event = makeEvent();

    await handler(event as any, {} as any, jest.fn());

    expect(mockLedgerAppend).toHaveBeenCalledTimes(3); // 1 DECISION_PROPOSED + 2 POLICY_EVALUATED
    const policyCalls = mockLedgerAppend.mock.calls.filter(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === LedgerEventType.POLICY_EVALUATED
    );
    expect(policyCalls).toHaveLength(2);
  });

  it('propagates error when synthesizeDecision throws', async () => {
    mockSynthesizeDecision.mockRejectedValue(new Error('Bedrock failed'));
    const event = makeEvent();

    await expect(handler(event as any, {} as any, jest.fn())).rejects.toThrow('Bedrock failed');
    expect(mockStoreProposal).not.toHaveBeenCalled();
    expect(mockEventBridgeSend).not.toHaveBeenCalled();
  });

  it('propagates error when storeProposal throws', async () => {
    mockStoreProposal.mockRejectedValueOnce(new Error('Dynamo failed'));
    const event = makeEvent();

    await expect(handler(event as any, {} as any, jest.fn())).rejects.toThrow('Dynamo failed');
    expect(mockEventBridgeSend).not.toHaveBeenCalled();
  });
});
