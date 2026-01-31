/**
 * CircuitBreakerService Unit Tests - Phase 5.7
 */

import { CircuitBreakerService } from '../../../../services/connector/CircuitBreakerService';
import { Logger } from '../../../../services/core/Logger';
import { mockDynamoDBDocumentClient, resetAllMocks } from '../../../__mocks__/aws-sdk-clients';
import { GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn(() => mockDynamoDBDocumentClient) },
  GetCommand: jest.fn(),
  PutCommand: jest.fn(),
  UpdateCommand: jest.fn(),
}));

describe('CircuitBreakerService', () => {
  let service: CircuitBreakerService;
  let logger: Logger;

  beforeEach(() => {
    resetAllMocks();
    jest.clearAllMocks();
    logger = new Logger('CircuitBreakerServiceTest');
    service = new CircuitBreakerService(
      mockDynamoDBDocumentClient as any,
      'test-resilience-table',
      logger,
      { failureThreshold: 3, windowSeconds: 60, cooldownSeconds: 10, stateTtlDays: 14 }
    );
  });

  describe('allowRequest', () => {
    it('allows when no state exists', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({ Item: undefined });
      const result = await service.allowRequest('internal');
      expect(result.allowed).toBe(true);
    });

    it('allows when state is CLOSED', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({
        Item: { pk: 'CONNECTOR#internal', sk: 'STATE', state: 'CLOSED', failure_count: 0 },
      });
      const result = await service.allowRequest('internal');
      expect(result.allowed).toBe(true);
      expect(result.state).toBe('CLOSED');
    });

    it('denies when OPEN and before cooldown', async () => {
      const openUntil = Math.floor(Date.now() / 1000) + 30;
      mockDynamoDBDocumentClient.send.mockResolvedValue({
        Item: {
          pk: 'CONNECTOR#internal',
          sk: 'STATE',
          state: 'OPEN',
          open_until_epoch_sec: openUntil,
        },
      });
      const result = await service.allowRequest('internal');
      expect(result.allowed).toBe(false);
      expect(result.state).toBe('OPEN');
      expect(result.retryAfterSeconds).toBeDefined();
    });

    it('allows when OPEN and past cooldown and transition to HALF_OPEN succeeds', async () => {
      const openUntil = Math.floor(Date.now() / 1000) - 5;
      mockDynamoDBDocumentClient.send
        .mockResolvedValueOnce({
          Item: {
            pk: 'CONNECTOR#internal',
            sk: 'STATE',
            state: 'OPEN',
            open_until_epoch_sec: openUntil,
          },
        })
        .mockResolvedValueOnce(undefined);
      const result = await service.allowRequest('internal');
      expect(result.allowed).toBe(true);
      expect(result.state).toBe('HALF_OPEN');
      expect(UpdateCommand).toHaveBeenCalled();
    });

    it('denies when OPEN past cooldown but transition loses race', async () => {
      const openUntil = Math.floor(Date.now() / 1000) - 5;
      const condErr = new Error('ConditionalCheckFailed');
      (condErr as any).name = 'ConditionalCheckFailedException';
      mockDynamoDBDocumentClient.send
        .mockResolvedValueOnce({
          Item: {
            pk: 'CONNECTOR#internal',
            sk: 'STATE',
            state: 'OPEN',
            open_until_epoch_sec: openUntil,
          },
        })
        .mockRejectedValueOnce(condErr);
      const result = await service.allowRequest('internal');
      expect(result.allowed).toBe(false);
      expect(result.state).toBe('HALF_OPEN');
      expect(result.retryAfterSeconds).toBe(10);
    });

    it('denies when HALF_OPEN and probe in flight', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({
        Item: {
          pk: 'CONNECTOR#internal',
          sk: 'STATE',
          state: 'HALF_OPEN',
          half_open_probe_in_flight: true,
        },
      });
      const result = await service.allowRequest('internal');
      expect(result.allowed).toBe(false);
      expect(result.state).toBe('HALF_OPEN');
    });

    it('denies when HALF_OPEN and no probe in flight', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({
        Item: {
          pk: 'CONNECTOR#internal',
          sk: 'STATE',
          state: 'HALF_OPEN',
          half_open_probe_in_flight: false,
        },
      });
      const result = await service.allowRequest('internal');
      expect(result.allowed).toBe(false);
      expect(result.state).toBe('HALF_OPEN');
    });

    it('allows when state is unknown (fallback branch)', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({
        Item: {
          pk: 'CONNECTOR#internal',
          sk: 'STATE',
          state: 'UNKNOWN',
        },
      });
      const result = await service.allowRequest('internal');
      expect(result.allowed).toBe(true);
    });

    it('rethrows when OPEN past cooldown and transition throws non-conditional error', async () => {
      const openUntil = Math.floor(Date.now() / 1000) - 5;
      mockDynamoDBDocumentClient.send
        .mockResolvedValueOnce({
          Item: {
            pk: 'CONNECTOR#internal',
            sk: 'STATE',
            state: 'OPEN',
            open_until_epoch_sec: openUntil,
          },
        })
        .mockRejectedValueOnce(new Error('DynamoDB network error'));
      await expect(service.allowRequest('internal')).rejects.toThrow('DynamoDB network error');
    });
  });

  describe('recordSuccess', () => {
    it('returns early when no state exists', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({ Item: undefined });
      await service.recordSuccess('internal');
      expect(PutCommand).not.toHaveBeenCalled();
      expect(UpdateCommand).not.toHaveBeenCalled();
    });

    it('closes circuit when HALF_OPEN', async () => {
      mockDynamoDBDocumentClient.send
        .mockResolvedValueOnce({
          Item: {
            pk: 'CONNECTOR#internal',
            sk: 'STATE',
            state: 'HALF_OPEN',
            half_open_probe_in_flight: true,
          },
        })
        .mockResolvedValueOnce(undefined);
      await service.recordSuccess('internal');
      expect(PutCommand).toHaveBeenCalled();
      const putCallArgs = (PutCommand as unknown as jest.Mock).mock.calls[0];
      expect(putCallArgs[0].Item.state).toBe('CLOSED');
    });

    it('resets failure_count when CLOSED', async () => {
      mockDynamoDBDocumentClient.send
        .mockResolvedValueOnce({
          Item: {
            pk: 'CONNECTOR#internal',
            sk: 'STATE',
            state: 'CLOSED',
            failure_count: 1,
            window_start_epoch_sec: Math.floor(Date.now() / 1000),
          },
        })
        .mockResolvedValueOnce(undefined);
      await service.recordSuccess('internal');
      expect(UpdateCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          UpdateExpression: expect.stringContaining('failure_count'),
          ExpressionAttributeValues: expect.objectContaining({ ':zero': 0 }),
        })
      );
    });
  });

  describe('recordFailure', () => {
    it('creates state and opens when threshold is 1', async () => {
      const serviceOneThreshold = new CircuitBreakerService(
        mockDynamoDBDocumentClient as any,
        'test-resilience-table',
        logger,
        { failureThreshold: 1, windowSeconds: 60, cooldownSeconds: 10, stateTtlDays: 14 }
      );
      mockDynamoDBDocumentClient.send
        .mockResolvedValueOnce({ Item: undefined })
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined);
      await serviceOneThreshold.recordFailure('internal');
      expect(PutCommand).toHaveBeenCalled();
      const putCalls = (PutCommand as unknown as jest.Mock).mock.calls;
      expect(putCalls.length).toBeGreaterThanOrEqual(1);
      const openCall = putCalls.find((args: any[]) => args[0]?.Item?.state === 'OPEN');
      expect(openCall).toBeDefined();
    });

    it('reopens circuit when HALF_OPEN', async () => {
      mockDynamoDBDocumentClient.send
        .mockResolvedValueOnce({
          Item: {
            pk: 'CONNECTOR#internal',
            sk: 'STATE',
            state: 'HALF_OPEN',
            half_open_probe_in_flight: true,
          },
        })
        .mockResolvedValueOnce(undefined);
      await service.recordFailure('internal');
      expect(PutCommand).toHaveBeenCalled();
      const putCallArgs = (PutCommand as unknown as jest.Mock).mock.calls[0][0];
      expect(putCallArgs.Item.state).toBe('OPEN');
    });

    it('increments and opens when CLOSED and threshold reached', async () => {
      const nowSec = Math.floor(Date.now() / 1000);
      const windowStart = nowSec - 30;
      mockDynamoDBDocumentClient.send
        .mockResolvedValueOnce({
          Item: {
            pk: 'CONNECTOR#internal',
            sk: 'STATE',
            state: 'CLOSED',
            failure_count: 2,
            window_start_epoch_sec: windowStart,
          },
        })
        .mockResolvedValueOnce(undefined);
      await service.recordFailure('internal');
      expect(PutCommand).toHaveBeenCalled();
      const putCallArgs = (PutCommand as unknown as jest.Mock).mock.calls[0][0];
      expect(putCallArgs.Item.state).toBe('OPEN');
      expect(putCallArgs.Item.failure_count).toBe(3);
    });

    it('increments when CLOSED and below threshold', async () => {
      const nowSec = Math.floor(Date.now() / 1000);
      const windowStart = nowSec - 10;
      mockDynamoDBDocumentClient.send
        .mockResolvedValueOnce({
          Item: {
            pk: 'CONNECTOR#internal',
            sk: 'STATE',
            state: 'CLOSED',
            failure_count: 1,
            window_start_epoch_sec: windowStart,
          },
        })
        .mockResolvedValueOnce(undefined);
      await service.recordFailure('internal');
      expect(UpdateCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          UpdateExpression: expect.stringContaining('failure_count'),
          ExpressionAttributeValues: expect.objectContaining({ ':count': 2 }),
        })
      );
    });
  });

  describe('getState', () => {
    it('returns null when no item', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({ Item: undefined });
      const state = await service.getState('internal');
      expect(state).toBeNull();
    });

    it('returns state when item exists', async () => {
      const item = { pk: 'CONNECTOR#internal', sk: 'STATE', state: 'CLOSED', failure_count: 0 };
      mockDynamoDBDocumentClient.send.mockResolvedValue({ Item: item });
      const state = await service.getState('internal');
      expect(state).toEqual(item);
    });
  });
});
