/**
 * EngagementDetector unit tests
 */

import { Logger } from '../../../../services/core/Logger';
import { EngagementDetector } from '../../../../services/perception/detectors/EngagementDetector';
import { SignalType } from '../../../../types/SignalTypes';
import { createEvidenceSnapshotRef, createMockS3Client } from './detector-test-helpers';

describe('EngagementDetector', () => {
  const logger = new Logger('EngagementDetectorTest');

  it('should return empty when accountId or tenantId missing', async () => {
    const evidence = { entityId: 'acc1' };
    const s3 = createMockS3Client(evidence);
    const ref = createEvidenceSnapshotRef(evidence);
    const detector = new EngagementDetector(logger, s3 as any);

    const signals = await detector.detect(ref);

    expect(signals).toHaveLength(0);
  });

  it('should emit FIRST_ENGAGEMENT_OCCURRED when has engagement and no priorState.lastEngagementAt', async () => {
    const evidence = {
      accountId: 'acc1',
      metadata: { tenantId: 't1', traceId: 'trace1' },
      payload: { meetings: [{}], firstEngagement: true },
    };
    const s3 = createMockS3Client(evidence);
    const ref = createEvidenceSnapshotRef(evidence);
    const detector = new EngagementDetector(logger, s3 as any);

    const signals = await detector.detect(ref);

    expect(signals).toHaveLength(1);
    expect(signals[0].signalType).toBe(SignalType.FIRST_ENGAGEMENT_OCCURRED);
    expect(signals[0].accountId).toBe('acc1');
  });

  it('should return empty when priorState has lastEngagementAt', async () => {
    const evidence = {
      accountId: 'acc1',
      metadata: { tenantId: 't1', traceId: 'trace1' },
      payload: { meetings: [{}] },
    };
    const s3 = createMockS3Client(evidence);
    const ref = createEvidenceSnapshotRef(evidence);
    const detector = new EngagementDetector(logger, s3 as any);

    const signals = await detector.detect(ref, { lastEngagementAt: new Date().toISOString() } as any);

    expect(signals).toHaveLength(0);
  });
});
