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
  readonly gatewayUrl?: string; // AgentCore Gateway URL (required for Phase 4.2)
  readonly userPool?: cognito.IUserPool; // Cognito User Pool for JWT token retrieval (optional)
  readonly artifactsBucket?: s3.IBucket; // S3 bucket for raw response artifacts (optional, will be created if not provided)
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
    
    // Phase 4.2: Additional Lambda Functions
    this.toolMapperHandler = this.createToolMapperHandler(props, config);
    this.toolInvokerHandler = this.createToolInvokerHandler(props, config);
    this.executionRecorderHandler = this.createExecutionRecorderHandler(props, config);
    this.executionFailureRecorderHandler = this.createExecutionFailureRecorderHandler(props, config);
    this.compensationHandler = this.createCompensationHandler(props, config);
    
    // Phase 4.2: S3 Bucket (if not provided)
    if (!props.artifactsBucket) {
      this.executionArtifactsBucket = new s3.Bucket(this, 'ExecutionArtifactsBucket', {
        bucketName: `${config.s3.executionArtifactsBucketPrefix}-${cdk.Aws.ACCOUNT_ID}-${cdk.Aws.REGION}`,
        versioned: true,
        encryption: s3.BucketEncryption.S3_MANAGED,
      });
    } else {
      this.executionArtifactsBucket = props.artifactsBucket;
    }
    
    // Phase 4.2: Step Functions State Machine
    this.executionStateMachine = this.createExecutionStateMachine(config);
    
    // Phase 4.2: EventBridge Rule
    this.executionTriggerRule = this.createExecutionTriggerRule(props, config);
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
        AGENTCORE_GATEWAY_URL: props.gatewayUrl || (() => {
          throw new Error(
            '[ExecutionInfrastructure] Missing required property: gatewayUrl. ' +
            'Provide gatewayUrl in ExecutionInfrastructureProps or ensure AgentCore Gateway is configured. ' +
            'The Gateway URL is required for tool-mapper-handler to invoke connector adapters.'
          );
        })(),
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
    config: ExecutionInfrastructureConfig
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
    // Note: JWT token retrieval is done in ToolInvoker (not ToolMapper) to keep mapping deterministic
    if (props.userPool) {
      handler.addToRolePolicy(new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['cognito-idp:GetUser', 'cognito-idp:InitiateAuth'],
        resources: [props.userPool.userPoolArn],
      }));
    }
    
    return handler;
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

  private createExecutionStateMachine(config: ExecutionInfrastructureConfig): stepfunctions.StateMachine {
    const definition = this.buildStateMachineDefinition();
    
    return new stepfunctions.StateMachine(this, 'ExecutionStateMachine', {
      stateMachineName: config.stepFunctions.stateMachineName,
      definition,
      timeout: cdk.Duration.hours(config.stepFunctions.timeoutHours),
    });
  }

  private buildStateMachineDefinition(): stepfunctions.IChainable {
    // START_EXECUTION
    const startExecution = new stepfunctionsTasks.LambdaInvoke(this, 'StartExecution', {
      lambdaFunction: this.executionStarterHandler,
      payloadResponseOnly: true, // Return payload only (not Lambda response envelope)
    });
    
    // VALIDATE_PREFLIGHT
    const validatePreflight = new stepfunctionsTasks.LambdaInvoke(this, 'ValidatePreflight', {
      lambdaFunction: this.executionValidatorHandler,
      payloadResponseOnly: true,
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
      }),
    }));
    
    // Grant Step Functions permission to be invoked by EventBridge
    this.executionStateMachine.grantStartExecution(new iam.ServicePrincipal('events.amazonaws.com'));
    
    return rule;
  }
}
