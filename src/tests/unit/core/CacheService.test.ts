import { CacheService } from '../../../services/core/CacheService';
import { Logger } from '../../../services/core/Logger';
import { DynamoDBDocumentClient, PutCommand, GetCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { mockDynamoDBDocumentClient, resetAllMocks } from '../../__mocks__/aws-sdk-clients';

// Mock the DynamoDBDocumentClient
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn(() => mockDynamoDBDocumentClient),
  },
  PutCommand: jest.fn(),
  GetCommand: jest.fn(),
  DeleteCommand: jest.fn(),
}));

describe('CacheService', () => {
  let cacheService: CacheService;
  let logger: Logger;

  beforeEach(() => {
    resetAllMocks();
    logger = new Logger('CacheServiceTest');
    cacheService = new CacheService(
      { ttlHours: 1 }, // 1 hour default TTL
      logger,
      'test-cache-table',
      'us-west-2'
    );
  });

  describe('set', () => {
    it('should set cache value with TTL', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({});

      await cacheService.set('test-key', 'test-value', 1); // 1 hour

      expect(mockDynamoDBDocumentClient.send).toHaveBeenCalledTimes(1);
      const command = mockDynamoDBDocumentClient.send.mock.calls[0][0];
      expect(command).toBeInstanceOf(PutCommand);
      // Verify command was created (mocked PutCommand constructor was called)
      expect(PutCommand).toHaveBeenCalled();
    });

    it('should use default TTL when not provided', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({});

      await cacheService.set('test-key', 'test-value');

      expect(mockDynamoDBDocumentClient.send).toHaveBeenCalledTimes(1);
    });

    it('should handle errors gracefully (best-effort)', async () => {
      mockDynamoDBDocumentClient.send.mockRejectedValue(new Error('DynamoDB error'));

      // Should not throw (best-effort semantics)
      await expect(cacheService.set('test-key', 'test-value')).resolves.not.toThrow();
    });
  });

  describe('get', () => {
    it('should retrieve cached value', async () => {
      const cachedItem = {
        cacheKey: 'test-key',
        data: 'test-value',
        ttl: Math.floor(Date.now() / 1000) + 3600,
      };

      mockDynamoDBDocumentClient.send.mockResolvedValue({
        Item: cachedItem,
      });

      const result = await cacheService.get('test-key');

      expect(result).toBe('test-value');
      expect(mockDynamoDBDocumentClient.send).toHaveBeenCalledTimes(1);
    });

    it('should return null for expired cache', async () => {
      const expiredItem = {
        cacheKey: 'test-key',
        data: 'test-value',
        ttl: Math.floor(Date.now() / 1000) - 100, // Expired
      };

      mockDynamoDBDocumentClient.send.mockResolvedValue({
        Item: expiredItem,
      });

      const result = await cacheService.get('test-key');

      expect(result).toBeNull();
    });

    it('should return null for missing key', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({
        Item: undefined,
      });

      const result = await cacheService.get('missing-key');

      expect(result).toBeNull();
    });

    it('should handle errors gracefully (best-effort)', async () => {
      mockDynamoDBDocumentClient.send.mockRejectedValue(new Error('DynamoDB error'));

      // Should return null on error (best-effort semantics)
      const result = await cacheService.get('test-key');
      expect(result).toBeNull();
    });
  });

  describe('delete', () => {
    it('should delete cache key', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({});

      await cacheService.delete('test-key');

      expect(mockDynamoDBDocumentClient.send).toHaveBeenCalledTimes(1);
    });

    it('should handle errors gracefully (best-effort)', async () => {
      mockDynamoDBDocumentClient.send.mockRejectedValue(new Error('DynamoDB error'));

      await expect(cacheService.delete('test-key')).resolves.not.toThrow();
    });
  });
});
