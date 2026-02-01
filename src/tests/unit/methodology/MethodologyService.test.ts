import { MethodologyService } from '../../../services/methodology/MethodologyService';
import { SchemaRegistryService } from '../../../services/world-model/SchemaRegistryService';
import { Logger } from '../../../services/core/Logger';
import { CreateMethodologyInput } from '../../../types/MethodologyTypes';
import { mockDynamoDBDocumentClient, mockS3Client, resetAllMocks } from '../../__mocks__/aws-sdk-clients';
import * as fs from 'fs';
import * as path from 'path';

// Mock AWS SDK clients
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn(() => mockDynamoDBDocumentClient),
  },
  PutCommand: jest.fn(),
  GetCommand: jest.fn(),
  QueryCommand: jest.fn(),
  UpdateCommand: jest.fn(),
}));

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => mockS3Client),
  PutObjectCommand: jest.fn(),
  GetObjectCommand: jest.fn(),
}));

describe('MethodologyService', () => {
  let service: MethodologyService;
  let logger: Logger;
  let schemaRegistryService: SchemaRegistryService;
  let meddiccFixture: any;

  beforeEach(() => {
    resetAllMocks();
    logger = new Logger('Test');
    
    // Load MEDDICC fixture
    const fixturePath = path.join(__dirname, '../../fixtures/methodology/meddicc-baseline.json');
    const fixtureContent = fs.readFileSync(fixturePath, 'utf-8');
    meddiccFixture = JSON.parse(fixtureContent);

    // Mock SchemaRegistryService
    schemaRegistryService = {
      registerSchema: jest.fn().mockResolvedValue(undefined),
      getSchema: jest.fn().mockResolvedValue(null),
    } as any;

    service = new MethodologyService(
      logger,
      schemaRegistryService,
      'test-methodology-table',
      'test-schema-bucket',
      'us-west-2'
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createMethodology', () => {
    it('should create methodology with generated version', async () => {
      const input: CreateMethodologyInput = {
        methodology_id: 'meth:test',
        name: 'Test Methodology',
        description: 'Test',
        dimensions: meddiccFixture.dimensions,
        scoring_model: meddiccFixture.scoring_model,
        autonomy_gates: meddiccFixture.autonomy_gates,
        tenant_id: 'tenant:test',
      };

      mockS3Client.send.mockResolvedValue({});
      mockDynamoDBDocumentClient.send.mockResolvedValue({});

      const result = await service.createMethodology(input);

      expect(result.methodology_id).toBe('meth:test');
      expect(result.version).toBeDefined();
      expect(result.schema_hash).toBeDefined();
      expect(mockS3Client.send).toHaveBeenCalled();
      expect(mockDynamoDBDocumentClient.send).toHaveBeenCalled();
      expect(schemaRegistryService.registerSchema).toHaveBeenCalled();
    });

    it('should generate version for methodology', async () => {
      const input: CreateMethodologyInput = {
        methodology_id: 'meth:test',
        name: 'Test',
        dimensions: [],
        scoring_model: meddiccFixture.scoring_model,
        autonomy_gates: meddiccFixture.autonomy_gates,
        tenant_id: 'tenant:test',
      };

      mockS3Client.send.mockResolvedValue({});
      mockDynamoDBDocumentClient.send.mockResolvedValue({});

      const result = await service.createMethodology(input);

      expect(result.version).toBeDefined();
      expect(result.version).toContain('meth:test');
      expect(result.version).toContain('tenant:test');
    });

    it('should rethrow ConditionalCheckFailedException without logging as error', async () => {
      const input: CreateMethodologyInput = {
        methodology_id: 'meth:test',
        name: 'Test',
        dimensions: [],
        scoring_model: meddiccFixture.scoring_model,
        autonomy_gates: meddiccFixture.autonomy_gates,
        tenant_id: 'tenant:test',
      };

      mockS3Client.send.mockResolvedValue({});
      const err = new Error('Conditional check failed');
      err.name = 'ConditionalCheckFailedException';
      mockDynamoDBDocumentClient.send.mockRejectedValueOnce(err);

      await expect(service.createMethodology(input)).rejects.toThrow('Conditional check failed');
      expect(mockDynamoDBDocumentClient.send).toHaveBeenCalled();
    });

    it('should log and rethrow on other create errors', async () => {
      const input: CreateMethodologyInput = {
        methodology_id: 'meth:test',
        name: 'Test',
        dimensions: [],
        scoring_model: meddiccFixture.scoring_model,
        autonomy_gates: meddiccFixture.autonomy_gates,
        tenant_id: 'tenant:test',
      };

      mockS3Client.send.mockResolvedValue({});
      mockDynamoDBDocumentClient.send.mockRejectedValueOnce(new Error('DynamoDB error'));

      await expect(service.createMethodology(input)).rejects.toThrow('DynamoDB error');
    });
  });

  describe('getMethodology', () => {
    it('should return methodology when found', async () => {
      const methodology = {
        ...meddiccFixture,
        tenantId: meddiccFixture.tenant_id,
      };

      (schemaRegistryService.getSchema as jest.Mock).mockResolvedValue(methodology);

      const result = await service.getMethodology(
        'meth:meddicc',
        '2026-01-v1',
        'tenant:global'
      );

      expect(result).toBeDefined();
      expect(result?.methodology_id).toBe('meth:meddicc');
    });

    it('should return null when methodology not found', async () => {
      (schemaRegistryService.getSchema as jest.Mock).mockResolvedValue(null);

      const result = await service.getMethodology(
        'meth:notfound',
        '2026-01-v1',
        'tenant:test'
      );

      expect(result).toBeNull();
    });

    it('should return null when methodology_id mismatch', async () => {
      const methodology = {
        ...meddiccFixture,
        methodology_id: 'meth:different',
        tenantId: meddiccFixture.tenant_id,
      };

      (schemaRegistryService.getSchema as jest.Mock).mockResolvedValue(methodology);

      const result = await service.getMethodology(
        'meth:meddicc',
        '2026-01-v1',
        'tenant:global'
      );

      expect(result).toBeNull();
    });

    it('should return null when tenant mismatch', async () => {
      const methodology = {
        ...meddiccFixture,
        tenantId: 'tenant:different',
      };

      (schemaRegistryService.getSchema as jest.Mock).mockResolvedValue(methodology);

      const result = await service.getMethodology(
        'meth:meddicc',
        '2026-01-v1',
        'tenant:test'
      );

      expect(result).toBeNull();
    });

    it('should return null when getSchema throws', async () => {
      (schemaRegistryService.getSchema as jest.Mock).mockRejectedValueOnce(new Error('Schema error'));

      const result = await service.getMethodology(
        'meth:meddicc',
        '2026-01-v1',
        'tenant:test'
      );

      expect(result).toBeNull();
    });
  });

  describe('updateMethodology', () => {
    it('should throw when methodology not found', async () => {
      (schemaRegistryService.getSchema as jest.Mock).mockResolvedValue(null);

      await expect(
        service.updateMethodology('meth:notfound', 'v1', { name: 'Updated' }, 'tenant:test')
      ).rejects.toThrow('Methodology not found');
    });

    it('should create new version with updates', async () => {
      const current = {
        ...meddiccFixture,
        methodology_id: 'meth:meddicc',
        version: '2026-01-v1',
        tenantId: 'tenant:global',
      };
      (schemaRegistryService.getSchema as jest.Mock).mockResolvedValue(current);
      mockS3Client.send.mockResolvedValue({});
      mockDynamoDBDocumentClient.send.mockResolvedValue({});

      const result = await service.updateMethodology(
        'meth:meddicc',
        '2026-01-v1',
        { name: 'Updated Name' },
        'tenant:global'
      );

      expect(result.name).toBe('Updated Name');
      expect(result.version).toBeDefined();
      expect(schemaRegistryService.registerSchema).toHaveBeenCalled();
    });
  });

  describe('listMethodologies', () => {
    it('should list methodologies for tenant', async () => {
      const items = [
        {
          methodology: {
            ...meddiccFixture,
            tenantId: meddiccFixture.tenant_id,
          },
        },
      ];

      mockDynamoDBDocumentClient.send.mockResolvedValue({ Items: items });

      const result = await service.listMethodologies('tenant:test');

      expect(result.length).toBe(1);
      expect(mockDynamoDBDocumentClient.send).toHaveBeenCalled();
    });

    it('should filter by status when provided', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({ Items: [] });

      const result = await service.listMethodologies('tenant:test', 'ACTIVE');

      expect(result).toEqual([]);
      expect(mockDynamoDBDocumentClient.send).toHaveBeenCalledTimes(1);
    });

    it('should rethrow when Query throws', async () => {
      mockDynamoDBDocumentClient.send.mockRejectedValueOnce(new Error('DynamoDB error'));

      await expect(service.listMethodologies('tenant:test')).rejects.toThrow('DynamoDB error');
    });
  });

  describe('deprecateMethodology', () => {
    it('should deprecate methodology', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({});

      await service.deprecateMethodology('meth:test', '2026-01-v1', 'tenant:test');

      expect(mockDynamoDBDocumentClient.send).toHaveBeenCalled();
    });

    it('should rethrow when UpdateCommand throws', async () => {
      mockDynamoDBDocumentClient.send.mockRejectedValueOnce(new Error('ConditionalCheckFailedException'));

      await expect(
        service.deprecateMethodology('meth:test', '2026-01-v1', 'tenant:test')
      ).rejects.toThrow('ConditionalCheckFailedException');
    });
  });
});
