/**
 * Unit tests for DecisionIdempotencyStoreService - Phase 5.2
 */

import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { mockDynamoDBDocumentClient, resetAllMocks } from '../../__mocks__/aws-sdk-clients';
import { DecisionIdempotencyStoreService } from '../../../services/decision/DecisionIdempotencyStoreService';
import { Logger } from '../../../services/core/Logger';

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn(() => mockDynamoDBDocumentClient) },
  GetCommand: jest.fn(),
  PutCommand: jest.fn(),
}));

const logger = new Logger('DecisionIdempotencyStoreServiceTest');

describe('DecisionIdempotencyStoreService', () => {
  const tableName = 'test-idempotency-store';
  let service: DecisionIdempotencyStoreService;

  beforeEach(() => {
    resetAllMocks();
    jest.clearAllMocks();
    service = new DecisionIdempotencyStoreService(
      mockDynamoDBDocumentClient as any,
      tableName,
      logger
    );
  });

  it('tryReserve returns true when put succeeds (no existing key)', async () => {
    mockDynamoDBDocumentClient.send.mockResolvedValue({});
    const result = await service.tryReserve('key123');
    expect(result).toBe(true);
    expect(mockDynamoDBDocumentClient.send).toHaveBeenCalled();
  });

  it('tryReserve returns false when ConditionalCheckFailedException (duplicate)', async () => {
    const err = new Error('Conditional check failed');
    (err as Error & { name: string }).name = 'ConditionalCheckFailedException';
    mockDynamoDBDocumentClient.send.mockRejectedValue(err);
    const result = await service.tryReserve('key456');
    expect(result).toBe(false);
  });

  it('tryReserve throws when put fails for other reason', async () => {
    mockDynamoDBDocumentClient.send.mockRejectedValue(new Error('ServiceUnavailable'));
    await expect(service.tryReserve('key789')).rejects.toThrow('ServiceUnavailable');
  });

  it('exists returns true when item exists', async () => {
    mockDynamoDBDocumentClient.send.mockResolvedValue({
      Item: { pk: 'IDEMPOTENCY#key1', sk: 'METADATA' },
    });
    const result = await service.exists('key1');
    expect(result).toBe(true);
  });

  it('exists returns false when item missing', async () => {
    mockDynamoDBDocumentClient.send.mockResolvedValue({});
    const result = await service.exists('key2');
    expect(result).toBe(false);
  });

  it('tryReserve with different keys reserves both', async () => {
    mockDynamoDBDocumentClient.send.mockResolvedValue({});
    const r1 = await service.tryReserve('key-a');
    const r2 = await service.tryReserve('key-b');
    expect(r1).toBe(true);
    expect(r2).toBe(true);
    expect(mockDynamoDBDocumentClient.send).toHaveBeenCalledTimes(2);
  });
});
