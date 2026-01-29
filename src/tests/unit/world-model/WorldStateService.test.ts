/**
 * WorldStateService Unit Tests - Phase 0 World Model
 */

import { mockDynamoDBDocumentClient, resetAllMocks } from '../../__mocks__/aws-sdk-clients';

jest.mock('../../../utils/aws-client-config', () => ({
  getAWSClientConfig: jest.fn(() => ({})),
}));
jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(),
}));
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn(() => mockDynamoDBDocumentClient) },
  PutCommand: jest.fn(),
  QueryCommand: jest.fn(),
}));

import { WorldStateService } from '../../../services/world-model/WorldStateService';
import { Logger } from '../../../services/core/Logger';
import { EvidenceRecord } from '../../../types/EvidenceTypes';
import { EntityState } from '../../../types/WorldStateTypes';

function makeEvidenceRecord(overrides: Partial<EvidenceRecord> = {}): EvidenceRecord {
  return {
    evidenceId: 'ev1',
    entityId: 'ent-1',
    entityType: 'Account',
    evidenceType: 'CRM' as any,
    timestamp: new Date().toISOString(),
    payload: { name: 'Test Account', status: 'active' },
    provenance: {
      trustClass: 'PRIMARY',
      sourceSystem: 'crm',
      collectedAt: new Date().toISOString(),
    },
    metadata: { tenantId: 't1', traceId: 'trace-1' },
    s3Location: 'evidence/Account/ent-1/ev1.json',
    ...overrides,
  };
}

describe('WorldStateService', () => {
  let service: WorldStateService;
  let logger: Logger;
  let mockEvidenceService: { query: jest.Mock };

  beforeEach(() => {
    resetAllMocks();
    logger = new Logger('WorldStateServiceTest');
    mockEvidenceService = {
      query: jest.fn(),
    };
    service = new WorldStateService(
      logger,
      mockEvidenceService as any,
      'test-state-table',
      'us-west-2'
    );
  });

  describe('computeState', () => {
    it('should compute state from evidence and store it', async () => {
      const evidence = [makeEvidenceRecord()];
      mockEvidenceService.query.mockResolvedValue(evidence);
      mockDynamoDBDocumentClient.send.mockResolvedValue({});

      const result = await service.computeState('ent-1', 'Account', 't1');

      expect(result.entityId).toBe('ent-1');
      expect(result.entityType).toBe('Account');
      expect(result.tenantId).toBe('t1');
      expect(result.fields).toHaveProperty('name');
      expect(result.fields).toHaveProperty('status');
      expect(result.overallConfidence).toBeGreaterThanOrEqual(0);
      expect(result.overallConfidence).toBeLessThanOrEqual(1);
      expect(result.autonomyTier).toMatch(/^TIER_/);
      expect(mockEvidenceService.query).toHaveBeenCalledWith({
        tenantId: 't1',
        entityId: 'ent-1',
        limit: 1000,
      });
      expect(mockDynamoDBDocumentClient.send).toHaveBeenCalled();
    });

    it('should throw when no evidence found', async () => {
      mockEvidenceService.query.mockResolvedValue([]);

      await expect(service.computeState('ent-1', 'Account', 't1')).rejects.toThrow(
        'No evidence found for entity ent-1'
      );
      expect(mockDynamoDBDocumentClient.send).not.toHaveBeenCalled();
    });
  });

  describe('getState', () => {
    it('should return null when no state found', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({ Items: [] });

      const result = await service.getState('ent-1', 't1');
      expect(result).toBeNull();
    });

    it('should return state when found and tenant matches', async () => {
      const state: EntityState = {
        entityId: 'ent-1',
        entityType: 'Account',
        tenantId: 't1',
        fields: {},
        computedAt: new Date().toISOString(),
        autonomyTier: 'TIER_A',
        overallConfidence: 0.9,
        overallFreshness: 1,
        overallContradiction: 0,
      };
      mockDynamoDBDocumentClient.send.mockResolvedValue({
        Items: [{ pk: 'ENTITY#ent-1', sk: 'STATE#x', state }],
      });

      const result = await service.getState('ent-1', 't1');
      expect(result).toEqual(state);
    });

    it('should return null when tenant does not match', async () => {
      const state: EntityState = {
        entityId: 'ent-1',
        entityType: 'Account',
        tenantId: 'other-tenant',
        fields: {},
        computedAt: new Date().toISOString(),
        autonomyTier: 'TIER_A',
        overallConfidence: 0.9,
        overallFreshness: 1,
        overallContradiction: 0,
      };
      mockDynamoDBDocumentClient.send.mockResolvedValue({
        Items: [{ pk: 'ENTITY#ent-1', sk: 'STATE#x', state }],
      });

      const result = await service.getState('ent-1', 't1');
      expect(result).toBeNull();
    });
  });

  describe('query', () => {
    it('should throw when neither entityId nor entityType provided', async () => {
      await expect(service.query({ tenantId: 't1' })).rejects.toThrow(
        'Either entityId or entityType must be provided'
      );
    });

    it('should return empty array when no items', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({ Items: [] });

      const result = await service.query({ tenantId: 't1', entityId: 'ent-1' });
      expect(result).toEqual([]);
    });
  });
});
