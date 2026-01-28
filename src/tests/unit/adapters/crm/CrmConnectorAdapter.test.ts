/**
 * CrmConnectorAdapter Unit Tests - Phase 4.3
 */

import { CrmConnectorAdapter } from '../../../../adapters/crm/CrmConnectorAdapter';
import { Logger } from '../../../../services/core/Logger';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { mockDynamoDBDocumentClient, resetAllMocks } from '../../../__mocks__/aws-sdk-clients';
import { MCPToolInvocation, MCPResponse } from '../../../../types/MCPTypes';
import { ValidationError, ConfigurationError } from '../../../../types/ExecutionErrors';
import { ExternalObjectRef } from '../../../../types/ExecutionTypes';
import mcpInvocationCreateTask from '../../../fixtures/execution/adapters/mcp-tool-invocation-crm-create-task.json';
import salesforceResponseId from '../../../fixtures/execution/adapters/salesforce-api-response-id.json';
import salesforceResponseIdCapital from '../../../fixtures/execution/adapters/salesforce-api-response-id-capital.json';
import connectorConfigItem from '../../../fixtures/execution/adapters/connector-config-dynamodb-item.json';
import externalWriteDedupeLatest from '../../../fixtures/execution/external-write-dedupe-latest.json';

// Mock axios
jest.mock('axios', () => ({
  post: jest.fn(),
}));

// Mock Secrets Manager Client
const mockSecretsManagerClient = {
  send: jest.fn(),
};

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn(() => mockDynamoDBDocumentClient),
  },
  GetCommand: jest.fn(),
  PutCommand: jest.fn(),
}));

jest.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: jest.fn(() => mockSecretsManagerClient),
  GetSecretValueCommand: jest.fn(),
}));

// Mock IdempotencyService
jest.mock('../../../../services/execution/IdempotencyService', () => ({
  IdempotencyService: jest.fn().mockImplementation(() => ({
    checkExternalWriteDedupe: jest.fn(),
    recordExternalWriteDedupe: jest.fn(),
  })),
}));

import axios from 'axios';
import { IdempotencyService } from '../../../../services/execution/IdempotencyService';

