import { IdentityService } from '../../../services/core/IdentityService';
import { Logger } from '../../../services/core/Logger';
import {
  CreateUserIdentityInput,
  CreateAgentIdentityInput,
  UpdateUserIdentityInput,
  UpdateAgentIdentityInput,
} from '../../../types/IdentityTypes';
import { mockDynamoDBDocumentClient, mockCognitoClient, resetAllMocks } from '../../__mocks__/aws-sdk-clients';

// Mock AWS SDK clients
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn(() => mockDynamoDBDocumentClient),
  },
  GetCommand: jest.fn(),
  PutCommand: jest.fn(),
  UpdateCommand: jest.fn(),
  QueryCommand: jest.fn(),
}));

jest.mock('@aws-sdk/client-cognito-identity-provider', () => ({
  CognitoIdentityProviderClient: jest.fn(() => mockCognitoClient),
  AdminGetUserCommand: jest.fn(),
  ListUsersCommand: jest.fn(),
}));

describe('IdentityService', () => {
  let identityService: IdentityService;
  let logger: Logger;

  beforeEach(() => {
    resetAllMocks();
    logger = new Logger('IdentityServiceTest');
    identityService = new IdentityService(
      logger,
      'cc-native-identities',
      'test-user-pool-id',
      'us-west-2'
    );
  });

  describe('getUserIdentity', () => {
    it('should return user identity when found', async () => {
      const mockIdentity = {
        pk: 'USER#user-123',
        sk: 'TENANT#tenant-456',
        userId: 'user-123',
        tenantId: 'tenant-456',
        email: 'user@example.com',
        username: 'user123',
        firstName: 'John',
        lastName: 'Doe',
        roles: ['admin', 'user'],
        permissions: {
          canReadWorldState: true,
          canReadEvidence: true,
          canReadSnapshots: true,
          canExecuteTools: false,
          canCreateActions: true,
          canApproveActions: true,
        },
        status: 'ACTIVE',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      };

      (mockDynamoDBDocumentClient.send as jest.Mock).mockResolvedValue({
        Item: mockIdentity,
      });

      const result = await identityService.getUserIdentity('user-123', 'tenant-456');

      expect(result).toBeDefined();
      expect(result?.userId).toBe('user-123');
      expect(result?.email).toBe('user@example.com');
      expect(result?.status).toBe('ACTIVE');
    });

    it('should return null when user not found', async () => {
      (mockDynamoDBDocumentClient.send as jest.Mock).mockResolvedValue({
        Item: undefined,
      });

      const result = await identityService.getUserIdentity('user-123', 'tenant-456');

      expect(result).toBeNull();
    });
  });

  describe('getAgentIdentity', () => {
    it('should return agent identity when found', async () => {
      const mockIdentity = {
        pk: 'AGENT#agent-123',
        sk: 'TENANT#tenant-456',
        agentId: 'agent-123',
        tenantId: 'tenant-456',
        name: 'Test Agent',
        description: 'Test agent description',
        agentType: 'AUTONOMOUS_DECISION',
        permissions: {
          canReadWorldState: true,
          canReadEvidence: true,
          canReadSnapshots: true,
          canExecuteTools: true,
          canCreateActions: true,
          canApproveActions: false,
        },
        iamRoleArn: 'arn:aws:iam::123456789012:role/cc-native-agent-role',
        status: 'ACTIVE',
        capabilities: [],
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      };

      (mockDynamoDBDocumentClient.send as jest.Mock).mockResolvedValue({
        Item: mockIdentity,
      });

      const result = await identityService.getAgentIdentity('agent-123', 'tenant-456');

      expect(result).toBeDefined();
      expect(result?.agentId).toBe('agent-123');
      expect(result?.name).toBe('Test Agent');
      expect(result?.status).toBe('ACTIVE');
    });

    it('should return null when agent not found', async () => {
      (mockDynamoDBDocumentClient.send as jest.Mock).mockResolvedValue({
        Item: undefined,
      });

      const result = await identityService.getAgentIdentity('agent-123', 'tenant-456');

      expect(result).toBeNull();
    });
  });

  describe('validateUserIdentity', () => {
    it('should return true for active user with matching tenant', async () => {
      const mockIdentity = {
        pk: 'USER#user-123',
        sk: 'TENANT#tenant-456',
        userId: 'user-123',
        tenantId: 'tenant-456',
        email: 'user@example.com',
        status: 'ACTIVE',
        cognitoUserId: 'cognito-user-123',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      };

      (mockDynamoDBDocumentClient.send as jest.Mock).mockResolvedValueOnce({
        Item: mockIdentity,
      });

      (mockCognitoClient.send as jest.Mock).mockResolvedValue({
        Username: 'cognito-user-123',
        UserStatus: 'CONFIRMED',
      });

      const result = await identityService.validateUserIdentity('user-123', 'tenant-456');

      expect(result).toBe(true);
    });

    it('should return false for inactive user', async () => {
      const mockIdentity = {
        pk: 'USER#user-123',
        sk: 'TENANT#tenant-456',
        userId: 'user-123',
        tenantId: 'tenant-456',
        email: 'user@example.com',
        status: 'SUSPENDED',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      };

      (mockDynamoDBDocumentClient.send as jest.Mock).mockResolvedValue({
        Item: mockIdentity,
      });

      const result = await identityService.validateUserIdentity('user-123', 'tenant-456');

      expect(result).toBe(false);
    });

    it('should return false for tenant mismatch', async () => {
      const mockIdentity = {
        pk: 'USER#user-123',
        sk: 'TENANT#tenant-456',
        userId: 'user-123',
        tenantId: 'tenant-999', // Different tenant
        email: 'user@example.com',
        status: 'ACTIVE',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      };

      (mockDynamoDBDocumentClient.send as jest.Mock).mockResolvedValue({
        Item: mockIdentity,
      });

      const result = await identityService.validateUserIdentity('user-123', 'tenant-456');

      expect(result).toBe(false);
    });
  });

  describe('validateAgentIdentity', () => {
    it('should return true for active agent with matching tenant', async () => {
      const mockIdentity = {
        pk: 'AGENT#agent-123',
        sk: 'TENANT#tenant-456',
        agentId: 'agent-123',
        tenantId: 'tenant-456',
        name: 'Test Agent',
        agentType: 'AUTONOMOUS_DECISION',
        status: 'ACTIVE',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      };

      (mockDynamoDBDocumentClient.send as jest.Mock).mockResolvedValue({
        Item: mockIdentity,
      });

      const result = await identityService.validateAgentIdentity('agent-123', 'tenant-456');

      expect(result).toBe(true);
    });

    it('should return false for inactive agent', async () => {
      const mockIdentity = {
        pk: 'AGENT#agent-123',
        sk: 'TENANT#tenant-456',
        agentId: 'agent-123',
        tenantId: 'tenant-456',
        name: 'Test Agent',
        agentType: 'AUTONOMOUS_DECISION',
        status: 'SUSPENDED',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      };

      (mockDynamoDBDocumentClient.send as jest.Mock).mockResolvedValue({
        Item: mockIdentity,
      });

      const result = await identityService.validateAgentIdentity('agent-123', 'tenant-456');

      expect(result).toBe(false);
    });
  });

  describe('createUserIdentity', () => {
    it('should create user identity successfully', async () => {
      const input: CreateUserIdentityInput = {
        userId: 'user-123',
        tenantId: 'tenant-456',
        email: 'user@example.com',
        username: 'user123',
        firstName: 'John',
        lastName: 'Doe',
        roles: ['admin'],
      };

      (mockDynamoDBDocumentClient.send as jest.Mock).mockResolvedValue({});

      const result = await identityService.createUserIdentity(input);

      expect(result).toBeDefined();
      expect(result.userId).toBe('user-123');
      expect(result.email).toBe('user@example.com');
      expect(result.status).toBe('ACTIVE');
      expect(result.permissions.canReadWorldState).toBe(true);
    });
  });

  describe('createAgentIdentity', () => {
    it('should create agent identity successfully', async () => {
      const input: CreateAgentIdentityInput = {
        agentId: 'agent-123',
        tenantId: 'tenant-456',
        name: 'Test Agent',
        description: 'Test agent',
        agentType: 'AUTONOMOUS_DECISION',
        capabilities: [
          {
            capability: 'read_world_state',
            allowed: true,
          },
        ],
      };

      (mockDynamoDBDocumentClient.send as jest.Mock).mockResolvedValue({});

      const result = await identityService.createAgentIdentity(input);

      expect(result).toBeDefined();
      expect(result.agentId).toBe('agent-123');
      expect(result.name).toBe('Test Agent');
      expect(result.status).toBe('ACTIVE');
      expect(result.permissions.canReadWorldState).toBe(true);
      expect(result.permissions.canApproveActions).toBe(false); // Agents cannot approve
    });
  });

  describe('updateUserIdentity', () => {
    it('should update user identity successfully', async () => {
      const existing = {
        pk: 'USER#user-123',
        sk: 'TENANT#tenant-456',
        userId: 'user-123',
        tenantId: 'tenant-456',
        email: 'user@example.com',
        roles: ['user'],
        permissions: {
          canReadWorldState: true,
          canReadEvidence: true,
          canReadSnapshots: true,
          canExecuteTools: false,
          canCreateActions: true,
          canApproveActions: false,
        },
        status: 'ACTIVE',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      };

      (mockDynamoDBDocumentClient.send as jest.Mock)
        .mockResolvedValueOnce({ Item: existing })
        .mockResolvedValueOnce({});

      const updates: UpdateUserIdentityInput = {
        roles: ['admin', 'user'],
        status: 'ACTIVE',
      };

      const result = await identityService.updateUserIdentity('user-123', 'tenant-456', updates);

      expect(result).toBeDefined();
      expect(result.roles).toEqual(['admin', 'user']);
    });

    it('should throw error if user not found', async () => {
      (mockDynamoDBDocumentClient.send as jest.Mock).mockResolvedValue({
        Item: undefined,
      });

      await expect(
        identityService.updateUserIdentity('user-123', 'tenant-456', { roles: ['admin'] })
      ).rejects.toThrow('User identity not found');
    });
  });

  describe('updateAgentIdentity', () => {
    it('should update agent identity successfully', async () => {
      const existing = {
        pk: 'AGENT#agent-123',
        sk: 'TENANT#tenant-456',
        agentId: 'agent-123',
        tenantId: 'tenant-456',
        name: 'Test Agent',
        agentType: 'AUTONOMOUS_DECISION',
        permissions: {
          canReadWorldState: true,
          canReadEvidence: true,
          canReadSnapshots: true,
          canExecuteTools: true,
          canCreateActions: true,
          canApproveActions: false,
        },
        status: 'ACTIVE',
        capabilities: [],
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      };

      (mockDynamoDBDocumentClient.send as jest.Mock)
        .mockResolvedValueOnce({ Item: existing })
        .mockResolvedValueOnce({});

      const updates: UpdateAgentIdentityInput = {
        name: 'Updated Agent',
        status: 'ACTIVE',
      };

      const result = await identityService.updateAgentIdentity('agent-123', 'tenant-456', updates);

      expect(result).toBeDefined();
      expect(result.name).toBe('Updated Agent');
    });
  });
});
