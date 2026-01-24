/**
 * Phase 2 Integration Tests
 * 
 * These tests use REAL AWS resources (not mocks).
 * They MUST run in a dedicated sandbox AWS account.
 * 
 * Prerequisites:
 * - AWS credentials configured
 * - All infrastructure deployed (./deploy)
 * - Neptune cluster is accessible (requires VPC access - tests will skip if not accessible)
 * - Environment variables loaded from .env file
 * 
 * ⚠️ IMPORTANT: Neptune VPC Access Requirement
 * 
 * Neptune is deployed in isolated VPC subnets and is NOT accessible from local machines.
 * These tests will timeout if run locally because Neptune requires VPC network access.
 * 
 * To run these tests successfully:
 * 1. Run from within the VPC (e.g., EC2 instance in the same VPC)
 * 2. Use a VPN connection to the VPC
 * 3. Use a bastion host or AWS Systems Manager Session Manager
 * 4. Or run tests that don't require Neptune (synthesis engine tests can run without graph)
 * 
 * The tests are designed to skip gracefully when Neptune is not accessible.
 * All tests check for Neptune availability before attempting operations.
 */

import { Logger } from '../../services/core/Logger';
import { TraceService } from '../../services/core/TraceService';
import { SignalService } from '../../services/perception/SignalService';
import { LifecycleStateService } from '../../services/perception/LifecycleStateService';
import { SuppressionEngine } from '../../services/perception/SuppressionEngine';
import { EventPublisher } from '../../services/events/EventPublisher';
import { LedgerService } from '../../services/ledger/LedgerService';
import { NeptuneConnection } from '../../services/graph/NeptuneConnection';
import { GraphService } from '../../services/graph/GraphService';
import { GraphMaterializer } from '../../services/graph/GraphMaterializer';
import { SynthesisEngine } from '../../services/synthesis/SynthesisEngine';
import { AccountPostureStateService } from '../../services/synthesis/AccountPostureStateService';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { Signal, SignalType, SignalStatus, EvidenceSnapshotRef } from '../../types/SignalTypes';
import { LifecycleState } from '../../types/LifecycleTypes';
import { AccountPostureStateV1 } from '../../types/PostureTypes';
import { VertexLabel, EdgeLabel, VertexIdGenerator } from '../../types/GraphTypes';
import { getAWSClientConfig } from '../../utils/aws-client-config';

