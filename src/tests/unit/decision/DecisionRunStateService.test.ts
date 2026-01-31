/**
 * Unit tests for DecisionRunStateService - Phase 5.2
 */

import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { mockDynamoDBDocumentClient, resetAllMocks } from '../../__mocks__/aws-sdk-clients';
import { DecisionRunStateService } from '../../../services/decision/DecisionRunStateService';
import { Logger } from '../../../services/core/Logger';
import type { DecisionTriggerRegistryEntryV1 } from '../../../types/decision/DecisionTriggerTypes';

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn(() => mockDynamoDBDocumentClient) },
  GetCommand: jest.fn(),
  UpdateCommand: jest.fn(),
}));

const logger = new Logger('DecisionRunStateServiceTest');

describe('DecisionRunStateService', () => {
  const tableName = 'test-decision-run-state';
  let service: DecisionRunStateService;
  const registryEntry: DecisionTriggerRegistryEntryV1 = {
    trigger_type: 'SIGNAL_ARRIVED',
    debounce_seconds: 60,
    cooldown_seconds: 300,
    max_per_account_per_hour: 12,
  };

  beforeEach(() => {
    resetAllMocks();
    jest.clearAllMocks();
    service = new DecisionRunStateService(
      mockDynamoDBDocumentClient as any,
      tableName,
      logger
    );
  });

  it('getState returns null when no item', async () => {
    mockDynamoDBDocumentClient.send.mockResolvedValue({});
    const result = await service.getState('t1', 'a1');
    expect(result).toBeNull();
  });

  it('getState returns item when present', async () => {
    const item = {
      pk: 'TENANT#t1#ACCOUNT#a1',
      sk: 'RUN_STATE#GLOBAL',
      last_allowed_at_epoch: 1000,
      updated_at: '2026-01-28T00:00:00Z',
    };
    mockDynamoDBDocumentClient.send.mockResolvedValue({ Item: item });
    const result = await service.getState('t1', 'a1');
    expect(result).toEqual(item);
  });

  it('tryAcquireAdmissionLock returns acquired true when update succeeds', async () => {
    mockDynamoDBDocumentClient.send.mockResolvedValue({});
    const result = await service.tryAcquireAdmissionLock(
      't1',
      'a1',
      'SIGNAL_ARRIVED',
      registryEntry
    );
    expect(result.acquired).toBe(true);
    expect(mockDynamoDBDocumentClient.send).toHaveBeenCalled();
  });

  it('tryAcquireAdmissionLock returns acquired false on ConditionalCheckFailedException', async () => {
    const err = new Error('Conditional check failed');
    (err as Error & { name: string }).name = 'ConditionalCheckFailedException';
    mockDynamoDBDocumentClient.send.mockRejectedValue(err);
    const result = await service.tryAcquireAdmissionLock(
      't1',
      'a1',
      'SIGNAL_ARRIVED',
      registryEntry
    );
    expect(result.acquired).toBe(false);
    expect(result.reason).toBe('COOLDOWN');
  });

  it('tryAcquireAdmissionLock throws on other errors', async () => {
    mockDynamoDBDocumentClient.send.mockRejectedValue(new Error('ServiceUnavailable'));
    await expect(
      service.tryAcquireAdmissionLock('t1', 'a1', 'SIGNAL_ARRIVED', registryEntry)
    ).rejects.toThrow('ServiceUnavailable');
  });

  it('tryAcquireAdmissionLock with registry without max_per_account_per_hour succeeds when update succeeds', async () => {
    const registryNoMax: DecisionTriggerRegistryEntryV1 = {
      trigger_type: 'SIGNAL_ARRIVED',
      debounce_seconds: 60,
      cooldown_seconds: 300,
    };
    mockDynamoDBDocumentClient.send.mockResolvedValue({});
    const result = await service.tryAcquireAdmissionLock(
      't1',
      'a1',
      'SIGNAL_ARRIVED',
      registryNoMax
    );
    expect(result.acquired).toBe(true);
  });
});
