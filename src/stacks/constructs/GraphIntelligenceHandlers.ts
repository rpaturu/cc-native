import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as events from 'aws-cdk-lib/aws-events';
import * as eventsTargets from 'aws-cdk-lib/aws-events-targets';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as neptune from 'aws-cdk-lib/aws-neptune';
import { Construct } from 'constructs';

export interface GraphIntelligenceHandlersProps {
  readonly eventBus: events.EventBus;
  readonly accountsTable: dynamodb.Table;
  readonly signalsTable: dynamodb.Table;
  readonly ledgerTable: dynamodb.Table;
  readonly vpc: ec2.Vpc;
  readonly neptuneCluster: neptune.CfnDBCluster;
  readonly graphMaterializerSecurityGroup: ec2.SecurityGroup;
  readonly synthesisEngineSecurityGroup: ec2.SecurityGroup;
  readonly region: string;
  readonly account: string;
}

export interface GraphIntelligenceHandlersResult {
  readonly accountPostureStateTable: dynamodb.Table;
  readonly graphMaterializationStatusTable: dynamodb.Table;
  readonly graphMaterializerHandler: lambda.Function;
  readonly synthesisEngineHandler: lambda.Function;
  readonly graphMaterializerDlq: sqs.Queue;
  readonly synthesisEngineDlq: sqs.Queue;
}

/**
 * Construct for graph intelligence handlers (graph materialization and synthesis)
 * Creates DynamoDB tables, Lambda functions, DLQs, and EventBridge rules
 * 
 * Graph Materialization: Converts signals into graph structure in Neptune
 * Synthesis: Synthesizes account posture state from the graph
 */
export class GraphIntelligenceHandlers extends Construct {
  public readonly accountPostureStateTable: dynamodb.Table;
  public readonly graphMaterializationStatusTable: dynamodb.Table;
  public readonly graphMaterializerHandler: lambda.Function;
  public readonly synthesisEngineHandler: lambda.Function;
  public readonly graphMaterializerDlq: sqs.Queue;
  public readonly synthesisEngineDlq: sqs.Queue;

  constructor(scope: Construct, id: string, props: GraphIntelligenceHandlersProps) {
    super(scope, id);

    // Account Posture State Table
    this.accountPostureStateTable = new dynamodb.Table(this, 'AccountPostureStateTable', {
      tableName: 'cc-native-account-posture-state',
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
    });
    // Override logical ID to match existing CloudFormation resource
    (this.accountPostureStateTable.node.defaultChild as cdk.CfnResource).overrideLogicalId('AccountPostureStateTable');

    // Add GSI for tenant + posture queries
    this.accountPostureStateTable.addGlobalSecondaryIndex({
      indexName: 'tenant-posture-index',
      partitionKey: { name: 'gsi1pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'gsi1sk', type: dynamodb.AttributeType.STRING },
    });

    // Graph Materialization Status Table
    // This is the ONLY authoritative gating mechanism for synthesis
    this.graphMaterializationStatusTable = new dynamodb.Table(this, 'GraphMaterializationStatusTable', {
      tableName: 'cc-native-graph-materialization-status',
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
    });
    // Override logical ID to match existing CloudFormation resource
    (this.graphMaterializationStatusTable.node.defaultChild as cdk.CfnResource).overrideLogicalId('GraphMaterializationStatusTable');

    // Common environment variables for graph intelligence handlers
    const graphIntelligenceEnv = {
      ACCOUNTS_TABLE_NAME: props.accountsTable.tableName,
      SIGNALS_TABLE_NAME: props.signalsTable.tableName,
      LEDGER_TABLE_NAME: props.ledgerTable.tableName,
      EVENT_BUS_NAME: props.eventBus.eventBusName,
      NEPTUNE_CLUSTER_ENDPOINT: props.neptuneCluster.attrEndpoint,
      NEPTUNE_CLUSTER_PORT: props.neptuneCluster.attrPort,
      ACCOUNT_POSTURE_STATE_TABLE_NAME: this.accountPostureStateTable.tableName,
      GRAPH_MATERIALIZATION_STATUS_TABLE_NAME: this.graphMaterializationStatusTable.tableName,
      // AWS_REGION is automatically available via process.env.AWS_REGION in Lambda
    };

    // Create DLQs for graph intelligence handlers
    this.graphMaterializerDlq = new sqs.Queue(this, 'GraphMaterializerDlq', {
      queueName: 'cc-native-graph-materializer-handler-dlq',
      retentionPeriod: cdk.Duration.days(14),
    });

    this.synthesisEngineDlq = new sqs.Queue(this, 'SynthesisEngineDlq', {
      queueName: 'cc-native-synthesis-engine-handler-dlq',
      retentionPeriod: cdk.Duration.days(14),
    });

    // ✅ Zero Trust: Create dedicated IAM role for Graph Materializer
    const graphMaterializerRole = new iam.Role(this, 'GraphMaterializerRole', {
      roleName: 'cc-native-graph-materializer-role',
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'IAM role for graph-materializer Lambda function',
    });

    // Add VPC permissions (REQUIRED for Lambda in VPC)
    graphMaterializerRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaVPCAccessExecutionRole')
    );

    // ✅ Zero Trust: Create dedicated IAM role for Synthesis Engine
    const synthesisEngineRole = new iam.Role(this, 'SynthesisEngineRole', {
      roleName: 'cc-native-synthesis-engine-role',
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'IAM role for synthesis-engine Lambda function',
    });

    // Add VPC permissions (REQUIRED for Lambda in VPC)
    synthesisEngineRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaVPCAccessExecutionRole')
    );