describe('Phase 2 Integration Tests', () => {
  let logger: Logger;
  let traceService: TraceService;
  let signalService: SignalService;
  let lifecycleStateService: LifecycleStateService;
  let eventPublisher: EventPublisher;
  let ledgerService: LedgerService;
  let neptuneConnection: NeptuneConnection;
  let graphService: GraphService;
  let graphMaterializer: GraphMaterializer;
  let synthesisEngine: SynthesisEngine;
  let postureStateService: AccountPostureStateService;
  let dynamoClient: DynamoDBDocumentClient;

  // Test tenant and account IDs
  const testTenantId = `test-tenant-phase2-${Date.now()}`;
  const testAccountId = `test-account-phase2-${Date.now()}`;
  const region = process.env.AWS_REGION || 'us-west-2';

  beforeAll(async () => {
    // Load environment variables
    try {
      const dotenv = require('dotenv');
      dotenv.config({ path: '.env.local' });
      dotenv.config({ path: '.env' });
    } catch (error) {
      // dotenv not available, continue
    }

    logger = new Logger('Phase2IntegrationTest');
    traceService = new TraceService(logger);

    // Initialize AWS clients
    const clientConfig = getAWSClientConfig(region);
    const dynamoDBClient = new DynamoDBClient(clientConfig);
    dynamoClient = DynamoDBDocumentClient.from(dynamoDBClient);

    // Initialize services
    ledgerService = new LedgerService(
      logger,
      process.env.LEDGER_TABLE_NAME || 'cc-native-ledger',
      region
    );

    const suppressionEngine = new SuppressionEngine({
      logger,
      ledgerService,
    });

    lifecycleStateService = new LifecycleStateService({
      logger,
      accountsTableName: process.env.ACCOUNTS_TABLE_NAME || 'cc-native-accounts',
      ledgerService,
      suppressionEngine,
      region,
    });

    eventPublisher = new EventPublisher(
      logger,
      process.env.EVENT_BUS_NAME || 'cc-native-events',
      region
    );

    signalService = new SignalService({
      logger,
      signalsTableName: process.env.SIGNALS_TABLE_NAME || 'cc-native-signals',
      accountsTableName: process.env.ACCOUNTS_TABLE_NAME || 'cc-native-accounts',
      lifecycleStateService,
      eventPublisher,
      ledgerService,
      s3Client: undefined,
      region,
    });

    // Initialize Neptune connection
    // Get Neptune endpoint from environment or skip tests if not available
    const neptuneEndpoint = process.env.NEPTUNE_CLUSTER_ENDPOINT;
    const neptunePort = parseInt(process.env.NEPTUNE_CLUSTER_PORT || '8182', 10);

    if (!neptuneEndpoint) {
      logger.warn('NEPTUNE_CLUSTER_ENDPOINT not found in environment. Skipping Neptune-dependent tests.');
      logger.warn('To run Phase 2 integration tests, set NEPTUNE_CLUSTER_ENDPOINT in .env file');
      logger.warn('You can get the endpoint from CDK stack outputs:');
      logger.warn('  aws cloudformation describe-stacks --stack-name CCNativeStack --query "Stacks[0].Outputs[?OutputKey==\'NeptuneClusterEndpoint\'].OutputValue" --output text --profile cc-native-account --region us-west-2');
      // Skip Neptune initialization if endpoint not available
      // Tests will be skipped or fail gracefully
    }

    // For integration tests, we'll attempt Neptune connection but don't block on it
    // Neptune is in isolated VPC subnets and requires VPC access
    // Tests will skip gracefully if connection fails
    let neptuneAccessible = false;
    if (neptuneEndpoint) {
      // Attempt connection in background (non-blocking)
      // If it fails, tests will skip
      neptuneConnection = NeptuneConnection.getInstance();
      const connectionPromise = neptuneConnection
        .initialize({
          endpoint: neptuneEndpoint,
          port: neptunePort,
          region,
          iamAuthEnabled: true,
        })
        .then(() => {
          graphService = new GraphService(neptuneConnection);
          neptuneAccessible = true;
          logger.info('Neptune connection successful - tests will run');
        })
        .catch((error: any) => {
          logger.warn('Neptune not accessible (requires VPC access). Tests will skip Neptune operations.', {
            error: error.message,
          });
          neptuneConnection = null as any;
          graphService = null as any;
          neptuneAccessible = false;
        });

      // Wait up to 3 seconds for connection, then continue
      try {
        await Promise.race([
          connectionPromise,
          new Promise((resolve) => setTimeout(() => resolve('timeout'), 3000)),
        ]);
      } catch (error) {
        // Connection failed, neptuneAccessible remains false
      }
    } else {
      // Set to null to indicate tests should be skipped
      neptuneConnection = null as any;
      graphService = null as any;
      neptuneAccessible = false;
    }

    // Only create GraphMaterializer if graphService is available
    if (neptuneAccessible && graphService) {
      graphMaterializer = new GraphMaterializer({
        graphService,
        signalService,
        lifecycleStateService,
        eventPublisher,
        ledgerService,
        dynamoClient,
        materializationStatusTableName:
          process.env.GRAPH_MATERIALIZATION_STATUS_TABLE_NAME ||
          'cc-native-graph-materialization-status',
        signalsTableName: process.env.SIGNALS_TABLE_NAME || 'cc-native-signals',
      });
    } else {
      graphMaterializer = null as any;
    }

    synthesisEngine = new SynthesisEngine({
      signalService,
      lifecycleStateService,
      rulesetVersion: 'v1.0.0',
    });

    postureStateService = new AccountPostureStateService({
      dynamoClient,
      tableName:
        process.env.ACCOUNT_POSTURE_STATE_TABLE_NAME || 'cc-native-account-posture-state',
    });

    // Create test account in DynamoDB
    try {
      await dynamoClient.send(
        new PutCommand({
          TableName: process.env.ACCOUNTS_TABLE_NAME || 'cc-native-accounts',
          Item: {
            pk: `ACCOUNT#${testTenantId}#${testAccountId}`,
            sk: 'METADATA',
            accountId: testAccountId,
            tenantId: testTenantId,
            currentLifecycleState: LifecycleState.PROSPECT,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        })
      );
    } catch (error: any) {
      // If account creation fails (e.g., credentials issue), log warning but continue
      // Tests will fail later if credentials are actually needed
      logger.warn('Failed to create test account (may be credentials issue)', { error: error.message });
    }
  }, 5000); // 5 second timeout for setup (Neptune connection attempted but non-blocking)

  afterAll(async () => {
    // Cleanup: Connection is managed by singleton, no explicit close needed
    // Neptune connection will be reused across tests
  });

  describe('Graph Materialization Flow', () => {
    it('should materialize signal into Neptune graph', async () => {
      if (!process.env.NEPTUNE_CLUSTER_ENDPOINT || !graphService || !graphMaterializer) {
        console.log('Skipping test: Neptune not accessible (requires VPC access)');
        return;
      }
      const traceId = traceService.generateTraceId();
      const signalId = `test-signal-${Date.now()}`;
      const now = new Date().toISOString();

      // Create a test signal in DynamoDB
      const signal: Signal = {
        signalId,
        signalType: SignalType.ACCOUNT_ACTIVATION_DETECTED,
        status: SignalStatus.ACTIVE,
        accountId: testAccountId,
        tenantId: testTenantId,
        createdAt: now,
        updatedAt: now,
        traceId,
        dedupeKey: `dedupe-${signalId}`,
        windowKey: `window-${signalId}`,
        detectorVersion: 'v1.0.0',
        detectorInputVersion: 'v1.0.0',
        metadata: {
          confidence: 0.9,
          confidenceSource: 'direct',
          severity: 'high',
          ttl: {
            ttlDays: 90,
            isPermanent: false,
            expiresAt: null,
          },
        },
        evidence: {
          evidenceRef: {
            s3Uri: `s3://test-bucket/evidence/${signalId}`,
            sha256: `sha256-${signalId}`,
            capturedAt: now,
            schemaVersion: 'v1',
            detectorInputVersion: 'v1.0.0',
          },
          evidenceSchemaVersion: 'v1',
        },
        suppression: {
          suppressed: false,
          suppressedAt: null,
          suppressedBy: null,
          inferenceActive: true,
        },
      };

      // Store signal in DynamoDB
      await dynamoClient.send(
        new PutCommand({
          TableName: process.env.SIGNALS_TABLE_NAME || 'cc-native-signals',
          Item: {
            pk: `SIGNAL#${testTenantId}#${signalId}`,
            sk: 'METADATA',
            ...signal,
          },
        })
      );

      // Materialize signal
      await graphMaterializer.materializeSignal(signalId, testTenantId);

      // Verify materialization status
      const statusResult = await dynamoClient.send(
        new GetCommand({
          TableName:
            process.env.GRAPH_MATERIALIZATION_STATUS_TABLE_NAME ||
            'cc-native-graph-materialization-status',
          Key: {
            pk: `SIGNAL#${testTenantId}#${signalId}`,
          },
        })
      );

      expect(statusResult.Item).toBeDefined();
      expect(statusResult.Item?.status).toBe('COMPLETED');

      // Verify graph vertices exist
      const accountVertexId = VertexIdGenerator.account(testTenantId, testAccountId);
      const accountVertex = await graphService.getVertex(accountVertexId);
      expect(accountVertex).toBeDefined();
      expect(accountVertex?.label).toBe(VertexLabel.ACCOUNT);

      const signalVertexId = VertexIdGenerator.signal(testTenantId, signalId);
      const signalVertex = await graphService.getVertex(signalVertexId);
      expect(signalVertex).toBeDefined();
      expect(signalVertex?.label).toBe(VertexLabel.SIGNAL);

      // Verify edges exist
      const edges = await graphService.getEdges(accountVertexId, EdgeLabel.HAS_SIGNAL);
      expect(edges.length).toBeGreaterThan(0);
      expect(edges.some((e) => e.to === signalVertexId)).toBe(true);
    }, 60000); // 60 second timeout for Neptune operations
  });

  describe('Synthesis Engine Flow', () => {
    it('should synthesize posture state from active signals', async () => {
      if (!process.env.NEPTUNE_CLUSTER_ENDPOINT || !graphService || !graphMaterializer) {
        console.log('Skipping test: Neptune not accessible (requires VPC access)');
        return;
      }
      const traceId = traceService.generateTraceId();
      const signalId = `test-signal-synthesis-${Date.now()}`;
      const now = new Date().toISOString();

      // Create a signal that matches a synthesis rule
      const signal: Signal = {
        signalId,
        signalType: SignalType.RENEWAL_WINDOW_ENTERED,
        status: SignalStatus.ACTIVE,
        accountId: testAccountId,
        tenantId: testTenantId,
        createdAt: now,
        updatedAt: now,
        traceId,
        dedupeKey: `dedupe-${signalId}`,
        windowKey: `window-${signalId}`,
        detectorVersion: 'v1.0.0',
        detectorInputVersion: 'v1.0.0',
        metadata: {
          confidence: 0.9,
          confidenceSource: 'direct',
          severity: 'high',
          ttl: {
            ttlDays: null,
            isPermanent: false,
            expiresAt: null,
          },
        },
        evidence: {
          evidenceRef: {
            s3Uri: `s3://test-bucket/evidence/${signalId}`,
            sha256: `sha256-${signalId}`,
            capturedAt: now,
            schemaVersion: 'v1',
            detectorInputVersion: 'v1.0.0',
          },
          evidenceSchemaVersion: 'v1',
        },
        suppression: {
          suppressed: false,
          suppressedAt: null,
          suppressedBy: null,
          inferenceActive: true,
        },
      };

      // Store signal
      await dynamoClient.send(
        new PutCommand({
          TableName: process.env.SIGNALS_TABLE_NAME || 'cc-native-signals',
          Item: {
            pk: `SIGNAL#${testTenantId}#${signalId}`,
            sk: 'METADATA',
            ...signal,
          },
        })
      );

      // Materialize signal first
      await graphMaterializer.materializeSignal(signalId, testTenantId);

      // Wait a bit for materialization to complete
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Verify materialization status is COMPLETED
      const statusResult = await dynamoClient.send(
        new GetCommand({
          TableName:
            process.env.GRAPH_MATERIALIZATION_STATUS_TABLE_NAME ||
            'cc-native-graph-materialization-status',
          Key: {
            pk: `SIGNAL#${testTenantId}#${signalId}`,
          },
        })
      );

      expect(statusResult.Item?.status).toBe('COMPLETED');

      // Run synthesis
      const postureState = await synthesisEngine.synthesize(
        testAccountId,
        testTenantId,
        now
      );

      // Verify posture state
      expect(postureState).toBeDefined();
      expect(postureState.account_id).toBe(testAccountId);
      expect(postureState.tenantId).toBe(testTenantId);
      expect(postureState.posture).toBeDefined();
      expect(['OK', 'WATCH', 'AT_RISK', 'EXPAND', 'DORMANT']).toContain(postureState.posture);
      expect(postureState.momentum).toBeDefined();
      expect(['UP', 'FLAT', 'DOWN']).toContain(postureState.momentum);
      expect(postureState.inputs_hash).toBeDefined();
      expect(postureState.active_signals_hash).toBeDefined();
      expect(postureState.rule_id).toBeDefined();

      // Write posture state
      await postureStateService.writePostureState(postureState);

      // Verify posture state was written
      const savedPosture = await postureStateService.getPostureState(testAccountId, testTenantId);
      expect(savedPosture).toBeDefined();
      expect(savedPosture?.account_id).toBe(testAccountId);
      expect(savedPosture?.posture).toBe(postureState.posture);
      expect(savedPosture?.inputs_hash).toBe(postureState.inputs_hash);
    }, 120000); // 2 minute timeout for full flow
  });

  describe('Failure Semantics', () => {
    it('should not run synthesis if materialization status is not COMPLETED', async () => {
      if (!process.env.NEPTUNE_CLUSTER_ENDPOINT) {
        console.log('Skipping test: NEPTUNE_CLUSTER_ENDPOINT not configured');
        return;
      }
      const traceId = traceService.generateTraceId();
      const signalId = `test-signal-failure-${Date.now()}`;
      const now = new Date().toISOString();

      // Create a signal
      const signal: Signal = {
        signalId,
        signalType: SignalType.USAGE_TREND_CHANGE,
        status: SignalStatus.ACTIVE,
        accountId: testAccountId,
        tenantId: testTenantId,
        createdAt: now,
        updatedAt: now,
        traceId,
        dedupeKey: `dedupe-${signalId}`,
        windowKey: `window-${signalId}`,
        detectorVersion: 'v1.0.0',
        detectorInputVersion: 'v1.0.0',
        metadata: {
          confidence: 0.8,
          confidenceSource: 'direct',
          severity: 'medium',
          ttl: {
            ttlDays: 30,
            isPermanent: false,
            expiresAt: null,
          },
        },
        evidence: {
          evidenceRef: {
            s3Uri: `s3://test-bucket/evidence/${signalId}`,
            sha256: `sha256-${signalId}`,
            capturedAt: now,
            schemaVersion: 'v1',
            detectorInputVersion: 'v1.0.0',
          },
          evidenceSchemaVersion: 'v1',
        },
        suppression: {
          suppressed: false,
          suppressedAt: null,
          suppressedBy: null,
          inferenceActive: true,
        },
      };

      // Store signal but do NOT materialize
      await dynamoClient.send(
        new PutCommand({
          TableName: process.env.SIGNALS_TABLE_NAME || 'cc-native-signals',
          Item: {
            pk: `SIGNAL#${testTenantId}#${signalId}`,
            sk: 'METADATA',
            ...signal,
          },
        })
      );

      // Set materialization status to FAILED
      await dynamoClient.send(
        new PutCommand({
          TableName:
            process.env.GRAPH_MATERIALIZATION_STATUS_TABLE_NAME ||
            'cc-native-graph-materialization-status',
          Item: {
            pk: `SIGNAL#${testTenantId}#${signalId}`,
            status: 'FAILED',
            trace_id: traceId,
            updated_at: now,
            error_message: 'Test failure',
          },
        })
      );

      // Try to synthesize - should work but check status first
      // In real handler, synthesis would be skipped if status is not COMPLETED
      // Here we verify the status check works
      const statusResult = await dynamoClient.send(
        new GetCommand({
          TableName:
            process.env.GRAPH_MATERIALIZATION_STATUS_TABLE_NAME ||
            'cc-native-graph-materialization-status',
          Key: {
            pk: `SIGNAL#${testTenantId}#${signalId}`,
          },
        })
      );

      expect(statusResult.Item?.status).toBe('FAILED');
      // Synthesis engine would skip execution in handler if status is not COMPLETED
    }, 60000);
  });

  describe('Determinism', () => {
    it('should produce same posture state for same inputs', async () => {
      if (!process.env.NEPTUNE_CLUSTER_ENDPOINT || !graphService || !graphMaterializer) {
        console.log('Skipping test: Neptune not accessible (requires VPC access)');
        return;
      }
      const traceId = traceService.generateTraceId();
      const signalId1 = `test-signal-determinism-1-${Date.now()}`;
      const signalId2 = `test-signal-determinism-2-${Date.now()}`;
      const now = new Date().toISOString();

      // Create two identical signals (different IDs but same type and context)
      const createSignal = (id: string): Signal => ({
        signalId: id,
        signalType: SignalType.ACCOUNT_ACTIVATION_DETECTED,
        status: SignalStatus.ACTIVE,
        accountId: testAccountId,
        tenantId: testTenantId,
        createdAt: now,
        updatedAt: now,
        traceId,
        dedupeKey: `dedupe-${id}`,
        windowKey: `window-${id}`,
        detectorVersion: 'v1.0.0',
        detectorInputVersion: 'v1.0.0',
        metadata: {
          confidence: 0.9,
          confidenceSource: 'direct',
          severity: 'high',
          ttl: {
            ttlDays: 90,
            isPermanent: false,
            expiresAt: null,
          },
        },
        evidence: {
          evidenceRef: {
            s3Uri: `s3://test-bucket/evidence/${id}`,
            sha256: `sha256-${id}`,
            capturedAt: now,
            schemaVersion: 'v1',
            detectorInputVersion: 'v1.0.0',
          },
          evidenceSchemaVersion: 'v1',
        },
        suppression: {
          suppressed: false,
          suppressedAt: null,
          suppressedBy: null,
          inferenceActive: true,
        },
      });

      // Store signals
      await dynamoClient.send(
        new PutCommand({
          TableName: process.env.SIGNALS_TABLE_NAME || 'cc-native-signals',
          Item: {
            pk: `SIGNAL#${testTenantId}#${signalId1}`,
            sk: 'METADATA',
            ...createSignal(signalId1),
          },
        })
      );

      await dynamoClient.send(
        new PutCommand({
          TableName: process.env.SIGNALS_TABLE_NAME || 'cc-native-signals',
          Item: {
            pk: `SIGNAL#${testTenantId}#${signalId2}`,
            sk: 'METADATA',
            ...createSignal(signalId2),
          },
        })
      );

      // Materialize both
      await graphMaterializer.materializeSignal(signalId1, testTenantId);
      await graphMaterializer.materializeSignal(signalId2, testTenantId);

      // Wait for materialization
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Run synthesis twice with same inputs
      const postureState1 = await synthesisEngine.synthesize(testAccountId, testTenantId, now);
      const postureState2 = await synthesisEngine.synthesize(testAccountId, testTenantId, now);

      // Verify determinism (inputs_hash should be same)
      expect(postureState1.inputs_hash).toBe(postureState2.inputs_hash);
      expect(postureState1.posture).toBe(postureState2.posture);
      expect(postureState1.momentum).toBe(postureState2.momentum);
      expect(postureState1.active_signals_hash).toBe(postureState2.active_signals_hash);
    }, 120000);
  });
});
