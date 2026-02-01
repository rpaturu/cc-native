/**
 * Unit tests for CRMConnector - perception connector for CRM (e.g. Salesforce).
 */

import { CRMConnector } from '../../../../services/perception/connectors/CRMConnector';
import { EvidenceService } from '../../../../services/world-model/EvidenceService';
import { Logger } from '../../../../services/core/Logger';
import { SyncMode } from '../../../../services/perception/IConnector';

describe('CRMConnector', () => {
  const tenantId = 't1';
  let logger: Logger;
  let evidenceStore: jest.Mock;
  let evidenceService: EvidenceService;

  beforeEach(() => {
    logger = new Logger('CRMConnectorTest');
    evidenceStore = jest.fn().mockResolvedValue({
      evidenceId: 'ev1',
      s3Location: 'evidence/Account/a1/ev1.json',
    });
    evidenceService = {
      store: evidenceStore,
      evidenceBucket: 'test-bucket',
    } as unknown as EvidenceService;
  });

  it('extends BaseConnector with SyncMode.TIMESTAMP', () => {
    const connector = new CRMConnector({
      logger,
      tenantId,
      evidenceService,
    });
    expect(connector.getSyncMode()).toBe(SyncMode.TIMESTAMP);
  });

  it('connect sets connected and logs', async () => {
    const connector = new CRMConnector({ logger, tenantId, evidenceService });
    const infoSpy = jest.spyOn(logger, 'info').mockImplementation(() => {});
    await connector.connect();
    expect(infoSpy).toHaveBeenCalledWith('Connecting to CRM system', {
      connector: 'CRMConnector',
      endpoint: undefined,
    });
    await connector.connect();
    expect(infoSpy).toHaveBeenCalledTimes(1);
    infoSpy.mockRestore();
  });

  it('connect throws and logs on error', async () => {
    const connector = new CRMConnector({ logger, tenantId, evidenceService });
    const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});
    (connector as any).connected = false;
    jest.spyOn(logger, 'info').mockImplementation(() => {
      throw new Error('Connection failed');
    });
    await expect(connector.connect()).rejects.toThrow('Connection failed');
    expect(errorSpy).toHaveBeenCalledWith('Failed to connect to CRM', {
      error: 'Connection failed',
    });
    errorSpy.mockRestore();
  });

  it('poll connects if not connected then returns snapshots', async () => {
    const connector = new CRMConnector({ logger, tenantId, evidenceService });
    const debugSpy = jest.spyOn(logger, 'debug').mockImplementation(() => {});
    const snapshots = await connector.poll();
    expect(snapshots).toEqual([]);
    expect(debugSpy).toHaveBeenCalledWith('CRM poll completed', {
      snapshotsCount: 0,
      lastSync: null,
    });
    debugSpy.mockRestore();
  });

  it('poll on error calls handleError and rethrows', async () => {
    const connector = new CRMConnector({ logger, tenantId, evidenceService });
    jest.spyOn(connector, 'getLastSyncTimestamp').mockRejectedValue(new Error('Dynamo error'));
    const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});
    await expect(connector.poll()).rejects.toThrow('Dynamo error');
    expect(errorSpy).toHaveBeenCalledWith('Connector error', expect.objectContaining({
      connector: 'CRMConnector',
      error: 'Dynamo error',
      operation: 'poll',
    }));
    errorSpy.mockRestore();
  });

  it('disconnect sets connected to false and logs', async () => {
    const connector = new CRMConnector({ logger, tenantId, evidenceService });
    await connector.connect();
    const debugSpy = jest.spyOn(logger, 'debug').mockImplementation(() => {});
    await connector.disconnect();
    expect(debugSpy).toHaveBeenCalledWith('Disconnected from CRM');
    await connector.disconnect();
    expect(debugSpy).toHaveBeenCalledTimes(1);
    debugSpy.mockRestore();
  });

  it('disconnect on error calls handleError and rethrows', async () => {
    const connector = new CRMConnector({ logger, tenantId, evidenceService });
    await connector.connect();
    const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});
    jest.spyOn(logger, 'debug').mockImplementation(() => {
      throw new Error('Disconnect failed');
    });
    await expect(connector.disconnect()).rejects.toThrow('Disconnect failed');
    expect(errorSpy).toHaveBeenCalledWith('Connector error', expect.objectContaining({
      connector: 'CRMConnector',
      error: 'Disconnect failed',
      operation: 'disconnect',
    }));
    errorSpy.mockRestore();
  });
});
