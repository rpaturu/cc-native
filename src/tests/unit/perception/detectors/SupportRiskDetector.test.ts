/**
 * SupportRiskDetector unit tests
 */

import { Logger } from '../../../../services/core/Logger';
import { SupportRiskDetector } from '../../../../services/perception/detectors/SupportRiskDetector';
import { SignalType } from '../../../../types/SignalTypes';
import { createEvidenceSnapshotRef, createMockS3Client } from './detector-test-helpers';

describe('SupportRiskDetector', () => {
  const logger = new Logger('SupportRiskDetectorTest');

  it('should return empty when accountId or tenantId missing', async () => {
    const evidence = { entityId: 'acc1' };
    const s3 = createMockS3Client(evidence);
    const ref = createEvidenceSnapshotRef(evidence);
    const detector = new SupportRiskDetector(logger, s3 as any);

    const signals = await detector.detect(ref);

    expect(signals).toHaveLength(0);
  });

  it('should emit SUPPORT_RISK_EMERGING when risk score exceeds threshold', async () => {
    const pastDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    const evidence = {
      accountId: 'acc1',
      metadata: { tenantId: 't1', traceId: 'trace1' },
      payload: {
        tickets: [
          { severity: 'critical', createdAt: pastDate },
          { severity: 'high', createdAt: pastDate },
        ],
      },
    };
    const s3 = createMockS3Client(evidence);
    const ref = createEvidenceSnapshotRef(evidence);
    const detector = new SupportRiskDetector(logger, s3 as any);

    const signals = await detector.detect(ref);

    expect(signals.length).toBeGreaterThanOrEqual(1);
    expect(signals[0].signalType).toBe(SignalType.SUPPORT_RISK_EMERGING);
    expect(signals[0].accountId).toBe('acc1');
  });

  it('should return empty when no tickets', async () => {
    const evidence = {
      accountId: 'acc1',
      metadata: { tenantId: 't1', traceId: 'trace1' },
      payload: { tickets: [] },
    };
    const s3 = createMockS3Client(evidence);
    const ref = createEvidenceSnapshotRef(evidence);
    const detector = new SupportRiskDetector(logger, s3 as any);

    const signals = await detector.detect(ref);

    expect(signals).toHaveLength(0);
  });
});
