/**
 * CostBudgetService Unit Tests - Phase 3
 */

import { CostBudgetService } from '../../../services/decision/CostBudgetService';
import { Logger } from '../../../services/core/Logger';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { mockDynamoDBDocumentClient, resetAllMocks } from '../../__mocks__/aws-sdk-clients';

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn(() => mockDynamoDBDocumentClient),
  },
  GetCommand: jest.fn(),
  PutCommand: jest.fn(),
  UpdateCommand: jest.fn(),
}));

describe('CostBudgetService', () => {
  let costBudgetService: CostBudgetService;
  let logger: Logger;

  beforeEach(() => {
    resetAllMocks();
    logger = new Logger('CostBudgetServiceTest');
    costBudgetService = new CostBudgetService(
      mockDynamoDBDocumentClient as any,
      'test-budget-table',
      logger
    );
  });

  describe('canEvaluateDecision', () => {
    it('should allow evaluation when budget is available', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({
        Item: {
          pk: 'TENANT#tenant-1#ACCOUNT#account-1',
          sk: 'BUDGET',
          daily_decisions_remaining: 5,
          monthly_cost_remaining: 50,
          last_reset_date: '2024-01-01',
          updated_at: new Date().toISOString(),
        },
      });

      const result = await costBudgetService.canEvaluateDecision('account-1', 'tenant-1');

      expect(result.allowed).toBe(true);
      expect(result.reason).toBe('BUDGET_AVAILABLE');
      expect(result.budget_remaining).toBe(5);
    });

    it('should block evaluation when daily budget is exceeded', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({
        Item: {
          pk: 'TENANT#tenant-1#ACCOUNT#account-1',
          sk: 'BUDGET',
          daily_decisions_remaining: 0,
          monthly_cost_remaining: 50,
          last_reset_date: '2024-01-01',
          updated_at: new Date().toISOString(),
        },
      });

      const result = await costBudgetService.canEvaluateDecision('account-1', 'tenant-1');

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('DAILY_BUDGET_EXCEEDED');
      expect(result.budget_remaining).toBe(0);
    });

    it('should block evaluation when monthly budget is exceeded', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({
        Item: {
          pk: 'TENANT#tenant-1#ACCOUNT#account-1',
          sk: 'BUDGET',
          daily_decisions_remaining: 5,
          monthly_cost_remaining: 0,
          last_reset_date: '2024-01-01',
          updated_at: new Date().toISOString(),
        },
      });

      const result = await costBudgetService.canEvaluateDecision('account-1', 'tenant-1');

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('MONTHLY_BUDGET_EXCEEDED');
      expect(result.budget_remaining).toBe(0);
    });

    it('should initialize budget if not exists', async () => {
      mockDynamoDBDocumentClient.send
        .mockResolvedValueOnce({ Item: null }) // First call: GetCommand returns null
        .mockResolvedValueOnce({}); // Second call: PutCommand succeeds

      const result = await costBudgetService.canEvaluateDecision('account-1', 'tenant-1');

      expect(result.allowed).toBe(true);
      expect(GetCommand).toHaveBeenCalled();
      expect(PutCommand).toHaveBeenCalled(); // Budget should be initialized
    });
  });

  describe('consumeBudget', () => {
    it('should consume budget atomically', async () => {
      mockDynamoDBDocumentClient.send
        .mockResolvedValueOnce({
          Item: {
            pk: 'TENANT#tenant-1#ACCOUNT#account-1',
            sk: 'BUDGET',
            daily_decisions_remaining: 5,
            monthly_cost_remaining: 50,
            last_reset_date: '2024-01-01',
            updated_at: new Date().toISOString(),
          },
        })
        .mockResolvedValueOnce({}); // UpdateCommand succeeds

      await costBudgetService.consumeBudget('account-1', 'tenant-1', 1);

      expect(UpdateCommand).toHaveBeenCalled();
      const updateCall = (UpdateCommand as unknown as jest.Mock).mock.calls[0][0];
      expect(updateCall.Key).toEqual({
        pk: 'TENANT#tenant-1#ACCOUNT#account-1',
        sk: 'BUDGET',
      });
      expect(updateCall.ConditionExpression).toContain('daily_decisions_remaining >= :cost');
    });

    it('should throw if budget insufficient', async () => {
      mockDynamoDBDocumentClient.send
        .mockResolvedValueOnce({
          Item: {
            pk: 'TENANT#tenant-1#ACCOUNT#account-1',
            sk: 'BUDGET',
            daily_decisions_remaining: 5,
            monthly_cost_remaining: 50,
            last_reset_date: '2024-01-01',
            updated_at: new Date().toISOString(),
          },
        })
        .mockRejectedValueOnce(new Error('ConditionalCheckFailedException'));

      await expect(
        costBudgetService.consumeBudget('account-1', 'tenant-1', 10)
      ).rejects.toThrow();
    });
  });

  describe('resetDailyBudget', () => {
    it('should reset daily budget to default limit', async () => {
      (UpdateCommand as unknown as jest.Mock).mockClear();
      mockDynamoDBDocumentClient.send.mockResolvedValue({});

      await costBudgetService.resetDailyBudget('account-1', 'tenant-1');

      expect(UpdateCommand).toHaveBeenCalled();
      const updateCall = (UpdateCommand as unknown as jest.Mock).mock.calls[0][0];
      expect(updateCall.ExpressionAttributeValues[':daily_limit']).toBe(10);
    });
  });
});
