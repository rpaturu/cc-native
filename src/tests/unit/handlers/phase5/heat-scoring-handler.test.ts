/**
 * Unit tests for heat-scoring-handler - Phase 5.3
 *
 * Mocks: HeatScoringService and its dependencies (DynamoDB, AccountPostureStateService, SignalService).
 */

const mockComputeAndStoreHeat = jest.fn();

jest.mock('../../../../utils/aws-client-config', () => ({
  getAWSClientConfig: jest.fn(() => ({})),
}));

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn().mockReturnValue({}),
  },
}));

jest.mock('../../../../services/synthesis/AccountPostureStateService', () => ({
  AccountPostureStateService: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('../../../../services/perception/SignalService', () => ({
  SignalService: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('../../../../services/perception/HeatTierPolicyService', () => ({
  HeatTierPolicyService: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('../../../../services/perception/HeatScoringService', () => ({
  HeatScoringService: jest.fn().mockImplementation(() => ({
    computeAndStoreHeat: mockComputeAndStoreHeat,
  })),
}));

import { handler } from '../../../../handlers/phase5/heat-scoring-handler';

const mockContext = {} as any;

describe('heat-scoring-handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockComputeAndStoreHeat.mockResolvedValue(undefined);
  });

  it('returns computed: 0 when event missing tenantId', async () => {
    const result = await handler({ accountId: 'a1' } as any, mockContext, jest.fn());
    expect(result).toEqual({ computed: 0, errors: [] });
    expect(mockComputeAndStoreHeat).not.toHaveBeenCalled();
  });

  it('returns computed: 0 when event missing accountId(s)', async () => {
    const result = await handler({ tenantId: 't1' } as any, mockContext, jest.fn());
    expect(result).toEqual({ computed: 0, errors: [] });
    expect(mockComputeAndStoreHeat).not.toHaveBeenCalled();
  });

  it('normalizes detail.tenant_id and detail.account_id from EventBridge', async () => {
    mockComputeAndStoreHeat.mockResolvedValue(undefined);
    const result = await handler(
      {
        'detail-type': 'SIGNAL_DETECTED',
        detail: { tenant_id: 't1', account_id: 'a1' },
      } as any,
      mockContext,
      jest.fn()
    );
    expect(mockComputeAndStoreHeat).toHaveBeenCalledWith('t1', 'a1');
    expect(result.computed).toBe(1);
    expect(result.errors).toEqual([]);
  });

  it('calls computeAndStoreHeat for tenantId and accountId', async () => {
    const result = await handler(
      { tenantId: 't1', accountId: 'a1' },
      mockContext,
      jest.fn()
    );
    expect(mockComputeAndStoreHeat).toHaveBeenCalledWith('t1', 'a1');
    expect(result).toEqual({ computed: 1, errors: [] });
  });

  it('calls computeAndStoreHeat for each accountId in accountIds', async () => {
    const result = await handler(
      { tenantId: 't1', accountIds: ['a1', 'a2', 'a3'] },
      mockContext,
      jest.fn()
    );
    expect(mockComputeAndStoreHeat).toHaveBeenCalledTimes(3);
    expect(mockComputeAndStoreHeat).toHaveBeenNthCalledWith(1, 't1', 'a1');
    expect(mockComputeAndStoreHeat).toHaveBeenNthCalledWith(2, 't1', 'a2');
    expect(mockComputeAndStoreHeat).toHaveBeenNthCalledWith(3, 't1', 'a3');
    expect(result).toEqual({ computed: 3, errors: [] });
  });

  it('collects errors when computeAndStoreHeat throws for an account', async () => {
    mockComputeAndStoreHeat
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('DDB error'))
      .mockResolvedValueOnce(undefined);
    const result = await handler(
      { tenantId: 't1', accountIds: ['a1', 'a2', 'a3'] },
      mockContext,
      jest.fn()
    );
    expect(result.computed).toBe(2);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].accountId).toBe('a2');
    expect(result.errors[0].error).toBe('DDB error');
  });
});
