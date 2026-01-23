/**
 * Connector Poll Handler
 * 
 * Lambda handler that polls connectors on schedule.
 * 
 * Event Flow:
 * 1. Scheduled event triggers connector poll
 * 2. Connector fetches delta data
 * 3. Connector writes EvidenceSnapshots to S3 (immutable)
 * 4. Connector returns EvidenceSnapshotRef[]
 * 5. Publishes CONNECTOR_POLL_COMPLETED event with snapshot refs
 */

import { Handler } from 'aws-lambda';
import { Logger } from '../../services/core/Logger';
import { TraceService } from '../../services/core/TraceService';
import { EvidenceService } from '../../services/world-model/EvidenceService';
import { EventPublisher } from '../../services/events/EventPublisher';
import { CRMConnector } from '../../services/perception/connectors/CRMConnector';
import { UsageAnalyticsConnector } from '../../services/perception/connectors/UsageAnalyticsConnector';
import { SupportConnector } from '../../services/perception/connectors/SupportConnector';
import { S3Client } from '@aws-sdk/client-s3';

interface ConnectorPollEvent {
  connectorType: 'CRM' | 'USAGE_ANALYTICS' | 'SUPPORT';
  tenantId: string;
  traceId?: string;
}

/**
 * Connector Poll Handler
 */
export const handler: Handler<ConnectorPollEvent> = async (event, context) => {
  const logger = new Logger('ConnectorPollHandler');
  const traceService = new TraceService(logger);
  const traceId = event.traceId || traceService.generateTraceId();

  logger.info('Connector poll started', {
    connectorType: event.connectorType,
    tenantId: event.tenantId,
    traceId,
  });

  try {
    // Initialize services
    const evidenceService = new EvidenceService(
      logger,
      process.env.EVIDENCE_LEDGER_BUCKET || '',
      process.env.EVIDENCE_INDEX_TABLE_NAME || 'cc-native-evidence-index',
      process.env.AWS_REGION
    );

    const eventPublisher = new EventPublisher(
      logger,
      process.env.EVENT_BUS_NAME || 'cc-native-events',
      process.env.AWS_REGION
    );

    const s3Client = new S3Client({ region: process.env.AWS_REGION });

    // Create connector based on type
    let connector;
    switch (event.connectorType) {
      case 'CRM':
        connector = new CRMConnector({
          logger,
          tenantId: event.tenantId,
          evidenceService,
          s3Client,
          region: process.env.AWS_REGION,
        });
        break;
      case 'USAGE_ANALYTICS':
        connector = new UsageAnalyticsConnector({
          logger,
          tenantId: event.tenantId,
          evidenceService,
          s3Client,
          region: process.env.AWS_REGION,
        });
        break;
      case 'SUPPORT':
        connector = new SupportConnector({
          logger,
          tenantId: event.tenantId,
          evidenceService,
          s3Client,
          region: process.env.AWS_REGION,
        });
        break;
      default:
        throw new Error(`Unknown connector type: ${event.connectorType}`);
    }

    // Connect and poll
    await connector.connect();
    const snapshots = await connector.poll();
    await connector.disconnect();

    // Publish event with snapshot refs
    await eventPublisher.publish({
      eventType: 'CONNECTOR_POLL_COMPLETED',
      source: 'perception',
      payload: {
        connectorType: event.connectorType,
        snapshotCount: snapshots.length,
        snapshots: snapshots.map(s => ({
          s3Uri: s.s3Uri,
          capturedAt: s.capturedAt,
        })),
      },
      traceId,
      tenantId: event.tenantId,
      ts: new Date().toISOString(),
    });

    logger.info('Connector poll completed', {
      connectorType: event.connectorType,
      snapshotCount: snapshots.length,
      traceId,
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        connectorType: event.connectorType,
        snapshotCount: snapshots.length,
        traceId,
      }),
    };
  } catch (error) {
    logger.error('Connector poll failed', {
      connectorType: event.connectorType,
      error: error instanceof Error ? error.message : String(error),
      traceId,
    });

    // Publish failure event
    try {
      const eventPublisher = new EventPublisher(
        logger,
        process.env.EVENT_BUS_NAME || 'cc-native-events',
        process.env.AWS_REGION
      );

      await eventPublisher.publish({
        eventType: 'CONNECTOR_POLL_FAILED',
        source: 'perception',
        payload: {
          connectorType: event.connectorType,
          error: error instanceof Error ? error.message : String(error),
        },
        traceId,
        tenantId: event.tenantId,
        ts: new Date().toISOString(),
      });
    } catch (publishError) {
      logger.error('Failed to publish failure event', {
        error: publishError instanceof Error ? publishError.message : String(publishError),
      });
    }

    throw error;
  }
};
