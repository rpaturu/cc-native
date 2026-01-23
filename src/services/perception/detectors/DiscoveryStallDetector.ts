/**
 * DiscoveryStallDetector - Detects DISCOVERY_PROGRESS_STALLED signal
 * 
 * SUSPECT signal: Engagement exists, but learning is not progressing.
 * 
 * Guardrails (Phase 1 Clean):
 * - Base strictly on missing expected artifacts (structural checks only)
 * - Avoid semantic note analysis (no LLM inference)
 * - Avoid outcome judgment (no "good" vs "bad" meeting assessment)
 * - Use only structural checks: presence/absence of data, not content quality
 */

import { BaseDetector, BaseDetectorConfig } from './BaseDetector';
import { Signal, SignalType, EvidenceSnapshotRef } from '../../../types/SignalTypes';
import { AccountState } from '../../../types/LifecycleTypes';
import { S3Client } from '@aws-sdk/client-s3';
import { Logger } from '../../../services/core/Logger';

export class DiscoveryStallDetector extends BaseDetector {
  constructor(logger: Logger, s3Client?: S3Client) {
    super({
      detectorName: 'DiscoveryStallDetector',
      detectorVersion: '1.0.0',
      supportedSignals: [SignalType.DISCOVERY_PROGRESS_STALLED],
      logger,
      s3Client,
    });
  }

  async detect(
    snapshotRef: EvidenceSnapshotRef,
    priorState?: AccountState
  ): Promise<Signal[]> {
    const signals: Signal[] = [];

    try {
      // Load evidence snapshot
      const evidence = await this.loadEvidenceSnapshot(snapshotRef);

      // Extract account information
      const accountId = evidence.entityId || evidence.accountId;
      const tenantId = evidence.metadata?.tenantId || evidence.tenantId;
      const traceId = evidence.metadata?.traceId || `discovery-${Date.now()}`;

      if (!accountId || !tenantId) {
        this.logger.warn('Missing accountId or tenantId in evidence', {
          detector: this.detectorName,
          s3Uri: snapshotRef.s3Uri,
        });
        return signals;
      }

      // Structural checks only (no semantic analysis)
      const meetings = evidence.payload?.meetings || [];
      const requiredFields = ['painPoints', 'budget', 'decisionMaker', 'timeline'];

      // Check for stall indicators (structural only)
      let stallIndicators = 0;

      // Check 1: Incomplete notes (field presence check)
      for (const meeting of meetings) {
        if (!meeting.notes || meeting.notes.trim().length === 0) {
          stallIndicators++;
        }
      }

      // Check 2: Missing required fields (presence/absence check)
      const discoveryData = evidence.payload?.discoveryData || {};
      for (const field of requiredFields) {
        if (!discoveryData[field] || discoveryData[field] === null || discoveryData[field] === '') {
          stallIndicators++;
        }
      }

      // Check 3: Repeated meetings without new data (structural check)
      if (meetings.length >= 2) {
        const recentMeetings = meetings.slice(-2);
        const hasNewData = recentMeetings.some((m: any) => m.newInformation === true);
        if (!hasNewData) {
          stallIndicators++;
        }
      }

      // Check 4: Missing follow-ups (presence check)
      const expectedFollowUps = evidence.payload?.expectedFollowUps || [];
      const completedFollowUps = evidence.payload?.completedFollowUps || [];
      if (expectedFollowUps.length > completedFollowUps.length) {
        stallIndicators++;
      }

      // Emit signal if stall detected (threshold: 2+ indicators)
      if (stallIndicators >= 2) {
        const signal = this.createSignal(
          SignalType.DISCOVERY_PROGRESS_STALLED,
          accountId,
          tenantId,
          traceId,
          snapshotRef,
          evidence,
          {
            confidence: 0.7, // Derived from structural checks
            confidenceSource: 'derived',
            severity: 'medium',
            description: 'Discovery progress stalled (structural checks)',
            context: {
              stallIndicators,
              meetingsCount: meetings.length,
              missingFields: requiredFields.filter(f => !discoveryData[f]),
              detectedAt: snapshotRef.capturedAt,
            },
          }
        );

        signals.push(signal);
      }
    } catch (error) {
      this.logger.error('Error in DiscoveryStallDetector', {
        detector: this.detectorName,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return signals;
  }
}
