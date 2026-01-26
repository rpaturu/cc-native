/**
 * Execution Infrastructure - Phase 4.1
 * 
 * Creates DynamoDB tables, Lambda functions, and DLQs for Phase 4.1 execution foundation.
 * Phase 4.2 will add Step Functions, additional handlers, and EventBridge rules.
 */

import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as events from 'aws-cdk-lib/aws-events';
import { Construct } from 'constructs';
import {
  ExecutionInfrastructureConfig,
  DEFAULT_EXECUTION_INFRASTRUCTURE_CONFIG,
} from './ExecutionInfrastructureConfig';

export interface ExecutionInfrastructureProps {
  readonly eventBus: events.EventBus;
  readonly ledgerTable: dynamodb.Table;
  readonly actionIntentTable: dynamodb.Table;
  readonly tenantsTable: dynamodb.Table;
  readonly config?: ExecutionInfrastructureConfig;
  readonly region?: string;
}

export class ExecutionInfrastructure extends Construct {
  // DynamoDB Tables (Phase 4.1)
  public readonly executionAttemptsTable: dynamodb.Table;
  public readonly executionOutcomesTable: dynamodb.Table;
  public readonly actionTypeRegistryTable: dynamodb.Table;
  public readonly externalWriteDedupeTable: dynamodb.Table;
  
  // Lambda Functions (Phase 4.1)
  public readonly executionStarterHandler: lambda.Function;
  public readonly executionValidatorHandler: lambda.Function;
  
  // Dead Letter Queues (Phase 4.1)
  public readonly executionStarterDlq: sqs.Queue;
  public readonly executionValidatorDlq: sqs.Queue;

  constructor(scope: Construct, id: string, props: ExecutionInfrastructureProps) {
    super(scope, id);

    // Use provided config or default (consistent with Phase 3 pattern)
    const config = props.config || DEFAULT_EXECUTION_INFRASTRUCTURE_CONFIG;
    const region = props.region || config.defaults.region;

    // 1. Create DynamoDB Tables
    this.executionAttemptsTable = this.createExecutionAttemptsTable(config);
    this.executionOutcomesTable = this.createExecutionOutcomesTable(config);
    this.actionTypeRegistryTable = this.createActionTypeRegistryTable(config);
    this.externalWriteDedupeTable = this.createExternalWriteDedupeTable(config);
    
    // 2. Create Dead Letter Queues
    this.executionStarterDlq = this.createDlq('ExecutionStarterDlq', config.queueNames.executionStarterDlq, config);
    this.executionValidatorDlq = this.createDlq('ExecutionValidatorDlq', config.queueNames.executionValidatorDlq, config);
    
    // 3. Create Lambda Functions (Phase 4.1 only)
    this.executionStarterHandler = this.createExecutionStarterHandler(props, config);
    this.executionValidatorHandler = this.createExecutionValidatorHandler(props, config);
  }

  private createDlq(id: string, queueName: string, config: ExecutionInfrastructureConfig): sqs.Queue {
    return new sqs.Queue(this, id, {
      queueName,
      retentionPeriod: cdk.Duration.days(config.lambda.dlqRetentionDays),
    });
  }

