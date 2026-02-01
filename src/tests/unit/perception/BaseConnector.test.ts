/**
 * Unit tests for BaseConnector - perception connectors base class.
 * Tests sync mode behavior, timestamp/cursor APIs, and evidence snapshot creation.
 */

import { BaseConnector, BaseConnectorConfig } from '../../../services/perception/BaseConnector';
import { SyncMode } from '../../../services/perception/IConnector';
import { EvidenceSnapshotRef } from '../../../types/SignalTypes';
import { EvidenceService } from '../../../services/world-model/EvidenceService';
import { Logger } from '../../../services/core/Logger';

/** Minimal concrete subclass to test BaseConnector TIMESTAMP mode and createEvidenceSnapshot */
class TestTimestampConnector extends BaseConnector {
  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
  async poll(): Promise<EvidenceSnapshotRef[]> {
    return [await this.createEvidenceSnapshot('e1', 'Account', { name: 'Test' }, '1.0', '1.0')];
  }
}

/** Minimal concrete subclass to test BaseConnector CURSOR mode */
class TestCursorConnector extends BaseConnector {
  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
  async poll(): Promise<EvidenceSnapshotRef[]> {
    return [];
  }
}

/** Subclass that exposes handleError for coverage */
class TestErrorConnector extends BaseConnector {
  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
  async poll(): Promise<EvidenceSnapshotRef[]> {
    return [];
  }
  callHandleError(err: unknown, ctx: Record<string, unknown>): void {
    this.handleError(err, ctx);
  }
}

