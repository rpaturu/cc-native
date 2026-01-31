/**
 * Unit tests for perception-pull-orchestrator-handler - Phase 5.3
 *
 * Mocks: PerceptionPullOrchestrator and its dependencies (DynamoDB, budget, idempotency services).
 */

const mockSchedulePull = jest.fn();

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

jest.mock('../../../../services/perception/PerceptionPullBudgetService', () => ({
  PerceptionPullBudgetService: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('../../../../services/perception/PullIdempotencyStoreService', () => ({
  PullIdempotencyStoreService: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('../../../../services/perception/HeatTierPolicyService', () => ({
  HeatTierPolicyService: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('../../../../services/perception/PerceptionPullOrchestrator', () => ({
  PerceptionPullOrchestrator: jest.fn().mockImplementation(() => ({
    schedulePull: mockSchedulePull,
  })),
}));

import { handler } from '../../../../handlers/phase5/perception-pull-orchestrator-handler';

const mockContext = {} as any;

describe('perception-pull-orchestrator-handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSchedulePull.mockResolvedValue({ scheduled: true });
  });

  it('returns scheduled: 0 when event has no jobs', async () => {
    const result = await handler({}, mockContext, jest.fn());
    expect(result).toEqual({ scheduled: 0, skipped: 0, results: [] });
    expect(mockSchedulePull).not.toHaveBeenCalled();
  });

  it('normalizes single job from tenantId, accountId, connectorId, pullJobId', async () => {
    const result = await handler(
      {
        tenantId: 't1',
        accountId: 'a1',
        connectorId: 'crm',
        pullJobId: 'job-1',
        depth: 'DEEP',
        correlationId: 'corr-1',
      },
      mockContext,
      jest.fn()
    );
    expect(mockSchedulePull).toHaveBeenCalledWith({
      tenantId: 't1',
      accountId: 'a1',
      connectorId: 'crm',
      pullJobId: 'job-1',
      depth: 'DEEP',
      correlationId: 'corr-1',
    });
    expect(result).toEqual({ scheduled: 1, skipped: 0, results: expect.any(Array) });
    expect(result.results).toHaveLength(1);
    expect(result.results[0].pullJobId).toBe('job-1');
    expect(result.results[0].scheduled).toBe(true);
  });

  it('uses SHALLOW when depth omitted', async () => {
    await handler(
      {
        tenantId: 't1',
        accountId: 'a1',
        connectorId: 'crm',
        pullJobId: 'job-1',
      },
      mockContext,
      jest.fn()
    );
    expect(mockSchedulePull).toHaveBeenCalledWith(
      expect.objectContaining({ depth: 'SHALLOW' })
    );
  });

  it('uses event.jobs when provided', async () => {
    mockSchedulePull
      .mockResolvedValueOnce({ scheduled: true })
      .mockResolvedValueOnce({ scheduled: false, reason: 'RATE_LIMIT' });
    const result = await handler(
      {
        jobs: [
          { tenantId: 't1', accountId: 'a1', connectorId: 'crm', pullJobId: 'j1', depth: 'SHALLOW' },
          { tenantId: 't1', accountId: 'a2', connectorId: 'crm', pullJobId: 'j2', depth: 'DEEP' },
        ],
      },
      mockContext,
      jest.fn()
    );
    expect(mockSchedulePull).toHaveBeenCalledTimes(2);
    expect(mockSchedulePull).toHaveBeenNthCalledWith(1, {
      tenantId: 't1',
      accountId: 'a1',
      connectorId: 'crm',
      pullJobId: 'j1',
      depth: 'SHALLOW',
    });
    expect(mockSchedulePull).toHaveBeenNthCalledWith(2, {
      tenantId: 't1',
      accountId: 'a2',
      connectorId: 'crm',
      pullJobId: 'j2',
      depth: 'DEEP',
    });
    expect(result.scheduled).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.results[0].scheduled).toBe(true);
    expect(result.results[1].scheduled).toBe(false);
    expect(result.results[1].reason).toBe('RATE_LIMIT');
  });
});