  private createExecutionAttemptsTable(config: ExecutionInfrastructureConfig): dynamodb.Table {
    const table = new dynamodb.Table(this, 'ExecutionAttemptsTable', {
      tableName: config.tableNames.executionAttempts,
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
      timeToLiveAttribute: 'ttl',
    });
    
    // Add GSI for querying by action_intent_id (operability - common debugging query)
    table.addGlobalSecondaryIndex({
      indexName: 'gsi1-index',
      partitionKey: { name: 'gsi1pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'gsi1sk', type: dynamodb.AttributeType.STRING },
    });
    
    // Add GSI for tenant-level operational queries (all executions for tenant, recent failures, etc.)
    table.addGlobalSecondaryIndex({
      indexName: 'gsi2-index',
      partitionKey: { name: 'gsi2pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'gsi2sk', type: dynamodb.AttributeType.STRING },
    });
    
    return table;
  }

  private createExecutionOutcomesTable(config: ExecutionInfrastructureConfig): dynamodb.Table {
    const table = new dynamodb.Table(this, 'ExecutionOutcomesTable', {
      tableName: config.tableNames.executionOutcomes,
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
      timeToLiveAttribute: 'ttl',
    });
    
    // Add GSI for querying by action_intent_id
    table.addGlobalSecondaryIndex({
      indexName: 'gsi1-index',
      partitionKey: { name: 'gsi1pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'gsi1sk', type: dynamodb.AttributeType.STRING },
    });
    
    // Add GSI for tenant-level operational queries (all outcomes for tenant, recent failures, etc.)
    // Enables queries like: "all outcomes for tenant X", "recent failures across tenant", etc.
    table.addGlobalSecondaryIndex({
      indexName: 'gsi2-index',
      partitionKey: { name: 'gsi2pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'gsi2sk', type: dynamodb.AttributeType.STRING },
    });
    
    return table;
  }

  private createActionTypeRegistryTable(config: ExecutionInfrastructureConfig): dynamodb.Table {
    const table = new dynamodb.Table(this, 'ActionTypeRegistryTable', {
      tableName: config.tableNames.actionTypeRegistry,
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
    });
    
    // Note: GSI not required for Phase 4.1
    // "Latest version" lookup is done by querying all versions and sorting by registry_version in memory
    // (Acceptable for small number of versions per action_type)
    // TODO (Future): Consider adding GSI with registry_version as sort key for better performance
    // if number of versions per action_type grows large
    
    return table;
  }

  private createExternalWriteDedupeTable(config: ExecutionInfrastructureConfig): dynamodb.Table {
    return new dynamodb.Table(this, 'ExternalWriteDedupeTable', {
      tableName: config.tableNames.externalWriteDedupe,
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
    });
  }

  private createExecutionStarterHandler(
    props: ExecutionInfrastructureProps,
    config: ExecutionInfrastructureConfig
  ): lambda.Function {
    const handler = new lambdaNodejs.NodejsFunction(this, 'ExecutionStarterHandler', {
      functionName: config.functionNames.executionStarter,
      entry: 'src/handlers/phase4/execution-starter-handler.ts',
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(config.defaults.timeout.executionStarter),
      memorySize: config.defaults.memorySize?.executionStarter,
      environment: {
        EXECUTION_ATTEMPTS_TABLE_NAME: this.executionAttemptsTable.tableName,
        ACTION_INTENT_TABLE_NAME: props.actionIntentTable.tableName,
        ACTION_TYPE_REGISTRY_TABLE_NAME: this.actionTypeRegistryTable.tableName,
        LEDGER_TABLE_NAME: props.ledgerTable.tableName,
        STATE_MACHINE_TIMEOUT_HOURS: config.stepFunctions.timeoutHours.toString(), // For TTL calculation
        // Note: AWS_REGION is automatically set by Lambda runtime and should not be set manually
      },
      deadLetterQueue: this.executionStarterDlq,
      deadLetterQueueEnabled: true,
      retryAttempts: config.lambda.retryAttempts,
    });
    
    // Grant permissions
    this.executionAttemptsTable.grantReadWriteData(handler);
    props.actionIntentTable.grantReadData(handler);
    this.actionTypeRegistryTable.grantReadData(handler);
    props.ledgerTable.grantWriteData(handler);
    
    return handler;
  }

  private createExecutionValidatorHandler(
    props: ExecutionInfrastructureProps,
    config: ExecutionInfrastructureConfig
  ): lambda.Function {
    const handler = new lambdaNodejs.NodejsFunction(this, 'ExecutionValidatorHandler', {
      functionName: config.functionNames.executionValidator,
      entry: 'src/handlers/phase4/execution-validator-handler.ts',
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(config.defaults.timeout.executionValidator),
      memorySize: config.defaults.memorySize?.executionValidator,
      environment: {
        ACTION_INTENT_TABLE_NAME: props.actionIntentTable.tableName,
        TENANTS_TABLE_NAME: props.tenantsTable.tableName,
        // Note: AWS_REGION is automatically set by Lambda runtime and should not be set manually
      },
      deadLetterQueue: this.executionValidatorDlq,
      deadLetterQueueEnabled: true,
      retryAttempts: config.lambda.retryAttempts,
    });
    
    // Grant permissions
    props.actionIntentTable.grantReadData(handler);
    props.tenantsTable.grantReadData(handler);
    
    return handler;
  }
}
