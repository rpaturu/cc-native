import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as neptune from 'aws-cdk-lib/aws-neptune';
import { Construct } from 'constructs';
// ✅ REFACTORED: Import new constructs
import { NeptuneInfrastructure } from './constructs/NeptuneInfrastructure';
import { SecurityMonitoring } from './constructs/SecurityMonitoring';
import { PerceptionHandlers } from './constructs/PerceptionHandlers';
import { GraphIntelligenceHandlers } from './constructs/GraphIntelligenceHandlers';

export interface CCNativeStackProps extends cdk.StackProps {
  // Add any custom props here
}

export class CCNativeStack extends cdk.Stack {
  // S3 Buckets (World Model Architecture: S3 as Truth)
  public readonly evidenceLedgerBucket: s3.IBucket;        // Evidence storage (versioned)
  public readonly worldStateSnapshotsBucket: s3.IBucket;   // World state snapshots (versioned)
  public readonly schemaRegistryBucket: s3.IBucket;       // Schema definitions (versioned)
  public readonly artifactsBucket: s3.IBucket;             // Artifacts (versioned)
  public readonly ledgerArchivesBucket: s3.IBucket;        // Execution ledger archives (versioned)

  // DynamoDB Tables (World Model Architecture: DynamoDB as Belief)
  // World Model Tables
  public readonly worldStateTable: dynamodb.Table;        // Computed entity state
  public readonly evidenceIndexTable: dynamodb.Table;     // Evidence index (points to S3)
  public readonly snapshotsIndexTable: dynamodb.Table;    // Snapshot index (points to S3)
  public readonly schemaRegistryTable: dynamodb.Table;    // Schema registry index
  public readonly criticalFieldRegistryTable: dynamodb.Table; // Critical field registry
  
  // Application Tables
  public readonly accountsTable: dynamodb.Table;
  public readonly signalsTable: dynamodb.Table;
  public readonly toolRunsTable: dynamodb.Table;
  public readonly approvalRequestsTable: dynamodb.Table;
  public readonly actionQueueTable: dynamodb.Table;
  public readonly policyConfigTable: dynamodb.Table;
  public readonly ledgerTable: dynamodb.Table;
  public readonly cacheTable: dynamodb.Table;
  public readonly tenantsTable: dynamodb.Table;
  
  // Methodology Tables
  public readonly methodologyTable: dynamodb.Table;
  public readonly assessmentTable: dynamodb.Table;

  // Identity Tables
  public readonly identitiesTable: dynamodb.Table;

  // EventBridge
  public readonly eventBus: events.EventBus;

  // KMS Keys
  public readonly tenantEncryptionKey: kms.Key;

  // IAM Roles
  public readonly agentRole: iam.Role;

  // Cognito
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;

  // Phase 1: Perception Lambda Functions
  public readonly connectorPollHandler: lambda.Function;
  public readonly signalDetectionHandler: lambda.Function;
  public readonly lifecycleInferenceHandler: lambda.Function;

  // Phase 1: DLQs for handlers
  public readonly connectorPollDlq: sqs.Queue;
  public readonly signalDetectionDlq: sqs.Queue;
  public readonly lifecycleInferenceDlq: sqs.Queue;

  // Phase 2: Neptune Graph Infrastructure
  public readonly vpc: ec2.Vpc;
  public readonly neptuneCluster: neptune.CfnDBCluster;
  public readonly neptuneSecurityGroup: ec2.SecurityGroup;
  public readonly neptuneAccessRole: iam.Role;

  // Graph Intelligence: DynamoDB Tables (graph materialization and synthesis)
  public readonly accountPostureStateTable: dynamodb.Table;
  public readonly graphMaterializationStatusTable: dynamodb.Table;

  // Graph Intelligence: Lambda Functions
  public readonly graphMaterializerHandler: lambda.Function;
  public readonly synthesisEngineHandler: lambda.Function;

