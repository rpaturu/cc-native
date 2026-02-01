/**
 * Unit tests for SupportConnector - perception connector for support/ticketing.
 */

import { SupportConnector } from '../../../../services/perception/connectors/SupportConnector';
import { EvidenceService } from '../../../../services/world-model/EvidenceService';
import { Logger } from '../../../../services/core/Logger';
import { SyncMode } from '../../../../services/perception/IConnector';

describe('SupportConnector', () => {
  const tenantId = 't1';
  let logger: Logger;
  let evidenceService: EvidenceService;

  beforeEach(() => {
    logger = new Logger('SupportConnectorTest');
    evidenceService = {
      store: jest.fn().mockResolvedValue({ evidenceId: 'ev1', s3Location: 'key' }),
      evidenceBucket: 'test-bucket',
    } as unknown as EvidenceService;
  });

  it('defaults to SyncMode.CURSOR', () => {
    const connector = new SupportConnector({ logger, tenantId, evidenceService });
    expect(connector.getSyncMode()).toBe(SyncMode.CURSOR);
  });

  it('accepts syncMode TIMESTAMP', () => {
    const connector = new SupportConnector({
      logger,
      tenantId,
      evidenceService,
      syncMode: SyncMode.TIMESTAMP,
    });
    expect(connector.getSyncMode()).toBe(SyncMode.TIMESTAMP);
  });

  it('connect sets connected and logs', async () => {
    const connector = new SupportConnector({ logger, tenantId, evidenceService });
    const infoSpy = jest.spyOn(logger, 'info').mockImplementation(() => {});
    await connector.connect();
    expect(infoSpy).toHaveBeenCalledWith('Connecting to support system', {
      connector: 'SupportConnector',
      syncMode: SyncMode.CURSOR,
    });
    await connector.connect();
    expect(infoSpy).toHaveBeenCalledTimes(1);
    infoSpy.mockRestore();
  });

  it('connect throws and logs on error', async () => {
    const connector = new SupportConnector({ logger, tenantId, evidenceService });
    const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});
    jest.spyOn(logger, 'info').mockImplementation(() => {
      throw new Error('Support connection failed');
    });
    await expect(connector.connect()).rejects.toThrow('Support connection failed');
    expect(errorSpy).toHaveBeenCalledWith('Failed to connect to support system', {
      error: 'Support connection failed',
    });
    errorSpy.mockRestore();
  });

  it('poll returns empty snapshots and does not throw', async () => {
    const connector = new SupportConnector({ logger, tenantId, evidenceService });
    const snapshots = await connector.poll();
    expect(snapshots).toEqual([]);
  });

  it('poll with CURSOR mode calls getCursor', async () => {
    const connector = new SupportConnector({ logger, tenantId, evidenceService });
    const getCursorSpy = jest.spyOn(connector, 'getCursor');
    await connector.poll();
    expect(getCursorSpy).toHaveBeenCalledTimes(1);
    getCursorSpy.mockRestore();
  });

  it('poll with TIMESTAMP mode calls getLastSyncTimestamp', async () => {
    const connector = new SupportConnector({
      logger,
      tenantId,
      evidenceService,
      syncMode: SyncMode.TIMESTAMP,
    });
    const getLastSyncSpy = jest.spyOn(connector, 'getLastSyncTimestamp');
    await connector.poll();
    expect(getLastSyncSpy).toHaveBeenCalledTimes(1);
    getLastSyncSpy.mockRestore();
  });

  it('poll on error calls handleError and rethrows', async () => {
    const connector = new SupportConnector({ logger, tenantId, evidenceService });
    jest.spyOn(connector, 'getCursor').mockRejectedValue(new Error('Cursor error'));
    const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});
    await expect(connector.poll()).rejects.toThrow('Cursor error');
    expect(errorSpy).toHaveBeenCalledWith('Connector error', expect.objectContaining({
      connector: 'SupportConnector',
      error: 'Cursor error',
      operation: 'poll',
    }));
    errorSpy.mockRestore();
  });

  it('disconnect sets connected to false and logs', async () => {
    const connector = new SupportConnector({ logger, tenantId, evidenceService });
    await connector.connect();
    const debugSpy = jest.spyOn(logger, 'debug').mockImplementation(() => {});
    await connector.disconnect();
    expect(debugSpy).toHaveBeenCalledWith('Disconnected from support system');
    await connector.disconnect();
    expect(debugSpy).toHaveBeenCalledTimes(1);
    debugSpy.mockRestore();
  });
});
