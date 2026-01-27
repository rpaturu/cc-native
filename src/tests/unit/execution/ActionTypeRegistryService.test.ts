/**
 * ActionTypeRegistryService Unit Tests - Phase 4.2
 */

import { ActionTypeRegistryService } from '../../../services/execution/ActionTypeRegistryService';
import { Logger } from '../../../services/core/Logger';
import { DynamoDBDocumentClient, GetCommand, QueryCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { mockDynamoDBDocumentClient, resetAllMocks } from '../../__mocks__/aws-sdk-clients';
import { ActionTypeRegistry } from '../../../types/ExecutionTypes';
import { ValidationError } from '../../../types/ExecutionErrors';
import actionTypeRegistryV1 from '../../fixtures/execution/action-type-registry-v1.json';
import actionTypeRegistryV2 from '../../fixtures/execution/action-type-registry-v2.json';

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn(() => mockDynamoDBDocumentClient),
  },
  GetCommand: jest.fn(),
  QueryCommand: jest.fn(),
  PutCommand: jest.fn(),
}));

describe('ActionTypeRegistryService', () => {
  let service: ActionTypeRegistryService;
  let logger: Logger;

  beforeEach(() => {
    resetAllMocks();
    jest.clearAllMocks();
    logger = new Logger('ActionTypeRegistryServiceTest');
    service = new ActionTypeRegistryService(
      mockDynamoDBDocumentClient as any,
      'test-action-type-registry-table',
      logger
    );
  });

  describe('getToolMapping', () => {
    describe('Specific Version Lookup', () => {
      it('should retrieve tool mapping for specific registry_version', async () => {
        mockDynamoDBDocumentClient.send.mockResolvedValue({
          Item: actionTypeRegistryV1 as ActionTypeRegistry,
        });

        const mapping = await service.getToolMapping('CREATE_CRM_TASK', 1);

        expect(mapping).toBeDefined();
        expect(mapping?.action_type).toBe('CREATE_CRM_TASK');
        expect(mapping?.registry_version).toBe(1);
        expect(mapping?.tool_name).toBe('crm.create_task');
        expect(GetCommand).toHaveBeenCalled();
      });

      it('should return null if version does not exist', async () => {
        mockDynamoDBDocumentClient.send.mockResolvedValue({
          Item: undefined,
        });

        const mapping = await service.getToolMapping('CREATE_CRM_TASK', 999);

        expect(mapping).toBeNull();
      });

      it('should use correct DynamoDB key structure for version lookup', async () => {
        mockDynamoDBDocumentClient.send.mockResolvedValue({
          Item: actionTypeRegistryV1 as ActionTypeRegistry,
        });

        await service.getToolMapping('CREATE_CRM_TASK', 1);

        expect(GetCommand).toHaveBeenCalled();
        const getCommandCall = (GetCommand as unknown as jest.Mock).mock.calls[0][0];
        expect(getCommandCall.Key.pk).toBe('ACTION_TYPE#CREATE_CRM_TASK');
        expect(getCommandCall.Key.sk).toBe('REGISTRY_VERSION#1');
      });
    });

    describe('Latest Version Lookup', () => {
      it('should query all versions for action_type', async () => {
        mockDynamoDBDocumentClient.send.mockResolvedValue({
          Items: [actionTypeRegistryV1, actionTypeRegistryV2] as ActionTypeRegistry[],
        });

        await service.getToolMapping('CREATE_CRM_TASK');

        expect(QueryCommand).toHaveBeenCalled();
        const queryCommandCall = (QueryCommand as unknown as jest.Mock).mock.calls[0][0];
        expect(queryCommandCall.KeyConditionExpression).toBe('pk = :pk');
        expect(queryCommandCall.ExpressionAttributeValues[':pk']).toBe('ACTION_TYPE#CREATE_CRM_TASK');
      });

      it('should sort by registry_version descending and return highest', async () => {
        mockDynamoDBDocumentClient.send.mockResolvedValue({
          Items: [actionTypeRegistryV1, actionTypeRegistryV2] as ActionTypeRegistry[],
        });

        const mapping = await service.getToolMapping('CREATE_CRM_TASK');

        expect(mapping?.registry_version).toBe(2); // Highest version
        expect(mapping?.tool_schema_version).toBe('v1.1');
      });

      it('should return null if no versions exist', async () => {
        mockDynamoDBDocumentClient.send.mockResolvedValue({
          Items: [],
        });

        const mapping = await service.getToolMapping('UNKNOWN_ACTION');

        expect(mapping).toBeNull();
      });

      it('should filter out items with missing registry_version', async () => {
        const invalidItem = {
          ...actionTypeRegistryV1,
          registry_version: undefined,
        };

        mockDynamoDBDocumentClient.send.mockResolvedValue({
          Items: [invalidItem, actionTypeRegistryV2] as any[],
        });

        const mapping = await service.getToolMapping('CREATE_CRM_TASK');

        // Should return v2 (v1 filtered out due to missing registry_version)
        expect(mapping?.registry_version).toBe(2);
      });

      it('should filter out items with invalid registry_version', async () => {
        const invalidItem = {
          ...actionTypeRegistryV1,
          registry_version: 'invalid', // Not a number
        };

        mockDynamoDBDocumentClient.send.mockResolvedValue({
          Items: [invalidItem, actionTypeRegistryV2] as any[],
        });

        const mapping = await service.getToolMapping('CREATE_CRM_TASK');

        // Should return v2 (v1 filtered out due to invalid registry_version)
        expect(mapping?.registry_version).toBe(2);
      });

      it('should filter out items with negative registry_version', async () => {
        const invalidItem = {
          ...actionTypeRegistryV1,
          registry_version: -1,
        };

        mockDynamoDBDocumentClient.send.mockResolvedValue({
          Items: [invalidItem, actionTypeRegistryV2] as any[],
        });

        const mapping = await service.getToolMapping('CREATE_CRM_TASK');

        // Should return v2 (v1 filtered out due to negative registry_version)
        expect(mapping?.registry_version).toBe(2);
      });
    });
  });

  describe('mapParametersToToolArguments', () => {
    it('should map action parameters to tool arguments using parameter_mapping', () => {
      const registry = actionTypeRegistryV1 as ActionTypeRegistry;
      const actionParameters = {
        title: 'Test Task',
        priority: 'high',
      };

      const toolArguments = service.mapParametersToToolArguments(registry, actionParameters);

      expect(toolArguments.title).toBe('Test Task');
      expect(toolArguments.priority).toBe('HIGH'); // UPPERCASE transform
    });

    it('should handle PASSTHROUGH transform', () => {
      const registry = actionTypeRegistryV1 as ActionTypeRegistry;
      const actionParameters = {
        title: 'Test Task',
      };

      const toolArguments = service.mapParametersToToolArguments(registry, actionParameters);

      expect(toolArguments.title).toBe('Test Task'); // No transformation
    });

    it('should handle UPPERCASE transform', () => {
      const registry = actionTypeRegistryV1 as ActionTypeRegistry;
      const actionParameters = {
        title: 'Test Task', // Required parameter
        priority: 'high',
      };

      const toolArguments = service.mapParametersToToolArguments(registry, actionParameters);

      expect(toolArguments.priority).toBe('HIGH');
    });

    it('should handle LOWERCASE transform', () => {
      const registry = {
        ...actionTypeRegistryV1,
        parameter_mapping: {
          priority: {
            toolParam: 'priority',
            transform: 'LOWERCASE',
            required: false,
          },
        },
      } as ActionTypeRegistry;

      const actionParameters = {
        priority: 'HIGH',
      };

      const toolArguments = service.mapParametersToToolArguments(registry, actionParameters);

      expect(toolArguments.priority).toBe('high');
    });

    it('should throw ValidationError for missing required parameters', () => {
      const registry = actionTypeRegistryV1 as ActionTypeRegistry;
      const actionParameters = {
        // title is required but missing
        priority: 'high',
      };

      expect(() => {
        service.mapParametersToToolArguments(registry, actionParameters);
      }).toThrow(ValidationError);
    });

    it('should not include optional parameters if not provided', () => {
      const registry = actionTypeRegistryV1 as ActionTypeRegistry;
      const actionParameters = {
        title: 'Test Task',
        // priority is optional, not provided
      };

      const toolArguments = service.mapParametersToToolArguments(registry, actionParameters);

      expect(toolArguments.title).toBe('Test Task');
      expect(toolArguments.priority).toBeUndefined();
    });

    it('should handle multiple parameters with different transforms', () => {
      const registry = actionTypeRegistryV2 as ActionTypeRegistry;
      const actionParameters = {
        title: 'Test Task',
        priority: 'high',
        description: 'Test Description',
      };

      const toolArguments = service.mapParametersToToolArguments(registry, actionParameters);

      expect(toolArguments.title).toBe('Test Task'); // PASSTHROUGH
      expect(toolArguments.priority).toBe('HIGH'); // UPPERCASE
      expect(toolArguments.description).toBe('Test Description'); // PASSTHROUGH
    });
  });

  describe('registerMapping', () => {
    it('should create new mapping with registry_version=1 if first version', async () => {
      // getToolMapping returns null (no existing versions)
      mockDynamoDBDocumentClient.send
        .mockResolvedValueOnce({ Items: [] }) // getToolMapping query
        .mockResolvedValueOnce({}); // PutCommand

      await service.registerMapping({
        action_type: 'CREATE_CRM_TASK',
        tool_name: 'crm.create_task',
        tool_schema_version: 'v1.0',
        required_scopes: ['salesforce_api'],
        risk_class: 'LOW',
        compensation_strategy: 'AUTOMATIC',
        parameter_mapping: {
          title: {
            toolParam: 'title',
            transform: 'PASSTHROUGH',
            required: true,
          },
        },
      });

      expect(PutCommand).toHaveBeenCalled();
      const putCommandCall = (PutCommand as unknown as jest.Mock).mock.calls[0][0];
      expect(putCommandCall.Item.registry_version).toBe(1);
      expect(putCommandCall.Item.pk).toBe('ACTION_TYPE#CREATE_CRM_TASK');
      expect(putCommandCall.Item.sk).toBe('REGISTRY_VERSION#1');
    });

    it('should auto-increment registry_version if versions exist', async () => {
      // getToolMapping returns latest version (v2)
      mockDynamoDBDocumentClient.send
        .mockResolvedValueOnce({
          Items: [actionTypeRegistryV1, actionTypeRegistryV2] as ActionTypeRegistry[],
        }) // getToolMapping query
        .mockResolvedValueOnce({}); // PutCommand

      await service.registerMapping({
        action_type: 'CREATE_CRM_TASK',
        tool_name: 'crm.create_task',
        tool_schema_version: 'v1.2',
        required_scopes: ['salesforce_api'],
        risk_class: 'LOW',
        compensation_strategy: 'AUTOMATIC',
        parameter_mapping: {
          title: {
            toolParam: 'title',
            transform: 'PASSTHROUGH',
            required: true,
          },
        },
      });

      expect(PutCommand).toHaveBeenCalled();
      const putCommandCall = (PutCommand as unknown as jest.Mock).mock.calls[0][0];
      expect(putCommandCall.Item.registry_version).toBe(3); // Incremented from 2
      expect(putCommandCall.Item.sk).toBe('REGISTRY_VERSION#3');
    });

    it('should set created_at timestamp', async () => {
      mockDynamoDBDocumentClient.send
        .mockResolvedValueOnce({ Items: [] })
        .mockResolvedValueOnce({});

      await service.registerMapping({
        action_type: 'CREATE_CRM_TASK',
        tool_name: 'crm.create_task',
        tool_schema_version: 'v1.0',
        required_scopes: ['salesforce_api'],
        risk_class: 'LOW',
        compensation_strategy: 'AUTOMATIC',
        parameter_mapping: {},
      });

      expect(PutCommand).toHaveBeenCalled();
      const putCommandCall = (PutCommand as unknown as jest.Mock).mock.calls[0][0];
      expect(putCommandCall.Item.created_at).toBeDefined();
      expect(putCommandCall.Item.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });
  });
});
