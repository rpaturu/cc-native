/**
 * DecisionSynthesisService Unit Tests - Phase 3
 *
 * Covers: raw JSON response, markdown-wrapped JSON, parse failure, Bedrock 404,
 * schema validation failure, action_ref assignment.
 */

import { DecisionSynthesisService } from '../../../services/decision/DecisionSynthesisService';
import type { DecisionContextV1 } from '../../../types/DecisionTypes';
import { LifecycleState } from '../../../types/SignalTypes';

const mockSend = jest.fn();
const mockLogger = {
  debug: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
} as any;

const bedrockClient = { send: mockSend } as any;
const modelId = 'anthropic.claude-3-5-sonnet-20241022-v2:0';
const service = new DecisionSynthesisService(bedrockClient, modelId, mockLogger);

const minimalContext = {
  account_id: 'acc1',
  tenant_id: 't1',
  trace_id: 'trace-1',
  lifecycle_state: LifecycleState.CUSTOMER,
  posture_state: { posture: 'HEALTHY' },
  risk_factors: [],
  opportunities: [],
  unknowns: [],
  active_signals: [],
  graph_context_refs: [],
  policy_context: {
    tenant_id: 't1',
    min_confidence_threshold: 0.7,
    action_type_permissions: {} as Record<string, { default_approval_required: boolean }>,
    cost_budget_remaining: 100,
  },
} as unknown as DecisionContextV1;

const validProposalBody = {
  decision_type: 'PROPOSE_ACTIONS',
  decision_reason_codes: [] as string[],
  decision_version: 'v1',
  schema_version: 'v1',
  summary: 'Test summary for account.',
  actions: [
    {
      action_type: 'CREATE_INTERNAL_NOTE',
      why: ['RENEWAL_WINDOW_ENTERED'],
      confidence: 0.9,
      risk_level: 'LOW',
      llm_suggests_human_review: false,
      blocking_unknowns: [],
      parameters: {},
      target: { entity_type: 'ACCOUNT' as const, entity_id: 'acc1' },
    },
  ],
};

function bedrockResponse(text: string): { body: Uint8Array } {
  return {
    body: new TextEncoder().encode(
      JSON.stringify({ content: [{ text }] })
    ),
  };
}

describe('DecisionSynthesisService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('parses raw JSON and returns enriched proposal with decision_id and action_ref', async () => {
    mockSend.mockResolvedValue(bedrockResponse(JSON.stringify(validProposalBody)));

    const result = await service.synthesizeDecision(minimalContext);

    expect(result.decision_id).toBeDefined();
    expect(result.account_id).toBe('acc1');
    expect(result.tenant_id).toBe('t1');
    expect(result.trace_id).toBe('trace-1');
    expect(result.proposal_fingerprint).toBeDefined();
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0].action_ref).toBeDefined();
    expect(result.actions[0].action_ref).toMatch(/^action_ref_[a-f0-9]{16}$/);
    expect(result.actions[0].action_type).toBe('CREATE_INTERNAL_NOTE');
  });

  it('extracts JSON from markdown code block when raw parse fails', async () => {
    const wrapped = '```json\n' + JSON.stringify(validProposalBody) + '\n```';
    mockSend.mockResolvedValue(bedrockResponse(wrapped));

    const result = await service.synthesizeDecision(minimalContext);

    expect(result.decision_id).toBeDefined();
    expect(result.summary).toBe(validProposalBody.summary);
    expect(result.actions).toHaveLength(1);
  });

  it('throws when response contains no valid JSON', async () => {
    mockSend.mockResolvedValue(bedrockResponse('Plain text with no JSON at all.'));

    await expect(service.synthesizeDecision(minimalContext)).rejects.toThrow(
      /Failed to parse JSON from Bedrock response/
    );
  });

  it('throws when Bedrock returns 404 (model not found)', async () => {
    const err = new Error('Model not found') as Error & { name?: string; $metadata?: { httpStatusCode?: number } };
    err.name = 'ResourceNotFoundException';
    mockSend.mockRejectedValue(err);

    await expect(service.synthesizeDecision(minimalContext)).rejects.toThrow(
      /Bedrock model not found/
    );
  });

  it('throws when Bedrock returns httpStatusCode 404', async () => {
    const err = new Error('Not found') as Error & { $metadata?: { httpStatusCode?: number } };
    err.$metadata = { httpStatusCode: 404 };
    mockSend.mockRejectedValue(err);

    await expect(service.synthesizeDecision(minimalContext)).rejects.toThrow(
      /Bedrock model not found/
    );
  });

  it('throws when JSON fails schema validation (missing required fields)', async () => {
    const invalidBody = { decision_type: 'PROPOSE_ACTIONS' }; // missing summary, actions, etc.
    mockSend.mockResolvedValue(bedrockResponse(JSON.stringify(invalidBody)));

    await expect(service.synthesizeDecision(minimalContext)).rejects.toThrow();
  });

  it('assigns stable action_ref per action (two actions get two refs)', async () => {
    const twoActionsBody = {
      ...validProposalBody,
      actions: [
        {
          action_type: 'CREATE_INTERNAL_NOTE',
          why: ['REASON_A'],
          confidence: 0.9,
          risk_level: 'LOW',
          llm_suggests_human_review: false,
          blocking_unknowns: [],
          parameters: {},
          target: { entity_type: 'ACCOUNT' as const, entity_id: 'acc1' },
        },
        {
          action_type: 'CREATE_INTERNAL_TASK',
          why: ['REASON_B'],
          confidence: 0.8,
          risk_level: 'LOW',
          llm_suggests_human_review: false,
          blocking_unknowns: [],
          parameters: {},
          target: { entity_type: 'ACCOUNT' as const, entity_id: 'acc1' },
        },
      ],
    };
    mockSend.mockResolvedValue(bedrockResponse(JSON.stringify(twoActionsBody)));

    const result = await service.synthesizeDecision(minimalContext);

    expect(result.actions).toHaveLength(2);
    const refs = result.actions.map((a) => a.action_ref);
    expect(refs[0]).not.toBe(refs[1]);
    expect(refs[0]).toMatch(/^action_ref_[a-f0-9]{16}$/);
    expect(refs[1]).toMatch(/^action_ref_[a-f0-9]{16}$/);
  });
});
