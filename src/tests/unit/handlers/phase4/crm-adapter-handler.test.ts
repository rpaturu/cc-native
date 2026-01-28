/**
 * CrmAdapterHandler Unit Tests - Phase 4.3
 * 
 * Tests Gateway Lambda event → MCPToolInvocation conversion and adapter execution.
 */

import { Handler, Context } from 'aws-lambda';
import { createHandler } from '../../../../handlers/phase4/crm-adapter-handler';
import { IConnectorAdapter } from '../../../../adapters/IConnectorAdapter';
import { MCPToolInvocation, MCPResponse } from '../../../../types/MCPTypes';
import { ValidationError, ConfigurationError } from '../../../../types/ExecutionErrors';
import { Logger } from '../../../../services/core/Logger';
import gatewayEventCrm from '../../../fixtures/execution/adapters/gateway-lambda-event-crm.json';
import lambdaContextWithIdentity from '../../../fixtures/execution/adapters/lambda-context-with-identity.json';

describe('CrmAdapterHandler', () => {
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

    // Create mock Lambda context with CRM tool name
    const contextWithCrmTool = {
      ...lambdaContextWithIdentity,
      clientContext: {
        custom: {
          ...lambdaContextWithIdentity.clientContext.custom,
          bedrockAgentCoreToolName: 'crm-adapter___crm.create_task',
        },
        client: {},
        env: {},
      },
    };

    mockContext = {
      ...contextWithCrmTool,
      functionName: 'test-crm-adapter-handler',
      functionVersion: '$LATEST',
      invokedFunctionArn: 'arn:aws:lambda:us-west-2:123456789012:function:test-crm-adapter-handler',
      memoryLimitInMB: '128',
      awsRequestId: 'test-request-id',
      logGroupName: '/aws/lambda/test-crm-adapter-handler',
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

      await handler(gatewayEventCrm, mockContext, jest.fn());

      expect(mockAdapter.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            name: 'crm.create_task',
          }),
        })
      );
    });

    it('should remove target prefix from tool name', async () => {
      const contextWithPrefix = {
        ...mockContext,
        clientContext: {
          custom: {
            bedrockAgentCoreToolName: 'crm-adapter___crm.create_task',
            bedrockAgentCoreMcpMessageId: 'mcp_message_123',
            bedrockAgentCoreIdentity: {
              accessToken: 'oauth_token_123',
              tenantId: 'tenant_test_1',
              userId: 'user_test_1',
            },
          },
        },
      } as any;

      const mockResponse: MCPResponse = {
        jsonrpc: '2.0',
        id: 'mcp_message_123',
        result: { content: [{ type: 'text', text: '{}' }] },
      };
      mockAdapter.execute.mockResolvedValue(mockResponse);

      await handler(gatewayEventCrm, contextWithPrefix, jest.fn());

      expect(mockAdapter.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            name: 'crm.create_task',
          }),
        })
      );
    });

    it('should preserve namespace if present', async () => {
      const contextWithNamespace = {
        ...mockContext,
        clientContext: {
          custom: {
            bedrockAgentCoreToolName: 'crm-adapter___crm.create_task',
            bedrockAgentCoreMcpMessageId: 'mcp_message_123',
            bedrockAgentCoreIdentity: {
              accessToken: 'oauth_token_123',
              tenantId: 'tenant_test_1',
              userId: 'user_test_1',
            },
          },
        },
      } as any;

      const mockResponse: MCPResponse = {
        jsonrpc: '2.0',
        id: 'mcp_message_123',
        result: { content: [{ type: 'text', text: '{}' }] },
      };
      mockAdapter.execute.mockResolvedValue(mockResponse);

      await handler(gatewayEventCrm, contextWithNamespace as any, jest.fn());

      expect(mockAdapter.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            name: 'crm.create_task', // Namespace preserved
          }),
        })
      );
    });

    it('should add namespace if missing', async () => {
      const contextWithoutNamespace = {
        ...mockContext,
        clientContext: {
          custom: {
            bedrockAgentCoreToolName: 'crm-adapter___create_task',
            bedrockAgentCoreMcpMessageId: 'mcp_message_123',
            bedrockAgentCoreIdentity: {
              accessToken: 'oauth_token_123',
              tenantId: 'tenant_test_1',
              userId: 'user_test_1',
            },
          },
        },
      } as any;

      const mockResponse: MCPResponse = {
        jsonrpc: '2.0',
        id: 'mcp_message_123',
        result: { content: [{ type: 'text', text: '{}' }] },
      };
      mockAdapter.execute.mockResolvedValue(mockResponse);

      await handler(gatewayEventCrm, contextWithoutNamespace, jest.fn());

      expect(mockAdapter.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            name: 'crm.create_task', // Namespace added
          }),
        })
      );
    });

    it('should extract identity context (OAuth token for outbound calls)', async () => {
      const mockResponse: MCPResponse = {
        jsonrpc: '2.0',
        id: 'mcp_message_123',
        result: { content: [{ type: 'text', text: '{}' }] },
      };
      mockAdapter.execute.mockResolvedValue(mockResponse);

      await handler(gatewayEventCrm, mockContext, jest.fn());

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

    it('should convert event data to MCPToolInvocation.params.arguments', async () => {
      const mockResponse: MCPResponse = {
        jsonrpc: '2.0',
        id: 'mcp_message_123',
        result: { content: [{ type: 'text', text: '{}' }] },
      };
      mockAdapter.execute.mockResolvedValue(mockResponse);

      await handler(gatewayEventCrm, mockContext, jest.fn());

      expect(mockAdapter.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            arguments: gatewayEventCrm,
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

      const response = await handler(gatewayEventCrm, mockContext, jest.fn());

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

      const response = await handler(gatewayEventCrm, mockContext, jest.fn());

      expect(response).toEqual(mockResponse);
    });

    it('should handle ValidationError from adapter', async () => {
      const validationError = new ValidationError('Missing required parameter: idempotency_key');
      mockAdapter.execute.mockRejectedValue(validationError);

      await expect(handler(gatewayEventCrm, mockContext, jest.fn())).rejects.toThrow(ValidationError);
      await expect(handler(gatewayEventCrm, mockContext, jest.fn())).rejects.toThrow('idempotency_key');
    });

    it('should handle ConfigurationError from adapter', async () => {
      const configError = new ConfigurationError('Salesforce instance URL not found');
      mockAdapter.execute.mockRejectedValue(configError);

      await expect(handler(gatewayEventCrm, mockContext, jest.fn())).rejects.toThrow(ConfigurationError);
      await expect(handler(gatewayEventCrm, mockContext, jest.fn())).rejects.toThrow('Salesforce instance URL');
    });
  });
});
