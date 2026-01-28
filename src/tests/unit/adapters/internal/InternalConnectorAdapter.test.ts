/**
 * InternalConnectorAdapter Unit Tests - Phase 4.3
 */

import { InternalConnectorAdapter } from '../../../../adapters/internal/InternalConnectorAdapter';
import { Logger } from '../../../../services/core/Logger';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { mockDynamoDBDocumentClient, resetAllMocks } from '../../../__mocks__/aws-sdk-clients';
import { MCPToolInvocation, MCPResponse } from '../../../../types/MCPTypes';
import { ValidationError } from '../../../../types/ExecutionErrors';
import mcpInvocationCreateNote from '../../../fixtures/execution/adapters/mcp-tool-invocation-internal-create-note.json';
import mcpInvocationCreateTask from '../../../fixtures/execution/adapters/mcp-tool-invocation-internal-create-task.json';

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn(() => mockDynamoDBDocumentClient),
  },
  PutCommand: jest.fn(),
}));

describe('InternalConnectorAdapter', () => {
  let adapter: InternalConnectorAdapter;
  let logger: Logger;

  beforeEach(() => {
    resetAllMocks();
    jest.clearAllMocks();
    logger = new Logger('InternalConnectorAdapterTest');
    adapter = new InternalConnectorAdapter(
      mockDynamoDBDocumentClient as any,
      'test-internal-notes-table',
      'test-internal-tasks-table',
      logger
    );
  });

  describe('execute - create_note', () => {
    it('should create note in DynamoDB with correct partition key structure', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({});

      const invocation = mcpInvocationCreateNote as MCPToolInvocation;
      const response = await adapter.execute(invocation);

      expect(PutCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          TableName: 'test-internal-notes-table',
          Item: expect.objectContaining({
            pk: 'TENANT#tenant_test_1#ACCOUNT#account_test_1',
            sk: expect.stringMatching(/^NOTE#note_/),
            note_id: expect.any(String),
            content: 'Test note content',
            tenant_id: 'tenant_test_1',
            account_id: 'account_test_1',
            created_by: 'invocation_123',
          }),
        })
      );
    });

    it('should generate unique note_id', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({});

      const invocation = mcpInvocationCreateNote as MCPToolInvocation;
      const response1 = await adapter.execute(invocation);
      const response2 = await adapter.execute(invocation);

      const call1 = (PutCommand as unknown as jest.Mock).mock.calls[0][0].Item.note_id;
      const call2 = (PutCommand as unknown as jest.Mock).mock.calls[1][0].Item.note_id;
      expect(call1).not.toBe(call2);
    });

    it('should persist before returning success', async () => {
      let putCalled = false;
      mockDynamoDBDocumentClient.send.mockImplementation(async (command: any) => {
        if (command instanceof PutCommand) {
          putCalled = true;
        }
        return {};
      });

      const invocation = mcpInvocationCreateNote as MCPToolInvocation;
      const response = await adapter.execute(invocation);

      expect(putCalled).toBe(true);
      expect(response.result).toBeDefined();
    });

    it('should return MCPResponse with external_object_refs array', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({});

      const invocation = mcpInvocationCreateNote as MCPToolInvocation;
      const response = await adapter.execute(invocation);

      expect(response.jsonrpc).toBe('2.0');
      expect(response.id).toBe('invocation_123');
      expect(response.result).toBeDefined();
      
      const resultText = response.result!.content[0].text;
      const resultData = JSON.parse(resultText);
      expect(resultData.success).toBe(true);
      expect(resultData.external_object_refs).toBeDefined();
      expect(Array.isArray(resultData.external_object_refs)).toBe(true);
      expect(resultData.external_object_refs[0]).toMatchObject({
        system: 'INTERNAL',
        object_type: 'Note',
        object_id: expect.any(String),
      });
    });

    it('should include invocationId in created_by field', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({});

      const invocation = mcpInvocationCreateNote as MCPToolInvocation;
      await adapter.execute(invocation);

      expect(PutCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          Item: expect.objectContaining({
            created_by: 'invocation_123',
          }),
        })
      );
    });

    it('should throw ValidationError if content missing', async () => {
      const invocation = {
        ...mcpInvocationCreateNote,
        params: {
          ...mcpInvocationCreateNote.params,
          arguments: {
            tenant_id: 'tenant_test_1',
            account_id: 'account_test_1',
          },
        },
      } as MCPToolInvocation;

      await expect(adapter.execute(invocation)).rejects.toThrow(ValidationError);
      await expect(adapter.execute(invocation)).rejects.toThrow('Missing required field: content');
    });

    it('should throw ValidationError if tenant_id missing', async () => {
      const invocation = {
        ...mcpInvocationCreateNote,
        params: {
          ...mcpInvocationCreateNote.params,
          arguments: {
            content: 'Test content',
            account_id: 'account_test_1',
          },
        },
      } as MCPToolInvocation;

      await expect(adapter.execute(invocation)).rejects.toThrow(ValidationError);
      await expect(adapter.execute(invocation)).rejects.toThrow('tenant_id and account_id must be present');
    });

    it('should throw ValidationError if account_id missing', async () => {
      const invocation = {
        ...mcpInvocationCreateNote,
        params: {
          ...mcpInvocationCreateNote.params,
          arguments: {
            content: 'Test content',
            tenant_id: 'tenant_test_1',
          },
        },
      } as MCPToolInvocation;

      await expect(adapter.execute(invocation)).rejects.toThrow(ValidationError);
      await expect(adapter.execute(invocation)).rejects.toThrow('tenant_id and account_id must be present');
    });

    it('should throw ValidationError if tenant binding mismatch', async () => {
      const invocation = {
        ...mcpInvocationCreateNote,
        identity: {
          accessToken: 'token_internal_123',
          tenantId: 'tenant_different',
          userId: 'user_test_1',
        },
      } as MCPToolInvocation;

      await expect(adapter.execute(invocation)).rejects.toThrow(ValidationError);
      await expect(adapter.execute(invocation)).rejects.toThrow('Tenant mismatch');
    });
  });

  describe('execute - create_task', () => {
    it('should create task in DynamoDB with correct partition key structure', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({});

      const invocation = mcpInvocationCreateTask as MCPToolInvocation;
      const response = await adapter.execute(invocation);

      expect(PutCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          TableName: 'test-internal-tasks-table',
          Item: expect.objectContaining({
            pk: 'TENANT#tenant_test_1#ACCOUNT#account_test_1',
            sk: expect.stringMatching(/^TASK#task_/),
            task_id: expect.any(String),
            title: 'Test task title',
            description: 'Test task description',
            tenant_id: 'tenant_test_1',
            account_id: 'account_test_1',
            created_by: 'invocation_456',
          }),
        })
      );
    });

    it('should generate unique task_id', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({});

      const invocation = mcpInvocationCreateTask as MCPToolInvocation;
      await adapter.execute(invocation);
      await adapter.execute(invocation);

      const call1 = (PutCommand as unknown as jest.Mock).mock.calls[0][0].Item.task_id;
      const call2 = (PutCommand as unknown as jest.Mock).mock.calls[1][0].Item.task_id;
      expect(call1).not.toBe(call2);
    });

    it('should persist before returning success', async () => {
      let putCalled = false;
      mockDynamoDBDocumentClient.send.mockImplementation(async (command: any) => {
        if (command instanceof PutCommand) {
          putCalled = true;
        }
        return {};
      });

      const invocation = mcpInvocationCreateTask as MCPToolInvocation;
      const response = await adapter.execute(invocation);

      expect(putCalled).toBe(true);
      expect(response.result).toBeDefined();
    });

    it('should return MCPResponse with external_object_refs array', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({});

      const invocation = mcpInvocationCreateTask as MCPToolInvocation;
      const response = await adapter.execute(invocation);

      const resultText = response.result!.content[0].text;
      const resultData = JSON.parse(resultText);
      expect(resultData.success).toBe(true);
      expect(resultData.external_object_refs[0]).toMatchObject({
        system: 'INTERNAL',
        object_type: 'Task',
        object_id: expect.any(String),
      });
    });

    it('should throw ValidationError if title missing', async () => {
      const invocation = {
        ...mcpInvocationCreateTask,
        params: {
          ...mcpInvocationCreateTask.params,
          arguments: {
            description: 'Test description',
            tenant_id: 'tenant_test_1',
            account_id: 'account_test_1',
          },
        },
      } as MCPToolInvocation;

      await expect(adapter.execute(invocation)).rejects.toThrow(ValidationError);
      await expect(adapter.execute(invocation)).rejects.toThrow('Missing required field: title');
    });
  });

  describe('execute - Unknown Tool', () => {
    it('should throw ValidationError for unknown tool name', async () => {
      const invocation = {
        ...mcpInvocationCreateNote,
        params: {
          name: 'internal.unknown_tool',
          arguments: mcpInvocationCreateNote.params.arguments,
        },
      } as MCPToolInvocation;

      await expect(adapter.execute(invocation)).rejects.toThrow(ValidationError);
      await expect(adapter.execute(invocation)).rejects.toThrow('Unknown tool');
    });
  });

  describe('validate', () => {
    it('should return valid=true for correct parameters', async () => {
      const result = await adapter.validate({
        content: 'Test content',
        tenant_id: 'tenant_test_1',
        account_id: 'account_test_1',
      });

      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should return valid=false with error if tenant_id missing', async () => {
      const result = await adapter.validate({
        content: 'Test content',
        account_id: 'account_test_1',
      });

      expect(result.valid).toBe(false);
      expect(result.error).toContain('tenant_id and account_id are required');
    });

    it('should return valid=false with error if account_id missing', async () => {
      const result = await adapter.validate({
        content: 'Test content',
        tenant_id: 'tenant_test_1',
      });

      expect(result.valid).toBe(false);
      expect(result.error).toContain('tenant_id and account_id are required');
    });
  });
});
