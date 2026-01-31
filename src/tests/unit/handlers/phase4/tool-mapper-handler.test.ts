/**
 * Tool Mapper Handler Unit Tests - Phase 4
 * Invokes handler from handlers/phase4/tool-mapper-handler.ts
 */

const mockGetIntent = jest.fn();
const mockGetToolMapping = jest.fn();
const mockMapParametersToToolArguments = jest.fn();

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
    mapParametersToToolArguments: mockMapParametersToToolArguments,
  })),
}));

import { handler } from '../../../../handlers/phase4/tool-mapper-handler';

const validEvent = {
  action_intent_id: 'ai1',
  tenant_id: 't1',
  account_id: 'acc1',
  idempotency_key: 'key1',
  trace_id: 'trace1',
  registry_version: 1,
  attempt_count: 1,
  started_at: new Date().toISOString(),
};

const mockIntent = {
  action_type: 'CREATE_TASK',
  parameters: { title: 'Task' },
  trace_id: 'decision-trace-1',
};

const mockToolMapping = {
  tool_name: 'crm___create_task',
  tool_schema_version: '1.0',
  compensation_strategy: 'MANUAL',
};

describe('ToolMapperHandler (handler-invoking)', () => {
  beforeEach(() => {
    mockGetIntent.mockClear();
    mockGetToolMapping.mockClear();
    mockMapParametersToToolArguments.mockClear();
    mockGetIntent.mockResolvedValue(mockIntent);
    mockGetToolMapping.mockResolvedValue(mockToolMapping);
    mockMapParametersToToolArguments.mockReturnValue({ title: 'Task' });
  });

  it('should validate input and throw on invalid event', async () => {
    await expect(handler({} as any, {} as any, jest.fn())).rejects.toThrow(/Invalid Step Functions input/);
    expect(mockGetIntent).not.toHaveBeenCalled();
  });

  it('should return gateway_url, tool_name, tool_arguments on valid event', async () => {
    const result = await handler(validEvent as any, {} as any, jest.fn());

    expect(mockGetIntent).toHaveBeenCalledWith('ai1', 't1', 'acc1');
    expect(mockGetToolMapping).toHaveBeenCalledWith('CREATE_TASK', 1);
    expect(mockMapParametersToToolArguments).toHaveBeenCalled();
    expect(result).toHaveProperty('gateway_url', 'https://test.example.com');
    expect(result).toHaveProperty('tool_name');
    expect(result).toHaveProperty('tool_arguments');
    expect(result).toHaveProperty('tool_schema_version', '1.0');
    expect(result).toHaveProperty('registry_version', 1);
    expect(result).toHaveProperty('action_intent_id', 'ai1');
  });

  it('should throw when ActionIntent not found', async () => {
    mockGetIntent.mockResolvedValueOnce(null);

    await expect(handler(validEvent as any, {} as any, jest.fn())).rejects.toThrow(/ActionIntent not found/);
  });

  it('should throw when tool mapping not found', async () => {
    mockGetToolMapping.mockResolvedValueOnce(null);

    await expect(handler(validEvent as any, {} as any, jest.fn())).rejects.toThrow(/Tool mapping not found/);
  });
});
