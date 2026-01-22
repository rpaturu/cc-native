import { TenantService } from '../../../services/core/TenantService';
import { Logger } from '../../../services/core/Logger';
import { DynamoDBDocumentClient, PutCommand, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { mockDynamoDBDocumentClient, resetAllMocks, createDynamoDBSuccessResponse } from '../../__mocks__/aws-sdk-clients';
import { v4 as uuidv4 } from 'uuid';

// Mock the DynamoDBDocumentClient
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn(() => mockDynamoDBDocumentClient),
  },
  PutCommand: jest.fn(),
  GetCommand: jest.fn(),
  UpdateCommand: jest.fn(),
}));

describe('TenantService', () => {
  let tenantService: TenantService;
  let logger: Logger;

  beforeEach(() => {
    resetAllMocks();
    logger = new Logger('TenantServiceTest');
    tenantService = new TenantService(
      logger,
      'test-tenants-table',
      'us-west-2'
    );
  });

  describe('createTenant', () => {
    it('should create a new tenant', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({});

      const tenantId = `tenant-${uuidv4()}`;
      const tenant = await tenantService.createTenant({
        tenantId,
        name: 'Test Tenant',
        config: {
          features: { feature1: true },
          limits: { maxAccounts: 100 },
        },
      });

      expect(tenant.tenantId).toBe(tenantId);
      expect(tenant.name).toBe('Test Tenant');
      expect(tenant.status).toBe('active');
      expect(mockDynamoDBDocumentClient.send).toHaveBeenCalledTimes(1);
    });

    it('should require tenantId in input', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({});

      const tenantId = `tenant-${uuidv4()}`;
      const tenant = await tenantService.createTenant({
        tenantId,
        name: 'Test Tenant',
      });

      expect(tenant.tenantId).toBe(tenantId);
    });
  });

  describe('getTenant', () => {
    it('should retrieve tenant by ID', async () => {
      const tenantData = {
        tenantId: 'tenant-123',
        name: 'Test Tenant',
        status: 'active',
        config: { name: 'Test Tenant' },
        metadata: {},
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      };

      mockDynamoDBDocumentClient.send.mockResolvedValue({
        Item: tenantData,
      });

      const tenant = await tenantService.getTenant('tenant-123');

      expect(tenant).toBeDefined();
      expect(tenant?.tenantId).toBe('tenant-123');
      expect(tenant?.name).toBe('Test Tenant');
    });

    it('should return null for non-existent tenant', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({
        Item: undefined,
      });

      const tenant = await tenantService.getTenant('non-existent');

      expect(tenant).toBeNull();
    });
  });

  describe('updateTenant', () => {
    it('should update tenant name', async () => {
      const updatedTenant = {
        tenantId: 'tenant-123',
        name: 'Updated Tenant',
        status: 'active',
        config: { name: 'Updated Tenant' },
        metadata: {},
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-02T00:00:00Z',
      };

      mockDynamoDBDocumentClient.send.mockResolvedValue({
        Attributes: updatedTenant,
      });

      const updated = await tenantService.updateTenant('tenant-123', {
        name: 'Updated Tenant',
      });

      expect(updated).toBeDefined();
      expect(updated.name).toBe('Updated Tenant');
      expect(mockDynamoDBDocumentClient.send).toHaveBeenCalledTimes(1);
    });

    it('should update tenant status', async () => {
      const updatedTenant = {
        tenantId: 'tenant-123',
        name: 'Test Tenant',
        status: 'suspended',
        config: { name: 'Test Tenant' },
        metadata: {},
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-02T00:00:00Z',
      };

      mockDynamoDBDocumentClient.send.mockResolvedValue({
        Attributes: updatedTenant,
      });

      const updated = await tenantService.updateTenant('tenant-123', {
        status: 'suspended',
      });

      expect(updated.status).toBe('suspended');
    });

    it('should throw error if tenant not found (ConditionExpression fails)', async () => {
      const error = new Error('ConditionalCheckFailedException');
      (error as any).name = 'ConditionalCheckFailedException';
      mockDynamoDBDocumentClient.send.mockRejectedValue(error);

      await expect(
        tenantService.updateTenant('non-existent', { name: 'Updated' })
      ).rejects.toThrow();
    });
  });
});
