/**
 * Unit tests for PerceptionPullBudgetService - Phase 5.3
 */

import {
  GetCommand,
  PutCommand,
  UpdateCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { mockDynamoDBDocumentClient, resetAllMocks } from '../../__mocks__/aws-sdk-clients';
import { PerceptionPullBudgetService } from '../../../services/perception/PerceptionPullBudgetService';
import { Logger } from '../../../services/core/Logger';
import type { PerceptionPullBudgetV1 } from '../../../types/perception/PerceptionSchedulerTypes';

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn(() => mockDynamoDBDocumentClient) },
  GetCommand: jest.fn(),
  PutCommand: jest.fn(),
  UpdateCommand: jest.fn(),
  TransactWriteCommand: jest.fn(),
}));

describe('PerceptionPullBudgetService', () => {
  const tableName = 'test-perception-pull-budget';
  let service: PerceptionPullBudgetService;

  beforeEach(() => {
    resetAllMocks();
    jest.clearAllMocks();
    service = new PerceptionPullBudgetService(
      mockDynamoDBDocumentClient as any,
      tableName,
      new Logger('PerceptionPullBudgetServiceTest')
    );
  });

  describe('getConfig', () => {
    it('returns config when present', async () => {
      const config: PerceptionPullBudgetV1 = {
        pk: 'TENANT#t1',
        sk: 'BUDGET#PULL',
        tenant_id: 't1',
        max_pull_units_per_day: 100,
        max_per_connector_per_day: { crm: 30 },
        updated_at: '2026-01-28T00:00:00Z',
      };
      mockDynamoDBDocumentClient.send.mockResolvedValue({ Item: config });

      const result = await service.getConfig('t1');

      expect(result).toEqual(config);
    });

    it('returns null when absent', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({ Item: undefined });
      const result = await service.getConfig('t1');
      expect(result).toBeNull();
    });
  });

  describe('putConfig', () => {
    it('writes item with pk/sk and updated_at', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({});

      await service.putConfig({
        pk: 'TENANT#t1',
        sk: 'BUDGET#PULL',
        tenant_id: 't1',
        max_pull_units_per_day: 50,
        updated_at: '2026-01-28T12:00:00Z',
      });

      expect(PutCommand).toHaveBeenCalled();
      const putCall = (PutCommand as unknown as jest.Mock).mock.calls[0][0];
      expect(putCall.TableName).toBe(tableName);
      expect(putCall.Item.pk).toBe('TENANT#t1');
      expect(putCall.Item.sk).toBe('BUDGET#PULL');
    });
  });

  describe('checkAndConsumePullBudget', () => {
    it('returns allowed: false when no config', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({ Item: undefined });

      const result = await service.checkAndConsumePullBudget('t1', 'crm', 1);

      expect(result.allowed).toBe(false);
    });

    it('returns allowed: false when max_pull_units_per_day is 0', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({
        Item: {
          pk: 'TENANT#t1',
          sk: 'BUDGET#PULL',
          tenant_id: 't1',
          max_pull_units_per_day: 0,
          updated_at: '2026-01-28T00:00:00Z',
        },
      });

      const result = await service.checkAndConsumePullBudget('t1', 'crm', 1);

      expect(result.allowed).toBe(false);
    });

    it('returns allowed: true and consumes when only tenant cap (single Update)', async () => {
      mockDynamoDBDocumentClient.send
        .mockResolvedValueOnce({
          Item: {
            pk: 'TENANT#t1',
            sk: 'BUDGET#PULL',
            tenant_id: 't1',
            max_pull_units_per_day: 10,
            updated_at: '2026-01-28T00:00:00Z',
          },
        })
        .mockResolvedValueOnce({});

      const result = await service.checkAndConsumePullBudget('t1', 'crm', 1);

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(9);
      expect(UpdateCommand).toHaveBeenCalled();
      expect(TransactWriteCommand).not.toHaveBeenCalled();
    });

    it('returns allowed: false when ConditionalCheckFailedException (limit reached)', async () => {
      const err = new Error('Conditional check failed');
      (err as Error & { name: string }).name = 'ConditionalCheckFailedException';
      mockDynamoDBDocumentClient.send
        .mockResolvedValueOnce({
          Item: {
            pk: 'TENANT#t1',
            sk: 'BUDGET#PULL',
            tenant_id: 't1',
            max_pull_units_per_day: 5,
            updated_at: '2026-01-28T00:00:00Z',
          },
        })
        .mockRejectedValueOnce(err);

      const result = await service.checkAndConsumePullBudget('t1', 'crm', 1);

      expect(result.allowed).toBe(false);
    });

    it('uses TransactWrite when per-connector cap differs from tenant cap', async () => {
      mockDynamoDBDocumentClient.send
        .mockResolvedValueOnce({
          Item: {
            pk: 'TENANT#t1',
            sk: 'BUDGET#PULL',
            tenant_id: 't1',
            max_pull_units_per_day: 100,
            max_per_connector_per_day: { crm: 20 },
            updated_at: '2026-01-28T00:00:00Z',
          },
        })
        .mockResolvedValueOnce({});

      const result = await service.checkAndConsumePullBudget('t1', 'crm', 1);

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(99);
      expect(TransactWriteCommand).toHaveBeenCalled();
      expect(UpdateCommand).not.toHaveBeenCalled();
    });

    it('returns allowed: false when TransactionCanceledException (TransactWrite path)', async () => {
      const err = new Error('Transaction cancelled');
      (err as Error & { name: string }).name = 'TransactionCanceledException';
      mockDynamoDBDocumentClient.send
        .mockResolvedValueOnce({
          Item: {
            pk: 'TENANT#t1',
            sk: 'BUDGET#PULL',
            tenant_id: 't1',
            max_pull_units_per_day: 100,
            max_per_connector_per_day: { crm: 5 },
            updated_at: '2026-01-28T00:00:00Z',
          },
        })
        .mockRejectedValueOnce(err);

      const result = await service.checkAndConsumePullBudget('t1', 'crm', 1);

      expect(result.allowed).toBe(false);
    });
  });

  describe('getStateForDate', () => {
    it('returns state when present', async () => {
      const state = {
        pk: 'TENANT#t1',
        sk: 'BUDGET_STATE#2026-01-28',
        tenant_id: 't1',
        date_key: '2026-01-28',
        units_consumed: 10,
        pull_count: 5,
        updated_at: '2026-01-28T12:00:00Z',
      };
      mockDynamoDBDocumentClient.send.mockResolvedValue({ Item: state });

      const result = await service.getStateForDate('t1', '2026-01-28');

      expect(result).toEqual(state);
    });

    it('returns null when absent', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({ Item: undefined });

      const result = await service.getStateForDate('t1', '2026-01-28');

      expect(result).toBeNull();
    });
  });
});
