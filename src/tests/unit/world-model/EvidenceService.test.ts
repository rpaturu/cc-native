/**
 * EvidenceService Unit Tests - Phase 0 World Model
 */

import { mockDynamoDBDocumentClient, mockS3Client, resetAllMocks } from '../../__mocks__/aws-sdk-clients';

jest.mock('../../../utils/aws-client-config', () => ({
  getAWSClientConfig: jest.fn(() => ({})),
}));
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => mockS3Client),
  PutObjectCommand: jest.fn(),
  GetObjectCommand: jest.fn(),
}));
jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(),
}));
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn(() => mockDynamoDBDocumentClient) },
  PutCommand: jest.fn(),
  QueryCommand: jest.fn(),
}));

import { EvidenceService } from '../../../services/world-model/EvidenceService';
import { Logger } from '../../../services/core/Logger';
import { EvidenceType } from '../../../types/EvidenceTypes';

describe('EvidenceService', () => {
  let service: EvidenceService;
  let logger: Logger;

  beforeEach(() => {
    resetAllMocks();
    logger = new Logger('EvidenceServiceTest');
    service = new EvidenceService(logger, 'test-bucket', 'test-index-table', 'us-west-2');
  });

  describe('store', () => {
    it('should store evidence and return record with evidenceId and s3Location', async () => {
      mockS3Client.send
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ VersionId: 'v1' });
      mockDynamoDBDocumentClient.send.mockResolvedValue({});

      const input = {
        entityId: 'ent-1',
        entityType: 'ACCOUNT',
        evidenceType: EvidenceType.CRM,
        payload: { name: 'Test' },
        provenance: {
          trustClass: 'PRIMARY' as const,
          sourceSystem: 'crm',
          collectedAt: new Date().toISOString(),
        },
        metadata: { tenantId: 't1', traceId: 'trace-1' },
      };

      const result = await service.store(input);

      expect(result.evidenceId).toBeDefined();
      expect(result.evidenceId).toMatch(/^evt_/);
      expect(result.s3Location).toContain('evidence/ACCOUNT/ent-1/');
      expect(result.entityId).toBe('ent-1');
      expect(result.entityType).toBe('ACCOUNT');
      expect(result.timestamp).toBeDefined();
      expect(mockS3Client.send).toHaveBeenCalledTimes(2);
      expect(mockDynamoDBDocumentClient.send).toHaveBeenCalledTimes(1);
    });

    it('should throw on S3 failure', async () => {
      mockS3Client.send.mockRejectedValue(new Error('S3 error'));

      await expect(
        service.store({
          entityId: 'ent-1',
          entityType: 'ACCOUNT',
          evidenceType: EvidenceType.CRM,
          payload: {},
          provenance: { trustClass: 'PRIMARY', sourceSystem: 'crm', collectedAt: new Date().toISOString() },
          metadata: { tenantId: 't1', traceId: 'trace-1' },
        })
      ).rejects.toThrow('S3 error');
    });
  });

  describe('get', () => {
    it('should return null when entityId is missing', async () => {
      const result = await service.get('ev-1', 't1', undefined);
      expect(result).toBeNull();
      expect(mockDynamoDBDocumentClient.send).not.toHaveBeenCalled();
    });
  });

  describe('query', () => {
    it('should return empty array when no items', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({ Items: [] });

      const result = await service.query({ tenantId: 't1', entityId: 'ent-1' });
      expect(result).toEqual([]);
      expect(mockDynamoDBDocumentClient.send).toHaveBeenCalledTimes(1);
    });

    it('should throw when neither entityId nor entityType provided', async () => {
      await expect(service.query({ tenantId: 't1' })).rejects.toThrow(
        'Either entityId or entityType must be provided'
      );
    });

    it('should return evidence records when query by entityId and S3 returns body', async () => {
      const indexItem = { s3Key: 'evidence/ACCOUNT/ent-1/ev1.json', s3VersionId: 'v1' };
      mockDynamoDBDocumentClient.send.mockResolvedValue({ Items: [indexItem] });
      mockS3Client.send.mockResolvedValue({
        Body: { transformToString: () => Promise.resolve(JSON.stringify({
          evidenceId: 'ev1',
          entityId: 'ent-1',
          entityType: 'ACCOUNT',
          evidenceType: 'CRM',
          timestamp: '2026-01-01T00:00:00Z',
          payload: {},
          provenance: { trustClass: 'PRIMARY', sourceSystem: 'crm', collectedAt: '2026-01-01T00:00:00Z' },
          metadata: { tenantId: 't1', traceId: 'trace-1' },
          s3Location: 'evidence/ACCOUNT/ent-1/ev1.json',
        })) },
      });

      const result = await service.query({ tenantId: 't1', entityId: 'ent-1' });
      expect(result).toHaveLength(1);
      expect(result[0].evidenceId).toBe('ev1');
      expect(result[0].entityId).toBe('ent-1');
    });
  });
});
