/**
 * PlanLedgerService — Phase 6.1 append (attribute_not_exists(sk)) and getByPlanId.
 */

import { PlanLedgerService } from '../../../services/plan/PlanLedgerService';
import { Logger } from '../../../services/core/Logger';
import { mockDynamoDBDocumentClient, resetAllMocks } from '../../__mocks__/aws-sdk-clients';

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn(() => mockDynamoDBDocumentClient) },
  PutCommand: jest.fn().mockImplementation((params: Record<string, unknown>) => ({ input: params })),
  QueryCommand: jest.fn().mockImplementation((params: Record<string, unknown>) => ({ input: params })),
}));

describe('PlanLedgerService', () => {
  let service: PlanLedgerService;
  let logger: Logger;

  beforeEach(() => {
    resetAllMocks();
    logger = new Logger('PlanLedgerTest');
    service = new PlanLedgerService(logger, { tableName: 'PlanLedger' });
  });

  describe('append', () => {
    it('generates entry_id and timestamp and uses attribute_not_exists(sk)', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({});
      const entry = await service.append({
        plan_id: 'plan-1',
        tenant_id: 't1',
        account_id: 'acc-1',
        event_type: 'PLAN_APPROVED',
        data: { plan_id: 'plan-1' },
      });
      expect(entry.entry_id).toBeDefined();
      expect(entry.timestamp).toBeDefined();
      expect(mockDynamoDBDocumentClient.send).toHaveBeenCalledTimes(1);
      const call = (mockDynamoDBDocumentClient.send as jest.Mock).mock.calls[0][0];
      expect(call.input?.ConditionExpression).toBe('attribute_not_exists(sk)');
      expect(call.input?.Item?.pk).toBe('PLAN#plan-1');
      expect(call.input?.Item?.sk).toMatch(/^EVENT#/);
    });

    it('returns PlanLedgerEntry with entry_id and timestamp set', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({});
      const entry = await service.append({
        plan_id: 'p1',
        tenant_id: 't1',
        account_id: 'a1',
        event_type: 'PLAN_ACTIVATED',
        data: {},
      });
      expect(entry.plan_id).toBe('p1');
      expect(entry.event_type).toBe('PLAN_ACTIVATED');
    });
  });

  describe('getByPlanId', () => {
    it('queries pk = PLAN#planId and returns entries', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({
        Items: [
          {
            pk: 'PLAN#plan-1',
            sk: 'EVENT#2026-01-30T00:00:00.000Z#id1',
            plan_id: 'plan-1',
            event_type: 'PLAN_APPROVED',
            timestamp: '2026-01-30T00:00:00.000Z',
            data: {},
            entry_id: 'id1',
            tenant_id: 't1',
            account_id: 'a1',
          },
        ],
      });
      const entries = await service.getByPlanId('plan-1');
      expect(entries.length).toBe(1);
      expect(entries[0].event_type).toBe('PLAN_APPROVED');
      const call = (mockDynamoDBDocumentClient.send as jest.Mock).mock.calls[0][0];
      expect(call.input.KeyConditionExpression).toContain('pk');
      expect(call.input.ExpressionAttributeValues[':pk']).toBe('PLAN#plan-1');
    });

    it('returns empty array when no items', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({ Items: [] });
      const entries = await service.getByPlanId('plan-1');
      expect(entries).toEqual([]);
    });

    it('applies limit when provided', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({ Items: [] });
      await service.getByPlanId('plan-1', 5);
      const call = (mockDynamoDBDocumentClient.send as jest.Mock).mock.calls[0][0];
      expect(call.input?.Limit).toBe(5);
    });
  });
});
