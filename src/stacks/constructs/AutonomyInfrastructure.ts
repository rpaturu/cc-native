/**
 * Autonomy Infrastructure - Phase 5.1
 *
 * DynamoDB tables for autonomy config and budget state, plus admin API (Lambda + API Gateway).
 */

import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cognito from 'aws-cdk-lib/aws-cognito';
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
}

export class AutonomyInfrastructure extends Construct {
  public readonly autonomyConfigTable: dynamodb.Table;
  public readonly autonomyBudgetStateTable: dynamodb.Table;
  public readonly autonomyAdminApiHandler: lambda.Function;
  public readonly autonomyApi: apigateway.RestApi;
  /** Phase 5.4: Auto-approval gate Lambda (created when actionIntentTable + eventBus are provided). */
  public readonly autoApprovalGateHandler?: lambda.Function;

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
        environment: {
          AUTONOMY_CONFIG_TABLE_NAME: this.autonomyConfigTable.tableName,
          AUTONOMY_BUDGET_STATE_TABLE_NAME:
            this.autonomyBudgetStateTable.tableName,
        },
      }
    );

    this.autonomyConfigTable.grantReadWriteData(this.autonomyAdminApiHandler);
    this.autonomyBudgetStateTable.grantReadWriteData(
      this.autonomyAdminApiHandler
    );

    this.autonomyApi = new apigateway.RestApi(this, 'AutonomyApi', {
      restApiName: config.apiGateway.restApiName,
      description: 'Autonomy config and budget admin API (Phase 5.1)',
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: ['GET', 'PUT', 'OPTIONS'],
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
  }
}
