/**
 * Decision Infrastructure - Phase 3
 * 
 * Creates DynamoDB tables, Lambda functions, EventBridge rules, and API Gateway for Phase 3 decision layer.
 */

import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as eventsTargets from 'aws-cdk-lib/aws-events-targets';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';
import { DecisionInfrastructureConfig, DEFAULT_DECISION_INFRASTRUCTURE_CONFIG } from './DecisionInfrastructureConfig';

export interface DecisionInfrastructureProps {
  readonly eventBus: events.EventBus;
  readonly ledgerTable: dynamodb.Table;
  readonly accountPostureStateTable: dynamodb.Table;
  readonly signalsTable: dynamodb.Table;
  readonly accountsTable: dynamodb.Table;
  readonly tenantsTable: dynamodb.Table;
  // Decision tables (created in main stack for cross-phase sharing)
  readonly decisionBudgetTable: dynamodb.Table;
  readonly actionIntentTable: dynamodb.Table;
  readonly decisionProposalTable: dynamodb.Table;
  readonly neptuneEndpoint: string;
  readonly neptunePort: number;
  readonly vpc?: ec2.IVpc; // Optional VPC for Neptune access
  readonly neptuneSecurityGroup?: ec2.ISecurityGroup; // Optional Neptune security group
  readonly region?: string; // Region for Neptune IAM permissions
  readonly userPool?: cognito.IUserPool; // Optional Cognito User Pool for Zero Trust API authorization
  readonly config?: DecisionInfrastructureConfig; // Optional configuration override
}

export interface DecisionInfrastructureResult {
  readonly decisionBudgetTable: dynamodb.Table;
  readonly actionIntentTable: dynamodb.Table;
  readonly decisionProposalTable: dynamodb.Table;
  readonly decisionEvaluationHandler: lambda.Function;
  readonly decisionTriggerHandler: lambda.Function;
  readonly decisionApiHandler: lambda.Function;
  readonly decisionApi: apigateway.RestApi;
}

/**
 * Decision Infrastructure Construct
 */
export class DecisionInfrastructure extends Construct {
  public readonly decisionBudgetTable: dynamodb.Table;
  public readonly actionIntentTable: dynamodb.Table;
  public readonly decisionProposalTable: dynamodb.Table;
  public readonly decisionEvaluationHandler: lambda.Function;
  public readonly decisionTriggerHandler: lambda.Function;
  public readonly decisionApiHandler: lambda.Function;
  public readonly decisionApi: apigateway.RestApi;
  public readonly decisionEvaluationDlq: sqs.Queue;
  public readonly decisionTriggerDlq: sqs.Queue;
  public readonly budgetResetHandler: lambda.Function;
  public readonly decisionEvaluationSecurityGroup?: ec2.SecurityGroup;
  public readonly decisionApiKey: apigateway.ApiKey;

