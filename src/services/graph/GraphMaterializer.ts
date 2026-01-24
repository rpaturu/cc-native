/**
 * Graph Materializer Service - Phase 2
 * 
 * Materializes signals and evidence into Neptune graph.
 * All operations are idempotent and follow the materialization flow.
 */

import { GraphService } from './GraphService';
import { SignalService } from '../perception/SignalService';
import { LifecycleStateService } from '../perception/LifecycleStateService';
import { EventPublisher } from '../events/EventPublisher';
import { LedgerService } from '../ledger/LedgerService';
import { Logger } from '../core/Logger';
import { Signal, EvidenceSnapshotRef } from '../../types/SignalTypes';
import { AccountState } from '../../types/LifecycleTypes';
import {
  VertexIdGenerator,
  VertexLabel,
  EdgeLabel,
  SignalVertex,
  AccountVertex,
  EvidenceSnapshotVertex,
} from '../../types/GraphTypes';
import { DynamoDBDocumentClient, PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { LedgerEventType } from '../../types/LedgerTypes';

const logger = new Logger('GraphMaterializer');

/**
 * Graph Materialization Status
 * 
 * Stored in DynamoDB as the authoritative gating mechanism for synthesis.
 * This is the ONLY enforcement path - ledger is for audit only.
 */
export interface GraphMaterializationStatus {
  pk: string; // SIGNAL#{tenantId}#{signalId}
  status: 'COMPLETED' | 'FAILED' | 'IN_PROGRESS';
  trace_id: string;
  updated_at: string;
  error_message?: string;
}

/**
 * Graph Materializer Configuration
 */
export interface GraphMaterializerConfig {
  graphService: GraphService;
  signalService: SignalService;
  lifecycleStateService: LifecycleStateService;
  eventPublisher: EventPublisher;
  ledgerService: LedgerService;
  dynamoClient: DynamoDBDocumentClient;
  materializationStatusTableName: string;
  signalsTableName: string;
}

/**
 * Graph Materializer Service
 */
export class GraphMaterializer {
  private graphService: GraphService;
  private signalService: SignalService;
  private lifecycleStateService: LifecycleStateService;
  private eventPublisher: EventPublisher;
  private ledgerService: LedgerService;
  private dynamoClient: DynamoDBDocumentClient;
  private materializationStatusTableName: string;
  private signalsTableName: string;

  constructor(config: GraphMaterializerConfig) {
    this.graphService = config.graphService;
    this.signalService = config.signalService;
    this.lifecycleStateService = config.lifecycleStateService;
    this.eventPublisher = config.eventPublisher;
    this.ledgerService = config.ledgerService;
    this.dynamoClient = config.dynamoClient;
    this.materializationStatusTableName = config.materializationStatusTableName;
    this.signalsTableName = config.signalsTableName;
  }

  /**
   * Get current timestamp (ISO format)
   */
  private getCurrentTimestamp(): string {
    return new Date().toISOString();
  }

  /**
   * Materialize a single signal into the graph
   * 
   * Materialization Flow:
   * 1. Load signal by ID from DynamoDB
   * 2. Validate schema + versions
   * 3. Ensure Account vertex exists (idempotent upsert)
   * 4. Upsert Signal vertex (idempotent)
   * 5. Upsert EvidenceSnapshot vertex from EvidenceSnapshotRef (idempotent)
   * 6. Create edges (idempotent)
   * 7. Write materialization status to GraphMaterializationStatus table
   * 8. Emit ledger events
   * 9. Emit EventBridge event: GRAPH_MATERIALIZED
   */
  async materializeSignal(signalId: string, tenantId: string): Promise<void> {
    const traceId = `graph-materialize-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const now = this.getCurrentTimestamp();

    try {
      logger.info('Starting signal materialization', { signalId, tenantId, traceId });

      // 1. Load signal by ID from DynamoDB
      const signal = await this.getSignalById(signalId, tenantId);
      if (!signal) {
        throw new Error(`Signal not found: ${signalId} for tenant: ${tenantId}`);
      }

      // 2. Validate schema + versions
      // Signal type validation - ensure it's a valid Phase 1 signal
      if (!signal.signalType || !signal.signalId) {
        throw new Error(`Invalid signal: missing required fields`);
      }

      // Log to ledger: GRAPH_MATERIALIZATION_STARTED
      await this.ledgerService.append({
        eventType: LedgerEventType.SIGNAL, // Use SIGNAL type for graph materialization
        tenantId: signal.tenantId,
        accountId: signal.accountId,
        traceId,
        data: {
          action: 'GRAPH_MATERIALIZATION_STARTED',
          signalId: signal.signalId,
          signalType: signal.signalType,
        },
      });

      // 3. Ensure Account vertex exists (idempotent upsert)
      await this.ensureAccountVertex(signal.accountId, signal.tenantId, traceId);

      // 4. Upsert Signal vertex (idempotent)
      await this.upsertSignalVertex(signal, traceId);

      // 5. Upsert EvidenceSnapshot vertex from EvidenceSnapshotRef (idempotent)
      await this.upsertEvidenceSnapshotVertex(signal.evidence.evidenceRef, signal.tenantId, traceId);

      // 6. Create edges (idempotent)
      await this.createSignalEdges(signal, traceId);

      // 7. Write materialization status to GraphMaterializationStatus table
      // This is the ONLY authoritative gating mechanism for synthesis
      await this.writeMaterializationStatus(signal.signalId, signal.tenantId, traceId, 'COMPLETED');

      // 8. Emit ledger events
      await this.ledgerService.append({
        eventType: LedgerEventType.SIGNAL,
        tenantId: signal.tenantId,
        accountId: signal.accountId,
        traceId,
        data: {
          action: 'GRAPH_UPSERTED',
          signalId: signal.signalId,
          vertexType: 'SIGNAL',
        },
      });

      await this.ledgerService.append({
        eventType: LedgerEventType.SIGNAL,
        tenantId: signal.tenantId,
        accountId: signal.accountId,
        traceId,
        data: {
          action: 'GRAPH_EDGE_CREATED',
          signalId: signal.signalId,
          edgeType: 'HAS_SIGNAL',
        },
      });

      await this.ledgerService.append({
        eventType: LedgerEventType.SIGNAL,
        tenantId: signal.tenantId,
        accountId: signal.accountId,
        traceId,
        data: {
          action: 'GRAPH_MATERIALIZATION_COMPLETED',
          signalId: signal.signalId,
        },
      });

      // 9. Emit EventBridge event: GRAPH_MATERIALIZED (triggers synthesis)
      await this.eventPublisher.publish({
        source: 'perception', // Use perception source for graph events
        eventType: 'GRAPH_MATERIALIZED',
        tenantId: signal.tenantId,
        accountId: signal.accountId,
        traceId,
        payload: {
          signalId: signal.signalId,
        },
        ts: new Date().toISOString(),
      });

      logger.info('Signal materialization completed', { signalId, tenantId, traceId });
    } catch (error) {
      logger.error('Signal materialization failed', { signalId, tenantId, traceId, error });

      // Write failed status
      await this.writeMaterializationStatus(
        signalId,
        tenantId,
        traceId,
        'FAILED',
        error instanceof Error ? error.message : String(error)
      );

      // Log to ledger: GRAPH_MATERIALIZATION_FAILED
      await this.ledgerService.append({
        eventType: LedgerEventType.SIGNAL,
        tenantId,
        accountId: (error as any).accountId || 'unknown',
        traceId,
        data: {
          action: 'GRAPH_MATERIALIZATION_FAILED',
          signalId,
          error: error instanceof Error ? error.message : String(error),
        },
      });

      // Do NOT emit GRAPH_MATERIALIZED event on failure
      throw error;
    }
  }

  /**
   * Ensure Account vertex exists (idempotent upsert)
   */
  private async ensureAccountVertex(
    accountId: string,
    tenantId: string,
    traceId: string
  ): Promise<void> {
    const accountVertexId = VertexIdGenerator.account(tenantId, accountId);
    const now = this.getCurrentTimestamp();

    // Load account state for lifecycle_state
    let lifecycleState: string | undefined;
    try {
      const accountState = await this.lifecycleStateService.getAccountState(accountId, tenantId);
      lifecycleState = accountState?.currentLifecycleState;
    } catch (error) {
      logger.warn('Failed to load account state, continuing without lifecycle_state', {
        accountId,
        tenantId,
        error,
      });
    }

    const accountProperties: Record<string, any> = {
      entity_type: 'ACCOUNT',
      tenant_id: tenantId,
      account_id: accountId,
      created_at: now,
      updated_at: now,
      schema_version: 'v1',
      ...(lifecycleState && { lifecycle_state: lifecycleState }),
    };

    await this.graphService.upsertVertex(
      accountVertexId,
      VertexLabel.ACCOUNT,
      accountProperties
    );

    logger.debug('Account vertex ensured', { accountVertexId, accountId, tenantId });
  }

  /**
   * Upsert Signal vertex (idempotent)
   */
  private async upsertSignalVertex(signal: Signal, traceId: string): Promise<void> {
    const signalVertexId = VertexIdGenerator.signal(signal.tenantId, signal.signalId);
    const now = this.getCurrentTimestamp();

    // Convert signal.createdAt (camelCase) to created_at (snake_case) at graph boundary
    const signalProperties: Record<string, any> = {
      entity_type: 'SIGNAL',
      tenant_id: signal.tenantId,
      signal_id: signal.signalId,
      signal_type: signal.signalType,
      status: signal.status,
      created_at: signal.createdAt, // Convert camelCase to snake_case at boundary
      updated_at: signal.updatedAt, // Convert camelCase to snake_case at boundary
      schema_version: 'v1',
      dedupeKey: signal.dedupeKey,
      detector_version: signal.detectorVersion,
      window_key: signal.windowKey,
    };

    await this.graphService.upsertVertex(signalVertexId, VertexLabel.SIGNAL, signalProperties);

    logger.debug('Signal vertex upserted', { signalVertexId, signalId: signal.signalId });
  }

  /**
   * Upsert EvidenceSnapshot vertex from EvidenceSnapshotRef (idempotent)
   */
  private async upsertEvidenceSnapshotVertex(
    evidenceRef: EvidenceSnapshotRef,
    tenantId: string,
    traceId: string
  ): Promise<void> {
    // Use SHA256 hash as evidence snapshot ID
    const evidenceSnapshotId = evidenceRef.sha256;
    const evidenceVertexId = VertexIdGenerator.evidenceSnapshot(tenantId, evidenceSnapshotId);
    const now = this.getCurrentTimestamp();

    // Extract S3 key from S3 URI
    const s3Key = evidenceRef.s3Uri.replace(/^s3:\/\/[^/]+\//, '');

    const evidenceProperties: Record<string, any> = {
      entity_type: 'EVIDENCE_SNAPSHOT',
      tenant_id: tenantId,
      evidence_snapshot_id: evidenceSnapshotId,
      created_at: now,
      updated_at: now,
      schema_version: 'v1',
      s3_key: s3Key,
      sha256: evidenceRef.sha256,
    };

    await this.graphService.upsertVertex(
      evidenceVertexId,
      VertexLabel.EVIDENCE_SNAPSHOT,
      evidenceProperties
    );

    logger.debug('Evidence snapshot vertex upserted', {
      evidenceVertexId,
      evidenceSnapshotId,
    });
  }

  /**
   * Create edges (idempotent)
   * 
   * Creates:
   * - Account HAS_SIGNAL Signal
   * - Signal SUPPORTED_BY EvidenceSnapshot
   */
  private async createSignalEdges(signal: Signal, traceId: string): Promise<void> {
    const accountVertexId = VertexIdGenerator.account(signal.tenantId, signal.accountId);
    const signalVertexId = VertexIdGenerator.signal(signal.tenantId, signal.signalId);
    const evidenceSnapshotId = signal.evidence.evidenceRef.sha256;
    const evidenceVertexId = VertexIdGenerator.evidenceSnapshot(
      signal.tenantId,
      evidenceSnapshotId
    );
    const now = this.getCurrentTimestamp();

    // Account HAS_SIGNAL Signal
    await this.graphService.upsertEdge(
      accountVertexId,
      signalVertexId,
      EdgeLabel.HAS_SIGNAL,
      {
        created_at: now,
        updated_at: now,
        trace_id: traceId,
        schema_version: 'v1',
      }
    );

    // Signal SUPPORTED_BY EvidenceSnapshot
    await this.graphService.upsertEdge(
      signalVertexId,
      evidenceVertexId,
      EdgeLabel.SUPPORTED_BY,
      {
        created_at: now,
        updated_at: now,
        trace_id: traceId,
        schema_version: 'v1',
      }
    );

    logger.debug('Signal edges created', { signalId: signal.signalId });
  }

  /**
   * Write materialization status to GraphMaterializationStatus table
   * 
   * This is the ONLY authoritative gating mechanism for synthesis.
   * Ledger is for audit only, never for gating.
   */
  private async writeMaterializationStatus(
    signalId: string,
    tenantId: string,
    traceId: string,
    status: 'COMPLETED' | 'FAILED' | 'IN_PROGRESS',
    errorMessage?: string
  ): Promise<void> {
    const pk = `SIGNAL#${tenantId}#${signalId}`;
    const now = this.getCurrentTimestamp();

    const statusRecord: GraphMaterializationStatus = {
      pk,
      status,
      trace_id: traceId,
      updated_at: now,
      ...(errorMessage && { error_message: errorMessage }),
    };

    await this.dynamoClient.send(
      new PutCommand({
        TableName: this.materializationStatusTableName,
        Item: statusRecord,
      })
    );

    logger.debug('Materialization status written', { pk, status });
  }

  /**
   * Get signal by ID from DynamoDB
   */
  private async getSignalById(signalId: string, tenantId: string): Promise<Signal | null> {
    try {
      const result = await this.dynamoClient.send(
        new GetCommand({
          TableName: this.signalsTableName,
          Key: {
            tenantId,
            signalId,
          },
        })
      );

      return (result.Item as Signal) || null;
    } catch (error) {
      logger.error('Failed to get signal by ID', { signalId, tenantId, error });
      throw error;
    }
  }

  /**
   * Materialize multiple signals (batch)
   * 
   * Processes signals in batch for efficiency.
   * Each signal is materialized independently (idempotent).
   */
  async materializeBatch(signalIds: string[], tenantId: string): Promise<void> {
    logger.info('Starting batch materialization', {
      signalCount: signalIds.length,
      tenantId,
    });

    const results = {
      succeeded: 0,
      failed: 0,
      errors: [] as Array<{ signalId: string; error: string }>,
    };

    for (const signalId of signalIds) {
      try {
        await this.materializeSignal(signalId, tenantId);
        results.succeeded++;
      } catch (error) {
        results.failed++;
        results.errors.push({
          signalId,
          error: error instanceof Error ? error.message : String(error),
        });
        logger.error('Failed to materialize signal in batch', { signalId, tenantId, error });
        // Continue with next signal (don't fail entire batch)
      }
    }

    logger.info('Batch materialization completed', {
      tenantId,
      succeeded: results.succeeded,
      failed: results.failed,
      totalErrors: results.errors.length,
    });

    if (results.failed > 0) {
      // Throw error if any signals failed (caller can decide how to handle)
      throw new Error(
        `Batch materialization completed with ${results.failed} failures. ` +
          `Succeeded: ${results.succeeded}, Failed: ${results.failed}`
      );
    }
  }
}
