/**
 * Phase 5.2 — Decision Scheduling Integration Tests
 *
 * Validates DecisionRunStateService and DecisionIdempotencyStoreService against real DynamoDB:
 * - DecisionRunStateService: getState, tryAcquireAdmissionLock (atomic conditional update)
 * - DecisionIdempotencyStoreService: tryReserve (conditional put), exists; duplicate key returns false
 *
 * Requires deployed stack and env (DECISION_RUN_STATE_TABLE_NAME, IDEMPOTENCY_STORE_TABLE_NAME).
 * Skip only when required env is missing (e.g. before first deploy); ./deploy writes .env with table names.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { getAWSClientConfig } from '../../../utils/aws-client-config';
import { DecisionRunStateService } from '../../../services/decision/DecisionRunStateService';
import { DecisionIdempotencyStoreService } from '../../../services/decision/DecisionIdempotencyStoreService';
import { Logger } from '../../../services/core/Logger';
import type { DecisionTriggerRegistryEntryV1 } from '../../../types/decision/DecisionTriggerTypes';
import { loadEnv } from '../loadEnv';

loadEnv();

const requiredEnvVars = ['DECISION_RUN_STATE_TABLE_NAME', 'IDEMPOTENCY_STORE_TABLE_NAME'];
const hasRequiredEnv = requiredEnvVars.every((name) => process.env[name]);

const region = process.env.AWS_REGION || 'us-west-2';
const runStateTable =
  process.env.DECISION_RUN_STATE_TABLE_NAME || 'cc-native-decision-run-state';
const idempotencyTable =
  process.env.IDEMPOTENCY_STORE_TABLE_NAME || 'cc-native-decision-idempotency-store';

const testTenantId = `test-tenant-52-${Date.now()}`;
const testAccountId = `test-account-52-${Date.now()}`;

const registryEntry: DecisionTriggerRegistryEntryV1 = {
  trigger_type: 'SIGNAL_ARRIVED',
  debounce_seconds: 60,
  cooldown_seconds: 300,
  max_per_account_per_hour: 12,
};

(hasRequiredEnv ? describe : describe.skip)(
  'Decision Scheduling Integration (RunState + IdempotencyStore)',
  () => {
    let runStateService: DecisionRunStateService;
    let idempotencyService: DecisionIdempotencyStoreService;
    let dynamoClient: DynamoDBDocumentClient;
    const logger = new Logger('DecisionSchedulingIntegrationTest');
    const SK_GLOBAL = 'RUN_STATE#GLOBAL';
    const runStatePk = (tenantId: string, accountId: string) =>
      `TENANT#${tenantId}#ACCOUNT#${accountId}`;

    beforeAll(async () => {
      if (!hasRequiredEnv) {
        const missing = requiredEnvVars.filter((name) => !process.env[name]);
        throw new Error(
          `[Decision scheduling integration] Missing required env: ${missing.join(', ')}. ` +
            'Run ./deploy to write .env with table names.'
        );
      }
      const clientConfig = getAWSClientConfig(region);
      const baseClient = new DynamoDBClient(clientConfig);
      dynamoClient = DynamoDBDocumentClient.from(baseClient, {
        marshallOptions: { removeUndefinedValues: true },
      });
      runStateService = new DecisionRunStateService(
        dynamoClient,
        runStateTable,
        logger
      );
      idempotencyService = new DecisionIdempotencyStoreService(
        dynamoClient,
        idempotencyTable,
        logger
      );
    });

    describe('DecisionIdempotencyStoreService', () => {
      it('first tryReserve succeeds (reserves key)', async () => {
        const key = `idem-int-${Date.now()}`;
        const result = await idempotencyService.tryReserve(key);
        expect(result).toBe(true);
      });

      it('second tryReserve with same key returns false (duplicate)', async () => {
        const key = `idem-dup-${Date.now()}`;
        const first = await idempotencyService.tryReserve(key);
        expect(first).toBe(true);
        const second = await idempotencyService.tryReserve(key);
        expect(second).toBe(false);
      });

      it('exists returns true after tryReserve', async () => {
        const key = `idem-exists-${Date.now()}`;
        await idempotencyService.tryReserve(key);
        const found = await idempotencyService.exists(key);
        expect(found).toBe(true);
      });

      it('exists returns false for never-reserved key', async () => {
        const key = `idem-never-${Date.now()}`;
        const found = await idempotencyService.exists(key);
        expect(found).toBe(false);
      });
    });

    describe('DecisionRunStateService', () => {
      it('getState returns null when no state exists', async () => {
        const state = await runStateService.getState(testTenantId, testAccountId);
        expect(state).toBeNull();
      });

      it('tryAcquireAdmissionLock succeeds when no prior state (first run)', async () => {
        const result = await runStateService.tryAcquireAdmissionLock(
          testTenantId,
          testAccountId,
          'SIGNAL_ARRIVED',
          registryEntry
        );
        expect(result.acquired).toBe(true);
      });

      it('getState returns item after tryAcquireAdmissionLock', async () => {
        const state = await runStateService.getState(testTenantId, testAccountId);
        expect(state).not.toBeNull();
        expect(state?.last_allowed_at_epoch).toBeDefined();
        expect(state?.run_count_this_hour).toBeGreaterThanOrEqual(1);
      });

      it('tryAcquireAdmissionLock returns acquired true when past cooldown', async () => {
        const tenantId = `${testTenantId}-cooldown`;
        const accountId = `${testAccountId}-cooldown`;
        const nowEpoch = Math.floor(Date.now() / 1000);
        const pastEpoch = nowEpoch - registryEntry.cooldown_seconds - 60;
        await dynamoClient.send(
          new PutCommand({
            TableName: runStateTable,
            Item: {
              pk: runStatePk(tenantId, accountId),
              sk: SK_GLOBAL,
              last_allowed_at_epoch: pastEpoch,
              run_count_this_hour: 1,
              updated_at: new Date().toISOString(),
            },
          })
        );
        const result = await runStateService.tryAcquireAdmissionLock(
          tenantId,
          accountId,
          'SIGNAL_ARRIVED',
          registryEntry
        );
        expect(result.acquired).toBe(true);
      });
    });
  }
);
