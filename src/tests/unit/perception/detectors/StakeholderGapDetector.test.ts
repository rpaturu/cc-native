/**
 * StakeholderGapDetector unit tests
 */

import { Logger } from '../../../../services/core/Logger';
import { StakeholderGapDetector } from '../../../../services/perception/detectors/StakeholderGapDetector';
import { SignalType } from '../../../../types/SignalTypes';
import { createEvidenceSnapshotRef, createMockS3Client } from './detector-test-helpers';

describe('StakeholderGapDetector', () => {
  const logger = new Logger('StakeholderGapDetectorTest');

  it('should return empty when accountId or tenantId missing', async () => {
    const evidence = { entityId: 'acc1' };
    const s3 = createMockS3Client(evidence);
    const ref = createEvidenceSnapshotRef(evidence);
    const detector = new StakeholderGapDetector(logger, s3 as any);

    const signals = await detector.detect(ref);

    expect(signals).toHaveLength(0);
  });

  it('should emit STAKEHOLDER_GAP_DETECTED when missing critical roles', async () => {
    const evidence = {
      accountId: 'acc1',
      metadata: { tenantId: 't1', traceId: 'trace1' },
      payload: {
        stakeholders: [{ role: 'champion' }],
        expectedBuyingGroup: ['champion', 'decision_maker'],
        decisionCriticalRoles: ['decision_maker', 'budget_holder'],
      },
    };
    const s3 = createMockS3Client(evidence);
    const ref = createEvidenceSnapshotRef(evidence);
    const detector = new StakeholderGapDetector(logger, s3 as any);

    const signals = await detector.detect(ref);

    expect(signals.length).toBeGreaterThanOrEqual(1);
    expect(signals[0].signalType).toBe(SignalType.STAKEHOLDER_GAP_DETECTED);
    expect(signals[0].accountId).toBe('acc1');
  });

  it('should return empty when no gap', async () => {
    const evidence = {
      accountId: 'acc1',
      metadata: { tenantId: 't1', traceId: 'trace1' },
      payload: {
        stakeholders: [{ role: 'decision_maker' }, { role: 'budget_holder' }],
        expectedBuyingGroup: ['decision_maker', 'budget_holder'],
        decisionCriticalRoles: ['decision_maker', 'budget_holder'],
      },
    };
    const s3 = createMockS3Client(evidence);
    const ref = createEvidenceSnapshotRef(evidence);
    const detector = new StakeholderGapDetector(logger, s3 as any);

    const signals = await detector.detect(ref);

    expect(signals).toHaveLength(0);
  });
});
