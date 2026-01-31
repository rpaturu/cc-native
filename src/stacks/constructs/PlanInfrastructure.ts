/**
 * Plan Infrastructure - Phase 6.1
 *
 * RevenuePlans table, PlanLedger table (append-only), plan-lifecycle-api Lambda.
 * See PHASE_6_1_CODE_LEVEL_PLAN.md §4, §7.
 */

import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';

export interface PlanInfrastructureProps {
  readonly revenuePlansTableName?: string;
  readonly planLedgerTableName?: string;
  readonly planLifecycleApiFunctionName?: string;
  readonly timeoutSeconds?: number;
  readonly memorySize?: number;
}

const DEFAULT_REVENUE_PLANS = 'cc-native-revenue-plans';
const DEFAULT_PLAN_LEDGER = 'cc-native-plan-ledger';
const DEFAULT_PLAN_LIFECYCLE_API = 'cc-native-plan-lifecycle-api';

export class PlanInfrastructure extends Construct {
  public readonly revenuePlansTable: dynamodb.Table;
  public readonly planLedgerTable: dynamodb.Table;
  public readonly planLifecycleApiHandler: lambda.Function;

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
  }
}
