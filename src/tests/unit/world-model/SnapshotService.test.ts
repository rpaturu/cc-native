/**
 * SnapshotService Unit Tests - Phase 0 World Model
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

import { SnapshotService } from '../../../services/world-model/SnapshotService';
import { Logger } from '../../../services/core/Logger';
import { EntityState } from '../../../types/WorldStateTypes';

describe('SnapshotService', () => {
  let service: SnapshotService;
  let logger: Logger;
  let mockWorldStateService: { getState: jest.Mock };

  const sampleState: EntityState = {
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

  beforeEach(() => {
    resetAllMocks();
    logger = new Logger('SnapshotServiceTest');
    mockWorldStateService = { getState: jest.fn() };
    service = new SnapshotService(
      logger,
      mockWorldStateService as any,
      'test-snapshots-bucket',
      'test-snapshots-index',
      'us-west-2'
    );
  });

  describe('createSnapshot', () => {
    it('should create snapshot when state is provided', async () => {
      mockS3Client.send
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ VersionId: 'v1' });
      mockDynamoDBDocumentClient.send.mockResolvedValue({});

      const result = await service.createSnapshot(
        'ent-1',
        'Account',
        't1',
        sampleState,
        'Test reason'
      );

      expect(result.snapshotId).toBeDefined();
      expect(result.snapshotId).toMatch(/^snap_/);
      expect(result.metadata.entityId).toBe('ent-1');
      expect(result.metadata.reason).toBe('Test reason');
      expect(result.state).toEqual(sampleState);
      expect(mockWorldStateService.getState).not.toHaveBeenCalled();
      expect(mockS3Client.send).toHaveBeenCalledTimes(2);
      expect(mockDynamoDBDocumentClient.send).toHaveBeenCalledTimes(1);
    });

    it('should fetch state when not provided', async () => {
      mockWorldStateService.getState.mockResolvedValue(sampleState);
      mockS3Client.send
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ VersionId: 'v1' });
      mockDynamoDBDocumentClient.send.mockResolvedValue({});

      const result = await service.createSnapshot('ent-1', 'Account', 't1');

      expect(result.state).toEqual(sampleState);
      expect(mockWorldStateService.getState).toHaveBeenCalledWith('ent-1', 't1');
    });

    it('should throw when state does not match entity', async () => {
      const wrongState = { ...sampleState, entityId: 'other' };
      mockS3Client.send.mockResolvedValue({});

      await expect(
        service.createSnapshot('ent-1', 'Account', 't1', wrongState)
      ).rejects.toThrow('State does not match entity');
    });

    it('should throw when no state found and not provided', async () => {
      mockWorldStateService.getState.mockResolvedValue(null);

      await expect(service.createSnapshot('ent-1', 'Account', 't1')).rejects.toThrow(
        'No state found for entity ent-1'
      );
    });
  });

  describe('getSnapshot', () => {
    it('should throw (getSnapshot requires entityId)', async () => {
      await expect(service.getSnapshot('snap-1', 't1')).rejects.toThrow(
        'getSnapshot requires entityId'
      );
    });
  });

  describe('getSnapshotByTimestamp', () => {
    const worldSnapshot = {
      snapshotId: 'snap-1',
      metadata: {
        snapshotId: 'snap-1',
        entityId: 'ent-1',
        entityType: 'Account',
        tenantId: 't1',
        version: '1.0',
        createdAt: '2025-01-01T00:00:00Z',
        asOf: '2025-01-01T00:00:00Z',
        createdBy: 'world-model-snapshot-service',
        reason: 'Manual',
        bindingRequired: true,
      },
      state: sampleState,
      s3Location: 'snapshots/Account/ent-1/snap-1.json',
      s3VersionId: 'v1',
      schemaHash: '',
    };

    it('should return parsed WorldSnapshot when Dynamo returns one item and S3 returns body', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({
        Items: [
          {
            s3Key: 'snapshots/Account/ent-1/snap-1.json',
            s3VersionId: 'v1',
          },
        ],
      });
      mockS3Client.send.mockResolvedValue({
        Body: {
          transformToString: jest.fn().mockResolvedValue(JSON.stringify(worldSnapshot)),
        },
      });

      const result = await service.getSnapshotByTimestamp('ent-1', 't1', '2025-01-01T00:00:00Z');

      expect(result).not.toBeNull();
      expect(result!.snapshotId).toBe('snap-1');
      expect(result!.metadata.entityId).toBe('ent-1');
      expect(result!.state).toEqual(sampleState);
      expect(mockDynamoDBDocumentClient.send).toHaveBeenCalled();
      expect(mockS3Client.send).toHaveBeenCalled();
    });

    it('should return null when Dynamo query returns empty', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({ Items: [] });

      const result = await service.getSnapshotByTimestamp('ent-1', 't1', '2025-01-01T00:00:00Z');

      expect(result).toBeNull();
      expect(mockS3Client.send).not.toHaveBeenCalled();
    });

    it('should throw when S3 GetObject throws', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({
        Items: [{ s3Key: 'snapshots/Account/ent-1/snap-1.json', s3VersionId: 'v1' }],
      });
      mockS3Client.send.mockRejectedValue(new Error('S3 get failed'));

      await expect(
        service.getSnapshotByTimestamp('ent-1', 't1', '2025-01-01T00:00:00Z')
      ).rejects.toThrow('S3 get failed');
    });
  });

  describe('query', () => {
    const worldSnapshot = {
      snapshotId: 'snap-1',
      metadata: {
        snapshotId: 'snap-1',
        entityId: 'ent-1',
        entityType: 'Account',
        tenantId: 't1',
        version: '1.0',
        createdAt: '2025-01-01T00:00:00Z',
        asOf: '2025-01-01T00:00:00Z',
        bindingRequired: true,
      },
      state: sampleState,
      s3Location: 'snapshots/Account/ent-1/snap-1.json',
      schemaHash: '',
    };

    it('should throw when neither entityId nor entityType provided', async () => {
      await expect(
        service.query({ tenantId: 't1' })
      ).rejects.toThrow('Either entityId or entityType must be provided');
    });

    it('should return [] when Dynamo returns empty Items', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({ Items: [] });

      const result = await service.query({ tenantId: 't1', entityId: 'ent-1' });

      expect(result).toEqual([]);
      expect(mockS3Client.send).not.toHaveBeenCalled();
    });

    it('should return list of snapshots for entityId path', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({
        Items: [
          { s3Key: 'snapshots/Account/ent-1/snap-1.json', s3VersionId: undefined },
        ],
      });
      mockS3Client.send.mockResolvedValue({
        Body: {
          transformToString: jest.fn().mockResolvedValue(JSON.stringify(worldSnapshot)),
        },
      });

      const result = await service.query({ tenantId: 't1', entityId: 'ent-1' });

      expect(result).toHaveLength(1);
      expect(result[0].snapshotId).toBe('snap-1');
      expect(mockS3Client.send).toHaveBeenCalledTimes(1);
    });

    it('should use entityType path (GSI) when entityType provided', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({ Items: [] });

      const result = await service.query({ tenantId: 't1', entityType: 'Account' });

      expect(result).toEqual([]);
      expect(mockDynamoDBDocumentClient.send).toHaveBeenCalledTimes(1);
    });

    it('should skip snapshot and return others when one S3 get fails', async () => {
      const worldSnapshot2 = { ...worldSnapshot, snapshotId: 'snap-2' };
      mockDynamoDBDocumentClient.send.mockResolvedValue({
        Items: [
          { s3Key: 'snapshots/Account/ent-1/snap-1.json' },
          { s3Key: 'snapshots/Account/ent-1/snap-2.json' },
        ],
      });
      mockS3Client.send
        .mockRejectedValueOnce(new Error('S3 get failed'))
        .mockResolvedValueOnce({
          Body: {
            transformToString: jest.fn().mockResolvedValue(JSON.stringify(worldSnapshot2)),
          },
        });

      const result = await service.query({ tenantId: 't1', entityId: 'ent-1' });

      expect(result).toHaveLength(1);
      expect(result[0].snapshotId).toBe('snap-2');
      expect(mockS3Client.send).toHaveBeenCalledTimes(2);
    });
  });
});
