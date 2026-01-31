/**
 * Execution Infrastructure - Phase 4.1 + Phase 4.2
 * 
 * Creates DynamoDB tables, Lambda functions, DLQs, Step Functions state machine,
 * and EventBridge rules for execution orchestration.
 */

import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as events from 'aws-cdk-lib/aws-events';
import * as eventsTargets from 'aws-cdk-lib/aws-events-targets';
import * as stepfunctions from 'aws-cdk-lib/aws-stepfunctions';
import * as stepfunctionsTasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as bedrockagentcore from 'aws-cdk-lib/aws-bedrockagentcore';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as cr from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';
import {
  ExecutionInfrastructureConfig,
  DEFAULT_EXECUTION_INFRASTRUCTURE_CONFIG,
} from './ExecutionInfrastructureConfig';

import {
  INTERNAL_CREATE_NOTE,
  INTERNAL_CREATE_TASK,
  CRM_CREATE_TASK,
} from '../../constants/ExecutionToolNames';

export interface ExecutionInfrastructureProps {
  readonly eventBus: events.EventBus;
  readonly ledgerTable: dynamodb.Table;
  readonly actionIntentTable: dynamodb.Table;
  readonly tenantsTable: dynamodb.Table;
  readonly signalsTable: dynamodb.Table; // Phase 4.4: execution outcome signals
  readonly gatewayUrl?: string; // AgentCore Gateway URL (Phase 4.2 - will be removed after Phase 4.3 Gateway setup)
  readonly userPool?: cognito.IUserPool; // Cognito User Pool for JWT auth (required for Phase 4.3 Gateway)
  readonly userPoolClient?: cognito.IUserPoolClient; // Cognito User Pool Client (required for Phase 4.3 Gateway)
  readonly artifactsBucket?: s3.IBucket; // S3 bucket for raw response artifacts (optional, will be created if not provided)
  readonly config?: ExecutionInfrastructureConfig;
  readonly region?: string;
  /** Phase 4.4: Optional API Gateway for execution status API */
  readonly apiGateway?: apigateway.RestApi;
  /** Phase 4.4: JWT authorizer for execution status API (required when apiGateway is set) */
  readonly executionStatusAuthorizer?: apigateway.IAuthorizer;
  /** Phase 4.4: Required when apiGateway is set; parent must create and pass to avoid duplicate routes */
  readonly executionsResource?: apigateway.IResource;
  /** Phase 4.4: Required when apiGateway is set; parent must create and pass to avoid duplicate routes */
  readonly accountsResource?: apigateway.IResource;
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
  
  // Lambda Functions (Phase 4.2)
  public readonly toolMapperHandler: lambda.Function;
  public readonly toolInvokerHandler: lambda.Function;
  public readonly executionRecorderHandler: lambda.Function;
  public readonly executionFailureRecorderHandler: lambda.Function;
  public readonly compensationHandler: lambda.Function;
  
  // Dead Letter Queues (Phase 4.1)
  public readonly executionStarterDlq: sqs.Queue;
  public readonly executionValidatorDlq: sqs.Queue;
  
  // Dead Letter Queues (Phase 4.2)
  public readonly toolMapperDlq: sqs.Queue;
  public readonly toolInvokerDlq: sqs.Queue;
  public readonly executionRecorderDlq: sqs.Queue;
  public readonly executionFailureRecorderDlq: sqs.Queue;
  public readonly compensationDlq: sqs.Queue;
  
  // Step Functions (Phase 4.2)
  public readonly executionStateMachine: stepfunctions.StateMachine;
  
  // EventBridge Rule (Phase 4.2)
  public readonly executionTriggerRule: events.Rule;
  
  // S3 Bucket (Phase 4.2)
  public readonly executionArtifactsBucket?: s3.IBucket;

  // AgentCore Gateway (Phase 4.3)
  public readonly executionGateway: bedrockagentcore.CfnGateway;
  public readonly gatewayUrl: string; // Output: Gateway URL for ToolMapper handler

  // Connectors VPC (Phase 4.3)
  public readonly connectorsVpc: ec2.Vpc;
  public readonly internalAdapterSecurityGroup: ec2.SecurityGroup;
  public readonly crmAdapterSecurityGroup: ec2.SecurityGroup;

  // Adapter Lambda Functions (Phase 4.3)
  public readonly internalAdapterHandler: lambda.Function;
  public readonly crmAdapterHandler: lambda.Function;

  // Connector Config Table (Phase 4.3)
  public readonly connectorConfigTable: dynamodb.Table;
  public readonly internalNotesTable: dynamodb.Table;
  public readonly internalTasksTable: dynamodb.Table;

  // Phase 4.4: Execution Status API
  public readonly executionStatusApiHandler: lambda.Function;

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
    
    // 2. Create Dead Letter Queues (Phase 4.1)
    this.executionStarterDlq = this.createDlq('ExecutionStarterDlq', config.queueNames.executionStarterDlq, config);
    this.executionValidatorDlq = this.createDlq('ExecutionValidatorDlq', config.queueNames.executionValidatorDlq, config);
    
    // 3. Create Lambda Functions (Phase 4.1)
    this.executionStarterHandler = this.createExecutionStarterHandler(props, config);
    this.executionValidatorHandler = this.createExecutionValidatorHandler(props, config);
    
    // Phase 4.2: Additional DLQs
    this.toolMapperDlq = this.createDlq('ToolMapperDlq', config.queueNames.toolMapperDlq, config);
    this.toolInvokerDlq = this.createDlq('ToolInvokerDlq', config.queueNames.toolInvokerDlq, config);
    this.executionRecorderDlq = this.createDlq('ExecutionRecorderDlq', config.queueNames.executionRecorderDlq, config);
    this.executionFailureRecorderDlq = this.createDlq('ExecutionFailureRecorderDlq', config.queueNames.executionFailureRecorderDlq, config);
    this.compensationDlq = this.createDlq('CompensationDlq', config.queueNames.compensationDlq, config);
    