  constructor(scope: Construct, id: string, props: DecisionInfrastructureProps) {
    super(scope, id);

    // Use provided config or default
    const config = props.config || DEFAULT_DECISION_INFRASTRUCTURE_CONFIG;
    const region = props.region || config.defaults.region;

    // Create DLQs
    this.decisionEvaluationDlq = new sqs.Queue(this, 'DecisionEvaluationDlq', {
      queueName: config.queueNames.decisionEvaluationDlq,
      retentionPeriod: cdk.Duration.days(config.lambda.dlqRetentionDays),
    });

    this.decisionTriggerDlq = new sqs.Queue(this, 'DecisionTriggerDlq', {
      queueName: config.queueNames.decisionTriggerDlq,
      retentionPeriod: cdk.Duration.days(config.lambda.dlqRetentionDays),
    });

    // Use tables passed from main stack (created there for cross-phase sharing)
    this.decisionBudgetTable = props.decisionBudgetTable;
    this.actionIntentTable = props.actionIntentTable;
    this.decisionProposalTable = props.decisionProposalTable;

    // Common environment variables for decision handlers
    const commonDecisionEnv = {
      DECISION_BUDGET_TABLE_NAME: this.decisionBudgetTable.tableName,
      ACTION_INTENT_TABLE_NAME: this.actionIntentTable.tableName,
      DECISION_PROPOSAL_TABLE_NAME: this.decisionProposalTable.tableName,
      ACCOUNT_POSTURE_STATE_TABLE_NAME: props.accountPostureStateTable.tableName,
      SIGNALS_TABLE_NAME: props.signalsTable.tableName,
      ACCOUNTS_TABLE_NAME: props.accountsTable.tableName,
      TENANTS_TABLE_NAME: props.tenantsTable.tableName,
      LEDGER_TABLE_NAME: props.ledgerTable.tableName,
      EVENT_BUS_NAME: props.eventBus.eventBusName,
      NEPTUNE_ENDPOINT: props.neptuneEndpoint,
      NEPTUNE_PORT: props.neptunePort.toString(),
      BEDROCK_MODEL_ID: config.bedrock.modelId,
    };

    // Create security group for decision evaluation handler (if VPC is provided)
    if (props.vpc && props.neptuneSecurityGroup) {
      this.decisionEvaluationSecurityGroup = new ec2.SecurityGroup(this, 'DecisionEvaluationSecurityGroup', {
        vpc: props.vpc,
        description: 'Security group for decision evaluation handler (Neptune access)',
        allowAllOutbound: false, // Restrict outbound traffic
      });

      // Allow outbound to Neptune
      this.decisionEvaluationSecurityGroup.addEgressRule(
        props.neptuneSecurityGroup,
        ec2.Port.tcp(props.neptunePort),
        'Allow access to Neptune cluster'
      );

      // Allow HTTPS to AWS services via VPC endpoints
      // Includes: DynamoDB, EventBridge, CloudWatch Logs, Bedrock (via VPC Interface Endpoint)
      // ✅ Zero Trust: All AWS service access via VPC endpoints (no internet access required)
      this.decisionEvaluationSecurityGroup.addEgressRule(
        ec2.Peer.ipv4(props.vpc.vpcCidrBlock),
        ec2.Port.tcp(443),
        'Allow HTTPS to AWS services via VPC endpoints (DynamoDB, EventBridge, CloudWatch Logs, Bedrock)'
      );

      // Allow Neptune to accept connections from decision evaluation handler
      props.neptuneSecurityGroup.addIngressRule(
        this.decisionEvaluationSecurityGroup,
        ec2.Port.tcp(props.neptunePort),
        'Allow decision evaluation handler to connect to Neptune'
      );
    }

    // Decision Evaluation Handler
    const decisionEvaluationRole = new iam.Role(this, 'DecisionEvaluationRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'IAM role for decision evaluation handler',
    });

    // Add VPC permissions (REQUIRED for Lambda in VPC)
    if (props.vpc) {
      decisionEvaluationRole.addManagedPolicy(
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaVPCAccessExecutionRole')
      );
    }

    this.decisionEvaluationHandler = new lambdaNodejs.NodejsFunction(this, 'DecisionEvaluationHandler', {
      functionName: config.functionNames.decisionEvaluation,
      entry: 'src/handlers/phase3/decision-evaluation-handler.ts',
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.minutes(config.defaults.timeout.decisionEvaluation),
      memorySize: config.defaults.memorySize.decisionEvaluation,
      environment: commonDecisionEnv,
      deadLetterQueue: this.decisionEvaluationDlq,
      deadLetterQueueEnabled: true,
      retryAttempts: config.lambda.retryAttempts,
      // VPC configuration for Neptune access (if VPC is provided)
      vpc: props.vpc,
      vpcSubnets: props.vpc ? { subnets: props.vpc.isolatedSubnets } : undefined,
      securityGroups: this.decisionEvaluationSecurityGroup ? [this.decisionEvaluationSecurityGroup] : undefined,
      role: decisionEvaluationRole,
    });

    // Grant permissions
    props.decisionBudgetTable.grantReadWriteData(this.decisionEvaluationHandler);
    props.actionIntentTable.grantReadWriteData(this.decisionEvaluationHandler);
    props.decisionProposalTable.grantReadWriteData(this.decisionEvaluationHandler);
    props.accountPostureStateTable.grantReadData(this.decisionEvaluationHandler);
    props.signalsTable.grantReadData(this.decisionEvaluationHandler);
    props.accountsTable.grantReadData(this.decisionEvaluationHandler);
    props.tenantsTable.grantReadData(this.decisionEvaluationHandler);
    props.ledgerTable.grantWriteData(this.decisionEvaluationHandler);
    props.eventBus.grantPutEventsTo(this.decisionEvaluationHandler);
    
