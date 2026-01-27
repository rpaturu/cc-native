/**
 * IdempotencyService Unit Tests - Phase 4.2
 */

import { IdempotencyService } from '../../../services/execution/IdempotencyService';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { mockDynamoDBDocumentClient, resetAllMocks } from '../../__mocks__/aws-sdk-clients';
import { ExternalWriteDedupe } from '../../../types/ExecutionTypes';
import externalWriteDedupeLatest from '../../fixtures/execution/external-write-dedupe-latest.json';
import externalWriteDedupe from '../../fixtures/execution/external-write-dedupe.json';

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn(() => mockDynamoDBDocumentClient),
  },
  GetCommand: jest.fn(),
  PutCommand: jest.fn(),
  QueryCommand: jest.fn(),
}));

describe('IdempotencyService', () => {
  let service: IdempotencyService;

  beforeEach(() => {
    resetAllMocks();
    jest.clearAllMocks();
    service = new IdempotencyService();
  });

  describe('generateIdempotencyKey', () => {
    it('should generate consistent hash for same input', () => {
      const key1 = service.generateIdempotencyKey(
        'tenant_1',
        'ai_123',
        'crm.create_task',
        { title: 'Test', priority: 'HIGH' },
        1
      );

      const key2 = service.generateIdempotencyKey(
        'tenant_1',
        'ai_123',
        'crm.create_task',
        { title: 'Test', priority: 'HIGH' },
        1
      );

      expect(key1).toBe(key2);
    });

    it('should generate different hash for different inputs', () => {
      const key1 = service.generateIdempotencyKey(
        'tenant_1',
        'ai_123',
        'crm.create_task',
        { title: 'Test', priority: 'HIGH' },
        1
      );

      const key2 = service.generateIdempotencyKey(
        'tenant_1',
        'ai_123',
        'crm.create_task',
        { title: 'Test', priority: 'LOW' }, // Different priority
        1
      );

      expect(key1).not.toBe(key2);
    });

    it('should use SHA-256', () => {
      const key = service.generateIdempotencyKey(
        'tenant_1',
        'ai_123',
        'crm.create_task',
        { title: 'Test' },
        1
      );

      // SHA-256 produces 64 character hex string
      expect(key).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should handle different tenant_id', () => {
      const key1 = service.generateIdempotencyKey(
        'tenant_1',
        'ai_123',
        'crm.create_task',
        { title: 'Test' },
        1
      );

      const key2 = service.generateIdempotencyKey(
        'tenant_2', // Different tenant
        'ai_123',
        'crm.create_task',
        { title: 'Test' },
        1
      );

      expect(key1).not.toBe(key2);
    });

    it('should handle different action_intent_id', () => {
      const key1 = service.generateIdempotencyKey(
        'tenant_1',
        'ai_123',
        'crm.create_task',
        { title: 'Test' },
        1
      );

      const key2 = service.generateIdempotencyKey(
        'tenant_1',
        'ai_456', // Different intent
        'crm.create_task',
        { title: 'Test' },
        1
      );

      expect(key1).not.toBe(key2);
    });

    it('should handle different registry_version', () => {
      const key1 = service.generateIdempotencyKey(
        'tenant_1',
        'ai_123',
        'crm.create_task',
        { title: 'Test' },
        1
      );

      const key2 = service.generateIdempotencyKey(
        'tenant_1',
        'ai_123',
        'crm.create_task',
        { title: 'Test' },
        2 // Different version
      );

      expect(key1).not.toBe(key2);
    });
  });

  describe('generateSemanticIdempotencyKey', () => {
    it('should generate key without action_intent_id', () => {
      const semanticKey = service.generateSemanticIdempotencyKey(
        'tenant_1',
        'crm.create_task',
        { title: 'Test', priority: 'HIGH' },
        1
      );

      expect(semanticKey).toBeDefined();
      expect(semanticKey).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should generate same key for same params regardless of action_intent_id', () => {
      const key1 = service.generateSemanticIdempotencyKey(
        'tenant_1',
        'crm.create_task',
        { title: 'Test' },
        1
      );

      const key2 = service.generateSemanticIdempotencyKey(
        'tenant_1',
        'crm.create_task',
        { title: 'Test' },
        1
      );

      expect(key1).toBe(key2);
    });
  });

  describe('checkExternalWriteDedupe', () => {
    it('should check LATEST pointer item first', async () => {
      mockDynamoDBDocumentClient.send
        .mockResolvedValueOnce({
          Item: externalWriteDedupeLatest as ExternalWriteDedupe,
        }) // LATEST pointer
        .mockResolvedValueOnce({
          Item: externalWriteDedupe as ExternalWriteDedupe,
        }); // Actual history item

      const externalObjectId = await service.checkExternalWriteDedupe(
        mockDynamoDBDocumentClient as any,
        'test-table',
        'hash_123'
      );

      expect(externalObjectId).toBe('task_12345');
      expect(GetCommand).toHaveBeenCalledTimes(2); // LATEST + history item
    });

    it('should fall back to history query if LATEST not found', async () => {
      mockDynamoDBDocumentClient.send
        .mockResolvedValueOnce({
          Item: undefined, // LATEST not found
        })
        .mockResolvedValueOnce({
          Items: [externalWriteDedupe] as ExternalWriteDedupe[],
        }); // History query

      const externalObjectId = await service.checkExternalWriteDedupe(
        mockDynamoDBDocumentClient as any,
        'test-table',
        'hash_123'
      );

      expect(externalObjectId).toBe('task_12345');
      expect(QueryCommand).toHaveBeenCalled();
    });

    it('should return null if not found', async () => {
      mockDynamoDBDocumentClient.send
        .mockResolvedValueOnce({
          Item: undefined, // LATEST not found
        })
        .mockResolvedValueOnce({
          Items: [], // History query returns empty
        });

      const externalObjectId = await service.checkExternalWriteDedupe(
        mockDynamoDBDocumentClient as any,
        'test-table',
        'hash_123'
      );

      expect(externalObjectId).toBeNull();
    });

    it('should handle TTL expiration (item not found)', async () => {
      mockDynamoDBDocumentClient.send
        .mockResolvedValueOnce({
          Item: undefined, // LATEST expired
        })
        .mockResolvedValueOnce({
          Items: [], // History items also expired
        });

      const externalObjectId = await service.checkExternalWriteDedupe(
        mockDynamoDBDocumentClient as any,
        'test-table',
        'hash_123'
      );

      expect(externalObjectId).toBeNull();
    });

    it('should use backwards compatibility if LATEST item has external_object_id directly', async () => {
      const latestWithData = {
        ...externalWriteDedupeLatest,
        latest_sk: undefined, // No pointer, has data directly
      };

      mockDynamoDBDocumentClient.send.mockResolvedValueOnce({
        Item: latestWithData as ExternalWriteDedupe,
      });

      const externalObjectId = await service.checkExternalWriteDedupe(
        mockDynamoDBDocumentClient as any,
        'test-table',
        'hash_123'
      );

      expect(externalObjectId).toBe('task_12345');
      expect(GetCommand).toHaveBeenCalledTimes(1); // Only LATEST, no history fetch
    });
  });

  describe('recordExternalWriteDedupe', () => {
    it('should create immutable history item and LATEST pointer', async () => {
      // checkExternalWriteDedupe returns null (not found)
      mockDynamoDBDocumentClient.send
        .mockResolvedValueOnce({ Item: undefined }) // checkExternalWriteDedupe LATEST
        .mockResolvedValueOnce({ Items: [] }) // checkExternalWriteDedupe history
        .mockResolvedValueOnce({}) // PutCommand history item
        .mockResolvedValueOnce({}); // PutCommand LATEST pointer

      await service.recordExternalWriteDedupe(
        mockDynamoDBDocumentClient as any,
        'test-table',
        'hash_123',
        'task_12345',
        'ai_test_123',
        'crm.create_task'
      );

      expect(PutCommand).toHaveBeenCalledTimes(2);
      const historyCall = (PutCommand as unknown as jest.Mock).mock.calls[0][0];
      const latestCall = (PutCommand as unknown as jest.Mock).mock.calls[1][0];

      // History item
      expect(historyCall.Item.sk).toMatch(/^CREATED_AT#\d+$/);
      expect(historyCall.Item.external_object_id).toBe('task_12345');
      expect(historyCall.ConditionExpression).toBe('attribute_not_exists(pk) AND attribute_not_exists(sk)');

      // LATEST pointer
      expect(latestCall.Item.sk).toBe('LATEST');
      expect(latestCall.Item.latest_sk).toBe(historyCall.Item.sk);
    });

    it('should return early if same external_object_id exists (idempotent)', async () => {
      // checkExternalWriteDedupe returns same external_object_id
      mockDynamoDBDocumentClient.send
        .mockResolvedValueOnce({
          Item: externalWriteDedupeLatest as ExternalWriteDedupe,
        })
        .mockResolvedValueOnce({
          Item: externalWriteDedupe as ExternalWriteDedupe,
        });

      await service.recordExternalWriteDedupe(
        mockDynamoDBDocumentClient as any,
        'test-table',
        'hash_123',
        'task_12345', // Same as existing
        'ai_test_123',
        'crm.create_task'
      );

      // Should not create new items (idempotent)
      expect(PutCommand).not.toHaveBeenCalled();
    });

    it('should throw error if different external_object_id exists (collision)', async () => {
      // checkExternalWriteDedupe returns different external_object_id
      mockDynamoDBDocumentClient.send
        .mockResolvedValueOnce({
          Item: externalWriteDedupeLatest as ExternalWriteDedupe,
        })
        .mockResolvedValueOnce({
          Item: externalWriteDedupe as ExternalWriteDedupe,
        });

      await expect(
        service.recordExternalWriteDedupe(
          mockDynamoDBDocumentClient as any,
          'test-table',
          'hash_123',
          'task_99999', // Different from existing
          'ai_test_123',
          'crm.create_task'
        )
      ).rejects.toThrow('Idempotency key collision');
    });

    it('should set TTL on both items', async () => {
      mockDynamoDBDocumentClient.send
        .mockResolvedValueOnce({ Item: undefined })
        .mockResolvedValueOnce({ Items: [] })
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({});

      await service.recordExternalWriteDedupe(
        mockDynamoDBDocumentClient as any,
        'test-table',
        'hash_123',
        'task_12345',
        'ai_test_123',
        'crm.create_task'
      );

      const historyCall = (PutCommand as unknown as jest.Mock).mock.calls[0][0];
      const latestCall = (PutCommand as unknown as jest.Mock).mock.calls[1][0];

      // TTL should be approximately: now + 7 days (604800 seconds)
      const expectedTTL = Math.floor(Date.now() / 1000) + 604800;
      expect(historyCall.Item.ttl).toBeGreaterThanOrEqual(expectedTTL - 5);
      expect(latestCall.Item.ttl).toBeGreaterThanOrEqual(expectedTTL - 5);
    });
  });

  describe('deepCanonicalize (private method via generateIdempotencyKey)', () => {
    it('should sort object keys recursively', () => {
      const params1 = { b: 'value2', a: 'value1', c: { z: 'z', y: 'y' } };
      const params2 = { a: 'value1', b: 'value2', c: { y: 'y', z: 'z' } };

      const key1 = service.generateIdempotencyKey('tenant', 'ai', 'tool', params1, 1);
      const key2 = service.generateIdempotencyKey('tenant', 'ai', 'tool', params2, 1);

      // Should produce same hash despite different key order
      expect(key1).toBe(key2);
    });

    it('should preserve array order (order-sensitive)', () => {
      const params1 = { items: ['a', 'b', 'c'] };
      const params2 = { items: ['c', 'b', 'a'] };

      const key1 = service.generateIdempotencyKey('tenant', 'ai', 'tool', params1, 1);
      const key2 = service.generateIdempotencyKey('tenant', 'ai', 'tool', params2, 1);

      // Arrays are order-sensitive, so keys should differ
      expect(key1).not.toBe(key2);
    });

    it('should drop undefined values', () => {
      const params1 = { a: 'value1', b: undefined, c: 'value3' };
      const params2 = { a: 'value1', c: 'value3' };

      const key1 = service.generateIdempotencyKey('tenant', 'ai', 'tool', params1, 1);
      const key2 = service.generateIdempotencyKey('tenant', 'ai', 'tool', params2, 1);

      // Should produce same hash (undefined dropped)
      expect(key1).toBe(key2);
    });

    it('should handle null values', () => {
      const params = { a: 'value1', b: null, c: 'value3' };

      const key = service.generateIdempotencyKey('tenant', 'ai', 'tool', params, 1);

      expect(key).toBeDefined();
      expect(key).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should handle nested objects', () => {
      const params = {
        outer: {
          inner: {
            deep: 'value',
          },
        },
      };

      const key = service.generateIdempotencyKey('tenant', 'ai', 'tool', params, 1);

      expect(key).toBeDefined();
      expect(key).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should handle primitive types', () => {
      const params = {
        string: 'test',
        number: 123,
        boolean: true,
      };

      const key = service.generateIdempotencyKey('tenant', 'ai', 'tool', params, 1);

      expect(key).toBeDefined();
      expect(key).toMatch(/^[a-f0-9]{64}$/);
    });
  });
});
