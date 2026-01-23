/**
 * UsageTrendDetector - Detects USAGE_TREND_CHANGE signal
 * 
 * CUSTOMER signal: Customer behavior has materially shifted.
 * Derived from: Aggregate usage deltas, directional trend (up / down).
 */

import { BaseDetector, BaseDetectorConfig } from './BaseDetector';
import { Signal, SignalType, EvidenceSnapshotRef } from '../../../types/SignalTypes';
import { AccountState } from '../../../types/LifecycleTypes';
import { S3Client } from '@aws-sdk/client-s3';
import { Logger } from '../../../services/core/Logger';

export class UsageTrendDetector extends BaseDetector {
  constructor(logger: Logger, s3Client?: S3Client) {
    super({
      detectorName: 'UsageTrendDetector',
      detectorVersion: '1.0.0',
      supportedSignals: [SignalType.USAGE_TREND_CHANGE],
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
      const traceId = evidence.metadata?.traceId || `usage-${Date.now()}`;

      if (!accountId || !tenantId) {
        this.logger.warn('Missing accountId or tenantId in evidence', {
          detector: this.detectorName,
          s3Uri: snapshotRef.s3Uri,
        });
        return signals;
      }

      // Get usage metrics
      const currentUsage = evidence.payload?.usageMetrics || {};
      const previousUsage = evidence.payload?.previousUsageMetrics || {};
      const trendWindow = evidence.payload?.trendWindow || 7; // Default 7 days

      // Calculate deltas
      const metrics = Object.keys(currentUsage);
      if (metrics.length === 0) {
        return signals; // No usage data
      }

      let significantChanges = 0;
      const changes: Record<string, { delta: number; percentChange: number }> = {};

      for (const metric of metrics) {
        const current = currentUsage[metric] || 0;
        const previous = previousUsage[metric] || 0;

        if (previous === 0 && current > 0) {
          // New usage started
          significantChanges++;
          changes[metric] = { delta: current, percentChange: 100 };
        } else if (previous > 0) {
          const delta = current - previous;
          const percentChange = (delta / previous) * 100;

          // Material change threshold: 20% change
          if (Math.abs(percentChange) >= 20) {
            significantChanges++;
            changes[metric] = { delta, percentChange };
          }
        }
      }

      // Determine trend direction
      const totalDelta = Object.values(changes).reduce((sum, c) => sum + c.delta, 0);
      const trendDirection = totalDelta > 0 ? 'up' : totalDelta < 0 ? 'down' : 'stable';

      // Emit signal if material change detected
      if (significantChanges > 0) {
        const signal = this.createSignal(
          SignalType.USAGE_TREND_CHANGE,
          accountId,
          tenantId,
          traceId,
          snapshotRef,
          evidence,
          {
            confidence: 0.9, // Direct from usage metrics
            confidenceSource: 'direct',
            severity: trendDirection === 'down' ? 'high' : 'medium',
            description: `Usage trend change detected: ${trendDirection}`,
            context: {
              trendDirection,
              significantChanges,
              changes,
              trendWindow,
              detectedAt: snapshotRef.capturedAt,
            },
          }
        );

        signals.push(signal);
      }
    } catch (error) {
      this.logger.error('Error in UsageTrendDetector', {
        detector: this.detectorName,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return signals;
  }
}