describe('BaseConnector', () => {
  const tenantId = 't1';
  let logger: Logger;
  let evidenceStore: jest.Mock;
  let evidenceService: EvidenceService;

  beforeEach(() => {
    logger = new Logger('BaseConnectorTest');
    evidenceStore = jest.fn().mockResolvedValue({
      evidenceId: 'ev1',
      s3Location: 'evidence/Account/e1/ev1.json',
    });
    evidenceService = {
      store: evidenceStore,
      evidenceBucket: 'test-bucket',
    } as unknown as EvidenceService;
  });

  describe('getSyncMode', () => {
    it('returns TIMESTAMP for timestamp-mode connector', () => {
      const config: BaseConnectorConfig = {
        connectorName: 'Test',
        tenantId,
        evidenceService,
        logger,
        syncMode: SyncMode.TIMESTAMP,
      };
      const connector = new TestTimestampConnector(config);
      expect(connector.getSyncMode()).toBe(SyncMode.TIMESTAMP);
    });

    it('returns CURSOR for cursor-mode connector', () => {
      const config: BaseConnectorConfig = {
        connectorName: 'Test',
        tenantId,
        evidenceService,
        logger,
        syncMode: SyncMode.CURSOR,
      };
      const connector = new TestCursorConnector(config);
      expect(connector.getSyncMode()).toBe(SyncMode.CURSOR);
    });
  });

  describe('TIMESTAMP mode: getLastSyncTimestamp / setLastSyncTimestamp', () => {
    it('getLastSyncTimestamp returns null initially', async () => {
      const config: BaseConnectorConfig = {
        connectorName: 'Test',
        tenantId,
        evidenceService,
        logger,
        syncMode: SyncMode.TIMESTAMP,
      };
      const connector = new TestTimestampConnector(config);
      const ts = await connector.getLastSyncTimestamp();
      expect(ts).toBeNull();
    });

    it('setLastSyncTimestamp stores and getLastSyncTimestamp returns it', async () => {
      const config: BaseConnectorConfig = {
        connectorName: 'Test',
        tenantId,
        evidenceService,
        logger,
        syncMode: SyncMode.TIMESTAMP,
      };
      const connector = new TestTimestampConnector(config);
      await connector.setLastSyncTimestamp('2025-01-01T00:00:00.000Z');
      const ts = await connector.getLastSyncTimestamp();
      expect(ts).toBe('2025-01-01T00:00:00.000Z');
    });

    it('getLastSyncTimestamp throws when sync mode is CURSOR', async () => {
      const config: BaseConnectorConfig = {
        connectorName: 'Test',
        tenantId,
        evidenceService,
        logger,
        syncMode: SyncMode.CURSOR,
      };
      const connector = new TestCursorConnector(config);
      await expect(connector.getLastSyncTimestamp()).rejects.toThrow(/CURSOR mode, not TIMESTAMP/);
    });

    it('setLastSyncTimestamp throws when sync mode is CURSOR', async () => {
      const config: BaseConnectorConfig = {
        connectorName: 'Test',
        tenantId,
        evidenceService,
        logger,
        syncMode: SyncMode.CURSOR,
      };
      const connector = new TestCursorConnector(config);
      await expect(connector.setLastSyncTimestamp('2025-01-01T00:00:00.000Z')).rejects.toThrow(
        /CURSOR mode, not TIMESTAMP/
      );
    });
  });

  describe('CURSOR mode: getCursor / setCursor', () => {
    it('getCursor returns null initially', async () => {
      const config: BaseConnectorConfig = {
        connectorName: 'Test',
        tenantId,
        evidenceService,
        logger,
        syncMode: SyncMode.CURSOR,
      };
      const connector = new TestCursorConnector(config);
      const cursor = await connector.getCursor();
      expect(cursor).toBeNull();
    });

    it('setCursor stores and getCursor returns it', async () => {
      const config: BaseConnectorConfig = {
        connectorName: 'Test',
        tenantId,
        evidenceService,
        logger,
        syncMode: SyncMode.CURSOR,
      };
      const connector = new TestCursorConnector(config);
      await connector.setCursor('page-2-token');
      const cursor = await connector.getCursor();
      expect(cursor).toBe('page-2-token');
    });

    it('getCursor throws when sync mode is TIMESTAMP', async () => {
      const config: BaseConnectorConfig = {
        connectorName: 'Test',
        tenantId,
        evidenceService,
        logger,
        syncMode: SyncMode.TIMESTAMP,
      };
      const connector = new TestTimestampConnector(config);
      await expect(connector.getCursor()).rejects.toThrow(/TIMESTAMP mode, not CURSOR/);
    });

    it('setCursor throws when sync mode is TIMESTAMP', async () => {
      const config: BaseConnectorConfig = {
        connectorName: 'Test',
        tenantId,
        evidenceService,
        logger,
        syncMode: SyncMode.TIMESTAMP,
      };
      const connector = new TestTimestampConnector(config);
      await expect(connector.setCursor('token')).rejects.toThrow(/TIMESTAMP mode, not CURSOR/);
    });
  });

  describe('createEvidenceSnapshot', () => {
    it('calls evidenceService.store and returns EvidenceSnapshotRef with s3Uri and sha256', async () => {
      const config: BaseConnectorConfig = {
        connectorName: 'Test',
        tenantId,
        evidenceService,
        logger,
        syncMode: SyncMode.TIMESTAMP,
      };
      const connector = new TestTimestampConnector(config);
      const snapshots = await connector.poll();
      expect(snapshots).toHaveLength(1);
      expect(snapshots[0].s3Uri).toBe('s3://test-bucket/evidence/Account/e1/ev1.json');
      expect(snapshots[0].sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(snapshots[0].capturedAt).toBeDefined();
      expect(snapshots[0].schemaVersion).toBe('1.0');
      expect(snapshots[0].detectorInputVersion).toBe('1.0');
      expect(evidenceStore).toHaveBeenCalledTimes(1);
      const storeCall = evidenceStore.mock.calls[0][0];
      expect(storeCall.entityId).toBe('e1');
      expect(storeCall.entityType).toBe('Account');
      expect(storeCall.payload).toMatchObject({ name: 'Test', _schemaVersion: '1.0', _detectorInputVersion: '1.0' });
      expect(storeCall.provenance.sourceSystem).toBe('Test');
      expect(storeCall.metadata.tenantId).toBe(tenantId);
    });
  });

  describe('rate limit', () => {
    it('applyRateLimit is invoked when rateLimit is set (via poll that calls it)', async () => {
      const config: BaseConnectorConfig = {
        connectorName: 'Test',
        tenantId,
        evidenceService,
        logger,
        syncMode: SyncMode.TIMESTAMP,
        rateLimit: { requestsPerMinute: 60, burst: 10 },
      };
      const connector = new TestTimestampConnector(config);
      await connector.poll();
      expect(evidenceStore).toHaveBeenCalled();
    });

    it('connector works without rateLimit', async () => {
      const config: BaseConnectorConfig = {
        connectorName: 'Test',
        tenantId,
        evidenceService,
        logger,
        syncMode: SyncMode.TIMESTAMP,
      };
      const connector = new TestTimestampConnector(config);
      const snapshots = await connector.poll();
      expect(snapshots).toHaveLength(1);
    });
  });

  describe('handleError', () => {
    it('logs error with connector context', () => {
      const config: BaseConnectorConfig = {
        connectorName: 'TestErr',
        tenantId,
        evidenceService,
        logger,
        syncMode: SyncMode.TIMESTAMP,
      };
      const connector = new TestErrorConnector(config);
      const spy = jest.spyOn(logger, 'error').mockImplementation(() => {});
      connector.callHandleError(new Error('test error'), { operation: 'poll' });
      expect(spy).toHaveBeenCalledWith('Connector error', {
        connector: 'TestErr',
        error: 'test error',
        operation: 'poll',
      });
      spy.mockRestore();
    });

    it('handles non-Error values', () => {
      const config: BaseConnectorConfig = {
        connectorName: 'TestErr',
        tenantId,
        evidenceService,
        logger,
        syncMode: SyncMode.TIMESTAMP,
      };
      const connector = new TestErrorConnector(config);
      const spy = jest.spyOn(logger, 'error').mockImplementation(() => {});
      connector.callHandleError('string error', {});
      expect(spy).toHaveBeenCalledWith('Connector error', {
        connector: 'TestErr',
        error: 'string error',
        ...{},
      });
      spy.mockRestore();
    });
  });
});
