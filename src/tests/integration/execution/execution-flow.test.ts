/**
 * Phase 4.5B — Execution Flow Integration Tests
 *
 * Validates execution-starter handler chain with real DynamoDB: seed ActionIntent + ActionTypeRegistry,
 * invoke starter handler, assert attempt created and return shape.
 *
 * Requires deployed stack and env (EXECUTION_ATTEMPTS_TABLE_NAME, ACTION_INTENT_TABLE_NAME,
 * ACTION_TYPE_REGISTRY_TABLE_NAME, LEDGER_TABLE_NAME).
 * Skip when SKIP_EXECUTION_FLOW_INTEGRATION=1.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { getAWSClientConfig } from '../../../utils/aws-client-config';
import { loadEnv } from '../loadEnv';

loadEnv();

const requiredEnvVars = [
  'EXECUTION_ATTEMPTS_TABLE_NAME',
  'ACTION_INTENT_TABLE_NAME',
  'ACTION_TYPE_REGISTRY_TABLE_NAME',
  'LEDGER_TABLE_NAME',
];
const hasRequiredEnv = requiredEnvVars.every((name) => process.env[name]);
const skipIntegration = process.env.SKIP_EXECUTION_FLOW_INTEGRATION === '1';

const region = process.env.AWS_REGION || 'us-west-2';
const attemptsTable =
  process.env.EXECUTION_ATTEMPTS_TABLE_NAME || 'cc-native-execution-attempts';
const intentTable =
  process.env.ACTION_INTENT_TABLE_NAME || 'cc-native-action-intent';
const registryTable =
  process.env.ACTION_TYPE_REGISTRY_TABLE_NAME || 'cc-native-action-type-registry';

const testTenantId = `test-tenant-ef-${Date.now()}`;
const testAccountId = `test-account-ef-${Date.now()}`;

(skipIntegration ? describe.skip : describe)(
  'Execution Flow Integration (Starter handler)',
  () => {
    let dynamoClient: DynamoDBDocumentClient;
    let invokeStarter: (event: unknown) => Promise<unknown>;

    beforeAll(async () => {
      if (!hasRequiredEnv) {
        const missing = requiredEnvVars.filter((name) => !process.env[name]);
        throw new Error(
          `[Execution flow integration] Missing required env: ${missing.join(', ')}. ` +
            'Set them (e.g. run ./deploy to write .env) or set SKIP_EXECUTION_FLOW_INTEGRATION=1 to skip.'
        );
      }
      const clientConfig = getAWSClientConfig(region);
      const baseClient = new DynamoDBClient(clientConfig);
      dynamoClient = DynamoDBDocumentClient.from(baseClient, {
        marshallOptions: { removeUndefinedValues: true },
      });

      const mod = await import('../../../handlers/phase4/execution-starter-handler');
      invokeStarter = mod.handler as (event: unknown) => Promise<unknown>;
    });

    it('starter: seed intent + registry, invoke, assert attempt created and return shape', async () => {
      const actionIntentId = `ai_ef_${Date.now()}`;
      const now = new Date().toISOString();
      const expiresAtEpoch = Math.floor(Date.now() / 1000) + 86400 * 7;
      const pk = `TENANT#${testTenantId}#ACCOUNT#${testAccountId}`;
      const skIntent = `ACTION_INTENT#${actionIntentId}`;

      await dynamoClient.send(
        new PutCommand({
          TableName: intentTable,
          Item: {
            pk,
            sk: skIntent,
            action_intent_id: actionIntentId,
            action_type: 'CREATE_INTERNAL_TASK',
            target: {},
            parameters: { title: 'Execution flow test', description: 'Phase 4.5B' },
            parameters_schema_version: '1',
            approved_by: 'integration-test',
            approval_timestamp: now,
            execution_policy: { retry_count: 3, timeout_seconds: 300, max_attempts: 1 },
            expires_at: new Date(expiresAtEpoch * 1000).toISOString(),
            expires_at_epoch: expiresAtEpoch,
            original_decision_id: 'test-decision',
            original_proposal_id: 'test-proposal',
            edited_fields: [],
            tenant_id: testTenantId,
            account_id: testAccountId,
            trace_id: 'test-trace',
            registry_version: 1,
          },
        })
      );

      const registryPk = 'ACTION_TYPE#CREATE_INTERNAL_TASK';
      const registrySk = 'REGISTRY_VERSION#1';
      await dynamoClient.send(
        new PutCommand({
          TableName: registryTable,
          Item: {
            pk: registryPk,
            sk: registrySk,
            action_type: 'CREATE_INTERNAL_TASK',
            registry_version: 1,
            tool_name: 'internal.create_task',
            tool_schema_version: 'v1.0',
            required_scopes: [],
            risk_class: 'MINIMAL',
            compensation_strategy: 'AUTOMATIC',
            parameter_mapping: {
              title: { toolParam: 'title', transform: 'PASSTHROUGH', required: true },
              description: { toolParam: 'description', transform: 'PASSTHROUGH', required: false },
            },
            created_at: now,
          },
        })
      );

      const result = await invokeStarter({
        action_intent_id: actionIntentId,
        tenant_id: testTenantId,
        account_id: testAccountId,
      });

      expect(result).toBeDefined();
      const state = result as Record<string, unknown>;
      expect(state.action_intent_id).toBe(actionIntentId);
      expect(state.tenant_id).toBe(testTenantId);
      expect(state.account_id).toBe(testAccountId);
      expect(state.trace_id).toBeDefined();
      expect(typeof state.trace_id).toBe('string');
      expect(state.idempotency_key).toBeDefined();
      expect(state.registry_version).toBe(1);
      expect(state.attempt_count).toBe(1);
      expect(state.started_at).toBeDefined();

      const attemptGet = await dynamoClient.send(
        new GetCommand({
          TableName: attemptsTable,
          Key: {
            pk: `TENANT#${testTenantId}#ACCOUNT#${testAccountId}`,
            sk: `EXECUTION#${actionIntentId}`,
          },
        })
      );
      expect(attemptGet.Item).toBeDefined();
      const attempt = attemptGet.Item as Record<string, unknown>;
      expect(attempt.status).toBe('RUNNING');
      expect(attempt.action_intent_id).toBe(actionIntentId);
    });
  }
);
