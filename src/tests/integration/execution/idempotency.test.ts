/**
 * Phase 4.5B — Idempotency Integration Tests
 *
 * Validates dual-layer idempotency against real DynamoDB:
 * - ExecutionAttemptService.startAttempt: conditional write (exactly-once start; second call fails or returns existing)
 * - ExecutionOutcomeService.recordOutcome: conditional write (exactly-once outcome; second call returns existing)
 *
 * Requires deployed stack and env (EXECUTION_ATTEMPTS_TABLE_NAME, EXECUTION_OUTCOMES_TABLE_NAME).
 * Skip when SKIP_IDEMPOTENCY_INTEGRATION=1.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { getAWSClientConfig } from '../../../utils/aws-client-config';
import { ExecutionAttemptService } from '../../../services/execution/ExecutionAttemptService';
import { ExecutionOutcomeService } from '../../../services/execution/ExecutionOutcomeService';
import { Logger } from '../../../services/core/Logger';
import { loadEnv } from '../loadEnv';

loadEnv();

const requiredEnvVars = ['EXECUTION_ATTEMPTS_TABLE_NAME', 'EXECUTION_OUTCOMES_TABLE_NAME'];
const hasRequiredEnv = requiredEnvVars.every((name) => process.env[name]);
const skipIntegration = process.env.SKIP_IDEMPOTENCY_INTEGRATION === '1';

const region = process.env.AWS_REGION || 'us-west-2';
const attemptsTable =
  process.env.EXECUTION_ATTEMPTS_TABLE_NAME || 'cc-native-execution-attempts';
const outcomesTable =
  process.env.EXECUTION_OUTCOMES_TABLE_NAME || 'cc-native-execution-outcomes';

const testTenantId = `test-tenant-idem-${Date.now()}`;
const testAccountId = `test-account-idem-${Date.now()}`;

(skipIntegration ? describe.skip : describe)(
  'Idempotency Integration (ExecutionAttempt + ExecutionOutcome)',
  () => {
    let attemptService: ExecutionAttemptService;
    let outcomeService: ExecutionOutcomeService;
    let dynamoClient: DynamoDBDocumentClient;
    const logger = new Logger('IdempotencyIntegrationTest');

    beforeAll(async () => {
      if (!hasRequiredEnv) {
        const missing = requiredEnvVars.filter((name) => !process.env[name]);
        throw new Error(
          `[Idempotency integration] Missing required env: ${missing.join(', ')}. ` +
            'Set them (e.g. run ./deploy to write .env) or set SKIP_IDEMPOTENCY_INTEGRATION=1 to skip.'
        );
      }
      const clientConfig = getAWSClientConfig(region);
      const baseClient = new DynamoDBClient(clientConfig);
      dynamoClient = DynamoDBDocumentClient.from(baseClient, {
        marshallOptions: { removeUndefinedValues: true },
      });
      attemptService = new ExecutionAttemptService(
        dynamoClient,
        attemptsTable,
        logger
      );
      outcomeService = new ExecutionOutcomeService(
        dynamoClient,
        outcomesTable,
        logger
      );
    });

    describe('ExecutionAttemptService.startAttempt', () => {
      it('first startAttempt succeeds and creates lock', async () => {
        const actionIntentId = `ai_idem_first_${Date.now()}`;
        const traceId = `trace_${Date.now()}`;
        const idempotencyKey = `idem_${Date.now()}`;

        const attempt = await attemptService.startAttempt(
          actionIntentId,
          testTenantId,
          testAccountId,
          traceId,
          idempotencyKey,
          undefined,
          false
        );

        expect(attempt).toBeDefined();
        expect(attempt.action_intent_id).toBe(actionIntentId);
        expect(attempt.status).toBe('RUNNING');
        expect(attempt.tenant_id).toBe(testTenantId);
        expect(attempt.account_id).toBe(testAccountId);
      });

      it('second startAttempt with same action_intent_id (allow_rerun=false) throws', async () => {
        const actionIntentId = `ai_idem_dup_${Date.now()}`;
        const traceId = `trace_${Date.now()}`;
        const idempotencyKey = `idem_${Date.now()}`;

        await attemptService.startAttempt(
          actionIntentId,
          testTenantId,
          testAccountId,
          traceId,
          idempotencyKey,
          undefined,
          false
        );

        await expect(
          attemptService.startAttempt(
            actionIntentId,
            testTenantId,
            testAccountId,
            `trace_other_${Date.now()}`,
            `idem_other_${Date.now()}`,
            undefined,
            false
          )
        ).rejects.toThrow(/already in progress|already completed|Reruns are not allowed/);
      });
    });

    describe('ExecutionOutcomeService.recordOutcome', () => {
      it('first recordOutcome succeeds', async () => {
        const actionIntentId = `ai_outcome_first_${Date.now()}`;
        const now = new Date().toISOString();

        const outcome = await outcomeService.recordOutcome({
          action_intent_id: actionIntentId,
          tenant_id: testTenantId,
          account_id: testAccountId,
          status: 'SUCCEEDED',
          external_object_refs: [],
          attempt_count: 1,
          tool_name: 'internal.create_task',
          tool_schema_version: 'v1.0',
          registry_version: 1,
          tool_run_ref: 'run_1',
          started_at: now,
          completed_at: now,
          compensation_status: 'NONE',
          trace_id: 'trace_1',
        });

        expect(outcome).toBeDefined();
        expect(outcome.action_intent_id).toBe(actionIntentId);
        expect(outcome.status).toBe('SUCCEEDED');
      });

      it('second recordOutcome with same keys returns existing (idempotent)', async () => {
        const actionIntentId = `ai_outcome_dup_${Date.now()}`;
        const now = new Date().toISOString();

        const first = await outcomeService.recordOutcome({
          action_intent_id: actionIntentId,
          tenant_id: testTenantId,
          account_id: testAccountId,
          status: 'SUCCEEDED',
          external_object_refs: [],
          attempt_count: 1,
          tool_name: 'internal.create_task',
          tool_schema_version: 'v1.0',
          registry_version: 1,
          tool_run_ref: 'run_1',
          started_at: now,
          completed_at: now,
          compensation_status: 'NONE',
          trace_id: 'trace_1',
        });

        const second = await outcomeService.recordOutcome({
          action_intent_id: actionIntentId,
          tenant_id: testTenantId,
          account_id: testAccountId,
          status: 'SUCCEEDED',
          external_object_refs: [],
          attempt_count: 1,
          tool_name: 'internal.create_task',
          tool_schema_version: 'v1.0',
          registry_version: 1,
          tool_run_ref: 'run_1',
          started_at: now,
          completed_at: now,
          compensation_status: 'NONE',
          trace_id: 'trace_1',
        });

        expect(second).toBeDefined();
        expect(second.action_intent_id).toBe(first.action_intent_id);
        expect(second.pk).toBe(first.pk);
        expect(second.sk).toBe(first.sk);
      });
    });
  }
);
