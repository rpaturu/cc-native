/**
 * Unit tests for UsageAnalyticsConnector - perception connector for usage analytics.
 */

import { UsageAnalyticsConnector } from '../../../../services/perception/connectors/UsageAnalyticsConnector';
import { EvidenceService } from '../../../../services/world-model/EvidenceService';
import { Logger } from '../../../../services/core/Logger';
import { SyncMode } from '../../../../services/perception/IConnector';

describe('UsageAnalyticsConnector', () => {
  const tenantId = 't1';
  let logger: Logger;
  let evidenceService: EvidenceService;

  beforeEach(() => {
    logger = new Logger('UsageAnalyticsConnectorTest');
    evidenceService = {
      store: jest.fn().mockResolvedValue({ evidenceId: 'ev1', s3Location: 'key' }),
      evidenceBucket: 'test-bucket',
    } as unknown as EvidenceService;
  });

  it('uses SyncMode.TIMESTAMP', () => {
    const connector = new UsageAnalyticsConnector({ logger, tenantId, evidenceService });
    expect(connector.getSyncMode()).toBe(SyncMode.TIMESTAMP);
  });

  it('connect sets connected and logs', async () => {
    const connector = new UsageAnalyticsConnector({ logger, tenantId, evidenceService });
    const infoSpy = jest.spyOn(logger, 'info').mockImplementation(() => {});
    await connector.connect();
    expect(infoSpy).toHaveBeenCalledWith('Connecting to usage analytics', {
      connector: 'UsageAnalyticsConnector',
    });
    await connector.connect();
    expect(infoSpy).toHaveBeenCalledTimes(1);
    infoSpy.mockRestore();
  });

  it('connect throws and logs on error', async () => {
    const connector = new UsageAnalyticsConnector({ logger, tenantId, evidenceService });
    const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});
    jest.spyOn(logger, 'info').mockImplementation(() => {
      throw new Error('Analytics connection failed');
    });
    await expect(connector.connect()).rejects.toThrow('Analytics connection failed');
    expect(errorSpy).toHaveBeenCalledWith('Failed to connect to usage analytics', {
      error: 'Analytics connection failed',
    });
    errorSpy.mockRestore();
  });

  it('poll returns empty snapshots', async () => {
    const connector = new UsageAnalyticsConnector({ logger, tenantId, evidenceService });
    const snapshots = await connector.poll();
    expect(snapshots).toEqual([]);
  });

  it('poll on error calls handleError and rethrows', async () => {
    const connector = new UsageAnalyticsConnector({ logger, tenantId, evidenceService });
    jest.spyOn(connector, 'getLastSyncTimestamp').mockRejectedValue(new Error('Store error'));
    const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});
    await expect(connector.poll()).rejects.toThrow('Store error');
    expect(errorSpy).toHaveBeenCalledWith('Connector error', expect.objectContaining({
      connector: 'UsageAnalyticsConnector',
      error: 'Store error',
      operation: 'poll',
    }));
    errorSpy.mockRestore();
  });

  it('disconnect sets connected to false and logs', async () => {
    const connector = new UsageAnalyticsConnector({ logger, tenantId, evidenceService });
    await connector.connect();
    const debugSpy = jest.spyOn(logger, 'debug').mockImplementation(() => {});
    await connector.disconnect();
    expect(debugSpy).toHaveBeenCalledWith('Disconnected from usage analytics');
    await connector.disconnect();
    expect(debugSpy).toHaveBeenCalledTimes(1);
    debugSpy.mockRestore();
  });
});
