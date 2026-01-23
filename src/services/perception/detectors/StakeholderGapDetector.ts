/**
 * StakeholderGapDetector - Detects STAKEHOLDER_GAP_DETECTED signal
 * 
 * SUSPECT signal: Engagement is single-threaded or incomplete.
 * Derived from: Role mapping vs expected buying group, missing decision-critical personas.
 */

import { BaseDetector, BaseDetectorConfig } from './BaseDetector';
import { Signal, SignalType, EvidenceSnapshotRef } from '../../../types/SignalTypes';
import { AccountState } from '../../../types/LifecycleTypes';
import { S3Client } from '@aws-sdk/client-s3';
import { Logger } from '../../../services/core/Logger';

export class StakeholderGapDetector extends BaseDetector {
  constructor(logger: Logger, s3Client?: S3Client) {
    super({
      detectorName: 'StakeholderGapDetector',
      detectorVersion: '1.0.0',
      supportedSignals: [SignalType.STAKEHOLDER_GAP_DETECTED],
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
      const traceId = evidence.metadata?.traceId || `stakeholder-${Date.now()}`;

      if (!accountId || !tenantId) {
        this.logger.warn('Missing accountId or tenantId in evidence', {
          detector: this.detectorName,
          s3Uri: snapshotRef.s3Uri,
        });
        return signals;
      }

      // Get stakeholder data
      const stakeholders = evidence.payload?.stakeholders || [];
      const expectedRoles = evidence.payload?.expectedBuyingGroup || [];
      const decisionCriticalRoles = evidence.payload?.decisionCriticalRoles || ['decision_maker', 'budget_holder', 'technical_evaluator'];

      // Check for gaps
      const engagedRoles = stakeholders.map((s: any) => s.role).filter(Boolean);
      const missingCriticalRoles = decisionCriticalRoles.filter((role: string) => !engagedRoles.includes(role));
      const missingExpectedRoles = expectedRoles.filter((role: string) => !engagedRoles.includes(role));

      // Single-threaded check: only one stakeholder engaged
      const isSingleThreaded = stakeholders.length === 1;

      // Gap detected if:
      // 1. Missing critical decision roles, OR
      // 2. Single-threaded engagement, OR
      // 3. Missing 50%+ of expected roles
      const hasGap = missingCriticalRoles.length > 0 ||
                     isSingleThreaded ||
                     (expectedRoles.length > 0 && missingExpectedRoles.length / expectedRoles.length >= 0.5);

      if (hasGap) {
        const signal = this.createSignal(
          SignalType.STAKEHOLDER_GAP_DETECTED,
          accountId,
          tenantId,
          traceId,
          snapshotRef,
          evidence,
          {
            confidence: 0.8, // Derived from role mapping
            confidenceSource: 'derived',
            severity: 'high',
            description: 'Stakeholder gap detected in engagement',
            context: {
              isSingleThreaded,
              missingCriticalRoles,
              missingExpectedRoles,
              engagedRolesCount: stakeholders.length,
              expectedRolesCount: expectedRoles.length,
              detectedAt: snapshotRef.capturedAt,
            },
          }
        );

        signals.push(signal);
      }
    } catch (error) {
      this.logger.error('Error in StakeholderGapDetector', {
        detector: this.detectorName,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return signals;
  }
}
