/**
 * DiscoveryStallDetector unit tests
 */

import { Logger } from '../../../../services/core/Logger';
import { DiscoveryStallDetector } from '../../../../services/perception/detectors/DiscoveryStallDetector';
import { SignalType } from '../../../../types/SignalTypes';
import { createEvidenceSnapshotRef, createMockS3Client } from './detector-test-helpers';

describe('DiscoveryStallDetector', () => {
  const logger = new Logger('DiscoveryStallDetectorTest');

  it('should return empty when accountId or tenantId missing', async () => {
    const evidence = { entityId: 'acc1' };
    const s3 = createMockS3Client(evidence);
    const ref = createEvidenceSnapshotRef(evidence);
    const detector = new DiscoveryStallDetector(logger, s3 as any);

    const signals = await detector.detect(ref);

    expect(signals).toHaveLength(0);
  });

  it('should return empty when no stall indicators', async () => {
    const evidence = {
      entityId: 'acc1',
      tenantId: 't1',
      metadata: { tenantId: 't1', traceId: 'trace1' },
      payload: {
        meetings: [{ notes: 'Full notes' }],
        discoveryData: { painPoints: 'x', budget: 'y', decisionMaker: 'z', timeline: 'w' },
        completedFollowUps: [1],
        expectedFollowUps: [1],
      },
    };
    const s3 = createMockS3Client(evidence);
    const ref = createEvidenceSnapshotRef(evidence);
    const detector = new DiscoveryStallDetector(logger, s3 as any);

    const signals = await detector.detect(ref);

    expect(signals).toHaveLength(0);
  });

  it('should emit DISCOVERY_PROGRESS_STALLED when stall indicators >= 2', async () => {
    const evidence = {
      accountId: 'acc1',
      metadata: { tenantId: 't1', traceId: 'trace1' },
      payload: {
        meetings: [{ notes: '' }, { notes: '' }],
        discoveryData: {},
        expectedFollowUps: [1, 2],
        completedFollowUps: [],
      },
    };
    const s3 = createMockS3Client(evidence);
    const ref = createEvidenceSnapshotRef(evidence);
    const detector = new DiscoveryStallDetector(logger, s3 as any);

    const signals = await detector.detect(ref);

    expect(signals).toHaveLength(1);
    expect(signals[0].signalType).toBe(SignalType.DISCOVERY_PROGRESS_STALLED);
    expect(signals[0].accountId).toBe('acc1');
    expect(signals[0].tenantId).toBe('t1');
  });
});
