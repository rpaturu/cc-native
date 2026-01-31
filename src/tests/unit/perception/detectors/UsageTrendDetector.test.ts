/**
 * UsageTrendDetector unit tests
 */

import { Logger } from '../../../../services/core/Logger';
import { UsageTrendDetector } from '../../../../services/perception/detectors/UsageTrendDetector';
import { SignalType } from '../../../../types/SignalTypes';
import { createEvidenceSnapshotRef, createMockS3Client } from './detector-test-helpers';

describe('UsageTrendDetector', () => {
  const logger = new Logger('UsageTrendDetectorTest');

  it('should return empty when accountId or tenantId missing', async () => {
    const evidence = { entityId: 'acc1' };
    const s3 = createMockS3Client(evidence);
    const ref = createEvidenceSnapshotRef(evidence);
    const detector = new UsageTrendDetector(logger, s3 as any);

    const signals = await detector.detect(ref);

    expect(signals).toHaveLength(0);
  });

  it('should return empty when no usage metrics', async () => {
    const evidence = {
      accountId: 'acc1',
      metadata: { tenantId: 't1', traceId: 'trace1' },
      payload: {},
    };
    const s3 = createMockS3Client(evidence);
    const ref = createEvidenceSnapshotRef(evidence);
    const detector = new UsageTrendDetector(logger, s3 as any);

    const signals = await detector.detect(ref);

    expect(signals).toHaveLength(0);
  });

  it('should emit USAGE_TREND_CHANGE when significant change', async () => {
    const evidence = {
      accountId: 'acc1',
      metadata: { tenantId: 't1', traceId: 'trace1' },
      payload: {
        usageMetrics: { logins: 100, apiCalls: 500 },
        previousUsageMetrics: { logins: 10, apiCalls: 50 },
        trendWindow: 7,
      },
    };
    const s3 = createMockS3Client(evidence);
    const ref = createEvidenceSnapshotRef(evidence);
    const detector = new UsageTrendDetector(logger, s3 as any);

    const signals = await detector.detect(ref);

    expect(signals.length).toBeGreaterThanOrEqual(1);
    expect(signals[0].signalType).toBe(SignalType.USAGE_TREND_CHANGE);
    expect(signals[0].accountId).toBe('acc1');
  });
});
