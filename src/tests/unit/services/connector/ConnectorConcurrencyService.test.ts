/**
 * ConnectorConcurrencyService Unit Tests - Phase 5.7
 */

import { ConnectorConcurrencyService } from '../../../../services/connector/ConnectorConcurrencyService';
import { Logger } from '../../../../services/core/Logger';
import { mockDynamoDBDocumentClient, resetAllMocks } from '../../../__mocks__/aws-sdk-clients';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn(() => mockDynamoDBDocumentClient) },
  UpdateCommand: jest.fn(),
}));

describe('ConnectorConcurrencyService', () => {
  let service: ConnectorConcurrencyService;
  let logger: Logger;

  beforeEach(() => {
    resetAllMocks();
    jest.clearAllMocks();
    logger = new Logger('ConnectorConcurrencyServiceTest');
    service = new ConnectorConcurrencyService(
      mockDynamoDBDocumentClient as any,
      'test-resilience-table',
      logger,
      5
    );
  });

  it('uses default maxInFlight when not provided', async () => {
    const serviceWithDefault = new ConnectorConcurrencyService(
      mockDynamoDBDocumentClient as any,
      'test-resilience-table',
      logger
    );
    mockDynamoDBDocumentClient.send.mockResolvedValue(undefined);
    await serviceWithDefault.tryAcquire('internal');
    expect(UpdateCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        ExpressionAttributeValues: expect.objectContaining({ ':max': 20 }),
      })
    );
  });

  describe('tryAcquire', () => {
    it('returns acquired when UpdateCommand succeeds', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue(undefined);
      const result = await service.tryAcquire('internal');
      expect(result.acquired).toBe(true);
      expect(UpdateCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          TableName: 'test-resilience-table',
          Key: { pk: 'CONNECTOR#internal', sk: 'CONCURRENCY' },
        })
      );
    });

    it('returns not acquired with retryAfterSeconds when at concurrency limit', async () => {
      const err = new Error('ConditionalCheckFailed');
      (err as any).name = 'ConditionalCheckFailedException';
      mockDynamoDBDocumentClient.send.mockRejectedValue(err);
      const result = await service.tryAcquire('internal');
      expect(result.acquired).toBe(false);
      expect(result.retryAfterSeconds).toBe(5);
    });

    it('rethrows when error is not ConditionalCheckFailedException', async () => {
      mockDynamoDBDocumentClient.send.mockRejectedValue(new Error('DynamoDB error'));
      await expect(service.tryAcquire('internal')).rejects.toThrow('DynamoDB error');
    });
  });

  describe('release', () => {
    it('decrements in_flight_count when UpdateCommand succeeds', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue(undefined);
      await service.release('internal');
      expect(UpdateCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          UpdateExpression: 'SET in_flight_count = in_flight_count - :one',
        })
      );
    });

    it('does not throw when ConditionalCheckFailedException (double-release)', async () => {
      const err = new Error('ConditionalCheckFailed');
      (err as any).name = 'ConditionalCheckFailedException';
      mockDynamoDBDocumentClient.send.mockRejectedValue(err);
      await expect(service.release('internal')).resolves.not.toThrow();
    });

    it('rethrows when error is not ConditionalCheckFailedException', async () => {
      mockDynamoDBDocumentClient.send.mockRejectedValue(new Error('DynamoDB error'));
      await expect(service.release('internal')).rejects.toThrow('DynamoDB error');
    });
  });
});
