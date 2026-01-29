/**
 * AccountPostureStateService Unit Tests - Phase 2 Synthesis
 */

import { mockDynamoDBDocumentClient, resetAllMocks } from '../../__mocks__/aws-sdk-clients';

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: jest.fn(),
  GetCommand: jest.fn(),
  PutCommand: jest.fn(),
}));

import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { AccountPostureStateService } from '../../../services/synthesis/AccountPostureStateService';
import { AccountPostureStateV1, PostureState, Momentum } from '../../../types/PostureTypes';

describe('AccountPostureStateService', () => {
  let service: AccountPostureStateService;

  const minimalPostureState: AccountPostureStateV1 = {
    account_id: 'acc-1',
    tenantId: 't1',
    posture: PostureState.OK,
    momentum: Momentum.FLAT,
    risk_factors: [],
    opportunities: [],
    unknowns: [],
    evidence_signal_ids: [],
    evidence_snapshot_refs: [],
    evidence_signal_types: [],
    ruleset_version: 'v1.0.0',
    schema_version: 'v1',
    active_signals_hash: 'hash1',
    inputs_hash: 'inputHash1',
    evaluated_at: new Date().toISOString(),
    output_ttl_days: 7,
    rule_id: 'rule-1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  beforeEach(() => {
    resetAllMocks();
    service = new AccountPostureStateService({
      dynamoClient: mockDynamoDBDocumentClient as any,
      tableName: 'test-posture-table',
    });
  });

  describe('getPostureState', () => {
    it('returns null when no item exists', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({});

      const result = await service.getPostureState('acc-1', 't1');

      expect(result).toBeNull();
    });

    it('returns posture state when item exists', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({
        Item: { ...minimalPostureState, pk: 'ACCOUNT#t1#acc-1', sk: 'POSTURE#LATEST' },
      });

      const result = await service.getPostureState('acc-1', 't1');

      expect(result).not.toBeNull();
      expect(result!.account_id).toBe('acc-1');
      expect(result!.tenantId).toBe('t1');
      expect(result!.posture).toBe(PostureState.OK);
    });
  });

  describe('writePostureState', () => {
    it('sends Put with condition and succeeds', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({});

      await service.writePostureState(minimalPostureState);

      expect(PutCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          TableName: 'test-posture-table',
          ConditionExpression: expect.stringContaining('inputs_hash'),
        })
      );
    });

    it('treats ConditionalCheckFailedException as success (churn prevention)', async () => {
      const err = new Error('Conditional check failed');
      (err as any).name = 'ConditionalCheckFailedException';
      mockDynamoDBDocumentClient.send.mockRejectedValue(err);

      await service.writePostureState(minimalPostureState);

      expect(mockDynamoDBDocumentClient.send).toHaveBeenCalledTimes(1);
    });

    it('rethrows non-conditional errors', async () => {
      mockDynamoDBDocumentClient.send.mockRejectedValue(new Error('DynamoDB error'));

      await expect(service.writePostureState(minimalPostureState)).rejects.toThrow('DynamoDB error');
    });
  });

  describe('deletePostureState', () => {
    it('sends Put with soft-delete fields', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({});

      await service.deletePostureState('acc-1', 't1');

      expect(PutCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          TableName: 'test-posture-table',
          Item: expect.objectContaining({
            pk: 'ACCOUNT#t1#acc-1',
            sk: 'POSTURE#LATEST',
            deleted: true,
          }),
        })
      );
    });
  });
});
