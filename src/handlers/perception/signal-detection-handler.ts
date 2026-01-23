/**
 * Signal Detection Handler
 * 
 * Lambda handler that processes connector data and detects signals.
 * 
 * Event Flow:
 * 1. Receives CONNECTOR_POLL_COMPLETED event with EvidenceSnapshotRef[]
 * 2. Loads each evidence snapshot
 * 3. Runs detectors (pure functions) to detect signals
 * 4. Creates signals via SignalService (idempotent, atomic)
 * 5. Publishes SIGNAL_DETECTED events
 */

import { Handler } from 'aws-lambda';
import { Logger } from '../../services/core/Logger';
import { TraceService } from '../../services/core/TraceService';
import { SignalService } from '../../services/perception/SignalService';
import { LifecycleStateService } from '../../services/perception/LifecycleStateService';
import { SuppressionEngine } from '../../services/perception/SuppressionEngine';
import { EventPublisher } from '../../services/events/EventPublisher';
import { LedgerService } from '../../services/ledger/LedgerService';
import { EvidenceService } from '../../services/world-model/EvidenceService';
import { AccountActivationDetector } from '../../services/perception/detectors/AccountActivationDetector';
import { EngagementDetector } from '../../services/perception/detectors/EngagementDetector';
import { DiscoveryStallDetector } from '../../services/perception/detectors/DiscoveryStallDetector';
import { StakeholderGapDetector } from '../../services/perception/detectors/StakeholderGapDetector';
import { UsageTrendDetector } from '../../services/perception/detectors/UsageTrendDetector';
import { SupportRiskDetector } from '../../services/perception/detectors/SupportRiskDetector';
import { RenewalWindowDetector } from '../../services/perception/detectors/RenewalWindowDetector';
import { EvidenceSnapshotRef } from '../../types/SignalTypes';
import { S3Client } from '@aws-sdk/client-s3';

interface SignalDetectionEvent {
  snapshots: EvidenceSnapshotRef[];
  tenantId: string;
  traceId?: string;
}

/**
 * Signal Detection Handler
 */
export const handler: Handler<SignalDetectionEvent> = async (event, context) => {
  const logger = new Logger('SignalDetectionHandler');
  const traceService = new TraceService(logger);
  const traceId = event.traceId || traceService.generateTraceId();

  logger.info('Signal detection started', {
    snapshotCount: event.snapshots.length,
    tenantId: event.tenantId,
    traceId,
  });

  try {
    // Initialize services
    const s3Client = new S3Client({ region: process.env.AWS_REGION });
    const ledgerService = new LedgerService(
      logger,
      process.env.LEDGER_TABLE_NAME || 'cc-native-ledger',
      process.env.AWS_REGION
    );
    const suppressionEngine = new SuppressionEngine({
      logger,
      ledgerService,
    });
    const lifecycleStateService = new LifecycleStateService({
      logger,
      accountsTableName: process.env.ACCOUNTS_TABLE_NAME || 'cc-native-accounts',
      ledgerService,
      suppressionEngine,
      region: process.env.AWS_REGION,
    });
    const signalService = new SignalService({
      logger,
      signalsTableName: process.env.SIGNALS_TABLE_NAME || 'cc-native-signals',
      accountsTableName: process.env.ACCOUNTS_TABLE_NAME || 'cc-native-accounts',
      lifecycleStateService,
      eventPublisher: new EventPublisher(
        logger,
        process.env.EVENT_BUS_NAME || 'cc-native-events',
        process.env.AWS_REGION
      ),
      ledgerService,
      s3Client,
      region: process.env.AWS_REGION,
    });

    // Initialize detectors
    const detectors = [
      new AccountActivationDetector(logger, s3Client),
      new EngagementDetector(logger, s3Client),
      new DiscoveryStallDetector(logger, s3Client),
      new StakeholderGapDetector(logger, s3Client),
      new UsageTrendDetector(logger, s3Client),
      new SupportRiskDetector(logger, s3Client),
      new RenewalWindowDetector(logger, s3Client),
    ];

    // Process each evidence snapshot
    const allSignals: any[] = [];
    for (const snapshotRef of event.snapshots) {
      // Get AccountState for context
      // Extract accountId from snapshot (would need to load snapshot first)
      // For now, we'll pass undefined and detectors will extract from evidence
      const accountState = undefined; // TODO: Extract accountId and load AccountState

      // Run all detectors
      for (const detector of detectors) {
        try {
          const signals = await detector.detect(snapshotRef, accountState);
          
          // Create signals via SignalService (idempotent, atomic)
          for (const signal of signals) {
            try {
              const created = await signalService.createSignal({
                ...signal,
                traceId, // Ensure traceId is set
              });
              allSignals.push(created);
            } catch (error: any) {
              // Idempotency - signal might already exist
              if (error.name === 'TransactionCanceledException' || 
                  error.message?.includes('ConditionalCheckFailed')) {
                logger.debug('Signal already exists (idempotent)', {
                  signalId: signal.signalId,
                });
              } else {
                throw error;
              }
            }
          }
        } catch (error) {
          logger.error('Detector error', {
            detector: detector.constructor.name,
            error: error instanceof Error ? error.message : String(error),
          });
          // Continue with other detectors
        }
      }
    }

    logger.info('Signal detection completed', {
      signalsCreated: allSignals.length,
      traceId,
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        signalsCreated: allSignals.length,
        traceId,
      }),
    };
  } catch (error) {
    logger.error('Signal detection failed', {
      error: error instanceof Error ? error.message : String(error),
      traceId,
    });
    throw error;
  }
};
