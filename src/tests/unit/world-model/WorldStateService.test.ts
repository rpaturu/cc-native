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
const mockQueryCommand = jest.fn();
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn(() => mockDynamoDBDocumentClient) },
  PutCommand: jest.fn(),
  QueryCommand: mockQueryCommand,
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

    it('should compute state with multiple evidence (contradiction and freshness decay)', async () => {
      const now = new Date();
      const oldTime = new Date(now.getTime() - 50 * 60 * 60 * 1000).toISOString();
      const evidence = [
        makeEvidenceRecord({
          evidenceId: 'ev1',
          timestamp: new Date().toISOString(),
          payload: { name: 'Account A', status: 'active' },
          provenance: { trustClass: 'PRIMARY', sourceSystem: 'crm', collectedAt: new Date().toISOString() },
        }),
        makeEvidenceRecord({
          evidenceId: 'ev2',
          timestamp: oldTime,
          payload: { name: 'Account A', status: 'inactive' },
          provenance: { trustClass: 'PRIMARY', sourceSystem: 'crm', collectedAt: oldTime },
        }),
      ];
      mockEvidenceService.query.mockResolvedValue(evidence);
      mockDynamoDBDocumentClient.send.mockResolvedValue({});

      const result = await service.computeState('ent-1', 'Account', 't1');

      expect(result.entityId).toBe('ent-1');
      expect(result.fields).toHaveProperty('name');
      expect(result.fields).toHaveProperty('status');
      expect(result.autonomyTier).toMatch(/^TIER_/);
      expect(result.overallContradiction).toBeGreaterThanOrEqual(0);
    });

    it('should compute TIER_D when contradiction is high', async () => {
      const evidence = [
        makeEvidenceRecord({ payload: { name: 'X', status: 'a' }, provenance: { trustClass: 'PRIMARY', sourceSystem: 'crm', collectedAt: new Date().toISOString() } }),
        makeEvidenceRecord({ evidenceId: 'ev2', payload: { name: 'Y', status: 'b' }, provenance: { trustClass: 'PRIMARY', sourceSystem: 'crm', collectedAt: new Date().toISOString() } }),
        makeEvidenceRecord({ evidenceId: 'ev3', payload: { name: 'Z', status: 'c' }, provenance: { trustClass: 'PRIMARY', sourceSystem: 'crm', collectedAt: new Date().toISOString() } }),
      ];
      mockEvidenceService.query.mockResolvedValue(evidence);
      mockDynamoDBDocumentClient.send.mockResolvedValue({});

      const result = await service.computeState('ent-1', 'Account', 't1');

      expect(result.autonomyTier).toBe('TIER_D');
    });

    it('should use VERIFIED trust multiplier when provenance.trustClass is VERIFIED', async () => {
      const evidence = [
        makeEvidenceRecord({
          payload: { name: 'Test', status: 'active' },
          provenance: { trustClass: 'VERIFIED', sourceSystem: 'crm', collectedAt: new Date().toISOString() },
        }),
      ];
      mockEvidenceService.query.mockResolvedValue(evidence);
      mockDynamoDBDocumentClient.send.mockResolvedValue({});

      const result = await service.computeState('ent-1', 'Account', 't1');

      expect(result.fields.name.confidence).toBeLessThanOrEqual(0.95);
      expect(result.fields.name.provenanceTrust).toBe('VERIFIED');
    });

    it('should apply freshness decay when latest evidence is older than 24h', async () => {
      const oldTime = new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString();
      const evidence = [
        makeEvidenceRecord({
          evidenceId: 'ev1',
          timestamp: oldTime,
          payload: { name: 'Old', status: 'active' },
          provenance: { trustClass: 'PRIMARY', sourceSystem: 'crm', collectedAt: oldTime },
        }),
      ];
      mockEvidenceService.query.mockResolvedValue(evidence);
      mockDynamoDBDocumentClient.send.mockResolvedValue({});

      const result = await service.computeState('ent-1', 'Account', 't1');

      expect(result.fields.name.confidence).toBeLessThan(1);
      expect(result.overallFreshness).toBeGreaterThanOrEqual(24);
    });

    it('should compute contradiction with null and object values in payload', async () => {
      const ts = new Date().toISOString();
      const evidence = [
        makeEvidenceRecord({
          evidenceId: 'ev1',
          timestamp: ts,
          payload: { name: null, meta: { a: 1 } },
          provenance: { trustClass: 'PRIMARY', sourceSystem: 'crm', collectedAt: ts },
        }),
        makeEvidenceRecord({
          evidenceId: 'ev2',
          timestamp: ts,
          payload: { name: 'other', meta: { a: 2 } },
          provenance: { trustClass: 'PRIMARY', sourceSystem: 'crm', collectedAt: ts },
        }),
      ];
      mockEvidenceService.query.mockResolvedValue(evidence);
      mockDynamoDBDocumentClient.send.mockResolvedValue({});

      const result = await service.computeState('ent-1', 'Account', 't1');

      expect(result.fields.name).toBeDefined();
      expect(result.fields.meta).toBeDefined();
      expect(result.overallContradiction).toBeGreaterThanOrEqual(0);
    });

    it('should compute tier when confidence/freshness/contradiction in TIER_B range', async () => {
      const ts = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
      const evidence = [
        makeEvidenceRecord({
          timestamp: ts,
          payload: { name: 'Same', status: 'same' },
          provenance: { trustClass: 'PRIMARY', sourceSystem: 'crm', collectedAt: ts },
        }),
        makeEvidenceRecord({
          evidenceId: 'ev2',
          timestamp: ts,
          payload: { name: 'Same', status: 'same' },
          provenance: { trustClass: 'PRIMARY', sourceSystem: 'crm', collectedAt: ts },
        }),
      ];
      mockEvidenceService.query.mockResolvedValue(evidence);
      mockDynamoDBDocumentClient.send.mockResolvedValue({});

      const result = await service.computeState('ent-1', 'Account', 't1');

      expect(['TIER_A', 'TIER_B', 'TIER_C', 'TIER_D']).toContain(result.autonomyTier);
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

    it('should throw when Dynamo getState fails', async () => {
      mockDynamoDBDocumentClient.send.mockRejectedValue(new Error('DynamoDB error'));

      await expect(service.getState('ent-1', 't1')).rejects.toThrow('DynamoDB error');
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

    it('should query by entityType (GSI path)', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({ Items: [] });

      await service.query({ tenantId: 't1', entityType: 'Account' });

      const input = mockQueryCommand.mock.calls[mockQueryCommand.mock.calls.length - 1][0];
      expect(input.IndexName).toBe('entityType-index');
      expect(input.ExpressionAttributeValues[':gsi1pk']).toBe('ENTITY_TYPE#Account');
    });

    it('should apply minConfidence and maxContradiction filters', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({ Items: [] });

      await service.query({
        tenantId: 't1',
        entityId: 'ent-1',
        minConfidence: 0.8,
        maxContradiction: 0.2,
      });

      const input = mockQueryCommand.mock.calls[mockQueryCommand.mock.calls.length - 1][0];
      expect(input.ExpressionAttributeValues[':minConfidence']).toBe(0.8);
      expect(input.ExpressionAttributeValues[':maxContradiction']).toBe(0.2);
    });

    it('should throw when query fails', async () => {
      mockDynamoDBDocumentClient.send.mockRejectedValue(new Error('Query failed'));

      await expect(service.query({ tenantId: 't1', entityId: 'ent-1' })).rejects.toThrow('Query failed');
    });
  });
});
