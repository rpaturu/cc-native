/**
 * AutonomyBudgetService Unit Tests - Phase 5.1
 */

import { AutonomyBudgetService } from '../../../services/autonomy/AutonomyBudgetService';
import { Logger } from '../../../services/core/Logger';
import {
  GetCommand,
  PutCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { mockDynamoDBDocumentClient, resetAllMocks } from '../../__mocks__/aws-sdk-clients';
import type { AutonomyBudgetV1 } from '../../../types/autonomy/AutonomyTypes';

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn(() => mockDynamoDBDocumentClient) },
  GetCommand: jest.fn(),
  PutCommand: jest.fn(),
  UpdateCommand: jest.fn(),
}));

describe('AutonomyBudgetService', () => {
  let service: AutonomyBudgetService;
  const tableName = 'test-autonomy-budget-state';

  beforeEach(() => {
    resetAllMocks();
    jest.clearAllMocks();
    service = new AutonomyBudgetService(
      mockDynamoDBDocumentClient as any,
      tableName,
      new Logger('AutonomyBudgetServiceTest')
    );
  });

  describe('getConfig', () => {
    it('returns config when present', async () => {
      const config: AutonomyBudgetV1 = {
        pk: 'TENANT#t1#ACCOUNT#a1',
        sk: 'BUDGET#CONFIG',
        tenant_id: 't1',
        account_id: 'a1',
        max_autonomous_per_day: 5,
        updated_at: '2026-01-28T00:00:00Z',
      };
      mockDynamoDBDocumentClient.send.mockResolvedValue({ Item: config });

      const result = await service.getConfig('t1', 'a1');

      expect(result).toEqual(config);
      expect(GetCommand).toHaveBeenCalledWith({
        TableName: tableName,
        Key: { pk: 'TENANT#t1#ACCOUNT#a1', sk: 'BUDGET#CONFIG' },
      });
    });

    it('returns null when absent', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({ Item: undefined });

      const result = await service.getConfig('t1', 'a1');

      expect(result).toBeNull();
    });
  });

  describe('putConfig', () => {
    it('writes item with pk/sk and updated_at', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({});

      const config: AutonomyBudgetV1 = {
        pk: 'TENANT#t1#ACCOUNT#a1',
        sk: 'BUDGET#CONFIG',
        tenant_id: 't1',
        account_id: 'a1',
        max_autonomous_per_day: 10,
        max_per_action_type: { CREATE_INTERNAL_NOTE: 3 },
        updated_at: '2026-01-28T12:00:00Z',
      };
      await service.putConfig(config);

      expect(PutCommand).toHaveBeenCalled();
      const putCall = (PutCommand as unknown as jest.Mock).mock.calls[0][0];
      expect(putCall.TableName).toBe(tableName);
      expect(putCall.Item.pk).toBe('TENANT#t1#ACCOUNT#a1');
      expect(putCall.Item.sk).toBe('BUDGET#CONFIG');
      expect(putCall.Item.max_autonomous_per_day).toBe(10);
      expect(putCall.Item.updated_at).toBeDefined();
    });

    it('derives pk/sk when omitted', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({});

      await service.putConfig({
        tenant_id: 't1',
        account_id: 'a1',
        max_autonomous_per_day: 2,
        updated_at: '2026-01-28T00:00:00Z',
      } as AutonomyBudgetV1);

      const putCall = (PutCommand as unknown as jest.Mock).mock.calls[0][0];
      expect(putCall.Item.pk).toBe('TENANT#t1#ACCOUNT#a1');
      expect(putCall.Item.sk).toBe('BUDGET#CONFIG');
    });
  });

  describe('checkAndConsume', () => {
    it('returns false when no config', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({ Item: undefined });

      const result = await service.checkAndConsume('t1', 'a1', 'CREATE_INTERNAL_NOTE');

      expect(result).toBe(false);
      expect(GetCommand).toHaveBeenCalled();
      expect(UpdateCommand).not.toHaveBeenCalled();
    });

    it('returns false when max_autonomous_per_day is 0', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({
        Item: {
          pk: 'TENANT#t1#ACCOUNT#a1',
          sk: 'BUDGET#CONFIG',
          tenant_id: 't1',
          account_id: 'a1',
          max_autonomous_per_day: 0,
          updated_at: '2026-01-28T00:00:00Z',
        },
      });

      const result = await service.checkAndConsume('t1', 'a1', 'CREATE_INTERNAL_NOTE');

      expect(result).toBe(false);
      expect(UpdateCommand).not.toHaveBeenCalled();
    });

    it('returns true and calls UpdateCommand when under limit', async () => {
      mockDynamoDBDocumentClient.send
        .mockResolvedValueOnce({
          Item: {
            pk: 'TENANT#t1#ACCOUNT#a1',
            sk: 'BUDGET#CONFIG',
            tenant_id: 't1',
            account_id: 'a1',
            max_autonomous_per_day: 5,
            updated_at: '2026-01-28T00:00:00Z',
          },
        })
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({});

      const result = await service.checkAndConsume('t1', 'a1', 'CREATE_INTERNAL_NOTE');

      expect(result).toBe(true);
      expect(UpdateCommand).toHaveBeenCalledTimes(2);
      const firstUpdate = (UpdateCommand as unknown as jest.Mock).mock.calls[0][0];
      const secondUpdate = (UpdateCommand as unknown as jest.Mock).mock.calls[1][0];
      expect(firstUpdate.TableName).toBe(tableName);
      expect(firstUpdate.Key.pk).toBe('TENANT#t1#ACCOUNT#a1');
      expect(firstUpdate.ConditionExpression).toContain('maxDaily');
      expect(secondUpdate.ConditionExpression).toContain('maxPerType');
    });

    it('returns false when ConditionalCheckFailedException (over limit)', async () => {
      mockDynamoDBDocumentClient.send
        .mockResolvedValueOnce({
          Item: {
            pk: 'TENANT#t1#ACCOUNT#a1',
            sk: 'BUDGET#CONFIG',
            tenant_id: 't1',
            account_id: 'a1',
            max_autonomous_per_day: 2,
            updated_at: '2026-01-28T00:00:00Z',
          },
        })
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce({ name: 'ConditionalCheckFailedException' })
        .mockResolvedValueOnce({});

      const result = await service.checkAndConsume('t1', 'a1', 'CREATE_INTERNAL_NOTE');

      expect(result).toBe(false);
    });

    it('rethrows non-ConditionalCheckFailedException errors', async () => {
      mockDynamoDBDocumentClient.send
        .mockResolvedValueOnce({
          Item: {
            pk: 'TENANT#t1#ACCOUNT#a1',
            sk: 'BUDGET#CONFIG',
            tenant_id: 't1',
            account_id: 'a1',
            max_autonomous_per_day: 5,
            updated_at: '2026-01-28T00:00:00Z',
          },
        })
        .mockRejectedValueOnce(new Error('DynamoDB throttled'));

      await expect(
        service.checkAndConsume('t1', 'a1', 'CREATE_INTERNAL_NOTE')
      ).rejects.toThrow('DynamoDB throttled');
    });
  });

  describe('getStateForDate', () => {
    it('returns state item when present', async () => {
      const state = {
        pk: 'TENANT#t1#ACCOUNT#a1',
        sk: 'BUDGET_STATE#2026-01-28',
        tenant_id: 't1',
        account_id: 'a1',
        date_key: '2026-01-28',
        total: 2,
        counts: { CREATE_INTERNAL_NOTE: 2 },
        updated_at: '2026-01-28T12:00:00Z',
      };
      mockDynamoDBDocumentClient.send.mockResolvedValue({ Item: state });

      const result = await service.getStateForDate('t1', 'a1', '2026-01-28');

      expect(result).toEqual(state);
      expect(GetCommand).toHaveBeenCalledWith({
        TableName: tableName,
        Key: { pk: 'TENANT#t1#ACCOUNT#a1', sk: 'BUDGET_STATE#2026-01-28' },
      });
    });

    it('returns null when absent', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({ Item: undefined });

      const result = await service.getStateForDate('t1', 'a1', '2026-01-28');

      expect(result).toBeNull();
    });
  });
});
