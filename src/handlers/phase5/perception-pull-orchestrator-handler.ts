/**
 * Perception Pull Orchestrator Handler - Phase 5.3
 *
 * Schedules a pull job: rate-limit check → reserve idempotency → atomic consume budget → emit job.
 * Triggered by: EventBridge schedule or event with job candidate(s).
 * Input: single SchedulePullInput or { jobs: SchedulePullInput[] }.
 */

import { Handler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { getAWSClientConfig } from '../../utils/aws-client-config';
import { Logger } from '../../services/core/Logger';
import { PerceptionPullBudgetService } from '../../services/perception/PerceptionPullBudgetService';
import { PullIdempotencyStoreService } from '../../services/perception/PullIdempotencyStoreService';
import { HeatTierPolicyService } from '../../services/perception/HeatTierPolicyService';
import { PerceptionPullOrchestrator } from '../../services/perception/PerceptionPullOrchestrator';
import type { SchedulePullInput } from '../../services/perception/PerceptionPullOrchestrator';

const logger = new Logger('PerceptionPullOrchestratorHandler');
const region = process.env.AWS_REGION || 'us-west-2';
const clientConfig = getAWSClientConfig(region);
const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient(clientConfig), {
  marshallOptions: { removeUndefinedValues: true },
});

const perceptionSchedulerTableName =
  process.env.PERCEPTION_SCHEDULER_TABLE_NAME || 'cc-native-perception-scheduler';
const pullIdempotencyStoreTableName =
  process.env.PULL_IDEMPOTENCY_STORE_TABLE_NAME || 'cc-native-pull-idempotency-store';

const budgetService = new PerceptionPullBudgetService(
  dynamoClient,
  perceptionSchedulerTableName,
  logger
);
const idempotencyService = new PullIdempotencyStoreService(
  dynamoClient,
  pullIdempotencyStoreTableName,
  logger
);
const heatTierPolicyService = new HeatTierPolicyService();
const orchestrator = new PerceptionPullOrchestrator({
  perceptionPullBudgetService: budgetService,
  pullIdempotencyStoreService: idempotencyService,
  heatTierPolicyService,
  logger,
});

export interface PullOrchestratorEvent {
  tenantId?: string;
  accountId?: string;
  connectorId?: string;
  pullJobId?: string;
  depth?: 'SHALLOW' | 'DEEP';
  correlationId?: string;
  jobs?: SchedulePullInput[];
}

function normalizeInput(event: PullOrchestratorEvent): SchedulePullInput[] {
  if (event.jobs && event.jobs.length > 0) {
    return event.jobs;
  }
  if (event.tenantId && event.accountId && event.connectorId && event.pullJobId) {
    return [
      {
        tenantId: event.tenantId,
        accountId: event.accountId,
        connectorId: event.connectorId,
        pullJobId: event.pullJobId,
        depth: (event.depth as 'SHALLOW' | 'DEEP') || 'SHALLOW',
        correlationId: event.correlationId,
      },
    ];
  }
  return [];
}

export const handler: Handler<PullOrchestratorEvent> = async (event) => {
  const jobs = normalizeInput(event);
  if (jobs.length === 0) {
    logger.warn('Pull orchestrator skipped: no jobs in event');
    return { scheduled: 0, skipped: 0, results: [] };
  }

  let scheduled = 0;
  const results: { pullJobId: string; scheduled: boolean; reason?: string }[] = [];

  for (const input of jobs) {
    const result = await orchestrator.schedulePull(input);
    results.push({
      pullJobId: input.pullJobId,
      scheduled: result.scheduled,
      reason: result.reason,
    });
    if (result.scheduled) scheduled++;
  }

  logger.info('Pull orchestrator completed', {
    scheduled,
    total: jobs.length,
    results: results.map((r) => ({ id: r.pullJobId, scheduled: r.scheduled, reason: r.reason })),
  });
  return { scheduled, skipped: jobs.length - scheduled, results };
};