  // Graph Intelligence: DLQs
  public readonly graphMaterializerDlq: sqs.Queue;
  public readonly synthesisEngineDlq: sqs.Queue;


  constructor(scope: Construct, id: string, props?: CCNativeStackProps) {
    super(scope, id, props);

    // S3 Buckets (World Model: S3 as Truth - versioned for history)
    // Support using existing buckets from .env.local (via context) or create new ones
    this.evidenceLedgerBucket = this.createOrImportBucket(
      'evidenceLedgerBucket',
      'EvidenceLedgerBucket',
      `cc-native-evidence-ledger-${this.account}-${this.region}`
    );

    this.worldStateSnapshotsBucket = this.createOrImportBucket(
      'worldStateSnapshotsBucket',
      'WorldStateSnapshotsBucket',
      `cc-native-world-state-snapshots-${this.account}-${this.region}`
    );

    this.schemaRegistryBucket = this.createOrImportBucket(
      'schemaRegistryBucket',
      'SchemaRegistryBucket',
      `cc-native-schema-registry-${this.account}-${this.region}`
    );

    this.artifactsBucket = this.createOrImportBucket(
      'artifactsBucket',
      'ArtifactsBucket',
      `cc-native-artifacts-${this.account}-${this.region}`
    );

    this.ledgerArchivesBucket = this.createOrImportBucket(
      'ledgerArchivesBucket',
      'LedgerArchivesBucket',
      `cc-native-ledger-archives-${this.account}-${this.region}`
    );

    // DynamoDB Tables (World Model: DynamoDB as Computed Belief)
    
    // World State Table (computed entity state)
    this.worldStateTable = new dynamodb.Table(this, 'WorldStateTable', {
      tableName: 'cc-native-world-state',
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
    });

    // Add GSI for entity type queries
    this.worldStateTable.addGlobalSecondaryIndex({
      indexName: 'entityType-index',
      partitionKey: { name: 'gsi1pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'gsi1sk', type: dynamodb.AttributeType.STRING },
    });

    // Evidence Index Table (points to S3 evidence)
    this.evidenceIndexTable = new dynamodb.Table(this, 'EvidenceIndexTable', {
      tableName: 'cc-native-evidence-index',
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
    });

    // Add GSI for entity type + timestamp queries
    this.evidenceIndexTable.addGlobalSecondaryIndex({
      indexName: 'entityType-index',
      partitionKey: { name: 'gsi1pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'gsi1sk', type: dynamodb.AttributeType.STRING },
    });

    // Snapshots Index Table (points to S3 snapshots)
    this.snapshotsIndexTable = new dynamodb.Table(this, 'SnapshotsIndexTable', {
      tableName: 'cc-native-snapshots-index',
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
    });

    // Add GSI for entity type + timestamp queries
    this.snapshotsIndexTable.addGlobalSecondaryIndex({
      indexName: 'entityType-index',
      partitionKey: { name: 'gsi1pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'gsi1sk', type: dynamodb.AttributeType.STRING },
    });

    // Schema Registry Table (schema index)
    this.schemaRegistryTable = new dynamodb.Table(this, 'SchemaRegistryTable', {
      tableName: 'cc-native-schema-registry',
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
    });

    // Critical Field Registry Table
    this.criticalFieldRegistryTable = new dynamodb.Table(this, 'CriticalFieldRegistryTable', {
      tableName: 'cc-native-critical-field-registry',
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
    });

    // Application Tables
    this.accountsTable = new dynamodb.Table(this, 'AccountsTable', {
      tableName: 'cc-native-accounts',
      partitionKey: { name: 'tenantId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'accountId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
    });

    this.signalsTable = new dynamodb.Table(this, 'SignalsTable', {
      tableName: 'cc-native-signals',
      partitionKey: { name: 'tenantId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'signalId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
    });

    // Add GSI for accountId queries
    this.signalsTable.addGlobalSecondaryIndex({
      indexName: 'accountId-index',
      partitionKey: { name: 'accountId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.STRING },
    });

    this.toolRunsTable = new dynamodb.Table(this, 'ToolRunsTable', {
      tableName: 'cc-native-tool-runs',
      partitionKey: { name: 'traceId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'toolRunId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
    });

    this.approvalRequestsTable = new dynamodb.Table(this, 'ApprovalRequestsTable', {
      tableName: 'cc-native-approval-requests',
      partitionKey: { name: 'tenantId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'requestId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
    });

    this.actionQueueTable = new dynamodb.Table(this, 'ActionQueueTable', {
      tableName: 'cc-native-action-queue',
      partitionKey: { name: 'tenantId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'actionId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
    });

    this.policyConfigTable = new dynamodb.Table(this, 'PolicyConfigTable', {
      tableName: 'cc-native-policy-config',
      partitionKey: { name: 'tenantId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'policyId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
    });

    // Ledger Table (append-only audit trail)
    this.ledgerTable = new dynamodb.Table(this, 'LedgerTable', {
      tableName: 'cc-native-ledger',
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
    });

    // Add GSI for traceId queries
    this.ledgerTable.addGlobalSecondaryIndex({
      indexName: 'gsi1-index',
      partitionKey: { name: 'gsi1pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'gsi1sk', type: dynamodb.AttributeType.STRING },
    });

    // Add GSI for time-range queries (tenant + timestamp)
    this.ledgerTable.addGlobalSecondaryIndex({
      indexName: 'gsi2-index',
      partitionKey: { name: 'gsi2pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'gsi2sk', type: dynamodb.AttributeType.STRING },
    });

    // Cache Table (TTL-based cache)
    this.cacheTable = new dynamodb.Table(this, 'CacheTable', {
      tableName: 'cc-native-cache',
      partitionKey: { name: 'cacheKey', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      // Cache doesn't need PITR (default is disabled)
    });

    // Tenants Table (tenant configuration and metadata)
    this.tenantsTable = new dynamodb.Table(this, 'TenantsTable', {
      tableName: 'cc-native-tenants',
      partitionKey: { name: 'tenantId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
    });

    // Methodology Table (methodology definitions)
    this.methodologyTable = new dynamodb.Table(this, 'MethodologyTable', {
      tableName: 'cc-native-methodology',
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
    });

    // Add GSI for tenant + status queries
    this.methodologyTable.addGlobalSecondaryIndex({
      indexName: 'tenant-status-index',
      partitionKey: { name: 'gsi1pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'gsi1sk', type: dynamodb.AttributeType.STRING },
    });

    // Assessment Table (methodology assessments)
    this.assessmentTable = new dynamodb.Table(this, 'AssessmentTable', {
      tableName: 'cc-native-assessment',
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
    });

    // Add GSI for opportunity + methodology + status queries (getActiveAssessment)
    this.assessmentTable.addGlobalSecondaryIndex({
      indexName: 'opportunity-methodology-index',
      partitionKey: { name: 'gsi1pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'gsi1sk', type: dynamodb.AttributeType.STRING },
    });

    // Identities Table (user and agent identities)
    this.identitiesTable = new dynamodb.Table(this, 'IdentitiesTable', {
      tableName: 'cc-native-identities',
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
    });

    // Add GSI for tenant queries
    this.identitiesTable.addGlobalSecondaryIndex({
      indexName: 'tenant-index',
      partitionKey: { name: 'gsi1pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'gsi1sk', type: dynamodb.AttributeType.STRING },
    });

    // EventBridge Custom Bus
    this.eventBus = new events.EventBus(this, 'CCNativeEventBus', {
      eventBusName: 'cc-native-events',
    });

    // KMS Key for tenant encryption
    this.tenantEncryptionKey = new kms.Key(this, 'TenantEncryptionKey', {
      description: 'KMS key for tenant data encryption',
      enableKeyRotation: true,
    });

    // IAM Role for Agents (Read-Only Access)
    // Per AGENT_READ_POLICY.md Section 10.1
    this.agentRole = new iam.Role(this, 'AgentRole', {
      roleName: 'cc-native-agent-role',
      assumedBy: new iam.CompositePrincipal(
        new iam.ServicePrincipal('lambda.amazonaws.com'),
        new iam.ServicePrincipal('bedrock.amazonaws.com') // For AgentCore Identity
      ),
      description: 'Read-only IAM role for autonomous agents (World Model read access only)',
    });

    // Read-only DynamoDB policy
    this.agentRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'dynamodb:GetItem',
        'dynamodb:Query',
        'dynamodb:Scan',
      ],
      resources: [
        `arn:aws:dynamodb:${this.region}:${this.account}:table/cc-native-*`,
      ],
      conditions: {
        StringEquals: {
          'dynamodb:ReadConsistency': 'eventual',
        },
      },
    }));

    // Read-only S3 policy (evidence and snapshots only)
    this.agentRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['s3:GetObject'],
      resources: [
        `arn:aws:s3:::${this.evidenceLedgerBucket.bucketName}/evidence/*`,
        `arn:aws:s3:::${this.worldStateSnapshotsBucket.bucketName}/snapshots/*`,
      ],
    }));

    // Explicit deny for write operations (fail-closed security)
    this.agentRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.DENY,
      actions: [
        'dynamodb:PutItem',
        'dynamodb:UpdateItem',
        'dynamodb:DeleteItem',
        'dynamodb:BatchWriteItem',
        's3:PutObject',
        's3:DeleteObject',
        's3:PutObjectAcl',
      ],
      resources: ['*'],
    }));

    // Cognito User Pool for user authentication
    this.userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: 'cc-native-users',
      selfSignUpEnabled: false, // Admin-controlled user creation
      signInAliases: {
        email: true,
        username: false,
      },
      autoVerify: {
        email: true,
      },
      passwordPolicy: {
        minLength: 12,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: cdk.RemovalPolicy.RETAIN, // Retain users on stack deletion
    });

    // User Pool Client
    this.userPoolClient = this.userPool.addClient('WebClient', {
      userPoolClientName: 'cc-native-web-client',
      generateSecret: false, // Public client for web apps
      authFlows: {
        userPassword: true,
        userSrp: true,
      },
      preventUserExistenceErrors: true,
    });

    // ✅ REFACTORED: Use NeptuneInfrastructure construct
    const neptuneInfra = new NeptuneInfrastructure(this, 'NeptuneInfrastructure', {
      region: this.region,
    });
    // Assign to readonly properties
    (this as CCNativeStack & { vpc: ec2.Vpc }).vpc = neptuneInfra.vpc;
    (this as CCNativeStack & { neptuneCluster: neptune.CfnDBCluster }).neptuneCluster = neptuneInfra.neptuneCluster;
    (this as CCNativeStack & { neptuneSecurityGroup: ec2.SecurityGroup }).neptuneSecurityGroup = neptuneInfra.neptuneSecurityGroup;
    (this as CCNativeStack & { neptuneAccessRole: iam.Role }).neptuneAccessRole = neptuneInfra.neptuneAccessRole;

    // ✅ REFACTORED: Use GraphIntelligenceHandlers construct (graph materialization and synthesis)
    const graphIntelligenceHandlers = new GraphIntelligenceHandlers(this, 'GraphIntelligenceHandlers', {
      eventBus: this.eventBus,
      accountsTable: this.accountsTable,
      signalsTable: this.signalsTable,
      ledgerTable: this.ledgerTable,
      vpc: neptuneInfra.vpc,
      neptuneCluster: neptuneInfra.neptuneCluster,
      graphMaterializerSecurityGroup: neptuneInfra.graphMaterializerSecurityGroup,
      synthesisEngineSecurityGroup: neptuneInfra.synthesisEngineSecurityGroup,
      region: this.region,
      account: this.account,
    });
    // Assign to readonly properties
    (this as CCNativeStack & { accountPostureStateTable: dynamodb.Table }).accountPostureStateTable = graphIntelligenceHandlers.accountPostureStateTable;
    (this as CCNativeStack & { graphMaterializationStatusTable: dynamodb.Table }).graphMaterializationStatusTable = graphIntelligenceHandlers.graphMaterializationStatusTable;
    (this as CCNativeStack & { graphMaterializerHandler: lambda.Function }).graphMaterializerHandler = graphIntelligenceHandlers.graphMaterializerHandler;
    (this as CCNativeStack & { synthesisEngineHandler: lambda.Function }).synthesisEngineHandler = graphIntelligenceHandlers.synthesisEngineHandler;
    (this as CCNativeStack & { graphMaterializerDlq: sqs.Queue }).graphMaterializerDlq = graphIntelligenceHandlers.graphMaterializerDlq;
    (this as CCNativeStack & { synthesisEngineDlq: sqs.Queue }).synthesisEngineDlq = graphIntelligenceHandlers.synthesisEngineDlq;

    // ✅ REFACTORED: Use SecurityMonitoring construct (must be after GraphIntelligenceHandlers)
    const securityMonitoring = new SecurityMonitoring(this, 'SecurityMonitoring', {
      neptuneCluster: neptuneInfra.neptuneCluster,
      graphMaterializerHandler: graphIntelligenceHandlers.graphMaterializerHandler,
      synthesisEngineHandler: graphIntelligenceHandlers.synthesisEngineHandler,
      region: this.region,
      neptuneAuditLogGroup: neptuneInfra.neptuneAuditLogGroup,
    });

    // Stack Outputs
    // World Model S3 Buckets
    new cdk.CfnOutput(this, 'EvidenceLedgerBucketName', {
      value: this.evidenceLedgerBucket.bucketName,
      description: 'S3 bucket for evidence ledger (versioned, World Model truth)',
    });

    new cdk.CfnOutput(this, 'WorldStateSnapshotsBucketName', {
      value: this.worldStateSnapshotsBucket.bucketName,
      description: 'S3 bucket for world state snapshots (versioned)',
    });

    new cdk.CfnOutput(this, 'SchemaRegistryBucketName', {
      value: this.schemaRegistryBucket.bucketName,
      description: 'S3 bucket for schema registry definitions (versioned)',
    });

    // Application S3 Buckets
    new cdk.CfnOutput(this, 'ArtifactsBucketName', {
      value: this.artifactsBucket.bucketName,
      description: 'S3 bucket for artifacts (briefs, summaries, etc.)',
    });

    new cdk.CfnOutput(this, 'LedgerArchivesBucketName', {
      value: this.ledgerArchivesBucket.bucketName,
      description: 'S3 bucket for execution ledger archives',
    });

    // EventBridge
    new cdk.CfnOutput(this, 'EventBusName', {
      value: this.eventBus.eventBusName,
      description: 'EventBridge custom event bus name',
    });

    // World Model DynamoDB Tables
    new cdk.CfnOutput(this, 'WorldStateTableName', {
      value: this.worldStateTable.tableName,
      description: 'DynamoDB table for computed world state (belief layer)',
    });

    new cdk.CfnOutput(this, 'EvidenceIndexTableName', {
      value: this.evidenceIndexTable.tableName,
      description: 'DynamoDB table for evidence index (points to S3 evidence)',
    });

    new cdk.CfnOutput(this, 'SnapshotsIndexTableName', {
      value: this.snapshotsIndexTable.tableName,
      description: 'DynamoDB table for snapshots index (points to S3 snapshots)',
    });

    new cdk.CfnOutput(this, 'SchemaRegistryTableName', {
      value: this.schemaRegistryTable.tableName,
      description: 'DynamoDB table for schema registry index',
    });

    new cdk.CfnOutput(this, 'CriticalFieldRegistryTableName', {
      value: this.criticalFieldRegistryTable.tableName,
      description: 'DynamoDB table for critical field registry',
    });

    // Application DynamoDB Tables
    new cdk.CfnOutput(this, 'LedgerTableName', {
      value: this.ledgerTable.tableName,
      description: 'DynamoDB table for execution ledger (append-only audit trail)',
    });

    new cdk.CfnOutput(this, 'CacheTableName', {
      value: this.cacheTable.tableName,
      description: 'DynamoDB table for TTL-based cache',
    });

    new cdk.CfnOutput(this, 'TenantsTableName', {
      value: this.tenantsTable.tableName,
      description: 'DynamoDB table for tenant configuration and metadata',
    });

    new cdk.CfnOutput(this, 'AccountsTableName', {
      value: this.accountsTable.tableName,
      description: 'DynamoDB table for account metadata',
    });

    new cdk.CfnOutput(this, 'SignalsTableName', {
      value: this.signalsTable.tableName,
      description: 'DynamoDB table for signals',
    });

    // Methodology Tables
    new cdk.CfnOutput(this, 'MethodologyTableName', {
      value: this.methodologyTable.tableName,
      description: 'DynamoDB table for methodology definitions',
    });

    new cdk.CfnOutput(this, 'AssessmentTableName', {
      value: this.assessmentTable.tableName,
      description: 'DynamoDB table for methodology assessments',
    });

    // Identity Tables
    new cdk.CfnOutput(this, 'IdentitiesTableName', {
      value: this.identitiesTable.tableName,
      description: 'DynamoDB table for user and agent identities',
    });

    // IAM Roles
    new cdk.CfnOutput(this, 'AgentRoleArn', {
      value: this.agentRole.roleArn,
      description: 'IAM role ARN for autonomous agents (read-only access)',
    });

    // Cognito
    new cdk.CfnOutput(this, 'UserPoolId', {
      value: this.userPool.userPoolId,
      description: 'Cognito User Pool ID for user authentication',
    });

    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: this.userPoolClient.userPoolClientId,
      description: 'Cognito User Pool Client ID',
    });

    // Graph Intelligence: Neptune Outputs
    new cdk.CfnOutput(this, 'NeptuneClusterEndpoint', {
      value: this.neptuneCluster.attrEndpoint,
      description: 'Neptune cluster endpoint (Gremlin)',
    });

    new cdk.CfnOutput(this, 'NeptuneClusterPort', {
      value: this.neptuneCluster.attrPort,
      description: 'Neptune cluster port (Gremlin)',
    });

    new cdk.CfnOutput(this, 'NeptuneClusterIdentifier', {
      value: this.neptuneCluster.ref,
      description: 'Neptune cluster identifier',
    });

    new cdk.CfnOutput(this, 'NeptuneAccessRoleArn', {
      value: this.neptuneAccessRole.roleArn,
      description: 'IAM role ARN for accessing Neptune cluster',
    });

    new cdk.CfnOutput(this, 'VpcId', {
      value: this.vpc.vpcId,
      description: 'VPC ID for Neptune cluster',
    });

    // Output subnet IDs for test runner setup
    new cdk.CfnOutput(this, 'NeptuneSubnetIds', {
      value: this.vpc.isolatedSubnets.map(subnet => subnet.subnetId).join(','),
      description: 'Comma-separated list of Neptune subnet IDs (for test runner setup)',
    });

    // Output first subnet ID for convenience (most common use case)
    new cdk.CfnOutput(this, 'NeptuneSubnetId', {
      value: this.vpc.isolatedSubnets[0].subnetId,
      description: 'First Neptune subnet ID (for test runner setup)',
    });

    // ✅ REFACTORED: Use PerceptionHandlers construct
    const perceptionHandlers = new PerceptionHandlers(this, 'PerceptionHandlers', {
      eventBus: this.eventBus,
      evidenceLedgerBucket: this.evidenceLedgerBucket,
      evidenceIndexTable: this.evidenceIndexTable,
      accountsTable: this.accountsTable,
      signalsTable: this.signalsTable,
      ledgerTable: this.ledgerTable,
    });
    // Assign to readonly properties
    (this as CCNativeStack & { connectorPollHandler: lambda.Function }).connectorPollHandler = perceptionHandlers.connectorPollHandler;
    (this as CCNativeStack & { signalDetectionHandler: lambda.Function }).signalDetectionHandler = perceptionHandlers.signalDetectionHandler;
    (this as CCNativeStack & { lifecycleInferenceHandler: lambda.Function }).lifecycleInferenceHandler = perceptionHandlers.lifecycleInferenceHandler;
    (this as CCNativeStack & { connectorPollDlq: sqs.Queue }).connectorPollDlq = perceptionHandlers.connectorPollDlq;
    (this as CCNativeStack & { signalDetectionDlq: sqs.Queue }).signalDetectionDlq = perceptionHandlers.signalDetectionDlq;
    (this as CCNativeStack & { lifecycleInferenceDlq: sqs.Queue }).lifecycleInferenceDlq = perceptionHandlers.lifecycleInferenceDlq;

    // Perception Handlers Outputs
    new cdk.CfnOutput(this, 'ConnectorPollHandlerArn', {
      value: perceptionHandlers.connectorPollHandler.functionArn,
      description: 'ARN of connector poll handler Lambda function',
    });

    new cdk.CfnOutput(this, 'SignalDetectionHandlerArn', {
      value: perceptionHandlers.signalDetectionHandler.functionArn,
      description: 'ARN of signal detection handler Lambda function',
    });

    new cdk.CfnOutput(this, 'LifecycleInferenceHandlerArn', {
      value: perceptionHandlers.lifecycleInferenceHandler.functionArn,
      description: 'ARN of lifecycle inference handler Lambda function',
    });

    // Graph Intelligence Handlers Outputs
    new cdk.CfnOutput(this, 'GraphMaterializerHandlerArn', {
      value: graphIntelligenceHandlers.graphMaterializerHandler.functionArn,
      description: 'ARN of graph materializer handler Lambda function',
    });

    new cdk.CfnOutput(this, 'SynthesisEngineHandlerArn', {
      value: graphIntelligenceHandlers.synthesisEngineHandler.functionArn,
      description: 'ARN of synthesis engine handler Lambda function',
    });

    new cdk.CfnOutput(this, 'AccountPostureStateTableName', {
      value: graphIntelligenceHandlers.accountPostureStateTable.tableName,
      description: 'DynamoDB table for account posture state read model',
    });

    new cdk.CfnOutput(this, 'GraphMaterializationStatusTableName', {
      value: graphIntelligenceHandlers.graphMaterializationStatusTable.tableName,
      description: 'DynamoDB table for graph materialization status (synthesis gating)',
    });
  }

  /**
   * Helper method to create or import S3 bucket
   * Reduces code duplication for bucket creation
   */
  private createOrImportBucket(
    contextKey: string,
    constructId: string,
    defaultBucketName: string
  ): s3.IBucket {
    const bucketName = this.node.tryGetContext(contextKey) as string | undefined;
    
    // If no bucket name provided, create a new bucket
    if (!bucketName) {
      return new s3.Bucket(this, constructId, {
        bucketName: defaultBucketName,
        versioned: true,
        encryption: s3.BucketEncryption.S3_MANAGED,
        enforceSSL: true, // Require SSL/TLS for all requests (CWE-319)
        // Object Lock removed for development flexibility - can be added back for production compliance
      });
    }
    
    // Validate bucket name format
    const trimmedBucketName = bucketName.trim();
    if (trimmedBucketName.length === 0) {
      throw new Error(`Invalid bucket name for context key '${contextKey}': must be a non-empty string`);
    }
    
    // Import existing bucket
    try {
      return s3.Bucket.fromBucketName(this, constructId, trimmedBucketName);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to import bucket '${trimmedBucketName}' for context key '${contextKey}': ${errorMessage}`);
    }
  }
}
