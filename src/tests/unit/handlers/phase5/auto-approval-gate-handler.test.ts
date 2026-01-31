/**
 * Unit tests for auto-approval-gate-handler - Phase 5.4
 *
 * Tests: missing input, intent not found, allowlist reject (mocked services).
 */

jest.mock('../../../../utils/aws-client-config', () => ({
  getAWSClientConfig: jest.fn(() => ({})),
}));

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn().mockReturnValue({ send: jest.fn() }),
  },
}));

jest.mock('@aws-sdk/client-eventbridge', () => ({
  EventBridgeClient: jest.fn().mockImplementation(() => ({ send: jest.fn() })),
  PutEventsCommand: jest.fn(),
}));

const mockGetIntent = jest.fn();
const mockIsAllowlisted = jest.fn();
const mockGetMode = jest.fn();
const mockGetState = jest.fn();
const mockCheckAndConsume = jest.fn();
const mockSetReserved = jest.fn();
const mockSetPublished = jest.fn();

jest.mock('../../../../services/decision/ActionIntentService', () => ({
  ActionIntentService: jest.fn().mockImplementation(() => ({ getIntent: mockGetIntent })),
}));

jest.mock('../../../../services/autonomy/AutoExecuteAllowListService', () => ({
  AutoExecuteAllowListService: jest.fn().mockImplementation(() => ({ isAllowlisted: mockIsAllowlisted })),
}));

jest.mock('../../../../services/autonomy/AutonomyModeService', () => ({
  AutonomyModeService: jest.fn().mockImplementation(() => ({ getMode: mockGetMode })),
}));

jest.mock('../../../../services/autonomy/AutoExecStateService', () => ({
  AutoExecStateService: jest.fn().mockImplementation(() => ({
    getState: mockGetState,
    setReserved: mockSetReserved,
    setPublished: mockSetPublished,
  })),
}));

jest.mock('../../../../services/autonomy/AutonomyBudgetService', () => ({
  AutonomyBudgetService: jest.fn().mockImplementation(() => ({ checkAndConsume: mockCheckAndConsume })),
}));

jest.mock('../../../../services/autonomy/AutoApprovalPolicyEngine', () => ({
  evaluateAutoApprovalPolicy: jest.fn(),
}));

import type { AutoApprovalGateResponse } from '../../../../handlers/phase5/auto-approval-gate-handler';

const mockContext = {} as any;
let handler: (event: any, context: any, callback: any) => Promise<AutoApprovalGateResponse | void>;

function assertResponse(result: unknown): asserts result is AutoApprovalGateResponse {
  expect(result).toBeDefined();
  expect(typeof (result as AutoApprovalGateResponse).result).toBe('string');
}

describe('auto-approval-gate-handler', () => {
  beforeAll(() => {
    process.env.AUTONOMY_CONFIG_TABLE_NAME = 'test-autonomy-config';
    process.env.AUTONOMY_BUDGET_STATE_TABLE_NAME = 'test-autonomy-budget-state';
    process.env.ACTION_INTENT_TABLE_NAME = 'test-action-intent';
    process.env.EVENT_BUS_NAME = 'test-events';
    jest.resetModules();
    const mod = require('../../../../handlers/phase5/auto-approval-gate-handler');
    handler = mod.handler;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns REQUIRE_APPROVAL when action_intent_id is missing', async () => {
    const result = (await handler(
      { action_intent_id: '', tenant_id: 't1', account_id: 'a1' },
      mockContext,
      jest.fn()
    )) as AutoApprovalGateResponse;
    assertResponse(result);
    expect(result.result).toBe('REQUIRE_APPROVAL');
    expect(result.reason).toBe('MISSING_INPUT');
    expect(mockGetIntent).not.toHaveBeenCalled();
  });

  it('returns REQUIRE_APPROVAL when tenant_id is missing', async () => {
    const result = (await handler(
      { action_intent_id: 'ai_1', tenant_id: '', account_id: 'a1' },
      mockContext,
      jest.fn()
    )) as AutoApprovalGateResponse;
    assertResponse(result);
    expect(result.result).toBe('REQUIRE_APPROVAL');
    expect(result.reason).toBe('MISSING_INPUT');
  });

  it('returns REQUIRE_APPROVAL when intent not found', async () => {
    mockGetIntent.mockResolvedValue(null);
    const result = (await handler(
      { action_intent_id: 'ai_1', tenant_id: 't1', account_id: 'a1' },
      mockContext,
      jest.fn()
    )) as AutoApprovalGateResponse;
    assertResponse(result);
    expect(result.result).toBe('REQUIRE_APPROVAL');
    expect(result.reason).toBe('INTENT_NOT_FOUND');
    expect(mockGetIntent).toHaveBeenCalledWith('ai_1', 't1', 'a1');
  });

  it('returns REQUIRE_APPROVAL with ACTION_TYPE_NOT_ALLOWLISTED when not allowlisted', async () => {
    mockGetIntent.mockResolvedValue({
      action_intent_id: 'ai_1',
      action_type: 'REQUEST_RENEWAL_MEETING',
      tenant_id: 't1',
      account_id: 'a1',
    });
    mockIsAllowlisted.mockResolvedValue(false);
    const result = (await handler(
      { action_intent_id: 'ai_1', tenant_id: 't1', account_id: 'a1' },
      mockContext,
      jest.fn()
    )) as AutoApprovalGateResponse;
    assertResponse(result);
    expect(result.result).toBe('REQUIRE_APPROVAL');
    expect(result.reason).toBe('ACTION_TYPE_NOT_ALLOWLISTED');
    expect(mockGetMode).not.toHaveBeenCalled();
  });
});
