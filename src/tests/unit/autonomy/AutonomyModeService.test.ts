/**
 * AutonomyModeService Unit Tests - Phase 5.1
 */

import { AutonomyModeService } from '../../../services/autonomy/AutonomyModeService';
import { Logger } from '../../../services/core/Logger';
import { GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { mockDynamoDBDocumentClient, resetAllMocks } from '../../__mocks__/aws-sdk-clients';
import type { AutonomyModeConfigV1 } from '../../../types/autonomy/AutonomyTypes';

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn(() => mockDynamoDBDocumentClient) },
  GetCommand: jest.fn(),
  PutCommand: jest.fn(),
  QueryCommand: jest.fn(),
}));

describe('AutonomyModeService', () => {
  let service: AutonomyModeService;
  const tableName = 'test-autonomy-config';

  beforeEach(() => {
    resetAllMocks();
    jest.clearAllMocks();
    service = new AutonomyModeService(
      mockDynamoDBDocumentClient as any,
      tableName,
      new Logger('AutonomyModeServiceTest')
    );
  });

  describe('getMode', () => {
    it('returns mode from account+action_type when present', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValueOnce({
        Item: { pk: 'TENANT#t1#ACCOUNT#a1', sk: 'AUTONOMY#CREATE_INTERNAL_NOTE', mode: 'AUTO_EXECUTE' },
      });

      const mode = await service.getMode('t1', 'a1', 'CREATE_INTERNAL_NOTE');

      expect(mode).toBe('AUTO_EXECUTE');
      expect(mockDynamoDBDocumentClient.send).toHaveBeenCalledTimes(1);
    });

    it('falls back to tenant+action_type when account+action_type missing', async () => {
      mockDynamoDBDocumentClient.send
        .mockResolvedValueOnce({ Item: undefined })
        .mockResolvedValueOnce({
          Item: { pk: 'TENANT#t1', sk: 'AUTONOMY#CREATE_INTERNAL_NOTE', mode: 'APPROVAL_REQUIRED' },
        });

      const mode = await service.getMode('t1', 'a1', 'CREATE_INTERNAL_NOTE');

      expect(mode).toBe('APPROVAL_REQUIRED');
      expect(mockDynamoDBDocumentClient.send).toHaveBeenCalledTimes(2);
    });

    it('falls back to account+DEFAULT when account+action_type and tenant+action_type missing', async () => {
      mockDynamoDBDocumentClient.send
        .mockResolvedValueOnce({ Item: undefined })
        .mockResolvedValueOnce({ Item: undefined })
        .mockResolvedValueOnce({
          Item: { pk: 'TENANT#t1#ACCOUNT#a1', sk: 'AUTONOMY#DEFAULT', mode: 'PROPOSE_ONLY' },
        });

      const mode = await service.getMode('t1', 'a1', 'CREATE_INTERNAL_NOTE');

      expect(mode).toBe('PROPOSE_ONLY');
      expect(mockDynamoDBDocumentClient.send).toHaveBeenCalledTimes(3);
    });

    it('falls back to tenant+DEFAULT when only that exists', async () => {
      mockDynamoDBDocumentClient.send
        .mockResolvedValueOnce({ Item: undefined })
        .mockResolvedValueOnce({ Item: undefined })
        .mockResolvedValueOnce({ Item: undefined })
        .mockResolvedValueOnce({
          Item: { pk: 'TENANT#t1', sk: 'AUTONOMY#DEFAULT', mode: 'DISABLED' },
        });

      const mode = await service.getMode('t1', 'a1', 'CREATE_INTERNAL_NOTE');

      expect(mode).toBe('DISABLED');
      expect(mockDynamoDBDocumentClient.send).toHaveBeenCalledTimes(4);
    });

    it('returns APPROVAL_REQUIRED when no config at any level', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({ Item: undefined });

      const mode = await service.getMode('t1', 'a1', 'CREATE_INTERNAL_NOTE');

      expect(mode).toBe('APPROVAL_REQUIRED');
      expect(mockDynamoDBDocumentClient.send).toHaveBeenCalledTimes(4);
    });

    it('never returns AUTO_EXECUTE when no config (default is APPROVAL_REQUIRED)', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({ Item: undefined });

      const mode = await service.getMode('t1', 'a1', 'FLAG_FOR_REVIEW');

      expect(mode).toBe('APPROVAL_REQUIRED');
    });
  });

  describe('getConfigItem', () => {
    it('returns item when present', async () => {
      const item: AutonomyModeConfigV1 = {
        pk: 'TENANT#t1',
        sk: 'AUTONOMY#DEFAULT',
        tenant_id: 't1',
        mode: 'APPROVAL_REQUIRED',
        updated_at: '2026-01-28T00:00:00Z',
        policy_version: 'AutonomyModeConfigV1',
      };
      mockDynamoDBDocumentClient.send.mockResolvedValue({ Item: item });

      const result = await service.getConfigItem('TENANT#t1', 'AUTONOMY#DEFAULT');

      expect(result).toEqual(item);
      expect(GetCommand).toHaveBeenCalledWith({
        TableName: tableName,
        Key: { pk: 'TENANT#t1', sk: 'AUTONOMY#DEFAULT' },
      });
    });

    it('returns null when item absent', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({ Item: undefined });

      const result = await service.getConfigItem('TENANT#t1', 'AUTONOMY#MISSING');

      expect(result).toBeNull();
    });
  });

  describe('putConfig', () => {
    it('writes item with policy_version and updated_at', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({});

      const item: AutonomyModeConfigV1 = {
        pk: 'TENANT#t1#ACCOUNT#a1',
        sk: 'AUTONOMY#CREATE_INTERNAL_NOTE',
        tenant_id: 't1',
        account_id: 'a1',
        action_type: 'CREATE_INTERNAL_NOTE',
        mode: 'AUTO_EXECUTE',
        updated_at: '2026-01-28T12:00:00Z',
        policy_version: 'AutonomyModeConfigV1',
      };
      await service.putConfig(item);

      expect(PutCommand).toHaveBeenCalled();
      const putCall = (PutCommand as unknown as jest.Mock).mock.calls[0][0];
      expect(putCall.TableName).toBe(tableName);
      expect(putCall.Item.policy_version).toBe('AutonomyModeConfigV1');
      expect(putCall.Item.updated_at).toBeDefined();
      expect(putCall.Item.mode).toBe('AUTO_EXECUTE');
    });

    it('uses default policy_version and updated_at when omitted', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({});

      await service.putConfig({
        pk: 'TENANT#t1',
        sk: 'AUTONOMY#DEFAULT',
        tenant_id: 't1',
        mode: 'APPROVAL_REQUIRED',
        updated_at: '',
        policy_version: '',
      });

      const putCall = (PutCommand as unknown as jest.Mock).mock.calls[0][0];
      expect(putCall.Item.policy_version).toBe('AutonomyModeConfigV1');
      expect(putCall.Item.updated_at).toBeDefined();
    });
  });

  describe('listConfigs', () => {
    it('queries by tenant pk when accountId not provided', async () => {
      const items: AutonomyModeConfigV1[] = [
        {
          pk: 'TENANT#t1',
          sk: 'AUTONOMY#DEFAULT',
          tenant_id: 't1',
          mode: 'APPROVAL_REQUIRED',
          updated_at: '2026-01-28T00:00:00Z',
          policy_version: 'AutonomyModeConfigV1',
        },
      ];
      mockDynamoDBDocumentClient.send.mockResolvedValue({ Items: items });

      const configs = await service.listConfigs('t1');

      expect(QueryCommand).toHaveBeenCalledWith({
        TableName: tableName,
        KeyConditionExpression: 'pk = :pk',
        ExpressionAttributeValues: { ':pk': 'TENANT#t1' },
      });
      expect(configs).toEqual(items);
    });

    it('queries by tenant#account pk when accountId provided', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({ Items: [] });

      await service.listConfigs('t1', 'a1');

      expect(QueryCommand).toHaveBeenCalledWith({
        TableName: tableName,
        KeyConditionExpression: 'pk = :pk',
        ExpressionAttributeValues: { ':pk': 'TENANT#t1#ACCOUNT#a1' },
      });
    });

    it('returns empty array when no items', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({ Items: [] });

      const configs = await service.listConfigs('t1');

      expect(configs).toEqual([]);
    });
  });
});
