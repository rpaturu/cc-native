/**
 * Synthesis Engine Handler - Phase 2
 * 
 * Lambda handler for synthesis engine.
 * 
 * Trigger: EventBridge GRAPH_MATERIALIZED event (from graph materializer)
 * 
 * Handler Logic:
 * 1. Extract accountId, tenantId, signalId from event
 * 2. Verify graph materialization succeeded (check GraphMaterializationStatus table)
 * 3. Call SynthesisEngine.synthesize(accountId, tenantId, eventTime)
 * 4. Write AccountPostureState to DynamoDB (idempotent - conditional write with inputs_hash check)
 * 5. Upsert Posture/Risk/Unknown vertices + edges in Neptune
 * 6. Emit ledger events
 */

import { Handler } from 'aws-lambda';
import { Logger } from '../../services/core/Logger';
import { TraceService } from '../../services/core/TraceService';
import { SynthesisEngine } from '../../services/synthesis/SynthesisEngine';
import { AccountPostureStateService } from '../../services/synthesis/AccountPostureStateService';
import { GraphService } from '../../services/graph/GraphService';
import { NeptuneConnection } from '../../services/graph/NeptuneConnection';
import { SignalService } from '../../services/perception/SignalService';
import { LifecycleStateService } from '../../services/perception/LifecycleStateService';
import { SuppressionEngine } from '../../services/perception/SuppressionEngine';
import { EventPublisher } from '../../services/events/EventPublisher';
import { LedgerService } from '../../services/ledger/LedgerService';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { getAWSClientConfig } from '../../utils/aws-client-config';
import {
  VertexIdGenerator,
  VertexLabel,
  EdgeLabel,
} from '../../types/GraphTypes';
import { LedgerEventType } from '../../types/LedgerTypes';

/**
 * EventBridge event detail for GRAPH_MATERIALIZED
 */
interface GraphMaterializedEventDetail {
  accountId: string;
  tenantId: string;
  signalId: string;
  traceId?: string;
}

/**
 * EventBridge event envelope
 */
interface EventBridgeEvent {
  source: string;
  'detail-type': string;
  detail: GraphMaterializedEventDetail;
  time?: string;
  id?: string;
}

/**
 * Graph Materialization Status (from DynamoDB)
 */
interface GraphMaterializationStatus {
  pk: string;
  status: 'COMPLETED' | 'FAILED' | 'IN_PROGRESS';
  trace_id: string;
  updated_at: string;
  error_message?: string;
}

/**
 * Synthesis Engine Handler
 */
export const handler: Handler<EventBridgeEvent> = async (event, context) => {
  const logger = new Logger('SynthesisEngineHandler');
  const traceService = new TraceService(logger);
  const traceId = event.detail.traceId || traceService.generateTraceId();
  const eventTime = event.time || new Date().toISOString();

  logger.info('Synthesis engine handler invoked', {
    source: event.source,
    detailType: event['detail-type'],
    accountId: event.detail.accountId,
    tenantId: event.detail.tenantId,
    signalId: event.detail.signalId,
    traceId,
  });

  try {
    // Validate event
    if (!event.detail.accountId || !event.detail.tenantId || !event.detail.signalId) {
      throw new Error('Missing required event fields: accountId, tenantId, signalId');
    }

    // 2. Verify graph materialization succeeded - Failure Semantics Rule (LOCKED)
    // Query ONLY GraphMaterializationStatus table (single enforcement path)
    const region = process.env.AWS_REGION || 'us-west-2';
    const clientConfig = getAWSClientConfig(region);
    const dynamoClient = new DynamoDBClient(clientConfig);
    const documentClient = DynamoDBDocumentClient.from(dynamoClient);

    const materializationStatusPk = `SIGNAL#${event.detail.tenantId}#${event.detail.signalId}`;
    const statusResult = await documentClient.send(
      new GetCommand({
        TableName:
          process.env.GRAPH_MATERIALIZATION_STATUS_TABLE_NAME ||
          'cc-native-graph-materialization-status',
        Key: {
          pk: materializationStatusPk,
        },
      })
    );

    const status = statusResult.Item as GraphMaterializationStatus | undefined;

    if (!status || status.status !== 'COMPLETED') {
      logger.warn('Graph materialization not completed, skipping synthesis', {
        signalId: event.detail.signalId,
        tenantId: event.detail.tenantId,
        status: status?.status || 'NOT_FOUND',
      });
      // Exit immediately - do NOT run synthesis
      return {
        statusCode: 200,
        body: JSON.stringify({
          success: false,
          reason: 'Graph materialization not completed',
          signalId: event.detail.signalId,
        }),
      };
    }

    // Initialize AWS clients
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
      s3Client: undefined,
      region,
    });

    // Initialize Synthesis Engine
    const synthesisEngine = new SynthesisEngine({
      signalService,
      lifecycleStateService,
      rulesetVersion: 'v1.0.0',
    });

    // 3. Call SynthesisEngine.synthesize(accountId, tenantId, eventTime)
    const postureState = await synthesisEngine.synthesize(
      event.detail.accountId,
      event.detail.tenantId,
      eventTime
    );

    // 4. Write AccountPostureState to DynamoDB (idempotent - conditional write with inputs_hash check)
    const postureStateService = new AccountPostureStateService({
      dynamoClient: documentClient,
      tableName: process.env.ACCOUNT_POSTURE_STATE_TABLE_NAME || 'cc-native-account-posture-state',
    });

    await postureStateService.writePostureState(postureState);

    // 5. Upsert Posture/Risk/Unknown vertices + edges in Neptune
    const neptuneEndpoint = process.env.NEPTUNE_CLUSTER_ENDPOINT;
    const neptunePort = parseInt(process.env.NEPTUNE_CLUSTER_PORT || '8182', 10);

    if (neptuneEndpoint) {
      const neptuneConnection = NeptuneConnection.getInstance();
      await neptuneConnection.initialize({
        endpoint: neptuneEndpoint,
        port: neptunePort,
        region,
        iamAuthEnabled: true,
      });

      const graphService = new GraphService(neptuneConnection);
      await upsertPostureVertices(graphService, postureState, traceId);
    } else {
      logger.warn('Neptune endpoint not configured, skipping graph upserts');
    }

    // 6. Emit ledger events
    await ledgerService.append({
      eventType: LedgerEventType.DECISION,
      tenantId: event.detail.tenantId,
      accountId: event.detail.accountId,
      traceId,
      data: {
        action: 'POSTURE_UPDATED',
        posture: postureState.posture,
        ruleId: postureState.rule_id,
        inputsHash: postureState.inputs_hash,
      },
    });

    logger.info('Synthesis completed', {
      accountId: event.detail.accountId,
      tenantId: event.detail.tenantId,
      posture: postureState.posture,
      traceId,
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        accountId: event.detail.accountId,
        tenantId: event.detail.tenantId,
        posture: postureState.posture,
        traceId,
      }),
    };
  } catch (error) {
    logger.error('Synthesis failed', {
      accountId: event.detail.accountId,
      tenantId: event.detail.tenantId,
      traceId,
      error: error instanceof Error ? error.message : String(error),
    });

    // Error will be sent to DLQ by Lambda configuration
    throw error;
  }
};

