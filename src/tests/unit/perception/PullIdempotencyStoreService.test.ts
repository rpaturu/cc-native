/**
 * Unit tests for PullIdempotencyStoreService - Phase 5.3
 */

import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { mockDynamoDBDocumentClient, resetAllMocks } from '../../__mocks__/aws-sdk-clients';
import { PullIdempotencyStoreService } from '../../../services/perception/PullIdempotencyStoreService';
import { Logger } from '../../../services/core/Logger';

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn(() => mockDynamoDBDocumentClient) },
  GetCommand: jest.fn(),
  PutCommand: jest.fn(),
}));

const logger = new Logger('PullIdempotencyStoreServiceTest');

describe('PullIdempotencyStoreService', () => {
  const tableName = 'test-pull-idempotency-store';
  let service: PullIdempotencyStoreService;

  beforeEach(() => {
    resetAllMocks();
    jest.clearAllMocks();
    service = new PullIdempotencyStoreService(
      mockDynamoDBDocumentClient as any,
      tableName,
      logger
    );
  });

  it('tryReserve returns true when put succeeds (no existing key)', async () => {
    mockDynamoDBDocumentClient.send.mockResolvedValue({});
    const result = await service.tryReserve('pull-job-123');
    expect(result).toBe(true);
    expect(mockDynamoDBDocumentClient.send).toHaveBeenCalled();
  });

  it('tryReserve returns false when ConditionalCheckFailedException (duplicate)', async () => {
    const err = new Error('Conditional check failed');
    (err as Error & { name: string }).name = 'ConditionalCheckFailedException';
    mockDynamoDBDocumentClient.send.mockRejectedValue(err);
    const result = await service.tryReserve('pull-job-456');
    expect(result).toBe(false);
  });

  it('tryReserve throws when put fails for other reason', async () => {
    mockDynamoDBDocumentClient.send.mockRejectedValue(new Error('ServiceUnavailable'));
    await expect(service.tryReserve('pull-job-789')).rejects.toThrow('ServiceUnavailable');
  });

  it('exists returns true when item exists', async () => {
    mockDynamoDBDocumentClient.send.mockResolvedValue({
      Item: { pk: 'IDEMPOTENCY#PULL#job1', sk: 'METADATA' },
    });
    const result = await service.exists('job1');
    expect(result).toBe(true);
  });

  it('exists returns false when item missing', async () => {
    mockDynamoDBDocumentClient.send.mockResolvedValue({});
    const result = await service.exists('job2');
    expect(result).toBe(false);
  });
});