    // Phase 4.3: Additional DynamoDB Tables (create early, before handlers that might need them)
    this.connectorConfigTable = this.createConnectorConfigTable(config);
    this.internalNotesTable = this.createInternalNotesTable(config);
    this.internalTasksTable = this.createInternalTasksTable(config);

    // Phase 4.3: Connectors VPC (create before security groups and Lambdas)
    this.connectorsVpc = this.createConnectorsVpc(config);
    this.internalAdapterSecurityGroup = this.createInternalAdapterSecurityGroup(config);
    this.crmAdapterSecurityGroup = this.createCrmAdapterSecurityGroup();

    // Phase 4.3: AgentCore Gateway (create before adapter handlers and ToolMapper)
    this.executionGateway = this.createAgentCoreGateway(props, config);
    this.gatewayUrl = this.executionGateway.attrGatewayUrl;

    // Phase 4.2: S3 Bucket for raw response artifacts (create BEFORE handlers that need it).
    // Phase 4.4 verify: Tool-invoker writes large responses here and sets raw_response_artifact_ref;
    // execution-recorder receives that ref only (no S3 env or grant). Bucket is required for tool-invoker.
    if (!props.artifactsBucket) {
      this.executionArtifactsBucket = new s3.Bucket(this, 'ExecutionArtifactsBucket', {
        bucketName: `${config.s3.executionArtifactsBucketPrefix}-${cdk.Aws.ACCOUNT_ID}-${cdk.Aws.REGION}`,
        versioned: true,
        encryption: s3.BucketEncryption.S3_MANAGED,
      });
    } else {
      this.executionArtifactsBucket = props.artifactsBucket;
    }

    // Phase 4.2: Additional Lambda Functions (ToolMapper now uses this.gatewayUrl)
    // Note: ToolInvokerHandler needs executionArtifactsBucket, so bucket must be created first
    this.toolMapperHandler = this.createToolMapperHandler(props, config);
    // JWT gateway service user + secret (per JWT_SERVICE_USER_STACK_PLAN.md); ToolInvoker gets COGNITO_SERVICE_USER_SECRET_ARN
    const gatewayServiceSecret =
      props.userPool && props.userPoolClient
        ? this.createJwtGatewayServiceUserSecretAndResource(props)
        : undefined;
    this.toolInvokerHandler = this.createToolInvokerHandler(props, config, gatewayServiceSecret);
    this.executionRecorderHandler = this.createExecutionRecorderHandler(props, config);
    this.executionFailureRecorderHandler = this.createExecutionFailureRecorderHandler(props, config);
    this.compensationHandler = this.createCompensationHandler(props, config);
    
    // Phase 4.2: Step Functions State Machine
    this.executionStateMachine = this.createExecutionStateMachine(config);
    
    // Phase 4.2: EventBridge Rule
    this.executionTriggerRule = this.createExecutionTriggerRule(props, config);

    // Phase 4.3: Adapter Lambda Functions (create after Gateway and VPC)
    this.internalAdapterHandler = this.createInternalAdapterHandler(props, config);
    this.crmAdapterHandler = this.createCrmAdapterHandler(props, config);

    // ✅ NOTE: Gateway role permissions are added in createAgentCoreGateway() 
    // using ARN patterns from config, so permissions exist before Gateway targets are created

    // Phase 4.3: Register adapters as Gateway targets (after Lambdas and Gateway created)
    // Internal adapters use GATEWAY_IAM_ROLE (no external credentials needed)
    this.registerGatewayTarget(this.internalAdapterHandler, INTERNAL_CREATE_NOTE, this.getInternalNoteToolSchema(), 'GATEWAY_IAM_ROLE');
    this.registerGatewayTarget(this.internalAdapterHandler, INTERNAL_CREATE_TASK, this.getInternalTaskToolSchema(), 'GATEWAY_IAM_ROLE');
    // CRM adapter also uses GATEWAY_IAM_ROLE for now (OAuth credential provider will be added in Phase 4.4)
    this.registerGatewayTarget(this.crmAdapterHandler, CRM_CREATE_TASK, this.getCrmTaskToolSchema(), 'GATEWAY_IAM_ROLE');

    // Phase 4.4: Execution Status API Lambda (always create; API Gateway wiring optional)
    this.executionStatusApiHandler = this.createExecutionStatusApiHandler(props, config);
    this.createExecutionStatusApiGateway(props);

    // Phase 4.4: CloudWatch alarms
    this.createCloudWatchAlarms(config);
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

  private createToolMapperHandler(
    props: ExecutionInfrastructureProps,
    config: ExecutionInfrastructureConfig
  ): lambda.Function {
    // Phase 4.3: Use Gateway URL from construct if available, otherwise fall back to props.gatewayUrl
    // Note: In Phase 4.3, Gateway is created in constructor, so this.gatewayUrl will be available
    // For backwards compatibility during migration, we still support props.gatewayUrl
    const gatewayUrl = (this as any).gatewayUrl || props.gatewayUrl || (() => {
      throw new Error(
        '[ExecutionInfrastructure] Missing required property: gatewayUrl. ' +
        'Provide gatewayUrl in ExecutionInfrastructureProps or ensure AgentCore Gateway is configured. ' +
        'The Gateway URL is required for tool-mapper-handler to invoke connector adapters.'
      );
    })();

    const handler = new lambdaNodejs.NodejsFunction(this, 'ToolMapperHandler', {
      functionName: config.functionNames.toolMapper,
      entry: 'src/handlers/phase4/tool-mapper-handler.ts',
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(config.defaults.timeout.toolMapper),
      memorySize: config.defaults.memorySize?.toolMapper,
      environment: {
        ACTION_INTENT_TABLE_NAME: props.actionIntentTable.tableName,
        ACTION_TYPE_REGISTRY_TABLE_NAME: this.actionTypeRegistryTable.tableName,
        AGENTCORE_GATEWAY_URL: gatewayUrl,
        // Note: AWS_REGION is automatically set by Lambda runtime and should not be set manually
      },
      deadLetterQueue: this.toolMapperDlq,
      deadLetterQueueEnabled: true,
      retryAttempts: config.lambda.retryAttempts,
    });
    
    // Grant permissions
    props.actionIntentTable.grantReadData(handler);
    this.actionTypeRegistryTable.grantReadData(handler);
    
    // Note: Cognito permissions are NOT granted here - JWT token retrieval is done in ToolInvoker
    // This keeps ToolMapper "pure mapping + param shaping" and deterministic
    
    return handler;
  }

