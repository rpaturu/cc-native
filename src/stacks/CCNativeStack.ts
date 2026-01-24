import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as eventsTargets from 'aws-cdk-lib/aws-events-targets';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as neptune from 'aws-cdk-lib/aws-neptune';
import { Construct } from 'constructs';

export interface CCNativeStackProps extends cdk.StackProps {
  // Add any custom props here
}

/**
 * Internal properties for Neptune infrastructure
 * These are not exposed as readonly public properties
 */
interface NeptuneInternalProperties {
  neptuneLambdaSecurityGroup: ec2.SecurityGroup;
  neptuneSubnets: string[];
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

  // Phase 2: DynamoDB Tables
  public readonly accountPostureStateTable: dynamodb.Table;
  public readonly graphMaterializationStatusTable: dynamodb.Table;

  // Phase 2: Lambda Functions
  public readonly graphMaterializerHandler: lambda.Function;
  public readonly synthesisEngineHandler: lambda.Function;

  // Phase 2: DLQs
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

    // Phase 2: Neptune Graph Infrastructure
    this.createNeptuneInfrastructure();

    // Phase 2: DynamoDB Tables
    this.createPhase2Tables();

    // Phase 2: Lambda Functions and EventBridge Rules
    this.createPhase2Handlers();

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

    // Phase 2: Neptune Outputs
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

    // Phase 1: Perception Lambda Functions
    this.createPerceptionHandlers();
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
    const bucketNameFinal = bucketName || defaultBucketName;

