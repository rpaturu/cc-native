/**
 * SupportRiskDetector - Detects SUPPORT_RISK_EMERGING signal
 * 
 * CUSTOMER signal: Operational friction may affect sentiment or renewal.
 * Derived from: Severity, aging, volume trend.
 */

import { BaseDetector, BaseDetectorConfig } from './BaseDetector';
import { Signal, SignalType, EvidenceSnapshotRef } from '../../../types/SignalTypes';
import { AccountState } from '../../../types/LifecycleTypes';
import { S3Client } from '@aws-sdk/client-s3';
import { Logger } from '../../../services/core/Logger';

export class SupportRiskDetector extends BaseDetector {
  constructor(logger: Logger, s3Client?: S3Client) {
    super({
      detectorName: 'SupportRiskDetector',
      detectorVersion: '1.0.0',
      supportedSignals: [SignalType.SUPPORT_RISK_EMERGING],
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
      const traceId = evidence.metadata?.traceId || `support-${Date.now()}`;

      if (!accountId || !tenantId) {
        this.logger.warn('Missing accountId or tenantId in evidence', {
          detector: this.detectorName,
          s3Uri: snapshotRef.s3Uri,
        });
        return signals;
      }

      // Get support ticket data
      const tickets = evidence.payload?.tickets || [];
      const now = new Date(snapshotRef.capturedAt);

      // Analyze tickets for risk indicators
      let riskScore = 0;
      const riskFactors: string[] = [];

      // Factor 1: High severity tickets
      const highSeverityTickets = tickets.filter((t: any) => 
        t.severity === 'critical' || t.severity === 'high'
      );
      if (highSeverityTickets.length > 0) {
        riskScore += highSeverityTickets.length * 2;
        riskFactors.push(`${highSeverityTickets.length} high-severity tickets`);
      }

      // Factor 2: Aging tickets (7+ days old)
      const agingTickets = tickets.filter((t: any) => {
        const ticketDate = new Date(t.createdAt || t.openedAt);
        const daysOld = (now.getTime() - ticketDate.getTime()) / (1000 * 60 * 60 * 24);
        return daysOld >= 7;
      });
      if (agingTickets.length > 0) {
        riskScore += agingTickets.length;
        riskFactors.push(`${agingTickets.length} aging tickets (7+ days)`);
      }

      // Factor 3: Volume trend (increasing)
      const currentVolume = tickets.length;
      const previousVolume = evidence.payload?.previousTicketCount || 0;
      if (currentVolume > previousVolume && previousVolume > 0) {
        const volumeIncrease = ((currentVolume - previousVolume) / previousVolume) * 100;
        if (volumeIncrease >= 50) {
          riskScore += 3;
          riskFactors.push(`Volume increase: ${volumeIncrease.toFixed(0)}%`);
        }
      }

      // Factor 4: Open critical tickets
      const openCriticalTickets = tickets.filter((t: any) => 
        t.status === 'open' && (t.severity === 'critical' || t.severity === 'high')
      );
      if (openCriticalTickets.length >= 2) {
        riskScore += 5;
        riskFactors.push(`${openCriticalTickets.length} open critical tickets`);
      }

      // Emit signal if risk score threshold met (threshold: 5+)
      if (riskScore >= 5) {
        const severity = riskScore >= 10 ? 'high' : riskScore >= 7 ? 'medium' : 'low';

        const signal = this.createSignal(
          SignalType.SUPPORT_RISK_EMERGING,
          accountId,
          tenantId,
          traceId,
          snapshotRef,
          evidence,
          {
            confidence: Math.min(0.9, 0.5 + (riskScore / 20)), // Scale confidence with risk score
            confidenceSource: 'derived',
            severity: severity as 'low' | 'medium' | 'high',
            description: 'Support risk emerging from ticket analysis',
            context: {
              riskScore,
              riskFactors,
              totalTickets: tickets.length,
              openCriticalTickets: openCriticalTickets.length,
              detectedAt: snapshotRef.capturedAt,
            },
          }
        );

        signals.push(signal);
      }
    } catch (error) {
      this.logger.error('Error in SupportRiskDetector', {
        detector: this.detectorName,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return signals;
  }
}
