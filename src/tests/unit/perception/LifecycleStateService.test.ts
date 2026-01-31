/**
 * LifecycleStateService Unit Tests - Phase 1 Perception
 */

import { mockDynamoDBDocumentClient, resetAllMocks } from '../../__mocks__/aws-sdk-clients';

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(),
}));
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn(() => mockDynamoDBDocumentClient) },
  GetCommand: jest.fn(),
  PutCommand: jest.fn(),
  UpdateCommand: jest.fn(),
  QueryCommand: jest.fn(),
  TransactWriteCommand: jest.fn(),
}));

import { LifecycleStateService } from '../../../services/perception/LifecycleStateService';
import { Logger } from '../../../services/core/Logger';
import { LifecycleState } from '../../../types/LifecycleTypes';
import { SignalType } from '../../../types/SignalTypes';

describe('LifecycleStateService', () => {
  let service: LifecycleStateService;
  let logger: Logger;
  let mockLedgerService: { append: jest.Mock };
  let mockSuppressionEngine: Record<string, unknown>;

  beforeEach(() => {
    resetAllMocks();
    logger = new Logger('LifecycleStateServiceTest');
    mockLedgerService = { append: jest.fn().mockResolvedValue(undefined) };
    mockSuppressionEngine = {};
    service = new LifecycleStateService({
      logger,
      accountsTableName: 'test-accounts',
      ledgerService: mockLedgerService as any,
      suppressionEngine: mockSuppressionEngine as any,
      region: 'us-west-2',
      inferenceRuleVersion: '1.0.0',
    });
  });

  describe('getInferenceRuleVersion', () => {
    it('returns configured inference rule version', () => {
      expect(service.getInferenceRuleVersion()).toBe('1.0.0');
    });
  });

  describe('getAccountState', () => {
    it('returns null when no item exists', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({});

      const result = await service.getAccountState('acc-1', 't1');

      expect(result).toBeNull();
    });

    it('throws when Dynamo send rejects (catch branch)', async () => {
      mockDynamoDBDocumentClient.send.mockRejectedValue(new Error('Dynamo error'));

      await expect(service.getAccountState('acc-1', 't1')).rejects.toThrow('Dynamo error');
    });

    it('returns mapped AccountState when item exists', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({
        Item: {
          tenantId: 't1',
          accountId: 'acc-1',
          currentLifecycleState: LifecycleState.SUSPECT,
          lastTransitionAt: '2026-01-01T00:00:00Z',
          lastEngagementAt: '2026-01-02T00:00:00Z',
          hasActiveContract: false,
          lastInferenceAt: '2026-01-03T00:00:00Z',
          inferenceRuleVersion: '1.0.0',
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-03T00:00:00Z',
          activeSignalIndex: {
            [SignalType.FIRST_ENGAGEMENT_OCCURRED]: ['sig-1'],
          },
        },
      });

      const result = await service.getAccountState('acc-1', 't1');

      expect(result).not.toBeNull();
      expect(result!.accountId).toBe('acc-1');
      expect(result!.tenantId).toBe('t1');
      expect(result!.currentLifecycleState).toBe(LifecycleState.SUSPECT);
      expect(result!.hasActiveContract).toBe(false);
      expect(result!.activeSignalIndex[SignalType.FIRST_ENGAGEMENT_OCCURRED]).toEqual(['sig-1']);
    });
  });

  describe('updateAccountState', () => {
    it('creates initial state and merges updates when no current state', async () => {
      mockDynamoDBDocumentClient.send
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({});

      const result = await service.updateAccountState('acc-1', 't1', {
        currentLifecycleState: LifecycleState.PROSPECT,
      });

      expect(result.accountId).toBe('acc-1');
      expect(result.currentLifecycleState).toBe(LifecycleState.PROSPECT);
      expect(mockDynamoDBDocumentClient.send).toHaveBeenCalledTimes(2);
    });

    it('merges with existing state and puts item', async () => {
      mockDynamoDBDocumentClient.send
        .mockResolvedValueOnce({
          Item: {
            tenantId: 't1',
            accountId: 'acc-1',
            currentLifecycleState: LifecycleState.PROSPECT,
            activeSignalIndex: {},
            lastTransitionAt: null,
            lastEngagementAt: null,
            hasActiveContract: false,
            lastInferenceAt: '2026-01-01T00:00:00Z',
            inferenceRuleVersion: '1.0.0',
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
          },
        })
        .mockResolvedValueOnce({});

      const result = await service.updateAccountState('acc-1', 't1', {
        currentLifecycleState: LifecycleState.SUSPECT,
      });

      expect(result.currentLifecycleState).toBe(LifecycleState.SUSPECT);
      expect(mockDynamoDBDocumentClient.send).toHaveBeenCalledTimes(2);
    });

    it('throws when PutCommand fails (catch branch)', async () => {
      mockDynamoDBDocumentClient.send
        .mockResolvedValueOnce({ Item: null })
        .mockRejectedValueOnce(new Error('Put failed'));

      await expect(
        service.updateAccountState('acc-1', 't1', { currentLifecycleState: LifecycleState.PROSPECT })
      ).rejects.toThrow('Put failed');
    });
  });

  describe('inferLifecycleState', () => {
    it('returns PROSPECT when no account state', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({});

      const result = await service.inferLifecycleState('acc-1', 't1');

      expect(result).toBe(LifecycleState.PROSPECT);
    });

    it('returns CUSTOMER when hasActiveContract is true', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({
        Item: {
          tenantId: 't1',
          accountId: 'acc-1',
          currentLifecycleState: LifecycleState.SUSPECT,
          activeSignalIndex: {},
          lastTransitionAt: null,
          lastEngagementAt: null,
          hasActiveContract: true,
          lastInferenceAt: '2026-01-01T00:00:00Z',
          inferenceRuleVersion: '1.0.0',
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
      });

      const result = await service.inferLifecycleState('acc-1', 't1');

      expect(result).toBe(LifecycleState.CUSTOMER);
    });

    it('returns SUSPECT when FIRST_ENGAGEMENT_OCCURRED in activeSignalIndex', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({
        Item: {
          tenantId: 't1',
          accountId: 'acc-1',
          currentLifecycleState: LifecycleState.PROSPECT,
          activeSignalIndex: {
            [SignalType.FIRST_ENGAGEMENT_OCCURRED]: ['sig-1'],
          },
          lastTransitionAt: null,
          lastEngagementAt: '2026-01-02T00:00:00Z',
          hasActiveContract: false,
          lastInferenceAt: '2026-01-01T00:00:00Z',
          inferenceRuleVersion: '1.0.0',
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
      });

      const result = await service.inferLifecycleState('acc-1', 't1');

      expect(result).toBe(LifecycleState.SUSPECT);
    });

    it('returns PROSPECT when ACCOUNT_ACTIVATION_DETECTED and no engagement', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({
        Item: {
          tenantId: 't1',
          accountId: 'acc-1',
          currentLifecycleState: LifecycleState.PROSPECT,
          activeSignalIndex: {
            [SignalType.ACCOUNT_ACTIVATION_DETECTED]: ['sig-1'],
          },
          lastTransitionAt: null,
          lastEngagementAt: null,
          hasActiveContract: false,
          lastInferenceAt: '2026-01-01T00:00:00Z',
          inferenceRuleVersion: '1.0.0',
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
      });

      const result = await service.inferLifecycleState('acc-1', 't1');

      expect(result).toBe(LifecycleState.PROSPECT);
    });

    it('returns PROSPECT when no rule matches (fall-through to default)', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({
        Item: {
          tenantId: 't1',
          accountId: 'acc-1',
          currentLifecycleState: LifecycleState.PROSPECT,
          activeSignalIndex: {},
          lastTransitionAt: null,
          lastEngagementAt: null,
          hasActiveContract: false,
          lastInferenceAt: '2026-01-01T00:00:00Z',
          inferenceRuleVersion: '1.0.0',
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
      });

      const result = await service.inferLifecycleState('acc-1', 't1');

      expect(result).toBe(LifecycleState.PROSPECT);
    });
  });

  describe('shouldTransition', () => {
    it('returns false when no account state', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({});

      const result = await service.shouldTransition('acc-1', 't1', []);

      expect(result).toBe(false);
    });
  });

  describe('recordTransition', () => {
    it('updates account state and appends to ledger', async () => {
      mockDynamoDBDocumentClient.send
        .mockResolvedValueOnce({
          Item: {
            tenantId: 't1',
            accountId: 'acc-1',
            currentLifecycleState: LifecycleState.PROSPECT,
            activeSignalIndex: {},
            lastTransitionAt: null,
            lastEngagementAt: null,
            hasActiveContract: false,
            lastInferenceAt: '2026-01-01T00:00:00Z',
            inferenceRuleVersion: '1.0.0',
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
          },
        })
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({});

      const result = await service.recordTransition(
        'acc-1',
        't1',
        LifecycleState.PROSPECT,
        LifecycleState.SUSPECT,
        [SignalType.FIRST_ENGAGEMENT_OCCURRED],
        ['ref-1'],
        'trace-1'
      );

      expect(result.transitionId).toMatch(/^trans_/);
      expect(result.fromState).toBe(LifecycleState.PROSPECT);
      expect(result.toState).toBe(LifecycleState.SUSPECT);
      expect(mockLedgerService.append).toHaveBeenCalledTimes(1);
      expect(mockLedgerService.append).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'SIGNAL',
          accountId: 'acc-1',
          tenantId: 't1',
          data: expect.objectContaining({
            fromState: LifecycleState.PROSPECT,
            toState: LifecycleState.SUSPECT,
          }),
        })
      );
    });

    it('throws when ledger append rejects (catch branch)', async () => {
      mockDynamoDBDocumentClient.send
        .mockResolvedValueOnce({
          Item: {
            tenantId: 't1',
            accountId: 'acc-1',
            currentLifecycleState: LifecycleState.PROSPECT,
            activeSignalIndex: {},
            lastTransitionAt: null,
            lastEngagementAt: null,
            hasActiveContract: false,
            lastInferenceAt: '2026-01-01T00:00:00Z',
            inferenceRuleVersion: '1.0.0',
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
          },
        })
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({});
      mockLedgerService.append.mockRejectedValue(new Error('Ledger append failed'));

      await expect(
        service.recordTransition(
          'acc-1',
          't1',
          LifecycleState.PROSPECT,
          LifecycleState.SUSPECT,
          [SignalType.FIRST_ENGAGEMENT_OCCURRED],
          ['ref-1'],
          'trace-1'
        )
      ).rejects.toThrow('Ledger append failed');
    });
  });

  describe('getLifecycleHistory', () => {
    it('returns empty array', async () => {
      const result = await service.getLifecycleHistory('acc-1', 't1');
      expect(result).toEqual([]);
    });

    it('throws when logger.debug throws (catch branch)', async () => {
      const logSpy = jest.spyOn(logger, 'debug').mockImplementationOnce(() => {
        throw new Error('Logger error');
      });

      await expect(service.getLifecycleHistory('acc-1', 't1')).rejects.toThrow('Logger error');
      logSpy.mockRestore();
    });
  });
});
