/**
 * EngagementDetector - Detects engagement-related signals
 * 
 * PROSPECT signal: NO_ENGAGEMENT_PRESENT
 * SUSPECT signal: FIRST_ENGAGEMENT_OCCURRED
 * 
 * Guardrails:
 * - NO_ENGAGEMENT_PRESENT: Emit only on lifecycle state entry (PROSPECT), re-emit only after 30+ days
 * - FIRST_ENGAGEMENT_OCCURRED: Historical milestone, permanent TTL
 */

import { BaseDetector, BaseDetectorConfig } from './BaseDetector';
import { Signal, SignalType, EvidenceSnapshotRef } from '../../../types/SignalTypes';
import { AccountState, LifecycleState } from '../../../types/LifecycleTypes';
import { S3Client } from '@aws-sdk/client-s3';
import { Logger } from '../../../services/core/Logger';

export class EngagementDetector extends BaseDetector {
  constructor(logger: Logger, s3Client?: S3Client) {
    super({
      detectorName: 'EngagementDetector',
      detectorVersion: '1.0.0',
      supportedSignals: [
        SignalType.NO_ENGAGEMENT_PRESENT,
        SignalType.FIRST_ENGAGEMENT_OCCURRED,
      ],
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
      const traceId = evidence.metadata?.traceId || `engagement-${Date.now()}`;

      if (!accountId || !tenantId) {
        this.logger.warn('Missing accountId or tenantId in evidence', {
          detector: this.detectorName,
          s3Uri: snapshotRef.s3Uri,
        });
        return signals;
      }

      // Check for engagement indicators
      const hasEngagement = !!(
        evidence.payload?.meetings?.length > 0 ||
        evidence.payload?.interactions?.length > 0 ||
        evidence.payload?.replies?.length > 0 ||
        evidence.payload?.firstEngagement ||
        evidence.payload?.engagementId
      );

      // Check for FIRST_ENGAGEMENT_OCCURRED
      if (hasEngagement && !priorState?.lastEngagementAt) {
        // First engagement detected
        const signal = this.createSignal(
          SignalType.FIRST_ENGAGEMENT_OCCURRED,
          accountId,
          tenantId,
          traceId,
          snapshotRef,
          evidence,
          {
            confidence: 1.0, // Direct evidence
            confidenceSource: 'direct',
            severity: 'high',
            description: 'First engagement occurred',
            context: {
              engagementType: evidence.payload?.engagementType || 'unknown',
              engagementId: evidence.payload?.engagementId,
              detectedAt: snapshotRef.capturedAt,
            },
          }
        );

        // Set inferenceActive based on lifecycle state
        // If already CUSTOMER, this is historical only
        if (priorState?.currentLifecycleState === LifecycleState.CUSTOMER) {
          signal.suppression.inferenceActive = false;
        }

        signals.push(signal);
      }

      // Check for NO_ENGAGEMENT_PRESENT (only if PROSPECT state)
      if (!hasEngagement && priorState?.currentLifecycleState === LifecycleState.PROSPECT) {
        // Check if we should emit (state-entry only, or 30+ days since last emit)
        const shouldEmit = this.shouldEmitNoEngagement(priorState, snapshotRef.capturedAt);

        if (shouldEmit) {
          const signal = this.createSignal(
            SignalType.NO_ENGAGEMENT_PRESENT,
            accountId,
            tenantId,
            traceId,
            snapshotRef,
            evidence,
            {
              confidence: 0.8, // Derived from absence
              confidenceSource: 'derived',
              severity: 'low',
              description: 'No engagement present for PROSPECT account',
              context: {
                detectedAt: snapshotRef.capturedAt,
                lastEngagementCheck: priorState?.lastEngagementAt || null,
              },
            }
          );

          signals.push(signal);
        }
      }
    } catch (error) {
      this.logger.error('Error in EngagementDetector', {
        detector: this.detectorName,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return signals;
  }

  /**
   * Determine if NO_ENGAGEMENT_PRESENT should be emitted
   * 
   * Guardrails:
   * - Emit only on lifecycle state entry (PROSPECT)
   * - Re-emit only after meaningful time decay (30+ days)
   */
  private shouldEmitNoEngagement(priorState: AccountState, currentTime: string): boolean {
    // If no lastEngagementAt, this is state entry - emit
    if (!priorState.lastEngagementAt) {
      return true;
    }

    // Check if 30+ days have passed since last engagement check
    const lastCheck = new Date(priorState.lastEngagementAt);
    const now = new Date(currentTime);
    const daysSinceCheck = (now.getTime() - lastCheck.getTime()) / (1000 * 60 * 60 * 24);

    return daysSinceCheck >= 30;
  }
}
