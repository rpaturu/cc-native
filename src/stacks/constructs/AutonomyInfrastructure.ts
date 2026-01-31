/**
 * Autonomy Infrastructure - Phase 5.1 + 5.6
 *
 * DynamoDB tables for autonomy config, budget, audit export jobs; admin API (Lambda + API Gateway).
 * Phase 5.6: kill-switches, ledger explanation, audit exports (async).
 */

import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import {
  AutonomyInfrastructureConfig,
  DEFAULT_AUTONOMY_INFRASTRUCTURE_CONFIG,
} from './AutonomyInfrastructureConfig';

export interface AutonomyInfrastructureProps {
  readonly config?: AutonomyInfrastructureConfig;
  readonly userPool?: cognito.IUserPool;
  /** Phase 5.4: When set, creates auto-approval-gate Lambda (needs action intent table + event bus). */
  readonly actionIntentTable?: dynamodb.Table;
  readonly eventBus?: events.IEventBus;
  /** Phase 5.6: When set, Control Center APIs (kill-switches, ledger explanation, audit exports) get env and grants. */
  readonly tenantsTable?: dynamodb.Table;
  readonly ledgerTable?: dynamodb.Table;
  readonly executionOutcomesTable?: dynamodb.Table;
}

export class AutonomyInfrastructure extends Construct {
  public readonly autonomyConfigTable: dynamodb.Table;
  public readonly autonomyBudgetStateTable: dynamodb.Table;
  /** Phase 5.6: Audit export jobs (async export pattern). */
  public readonly auditExportTable: dynamodb.Table;
  /** Phase 5.6: S3 bucket for async audit export files (worker writes; API returns presigned URL). */
  public readonly auditExportBucket: s3.IBucket;
  public readonly autonomyAdminApiHandler: lambda.Function;
  public readonly autonomyApi: apigateway.RestApi;
  /** Phase 5.4: Auto-approval gate Lambda (created when actionIntentTable + eventBus are provided). */
  public readonly autoApprovalGateHandler?: lambda.Function;
  /** Phase 5.6: Async audit export worker (EventBridge → worker → S3, update job). */
  public readonly auditExportWorkerHandler?: lambda.Function;

  constructor(
    scope: Construct,
    id: string,
    props: AutonomyInfrastructureProps = {}
  ) {
    super(scope, id);

    const config =
      props.config || DEFAULT_AUTONOMY_INFRASTRUCTURE_CONFIG;

    this.autonomyConfigTable = new dynamodb.Table(
      this,
      'AutonomyConfigTable',
      {
        tableName: config.tableNames.autonomyConfig,
        partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
        sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
        billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
        pointInTimeRecoverySpecification: {
          pointInTimeRecoveryEnabled: true,
        },
        timeToLiveAttribute: 'ttl', // Phase 5.4: AUTO_EXEC_STATE items (30–90 days)
      }
    );

    this.autonomyBudgetStateTable = new dynamodb.Table(
      this,
      'AutonomyBudgetStateTable',
      {
        tableName: config.tableNames.autonomyBudgetState,
        partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
        sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
        billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
        pointInTimeRecoverySpecification: {
          pointInTimeRecoveryEnabled: true,
        },
      }
    );

    this.auditExportTable = new dynamodb.Table(this, 'AuditExportTable', {
      tableName: 'cc-native-audit-export',
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    });

    this.auditExportBucket = new s3.Bucket(this, 'AuditExportBucket', {
      bucketName: undefined,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
    });

    const handlerEnv: Record<string, string> = {
      AUTONOMY_CONFIG_TABLE_NAME: this.autonomyConfigTable.tableName,
      AUTONOMY_BUDGET_STATE_TABLE_NAME: this.autonomyBudgetStateTable.tableName,
      AUDIT_EXPORT_TABLE_NAME: this.auditExportTable.tableName,
      AUDIT_EXPORT_BUCKET_NAME: this.auditExportBucket.bucketName,
    };
    if (props.tenantsTable) handlerEnv.TENANTS_TABLE_NAME = props.tenantsTable.tableName;
    if (props.ledgerTable) handlerEnv.LEDGER_TABLE_NAME = props.ledgerTable.tableName;
    if (props.executionOutcomesTable)
      handlerEnv.EXECUTION_OUTCOMES_TABLE_NAME = props.executionOutcomesTable.tableName;
    if (props.eventBus) handlerEnv.EVENT_BUS_NAME = props.eventBus.eventBusName;
    if (props.actionIntentTable) handlerEnv.ACTION_INTENT_TABLE_NAME = props.actionIntentTable.tableName;

    this.autonomyAdminApiHandler = new lambdaNodejs.NodejsFunction(
      this,
      'AutonomyAdminApiHandler',
      {
        functionName: config.functionNames.autonomyAdminApi,
        entry: 'src/handlers/phase5/autonomy-admin-api-handler.ts',
        handler: 'handler',
        runtime: lambda.Runtime.NODEJS_20_X,
        timeout: cdk.Duration.seconds(config.defaults.timeoutSeconds),
        memorySize: config.defaults.memorySize,
        environment: handlerEnv,
      }
    );

    this.autonomyConfigTable.grantReadWriteData(this.autonomyAdminApiHandler);
    this.autonomyBudgetStateTable.grantReadWriteData(
      this.autonomyAdminApiHandler
    );
    this.auditExportTable.grantReadWriteData(this.autonomyAdminApiHandler);
    this.auditExportBucket.grantRead(this.autonomyAdminApiHandler);
    if (props.tenantsTable) props.tenantsTable.grantReadWriteData(this.autonomyAdminApiHandler);
    if (props.ledgerTable) props.ledgerTable.grantReadData(this.autonomyAdminApiHandler);
    if (props.executionOutcomesTable)
      props.executionOutcomesTable.grantReadData(this.autonomyAdminApiHandler);
    if (props.eventBus) props.eventBus.grantPutEventsTo(this.autonomyAdminApiHandler);
    if (props.actionIntentTable) props.actionIntentTable.grantReadData(this.autonomyAdminApiHandler); // Phase 5.7 replay

    this.autonomyApi = new apigateway.RestApi(this, 'AutonomyApi', {
      restApiName: config.apiGateway.restApiName,
      description: 'Autonomy config and budget admin API (Phase 5.1)',
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: ['GET', 'PUT', 'POST', 'OPTIONS'],
        allowHeaders: [
          'Content-Type',
          'Authorization',
          'X-Api-Key',
          'X-Tenant-Id',
        ],
      },
    });