    // Graph Materializer Handler
    this.graphMaterializerHandler = new lambdaNodejs.NodejsFunction(this, 'GraphMaterializerHandler', {
      functionName: 'cc-native-graph-materializer-handler',
      entry: 'src/handlers/phase2/graph-materializer-handler.ts',
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.minutes(5),
      memorySize: 1024,
      environment: graphIntelligenceEnv,
      deadLetterQueue: this.graphMaterializerDlq,
      deadLetterQueueEnabled: true,
      retryAttempts: 2,
      // VPC configuration for Neptune access
      vpc: props.vpc,
      vpcSubnets: { subnets: props.vpc.isolatedSubnets },
      securityGroups: [props.graphMaterializerSecurityGroup], // ✅ Use per-function security group
      role: graphMaterializerRole,  // ✅ Use dedicated role
    });
    // Override logical ID to match existing CloudFormation resource
    (this.graphMaterializerHandler.node.defaultChild as cdk.CfnResource).overrideLogicalId('GraphMaterializerHandler');

    // Grant permissions for Graph Materializer
    props.signalsTable.grantReadData(this.graphMaterializerHandler);
    props.accountsTable.grantReadData(this.graphMaterializerHandler);
    this.graphMaterializationStatusTable.grantReadWriteData(this.graphMaterializerHandler);
    props.ledgerTable.grantWriteData(this.graphMaterializerHandler);
    props.eventBus.grantPutEventsTo(this.graphMaterializerHandler);

    // ✅ Zero Trust: Add Neptune permissions to role with conditions
    graphMaterializerRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'neptune-db:connect',
        'neptune-db:ReadDataViaQuery',
        'neptune-db:WriteDataViaQuery',
      ],
      resources: [
        `arn:aws:neptune-db:${props.region}:${props.account}:${props.neptuneCluster.ref}/*`,
      ],
      conditions: {
        // Require encryption in transit (HTTPS/TLS)
        Bool: {
          'aws:SecureTransport': 'true',
        },
        // Optional: Restrict query language to Gremlin only
        StringEquals: {
          'neptune-db:QueryLanguage': 'gremlin',
        },
      },
    }));

    // Synthesis Engine Handler
    this.synthesisEngineHandler = new lambdaNodejs.NodejsFunction(this, 'SynthesisEngineHandler', {
      functionName: 'cc-native-synthesis-engine-handler',
      entry: 'src/handlers/phase2/synthesis-engine-handler.ts',
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.minutes(3),
      memorySize: 1024,
      environment: graphIntelligenceEnv,
      deadLetterQueue: this.synthesisEngineDlq,
      deadLetterQueueEnabled: true,
      retryAttempts: 2,
      // VPC configuration for Neptune access
      vpc: props.vpc,
      vpcSubnets: { subnets: props.vpc.isolatedSubnets },
      securityGroups: [props.synthesisEngineSecurityGroup], // ✅ Use per-function security group
      role: synthesisEngineRole,  // ✅ Use dedicated role
    });
    // Override logical ID to match existing CloudFormation resource
    (this.synthesisEngineHandler.node.defaultChild as cdk.CfnResource).overrideLogicalId('SynthesisEngineHandler');

    // Grant permissions for Synthesis Engine
    props.signalsTable.grantReadData(this.synthesisEngineHandler);
    props.accountsTable.grantReadData(this.synthesisEngineHandler);
    this.accountPostureStateTable.grantReadWriteData(this.synthesisEngineHandler);
    this.graphMaterializationStatusTable.grantReadData(this.synthesisEngineHandler);
    props.ledgerTable.grantWriteData(this.synthesisEngineHandler);

    // ✅ Zero Trust: Add Neptune permissions to role with conditions
    synthesisEngineRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'neptune-db:connect',
        'neptune-db:ReadDataViaQuery',
        'neptune-db:WriteDataViaQuery',
      ],
      resources: [
        `arn:aws:neptune-db:${props.region}:${props.account}:${props.neptuneCluster.ref}/*`,
      ],
      conditions: {
        Bool: {
          'aws:SecureTransport': 'true',
        },
        StringEquals: {
          'neptune-db:QueryLanguage': 'gremlin',
        },
      },
    }));

    // EventBridge Rules for graph intelligence handlers

    // Rule 3: SIGNAL_DETECTED → graph-materializer-handler
    new events.Rule(this, 'SignalDetectedToGraphMaterializerRule', {
      eventBus: props.eventBus,
      eventPattern: {
        source: ['cc-native.perception'],
        detailType: ['SIGNAL_DETECTED'],
      },
      targets: [
        new eventsTargets.LambdaFunction(this.graphMaterializerHandler, {
          deadLetterQueue: this.graphMaterializerDlq,
          retryAttempts: 2,
        }),
      ],
    });

    // Rule 4: SIGNAL_CREATED → graph-materializer-handler
    new events.Rule(this, 'SignalCreatedToGraphMaterializerRule', {
      eventBus: props.eventBus,
      eventPattern: {
        source: ['cc-native.perception'],
        detailType: ['SIGNAL_CREATED'],
      },
      targets: [
        new eventsTargets.LambdaFunction(this.graphMaterializerHandler, {
          deadLetterQueue: this.graphMaterializerDlq,
          retryAttempts: 2,
        }),
      ],
    });

    // Rule 5: GRAPH_MATERIALIZED → synthesis-engine-handler (canonical path)
    new events.Rule(this, 'GraphMaterializedToSynthesisRule', {
      eventBus: props.eventBus,
      eventPattern: {
        source: ['cc-native.graph'],
        detailType: ['GRAPH_MATERIALIZED'],
      },
      targets: [
        new eventsTargets.LambdaFunction(this.synthesisEngineHandler, {
          deadLetterQueue: this.synthesisEngineDlq,
          retryAttempts: 2,
        }),
      ],
    });
  }
}
