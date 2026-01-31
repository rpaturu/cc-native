/**
 * Phase 6.3 — PlanStepExecutionStateService unit tests (mocked DynamoDB).
 */

import { PlanStepExecutionStateService } from '../../../services/plan/PlanStepExecutionStateService';
import { Logger } from '../../../services/core/Logger';
import { mockDynamoDBDocumentClient, resetAllMocks } from '../../__mocks__/aws-sdk-clients';

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn(() => mockDynamoDBDocumentClient) },
  GetCommand: jest.fn().mockImplementation((p: Record<string, unknown>) => ({ input: p })),
  PutCommand: jest.fn().mockImplementation((p: Record<string, unknown>) => ({ input: p })),
  UpdateCommand: jest.fn().mockImplementation((p: Record<string, unknown>) => ({ input: p })),
}));

describe('PlanStepExecutionStateService', () => {
  const logger = new Logger('PlanStepExecutionStateTest');

  beforeEach(() => {
    resetAllMocks();
  });

  describe('getCurrentNextAttempt', () => {
    it('returns 0 when META row missing', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValueOnce({ Item: undefined });
      const svc = new PlanStepExecutionStateService(logger, { tableName: 'T' });
      const n = await svc.getCurrentNextAttempt('plan-1', 'step-1');
      expect(n).toBe(0);
    });

    it('returns next_attempt from META row', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValueOnce({ Item: { next_attempt: 2 } });
      const svc = new PlanStepExecutionStateService(logger, { tableName: 'T' });
      const n = await svc.getCurrentNextAttempt('plan-1', 'step-1');
      expect(n).toBe(2);
    });
  });

  describe('reserveNextAttempt', () => {
    it('returns updated attempt from ADD', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValueOnce({
        Attributes: { next_attempt: 1 },
      });
      const svc = new PlanStepExecutionStateService(logger, { tableName: 'T' });
      const attempt = await svc.reserveNextAttempt('plan-1', 'step-1');
      expect(attempt).toBe(1);
    });

    it('throws when Attributes.next_attempt invalid or missing', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValueOnce({ Attributes: {} });
      const svc = new PlanStepExecutionStateService(logger, { tableName: 'T' });
      await expect(svc.reserveNextAttempt('plan-1', 'step-1')).rejects.toThrow(
        /invalid attempt|plan-1\/step-1/
      );
    });
  });

  describe('recordStepStarted', () => {
    it('returns claimed true when PutItem succeeds', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValueOnce({});
      const svc = new PlanStepExecutionStateService(logger, { tableName: 'T' });
      const result = await svc.recordStepStarted('plan-1', 'step-1', 1);
      expect(result.claimed).toBe(true);
      expect(result.attempt).toBe(1);
      const call = (mockDynamoDBDocumentClient.send as jest.Mock).mock.calls[0][0];
      expect(call.input?.ConditionExpression).toBe('attribute_not_exists(sk)');
      expect(call.input?.Item?.sk).toContain('STEP#step-1#ATTEMPT#1');
    });

    it('returns claimed false on ConditionalCheckFailedException', async () => {
      const err = new Error('Conditional check failed');
      (err as Error & { name: string }).name = 'ConditionalCheckFailedException';
      mockDynamoDBDocumentClient.send.mockRejectedValueOnce(err);
      const svc = new PlanStepExecutionStateService(logger, { tableName: 'T' });
      const result = await svc.recordStepStarted('plan-1', 'step-1', 1);
      expect(result.claimed).toBe(false);
      expect(result.attempt).toBe(1);
    });

    it('rethrows non-conditional errors', async () => {
      mockDynamoDBDocumentClient.send.mockRejectedValueOnce(new Error('Network error'));
      const svc = new PlanStepExecutionStateService(logger, { tableName: 'T' });
      await expect(svc.recordStepStarted('plan-1', 'step-1', 1)).rejects.toThrow('Network error');
    });
  });

  describe('updateStepOutcome', () => {
    it('sends UpdateCommand with status and completed_at', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValueOnce({});
      const svc = new PlanStepExecutionStateService(logger, { tableName: 'T' });
      await svc.updateStepOutcome('plan-1', 'step-1', 1, 'SUCCEEDED', {
        outcome_id: 'out-1',
      });
      expect(mockDynamoDBDocumentClient.send).toHaveBeenCalled();
    });

    it('includes error_message in UpdateExpression when provided', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValueOnce({});
      const svc = new PlanStepExecutionStateService(logger, { tableName: 'T' });
      await svc.updateStepOutcome('plan-1', 'step-1', 1, 'FAILED', {
        error_message: 'timeout',
      });
      const call = (mockDynamoDBDocumentClient.send as jest.Mock).mock.calls[0][0];
      expect(call.input?.ExpressionAttributeValues?.[':error_message']).toBe('timeout');
    });
  });
});
