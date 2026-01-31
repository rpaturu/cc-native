/**
 * RenewalWindowDetector unit tests
 */

import { Logger } from '../../../../services/core/Logger';
import { RenewalWindowDetector } from '../../../../services/perception/detectors/RenewalWindowDetector';
import { SignalType } from '../../../../types/SignalTypes';
import { createEvidenceSnapshotRef, createMockS3Client } from './detector-test-helpers';

describe('RenewalWindowDetector', () => {
  const logger = new Logger('RenewalWindowDetectorTest');

  it('should return empty when accountId or tenantId missing', async () => {
    const evidence = { entityId: 'acc1' };
    const s3 = createMockS3Client(evidence);
    const ref = createEvidenceSnapshotRef(evidence);
    const detector = new RenewalWindowDetector(logger, s3 as any);

    const signals = await detector.detect(ref);

    expect(signals).toHaveLength(0);
  });

  it('should emit RENEWAL_WINDOW_ENTERED when contract within renewal window', async () => {
    const now = new Date();
    const renewalDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const evidence = {
      accountId: 'acc1',
      metadata: { tenantId: 't1', traceId: 'trace1' },
      payload: {
        contracts: [{ renewalDate: renewalDate.toISOString(), contractId: 'c1' }],
      },
    };
    const s3 = createMockS3Client(evidence);
    const ref = createEvidenceSnapshotRef(evidence);
    ref.capturedAt = now.toISOString();
    const detector = new RenewalWindowDetector(logger, s3 as any, 90);

    const signals = await detector.detect(ref);

    expect(signals.length).toBeGreaterThanOrEqual(1);
    expect(signals[0].signalType).toBe(SignalType.RENEWAL_WINDOW_ENTERED);
    expect(signals[0].accountId).toBe('acc1');
  });

  it('should return empty when no contracts or renewal date', async () => {
    const evidence = {
      accountId: 'acc1',
      metadata: { tenantId: 't1', traceId: 'trace1' },
      payload: { contracts: [] },
    };
    const s3 = createMockS3Client(evidence);
    const ref = createEvidenceSnapshotRef(evidence);
    const detector = new RenewalWindowDetector(logger, s3 as any);

    const signals = await detector.detect(ref);

    expect(signals).toHaveLength(0);
  });
});
