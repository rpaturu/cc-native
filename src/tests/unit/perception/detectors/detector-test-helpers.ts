/**
 * Helpers for perception detector unit tests.
 * Builds mock S3 client and EvidenceSnapshotRef so loadEvidenceSnapshot returns the given evidence.
 */

import { createHash } from 'crypto';
import { EvidenceSnapshotRef } from '../../../../types/SignalTypes';

export function createEvidenceSnapshotRef(evidence: object, s3Uri = 's3://test-bucket/test-key'): EvidenceSnapshotRef {
  const bodyString = JSON.stringify(evidence);
  const sha256 = createHash('sha256').update(bodyString).digest('hex');
  return {
    s3Uri,
    sha256,
    capturedAt: new Date().toISOString(),
    schemaVersion: '1',
    detectorInputVersion: '1',
  };
}

export function createMockS3Client(evidence: object): { send: jest.Mock } {
  const bodyString = JSON.stringify(evidence);
  return {
    send: jest.fn().mockResolvedValue({
      Body: {
        transformToString: () => Promise.resolve(bodyString),
      },
    }),
  };
}
