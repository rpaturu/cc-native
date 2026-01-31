/**
 * Unit tests for AutoExecuteAllowListService - Phase 5.4
 */

import { AutoExecuteAllowListService } from '../../../services/autonomy/AutoExecuteAllowListService';
import { Logger } from '../../../services/core/Logger';
import { mockDynamoDBDocumentClient, resetAllMocks } from '../../__mocks__/aws-sdk-clients';

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn(() => mockDynamoDBDocumentClient) },
  GetCommand: jest.fn(),
  PutCommand: jest.fn(),
}));

describe('AutoExecuteAllowListService', () => {
  const tableName = 'test-autonomy-config';
  const service = new AutoExecuteAllowListService(
    mockDynamoDBDocumentClient as any,
    tableName,
    new Logger('AutoExecuteAllowListService.test')
  );

  beforeEach(() => {
    resetAllMocks();
    jest.clearAllMocks();
  });

  it('getAllowlist returns account-level list when present', async () => {
    mockDynamoDBDocumentClient.send.mockResolvedValueOnce({
      Item: {
        pk: 'TENANT#t1#ACCOUNT#a1',
        sk: 'ALLOWLIST#AUTO_EXEC',
        tenant_id: 't1',
        account_id: 'a1',
        action_types: ['CREATE_INTERNAL_NOTE', 'CREATE_INTERNAL_TASK'],
        updated_at: '2026-01-28T00:00:00Z',
      },
    });
    const list = await service.getAllowlist('t1', 'a1');
    expect(list).toEqual(['CREATE_INTERNAL_NOTE', 'CREATE_INTERNAL_TASK']);
  });

  it('getAllowlist falls back to tenant-level when account has no list', async () => {
    mockDynamoDBDocumentClient.send
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        Item: {
          pk: 'TENANT#t1',
          sk: 'ALLOWLIST#AUTO_EXEC',
          tenant_id: 't1',
          action_types: ['CREATE_INTERNAL_NOTE'],
          updated_at: '2026-01-28T00:00:00Z',
        },
      });
    const list = await service.getAllowlist('t1', 'a1');
    expect(list).toEqual(['CREATE_INTERNAL_NOTE']);
  });

  it('getAllowlist returns empty array when no config', async () => {
    mockDynamoDBDocumentClient.send.mockResolvedValue({});
    const list = await service.getAllowlist('t1');
    expect(list).toEqual([]);
  });

  it('isAllowlisted returns true when action_type is in list', async () => {
    mockDynamoDBDocumentClient.send.mockResolvedValue({
      Item: {
        pk: 'TENANT#t1',
        sk: 'ALLOWLIST#AUTO_EXEC',
        tenant_id: 't1',
        action_types: ['CREATE_INTERNAL_NOTE', 'CREATE_INTERNAL_TASK'],
        updated_at: '2026-01-28T00:00:00Z',
      },
    });
    const ok = await service.isAllowlisted('t1', 'CREATE_INTERNAL_NOTE');
    expect(ok).toBe(true);
  });

  it('isAllowlisted returns false when action_type is not in list', async () => {
    mockDynamoDBDocumentClient.send.mockResolvedValue({
      Item: {
        pk: 'TENANT#t1',
        sk: 'ALLOWLIST#AUTO_EXEC',
        tenant_id: 't1',
        action_types: ['CREATE_INTERNAL_NOTE'],
        updated_at: '2026-01-28T00:00:00Z',
      },
    });
    const ok = await service.isAllowlisted('t1', 'REQUEST_RENEWAL_MEETING');
    expect(ok).toBe(false);
  });

  it('putAllowlist writes tenant-level allowlist', async () => {
    mockDynamoDBDocumentClient.send.mockResolvedValue({});
    const { PutCommand } = require('@aws-sdk/lib-dynamodb');
    await service.putAllowlist({
      tenant_id: 't1',
      action_types: ['CREATE_INTERNAL_NOTE', 'CREATE_INTERNAL_TASK'],
    });
    expect(PutCommand).toHaveBeenCalled();
    const putCall = (PutCommand as jest.Mock).mock.calls[0][0];
    expect(putCall.Item?.pk).toBe('TENANT#t1');
    expect(putCall.Item?.sk).toBe('ALLOWLIST#AUTO_EXEC');
    expect(putCall.Item?.action_types).toEqual(['CREATE_INTERNAL_NOTE', 'CREATE_INTERNAL_TASK']);
  });
});