  private createToolInvokerHandler(
    props: ExecutionInfrastructureProps,
    config: ExecutionInfrastructureConfig,
    gatewayServiceSecret?: secretsmanager.ISecret
  ): lambda.Function {
    const handler = new lambdaNodejs.NodejsFunction(this, 'ToolInvokerHandler', {
      functionName: config.functionNames.toolInvoker,
      entry: 'src/handlers/phase4/tool-invoker-handler.ts',
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(config.defaults.timeout.toolInvoker),
      memorySize: config.defaults.memorySize?.toolInvoker,
      environment: {
        EXECUTION_ARTIFACTS_BUCKET: this.executionArtifactsBucket?.bucketName || (() => {
          throw new Error(
            '[ExecutionInfrastructure] Missing required property: artifactsBucket. ' +
            'Provide artifactsBucket in ExecutionInfrastructureProps or ensure ExecutionArtifactsBucket is created. ' +
            'This bucket is used to store large tool invocation responses.'
          );
        })(),
        // Cognito JWT: pool/client set when userPool/userPoolClient provided; secret ARN when stack provisions gateway service user (JWT_SERVICE_USER_STACK_PLAN.md)
        ...(props.userPool && props.userPoolClient
          ? {
              COGNITO_USER_POOL_ID: props.userPool.userPoolId,
              COGNITO_CLIENT_ID: props.userPoolClient.userPoolClientId,
              ...(gatewayServiceSecret ? { COGNITO_SERVICE_USER_SECRET_ARN: gatewayServiceSecret.secretArn } : {}),
            }
          : {}),
        // Note: AWS_REGION is automatically set by Lambda runtime and should not be set manually
      },
      deadLetterQueue: this.toolInvokerDlq,
      deadLetterQueueEnabled: true,
      retryAttempts: config.lambda.retryAttempts,
    });
    
    // Grant S3 permissions (for raw response artifacts)
    if (this.executionArtifactsBucket) {
      this.executionArtifactsBucket.grantWrite(handler);
    }
    
    // Grant Cognito permissions for JWT token retrieval (if userPool provided)
    if (props.userPool) {
      handler.addToRolePolicy(new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['cognito-idp:GetUser', 'cognito-idp:InitiateAuth'],
        resources: [props.userPool.userPoolArn],
      }));
    }
    
    // Grant Secrets Manager GetSecretValue on JWT gateway service secret (least privilege: this secret only)
    if (gatewayServiceSecret) {
      gatewayServiceSecret.grantRead(handler);
    }
    
    return handler;
  }

  /**
   * Creates Secrets Manager secret and custom resource that provisions Cognito gateway-service user and fills the secret.
   * Per JWT_SERVICE_USER_STACK_PLAN.md: AdminGetUser first; PutSecretValue only on create or ForceRecreate.
   */
  private createJwtGatewayServiceUserSecretAndResource(
    props: ExecutionInfrastructureProps
  ): secretsmanager.ISecret {
    const secret = new secretsmanager.Secret(this, 'JwtGatewayServiceCredentials', {
      description: 'Cognito gateway-service user credentials for ToolInvoker JWT (execution/gateway-service).',
      secretName: 'execution/gateway-service-credentials',
    });
    const customResourceHandler = new lambdaNodejs.NodejsFunction(this, 'CognitoGatewayServiceUserCustomResource', {
      entry: 'src/custom-resources/cognito-gateway-service-user.ts',
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.minutes(2),
    });
    customResourceHandler.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['cognito-idp:AdminGetUser', 'cognito-idp:AdminCreateUser', 'cognito-idp:AdminSetUserPassword'],
      resources: [props.userPool!.userPoolArn],
    }));
    secret.grantWrite(customResourceHandler);
    const provider = new cr.Provider(this, 'CognitoGatewayServiceUserProvider', {
      onEventHandler: customResourceHandler,
    });
    new cdk.CustomResource(this, 'CognitoGatewayServiceUser', {
      serviceToken: provider.serviceToken,
      properties: {
        UserPoolId: props.userPool!.userPoolId,
        ClientId: props.userPoolClient!.userPoolClientId,
        SecretArn: secret.secretArn,
        Username: 'gateway-service@cc-native.local',
      },
    });
    return secret;
  }

  private createExecutionRecorderHandler(
    props: ExecutionInfrastructureProps,
    config: ExecutionInfrastructureConfig
  ): lambda.Function {
    const handler = new lambdaNodejs.NodejsFunction(this, 'ExecutionRecorderHandler', {
      functionName: config.functionNames.executionRecorder,
      entry: 'src/handlers/phase4/execution-recorder-handler.ts',
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(config.defaults.timeout.executionRecorder),
      memorySize: config.defaults.memorySize?.executionRecorder,
      environment: {
        EXECUTION_OUTCOMES_TABLE_NAME: this.executionOutcomesTable.tableName,
        EXECUTION_ATTEMPTS_TABLE_NAME: this.executionAttemptsTable.tableName,
        ACTION_INTENT_TABLE_NAME: props.actionIntentTable.tableName,
        LEDGER_TABLE_NAME: props.ledgerTable.tableName,
        SIGNALS_TABLE_NAME: props.signalsTable.tableName,
        EVENT_BUS_NAME: props.eventBus.eventBusName,
        // Note: AWS_REGION is automatically set by Lambda runtime and should not be set manually
      },
      deadLetterQueue: this.executionRecorderDlq,
      deadLetterQueueEnabled: true,
      retryAttempts: config.lambda.retryAttempts,
    });
    
    // Grant permissions
    this.executionOutcomesTable.grantWriteData(handler);
    this.executionAttemptsTable.grantWriteData(handler);
    props.actionIntentTable.grantReadData(handler); // For fetching decision_trace_id
    props.ledgerTable.grantWriteData(handler);
    props.signalsTable.grantWriteData(handler);
    props.eventBus.grantPutEventsTo(handler);
    
    return handler;
  }

  private createExecutionFailureRecorderHandler(
    props: ExecutionInfrastructureProps,
    config: ExecutionInfrastructureConfig
  ): lambda.Function {
    // Use NodejsFunction for consistency with other handlers (same bundling, env var behavior)
    const handler = new lambdaNodejs.NodejsFunction(this, 'ExecutionFailureRecorderHandler', {
      functionName: config.functionNames.executionFailureRecorder,
      entry: 'src/handlers/phase4/execution-failure-recorder-handler.ts',
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(config.defaults.timeout.executionRecorder),
      memorySize: config.defaults.memorySize?.executionRecorder,
      environment: {
        EXECUTION_OUTCOMES_TABLE_NAME: this.executionOutcomesTable.tableName,
        EXECUTION_ATTEMPTS_TABLE_NAME: this.executionAttemptsTable.tableName,
        ACTION_INTENT_TABLE_NAME: props.actionIntentTable.tableName,
        LEDGER_TABLE_NAME: props.ledgerTable.tableName,
        // Note: AWS_REGION is automatically set by Lambda runtime and should not be set manually
      },
      deadLetterQueue: this.executionFailureRecorderDlq,
      deadLetterQueueEnabled: true,
      retryAttempts: 0, // No retries - failures are terminal
    });
    
    // Grant permissions
    this.executionOutcomesTable.grantWriteData(handler);
    this.executionAttemptsTable.grantReadWriteData(handler);
    props.actionIntentTable.grantReadData(handler);
    props.ledgerTable.grantWriteData(handler);
    
    return handler;
  }

  private createCompensationHandler(
    props: ExecutionInfrastructureProps,
    config: ExecutionInfrastructureConfig
  ): lambda.Function {
    const handler = new lambdaNodejs.NodejsFunction(this, 'CompensationHandler', {
      functionName: config.functionNames.compensation,
      entry: 'src/handlers/phase4/compensation-handler.ts',
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(config.defaults.timeout.compensation),
      memorySize: config.defaults.memorySize?.compensation,
      environment: {
        ACTION_INTENT_TABLE_NAME: props.actionIntentTable.tableName,
        ACTION_TYPE_REGISTRY_TABLE_NAME: this.actionTypeRegistryTable.tableName,
        EXECUTION_OUTCOMES_TABLE_NAME: this.executionOutcomesTable.tableName,
        // Note: AWS_REGION is automatically set by Lambda runtime and should not be set manually
      },
      deadLetterQueue: this.compensationDlq,
      deadLetterQueueEnabled: true,
      retryAttempts: config.lambda.retryAttempts,
    });
    
    // Grant permissions
    props.actionIntentTable.grantReadData(handler);
    this.actionTypeRegistryTable.grantReadData(handler);
    this.executionOutcomesTable.grantReadWriteData(handler);
    
    return handler;
  }

  private createExecutionStatusApiHandler(
    props: ExecutionInfrastructureProps,
    config: ExecutionInfrastructureConfig
  ): lambda.Function {
    const handler = new lambdaNodejs.NodejsFunction(this, 'ExecutionStatusAPIHandler', {
      functionName: config.functionNames.executionStatusApi,
      entry: 'src/handlers/phase4/execution-status-api-handler.ts',
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(config.defaults.timeout.executionStatusApi),
      memorySize: config.defaults.memorySize?.executionStatusApi,
      environment: {
        EXECUTION_OUTCOMES_TABLE_NAME: this.executionOutcomesTable.tableName,
        EXECUTION_ATTEMPTS_TABLE_NAME: this.executionAttemptsTable.tableName,
        ACTION_INTENT_TABLE_NAME: props.actionIntentTable.tableName,
      },
    });
    this.executionOutcomesTable.grantReadData(handler);
    this.executionAttemptsTable.grantReadData(handler);
    props.actionIntentTable.grantReadData(handler);
    return handler;
  }

  private createExecutionStatusApiGateway(props: ExecutionInfrastructureProps): void {
    if (!props.apiGateway || !props.executionStatusAuthorizer) return;
    if (!props.executionsResource || !props.accountsResource) {
      throw new Error(
        'When apiGateway is set, executionsResource and accountsResource must be provided by the parent stack.'
      );
    }
    const statusResource = props.executionsResource
      .addResource('{action_intent_id}')
      .addResource('status');
    statusResource.addMethod(
      'GET',
      new apigateway.LambdaIntegration(this.executionStatusApiHandler),
      { authorizer: props.executionStatusAuthorizer }
    );
    const accountExecutionsResource = props.accountsResource
      .addResource('{account_id}')
      .addResource('executions');
    accountExecutionsResource.addMethod(
      'GET',
      new apigateway.LambdaIntegration(this.executionStatusApiHandler),
      { authorizer: props.executionStatusAuthorizer }
    );
  }

  private static readonly ALARM_PERIOD = cdk.Duration.minutes(5);
  private static readonly ALARM_STATISTIC_SUM = 'Sum';

  private createCloudWatchAlarms(config: ExecutionInfrastructureConfig): void {
    new cloudwatch.Alarm(this, 'ExecutionFailureAlarm', {
      metric: this.executionStateMachine.metricFailed({
        period: ExecutionInfrastructure.ALARM_PERIOD,
        statistic: ExecutionInfrastructure.ALARM_STATISTIC_SUM,
      }),
      threshold: 5,
      evaluationPeriods: 1,
      alarmDescription: 'Alert when execution failures exceed threshold',
    });
    new cloudwatch.Alarm(this, 'ExecutionDurationAlarm', {
      metric: this.executionStateMachine.metricTime({
        period: ExecutionInfrastructure.ALARM_PERIOD,
        statistic: 'Average',
      }),
      threshold: 300000,
      evaluationPeriods: 1,
      alarmDescription: 'Alert when execution duration exceeds threshold',
    });
    new cloudwatch.Alarm(this, 'ExecutionThrottleAlarm', {
      metric: this.executionStateMachine.metricThrottled({
        period: ExecutionInfrastructure.ALARM_PERIOD,
        statistic: ExecutionInfrastructure.ALARM_STATISTIC_SUM,
      }),
      threshold: 10,
      evaluationPeriods: 1,
      alarmDescription: 'Alert when execution throttles exceed threshold',
    });
    this.createLambdaErrorAlarm(this.toolInvokerHandler, 'ToolInvokerErrors');
    this.createLambdaErrorAlarm(this.executionRecorderHandler, 'ExecutionRecorderErrors');
    this.createLambdaErrorAlarm(
      this.executionFailureRecorderHandler,
      'ExecutionFailureRecorderErrors'
    );
  }

  private createLambdaErrorAlarm(fn: lambda.Function, id: string): void {
    new cloudwatch.Alarm(this, id, {
      metric: fn.metricErrors({
        period: ExecutionInfrastructure.ALARM_PERIOD,
        statistic: ExecutionInfrastructure.ALARM_STATISTIC_SUM,
      }),
      threshold: 1,
      evaluationPeriods: 1,
      alarmDescription: `Alert when ${fn.functionName} reports errors`,
    });
  }

  private createExecutionStateMachine(config: ExecutionInfrastructureConfig): stepfunctions.StateMachine {
    const definition = this.buildStateMachineDefinition();
    
    return new stepfunctions.StateMachine(this, 'ExecutionStateMachine', {
      stateMachineName: config.stepFunctions.stateMachineName,
      definitionBody: stepfunctions.DefinitionBody.fromChainable(definition),
      timeout: cdk.Duration.hours(config.stepFunctions.timeoutHours),
    });
  }

  private buildStateMachineDefinition(): stepfunctions.IChainable {
    // START_EXECUTION
    const startExecution = new stepfunctionsTasks.LambdaInvoke(this, 'StartExecution', {
      lambdaFunction: this.executionStarterHandler,
      payloadResponseOnly: true, // Return payload only (not Lambda response envelope)
    });
    
    // VALIDATE_PREFLIGHT: merge output so MapActionToTool receives execution context + validation_result
    const validatePreflight = new stepfunctionsTasks.LambdaInvoke(this, 'ValidatePreflight', {
      lambdaFunction: this.executionValidatorHandler,
      payloadResponseOnly: true,
      resultPath: '$.validation_result', // Preserve execution context (action_intent_id, idempotency_key, etc.)
    });
    
    // MAP_ACTION_TO_TOOL
    const mapActionToTool = new stepfunctionsTasks.LambdaInvoke(this, 'MapActionToTool', {
      lambdaFunction: this.toolMapperHandler,
      payloadResponseOnly: true,
    });
    
    // INVOKE_TOOL (with retry)
    // Note: resultPath wraps ToolInvoker output under tool_invocation_response key
    // This matches execution-recorder-handler input schema
    // IMPORTANT: tool_name and tool_schema_version from ToolMapper output remain at top level
    // (resultPath only wraps ToolInvoker output, it doesn't replace the entire state)
    const invokeTool = new stepfunctionsTasks.LambdaInvoke(this, 'InvokeTool', {
      lambdaFunction: this.toolInvokerHandler,
      payloadResponseOnly: true,
      resultPath: '$.tool_invocation_response', // Wrap output for recorder handler
      retryOnServiceExceptions: true,
    }).addRetry({
      errors: ['TransientError'],
      interval: cdk.Duration.seconds(2),
      maxAttempts: 3,
      backoffRate: 2.0,
    });
    
    // COMPENSATE_ACTION (conditional - only if external write occurred)
    const compensateAction = new stepfunctionsTasks.LambdaInvoke(this, 'CompensateAction', {
      lambdaFunction: this.compensationHandler,
      payloadResponseOnly: true,
    });
    
    // RECORD_OUTCOME (for tool invocation results)
    const recordOutcome = new stepfunctionsTasks.LambdaInvoke(this, 'RecordOutcome', {
      lambdaFunction: this.executionRecorderHandler,
      payloadResponseOnly: true,
    });
    
    // RECORD_FAILURE (for errors in early states - uses separate failure recorder)
    const recordFailure = new stepfunctionsTasks.LambdaInvoke(this, 'RecordFailure', {
      lambdaFunction: this.executionFailureRecorderHandler,
      payloadResponseOnly: true,
    });
    
    // Add error handling
    startExecution.addCatch(recordFailure, {
      errors: ['States.ALL'],
      resultPath: '$.error',
    });
    
    validatePreflight.addCatch(recordFailure, {
      errors: ['States.ALL'],
      resultPath: '$.error',
    });
    
    mapActionToTool.addCatch(recordFailure, {
      errors: ['States.ALL'],
      resultPath: '$.error',
    });
    
    // InvokeTool errors: route to RecordFailure (not compensation)
    // Compensation should only run conditionally if external write occurred (see Choice state below)
    invokeTool.addCatch(recordFailure, {
      errors: ['States.ALL'], // All errors (TransientError exhausted, PermanentError, etc.)
      resultPath: '$.error',
    });
    
    // Choice state: Check if compensation is needed after tool invocation
    // Compensation should only run if:
    // 1. Tool invocation failed (success: false) AND
    // 2. External object refs exist (write occurred) AND
    // 3. Registry compensation strategy is AUTOMATIC
    const checkCompensation = new stepfunctions.Choice(this, 'CheckCompensation')
      .when(
        stepfunctions.Condition.and(
          stepfunctions.Condition.booleanEquals('$.tool_invocation_response.success', false),
          stepfunctions.Condition.isPresent('$.tool_invocation_response.external_object_refs[0]'),
          stepfunctions.Condition.stringEquals('$.compensation_strategy', 'AUTOMATIC')
        ),
        compensateAction.next(recordOutcome)
      )
      .otherwise(recordOutcome);
    
    // Build chain
    return startExecution
      .next(validatePreflight)
      .next(mapActionToTool)
      .next(invokeTool)
      .next(checkCompensation); // Choice state routes to compensation or directly to recordOutcome
  }

  private createExecutionTriggerRule(
    props: ExecutionInfrastructureProps,
    config: ExecutionInfrastructureConfig
  ): events.Rule {
    const rule = new events.Rule(this, 'ExecutionTriggerRule', {
      eventBus: props.eventBus,
      eventPattern: {
        source: [config.eventBridge.source],
        detailType: [config.eventBridge.detailTypes.actionApproved],
      },
    });
    
    // Trigger Step Functions with action_intent_id, tenant_id, and account_id
    // Note: tenant_id and account_id are REQUIRED - execution-starter-handler needs them for security validation
    // Note: Idempotency is handled by DynamoDB attempt lock in Phase 4.1 (ExecutionAttemptService.startAttempt)
    // EventBridge may trigger multiple executions for the same action_intent_id, but the attempt lock prevents duplicates
    rule.addTarget(new eventsTargets.SfnStateMachine(this.executionStateMachine, {
      input: events.RuleTargetInput.fromObject({
        action_intent_id: events.EventField.fromPath('$.detail.data.action_intent_id'),
        tenant_id: events.EventField.fromPath('$.detail.data.tenant_id'),
        account_id: events.EventField.fromPath('$.detail.data.account_id'),
        approval_source: events.EventField.fromPath('$.detail.data.approval_source'),
        auto_executed: events.EventField.fromPath('$.detail.data.auto_executed'),
      }),
    }));
    
    // Grant Step Functions permission to be invoked by EventBridge
    this.executionStateMachine.grantStartExecution(new iam.ServicePrincipal('events.amazonaws.com'));
    
    return rule;
  }

  // ============================================
  // Phase 4.3: Connectors VPC and Gateway Setup
  // ============================================

  // ✅ MCP Version: Define as class-level constant for reuse
  // Verify supported MCP versions in your account/region and pin one for stability
  // Check AWS documentation for current supported versions
  private readonly MCP_SUPPORTED_VERSION = '2025-03-26'; // TODO: Verify this version is supported in your region

  private createConnectorsVpc(config: ExecutionInfrastructureConfig): ec2.Vpc {
    // ✅ REQUIRED: Explicit PUBLIC and PRIVATE subnets (NAT Gateway needs public subnets)
    const vpc = new ec2.Vpc(this, 'ConnectorsVpc', {
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'ConnectorPublic',
          subnetType: ec2.SubnetType.PUBLIC, // Required for NAT Gateway
        },
        {
          cidrMask: 24,
          name: 'ConnectorPrivate',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, // Lambdas go here
        },
      ],
    });

    // Add Name tag for easier identification
    cdk.Tags.of(vpc).add('Name', 'ConnectorsVpc');

    // VPC endpoints for AWS services
    // ✅ DynamoDB uses Gateway endpoint (not Interface endpoint)
    new ec2.GatewayVpcEndpoint(this, 'DynamoDBEndpoint', {
      vpc,
      service: ec2.GatewayVpcEndpointAwsService.DYNAMODB,
    });

    // S3 also uses Gateway endpoint
    new ec2.GatewayVpcEndpoint(this, 'S3Endpoint', {
      vpc,
      service: ec2.GatewayVpcEndpointAwsService.S3,
    });

    // Interface endpoints for other services (Secrets Manager, KMS, CloudWatch Logs, STS)
    // ✅ REQUIRED: CloudWatch Logs endpoint (Lambdas in VPC need this for logging)
    new ec2.InterfaceVpcEndpoint(this, 'CloudWatchLogsEndpoint', {
      vpc,
      service: ec2.InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS,
    });

    // ✅ REQUIRED: STS endpoint (if using assumed roles or temporary credentials)
    new ec2.InterfaceVpcEndpoint(this, 'STSEndpoint', {
      vpc,
      service: ec2.InterfaceVpcEndpointAwsService.STS,
    });

    new ec2.InterfaceVpcEndpoint(this, 'SecretsManagerEndpoint', {
      vpc,
      service: ec2.InterfaceVpcEndpointAwsService.SECRETS_MANAGER,
    });

    new ec2.InterfaceVpcEndpoint(this, 'KMSEndpoint', {
      vpc,
      service: ec2.InterfaceVpcEndpointAwsService.KMS,
    });

    // Enable VPC Flow Logs for audit
    vpc.addFlowLog('ConnectorsVpcFlowLog');

    return vpc;
  }

  /**
   * Internal Adapter security group with zero-trust egress:
   * - DynamoDB via Gateway Endpoint (prefix list only, no internet)
   * - CloudWatch Logs etc. via Interface Endpoints (VPC CIDR only)
   */
  private createInternalAdapterSecurityGroup(config: ExecutionInfrastructureConfig): ec2.SecurityGroup {
    const sg = new ec2.SecurityGroup(this, 'InternalAdapterSecurityGroup', {
      vpc: this.connectorsVpc,
      description: 'Security group for Internal adapter',
      allowAllOutbound: false,
    });
    const dynamoDbPrefixListId = this.node.tryGetContext('dynamoDbPrefixListId') as string | undefined;
    if (!dynamoDbPrefixListId) {
      throw new Error(
        'dynamoDbPrefixListId is required. Run ./deploy (which looks up the DynamoDB prefix list for your region) or pass -c dynamoDbPrefixListId=pl-xxx'
      );
    }
    sg.addEgressRule(
      ec2.Peer.prefixList(dynamoDbPrefixListId),
      ec2.Port.tcp(443),
      'Allow HTTPS to DynamoDB via Gateway endpoint only (no internet)'
    );
    sg.addEgressRule(
      ec2.Peer.ipv4(this.connectorsVpc.vpcCidrBlock),
      ec2.Port.tcp(443),
      'Allow HTTPS to VPC interface endpoints (CloudWatch Logs, STS, KMS, Secrets Manager)'
    );
    return sg;
  }

  private createCrmAdapterSecurityGroup(): ec2.SecurityGroup {
    // VPC is already created at this point in constructor
    return new ec2.SecurityGroup(this, 'CrmAdapterSecurityGroup', {
      vpc: this.connectorsVpc,
      description: 'Security group for CRM adapter',
      allowAllOutbound: false, // Explicit egress control
    });
  }

  private createConnectorConfigTable(config: ExecutionInfrastructureConfig): dynamodb.Table {
    return new dynamodb.Table(this, 'ConnectorConfigTable', {
      tableName: config.tableNames.connectorConfig,
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
    });
  }

  private createInternalNotesTable(config: ExecutionInfrastructureConfig): dynamodb.Table {
    return new dynamodb.Table(this, 'InternalNotesTable', {
      tableName: config.tableNames.internalNotes,
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
    });
  }

  private createInternalTasksTable(config: ExecutionInfrastructureConfig): dynamodb.Table {
    return new dynamodb.Table(this, 'InternalTasksTable', {
      tableName: config.tableNames.internalTasks,
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
    });
  }

  private createAgentCoreGateway(
    props: ExecutionInfrastructureProps,
    config: ExecutionInfrastructureConfig
  ): bedrockagentcore.CfnGateway {
    // Validate prerequisites
    if (!props.userPool) {
      throw new Error(
        'Cognito User Pool is required for Gateway CUSTOM_JWT authorizer. ' +
        'Provide userPool in ExecutionInfrastructureProps or use AWS_IAM authorizer instead.'
      );
    }

    if (!props.userPoolClient) {
      throw new Error(
        'Cognito User Pool Client is required for Gateway CUSTOM_JWT authorizer. ' +
        'Provide userPoolClient in ExecutionInfrastructureProps.'
      );
    }

    // Create IAM role for Gateway
    const gatewayRole = new iam.Role(this, 'ExecutionGatewayRole', {
      assumedBy: new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com'),
      description: 'Execution role for AgentCore Gateway',
    });

    // ✅ REQUIRED: Add Lambda invoke permissions BEFORE Gateway is created
    // Gateway targets require the role to have permissions at creation time
    // Using ARN patterns from config (function names are known at synthesis time)
    gatewayRole.addToPolicy(new iam.PolicyStatement({
      sid: 'GatewayInvokeLambda',
      effect: iam.Effect.ALLOW,
      actions: ['lambda:InvokeFunction'],
      resources: [
        `arn:aws:lambda:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:function:${config.functionNames.internalAdapter}`,
        `arn:aws:lambda:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:function:${config.functionNames.crmAdapter}`,
      ],
    }));

    // Create Gateway using L1 CDK construct
    const gateway = new bedrockagentcore.CfnGateway(this, 'ExecutionGateway', {
      name: 'cc-native-execution-gateway',
      roleArn: gatewayRole.roleArn,
      protocolType: 'MCP',
      protocolConfiguration: {
        mcp: {
          supportedVersions: [this.MCP_SUPPORTED_VERSION],
        },
      },
      authorizerType: 'CUSTOM_JWT',
      authorizerConfiguration: {
        customJwtAuthorizer: {
          allowedClients: props.userPoolClient ? [props.userPoolClient.userPoolClientId] : [],
          discoveryUrl: props.userPool ? `https://cognito-idp.${cdk.Aws.REGION}.amazonaws.com/${props.userPool.userPoolId}/.well-known/openid-configuration` : '',
        },
      },
      description: 'AgentCore Gateway for cc-native execution layer with MCP protocol and JWT inbound auth',
    });

    // Store gateway role for later policy updates
    (this as any).gatewayRole = gatewayRole;

    return gateway;
  }

  private createInternalAdapterHandler(
    props: ExecutionInfrastructureProps,
    config: ExecutionInfrastructureConfig
  ): lambda.Function {
    const handler = new lambdaNodejs.NodejsFunction(this, 'InternalAdapterHandler', {
      functionName: config.functionNames.internalAdapter,
      entry: 'src/handlers/phase4/internal-adapter-handler.ts',
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(config.defaults.timeout.internalAdapter ?? 60),
      environment: {
        INTERNAL_NOTES_TABLE_NAME: this.internalNotesTable.tableName,
        INTERNAL_TASKS_TABLE_NAME: this.internalTasksTable.tableName,
      },
      vpc: this.connectorsVpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      securityGroups: [this.internalAdapterSecurityGroup],
    });

    // Grant permissions
    this.internalNotesTable.grantWriteData(handler);
    this.internalTasksTable.grantWriteData(handler);

    return handler;
  }

  private createCrmAdapterHandler(
    props: ExecutionInfrastructureProps,
    config: ExecutionInfrastructureConfig
  ): lambda.Function {
    const handler = new lambdaNodejs.NodejsFunction(this, 'CrmAdapterHandler', {
      functionName: config.functionNames.crmAdapter,
      entry: 'src/handlers/phase4/crm-adapter-handler.ts',
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(60), // Longer timeout for external API calls
      environment: {
        EXTERNAL_WRITE_DEDUPE_TABLE_NAME: this.externalWriteDedupeTable.tableName,
        CONNECTOR_CONFIG_TABLE_NAME: this.connectorConfigTable.tableName,
      },
      vpc: this.connectorsVpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      securityGroups: [this.crmAdapterSecurityGroup],
    });

    // Grant permissions
    this.externalWriteDedupeTable.grantReadWriteData(handler);
    this.connectorConfigTable.grantReadData(handler);
    handler.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['secretsmanager:GetSecretValue'],
      resources: [
        `arn:aws:secretsmanager:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:secret:tenant/*/account/*/connector/*`,
      ],
    }));

    return handler;
  }

  private registerGatewayTarget(
    adapterLambda: lambda.Function,
    toolName: string,
    toolSchema: bedrockagentcore.CfnGatewayTarget.ToolDefinitionProperty,
    credentialProviderType: 'GATEWAY_IAM_ROLE' | 'OAUTH' = 'GATEWAY_IAM_ROLE'
  ): void {
    // Generate unique permission ID based on tool name to avoid conflicts
    const permissionId = `AllowGatewayInvoke-${toolName.replace(/\./g, '-')}`;
    // Validate tool schema structure
    if (!toolSchema.name || !toolSchema.description || !toolSchema.inputSchema) {
      throw new Error(
        `Invalid tool schema for ${toolName}: must include name, description, and inputSchema. ` +
        `Received: ${JSON.stringify(Object.keys(toolSchema))}`
      );
    }

    const gatewayId = this.executionGateway.attrGatewayIdentifier;

    // Create Gateway Target using L1 construct
    // ✅ REQUIRED: credentialProviderConfigurations is required for Lambda targets
    // For internal adapters (no external auth needed), use GATEWAY_IAM_ROLE
    // For CRM adapters (OAuth needed), this will be updated in Phase 4.4 when credential providers are set up
    const gatewayTarget = new bedrockagentcore.CfnGatewayTarget(this, `GatewayTarget-${toolName.replace(/[^a-zA-Z0-9]/g, '-')}`, {
      gatewayIdentifier: gatewayId,
      name: toolName.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
      description: `Gateway target for ${toolName}`,
      targetConfiguration: {
        mcp: {
          lambda: {
            lambdaArn: adapterLambda.functionArn,
            toolSchema: {
              inlinePayload: [toolSchema], // ✅ Array of tool definitions (required by Gateway)
            },
          },
        },
      },
      // ✅ REQUIRED: Credential provider configuration for Lambda targets
      // Using GATEWAY_IAM_ROLE for internal adapters (no external credentials needed)
      // CRM adapter will need OAuth credential provider (to be added in Phase 4.4)
      credentialProviderConfigurations: [{
        credentialProviderType: credentialProviderType,
        // credentialProvider field can be omitted for GATEWAY_IAM_ROLE
        // For OAUTH, credentialProvider.oauthCredentialProvider will be required (Phase 4.4)
      }],
    });

    // Ensure target is created after gateway
    gatewayTarget.addDependency(this.executionGateway);

    // Grant Lambda invoke permission to Gateway
    adapterLambda.addPermission(permissionId, {
      principal: new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com'),
      sourceArn: this.executionGateway.attrGatewayArn,
    });
  }

  // ✅ REMOVED: updateGatewayRolePolicy() method
  // Lambda invoke permissions are now added directly in createAgentCoreGateway()
  // using ARN patterns from config, ensuring permissions exist before Gateway targets are created
  // This prevents CloudFormation validation errors when creating GatewayTarget resources

  private updateToolMapperHandlerGatewayUrl(): void {
    // Note: ToolMapper handler is created before Gateway in Phase 4.2, so we use a workaround:
    // The createToolMapperHandler method checks for this.gatewayUrl first (set after Gateway creation)
    // If Gateway URL is not yet available, it falls back to props.gatewayUrl for backwards compatibility
    // In Phase 4.3, Gateway is created before ToolMapper handler, so this.gatewayUrl will be used
    // This method is a placeholder for future enhancements (e.g., updating existing handler env vars)
  }

  private getInternalNoteToolSchema(): bedrockagentcore.CfnGatewayTarget.ToolDefinitionProperty {
    return {
      name: INTERNAL_CREATE_NOTE,
      description: 'Create an internal note in the system',
      inputSchema: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'Note content' },
          tenant_id: { type: 'string' },
          account_id: { type: 'string' },
        },
        required: ['content', 'tenant_id', 'account_id'],
      },
    };
  }

  private getInternalTaskToolSchema(): bedrockagentcore.CfnGatewayTarget.ToolDefinitionProperty {
    return {
      name: INTERNAL_CREATE_TASK,
      description: 'Create an internal task in the system',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Task title' },
          description: { type: 'string', description: 'Task description' },
          tenant_id: { type: 'string' },
          account_id: { type: 'string' },
        },
        required: ['title', 'tenant_id', 'account_id'],
      },
    };
  }

  private getCrmTaskToolSchema(): bedrockagentcore.CfnGatewayTarget.ToolDefinitionProperty {
    return {
      name: CRM_CREATE_TASK,
      description: 'Create a task in CRM system',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Task title' },
          description: { type: 'string', description: 'Task description' },
          priority: { type: 'string', description: 'Task priority' },
          tenant_id: { type: 'string' },
          account_id: { type: 'string' },
          idempotency_key: { type: 'string' },
          action_intent_id: { type: 'string' },
        },
        required: ['title', 'tenant_id', 'account_id', 'idempotency_key', 'action_intent_id'],
      },
    };
  }
}
