/**
 * RenewalWindowDetector - Detects RENEWAL_WINDOW_ENTERED signal
 * 
 * CUSTOMER signal: Commercial urgency has begun.
 * Derived from: Contract metadata, time-based threshold.
 */

import { BaseDetector, BaseDetectorConfig } from './BaseDetector';
import { Signal, SignalType, EvidenceSnapshotRef } from '../../../types/SignalTypes';
import { AccountState } from '../../../types/LifecycleTypes';
import { S3Client } from '@aws-sdk/client-s3';
import { Logger } from '../../../services/core/Logger';

export class RenewalWindowDetector extends BaseDetector {
  private renewalWindowDays: number; // Days before renewal to enter window

  constructor(logger: Logger, s3Client?: S3Client, renewalWindowDays: number = 90) {
    super({
      detectorName: 'RenewalWindowDetector',
      detectorVersion: '1.0.0',
      supportedSignals: [SignalType.RENEWAL_WINDOW_ENTERED],
      logger,
      s3Client,
    });
    this.renewalWindowDays = renewalWindowDays;
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
      const traceId = evidence.metadata?.traceId || `renewal-${Date.now()}`;

      if (!accountId || !tenantId) {
        this.logger.warn('Missing accountId or tenantId in evidence', {
          detector: this.detectorName,
          s3Uri: snapshotRef.s3Uri,
        });
        return signals;
      }

      // Get contract information
      const contracts = evidence.payload?.contracts || [];
      const now = new Date(snapshotRef.capturedAt);

      for (const contract of contracts) {
        const renewalDate = contract.renewalDate || contract.endDate;
        if (!renewalDate) {
          continue;
        }

        const renewal = new Date(renewalDate);
        const daysUntilRenewal = (renewal.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);

        // Check if within renewal window
        if (daysUntilRenewal > 0 && daysUntilRenewal <= this.renewalWindowDays) {
          // Determine threshold boundary for dedupeKey
          const thresholdBoundary = this.getThresholdBoundary(daysUntilRenewal);

          // Create signal with contract-specific context
          const signal = this.createSignal(
            SignalType.RENEWAL_WINDOW_ENTERED,
            accountId,
            tenantId,
            traceId,
            snapshotRef,
            {
              ...evidence,
              contractId: contract.contractId || contract.id,
              thresholdBoundary,
            },
            {
              confidence: 1.0, // Direct from contract metadata
              confidenceSource: 'direct',
              severity: daysUntilRenewal <= 30 ? 'critical' : daysUntilRenewal <= 60 ? 'high' : 'medium',
              description: `Renewal window entered: ${daysUntilRenewal.toFixed(0)} days until renewal`,
              context: {
                contractId: contract.contractId || contract.id,
                renewalDate: renewalDate,
                daysUntilRenewal: Math.floor(daysUntilRenewal),
                thresholdBoundary,
                detectedAt: snapshotRef.capturedAt,
              },
            }
          );

          signals.push(signal);
        }
      }
    } catch (error) {
      this.logger.error('Error in RenewalWindowDetector', {
        detector: this.detectorName,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return signals;
  }

  /**
   * Get threshold boundary for dedupeKey
   * 
   * Creates boundaries: 0-30 days, 31-60 days, 61-90 days, etc.
   */
  private getThresholdBoundary(daysUntilRenewal: number): string {
    if (daysUntilRenewal <= 30) {
      return '0-30';
    } else if (daysUntilRenewal <= 60) {
      return '31-60';
    } else if (daysUntilRenewal <= 90) {
      return '61-90';
    } else {
      return '90+';
    }
  }
}