    const methodOptions: apigateway.MethodOptions = props.userPool
      ? {
          authorizer: new apigateway.CognitoUserPoolsAuthorizer(
            this,
            'AutonomyApiCognitoAuthorizer',
            {
              cognitoUserPools: [props.userPool],
              identitySource: 'method.request.header.Authorization',
            }
          ),
          authorizationType: apigateway.AuthorizationType.COGNITO,
        }
      : {};

    const integration = new apigateway.LambdaIntegration(
      this.autonomyAdminApiHandler
    );

    const configResource = this.autonomyApi.root.addResource('config');
    configResource.addMethod('GET', integration, methodOptions);
    configResource.addMethod('PUT', integration, methodOptions);

    const budgetResource = this.autonomyApi.root.addResource('budget');
    budgetResource.addMethod('GET', integration, methodOptions);
    budgetResource.addMethod('PUT', integration, methodOptions);

    const budgetStateResource = budgetResource.addResource('state');
    budgetStateResource.addMethod('GET', integration, methodOptions);

    const killSwitchesResource = this.autonomyApi.root.addResource('kill-switches');
    killSwitchesResource.addMethod('GET', integration, methodOptions);
    killSwitchesResource.addMethod('PUT', integration, methodOptions);

    const replayResource = this.autonomyApi.root.addResource('replay');
    replayResource.addMethod('POST', integration, methodOptions);

    const ledgerResource = this.autonomyApi.root.addResource('ledger');
    const explanationResource = ledgerResource.addResource('explanation');
    explanationResource.addMethod('GET', integration, methodOptions);

    const auditResource = this.autonomyApi.root.addResource('audit');
    const exportsResource = auditResource.addResource('exports');
    exportsResource.addMethod('POST', integration, methodOptions);
    const exportByIdResource = exportsResource.addResource('{id}');
    exportByIdResource.addMethod('GET', integration, methodOptions);

    // Phase 5.4: Auto-approval gate Lambda (invoked with action_intent_id, tenant_id, account_id)
    if (props.actionIntentTable && props.eventBus) {
      const gateHandler = new lambdaNodejs.NodejsFunction(
        this,
        'AutoApprovalGateHandler',
        {
          functionName: config.functionNames.autoApprovalGate,
          entry: 'src/handlers/phase5/auto-approval-gate-handler.ts',
          handler: 'handler',
          runtime: lambda.Runtime.NODEJS_20_X,
          timeout: cdk.Duration.seconds(config.defaults.timeoutSeconds),
          memorySize: config.defaults.memorySize,
          environment: {
            AUTONOMY_CONFIG_TABLE_NAME: this.autonomyConfigTable.tableName,
            AUTONOMY_BUDGET_STATE_TABLE_NAME: this.autonomyBudgetStateTable.tableName,
            ACTION_INTENT_TABLE_NAME: props.actionIntentTable.tableName,
            EVENT_BUS_NAME: props.eventBus.eventBusName,
          },
        }
      );
      this.autonomyConfigTable.grantReadWriteData(gateHandler);
      this.autonomyBudgetStateTable.grantReadWriteData(gateHandler);
      props.actionIntentTable.grantReadData(gateHandler);
      props.eventBus.grantPutEventsTo(gateHandler);
      this.autoApprovalGateHandler = gateHandler;
    }

    // Phase 5.6: Async audit export worker (EventBridge AuditExportRequested → worker → S3, update job)
    if (props.eventBus && props.ledgerTable) {
      const auditExportWorker = new lambdaNodejs.NodejsFunction(
        this,
        'AuditExportWorkerHandler',
        {
          functionName: 'cc-native-audit-export-worker',
          entry: 'src/handlers/phase5/audit-export-worker-handler.ts',
          handler: 'handler',
          runtime: lambda.Runtime.NODEJS_20_X,
          timeout: cdk.Duration.seconds(300),
          memorySize: 512,
          environment: {
            LEDGER_TABLE_NAME: props.ledgerTable.tableName,
            AUDIT_EXPORT_TABLE_NAME: this.auditExportTable.tableName,
            AUDIT_EXPORT_BUCKET_NAME: this.auditExportBucket.bucketName,
          },
        }
      );
      props.ledgerTable.grantReadData(auditExportWorker);
      this.auditExportTable.grantReadWriteData(auditExportWorker);
      this.auditExportBucket.grantWrite(auditExportWorker);
      new events.Rule(this, 'AuditExportRequestedRule', {
        eventBus: props.eventBus,
        eventPattern: {
          source: ['cc-native.autonomy'],
          detailType: ['AuditExportRequested'],
        },
        targets: [new targets.LambdaFunction(auditExportWorker)],
      });
      this.auditExportWorkerHandler = auditExportWorker;
    }
  }
}
