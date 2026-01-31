/**
 * Perception Scheduler Infrastructure - Phase 5.3
 *
 * DDB tables (heat + budget + pull idempotency), Lambda handlers (heat scoring, pull orchestrator),
 * and EventBridge rules (periodic heat scoring, SIGNAL_DETECTED → heat scoring, periodic pull).
 */

import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as events from 'aws-cdk-lib/aws-events';
import * as eventsTargets from 'aws-cdk-lib/aws-events-targets';
import { Construct } from 'constructs';
import {
  PerceptionSchedulerInfrastructureConfig,
  DEFAULT_PERCEPTION_SCHEDULER_INFRASTRUCTURE_CONFIG,
} from './PerceptionSchedulerInfrastructureConfig';

export interface PerceptionSchedulerInfrastructureProps {
  readonly eventBus: events.IEventBus;
  readonly accountPostureStateTable: dynamodb.Table;
  readonly signalsTable: dynamodb.Table;
  readonly config?: PerceptionSchedulerInfrastructureConfig;
}

export class PerceptionSchedulerInfrastructure extends Construct {
  public readonly perceptionSchedulerTable: dynamodb.Table;
  public readonly pullIdempotencyStoreTable: dynamodb.Table;
  public readonly heatScoringHandler: lambda.Function;
  public readonly perceptionPullOrchestratorHandler: lambda.Function;

  constructor(
    scope: Construct,
    id: string,
    props: PerceptionSchedulerInfrastructureProps
  ) {
    super(scope, id);

    const config =
      props.config ?? DEFAULT_PERCEPTION_SCHEDULER_INFRASTRUCTURE_CONFIG;

    this.perceptionSchedulerTable = new dynamodb.Table(
      this,
      'PerceptionSchedulerTable',
      {
        tableName: config.tableNames.perceptionScheduler,
        partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
        sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
        billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
        pointInTimeRecoverySpecification: {
          pointInTimeRecoveryEnabled: true,
        },
      }
    );

    this.pullIdempotencyStoreTable = new dynamodb.Table(
      this,
      'PullIdempotencyStoreTable',
      {
        tableName: config.tableNames.pullIdempotencyStore,
        partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
        sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
        billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
        timeToLiveAttribute: 'ttl',
        pointInTimeRecoverySpecification: {
          pointInTimeRecoveryEnabled: true,
        },
      }
    );

    this.heatScoringHandler = new lambdaNodejs.NodejsFunction(
      this,
      'HeatScoringHandler',
      {
        functionName: config.functionNames.heatScoring,
        entry: 'src/handlers/phase5/heat-scoring-handler.ts',
        handler: 'handler',
        runtime: lambda.Runtime.NODEJS_20_X,
        timeout: cdk.Duration.seconds(config.defaults.timeoutSeconds),
        memorySize: config.defaults.memorySize,
        environment: {
          PERCEPTION_SCHEDULER_TABLE_NAME: this.perceptionSchedulerTable.tableName,
          ACCOUNT_POSTURE_STATE_TABLE_NAME: props.accountPostureStateTable.tableName,
          SIGNALS_TABLE_NAME: props.signalsTable.tableName,
        },
      }
    );
    this.perceptionSchedulerTable.grantReadWriteData(this.heatScoringHandler);
    props.accountPostureStateTable.grantReadData(this.heatScoringHandler);
    props.signalsTable.grantReadData(this.heatScoringHandler);

    this.perceptionPullOrchestratorHandler = new lambdaNodejs.NodejsFunction(
      this,
      'PerceptionPullOrchestratorHandler',
      {
        functionName: config.functionNames.perceptionPullOrchestrator,
        entry: 'src/handlers/phase5/perception-pull-orchestrator-handler.ts',
        handler: 'handler',
        runtime: lambda.Runtime.NODEJS_20_X,
        timeout: cdk.Duration.seconds(config.defaults.timeoutSeconds),
        memorySize: config.defaults.memorySize,
        environment: {
          PERCEPTION_SCHEDULER_TABLE_NAME: this.perceptionSchedulerTable.tableName,
          PULL_IDEMPOTENCY_STORE_TABLE_NAME: this.pullIdempotencyStoreTable.tableName,
        },
      }
    );
    this.perceptionSchedulerTable.grantReadWriteData(this.perceptionPullOrchestratorHandler);
    this.pullIdempotencyStoreTable.grantReadWriteData(this.perceptionPullOrchestratorHandler);

    // Rule: SIGNAL_DETECTED → heat-scoring-handler (recompute heat on signal arrival)
    const signalDetectedHeatRule = new events.Rule(this, 'SignalDetectedHeatScoringRule', {
      eventBus: props.eventBus,
      eventPattern: {
        source: ['cc-native.perception'],
        detailType: ['SIGNAL_DETECTED', 'SIGNAL_CREATED'],
      },
      description: 'Trigger heat scoring on signal arrival (Phase 5.3)',
    });
    signalDetectedHeatRule.addTarget(
      new eventsTargets.LambdaFunction(this.heatScoringHandler, {
        event: events.RuleTargetInput.fromEventPath('$.detail'),
      })
    );

    // Rule: HEAT_SCORING_SCHEDULED (periodic) → heat-scoring-handler
    const heatScoringScheduleRule = new events.Rule(this, 'HeatScoringScheduleRule', {
      schedule: events.Schedule.rate(cdk.Duration.hours(1)),
      description: 'Periodic heat scoring sweep (Phase 5.3)',
    });
    heatScoringScheduleRule.addTarget(
      new eventsTargets.LambdaFunction(this.heatScoringHandler, {
        event: events.RuleTargetInput.fromObject({
          tenantId: '',
          accountIds: [],
        }),
      })
    );
    // Rule: PERCEPTION_PULL_SCHEDULED (periodic) → perception-pull-orchestrator-handler
    const pullScheduleRule = new events.Rule(this, 'PerceptionPullScheduleRule', {
      schedule: events.Schedule.rate(cdk.Duration.hours(1)),
      description: 'Periodic perception pull orchestration (Phase 5.3)',
    });
    pullScheduleRule.addTarget(
      new eventsTargets.LambdaFunction(this.perceptionPullOrchestratorHandler, {
        event: events.RuleTargetInput.fromObject({ jobs: [] }),
      })
    );
  }
}