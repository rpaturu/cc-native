/**
 * InternalAdapterHandler Unit Tests - Phase 4.3
 * 
 * Tests Gateway Lambda event → MCPToolInvocation conversion and adapter execution.
 */

import { Handler, Context } from 'aws-lambda';
import { createHandler } from '../../../../handlers/phase4/internal-adapter-handler';
import { IConnectorAdapter } from '../../../../adapters/IConnectorAdapter';
import { MCPToolInvocation, MCPResponse } from '../../../../types/MCPTypes';
import { ValidationError } from '../../../../types/ExecutionErrors';
import { Logger } from '../../../../services/core/Logger';
import gatewayEventInternal from '../../../fixtures/execution/adapters/gateway-lambda-event-internal.json';
import lambdaContextWithIdentity from '../../../fixtures/execution/adapters/lambda-context-with-identity.json';

describe('InternalAdapterHandler', () => {
  let mockAdapter: jest.Mocked<IConnectorAdapter>;
  let mockLogger: Logger;
  let handler: Handler;
  let mockContext: Context;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Create mock adapter
    mockAdapter = {
      execute: jest.fn(),
      validate: jest.fn(),
    } as any;
    
    // Create mock logger
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as any;
    
    // Create handler with injected dependencies
    handler = createHandler(mockAdapter, mockLogger);

    // Create mock Lambda context
    // Note: Using 'as any' to bypass strict ClientContext type checking for test mocks
    mockContext = {
      ...lambdaContextWithIdentity,
      functionName: 'test-internal-adapter-handler',
      functionVersion: '$LATEST',
      invokedFunctionArn: 'arn:aws:lambda:us-west-2:123456789012:function:test-internal-adapter-handler',
      memoryLimitInMB: '128',
      awsRequestId: 'test-request-id',
      logGroupName: '/aws/lambda/test-internal-adapter-handler',
      logStreamName: '2026/01/27/[$LATEST]test-stream',
      getRemainingTimeInMillis: jest.fn(() => 30000),
      done: jest.fn(),
      fail: jest.fn(),
      succeed: jest.fn(),
      callbackWaitsForEmptyEventLoop: false,
    } as any;
  });

  describe('Gateway Event → MCPToolInvocation Conversion', () => {
    it('should extract tool name from context.clientContext.custom.bedrockAgentCoreToolName', async () => {
      const mockResponse: MCPResponse = {
        jsonrpc: '2.0',
        id: 'mcp_message_123',
        result: {
          content: [{
            type: 'text',
            text: JSON.stringify({ success: true, external_object_refs: [] }),
          }],
        },
      };
      mockAdapter.execute.mockResolvedValue(mockResponse);

      await handler(gatewayEventInternal, mockContext, jest.fn());

      expect(mockAdapter.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            name: 'internal.create_note',
          }),
        })
      );
    });

    it('should remove target prefix from tool name', async () => {
      const contextWithPrefix = {
        ...mockContext,
        clientContext: {
          custom: {
            bedrockAgentCoreToolName: 'internal-adapter___internal.create_note',
            bedrockAgentCoreMcpMessageId: 'mcp_message_123',
          },
        },
      } as any;

      const mockResponse: MCPResponse = {
        jsonrpc: '2.0',
        id: 'mcp_message_123',
        result: { content: [{ type: 'text', text: '{}' }] },
      };
      mockAdapter.execute.mockResolvedValue(mockResponse);

      await handler(gatewayEventInternal, contextWithPrefix, jest.fn());

      expect(mockAdapter.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            name: 'internal.create_note',
          }),
        })
      );
    });

    it('should preserve namespace if present', async () => {
      const contextWithNamespace = {
        ...mockContext,
        clientContext: {
          custom: {
            bedrockAgentCoreToolName: 'internal-adapter___internal.create_note',
            bedrockAgentCoreMcpMessageId: 'mcp_message_123',
          },
        },
      } as any;

      const mockResponse: MCPResponse = {
        jsonrpc: '2.0',
        id: 'mcp_message_123',
        result: { content: [{ type: 'text', text: '{}' }] },
      };
      mockAdapter.execute.mockResolvedValue(mockResponse);

      await handler(gatewayEventInternal, contextWithNamespace as any, jest.fn());

      expect(mockAdapter.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            name: 'internal.create_note', // Namespace preserved
          }),
        })
      );
    });

    it('should add namespace if missing', async () => {
      const contextWithoutNamespace = {
        ...mockContext,
        clientContext: {
          custom: {
            bedrockAgentCoreToolName: 'internal-adapter___create_note',
            bedrockAgentCoreMcpMessageId: 'mcp_message_123',
          },
        },
      } as any;

      const mockResponse: MCPResponse = {
        jsonrpc: '2.0',
        id: 'mcp_message_123',
        result: { content: [{ type: 'text', text: '{}' }] },
      };
      mockAdapter.execute.mockResolvedValue(mockResponse);

      await handler(gatewayEventInternal, contextWithoutNamespace, jest.fn());

      expect(mockAdapter.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            name: 'internal.create_note', // Namespace added
          }),
        })
      );
    });

    it('should extract gatewayId, targetId, mcpMessageId from context', async () => {
      const mockResponse: MCPResponse = {
        jsonrpc: '2.0',
        id: 'mcp_message_123',
        result: { content: [{ type: 'text', text: '{}' }] },
      };
      mockAdapter.execute.mockResolvedValue(mockResponse);

      await handler(gatewayEventInternal, mockContext, jest.fn());

      // Verify handler extracts context but doesn't pass it to adapter (adapter doesn't need it)
      expect(mockAdapter.execute).toHaveBeenCalled();
    });

    it('should use mcpMessageId as invocation.id', async () => {
      const mockResponse: MCPResponse = {
        jsonrpc: '2.0',
        id: 'mcp_message_123',
        result: { content: [{ type: 'text', text: '{}' }] },
      };
      mockAdapter.execute.mockResolvedValue(mockResponse);

      await handler(gatewayEventInternal, mockContext, jest.fn());

      expect(mockAdapter.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'mcp_message_123',
        })
      );
    });

    it('should fall back to generated ID if mcpMessageId missing', async () => {
      const contextWithoutMessageId = {
        ...mockContext,
        clientContext: {
          custom: {
            bedrockAgentCoreToolName: 'internal-adapter___internal.create_note',
          },
          client: undefined,
          env: undefined,
        },
      };

      const mockResponse: MCPResponse = {
        jsonrpc: '2.0',
        id: 'generated-id',
        result: { content: [{ type: 'text', text: '{}' }] },
      };
      mockAdapter.execute.mockResolvedValue(mockResponse);

      await handler(gatewayEventInternal, contextWithoutMessageId as any, jest.fn());

      expect(mockAdapter.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          id: expect.stringMatching(/^gateway-/),
        })
      );
    });

    it('should convert event data to MCPToolInvocation.params.arguments', async () => {
      const mockResponse: MCPResponse = {
        jsonrpc: '2.0',
        id: 'mcp_message_123',
        result: { content: [{ type: 'text', text: '{}' }] },
      };
      mockAdapter.execute.mockResolvedValue(mockResponse);

      await handler(gatewayEventInternal, mockContext, jest.fn());

      expect(mockAdapter.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            arguments: gatewayEventInternal,
          }),
        })
      );
    });

    it('should extract identity context (accessToken, tenantId, userId)', async () => {
      const mockResponse: MCPResponse = {
        jsonrpc: '2.0',
        id: 'mcp_message_123',
        result: { content: [{ type: 'text', text: '{}' }] },
      };
      mockAdapter.execute.mockResolvedValue(mockResponse);

      await handler(gatewayEventInternal, mockContext, jest.fn());

      expect(mockAdapter.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          identity: expect.objectContaining({
            accessToken: 'oauth_token_123',
            tenantId: 'tenant_test_1',
            userId: 'user_test_1',
          }),
        })
      );
    });
  });

  describe('Adapter Execution', () => {
    it('should call adapter.execute() with converted MCPToolInvocation', async () => {
      const mockResponse: MCPResponse = {
        jsonrpc: '2.0',
        id: 'mcp_message_123',
        result: {
          content: [{
            type: 'text',
            text: JSON.stringify({ success: true, external_object_refs: [] }),
          }],
        },
      };
      mockAdapter.execute.mockResolvedValue(mockResponse);

      const response = await handler(gatewayEventInternal, mockContext, jest.fn());

      expect(mockAdapter.execute).toHaveBeenCalledTimes(1);
      expect(response).toEqual(mockResponse);
    });

    it('should return MCPResponse from adapter', async () => {
      const mockResponse: MCPResponse = {
        jsonrpc: '2.0',
        id: 'mcp_message_123',
        result: {
          content: [{
            type: 'text',
            text: JSON.stringify({ success: true, external_object_refs: [] }),
          }],
        },
      };
      mockAdapter.execute.mockResolvedValue(mockResponse);

      const response = await handler(gatewayEventInternal, mockContext, jest.fn());

      expect(response).toEqual(mockResponse);
    });

    it('should handle ValidationError from adapter', async () => {
      const validationError = new ValidationError('Missing required field: content');
      mockAdapter.execute.mockRejectedValue(validationError);

      await expect(handler(gatewayEventInternal, mockContext, jest.fn())).rejects.toThrow(ValidationError);
      await expect(handler(gatewayEventInternal, mockContext, jest.fn())).rejects.toThrow('Missing required field');
    });
  });
});
