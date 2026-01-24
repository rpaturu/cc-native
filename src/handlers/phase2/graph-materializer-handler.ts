/**
 * Graph Materializer Handler - Phase 2
 * 
 * Lambda handler for graph materialization.
 * 
 * Trigger: EventBridge SIGNAL_DETECTED or SIGNAL_CREATED events (from Phase 1)
 * 
 * Handler Logic:
 * 1. Extract signalId from event
 * 2. Call GraphMaterializer.materializeSignal(signalId, tenantId)
 * 3. Materialization status is written by GraphMaterializer service
 * 4. EventBridge GRAPH_MATERIALIZED event is emitted by GraphMaterializer service
 * 5. On failure: send to DLQ (do NOT emit GRAPH_MATERIALIZED)
 */

import { Handler } from 'aws-lambda';
import { Logger } from '../../services/core/Logger';
import { TraceService } from '../../services/core/TraceService';
import { GraphMaterializer } from '../../services/graph/GraphMaterializer';
import { GraphService } from '../../services/graph/GraphService';
import { NeptuneConnection } from '../../services/graph/NeptuneConnection';
import { SignalService } from '../../services/perception/SignalService';
import { LifecycleStateService } from '../../services/perception/LifecycleStateService';
import { SuppressionEngine } from '../../services/perception/SuppressionEngine';
import { EventPublisher } from '../../services/events/EventPublisher';
import { LedgerService } from '../../services/ledger/LedgerService';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { getAWSClientConfig } from '../../utils/aws-client-config';

/**
 * EventBridge event detail for SIGNAL_DETECTED/SIGNAL_CREATED
 */
interface SignalEventDetail {
  signalId: string;
  tenantId: string;
  accountId: string;
  traceId?: string;
}

/**
 * EventBridge event envelope
 */
interface EventBridgeEvent {
  source: string;
  'detail-type': string;
  detail: SignalEventDetail;
  time?: string;
  id?: string;
}

/**
 * Graph Materializer Handler
 */
export const handler: Handler<EventBridgeEvent> = async (event, context) => {
  const logger = new Logger('GraphMaterializerHandler');
  const traceService = new TraceService(logger);
  const traceId = event.detail.traceId || traceService.generateTraceId();

  logger.info('Graph materializer handler invoked', {
    source: event.source,
    detailType: event['detail-type'],
    signalId: event.detail.signalId,
    tenantId: event.detail.tenantId,
    accountId: event.detail.accountId,
    traceId,
  });

  try {
    // Validate event
    if (!event.detail.signalId || !event.detail.tenantId || !event.detail.accountId) {
      throw new Error('Missing required event fields: signalId, tenantId, accountId');
    }

    // Initialize AWS clients
    const region = process.env.AWS_REGION || 'us-west-2';
    const clientConfig = getAWSClientConfig(region);
    const dynamoClient = new DynamoDBClient(clientConfig);
    const documentClient = DynamoDBDocumentClient.from(dynamoClient);

    // Initialize services
    const ledgerService = new LedgerService(
      logger,
      process.env.LEDGER_TABLE_NAME || 'cc-native-ledger',
      region
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
      region,
    });

    const signalService = new SignalService({
      logger,
      signalsTableName: process.env.SIGNALS_TABLE_NAME || 'cc-native-signals',
      accountsTableName: process.env.ACCOUNTS_TABLE_NAME || 'cc-native-accounts',
      lifecycleStateService,
      eventPublisher: new EventPublisher(
        logger,
        process.env.EVENT_BUS_NAME || 'cc-native-events',
        region
      ),
      ledgerService,
      s3Client: undefined, // Not needed for graph materialization
      region,
    });

    // Initialize Neptune connection
    const neptuneEndpoint = process.env.NEPTUNE_CLUSTER_ENDPOINT;
    const neptunePort = parseInt(process.env.NEPTUNE_CLUSTER_PORT || '8182', 10);

    if (!neptuneEndpoint) {
      throw new Error('NEPTUNE_CLUSTER_ENDPOINT environment variable is required');
    }

    const neptuneConnection = NeptuneConnection.getInstance();
    await neptuneConnection.initialize({
      endpoint: neptuneEndpoint,
      port: neptunePort,
      region,
      iamAuthEnabled: true,
    });

    // Initialize GraphService
    const graphService = new GraphService(neptuneConnection);

    // Initialize GraphMaterializer
    const graphMaterializer = new GraphMaterializer({
      graphService,
      signalService,
      lifecycleStateService,
      eventPublisher: new EventPublisher(
        logger,
        process.env.EVENT_BUS_NAME || 'cc-native-events',
        region
      ),
      ledgerService,
      dynamoClient: documentClient,
      materializationStatusTableName:
        process.env.GRAPH_MATERIALIZATION_STATUS_TABLE_NAME ||
        'cc-native-graph-materialization-status',
      signalsTableName: process.env.SIGNALS_TABLE_NAME || 'cc-native-signals',
    });

    // Materialize signal
    // Note: GraphMaterializer.materializeSignal() handles:
    // - Writing materialization status to GraphMaterializationStatus table
    // - Emitting EventBridge GRAPH_MATERIALIZED event
    // - Logging to ledger
    await graphMaterializer.materializeSignal(event.detail.signalId, event.detail.tenantId);

    logger.info('Graph materialization completed', {
      signalId: event.detail.signalId,
      tenantId: event.detail.tenantId,
      traceId,
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        signalId: event.detail.signalId,
        tenantId: event.detail.tenantId,
        traceId,
      }),
    };
  } catch (error) {
    logger.error('Graph materialization failed', {
      signalId: event.detail.signalId,
      tenantId: event.detail.tenantId,
      traceId,
      error: error instanceof Error ? error.message : String(error),
    });

    // Error will be sent to DLQ by Lambda configuration
    // Do NOT emit GRAPH_MATERIALIZED event on failure
    throw error;
  }
};
