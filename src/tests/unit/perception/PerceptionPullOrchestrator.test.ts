/**
 * Unit tests for PerceptionPullOrchestrator - Phase 5.3
 */

import { mockDynamoDBDocumentClient, resetAllMocks } from '../../__mocks__/aws-sdk-clients';
import { PerceptionPullOrchestrator } from '../../../services/perception/PerceptionPullOrchestrator';
import { PerceptionPullBudgetService } from '../../../services/perception/PerceptionPullBudgetService';
import { PullIdempotencyStoreService } from '../../../services/perception/PullIdempotencyStoreService';
import { HeatTierPolicyService } from '../../../services/perception/HeatTierPolicyService';
import { Logger } from '../../../services/core/Logger';
import { DUPLICATE_PULL_JOB_ID } from '../../../types/perception/PerceptionSchedulerTypes';

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn(() => mockDynamoDBDocumentClient) },
  GetCommand: jest.fn(),
  PutCommand: jest.fn(),
  UpdateCommand: jest.fn(),
  TransactWriteCommand: jest.fn(),
}));

const logger = new Logger('PerceptionPullOrchestratorTest');

describe('PerceptionPullOrchestrator', () => {
  const budgetTable = 'test-pull-budget';
  const idempotencyTable = 'test-pull-idempotency';
  let budgetService: PerceptionPullBudgetService;
  let idempotencyService: PullIdempotencyStoreService;
  let heatTierPolicyService: HeatTierPolicyService;
  let orchestrator: PerceptionPullOrchestrator;

  beforeEach(() => {
    resetAllMocks();
    jest.clearAllMocks();
    budgetService = new PerceptionPullBudgetService(
      mockDynamoDBDocumentClient as any,
      budgetTable,
      logger
    );
    idempotencyService = new PullIdempotencyStoreService(
      mockDynamoDBDocumentClient as any,
      idempotencyTable,
      logger
    );
    heatTierPolicyService = new HeatTierPolicyService();
    orchestrator = new PerceptionPullOrchestrator({
      perceptionPullBudgetService: budgetService,
      pullIdempotencyStoreService: idempotencyService,
      heatTierPolicyService,
      logger,
    });
  });

  it('schedulePull returns scheduled: true and job when all steps pass', async () => {
    mockDynamoDBDocumentClient.send
      .mockResolvedValueOnce({}) // tryReserve (PutCommand)
      .mockResolvedValueOnce({ Item: { max_pull_units_per_day: 100 } }) // getConfig inside checkAndConsume
      .mockResolvedValueOnce({}); // UpdateCommand for checkAndConsume

    const result = await orchestrator.schedulePull({
      tenantId: 't1',
      accountId: 'a1',
      connectorId: 'crm',
      pullJobId: 'job-123',
      depth: 'SHALLOW',
    });

    expect(result.scheduled).toBe(true);
    expect(result.job).toBeDefined();
    expect(result.job?.pull_job_id).toBe('job-123');
    expect(result.job?.depth).toBe('SHALLOW');
    expect(result.job?.depth_units).toBe(1);
    expect(result.reason).toBeUndefined();
  });

  it('schedulePull returns scheduled: false with DUPLICATE_PULL_JOB_ID when idempotency reserve fails', async () => {
    const conditionalErr = new Error('Conditional check failed');
    (conditionalErr as Error & { name: string }).name = 'ConditionalCheckFailedException';
    mockDynamoDBDocumentClient.send.mockRejectedValueOnce(conditionalErr); // tryReserve (duplicate)

    const result = await orchestrator.schedulePull({
      tenantId: 't1',
      accountId: 'a1',
      connectorId: 'crm',
      pullJobId: 'job-dup',
      depth: 'SHALLOW',
    });

    expect(result.scheduled).toBe(false);
    expect(result.reason).toBe(DUPLICATE_PULL_JOB_ID);
    expect(result.job).toBeUndefined();
  });

  it('schedulePull returns scheduled: false with RATE_LIMIT when rateLimitCheck returns false', async () => {
    const orchestratorWithRateLimit = new PerceptionPullOrchestrator({
      perceptionPullBudgetService: budgetService,
      pullIdempotencyStoreService: idempotencyService,
      heatTierPolicyService,
      rateLimitCheck: () => Promise.resolve(false),
      logger,
    });

    const result = await orchestratorWithRateLimit.schedulePull({
      tenantId: 't1',
      accountId: 'a1',
      connectorId: 'crm',
      pullJobId: 'job-1',
      depth: 'SHALLOW',
    });

    expect(result.scheduled).toBe(false);
    expect(result.reason).toBe('RATE_LIMIT');
  });

  it('schedulePull returns scheduled: false with BUDGET_EXCEEDED when checkAndConsume denies', async () => {
    const conditionalErr = new Error('Conditional check failed');
    (conditionalErr as Error & { name: string }).name = 'ConditionalCheckFailedException';
    mockDynamoDBDocumentClient.send
      .mockResolvedValueOnce({}) // tryReserve (PutCommand)
      .mockResolvedValueOnce({
        Item: {
          pk: 'TENANT#t1',
          sk: 'BUDGET#PULL',
          tenant_id: 't1',
          max_pull_units_per_day: 5,
          updated_at: '2026-01-28T00:00:00Z',
        },
      }) // getConfig inside checkAndConsume
      .mockRejectedValueOnce(conditionalErr); // UpdateCommand (limit reached)

    const result = await orchestrator.schedulePull({
      tenantId: 't1',
      accountId: 'a1',
      connectorId: 'crm',
      pullJobId: 'job-1',
      depth: 'DEEP',
    });

    expect(result.scheduled).toBe(false);
    expect(result.reason).toBe('BUDGET_EXCEEDED');
  });
});