describe('CrmConnectorAdapter', () => {
  let adapter: CrmConnectorAdapter;
  let logger: Logger;
  let mockIdempotencyService: jest.Mocked<IdempotencyService>;

  beforeEach(() => {
    resetAllMocks();
    jest.clearAllMocks();
    logger = new Logger('CrmConnectorAdapterTest');
    
    // Reset IdempotencyService mock
    mockIdempotencyService = {
      checkExternalWriteDedupe: jest.fn().mockResolvedValue(null),
      recordExternalWriteDedupe: jest.fn().mockResolvedValue(undefined),
    } as any;
    (IdempotencyService as jest.Mock).mockImplementation(() => mockIdempotencyService);

    adapter = new CrmConnectorAdapter(
      mockDynamoDBDocumentClient as any,
      'test-external-write-dedupe-table',
      'test-connector-config-table',
      mockSecretsManagerClient as any,
      logger
    );
  });

  describe('execute - Idempotency Check', () => {
    it('should return existing external_object_refs if idempotency_key already exists', async () => {
      const existingRefs: ExternalObjectRef[] = [
        {
          system: 'CRM',
          object_type: 'Task',
          object_id: '00T1234567890ABC',
          object_url: 'https://test.salesforce.com/00T1234567890ABC',
        },
      ];
      mockIdempotencyService.checkExternalWriteDedupe.mockResolvedValue(existingRefs);

      const invocation = mcpInvocationCreateTask as MCPToolInvocation;
      const response = await adapter.execute(invocation);

      expect(mockIdempotencyService.checkExternalWriteDedupe).toHaveBeenCalledWith(
        mockDynamoDBDocumentClient,
        'test-external-write-dedupe-table',
        'idempotency_key_123'
      );
      expect(axios.post).not.toHaveBeenCalled(); // Should skip Salesforce API call
      
      const resultText = response.result!.content[0].text;
      const resultData = JSON.parse(resultText);
      expect(resultData.external_object_refs).toEqual(existingRefs);
    });

    it('should throw ValidationError if idempotency_key missing', async () => {
      const invocation = {
        ...mcpInvocationCreateTask,
        params: {
          ...mcpInvocationCreateTask.params,
          arguments: {
            title: 'Test task',
            tenant_id: 'tenant_test_1',
            account_id: 'account_test_1',
            action_intent_id: 'ai_test_123',
          },
        },
      } as MCPToolInvocation;

      try {
        await adapter.execute(invocation);
        fail('Should have thrown ValidationError');
      } catch (err: any) {
        expect(err).toBeInstanceOf(ValidationError);
        expect(err.message).toContain('idempotency_key');
        expect(err.error_code).toBe('IDEMPOTENCY_KEY_MISSING');
      }
    });
  });

  describe('execute - create_task - Validation', () => {
    it('should throw ValidationError if action_intent_id missing', async () => {
      const invocation = {
        ...mcpInvocationCreateTask,
        params: {
          ...mcpInvocationCreateTask.params,
          arguments: {
            title: 'Test task',
            tenant_id: 'tenant_test_1',
            account_id: 'account_test_1',
            idempotency_key: 'key_123',
          },
        },
      } as MCPToolInvocation;

      await expect(adapter.execute(invocation)).rejects.toThrow(ValidationError);
      await expect(adapter.execute(invocation)).rejects.toThrow('action_intent_id');
    });

    it('should throw ValidationError if tenant_id/account_id missing', async () => {
      const invocation = {
        ...mcpInvocationCreateTask,
        params: {
          ...mcpInvocationCreateTask.params,
          arguments: {
            title: 'Test task',
            idempotency_key: 'key_123',
            action_intent_id: 'ai_test_123',
          },
        },
      } as MCPToolInvocation;

      await expect(adapter.execute(invocation)).rejects.toThrow(ValidationError);
      await expect(adapter.execute(invocation)).rejects.toThrow('tenant_id and account_id');
    });

    it('should throw ValidationError if tenant binding mismatch', async () => {
      const invocation = {
        ...mcpInvocationCreateTask,
        identity: {
          accessToken: 'oauth_token_123',
          tenantId: 'tenant_different',
          userId: 'user_test_1',
        },
      } as MCPToolInvocation;

      await expect(adapter.execute(invocation)).rejects.toThrow(ValidationError);
      await expect(adapter.execute(invocation)).rejects.toThrow('Tenant mismatch');
    });

    it('should throw ValidationError if OAuth token missing', async () => {
      const invocation = {
        ...mcpInvocationCreateTask,
        identity: undefined, // No identity (no OAuth token)
      } as MCPToolInvocation;

      // Mock config retrieval
      mockDynamoDBDocumentClient.send.mockResolvedValue({
        Item: connectorConfigItem,
      });

      try {
        await adapter.execute(invocation);
        fail('Should have thrown ValidationError');
      } catch (err: any) {
        expect(err).toBeInstanceOf(ValidationError);
        expect(err.message).toContain('OAuth token');
        expect(err.error_code).toBe('OAUTH_TOKEN_MISSING');
      }
    });
  });

  describe('execute - create_task - Config Retrieval', () => {
    it('should get Salesforce instance URL from ConnectorConfigService', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({
        Item: connectorConfigItem,
      });
      (axios.post as jest.Mock).mockResolvedValue({
        data: salesforceResponseId,
      });

      const invocation = mcpInvocationCreateTask as MCPToolInvocation;
      await adapter.execute(invocation);

      // Verify config was retrieved (ConnectorConfigService uses DynamoDB)
      expect(mockDynamoDBDocumentClient.send).toHaveBeenCalled();
    });

    it('should throw ConfigurationError if instance URL not found', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({}); // No config found

      const invocation = mcpInvocationCreateTask as MCPToolInvocation;
      
      await expect(adapter.execute(invocation)).rejects.toThrow(ConfigurationError);
      await expect(adapter.execute(invocation)).rejects.toThrow('Salesforce instance URL not found');
    });

    it('should use tenant_id and account_id for config lookup', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({
        Item: connectorConfigItem,
      });
      (axios.post as jest.Mock).mockResolvedValue({
        data: salesforceResponseId,
      });

      const invocation = mcpInvocationCreateTask as MCPToolInvocation;
      await adapter.execute(invocation);

      // ConnectorConfigService.getConnectorConfig is called internally
      // We verify it works by checking the Salesforce API call uses the instance URL
      expect(axios.post).toHaveBeenCalledWith(
        expect.stringContaining('https://test.salesforce.com'),
        expect.any(Object),
        expect.any(Object)
      );
    });
  });

  describe('execute - create_task - Salesforce API Call', () => {
    beforeEach(() => {
      // Setup config retrieval
      mockDynamoDBDocumentClient.send.mockResolvedValue({
        Item: connectorConfigItem,
      });
    });

    it('should call Salesforce REST API with correct URL', async () => {
      (axios.post as jest.Mock).mockResolvedValue({
        data: salesforceResponseId,
      });

      const invocation = mcpInvocationCreateTask as MCPToolInvocation;
      await adapter.execute(invocation);

      expect(axios.post).toHaveBeenCalledWith(
        'https://test.salesforce.com/services/data/v58.0/sobjects/Task/',
        expect.any(Object),
        expect.any(Object)
      );
    });

    it('should include OAuth token in Authorization header', async () => {
      (axios.post as jest.Mock).mockResolvedValue({
        data: salesforceResponseId,
      });

      const invocation = mcpInvocationCreateTask as MCPToolInvocation;
      await adapter.execute(invocation);

      expect(axios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer oauth_token_123',
          }),
        })
      );
    });

    it('should include Idempotency-Key header (best-effort)', async () => {
      (axios.post as jest.Mock).mockResolvedValue({
        data: salesforceResponseId,
      });

      const invocation = mcpInvocationCreateTask as MCPToolInvocation;
      await adapter.execute(invocation);

      expect(axios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Idempotency-Key': 'idempotency_key_123',
          }),
        })
      );
    });

    it('should handle Salesforce response with "id" field', async () => {
      (axios.post as jest.Mock).mockResolvedValue({
        data: salesforceResponseId,
      });

      const invocation = mcpInvocationCreateTask as MCPToolInvocation;
      const response = await adapter.execute(invocation);

      const resultText = response.result!.content[0].text;
      const resultData = JSON.parse(resultText);
      expect(resultData.external_object_refs[0].object_id).toBe('00T1234567890ABC');
    });

    it('should handle Salesforce response with "Id" field', async () => {
      (axios.post as jest.Mock).mockResolvedValue({
        data: salesforceResponseIdCapital,
      });

      const invocation = mcpInvocationCreateTask as MCPToolInvocation;
      const response = await adapter.execute(invocation);

      const resultText = response.result!.content[0].text;
      const resultData = JSON.parse(resultText);
      expect(resultData.external_object_refs[0].object_id).toBe('00T1234567890ABC');
    });

    it('should throw ValidationError if response missing task ID', async () => {
      (axios.post as jest.Mock).mockResolvedValue({
        data: { success: true }, // No id or Id field
      });

      const invocation = mcpInvocationCreateTask as MCPToolInvocation;
      
      try {
        await adapter.execute(invocation);
        fail('Should have thrown ValidationError');
      } catch (err: any) {
        expect(err).toBeInstanceOf(ValidationError);
        expect(err.message).toContain('missing task ID');
        expect(err.error_code).toBe('INVALID_CONNECTOR_RESPONSE');
      }
    });

    it('should throw ValidationError on 401 (auth failed)', async () => {
      const error: any = new Error('Unauthorized');
      error.response = {
        status: 401,
        data: { message: 'Invalid token' },
      };
      (axios.post as jest.Mock).mockRejectedValue(error);

      const invocation = mcpInvocationCreateTask as MCPToolInvocation;
      
      try {
        await adapter.execute(invocation);
        fail('Should have thrown ValidationError');
      } catch (err: any) {
        expect(err).toBeInstanceOf(ValidationError);
        expect(err.message).toContain('Salesforce authentication failed');
        expect(err.error_code).toBe('SALESFORCE_AUTH_FAILED');
      }
    });

    it('should throw ValidationError on 403 (auth failed)', async () => {
      const error: any = new Error('Forbidden');
      error.response = {
        status: 403,
        data: { message: 'Access denied' },
      };
      (axios.post as jest.Mock).mockRejectedValue(error);

      const invocation = mcpInvocationCreateTask as MCPToolInvocation;
      
      try {
        await adapter.execute(invocation);
        fail('Should have thrown ValidationError');
      } catch (err: any) {
        expect(err).toBeInstanceOf(ValidationError);
        expect(err.message).toContain('Salesforce authentication failed');
        expect(err.error_code).toBe('SALESFORCE_AUTH_FAILED');
      }
    });

    it('should re-throw other errors for retry logic', async () => {
      const error = new Error('Network error');
      (axios.post as jest.Mock).mockRejectedValue(error);

      const invocation = mcpInvocationCreateTask as MCPToolInvocation;
      
      await expect(adapter.execute(invocation)).rejects.toThrow('Network error');
    });
  });

  describe('execute - create_task - Dedupe Recording', () => {
    beforeEach(() => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({
        Item: connectorConfigItem,
      });
      (axios.post as jest.Mock).mockResolvedValue({
        data: salesforceResponseId,
      });
    });

    it('should record external_object_refs array in dedupe table', async () => {
      const invocation = mcpInvocationCreateTask as MCPToolInvocation;
      await adapter.execute(invocation);

      expect(mockIdempotencyService.recordExternalWriteDedupe).toHaveBeenCalledWith(
        mockDynamoDBDocumentClient,
        'test-external-write-dedupe-table',
        'idempotency_key_123',
        expect.arrayContaining([
          expect.objectContaining({
            system: 'CRM',
            object_type: 'Task',
            object_id: '00T1234567890ABC',
            object_url: expect.stringContaining('00T1234567890ABC'),
          }),
        ]),
        'ai_test_123',
        'crm.create_task'
      );
    });

    it('should include action_intent_id in dedupe record', async () => {
      const invocation = mcpInvocationCreateTask as MCPToolInvocation;
      await adapter.execute(invocation);

      expect(mockIdempotencyService.recordExternalWriteDedupe).toHaveBeenCalledWith(
        expect.any(Object),
        expect.any(String),
        expect.any(String),
        expect.any(Array),
        'ai_test_123', // action_intent_id
        expect.any(String)
      );
    });

    it('should include full ExternalObjectRef (system, object_type, object_id, object_url)', async () => {
      const invocation = mcpInvocationCreateTask as MCPToolInvocation;
      await adapter.execute(invocation);

      const callArgs = mockIdempotencyService.recordExternalWriteDedupe.mock.calls[0];
      const externalObjectRefs = callArgs[3] as ExternalObjectRef[];
      
      expect(externalObjectRefs[0]).toMatchObject({
        system: 'CRM',
        object_type: 'Task',
        object_id: '00T1234567890ABC',
        object_url: expect.stringContaining('https://test.salesforce.com'),
      });
    });
  });

  describe('execute - create_task - Response Format', () => {
    beforeEach(() => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({
        Item: connectorConfigItem,
      });
      (axios.post as jest.Mock).mockResolvedValue({
        data: salesforceResponseId,
      });
    });

    it('should return MCPResponse with external_object_refs array', async () => {
      const invocation = mcpInvocationCreateTask as MCPToolInvocation;
      const response = await adapter.execute(invocation);

      expect(response.jsonrpc).toBe('2.0');
      expect(response.id).toBe('invocation_789');
      expect(response.result).toBeDefined();
      
      const resultText = response.result!.content[0].text;
      const resultData = JSON.parse(resultText);
      expect(resultData.success).toBe(true);
      expect(Array.isArray(resultData.external_object_refs)).toBe(true);
    });

    it('should include object_url in ExternalObjectRef', async () => {
      const invocation = mcpInvocationCreateTask as MCPToolInvocation;
      const response = await adapter.execute(invocation);

      const resultText = response.result!.content[0].text;
      const resultData = JSON.parse(resultText);
      expect(resultData.external_object_refs[0].object_url).toContain('https://test.salesforce.com');
      expect(resultData.external_object_refs[0].object_url).toContain('00T1234567890ABC');
    });
  });

  describe('validate', () => {
    it('should return valid=true for correct parameters', async () => {
      const result = await adapter.validate({
        title: 'Test task',
        tenant_id: 'tenant_test_1',
        account_id: 'account_test_1',
      });

      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should return valid=false with error if title missing', async () => {
      const result = await adapter.validate({
        tenant_id: 'tenant_test_1',
        account_id: 'account_test_1',
      });

      expect(result.valid).toBe(false);
      expect(result.error).toContain('title is required');
    });
  });
});
