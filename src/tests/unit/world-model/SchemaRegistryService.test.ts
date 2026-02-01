/**
 * SchemaRegistryService Unit Tests - Phase 0 World Model
 */

import { createHash } from 'crypto';
import { mockDynamoDBDocumentClient, mockS3Client, resetAllMocks } from '../../__mocks__/aws-sdk-clients';
import { SchemaHashMismatchError } from '../../../services/world-model/SchemaRegistryService';

function computeSchemaHash(schema: Record<string, unknown>): string {
  const { schemaHash: _, ...rest } = schema;
  const s = JSON.stringify(rest, null, 0);
  return 'sha256:' + createHash('sha256').update(s).digest('hex');
}

jest.mock('../../../utils/aws-client-config', () => ({
  getAWSClientConfig: jest.fn(() => ({})),
}));
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => mockS3Client),
  GetObjectCommand: jest.fn(),
}));
jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(),
}));
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn(() => mockDynamoDBDocumentClient) },
  QueryCommand: jest.fn(),
  PutCommand: jest.fn(),
  GetCommand: jest.fn(),
}));

import { SchemaRegistryService } from '../../../services/world-model/SchemaRegistryService';
import { Logger } from '../../../services/core/Logger';

describe('SchemaRegistryService', () => {
  let service: SchemaRegistryService;
  let logger: Logger;

  beforeEach(() => {
    resetAllMocks();
    logger = new Logger('SchemaRegistryServiceTest');
    service = new SchemaRegistryService(
      logger,
      'test-schema-bucket',
      'test-registry-table',
      'test-critical-fields-table',
      'us-west-2'
    );
  });

  describe('getSchema', () => {
    it('should return null when no schema in index', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({ Items: [] });

      const result = await service.getSchema('Account', '1.0');
      expect(result).toBeNull();
      expect(mockDynamoDBDocumentClient.send).toHaveBeenCalledTimes(1);
      expect(mockS3Client.send).not.toHaveBeenCalled();
    });

    it('should return schema when found in index and S3 and hash matches', async () => {
      const schema = { entityType: 'Account', version: '1.0', fields: {} };
      const storedHash = computeSchemaHash(schema);
      mockDynamoDBDocumentClient.send.mockResolvedValue({
        Items: [{ s3Key: 'schemas/Account/1.0.json', schemaHash: storedHash }],
      });
      mockS3Client.send.mockResolvedValue({
        Body: {
          transformToString: () =>
            Promise.resolve(JSON.stringify(schema)),
        },
      });

      const result = await service.getSchema('Account', '1.0');
      expect(result).not.toBeNull();
      expect(result?.entityType).toBe('Account');
      expect(mockS3Client.send).toHaveBeenCalledTimes(1);
    });
  });

  describe('getCriticalFields', () => {
    it('should return empty array when no items', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({ Items: [] });

      const result = await service.getCriticalFields('Account');
      expect(result).toEqual([]);
    });

    it('should return critical fields when found', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({
        Items: [
          {
            pk: 'Account',
            sk: 'name',
            required: true,
            version: '1.0',
            updatedAt: new Date().toISOString(),
          },
        ],
      });

      const result = await service.getCriticalFields('Account');
      expect(result).toHaveLength(1);
      expect(result[0].entityType).toBe('Account');
      expect(result[0].fieldName).toBe('name');
      expect(result[0].required).toBe(true);
    });
  });

  describe('validateEntityState', () => {
    it('should return false when schema not found', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({ Items: [] });

      const result = await service.validateEntityState(
        { fields: {} },
        'Account',
        '1.0'
      );
      expect(result).toBe(false);
    });

    it('should return false when critical required field is missing', async () => {
      const schema = { entityType: 'Account', version: '1.0', fields: { name: { required: true } } };
      const storedHash = computeSchemaHash(schema);
      mockDynamoDBDocumentClient.send
        .mockResolvedValueOnce({ Items: [{ s3Key: 'schemas/Account/1.0.json', schemaHash: storedHash }] })
        .mockResolvedValueOnce({
          Items: [{ pk: 'Account', sk: 'name', required: true, version: '1.0', updatedAt: new Date().toISOString() }],
        });
      mockS3Client.send.mockResolvedValueOnce({
        Body: { transformToString: () => Promise.resolve(JSON.stringify(schema)) },
      });

      const result = await service.validateEntityState(
        { fields: {} },
        'Account',
        '1.0'
      );
      expect(result).toBe(false);
    });

    it('should return false when required schema field is missing', async () => {
      const schema = { entityType: 'Account', version: '1.0', fields: { name: { required: true } } };
      const storedHash = computeSchemaHash(schema);
      mockDynamoDBDocumentClient.send
        .mockResolvedValueOnce({ Items: [{ s3Key: 'schemas/Account/1.0.json', schemaHash: storedHash }] })
        .mockResolvedValueOnce({ Items: [] });
      mockS3Client.send.mockResolvedValueOnce({
        Body: { transformToString: () => Promise.resolve(JSON.stringify(schema)) },
      });

      const result = await service.validateEntityState(
        { fields: {} },
        'Account',
        '1.0'
      );
      expect(result).toBe(false);
    });

    it('should return true when schema and critical fields pass', async () => {
      const schema = { entityType: 'Account', version: '1.0', fields: { name: { required: true } } };
      const storedHash = computeSchemaHash(schema);
      mockDynamoDBDocumentClient.send
        .mockResolvedValueOnce({ Items: [{ s3Key: 'schemas/Account/1.0.json', schemaHash: storedHash }] })
        .mockResolvedValueOnce({ Items: [] });
      mockS3Client.send.mockResolvedValueOnce({
        Body: { transformToString: () => Promise.resolve(JSON.stringify(schema)) },
      });

      const result = await service.validateEntityState(
        { fields: { name: 'Test Account' } },
        'Account',
        '1.0'
      );
      expect(result).toBe(true);
    });

    it('should return false when getSchema throws', async () => {
      mockDynamoDBDocumentClient.send.mockRejectedValue(new Error('DynamoDB error'));

      const result = await service.validateEntityState(
        { fields: {} },
        'Account',
        '1.0'
      );
      expect(result).toBe(false);
    });
  });

  describe('registerSchema', () => {
    it('should register schema and invalidate cache', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({});

      await service.registerSchema({
        entityType: 'Account',
        version: '1.0',
        schemaHash: 'sha256:abc',
        s3Key: 'schemas/Account/1.0.json',
        schema: { entityType: 'Account', version: '1.0', fields: {} },
      });

      expect(mockDynamoDBDocumentClient.send).toHaveBeenCalledTimes(1);
    });

    it('should throw when PutCommand fails', async () => {
      mockDynamoDBDocumentClient.send.mockRejectedValue(new Error('ConditionalCheckFailedException'));

      await expect(
        service.registerSchema({
          entityType: 'Account',
          version: '1.0',
          schemaHash: 'sha256:abc',
          s3Key: 'schemas/Account/1.0.json',
          schema: {},
        })
      ).rejects.toThrow('ConditionalCheckFailedException');
    });
  });

  describe('SchemaHashMismatchError', () => {
    it('should have correct name', () => {
      const err = new SchemaHashMismatchError('test');
      expect(err.name).toBe('SchemaHashMismatchError');
      expect(err.message).toBe('test');
    });
  });
});