    // Grant Bedrock invoke permission (via VPC endpoint)
    // ✅ Zero Trust: Region-restricted, resource-scoped permissions
    decisionEvaluationRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: config.bedrockIam.actions,
      resources: [
        `arn:aws:bedrock:${region}::foundation-model/${config.bedrock.modelPattern}`,
      ],
      conditions: {
        StringEquals: {
          'aws:RequestedRegion': region,
        },
      },
    }));

    // Grant Neptune access (IAM-based, with conditions for Zero Trust)
    if (region && props.neptuneEndpoint) {
      const accountId = cdk.Stack.of(this).account;
      
      // Use wildcard pattern for cluster identifier to match any Neptune cluster in the account
      // This is safer than extracting from endpoint which may not match the actual cluster identifier
      decisionEvaluationRole.addToPolicy(new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          config.neptune.iamActions.connect,
          config.neptune.iamActions.readDataViaQuery,
        ],
        resources: [
          `arn:aws:neptune-db:${region}:${accountId}:cluster-*/*`,
        ],
        conditions: {
          Bool: {
            'aws:SecureTransport': 'true',
          },
          StringEquals: {
            'neptune-db:QueryLanguage': config.neptune.queryLanguage,
          },
        },
      }));
    }

    // Decision Trigger Handler
    this.decisionTriggerHandler = new lambdaNodejs.NodejsFunction(this, 'DecisionTriggerHandler', {
      functionName: config.functionNames.decisionTrigger,
      entry: 'src/handlers/phase3/decision-trigger-handler.ts',
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(config.defaults.timeout.decisionTrigger),
      memorySize: config.defaults.memorySize.decisionTrigger,
      environment: {
        ACCOUNT_POSTURE_STATE_TABLE_NAME: props.accountPostureStateTable.tableName,
        SIGNALS_TABLE_NAME: props.signalsTable.tableName,
        ACCOUNTS_TABLE_NAME: props.accountsTable.tableName,
        EVENT_BUS_NAME: props.eventBus.eventBusName,
      },
      deadLetterQueue: this.decisionTriggerDlq,
      deadLetterQueueEnabled: true,
      retryAttempts: config.lambda.retryAttempts,
    });

    // Grant permissions
    props.accountPostureStateTable.grantReadData(this.decisionTriggerHandler);
    props.signalsTable.grantReadData(this.decisionTriggerHandler);
    props.accountsTable.grantReadData(this.decisionTriggerHandler);
    props.eventBus.grantPutEventsTo(this.decisionTriggerHandler);

    // Decision API Handler
    this.decisionApiHandler = new lambdaNodejs.NodejsFunction(this, 'DecisionApiHandler', {
      functionName: config.functionNames.decisionApi,
      entry: 'src/handlers/phase3/decision-api-handler.ts',
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.minutes(config.defaults.timeout.decisionApi),
      memorySize: config.defaults.memorySize.decisionApi,
      environment: commonDecisionEnv,
    });

    // Grant permissions
    props.decisionBudgetTable.grantReadWriteData(this.decisionApiHandler);
    props.actionIntentTable.grantReadWriteData(this.decisionApiHandler);
    props.decisionProposalTable.grantReadWriteData(this.decisionApiHandler);
    props.accountPostureStateTable.grantReadData(this.decisionApiHandler);
    props.signalsTable.grantReadData(this.decisionApiHandler);
    props.accountsTable.grantReadData(this.decisionApiHandler);
    props.tenantsTable.grantReadData(this.decisionApiHandler);
    props.ledgerTable.grantWriteData(this.decisionApiHandler);
    
    // Grant Bedrock invoke permission (via VPC endpoint)
    // ✅ Zero Trust: Region-restricted, resource-scoped permissions (matches decision evaluation handler)
    this.decisionApiHandler.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: config.bedrockIam.actions,
      resources: [
        `arn:aws:bedrock:${region}::foundation-model/${config.bedrock.modelPattern}`,
      ],
      conditions: {
        StringEquals: {
          'aws:RequestedRegion': region,
        },
      },
    }));

    // Decision API Gateway
    this.decisionApi = new apigateway.RestApi(this, 'DecisionApi', {
      restApiName: config.apiGateway.restApiName,
      description: 'Decision evaluation and approval API',
      defaultCorsPreflightOptions: {
        allowOrigins: config.cors.allowOrigins,
        allowMethods: config.cors.allowMethods,
        allowHeaders: config.cors.allowHeaders,
      },
    });

    // ✅ Zero Trust: Create Cognito authorizer (preferred) and API key (fallback)
    let cognitoAuthorizer: apigateway.CognitoUserPoolsAuthorizer | undefined;
    if (props.userPool) {
      cognitoAuthorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'DecisionApiCognitoAuthorizer', {
        cognitoUserPools: [props.userPool],
        identitySource: 'method.request.header.Authorization',
      });
    }

    // Create API Key and Usage Plan for fallback authorization (service-to-service)
    this.decisionApiKey = new apigateway.ApiKey(this, 'DecisionApiKey', {
      apiKeyName: config.apiGateway.apiKeyName,
      description: 'API key for Decision API authorization (fallback for service-to-service calls)',
    });

    const usagePlan = new apigateway.UsagePlan(this, 'DecisionApiUsagePlan', {
      name: config.apiGateway.usagePlanName,
      description: 'Usage plan for Decision API',
      apiStages: [
        {
          api: this.decisionApi,
          stage: this.decisionApi.deploymentStage,
        },
      ],
      throttle: {
        rateLimit: config.throttling.rateLimit,
        burstLimit: config.throttling.burstLimit,
      },
      quota: {
        limit: config.throttling.quotaLimit,
        period: apigateway.Period.DAY,
      },
    });

    usagePlan.addApiKey(this.decisionApiKey);

    // Common method options: Use Cognito authorizer if available, otherwise require API key
    const methodOptions: apigateway.MethodOptions = cognitoAuthorizer
      ? {
          authorizer: cognitoAuthorizer,
          authorizationType: apigateway.AuthorizationType.COGNITO,
        }
      : {
          apiKeyRequired: true, // Fallback to API key if Cognito not provided
        };

    // POST /decisions/evaluate
    const evaluateResource = this.decisionApi.root.addResource('decisions').addResource('evaluate');
    evaluateResource.addMethod('POST', new apigateway.LambdaIntegration(this.decisionApiHandler, {
      requestTemplates: { 'application/json': '{ "statusCode": "200" }' }
    }), methodOptions);

    // GET /accounts/{id}/decisions
    const accountsResource = this.decisionApi.root.addResource('accounts');
    const accountDecisionsResource = accountsResource.addResource('{account_id}').addResource('decisions');
    accountDecisionsResource.addMethod('GET', new apigateway.LambdaIntegration(this.decisionApiHandler), methodOptions);

    // POST /actions/{id}/approve and POST /actions/{id}/reject
    const actionsResource = this.decisionApi.root.addResource('actions');
    const actionIdResource = actionsResource.addResource('{action_id}');
    const approveResource = actionIdResource.addResource('approve');
    approveResource.addMethod('POST', new apigateway.LambdaIntegration(this.decisionApiHandler), methodOptions);
    const rejectResource = actionIdResource.addResource('reject');
    rejectResource.addMethod('POST', new apigateway.LambdaIntegration(this.decisionApiHandler), methodOptions);

    // EventBridge Rules

    // Rule: LIFECYCLE_STATE_CHANGED → decision-trigger-handler
    new events.Rule(this, 'LifecycleDecisionTriggerRule', {
      eventBus: props.eventBus,
      eventPattern: {
        source: [config.eventBridge.sources.perception],
        detailType: [config.eventBridge.detailTypes.lifecycleStateChanged]
      },
      targets: [new eventsTargets.LambdaFunction(this.decisionTriggerHandler)]
    });

    // Rule: HIGH_SIGNAL_DETECTED → decision-trigger-handler
    new events.Rule(this, 'HighSignalDecisionTriggerRule', {
      eventBus: props.eventBus,
      eventPattern: {
        source: [config.eventBridge.sources.perception],
        detailType: [config.eventBridge.detailTypes.signalDetected],
        detail: {
          signal_type: [
            config.eventBridge.signalTypes.renewalWindowEntered,
            config.eventBridge.signalTypes.supportRiskEmerging,
            config.eventBridge.signalTypes.usageTrendChange
          ]
        }
      },
      targets: [new eventsTargets.LambdaFunction(this.decisionTriggerHandler)]
    });

    // Rule: DECISION_EVALUATION_REQUESTED → decision-evaluation-handler
    new events.Rule(this, 'DecisionEvaluationRule', {
      eventBus: props.eventBus,
      eventPattern: {
        source: [config.eventBridge.sources.decision],
        detailType: [config.eventBridge.detailTypes.decisionEvaluationRequested]
      },
      targets: [new eventsTargets.LambdaFunction(this.decisionEvaluationHandler)]
    });

    // Budget Reset Handler (for daily budget resets)
    this.budgetResetHandler = new lambdaNodejs.NodejsFunction(this, 'BudgetResetHandler', {
      functionName: config.functionNames.budgetReset,
      entry: 'src/handlers/phase3/budget-reset-handler.ts',
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.minutes(config.defaults.timeout.budgetReset),
      memorySize: config.defaults.memorySize.budgetReset,
      environment: {
        DECISION_BUDGET_TABLE_NAME: props.decisionBudgetTable.tableName,
      },
    });

    // Grant permissions
    props.decisionBudgetTable.grantReadWriteData(this.budgetResetHandler);

    // Scheduled Rule: Daily budget reset at midnight UTC
    new events.Rule(this, 'BudgetResetScheduleRule', {
      schedule: events.Schedule.cron({
        minute: config.budgetReset.schedule.minute,
        hour: config.budgetReset.schedule.hour,
        day: config.budgetReset.schedule.day,
        month: config.budgetReset.schedule.month,
        year: config.budgetReset.schedule.year,
      }),
      description: config.budgetReset.description,
      targets: [new eventsTargets.LambdaFunction(this.budgetResetHandler)],
    });
  }
}
