/**
 * Unit tests for RankingWeightsRegistryService — Phase 5.5
 */

import { RankingWeightsRegistryService } from '../../../services/learning/RankingWeightsRegistryService';
import { Logger } from '../../../services/core/Logger';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { mockDynamoDBDocumentClient, resetAllMocks } from '../../__mocks__/aws-sdk-clients';
import { LedgerEventType } from '../../../types/LedgerTypes';
import type { ILedgerService } from '../../../types/LedgerTypes';

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn(() => mockDynamoDBDocumentClient) },
  GetCommand: jest.fn(),
  PutCommand: jest.fn(),
  UpdateCommand: jest.fn(),
}));

describe('RankingWeightsRegistryService', () => {
  let service: RankingWeightsRegistryService;
  let logger: Logger;
  let ledger: jest.Mocked<ILedgerService>;

  beforeEach(() => {
    resetAllMocks();
    jest.clearAllMocks();
    logger = new Logger('RankingWeightsRegistryServiceTest');
    ledger = { append: jest.fn().mockResolvedValue({}), query: jest.fn(), getByTraceId: jest.fn(), getByEntryId: jest.fn() };
    service = new RankingWeightsRegistryService(
      mockDynamoDBDocumentClient as any,
      'test-registry-table',
      logger,
      ledger
    );
  });

  describe('getRegistry', () => {
    it('returns null when no item', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({});
      const result = await service.getRegistry('t1');
      expect(result).toBeNull();
      expect(GetCommand).toHaveBeenCalledWith(
        expect.objectContaining({ Key: { pk: 'TENANT#t1', sk: 'REGISTRY' } })
      );
    });

    it('returns registry when item exists', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({
        Item: {
          pk: 'TENANT#t1',
          sk: 'REGISTRY',
          tenant_id: 't1',
          active_version: 'v1',
          status: 'ACTIVE',
          activated_at: '2026-01-01T00:00:00.000Z',
          activated_by: 'job1',
        },
      });
      const result = await service.getRegistry('t1');
      expect(result).not.toBeNull();
      expect(result!.tenant_id).toBe('t1');
      expect(result!.active_version).toBe('v1');
    });
  });

  describe('resolveActiveVersion', () => {
    it('returns tenant active_version when set', async () => {
      mockDynamoDBDocumentClient.send
        .mockResolvedValueOnce({
          Item: { pk: 'TENANT#t1', sk: 'REGISTRY', tenant_id: 't1', active_version: 'v2' },
        });
      const version = await service.resolveActiveVersion('t1');
      expect(version).toBe('v2');
    });

    it('falls back to GLOBAL when tenant has no registry', async () => {
      mockDynamoDBDocumentClient.send
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({
          Item: { pk: 'TENANT#GLOBAL', sk: 'REGISTRY', tenant_id: 'GLOBAL', active_version: 'v0' },
        });
      const version = await service.resolveActiveVersion('t1');
      expect(version).toBe('v0');
    });

    it('returns null when both tenant and GLOBAL have no active_version', async () => {
      mockDynamoDBDocumentClient.send
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({});
      const version = await service.resolveActiveVersion('t1');
      expect(version).toBeNull();
    });
  });

  describe('putWeights and getWeights', () => {
    it('stores and retrieves weights', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({});
      const weights = {
        version: 'v1',
        tenant_id: 't1',
        weights: { f1: 0.5 },
        calibrated_at: new Date().toISOString(),
        trained_on_range: { start: '2026-01-01', end: '2026-01-14' },
        data_volume: { n_outcomes: 10 },
        features_version: 'v1',
        calibration_job_id: 'job1',
      };
      await service.putWeights(weights);
      expect(PutCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          Item: expect.objectContaining({ version: 'v1', tenant_id: 't1' }),
        })
      );

      mockDynamoDBDocumentClient.send.mockResolvedValue({
        Item: { pk: 'TENANT#t1', sk: 'WEIGHTS#v1', ...weights },
      });
      const got = await service.getWeights('t1', 'v1');
      expect(got?.version).toBe('v1');
      expect(got?.weights.f1).toBe(0.5);
    });

    it('getWeights returns null when item not found', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({});
      const got = await service.getWeights('t1', 'v99');
      expect(got).toBeNull();
    });
  });

  describe('setCandidate', () => {
    it('creates registry with PutCommand when no existing registry', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValueOnce({}).mockResolvedValueOnce({});
      await service.setCandidate('t1', 'v1');
      expect(GetCommand).toHaveBeenCalled();
      expect(PutCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          Item: expect.objectContaining({
            pk: 'TENANT#t1',
            sk: 'REGISTRY',
            tenant_id: 't1',
            active_version: 'v1',
            candidate_version: 'v1',
            status: 'CANDIDATE',
          }),
        })
      );
    });

    it('updates registry with UpdateCommand when registry exists', async () => {
      mockDynamoDBDocumentClient.send
        .mockResolvedValueOnce({
          Item: { pk: 'TENANT#t1', sk: 'REGISTRY', tenant_id: 't1', active_version: 'v0', status: 'ACTIVE' },
        })
        .mockResolvedValueOnce({});
      await service.setCandidate('t1', 'v2');
      expect(UpdateCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          Key: { pk: 'TENANT#t1', sk: 'REGISTRY' },
          UpdateExpression: 'SET candidate_version = :v, #st = :st',
          ExpressionAttributeValues: expect.objectContaining({ ':v': 'v2', ':st': 'CANDIDATE' }),
        })
      );
    });
  });

  describe('promoteCandidateToActive', () => {
    it('updates active_version and appends ledger entry', async () => {
      mockDynamoDBDocumentClient.send
        .mockResolvedValueOnce({
          Item: {
            pk: 'TENANT#t1',
            sk: 'REGISTRY',
            tenant_id: 't1',
            active_version: 'v1',
            candidate_version: 'v2',
            status: 'CANDIDATE',
            activated_at: '2026-01-01T00:00:00.000Z',
            activated_by: 'job1',
          },
        })
        .mockResolvedValueOnce({});
      await service.promoteCandidateToActive('t1', 'gate-job');
      expect(UpdateCommand).toHaveBeenCalled();
      expect(ledger.append).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: LedgerEventType.RANKING_WEIGHTS_PROMOTED,
          data: expect.objectContaining({
            tenant_id: 't1',
            previous_active_version: 'v1',
            new_active_version: 'v2',
            activated_by: 'gate-job',
          }),
        })
      );
    });

    it('throws when no candidate_version', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValueOnce({
        Item: {
          pk: 'TENANT#t1',
          sk: 'REGISTRY',
          tenant_id: 't1',
          active_version: 'v1',
          status: 'ACTIVE',
          activated_at: '2026-01-01T00:00:00.000Z',
          activated_by: 'job1',
        },
      });
      await expect(service.promoteCandidateToActive('t1', 'job')).rejects.toThrow('No candidate_version');
    });

    it('throws when registry is null', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValueOnce({});
      await expect(service.promoteCandidateToActive('t1', 'job')).rejects.toThrow('No candidate_version');
    });

    it('does not call ledger when ledgerService is undefined', async () => {
      const serviceNoLedger = new RankingWeightsRegistryService(
        mockDynamoDBDocumentClient as any,
        'test-registry-table',
        logger
      );
      mockDynamoDBDocumentClient.send
        .mockResolvedValueOnce({
          Item: {
            pk: 'TENANT#t1',
            sk: 'REGISTRY',
            tenant_id: 't1',
            active_version: 'v1',
            candidate_version: 'v2',
            status: 'CANDIDATE',
            activated_at: '2026-01-01T00:00:00.000Z',
            activated_by: 'job1',
          },
        })
        .mockResolvedValueOnce({});
      await serviceNoLedger.promoteCandidateToActive('t1', 'gate-job');
      expect(UpdateCommand).toHaveBeenCalled();
      expect(ledger.append).not.toHaveBeenCalled();
    });
  });

  describe('rollback', () => {
    it('sets active_version to target and appends ledger entry', async () => {
      mockDynamoDBDocumentClient.send
        .mockResolvedValueOnce({
          Item: {
            pk: 'TENANT#t1',
            sk: 'REGISTRY',
            tenant_id: 't1',
            active_version: 'v2',
            status: 'ACTIVE',
            activated_at: '2026-01-01T00:00:00.000Z',
            activated_by: 'job1',
          },
        })
        .mockResolvedValueOnce({});
      await service.rollback('t1', 'v1', 'rollback-job');
      expect(UpdateCommand).toHaveBeenCalled();
      expect(ledger.append).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: LedgerEventType.RANKING_WEIGHTS_ROLLED_BACK,
          data: expect.objectContaining({
            tenant_id: 't1',
            rolled_back_from: 'v2',
            new_active_version: 'v1',
            activated_by: 'rollback-job',
          }),
        })
      );
    });

    it('throws when no registry for tenant', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValueOnce({});
      await expect(service.rollback('t1', 'v1', 'job')).rejects.toThrow('No registry for tenant');
    });

    it('does not call ledger when ledgerService is undefined', async () => {
      const serviceNoLedger = new RankingWeightsRegistryService(
        mockDynamoDBDocumentClient as any,
        'test-registry-table',
        logger
      );
      mockDynamoDBDocumentClient.send
        .mockResolvedValueOnce({
          Item: {
            pk: 'TENANT#t1',
            sk: 'REGISTRY',
            tenant_id: 't1',
            active_version: 'v2',
            status: 'ACTIVE',
            activated_at: '2026-01-01T00:00:00.000Z',
            activated_by: 'job1',
          },
        })
        .mockResolvedValueOnce({});
      await serviceNoLedger.rollback('t1', 'v1', 'rollback-job');
      expect(UpdateCommand).toHaveBeenCalled();
      expect(ledger.append).not.toHaveBeenCalled();
    });
  });
});