    if (bucketName) {
      // Use existing bucket
      return s3.Bucket.fromBucketName(this, constructId, bucketName);
    } else {
      // Create new bucket with standard configuration
      return new s3.Bucket(this, constructId, {
        bucketName: bucketNameFinal,
        versioned: true,
        encryption: s3.BucketEncryption.S3_MANAGED,
        enforceSSL: true, // Require SSL/TLS for all requests (CWE-319)
        // Object Lock removed for development flexibility - can be added back for production compliance
      });
    }
  }

  /**
   * Create Phase 2 Neptune graph infrastructure
   */
  private createNeptuneInfrastructure(): void {
    // Create VPC with isolated subnets for Neptune
    // Neptune requires at least 2 AZs, so we'll create subnets in 2 AZs
    // Note: Neptune doesn't need internet access, so isolated subnets are fine
    const vpc = new ec2.Vpc(this, 'CCNativeVpc', {
      vpcName: 'cc-native-vpc',
      maxAzs: 2, // Neptune requires at least 2 AZs
      natGateways: 0, // No NAT gateways needed - Neptune doesn't need internet access
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'NeptuneIsolated',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED, // Isolated subnets (no internet, no NAT)
        },
      ],
    });
    // Assign directly - TypeScript allows assignment to readonly properties during construction
    (this as CCNativeStack & { vpc: ec2.Vpc }).vpc = vpc;

    // Security group for Neptune cluster
    const neptuneSecurityGroup = new ec2.SecurityGroup(this, 'NeptuneSecurityGroup', {
      vpc: vpc,
      description: 'Security group for Neptune cluster (VPC-only access)',
      allowAllOutbound: false, // Restrict outbound traffic
    });
    // Assign directly - TypeScript allows assignment to readonly properties during construction
    (this as CCNativeStack & { neptuneSecurityGroup: ec2.SecurityGroup }).neptuneSecurityGroup = neptuneSecurityGroup;

    // Security group for Lambda functions to access Neptune
    const lambdaSecurityGroup = new ec2.SecurityGroup(this, 'NeptuneLambdaSecurityGroup', {
      vpc: vpc,
      description: 'Security group for Lambda functions accessing Neptune',
      allowAllOutbound: true,
    });

    // Allow Lambda to connect to Neptune on Gremlin port (8182)
    neptuneSecurityGroup.addIngressRule(
      lambdaSecurityGroup,
      ec2.Port.tcp(8182),
      'Allow Gremlin connections from Lambda'
    );

    // Neptune Subnet Group (L1 construct)
    const neptuneSubnetGroup = new neptune.CfnDBSubnetGroup(this, 'NeptuneSubnetGroup', {
      dbSubnetGroupName: 'cc-native-neptune-subnet-group',
      dbSubnetGroupDescription: 'Subnet group for Neptune cluster',
      subnetIds: vpc.isolatedSubnets.map(subnet => subnet.subnetId),
      tags: [
        { key: 'Name', value: 'cc-native-neptune-subnet-group' },
      ],
    });

    // Neptune Parameter Group (L1 construct)
    const neptuneParameterGroup = new neptune.CfnDBClusterParameterGroup(this, 'NeptuneParameterGroup', {
      description: 'Parameter group for Neptune cluster',
      family: 'neptune1.4', // Neptune engine family (updated to 1.4 for current Neptune service version)
      parameters: {
        neptune_query_timeout: '120000', // 2 minutes
        neptune_enable_audit_log: '1',
      },
    });

    // Neptune Cluster (L1 construct) - must be created before instances
    const neptuneCluster = new neptune.CfnDBCluster(this, 'NeptuneCluster', {
      dbClusterIdentifier: 'cc-native-neptune-cluster',
      dbSubnetGroupName: neptuneSubnetGroup.ref,
      dbClusterParameterGroupName: neptuneParameterGroup.ref,
      vpcSecurityGroupIds: [neptuneSecurityGroup.securityGroupId],
      backupRetentionPeriod: 7,
      preferredBackupWindow: '03:00-04:00',
      preferredMaintenanceWindow: 'sun:04:00-sun:05:00',
      storageEncrypted: true,
      deletionProtection: false, // Disable for development
      iamAuthEnabled: true, // Enable IAM authentication
      tags: [
        { key: 'Name', value: 'cc-native-neptune-cluster' },
      ],
    });

    // Neptune Cluster Instance (L1 construct) - must reference cluster
    // Note: Security groups and cluster parameter group are inherited from the cluster
    // Do NOT set dbParameterGroupName - instances inherit cluster-level parameters
    const neptuneInstance = new neptune.CfnDBInstance(this, 'NeptuneInstance', {
      dbInstanceIdentifier: 'cc-native-neptune-instance',
      dbInstanceClass: 'db.r5.large', // Instance type for development
      dbClusterIdentifier: neptuneCluster.ref,
      dbSubnetGroupName: neptuneSubnetGroup.ref,
      // dbParameterGroupName removed - instances inherit cluster parameter group
      publiclyAccessible: false,
      tags: [
        { key: 'Name', value: 'cc-native-neptune-instance' },
      ],
    });

    // Instance depends on cluster
    neptuneInstance.addDependency(neptuneCluster);

    // Assign directly - TypeScript allows assignment to readonly properties during construction
    (this as CCNativeStack & { neptuneCluster: neptune.CfnDBCluster }).neptuneCluster = neptuneCluster;

    // IAM Role for Lambda functions to access Neptune
    const neptuneAccessRole = new iam.Role(this, 'NeptuneAccessRole', {
      roleName: 'cc-native-neptune-access-role',
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'IAM role for Lambda functions to access Neptune cluster',
    });
    // Assign directly - TypeScript allows assignment to readonly properties during construction
    (this as CCNativeStack & { neptuneAccessRole: iam.Role }).neptuneAccessRole = neptuneAccessRole;

    // Grant Neptune access permissions
    neptuneAccessRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'neptune-db:connect',
        'neptune-db:ReadDataViaQuery',
        'neptune-db:WriteDataViaQuery',
      ],
      resources: [
        `arn:aws:neptune-db:${this.region}:${this.account}:${neptuneCluster.ref}/*`,
      ],
    }));

    // Add VPC configuration to Lambda (will be used by Phase 2 handlers)
    // Store security group and subnet IDs for later use
    // These are internal properties, not exposed as readonly
    (this as unknown as CCNativeStack & NeptuneInternalProperties).neptuneLambdaSecurityGroup = lambdaSecurityGroup;
    (this as unknown as CCNativeStack & NeptuneInternalProperties).neptuneSubnets = vpc.isolatedSubnets.map(subnet => subnet.subnetId);
  }

  /**
   * Helper method to create a Lambda function with standard configuration
   * Reduces code duplication for Lambda creation
   */
  private createLambdaFunction(
    id: string,
    functionName: string,
    entry: string,
    environment: Record<string, string>,
    deadLetterQueue: sqs.Queue,
    timeout: cdk.Duration,
    memorySize: number
  ): lambda.Function {
    return new lambdaNodejs.NodejsFunction(this, id, {
      functionName,
      entry,
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout,
      memorySize,
      environment,
      deadLetterQueue,
      deadLetterQueueEnabled: true,
      retryAttempts: 2,
    });
  }

  /**
   * Create Phase 1 perception handlers with DLQs and EventBridge rules
   */
  private createPerceptionHandlers(): void {
    // Common environment variables for all handlers
    // Note: AWS_REGION is automatically set by Lambda runtime and cannot be set manually
    const commonEnv = {
      ACCOUNTS_TABLE_NAME: this.accountsTable.tableName,
      SIGNALS_TABLE_NAME: this.signalsTable.tableName,
      LEDGER_TABLE_NAME: this.ledgerTable.tableName,
      EVIDENCE_INDEX_TABLE_NAME: this.evidenceIndexTable.tableName,
      EVIDENCE_LEDGER_BUCKET: this.evidenceLedgerBucket.bucketName,
      EVENT_BUS_NAME: this.eventBus.eventBusName,
      // AWS_REGION is automatically available via process.env.AWS_REGION in Lambda
    };

    // Create DLQs - assign directly to readonly properties
    (this as CCNativeStack & { connectorPollDlq: sqs.Queue }).connectorPollDlq = new sqs.Queue(this, 'ConnectorPollDlq', {
      queueName: 'cc-native-connector-poll-handler-dlq',
      retentionPeriod: cdk.Duration.days(14),
    });

    (this as CCNativeStack & { signalDetectionDlq: sqs.Queue }).signalDetectionDlq = new sqs.Queue(this, 'SignalDetectionDlq', {
      queueName: 'cc-native-signal-detection-handler-dlq',
      retentionPeriod: cdk.Duration.days(14),
    });

    (this as CCNativeStack & { lifecycleInferenceDlq: sqs.Queue }).lifecycleInferenceDlq = new sqs.Queue(this, 'LifecycleInferenceDlq', {
      queueName: 'cc-native-lifecycle-inference-handler-dlq',
      retentionPeriod: cdk.Duration.days(14),
    });

    // Connector Poll Handler
    const connectorPollHandler = this.createLambdaFunction(
      'ConnectorPollHandler',
      'cc-native-connector-poll-handler',
      'src/handlers/perception/connector-poll-handler.ts',
      commonEnv,
      this.connectorPollDlq,
      cdk.Duration.minutes(15),
      512
    );
    (this as CCNativeStack & { connectorPollHandler: lambda.Function }).connectorPollHandler = connectorPollHandler;

    // Grant permissions
    this.evidenceLedgerBucket.grantReadWrite(connectorPollHandler);
    this.evidenceIndexTable.grantReadWriteData(connectorPollHandler);
    this.eventBus.grantPutEventsTo(connectorPollHandler);

    // Signal Detection Handler
    const signalDetectionHandler = this.createLambdaFunction(
      'SignalDetectionHandler',
      'cc-native-signal-detection-handler',
      'src/handlers/perception/signal-detection-handler.ts',
      commonEnv,
      this.signalDetectionDlq,
      cdk.Duration.minutes(15),
      1024
    );
    (this as CCNativeStack & { signalDetectionHandler: lambda.Function }).signalDetectionHandler = signalDetectionHandler;

    // Grant permissions
    this.evidenceLedgerBucket.grantRead(signalDetectionHandler);
    this.signalsTable.grantReadWriteData(signalDetectionHandler);
    this.accountsTable.grantReadWriteData(signalDetectionHandler);
    this.ledgerTable.grantWriteData(signalDetectionHandler);
    this.eventBus.grantPutEventsTo(signalDetectionHandler);

    // Lifecycle Inference Handler
    const lifecycleInferenceHandler = this.createLambdaFunction(
      'LifecycleInferenceHandler',
      'cc-native-lifecycle-inference-handler',
      'src/handlers/perception/lifecycle-inference-handler.ts',
      commonEnv,
      this.lifecycleInferenceDlq,
      cdk.Duration.minutes(5),
      512
    );
    (this as CCNativeStack & { lifecycleInferenceHandler: lambda.Function }).lifecycleInferenceHandler = lifecycleInferenceHandler;

    // Grant permissions
    this.accountsTable.grantReadWriteData(lifecycleInferenceHandler);
    this.signalsTable.grantReadData(lifecycleInferenceHandler);
    this.ledgerTable.grantWriteData(lifecycleInferenceHandler);
    this.eventBus.grantPutEventsTo(lifecycleInferenceHandler);

    // EventBridge Rules

    // Rule 1: CONNECTOR_POLL_COMPLETED → signal-detection-handler
    new events.Rule(this, 'ConnectorPollCompletedRule', {
      eventBus: this.eventBus,
      eventPattern: {
        source: ['cc-native.perception'],
        detailType: ['CONNECTOR_POLL_COMPLETED'],
      },
      targets: [
        new eventsTargets.LambdaFunction(signalDetectionHandler, {
          deadLetterQueue: this.signalDetectionDlq,
          retryAttempts: 2,
        }),
      ],
    });

    // Rule 2: SIGNAL_DETECTED → lifecycle-inference-handler
    new events.Rule(this, 'SignalDetectedRule', {
      eventBus: this.eventBus,
      eventPattern: {
        source: ['cc-native.perception'],
        detailType: ['SIGNAL_DETECTED', 'SIGNAL_CREATED'],
      },
      targets: [
        new eventsTargets.LambdaFunction(lifecycleInferenceHandler, {
          deadLetterQueue: this.lifecycleInferenceDlq,
          retryAttempts: 2,
        }),
      ],
    });

    // Outputs
    new cdk.CfnOutput(this, 'ConnectorPollHandlerArn', {
      value: connectorPollHandler.functionArn,
      description: 'ARN of connector poll handler Lambda function',
    });

    new cdk.CfnOutput(this, 'SignalDetectionHandlerArn', {
      value: signalDetectionHandler.functionArn,
      description: 'ARN of signal detection handler Lambda function',
    });

    new cdk.CfnOutput(this, 'LifecycleInferenceHandlerArn', {
      value: lifecycleInferenceHandler.functionArn,
      description: 'ARN of lifecycle inference handler Lambda function',
    });
  }

  /**
   * Create Phase 2 DynamoDB tables
   */
  private createPhase2Tables(): void {
    // Account Posture State Table
    const accountPostureStateTable = new dynamodb.Table(this, 'AccountPostureStateTable', {
      tableName: 'cc-native-account-posture-state',
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
    });

    // Add GSI for tenant + posture queries
    accountPostureStateTable.addGlobalSecondaryIndex({
      indexName: 'tenant-posture-index',
      partitionKey: { name: 'gsi1pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'gsi1sk', type: dynamodb.AttributeType.STRING },
    });

    // Assign to readonly property
    (this as CCNativeStack & { accountPostureStateTable: dynamodb.Table }).accountPostureStateTable = accountPostureStateTable;

    // Graph Materialization Status Table
    // This is the ONLY authoritative gating mechanism for synthesis
    const graphMaterializationStatusTable = new dynamodb.Table(this, 'GraphMaterializationStatusTable', {
      tableName: 'cc-native-graph-materialization-status',
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
    });

    // Assign to readonly property
    (this as CCNativeStack & { graphMaterializationStatusTable: dynamodb.Table }).graphMaterializationStatusTable = graphMaterializationStatusTable;
  }

  /**
   * Create Phase 2 Lambda handlers with DLQs and EventBridge rules
   */
  private createPhase2Handlers(): void {
    // Get Neptune Lambda security group and subnets from internal properties
    const neptuneLambdaSecurityGroup = (this as any).neptuneLambdaSecurityGroup as ec2.SecurityGroup;
    const neptuneSubnets = (this as any).neptuneSubnets as string[];

    // Common environment variables for Phase 2 handlers
    const phase2Env = {
      ACCOUNTS_TABLE_NAME: this.accountsTable.tableName,
      SIGNALS_TABLE_NAME: this.signalsTable.tableName,
      LEDGER_TABLE_NAME: this.ledgerTable.tableName,
      EVENT_BUS_NAME: this.eventBus.eventBusName,
      NEPTUNE_CLUSTER_ENDPOINT: this.neptuneCluster.attrEndpoint,
      NEPTUNE_CLUSTER_PORT: this.neptuneCluster.attrPort,
      ACCOUNT_POSTURE_STATE_TABLE_NAME: this.accountPostureStateTable.tableName,
      GRAPH_MATERIALIZATION_STATUS_TABLE_NAME: this.graphMaterializationStatusTable.tableName,
      // AWS_REGION is automatically available via process.env.AWS_REGION in Lambda
    };

    // Create DLQs for Phase 2 handlers
    (this as CCNativeStack & { graphMaterializerDlq: sqs.Queue }).graphMaterializerDlq = new sqs.Queue(this, 'GraphMaterializerDlq', {
      queueName: 'cc-native-graph-materializer-handler-dlq',
      retentionPeriod: cdk.Duration.days(14),
    });

    (this as CCNativeStack & { synthesisEngineDlq: sqs.Queue }).synthesisEngineDlq = new sqs.Queue(this, 'SynthesisEngineDlq', {
      queueName: 'cc-native-synthesis-engine-handler-dlq',
      retentionPeriod: cdk.Duration.days(14),
    });

    // Graph Materializer Handler
    const graphMaterializerHandler = new lambdaNodejs.NodejsFunction(this, 'GraphMaterializerHandler', {
      functionName: 'cc-native-graph-materializer-handler',
      entry: 'src/handlers/phase2/graph-materializer-handler.ts',
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.minutes(5),
      memorySize: 1024,
      environment: phase2Env,
      deadLetterQueue: this.graphMaterializerDlq,
      deadLetterQueueEnabled: true,
      retryAttempts: 2,
      // VPC configuration for Neptune access
      vpc: this.vpc,
      vpcSubnets: { subnets: this.vpc.isolatedSubnets },
      securityGroups: [neptuneLambdaSecurityGroup],
    });
    (this as CCNativeStack & { graphMaterializerHandler: lambda.Function }).graphMaterializerHandler = graphMaterializerHandler;

    // Grant permissions for Graph Materializer
    this.signalsTable.grantReadData(graphMaterializerHandler);
    this.accountsTable.grantReadData(graphMaterializerHandler);
    this.graphMaterializationStatusTable.grantReadWriteData(graphMaterializerHandler);
    this.ledgerTable.grantWriteData(graphMaterializerHandler);
    this.eventBus.grantPutEventsTo(graphMaterializerHandler);
    graphMaterializerHandler.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'neptune-db:connect',
        'neptune-db:ReadDataViaQuery',
        'neptune-db:WriteDataViaQuery',
      ],
      resources: [
        `arn:aws:neptune-db:${this.region}:${this.account}:${this.neptuneCluster.ref}/*`,
      ],
    }));

    // Synthesis Engine Handler
    const synthesisEngineHandler = new lambdaNodejs.NodejsFunction(this, 'SynthesisEngineHandler', {
      functionName: 'cc-native-synthesis-engine-handler',
      entry: 'src/handlers/phase2/synthesis-engine-handler.ts',
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.minutes(3),
      memorySize: 1024,
      environment: phase2Env,
      deadLetterQueue: this.synthesisEngineDlq,
      deadLetterQueueEnabled: true,
      retryAttempts: 2,
      // VPC configuration for Neptune access
      vpc: this.vpc,
      vpcSubnets: { subnets: this.vpc.isolatedSubnets },
      securityGroups: [neptuneLambdaSecurityGroup],
    });
    (this as CCNativeStack & { synthesisEngineHandler: lambda.Function }).synthesisEngineHandler = synthesisEngineHandler;

    // Grant permissions for Synthesis Engine
    this.signalsTable.grantReadData(synthesisEngineHandler);
    this.accountsTable.grantReadData(synthesisEngineHandler);
    this.accountPostureStateTable.grantReadWriteData(synthesisEngineHandler);
    this.graphMaterializationStatusTable.grantReadData(synthesisEngineHandler);
    this.ledgerTable.grantWriteData(synthesisEngineHandler);
    synthesisEngineHandler.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'neptune-db:connect',
        'neptune-db:ReadDataViaQuery',
        'neptune-db:WriteDataViaQuery',
      ],
      resources: [
        `arn:aws:neptune-db:${this.region}:${this.account}:${this.neptuneCluster.ref}/*`,
      ],
    }));

    // EventBridge Rules for Phase 2

    // Rule 3: SIGNAL_DETECTED → graph-materializer-handler
    new events.Rule(this, 'SignalDetectedToGraphMaterializerRule', {
      eventBus: this.eventBus,
      eventPattern: {
        source: ['cc-native.perception'],
        detailType: ['SIGNAL_DETECTED'],
      },
      targets: [
        new eventsTargets.LambdaFunction(graphMaterializerHandler, {
          deadLetterQueue: this.graphMaterializerDlq,
          retryAttempts: 2,
        }),
      ],
    });

    // Rule 4: SIGNAL_CREATED → graph-materializer-handler
    new events.Rule(this, 'SignalCreatedToGraphMaterializerRule', {
      eventBus: this.eventBus,
      eventPattern: {
        source: ['cc-native.perception'],
        detailType: ['SIGNAL_CREATED'],
      },
      targets: [
        new eventsTargets.LambdaFunction(graphMaterializerHandler, {
          deadLetterQueue: this.graphMaterializerDlq,
          retryAttempts: 2,
        }),
      ],
    });

    // Rule 5: GRAPH_MATERIALIZED → synthesis-engine-handler (canonical path)
    new events.Rule(this, 'GraphMaterializedToSynthesisRule', {
      eventBus: this.eventBus,
      eventPattern: {
        source: ['cc-native.graph'],
        detailType: ['GRAPH_MATERIALIZED'],
      },
      targets: [
        new eventsTargets.LambdaFunction(synthesisEngineHandler, {
          deadLetterQueue: this.synthesisEngineDlq,
          retryAttempts: 2,
        }),
      ],
    });

    // Phase 2 Outputs
    new cdk.CfnOutput(this, 'GraphMaterializerHandlerArn', {
      value: graphMaterializerHandler.functionArn,
      description: 'ARN of graph materializer handler Lambda function',
    });

    new cdk.CfnOutput(this, 'SynthesisEngineHandlerArn', {
      value: synthesisEngineHandler.functionArn,
      description: 'ARN of synthesis engine handler Lambda function',
    });

    new cdk.CfnOutput(this, 'AccountPostureStateTableName', {
      value: this.accountPostureStateTable.tableName,
      description: 'DynamoDB table for account posture state read model',
    });

    new cdk.CfnOutput(this, 'GraphMaterializationStatusTableName', {
      value: this.graphMaterializationStatusTable.tableName,
      description: 'DynamoDB table for graph materialization status (synthesis gating)',
    });
  }
}
