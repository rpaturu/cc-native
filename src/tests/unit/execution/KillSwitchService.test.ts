/**
 * KillSwitchService Unit Tests - Phase 4.2
 */

import { KillSwitchService } from '../../../services/execution/KillSwitchService';
import { Logger } from '../../../services/core/Logger';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { mockDynamoDBDocumentClient, resetAllMocks } from '../../__mocks__/aws-sdk-clients';
import tenantExecutionConfig from '../../fixtures/execution/tenant-execution-config.json';

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn(() => mockDynamoDBDocumentClient),
  },
  GetCommand: jest.fn(),
  UpdateCommand: jest.fn().mockImplementation((args: unknown) => args),
}));

describe('KillSwitchService', () => {
  let service: KillSwitchService;
  let logger: Logger;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    resetAllMocks();
    jest.clearAllMocks();
    logger = new Logger('KillSwitchServiceTest');
    service = new KillSwitchService(
      mockDynamoDBDocumentClient as any,
      'test-tenants-table',
      logger
    );

    // Save original env and clear GLOBAL_EXECUTION_STOP
    originalEnv = { ...process.env };
    delete process.env.GLOBAL_EXECUTION_STOP;
  });

  afterEach(() => {
    // Restore original env
    process.env = originalEnv;
  });

  describe('isExecutionEnabled', () => {
    it('should return false if global emergency stop is enabled', async () => {
      process.env.GLOBAL_EXECUTION_STOP = 'true';

      const enabled = await service.isExecutionEnabled('tenant_test_1');

      expect(enabled).toBe(false);
      // Should not check tenant config if global stop is enabled
      expect(GetCommand).not.toHaveBeenCalled();
    });

    it('should check tenant config if global stop is not enabled', async () => {
      delete process.env.GLOBAL_EXECUTION_STOP;
      mockDynamoDBDocumentClient.send.mockResolvedValue({
        Item: tenantExecutionConfig,
      });

      await service.isExecutionEnabled('tenant_test_1');

      expect(GetCommand).toHaveBeenCalled();
    });

    it('should return false if tenant execution is disabled', async () => {
      delete process.env.GLOBAL_EXECUTION_STOP;
      mockDynamoDBDocumentClient.send.mockResolvedValue({
        Item: {
          ...tenantExecutionConfig,
          execution_enabled: false,
        },
      });

      const enabled = await service.isExecutionEnabled('tenant_test_1');

      expect(enabled).toBe(false);
    });

    it('should return false if action type is in disabled_action_types', async () => {
      delete process.env.GLOBAL_EXECUTION_STOP;
      mockDynamoDBDocumentClient.send.mockResolvedValue({
        Item: {
          ...tenantExecutionConfig,
          disabled_action_types: ['CREATE_CRM_TASK'],
        },
      });

      const enabled = await service.isExecutionEnabled('tenant_test_1', 'CREATE_CRM_TASK');

      expect(enabled).toBe(false);
    });

    it('should return true if all checks pass', async () => {
      delete process.env.GLOBAL_EXECUTION_STOP;
      mockDynamoDBDocumentClient.send.mockResolvedValue({
        Item: tenantExecutionConfig,
      });

      const enabled = await service.isExecutionEnabled('tenant_test_1', 'CREATE_CRM_TASK');

      expect(enabled).toBe(true);
    });

    it('should return true if action type is not in disabled list', async () => {
      delete process.env.GLOBAL_EXECUTION_STOP;
      mockDynamoDBDocumentClient.send.mockResolvedValue({
        Item: {
          ...tenantExecutionConfig,
          disabled_action_types: ['SEND_EMAIL'], // Different action type
        },
      });

      const enabled = await service.isExecutionEnabled('tenant_test_1', 'CREATE_CRM_TASK');

      expect(enabled).toBe(true);
    });

    it('should return true if tenant config does not exist (default enabled)', async () => {
      delete process.env.GLOBAL_EXECUTION_STOP;
      mockDynamoDBDocumentClient.send.mockResolvedValue({
        Item: undefined,
      });

      const enabled = await service.isExecutionEnabled('tenant_test_1');

      expect(enabled).toBe(true);
    });
  });

  describe('getKillSwitchConfig', () => {
    it('should retrieve TenantExecutionConfig from DynamoDB', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({
        Item: tenantExecutionConfig,
      });

      const config = await service.getKillSwitchConfig('tenant_test_1');

      expect(config.tenant_id).toBe('tenant_test_1');
      expect(config.execution_enabled).toBe(true);
      expect(config.disabled_action_types).toEqual([]);
      expect(GetCommand).toHaveBeenCalled();
    });

    it('should return default config if tenant config does not exist', async () => {
      delete process.env.GLOBAL_EXECUTION_STOP;
      mockDynamoDBDocumentClient.send.mockResolvedValue({
        Item: undefined,
      });

      const config = await service.getKillSwitchConfig('tenant_test_1');

      expect(config.tenant_id).toBe('tenant_test_1');
      expect(config.execution_enabled).toBe(true);
      expect(config.disabled_action_types).toEqual([]);
      expect(config.global_emergency_stop).toBe(false);
    });

    it('should include global_emergency_stop in config', async () => {
      process.env.GLOBAL_EXECUTION_STOP = 'true';
      mockDynamoDBDocumentClient.send.mockResolvedValue({
        Item: tenantExecutionConfig,
      });

      const config = await service.getKillSwitchConfig('tenant_test_1');

      expect(config.global_emergency_stop).toBe(true);
    });

    it('should use correct DynamoDB key structure', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({
        Item: tenantExecutionConfig,
      });

      await service.getKillSwitchConfig('tenant_test_1');

      expect(GetCommand).toHaveBeenCalled();
      const getCommandCall = (GetCommand as unknown as jest.Mock).mock.calls[0][0];
      expect(getCommandCall.Key.tenantId).toBe('tenant_test_1');
    });

    it('should handle missing execution_enabled (defaults to true)', async () => {
      delete process.env.GLOBAL_EXECUTION_STOP;
      mockDynamoDBDocumentClient.send.mockResolvedValue({
        Item: {
          tenantId: 'tenant_test_1',
          // execution_enabled missing
        },
      });

      const config = await service.getKillSwitchConfig('tenant_test_1');

      expect(config.execution_enabled).toBe(true);
    });

    it('should handle missing disabled_action_types (defaults to empty array)', async () => {
      delete process.env.GLOBAL_EXECUTION_STOP;
      mockDynamoDBDocumentClient.send.mockResolvedValue({
        Item: {
          tenantId: 'tenant_test_1',
          execution_enabled: true,
          // disabled_action_types missing
        },
      });

      const config = await service.getKillSwitchConfig('tenant_test_1');

      expect(config.disabled_action_types).toEqual([]);
    });
  });

  describe('updateKillSwitchConfig (Phase 5.6)', () => {
    it('should update execution_enabled only', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({});

      await service.updateKillSwitchConfig('tenant_test_1', { execution_enabled: false });

      expect(UpdateCommand).toHaveBeenCalledTimes(1);
      const call = (UpdateCommand as unknown as jest.Mock).mock.calls[0][0];
      expect(call.TableName).toBe('test-tenants-table');
      expect(call.Key).toEqual({ tenantId: 'tenant_test_1' });
      expect(call.UpdateExpression).toContain('#execution_enabled = :en');
      expect(call.ExpressionAttributeValues[':en']).toBe(false);
    });

    it('should update disabled_action_types only', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({});

      await service.updateKillSwitchConfig('tenant_test_1', {
        disabled_action_types: ['SEND_EMAIL', 'CREATE_CRM_TASK'],
      });

      const call = (UpdateCommand as unknown as jest.Mock).mock.calls[0][0];
      expect(call.UpdateExpression).toContain('#disabled_action_types = :types');
      expect(call.ExpressionAttributeValues[':types']).toEqual(['SEND_EMAIL', 'CREATE_CRM_TASK']);
    });

    it('should update both execution_enabled and disabled_action_types', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({});

      await service.updateKillSwitchConfig('tenant_test_1', {
        execution_enabled: true,
        disabled_action_types: [],
      });

      const call = (UpdateCommand as unknown as jest.Mock).mock.calls[0][0];
      expect(call.ExpressionAttributeValues[':en']).toBe(true);
      expect(call.ExpressionAttributeValues[':types']).toEqual([]);
    });

    it('should set only updated_at when updates empty', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({});

      await service.updateKillSwitchConfig('tenant_test_1', {});

      const call = (UpdateCommand as unknown as jest.Mock).mock.calls[0][0];
      expect(call.UpdateExpression).toBe('SET #updated_at = :now');
      expect(Object.keys(call.ExpressionAttributeValues)).toEqual([':now']);
    });
  });
});
