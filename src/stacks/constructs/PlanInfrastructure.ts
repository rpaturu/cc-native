/**
 * Plan Infrastructure - Phase 6.1, 6.3, 6.4
 *
 * Phase 6.1: RevenuePlans table, PlanLedger table (append-only), plan-lifecycle-api Lambda.
 * Phase 6.3: PlanStepExecution table, plan-orchestrator Lambda, EventBridge schedule.
 * Phase 6.4: API Gateway wiring for GET /plans, GET /plans/{planId}, GET /plans/{planId}/ledger and POST routes (same Lambda, same authorizer).
 * See PHASE_6_1_CODE_LEVEL_PLAN.md §4, §7; PHASE_6_3_CODE_LEVEL_PLAN.md §7, §8; PHASE_6_4_CODE_LEVEL_PLAN.md §4.
 */

import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';

export interface PlanInfrastructureProps {
  readonly revenuePlansTableName?: string;
  readonly planLedgerTableName?: string;
  readonly planLifecycleApiFunctionName?: string;
  readonly planStepExecutionTableName?: string;
  readonly planOrchestratorFunctionName?: string;
  readonly orchestratorMaxPlansPerRun?: number;
  readonly orchestratorScheduleMinutes?: number;
  /** Phase 6.3: When set, creates plan-orchestrator Lambda (needs action intent table for Phase 3/4). */
  readonly actionIntentTable?: dynamodb.Table;
  /** Phase 6.3: Tenants table for orchestrator to discover tenant IDs at runtime (env TENANTS_TABLE_NAME). Required when actionIntentTable is set. */
  readonly tenantsTable?: dynamodb.Table;
  /** Phase 6.4: When set with plansAuthorizer, wires GET/POST plan routes to plan-lifecycle Lambda. */
  readonly apiGateway?: apigateway.RestApi;
  /** Phase 6.4: Same authorizer for all plan routes (required when apiGateway is set). */
  readonly plansAuthorizer?: apigateway.IAuthorizer;
  readonly timeoutSeconds?: number;
  readonly memorySize?: number;
}

const DEFAULT_REVENUE_PLANS = 'cc-native-revenue-plans';
const DEFAULT_PLAN_LEDGER = 'cc-native-plan-ledger';
const DEFAULT_PLAN_LIFECYCLE_API = 'cc-native-plan-lifecycle-api';
const DEFAULT_PLAN_STEP_EXECUTION = 'cc-native-plan-step-execution';
const DEFAULT_PLAN_ORCHESTRATOR_API = 'cc-native-plan-orchestrator';
const DEFAULT_ORCHESTRATOR_MAX_PLANS = 10;
const DEFAULT_ORCHESTRATOR_SCHEDULE_MINUTES = 15;

export class PlanInfrastructure extends Construct {
  public readonly revenuePlansTable: dynamodb.Table;
  public readonly planLedgerTable: dynamodb.Table;
  public readonly planLifecycleApiHandler: lambda.Function;
  /** Phase 6.3: Step execution state (attempt, idempotency). */
  public readonly planStepExecutionTable?: dynamodb.Table;
  /** Phase 6.3: Orchestrator Lambda (when actionIntentTable provided). */
  public readonly planOrchestratorHandler?: lambda.Function;

