/**
 * PlanRepositoryService — Phase 6.1 method and DRAFT-only coverage.
 */

import { PlanRepositoryService } from '../../../services/plan/PlanRepositoryService';
import { Logger } from '../../../services/core/Logger';
import { RevenuePlanV1 } from '../../../types/plan/PlanTypes';
import { mockDynamoDBDocumentClient, resetAllMocks } from '../../__mocks__/aws-sdk-clients';

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn(() => mockDynamoDBDocumentClient) },
  GetCommand: jest.fn().mockImplementation((params: Record<string, unknown>) => ({ input: params })),
  PutCommand: jest.fn().mockImplementation((params: Record<string, unknown>) => ({ input: params })),
  UpdateCommand: jest.fn().mockImplementation((params: Record<string, unknown>) => ({ input: params })),
  QueryCommand: jest.fn().mockImplementation((params: Record<string, unknown>) => ({ input: params })),
}));
jest.mock('../../../utils/aws-client-config', () => ({ getAWSClientConfig: jest.fn(() => ({})) }));

function plan(overrides: Partial<RevenuePlanV1> = {}): RevenuePlanV1 {
  const now = new Date().toISOString();
  return {
    plan_id: 'plan-1',
    plan_type: 'RENEWAL_DEFENSE',
    account_id: 'acc-1',
    tenant_id: 't1',
    objective: 'Renew',
    plan_status: 'DRAFT',
    steps: [],
    expires_at: now,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

describe('PlanRepositoryService', () => {
  let service: PlanRepositoryService;
  let logger: Logger;

  beforeEach(() => {
    resetAllMocks();
    logger = new Logger('PlanRepoTest');
    service = new PlanRepositoryService(logger, { tableName: 'RevenuePlans' });
  });

  describe('getPlan', () => {
    it('returns plan when item exists and tenant/account match', async () => {
      const p = plan();
      const item = {
        ...p,
        pk: 'TENANT#t1#ACCOUNT#acc-1',
        sk: 'PLAN#plan-1',
        gsi1pk: 'x',
        gsi1sk: 'y',
        gsi2pk: 'z',
        gsi2sk: 'w',
      };
      mockDynamoDBDocumentClient.send.mockResolvedValue({ Item: item });
      const result = await service.getPlan('t1', 'acc-1', 'plan-1');
      expect(result).not.toBeNull();
      expect(result?.plan_id).toBe('plan-1');
      expect(result?.tenant_id).toBe('t1');
      expect(result?.account_id).toBe('acc-1');
    });

    it('returns null when item does not exist', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({});
      const result = await service.getPlan('t1', 'acc-1', 'plan-1');
      expect(result).toBeNull();
    });
  });

  describe('putPlan', () => {
    it('create (new plan_id): PutCommand with correct pk/sk/gsi keys; succeeds', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValueOnce({}).mockResolvedValue({});
      const p = plan();
      await service.putPlan(p);
      expect(mockDynamoDBDocumentClient.send).toHaveBeenCalledTimes(2);
      const putCall = (mockDynamoDBDocumentClient.send as jest.Mock).mock.calls[1][0];
      expect(putCall.input?.TableName).toBe('RevenuePlans');
      expect(putCall.input?.Item?.pk).toBe('TENANT#t1#ACCOUNT#acc-1');
      expect(putCall.input?.Item?.sk).toBe('PLAN#plan-1');
      expect(putCall.input?.Item?.gsi1pk).toBe('TENANT#t1#STATUS#DRAFT');
      expect(putCall.input?.Item?.gsi2pk).toBe('TENANT#t1');
      expect(putCall.input?.Item?.gsi2sk).toMatch(/^ACCOUNT#acc-1#/);
    });

    it('update existing DRAFT: PutCommand when stored plan has plan_status === DRAFT; succeeds', async () => {
      const existing = plan({ plan_status: 'DRAFT' });
      const withKeys = {
        ...existing,
        pk: 'TENANT#t1#ACCOUNT#acc-1',
        sk: 'PLAN#plan-1',
        gsi1pk: 'x',
        gsi1sk: 'y',
        gsi2pk: 'z',
        gsi2sk: 'w',
      };
      mockDynamoDBDocumentClient.send
        .mockResolvedValueOnce({ Item: withKeys })
        .mockResolvedValue({});
      const updated = plan({ plan_status: 'DRAFT', objective: 'Updated objective' });
      await service.putPlan(updated);
      expect(mockDynamoDBDocumentClient.send).toHaveBeenCalledTimes(2);
    });

    it('update existing non-DRAFT: reject when stored plan has plan_status !== DRAFT', async () => {
      const existing = plan({ plan_status: 'APPROVED' });
      const withKeys = {
        ...existing,
        pk: 'TENANT#t1#ACCOUNT#acc-1',
        sk: 'PLAN#plan-1',
        gsi1pk: 'x',
        gsi1sk: 'y',
        gsi2pk: 'z',
        gsi2sk: 'w',
      };
      mockDynamoDBDocumentClient.send.mockResolvedValueOnce({ Item: withKeys });
      const updated = plan({ plan_status: 'APPROVED', objective: 'Changed' });
      await expect(service.putPlan(updated)).rejects.toThrow(/not in DRAFT|immutable/);
      expect(mockDynamoDBDocumentClient.send).toHaveBeenCalledTimes(1);
    });
  });

  describe('updatePlanStatus', () => {
    it('conditional update with plan_status = :expected; sets plan_status, updated_at, gsi keys', async () => {
      const p = plan({ plan_status: 'DRAFT' });
      const withKeys = {
        ...p,
        pk: 'TENANT#t1#ACCOUNT#acc-1',
        sk: 'PLAN#plan-1',
        gsi1pk: 'x',
        gsi1sk: 'y',
        gsi2pk: 'z',
        gsi2sk: 'w',
      };
      mockDynamoDBDocumentClient.send
        .mockResolvedValueOnce({ Item: withKeys })
        .mockResolvedValue({});
      await service.updatePlanStatus('t1', 'acc-1', 'plan-1', 'APPROVED');
      expect(mockDynamoDBDocumentClient.send).toHaveBeenCalledTimes(2);
      const updateCall = (mockDynamoDBDocumentClient.send as jest.Mock).mock.calls[1][0];
      expect(updateCall.input?.ConditionExpression).toContain('plan_status');
      expect(updateCall.input?.ExpressionAttributeValues?.[':to']).toBe('APPROVED');
    });

    it('reject when plan not found', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValueOnce({});
      await expect(
        service.updatePlanStatus('t1', 'acc-1', 'plan-1', 'APPROVED')
      ).rejects.toThrow(/Plan not found|plan-1/);
    });
  });

  describe('listPlansByTenantAndStatus', () => {
    it('queries GSI1 with gsi1pk = TENANT#tenantId#STATUS#status; returns array; limit applied', async () => {
      const p = plan();
      mockDynamoDBDocumentClient.send.mockResolvedValue({
        Items: [
          {
            ...p,
            pk: 'TENANT#t1#ACCOUNT#acc-1',
            sk: 'PLAN#plan-1',
            gsi1pk: 'TENANT#t1#STATUS#ACTIVE',
            gsi1sk: 'y',
            gsi2pk: 'z',
            gsi2sk: 'w',
          },
        ],
      });
      const result = await service.listPlansByTenantAndStatus('t1', 'ACTIVE', 10);
      expect(result.length).toBe(1);
      expect(result[0].plan_id).toBe('plan-1');
      const call = (mockDynamoDBDocumentClient.send as jest.Mock).mock.calls[0][0];
      expect(call.input?.IndexName).toBeDefined();
      expect(call.input?.ExpressionAttributeValues?.[':gsi1pk']).toBe('TENANT#t1#STATUS#ACTIVE');
      expect(call.input?.Limit).toBe(10);
    });

    it('returns empty array when no items', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({ Items: [] });
      const result = await service.listPlansByTenantAndStatus('t1', 'DRAFT');
      expect(result).toEqual([]);
    });
  });

  describe('listPlansByTenantAndAccount', () => {
    it('queries GSI2 with gsi2pk = TENANT#tenantId, gsi2sk begins_with ACCOUNT#accountId#; limit applied', async () => {
      const p = plan();
      mockDynamoDBDocumentClient.send.mockResolvedValue({
        Items: [
          {
            ...p,
            pk: 'TENANT#t1#ACCOUNT#acc-1',
            sk: 'PLAN#plan-1',
            gsi1pk: 'x',
            gsi1sk: 'y',
            gsi2pk: 'TENANT#t1',
            gsi2sk: 'ACCOUNT#acc-1#2026-01-30',
          },
        ],
      });
      const result = await service.listPlansByTenantAndAccount('t1', 'acc-1', 5);
      expect(result.length).toBe(1);
      const call = (mockDynamoDBDocumentClient.send as jest.Mock).mock.calls[0][0];
      expect(call.input?.ExpressionAttributeValues?.[':prefix']).toBe('ACCOUNT#acc-1#');
      expect(call.input?.Limit).toBe(5);
    });
  });

  describe('existsActivePlanForAccountAndType', () => {
    it('returns { exists: true, planId } when an ACTIVE plan exists for that account and plan_type', async () => {
      const p = plan({ plan_status: 'ACTIVE', plan_type: 'RENEWAL_DEFENSE' });
      mockDynamoDBDocumentClient.send.mockResolvedValue({
        Items: [
          {
            ...p,
            pk: 'TENANT#t1#ACCOUNT#acc-1',
            sk: 'PLAN#plan-1',
            gsi1pk: 'x',
            gsi1sk: 'y',
            gsi2pk: 'z',
            gsi2sk: 'w',
          },
        ],
      });
      const result = await service.existsActivePlanForAccountAndType('t1', 'acc-1', 'RENEWAL_DEFENSE');
      expect(result.exists).toBe(true);
      expect(result.planId).toBe('plan-1');
    });

    it('returns { exists: false } when none', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({ Items: [] });
      const result = await service.existsActivePlanForAccountAndType('t1', 'acc-1', 'RENEWAL_DEFENSE');
      expect(result.exists).toBe(false);
      expect(result.planId).toBeUndefined();
    });
  });
});
