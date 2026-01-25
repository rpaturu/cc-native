import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as events from 'aws-cdk-lib/aws-events';
import * as eventsTargets from 'aws-cdk-lib/aws-events-targets';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

export interface PerceptionHandlersProps {
  readonly eventBus: events.EventBus;
  readonly evidenceLedgerBucket: s3.IBucket;
  readonly evidenceIndexTable: dynamodb.Table;
  readonly accountsTable: dynamodb.Table;
  readonly signalsTable: dynamodb.Table;
  readonly ledgerTable: dynamodb.Table;
}

export interface PerceptionHandlersResult {
  readonly connectorPollHandler: lambda.Function;
  readonly signalDetectionHandler: lambda.Function;
  readonly lifecycleInferenceHandler: lambda.Function;
  readonly connectorPollDlq: sqs.Queue;
  readonly signalDetectionDlq: sqs.Queue;
  readonly lifecycleInferenceDlq: sqs.Queue;
}

/**
 * Construct for Phase 1 perception handlers
 * Creates Lambda functions, DLQs, and EventBridge rules
 */
export class PerceptionHandlers extends Construct {
  public readonly connectorPollHandler: lambda.Function;
  public readonly signalDetectionHandler: lambda.Function;
  public readonly lifecycleInferenceHandler: lambda.Function;
  public readonly connectorPollDlq: sqs.Queue;
  public readonly signalDetectionDlq: sqs.Queue;
  public readonly lifecycleInferenceDlq: sqs.Queue;

  constructor(scope: Construct, id: string, props: PerceptionHandlersProps) {
    super(scope, id);

    // Common environment variables for all handlers
    // Note: AWS_REGION is automatically set by Lambda runtime and cannot be set manually
    const commonEnv = {
      ACCOUNTS_TABLE_NAME: props.accountsTable.tableName,
      SIGNALS_TABLE_NAME: props.signalsTable.tableName,
      LEDGER_TABLE_NAME: props.ledgerTable.tableName,
      EVIDENCE_INDEX_TABLE_NAME: props.evidenceIndexTable.tableName,
      EVIDENCE_LEDGER_BUCKET: props.evidenceLedgerBucket.bucketName,
      EVENT_BUS_NAME: props.eventBus.eventBusName,
      // AWS_REGION is automatically available via process.env.AWS_REGION in Lambda
    };

    // Create DLQs
    this.connectorPollDlq = new sqs.Queue(this, 'ConnectorPollDlq', {
      queueName: 'cc-native-connector-poll-handler-dlq',
      retentionPeriod: cdk.Duration.days(14),
    });

    this.signalDetectionDlq = new sqs.Queue(this, 'SignalDetectionDlq', {
      queueName: 'cc-native-signal-detection-handler-dlq',
      retentionPeriod: cdk.Duration.days(14),
    });

    this.lifecycleInferenceDlq = new sqs.Queue(this, 'LifecycleInferenceDlq', {
      queueName: 'cc-native-lifecycle-inference-handler-dlq',
      retentionPeriod: cdk.Duration.days(14),
    });

    // Helper method to create Lambda function
    const createLambdaFunction = (
      id: string,
      functionName: string,
      entry: string,
      timeout: cdk.Duration,
      memorySize: number,
      deadLetterQueue: sqs.Queue
    ): lambda.Function => {
      return new lambdaNodejs.NodejsFunction(this, id, {
        functionName,
        entry,
        handler: 'handler',
        runtime: lambda.Runtime.NODEJS_20_X,
        timeout,
        memorySize,
        environment: commonEnv,
        deadLetterQueue,
        deadLetterQueueEnabled: true,
        retryAttempts: 2,
      });
    };

    // Connector Poll Handler
    this.connectorPollHandler = createLambdaFunction(
      'ConnectorPollHandler',
      'cc-native-connector-poll-handler',
      'src/handlers/perception/connector-poll-handler.ts',
      cdk.Duration.minutes(15),
      512,
      this.connectorPollDlq
    );
    // Override logical ID to match existing CloudFormation resource
    (this.connectorPollHandler.node.defaultChild as cdk.CfnResource).overrideLogicalId('ConnectorPollHandler');

    // Grant permissions
    props.evidenceLedgerBucket.grantReadWrite(this.connectorPollHandler);
    props.evidenceIndexTable.grantReadWriteData(this.connectorPollHandler);
    props.eventBus.grantPutEventsTo(this.connectorPollHandler);

    // Signal Detection Handler
    this.signalDetectionHandler = createLambdaFunction(
      'SignalDetectionHandler',
      'cc-native-signal-detection-handler',
      'src/handlers/perception/signal-detection-handler.ts',
      cdk.Duration.minutes(15),
      1024,
      this.signalDetectionDlq
    );
    // Override logical ID to match existing CloudFormation resource
    (this.signalDetectionHandler.node.defaultChild as cdk.CfnResource).overrideLogicalId('SignalDetectionHandler');

    // Grant permissions
    props.evidenceLedgerBucket.grantRead(this.signalDetectionHandler);
    props.signalsTable.grantReadWriteData(this.signalDetectionHandler);
    props.accountsTable.grantReadWriteData(this.signalDetectionHandler);
    props.ledgerTable.grantWriteData(this.signalDetectionHandler);
    props.eventBus.grantPutEventsTo(this.signalDetectionHandler);

    // Lifecycle Inference Handler
    this.lifecycleInferenceHandler = createLambdaFunction(
      'LifecycleInferenceHandler',
      'cc-native-lifecycle-inference-handler',
      'src/handlers/perception/lifecycle-inference-handler.ts',
      cdk.Duration.minutes(5),
      512,
      this.lifecycleInferenceDlq
    );
    // Override logical ID to match existing CloudFormation resource
    (this.lifecycleInferenceHandler.node.defaultChild as cdk.CfnResource).overrideLogicalId('LifecycleInferenceHandler');

    // Grant permissions
    props.accountsTable.grantReadWriteData(this.lifecycleInferenceHandler);
    props.signalsTable.grantReadData(this.lifecycleInferenceHandler);
    props.ledgerTable.grantWriteData(this.lifecycleInferenceHandler);
    props.eventBus.grantPutEventsTo(this.lifecycleInferenceHandler);

    // EventBridge Rules

    // Rule 1: CONNECTOR_POLL_COMPLETED → signal-detection-handler
    new events.Rule(this, 'ConnectorPollCompletedRule', {
      eventBus: props.eventBus,
      eventPattern: {
        source: ['cc-native.perception'],
        detailType: ['CONNECTOR_POLL_COMPLETED'],
      },
      targets: [
        new eventsTargets.LambdaFunction(this.signalDetectionHandler, {
          deadLetterQueue: this.signalDetectionDlq,
          retryAttempts: 2,
        }),
      ],
    });

    // Rule 2: SIGNAL_DETECTED → lifecycle-inference-handler
    new events.Rule(this, 'SignalDetectedRule', {
      eventBus: props.eventBus,
      eventPattern: {
        source: ['cc-native.perception'],
        detailType: ['SIGNAL_DETECTED', 'SIGNAL_CREATED'],
      },
      targets: [
        new eventsTargets.LambdaFunction(this.lifecycleInferenceHandler, {
          deadLetterQueue: this.lifecycleInferenceDlq,
          retryAttempts: 2,
        }),
      ],
    });
  }
}
