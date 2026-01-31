/**
 * Phase 6.3 — Plan Orchestrator Lambda: EventBridge schedule, runCycle per tenant (tenant IDs from Tenants table).
 * See PHASE_6_3_CODE_LEVEL_PLAN.md §5.
 */

import { Handler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { Logger } from '../../services/core/Logger';
import { PlanRepositoryService } from '../../services/plan/PlanRepositoryService';
import { PlanLedgerService } from '../../services/plan/PlanLedgerService';
import { PlanLifecycleService } from '../../services/plan/PlanLifecycleService';
import { PlanPolicyGateService } from '../../services/plan/PlanPolicyGateService';
import { PlanStateEvaluatorService } from '../../services/plan/PlanStateEvaluatorService';
import { PlanStepExecutionStateService } from '../../services/plan/PlanStepExecutionStateService';
import { PlanStepToActionIntentAdapter } from '../../services/plan/PlanStepToActionIntentAdapter';
import { PlanOrchestratorService } from '../../services/plan/PlanOrchestratorService';
import { ActionIntentService } from '../../services/decision/ActionIntentService';
import { getPlanTypeConfig } from '../../config/planTypeConfig';
import { getAWSClientConfig } from '../../utils/aws-client-config';

const logger = new Logger('PlanOrchestrator');

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`[PlanOrchestrator] Missing env: ${name}`);
  return v;
}

async function listTenantIds(
  dynamoClient: DynamoDBDocumentClient,
  tenantsTableName: string
): Promise<string[]> {
  const result = await dynamoClient.send(
    new ScanCommand({
      TableName: tenantsTableName,
      ProjectionExpression: 'tenantId',
    })
  );
  const ids = (result.Items ?? [])
    .map((item) => item?.tenantId as string | undefined)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
  return [...new Set(ids)];
}

function buildOrchestrator(dynamoClient: DynamoDBDocumentClient): PlanOrchestratorService {
  const region = process.env.AWS_REGION ?? 'us-east-1';
  const revenuePlansTable = requireEnv('REVENUE_PLANS_TABLE_NAME');
  const planLedgerTable = requireEnv('PLAN_LEDGER_TABLE_NAME');
  const planStepExecutionTable = requireEnv('PLAN_STEP_EXECUTION_TABLE_NAME');
  const actionIntentTable = requireEnv('ACTION_INTENT_TABLE_NAME');
  const maxPlansPerRun = parseInt(
    process.env.ORCHESTRATOR_MAX_PLANS_PER_RUN ?? '10',
    10
  );

  const repo = new PlanRepositoryService(logger, {
    tableName: revenuePlansTable,
    region,
  });
  const ledger = new PlanLedgerService(logger, {
    tableName: planLedgerTable,
    region,
  });
  const gate = new PlanPolicyGateService({ getPlanTypeConfig });
  const lifecycle = new PlanLifecycleService({
    planRepository: repo,
    planLedger: ledger,
    logger,
  });
  const evaluator = new PlanStateEvaluatorService();
  const stepState = new PlanStepExecutionStateService(logger, {
    tableName: planStepExecutionTable,
    region,
  });
  const actionIntentService = new ActionIntentService(
    dynamoClient,
    actionIntentTable,
    logger
  );
  const createIntent = new PlanStepToActionIntentAdapter(actionIntentService);

  return new PlanOrchestratorService({
    planRepository: repo,
    planLifecycle: lifecycle,
    planPolicyGate: gate,
    planLedger: ledger,
    planStateEvaluator: evaluator,
    stepExecutionState: stepState,
    createIntentFromPlanStep: createIntent,
    getPlanTypeConfig,
    logger,
    maxPlansPerRun,
  });
}

export const handler: Handler = async (_event: unknown): Promise<void> => {
  const tenantsTableName = requireEnv('TENANTS_TABLE_NAME');
  const region = process.env.AWS_REGION ?? 'us-east-1';
  const dynamoClient = DynamoDBDocumentClient.from(
    new DynamoDBClient(getAWSClientConfig(region)),
    { marshallOptions: { removeUndefinedValues: true } }
  );

  const tenantIds = await listTenantIds(dynamoClient, tenantsTableName);
  if (tenantIds.length === 0) {
    logger.info('Plan orchestrator cycle: no tenants');
    return;
  }

  const orchestrator = buildOrchestrator(dynamoClient);
  let activated = 0;
  let stepsStarted = 0;
  let completed = 0;
  let expired = 0;

  for (const tenantId of tenantIds) {
    const result = await orchestrator.runCycle(tenantId);
    activated += result.activated;
    stepsStarted += result.stepsStarted;
    completed += result.completed;
    expired += result.expired;
  }

  logger.info('Plan orchestrator cycle completed', {
    tenantCount: tenantIds.length,
    activated,
    stepsStarted,
    completed,
    expired,
  });
};
