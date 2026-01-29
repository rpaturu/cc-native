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
});
