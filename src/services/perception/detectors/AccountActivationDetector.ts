/**
 * AccountActivationDetector - Detects ACCOUNT_ACTIVATION_DETECTED signal
 * 
 * PROSPECT signal: Account has crossed a relevance threshold.
 * Sources: Target account list update, external signal, partner/inbound attribution.
 */

import { BaseDetector, BaseDetectorConfig } from './BaseDetector';
import { Signal, SignalType, EvidenceSnapshotRef } from '../../../types/SignalTypes';
import { AccountState } from '../../../types/LifecycleTypes';
import { S3Client } from '@aws-sdk/client-s3';
import { Logger } from '../../../services/core/Logger';

export class AccountActivationDetector extends BaseDetector {
  constructor(logger: Logger, s3Client?: S3Client) {
    super({
      detectorName: 'AccountActivationDetector',
      detectorVersion: '1.0.0',
      supportedSignals: [SignalType.ACCOUNT_ACTIVATION_DETECTED],
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
      const traceId = evidence.metadata?.traceId || `activation-${Date.now()}`;

      if (!accountId || !tenantId) {
        this.logger.warn('Missing accountId or tenantId in evidence', {
          detector: this.detectorName,
          s3Uri: snapshotRef.s3Uri,
        });
        return signals;
      }

      // Check for activation indicators
      const activationIndicators = [
        evidence.payload?.targetAccountListUpdate,
        evidence.payload?.externalSignal,
        evidence.payload?.partnerAttribution,
        evidence.payload?.inboundAttribution,
        evidence.payload?.activationDetected,
      ];

      const hasActivation = activationIndicators.some(indicator => indicator === true || indicator !== undefined);

      if (hasActivation) {
        // Create ACCOUNT_ACTIVATION_DETECTED signal
        const signal = this.createSignal(
          SignalType.ACCOUNT_ACTIVATION_DETECTED,
          accountId,
          tenantId,
          traceId,
          snapshotRef,
          evidence,
          {
            confidence: 1.0, // Direct evidence
            confidenceSource: 'direct',
            severity: 'medium',
            description: 'Account activation detected from external source',
            context: {
              activationSource: evidence.payload?.activationSource || 'unknown',
              detectedAt: snapshotRef.capturedAt,
            },
          }
        );

        signals.push(signal);
      }
    } catch (error) {
      this.logger.error('Error in AccountActivationDetector', {
        detector: this.detectorName,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return signals;
  }
}
