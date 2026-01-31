/**
 * Phase 5.3 — Perception Scheduler Integration Tests
 *
 * Validates PerceptionPullBudgetService and PullIdempotencyStoreService against real DynamoDB:
 * - PerceptionPullBudgetService: getConfig, putConfig, checkAndConsumePullBudget (atomic)
 * - PullIdempotencyStoreService: tryReserve (conditional put), exists; duplicate returns false
 *
 * Requires deployed stack and env (PERCEPTION_SCHEDULER_TABLE_NAME, PULL_IDEMPOTENCY_STORE_TABLE_NAME).
 * Skip when required env is missing; ./deploy writes .env with table names.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { getAWSClientConfig } from '../../../utils/aws-client-config';
import { PerceptionPullBudgetService } from '../../../services/perception/PerceptionPullBudgetService';
import { PullIdempotencyStoreService } from '../../../services/perception/PullIdempotencyStoreService';
import { Logger } from '../../../services/core/Logger';
import { loadEnv } from '../loadEnv';

loadEnv();

const requiredEnvVars = [
  'PERCEPTION_SCHEDULER_TABLE_NAME',
  'PULL_IDEMPOTENCY_STORE_TABLE_NAME',
];
const hasRequiredEnv = requiredEnvVars.every((name) => process.env[name]);

const region = process.env.AWS_REGION || 'us-west-2';
const perceptionSchedulerTable =
  process.env.PERCEPTION_SCHEDULER_TABLE_NAME || 'cc-native-perception-scheduler';
const pullIdempotencyTable =
  process.env.PULL_IDEMPOTENCY_STORE_TABLE_NAME || 'cc-native-pull-idempotency-store';

const testTenantId = `test-tenant-53-${Date.now()}`;
const testConnectorId = 'test-connector';

(hasRequiredEnv ? describe : describe.skip)(
  'Perception Scheduler Integration (PullBudget + PullIdempotency)',
  () => {
    let budgetService: PerceptionPullBudgetService;
    let idempotencyService: PullIdempotencyStoreService;
    let dynamoClient: DynamoDBDocumentClient;
    const logger = new Logger('PerceptionSchedulerIntegrationTest');

    beforeAll(async () => {
      if (!hasRequiredEnv) {
        const missing = requiredEnvVars.filter((name) => !process.env[name]);
        throw new Error(
          `[Perception scheduler integration] Missing required env: ${missing.join(', ')}. ` +
            'Run ./deploy to write .env with table names.'
        );
      }
      const clientConfig = getAWSClientConfig(region);
      const baseClient = new DynamoDBClient(clientConfig);
      dynamoClient = DynamoDBDocumentClient.from(baseClient, {
        marshallOptions: { removeUndefinedValues: true },
      });
      budgetService = new PerceptionPullBudgetService(
        dynamoClient,
        perceptionSchedulerTable,
        logger
      );
      idempotencyService = new PullIdempotencyStoreService(
        dynamoClient,
        pullIdempotencyTable,
        logger
      );
    });

    describe('PullIdempotencyStoreService', () => {
      it('tryReserve returns true when key is new', async () => {
        const pullJobId = `job-${Date.now()}-1`;
        const result = await idempotencyService.tryReserve(pullJobId);
        expect(result).toBe(true);
      });

      it('tryReserve returns false when key already exists (duplicate)', async () => {
        const pullJobId = `job-${Date.now()}-2`;
        const first = await idempotencyService.tryReserve(pullJobId);
        expect(first).toBe(true);
        const second = await idempotencyService.tryReserve(pullJobId);
        expect(second).toBe(false);
      });

      it('exists returns true after reserve, false for unknown key', async () => {
        const pullJobId = `job-${Date.now()}-3`;
        await idempotencyService.tryReserve(pullJobId);
        const existsAfter = await idempotencyService.exists(pullJobId);
        expect(existsAfter).toBe(true);
        const unknownExists = await idempotencyService.exists(`job-unknown-${Date.now()}`);
        expect(unknownExists).toBe(false);
      });
    });

    describe('PerceptionPullBudgetService', () => {
      beforeAll(async () => {
        await budgetService.putConfig({
          pk: `TENANT#${testTenantId}`,
          sk: 'BUDGET#PULL',
          tenant_id: testTenantId,
          max_pull_units_per_day: 10,
          updated_at: new Date().toISOString(),
        });
      });

      it('getConfig returns config after putConfig', async () => {
        const config = await budgetService.getConfig(testTenantId);
        expect(config).not.toBeNull();
        expect(config?.tenant_id).toBe(testTenantId);
        expect(config?.max_pull_units_per_day).toBe(10);
      });

      it('checkAndConsumePullBudget returns allowed true and consumes units', async () => {
        const result = await budgetService.checkAndConsumePullBudget(
          testTenantId,
          testConnectorId,
          1
        );
        expect(result.allowed).toBe(true);
        expect(result.remaining).toBeDefined();
      });

      it('checkAndConsumePullBudget returns allowed false when cap exceeded', async () => {
        const lowCapTenant = `test-tenant-53-cap-${Date.now()}`;
        await budgetService.putConfig({
          pk: `TENANT#${lowCapTenant}`,
          sk: 'BUDGET#PULL',
          tenant_id: lowCapTenant,
          max_pull_units_per_day: 1,
          updated_at: new Date().toISOString(),
        });
        const first = await budgetService.checkAndConsumePullBudget(
          lowCapTenant,
          testConnectorId,
          1
        );
        expect(first.allowed).toBe(true);
        const second = await budgetService.checkAndConsumePullBudget(
          lowCapTenant,
          testConnectorId,
          1
        );
        expect(second.allowed).toBe(false);
      });
    });
  }
);
