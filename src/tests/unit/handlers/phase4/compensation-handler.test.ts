/**
 * Compensation Handler Unit Tests - Phase 4
 * Invokes handler from handlers/phase4/compensation-handler.ts
 */

const mockGetIntent = jest.fn();
const mockGetToolMapping = jest.fn();

jest.mock('../../../../utils/aws-client-config', () => ({
  getAWSClientConfig: jest.fn().mockReturnValue({ region: 'us-east-1' }),
}));

jest.mock('@aws-sdk/client-dynamodb', () => {
  const actual = jest.requireActual('@aws-sdk/client-dynamodb');
  return { ...actual, DynamoDBClient: jest.fn().mockImplementation(() => ({})) };
});

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn().mockReturnValue({ send: jest.fn() }),
  },
}));

jest.mock('../../../../services/decision/ActionIntentService', () => ({
  ActionIntentService: jest.fn().mockImplementation(() => ({
    getIntent: mockGetIntent,
  })),
}));

jest.mock('../../../../services/execution/ActionTypeRegistryService', () => ({
  ActionTypeRegistryService: jest.fn().mockImplementation(() => ({
    getToolMapping: mockGetToolMapping,
  })),
}));

jest.mock('../../../../services/execution/ExecutionOutcomeService', () => ({
  ExecutionOutcomeService: jest.fn().mockImplementation(() => ({})),
}));

import { handler } from '../../../../handlers/phase4/compensation-handler';

const validEvent = {
  action_intent_id: 'ai1',
  tenant_id: 't1',
  account_id: 'acc1',
  trace_id: 'trace1',
  registry_version: 1,
  execution_result: {
    success: false,
    external_object_refs: [{ system: 'CRM', object_type: 'Task', object_id: 'task1' }],
    tool_run_ref: 'run1',
  },
};

const mockIntent = {
  action_type: 'CREATE_TASK',
  registry_version: 1,
};

describe('CompensationHandler (handler-invoking)', () => {
  beforeEach(() => {
    mockGetIntent.mockClear();
    mockGetToolMapping.mockClear();
    mockGetIntent.mockResolvedValue(mockIntent);
    mockGetToolMapping.mockResolvedValue({
      tool_name: 'crm___create_task',
      compensation_strategy: 'MANUAL',
    });
  });

  it('should return FAILED when ActionIntent not found', async () => {
    mockGetIntent.mockResolvedValueOnce(null);

    const result = await handler(validEvent as any, {} as any, jest.fn());

    expect(result).toEqual({
      compensation_status: 'FAILED',
      compensation_error: expect.stringContaining('ActionIntent not found'),
    });
  });

  it('should return NONE when compensation_strategy is NONE', async () => {
    mockGetToolMapping.mockResolvedValueOnce({
      tool_name: 'crm___create_task',
      compensation_strategy: 'NONE',
    });

    const result = await handler(validEvent as any, {} as any, jest.fn());

    expect(result).toEqual({
      compensation_status: 'NONE',
      reason: 'Compensation not supported for this action type',
    });
  });

  it('should return COMPLETED when no external_object_refs', async () => {
    const event = { ...validEvent, execution_result: { success: false, external_object_refs: [], tool_run_ref: 'run1' } };

    const result = await handler(event as any, {} as any, jest.fn());

    expect(result).toEqual({
      compensation_status: 'COMPLETED',
      reason: 'No external objects created',
    });
  });

  it('should return PENDING for AUTOMATIC (deferred)', async () => {
    mockGetToolMapping.mockResolvedValueOnce({
      tool_name: 'crm___create_task',
      compensation_strategy: 'AUTOMATIC',
    });

    const result = await handler(validEvent as any, {} as any, jest.fn());

    expect(result).toEqual({
      compensation_status: 'PENDING',
      reason: 'Automatic compensation implementation deferred to Phase 4.3/4.4',
    });
  });

  it('should return PENDING for MANUAL', async () => {
    const result = await handler(validEvent as any, {} as any, jest.fn());

    expect(result).toEqual({
      compensation_status: 'PENDING',
      reason: 'Requires manual compensation',
    });
  });
});