  constructor(
    scope: Construct,
    id: string,
    props: PlanInfrastructureProps = {}
  ) {
    super(scope, id);

    const revenuePlansTableName = props.revenuePlansTableName ?? DEFAULT_REVENUE_PLANS;
    const planLedgerTableName = props.planLedgerTableName ?? DEFAULT_PLAN_LEDGER;
    const functionName = props.planLifecycleApiFunctionName ?? DEFAULT_PLAN_LIFECYCLE_API;
    const timeout = cdk.Duration.seconds(props.timeoutSeconds ?? 30);
    const memorySize = props.memorySize ?? 256;

    this.revenuePlansTable = new dynamodb.Table(this, 'RevenuePlansTable', {
      tableName: revenuePlansTableName,
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
    });
    this.revenuePlansTable.addGlobalSecondaryIndex({
      indexName: 'gsi1-index',
      partitionKey: { name: 'gsi1pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'gsi1sk', type: dynamodb.AttributeType.STRING },
    });
    this.revenuePlansTable.addGlobalSecondaryIndex({
      indexName: 'gsi2-index',
      partitionKey: { name: 'gsi2pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'gsi2sk', type: dynamodb.AttributeType.STRING },
    });

    this.planLedgerTable = new dynamodb.Table(this, 'PlanLedgerTable', {
      tableName: planLedgerTableName,
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
    });
    this.planLedgerTable.addGlobalSecondaryIndex({
      indexName: 'gsi1-index',
      partitionKey: { name: 'gsi1pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'gsi1sk', type: dynamodb.AttributeType.STRING },
    });

    this.planLifecycleApiHandler = new lambdaNodejs.NodejsFunction(
      this,
      'PlanLifecycleApiHandler',
      {
        functionName,
        entry: 'src/handlers/phase6/plan-lifecycle-api-handler.ts',
        handler: 'handler',
        runtime: lambda.Runtime.NODEJS_20_X,
        timeout,
        memorySize,
        environment: {
          REVENUE_PLANS_TABLE_NAME: this.revenuePlansTable.tableName,
          PLAN_LEDGER_TABLE_NAME: this.planLedgerTable.tableName,
        },
      }
    );

    this.revenuePlansTable.grantReadWriteData(this.planLifecycleApiHandler);
    this.planLedgerTable.grantReadWriteData(this.planLifecycleApiHandler);

    if (!props.apiGateway || !props.plansAuthorizer) {
      throw new Error('PlanInfrastructure (dev): apiGateway and plansAuthorizer are required. Fail-fast, no fallback.');
    }
    this.createPlansApiGateway(props.apiGateway, props.plansAuthorizer);

    if (props.actionIntentTable && props.tenantsTable) {
      const planStepExecutionTableName =
        props.planStepExecutionTableName ?? DEFAULT_PLAN_STEP_EXECUTION;
      const planOrchestratorFunctionName =
        props.planOrchestratorFunctionName ?? DEFAULT_PLAN_ORCHESTRATOR_API;
      const maxPlans =
        props.orchestratorMaxPlansPerRun ?? DEFAULT_ORCHESTRATOR_MAX_PLANS;
      const scheduleMinutes =
        props.orchestratorScheduleMinutes ??
        DEFAULT_ORCHESTRATOR_SCHEDULE_MINUTES;

      this.planStepExecutionTable = new dynamodb.Table(
        this,
        'PlanStepExecutionTable',
        {
          tableName: planStepExecutionTableName,
          partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
          sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
          billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
          pointInTimeRecoverySpecification: {
            pointInTimeRecoveryEnabled: true,
          },
        }
      );

      const orchestratorEnv: Record<string, string> = {
        REVENUE_PLANS_TABLE_NAME: this.revenuePlansTable.tableName,
        PLAN_LEDGER_TABLE_NAME: this.planLedgerTable.tableName,
        PLAN_STEP_EXECUTION_TABLE_NAME: this.planStepExecutionTable.tableName,
        ACTION_INTENT_TABLE_NAME: props.actionIntentTable.tableName,
        TENANTS_TABLE_NAME: props.tenantsTable.tableName,
        ORCHESTRATOR_MAX_PLANS_PER_RUN: String(maxPlans),
      };

      this.planOrchestratorHandler = new lambdaNodejs.NodejsFunction(
        this,
        'PlanOrchestratorHandler',
        {
          functionName: planOrchestratorFunctionName,
          entry: 'src/handlers/phase6/plan-orchestrator-handler.ts',
          handler: 'handler',
          runtime: lambda.Runtime.NODEJS_20_X,
          timeout: cdk.Duration.seconds(props.timeoutSeconds ?? 60),
          memorySize: props.memorySize ?? 256,
          environment: orchestratorEnv,
        }
      );

      this.revenuePlansTable.grantReadWriteData(this.planOrchestratorHandler);
      this.planLedgerTable.grantReadWriteData(this.planOrchestratorHandler);
      this.planStepExecutionTable.grantReadWriteData(
        this.planOrchestratorHandler
      );
      props.actionIntentTable.grantReadWriteData(this.planOrchestratorHandler);
      props.tenantsTable.grantReadData(this.planOrchestratorHandler);

      const rule = new events.Rule(this, 'PlanOrchestratorSchedule', {
        schedule: events.Schedule.rate(
          cdk.Duration.minutes(scheduleMinutes)
        ),
        description: 'Trigger plan orchestrator cycle (Phase 6.3)',
      });
      rule.addTarget(
        new targets.LambdaFunction(this.planOrchestratorHandler)
      );
    }
  }

  private createPlansApiGateway(
    api: apigateway.RestApi,
    authorizer: apigateway.IAuthorizer
  ): void {
    const integration = new apigateway.LambdaIntegration(
      this.planLifecycleApiHandler
    );
    const methodOpts = { authorizer };

    const plansResource = api.root.addResource('plans');
    plansResource.addMethod('GET', integration, methodOpts);
    const proposeResource = plansResource.addResource('propose');
    proposeResource.addMethod('POST', integration, methodOpts);

    const planIdResource = plansResource.addResource('{planId}');
    planIdResource.addMethod('GET', integration, methodOpts);
    planIdResource.addResource('ledger').addMethod('GET', integration, methodOpts);
    planIdResource.addResource('approve').addMethod('POST', integration, methodOpts);
    planIdResource.addResource('pause').addMethod('POST', integration, methodOpts);
    planIdResource.addResource('resume').addMethod('POST', integration, methodOpts);
    planIdResource.addResource('abort').addMethod('POST', integration, methodOpts);
  }
}