/**
 * Upsert posture vertices and edges in Neptune
 */
async function upsertPostureVertices(
  graphService: GraphService,
  postureState: any,
  traceId: string
): Promise<void> {
  const now = new Date().toISOString();

  // Upsert Posture vertex
  const postureVertexId = VertexIdGenerator.posture(
    postureState.tenantId,
    postureState.account_id,
    postureState.inputs_hash // Use inputs_hash as posture_id for determinism
  );

  await graphService.upsertVertex(postureVertexId, VertexLabel.POSTURE, {
    entity_type: 'POSTURE',
    tenant_id: postureState.tenantId,
    account_id: postureState.account_id,
    posture_id: postureState.inputs_hash,
    posture: postureState.posture,
    momentum: postureState.momentum,
    ruleset_version: postureState.ruleset_version,
    active_signals_hash: postureState.active_signals_hash,
    created_at: now,
    updated_at: now,
    schema_version: 'v1',
  });

  // Upsert Account → Posture edge
  const accountVertexId = VertexIdGenerator.account(
    postureState.tenantId,
    postureState.account_id
  );

  await graphService.upsertEdge(accountVertexId, postureVertexId, EdgeLabel.HAS_POSTURE, {
    created_at: now,
    updated_at: now,
    trace_id: traceId,
    schema_version: 'v1',
  });

  // Upsert Risk Factor vertices and edges
  for (const risk of postureState.risk_factors || []) {
    const riskVertexId = VertexIdGenerator.riskFactor(risk.risk_id);
    await graphService.upsertVertex(riskVertexId, VertexLabel.RISK_FACTOR, {
      entity_type: 'RISK_FACTOR',
      tenant_id: postureState.tenantId,
      risk_factor_id: risk.risk_id,
      account_id: postureState.account_id,
      risk_type: risk.type,
      severity: risk.severity,
      description: risk.description,
      rule_id: risk.rule_id,
      ruleset_version: risk.ruleset_version,
      created_at: now,
      updated_at: now,
      schema_version: 'v1',
    });

    await graphService.upsertEdge(postureVertexId, riskVertexId, EdgeLabel.IMPLIES_RISK, {
      created_at: now,
      updated_at: now,
      trace_id: traceId,
      schema_version: 'v1',
    });
  }

  // Upsert Opportunity vertices and edges
  for (const opp of postureState.opportunities || []) {
    const oppVertexId = VertexIdGenerator.opportunity(opp.opportunity_id);
    await graphService.upsertVertex(oppVertexId, VertexLabel.OPPORTUNITY, {
      entity_type: 'OPPORTUNITY',
      tenant_id: postureState.tenantId,
      opportunity_id: opp.opportunity_id,
      account_id: postureState.account_id,
      opportunity_type: opp.type,
      severity: opp.severity,
      description: opp.description,
      rule_id: opp.rule_id,
      ruleset_version: opp.ruleset_version,
      created_at: now,
      updated_at: now,
      schema_version: 'v1',
    });

    await graphService.upsertEdge(
      postureVertexId,
      oppVertexId,
      EdgeLabel.IMPLIES_OPPORTUNITY,
      {
        created_at: now,
        updated_at: now,
        trace_id: traceId,
        schema_version: 'v1',
      }
    );
  }

  // Upsert Unknown vertices and edges
  for (const unknown of postureState.unknowns || []) {
    const unknownVertexId = VertexIdGenerator.unknown(unknown.unknown_id);
    await graphService.upsertVertex(unknownVertexId, VertexLabel.UNKNOWN, {
      entity_type: 'UNKNOWN',
      tenant_id: postureState.tenantId,
      unknown_id: unknown.unknown_id,
      account_id: postureState.account_id,
      unknown_type: unknown.type,
      description: unknown.description,
      rule_id: unknown.rule_id,
      ruleset_version: unknown.ruleset_version,
      introduced_at: unknown.introduced_at,
      expires_at: unknown.expires_at,
      review_after: unknown.review_after,
      created_at: now,
      updated_at: now,
      schema_version: 'v1',
    });

    await graphService.upsertEdge(accountVertexId, unknownVertexId, EdgeLabel.HAS_UNKNOWN, {
      created_at: now,
      updated_at: now,
      trace_id: traceId,
      schema_version: 'v1',
    });
  }
}
