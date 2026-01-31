/**
 * Decision Scheduling Infrastructure - Phase 5.2
 *
 * DecisionRunState + IdempotencyStore tables, CostGate Lambda, Requeue Lambda,
 * EventBridge rules for RUN_DECISION and RUN_DECISION_DEFERRED, Scheduler role for retries.
 */

import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as events from 'aws-cdk-lib/aws-events';
import * as eventsTargets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import {
  DecisionSchedulingInfrastructureConfig,
  DEFAULT_DECISION_SCHEDULING_INFRASTRUCTURE_CONFIG,
} from './DecisionSchedulingInfrastructureConfig';

export interface DecisionSchedulingInfrastructureProps {
  readonly eventBus: events.IEventBus;
  readonly config?: DecisionSchedulingInfrastructureConfig;
}

export class DecisionSchedulingInfrastructure extends Construct {
  public readonly decisionRunStateTable: dynamodb.Table;
  public readonly idempotencyStoreTable: dynamodb.Table;
  public readonly decisionCostGateHandler: lambda.Function;
  public readonly decisionDeferredRequeueHandler: lambda.Function;
  public readonly schedulerRole: iam.Role;

  constructor(
    scope: Construct,
    id: string,
    props: DecisionSchedulingInfrastructureProps
  ) {
    super(scope, id);

    const config =
      props.config ?? DEFAULT_DECISION_SCHEDULING_INFRASTRUCTURE_CONFIG;

    this.decisionRunStateTable = new dynamodb.Table(
      this,
      'DecisionRunStateTable',
      {
        tableName: config.tableNames.decisionRunState,
        partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
        sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
        billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
        pointInTimeRecoverySpecification: {
          pointInTimeRecoveryEnabled: true,
        },
      }
    );

    this.idempotencyStoreTable = new dynamodb.Table(
      this,
      'IdempotencyStoreTable',
      {
        tableName: config.tableNames.idempotencyStore,
        partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
        sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
        billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
        timeToLiveAttribute: 'ttl',
        pointInTimeRecoverySpecification: {
          pointInTimeRecoveryEnabled: true,
        },
      }
    );

    this.decisionCostGateHandler = new lambdaNodejs.NodejsFunction(
      this,
      'DecisionCostGateHandler',
      {
        functionName: config.functionNames.decisionCostGate,
        entry: 'src/handlers/phase5/decision-cost-gate-handler.ts',
        handler: 'handler',
        runtime: lambda.Runtime.NODEJS_20_X,
        timeout: cdk.Duration.seconds(config.defaults.timeoutSeconds),
        memorySize: config.defaults.memorySize,
        environment: {
          DECISION_RUN_STATE_TABLE_NAME: this.decisionRunStateTable.tableName,
          IDEMPOTENCY_STORE_TABLE_NAME: this.idempotencyStoreTable.tableName,
          EVENT_BUS_NAME: props.eventBus.eventBusName,
        },
      }
    );

    this.decisionRunStateTable.grantReadWriteData(this.decisionCostGateHandler);
    this.idempotencyStoreTable.grantReadWriteData(this.decisionCostGateHandler);
    props.eventBus.grantPutEventsTo(this.decisionCostGateHandler);

    this.schedulerRole = new iam.Role(this, 'DecisionSchedulerRole', {
      assumedBy: new iam.ServicePrincipal('scheduler.amazonaws.com'),
      description: 'Role for EventBridge Scheduler to invoke decision cost gate Lambda',
    });
    this.decisionCostGateHandler.grantInvoke(this.schedulerRole);

    this.decisionDeferredRequeueHandler = new lambdaNodejs.NodejsFunction(
      this,
      'DecisionDeferredRequeueHandler',
      {
        functionName: config.functionNames.decisionDeferredRequeue,
        entry: 'src/handlers/phase5/decision-deferred-requeue-handler.ts',
        handler: 'handler',
        runtime: lambda.Runtime.NODEJS_20_X,
        timeout: cdk.Duration.seconds(config.defaults.timeoutSeconds),
        memorySize: config.defaults.memorySize,
        environment: {
          DECISION_COST_GATE_HANDLER_ARN: this.decisionCostGateHandler.functionArn,
          DECISION_SCHEDULER_ROLE_ARN: this.schedulerRole.roleArn,
          SCHEDULE_GROUP_NAME: config.scheduleGroupName,
        },
      }
    );

    this.decisionDeferredRequeueHandler.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'scheduler:CreateSchedule',
          'scheduler:GetSchedule',
          'scheduler:DeleteSchedule',
        ],
        resources: ['*'],
      })
    );
    this.decisionDeferredRequeueHandler.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['iam:PassRole'],
        resources: [this.schedulerRole.roleArn],
        conditions: {
          StringEquals: {
            'iam:PassedToService': 'scheduler.amazonaws.com',
          },
        },
      })
    );

    const runDecisionRule = new events.Rule(this, 'RunDecisionRule', {
      eventBus: props.eventBus,
      eventPattern: {
        source: ['cc-native'],
        detailType: ['RUN_DECISION'],
      },
      description: 'Route RUN_DECISION to cost gate handler (Phase 5.2)',
    });
    runDecisionRule.addTarget(
      new eventsTargets.LambdaFunction(this.decisionCostGateHandler)
    );

    const runDecisionDeferredRule = new events.Rule(
      this,
      'RunDecisionDeferredRule',
      {
        eventBus: props.eventBus,
        eventPattern: {
          source: ['cc-native'],
          detailType: ['RUN_DECISION_DEFERRED'],
        },
        description: 'Route RUN_DECISION_DEFERRED to requeue handler (Phase 5.2)',
      }
    );
    runDecisionDeferredRule.addTarget(
      new eventsTargets.LambdaFunction(this.decisionDeferredRequeueHandler)
    );
  }
}
