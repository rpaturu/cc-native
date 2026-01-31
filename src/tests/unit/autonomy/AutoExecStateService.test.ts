/**
 * Unit tests for AutoExecStateService - Phase 5.4
 */

import { AutoExecStateService } from '../../../services/autonomy/AutoExecStateService';
import { Logger } from '../../../services/core/Logger';
import { mockDynamoDBDocumentClient, resetAllMocks } from '../../__mocks__/aws-sdk-clients';

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn(() => mockDynamoDBDocumentClient) },
  GetCommand: jest.fn(),
  PutCommand: jest.fn(),
}));

describe('AutoExecStateService', () => {
  const tableName = 'test-autonomy-config';
  const service = new AutoExecStateService(
    mockDynamoDBDocumentClient as any,
    tableName,
    new Logger('AutoExecStateService.test')
  );

  beforeEach(() => {
    resetAllMocks();
    jest.clearAllMocks();
  });

  it('getState returns null when no state', async () => {
    mockDynamoDBDocumentClient.send.mockResolvedValue({});
    const state = await service.getState('ai_123');
    expect(state).toBeNull();
  });

  it('getState returns state when present', async () => {
    mockDynamoDBDocumentClient.send.mockResolvedValue({
      Item: {
        pk: 'AUTO_EXEC_STATE',
        sk: 'ai_123',
        action_intent_id: 'ai_123',
        status: 'PUBLISHED',
        updated_at: '2026-01-28T00:00:00Z',
        ttl: 1234567890,
      },
    });
    const state = await service.getState('ai_123');
    expect(state?.status).toBe('PUBLISHED');
    expect(state?.action_intent_id).toBe('ai_123');
  });

  it('setReserved writes RESERVED with condition', async () => {
    mockDynamoDBDocumentClient.send.mockResolvedValue({});
    const { PutCommand } = require('@aws-sdk/lib-dynamodb');
    await service.setReserved('ai_123');
    expect(mockDynamoDBDocumentClient.send).toHaveBeenCalled();
    const putCall = (PutCommand as jest.Mock).mock.calls[0][0];
    expect(putCall.Item?.pk).toBe('AUTO_EXEC_STATE');
    expect(putCall.Item?.sk).toBe('ai_123');
    expect(putCall.Item?.status).toBe('RESERVED');
    expect(putCall.ConditionExpression).toContain('attribute_not_exists');
  });

  it('setPublished writes PUBLISHED', async () => {
    mockDynamoDBDocumentClient.send.mockResolvedValue({});
    const { PutCommand } = require('@aws-sdk/lib-dynamodb');
    await service.setPublished('ai_123');
    const putCall = (PutCommand as jest.Mock).mock.calls[0][0];
    expect(putCall.Item?.status).toBe('PUBLISHED');
  });
});
