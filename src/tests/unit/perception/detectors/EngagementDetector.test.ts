/**
 * EngagementDetector unit tests
 */

import { Logger } from '../../../../services/core/Logger';
import { EngagementDetector } from '../../../../services/perception/detectors/EngagementDetector';
import { SignalType } from '../../../../types/SignalTypes';
import { LifecycleState } from '../../../../types/LifecycleTypes';
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

  it('should set inferenceActive false when priorState is CUSTOMER and has engagement', async () => {
    const evidence = {
      accountId: 'acc1',
      metadata: { tenantId: 't1', traceId: 'trace1' },
      payload: { meetings: [{}], engagementId: 'e1' },
    };
    const s3 = createMockS3Client(evidence);
    const ref = createEvidenceSnapshotRef(evidence);
    const detector = new EngagementDetector(logger, s3 as any);
    const priorState = {
      currentLifecycleState: LifecycleState.CUSTOMER,
    };

    const signals = await detector.detect(ref, priorState as any);

    expect(signals).toHaveLength(1);
    expect(signals[0].signalType).toBe(SignalType.FIRST_ENGAGEMENT_OCCURRED);
    expect(signals[0].suppression.inferenceActive).toBe(false);
  });

  it('should emit NO_ENGAGEMENT_PRESENT when PROSPECT and no engagement and no lastEngagementAt', async () => {
    const evidence = {
      accountId: 'acc1',
      metadata: { tenantId: 't1', traceId: 'trace1' },
      payload: {},
    };
    const s3 = createMockS3Client(evidence);
    const ref = createEvidenceSnapshotRef(evidence);
    const detector = new EngagementDetector(logger, s3 as any);
    const priorState = {
      currentLifecycleState: LifecycleState.PROSPECT,
    };

    const signals = await detector.detect(ref, priorState as any);

    expect(signals).toHaveLength(1);
    expect(signals[0].signalType).toBe(SignalType.NO_ENGAGEMENT_PRESENT);
  });

  it('should emit NO_ENGAGEMENT_PRESENT when PROSPECT and no engagement and lastEngagementAt 31+ days ago', async () => {
    const evidence = {
      accountId: 'acc1',
      metadata: { tenantId: 't1', traceId: 'trace1' },
      payload: {},
    };
    const s3 = createMockS3Client(evidence);
    const ref = createEvidenceSnapshotRef(evidence);
    ref.capturedAt = new Date().toISOString();
    const detector = new EngagementDetector(logger, s3 as any);
    const d = new Date();
    d.setDate(d.getDate() - 31);
    const priorState = {
      currentLifecycleState: LifecycleState.PROSPECT,
      lastEngagementAt: d.toISOString(),
    };

    const signals = await detector.detect(ref, priorState as any);

    expect(signals).toHaveLength(1);
    expect(signals[0].signalType).toBe(SignalType.NO_ENGAGEMENT_PRESENT);
  });

  it('should not emit NO_ENGAGEMENT_PRESENT when PROSPECT and no engagement but lastEngagementAt < 30 days ago', async () => {
    const evidence = {
      accountId: 'acc1',
      metadata: { tenantId: 't1', traceId: 'trace1' },
      payload: {},
    };
    const s3 = createMockS3Client(evidence);
    const ref = createEvidenceSnapshotRef(evidence);
    const detector = new EngagementDetector(logger, s3 as any);
    const d = new Date();
    d.setDate(d.getDate() - 10);
    const priorState = {
      currentLifecycleState: LifecycleState.PROSPECT,
      lastEngagementAt: d.toISOString(),
    };

    const signals = await detector.detect(ref, priorState as any);

    expect(signals).toHaveLength(0);
  });
});
