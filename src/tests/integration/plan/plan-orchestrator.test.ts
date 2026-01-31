/**
 * Phase 6.3 — Plan Orchestrator Integration Tests (Mandatory)
 *
 * Seeds a test tenant, invokes the plan-orchestrator Lambda handler with real DynamoDB,
 * then tears down seeded data. Validates handler completes without throw.
 *
 * Requires deployed stack and .env: REVENUE_PLANS_TABLE_NAME, PLAN_LEDGER_TABLE_NAME,
 * PLAN_STEP_EXECUTION_TABLE_NAME, TENANTS_TABLE_NAME, ACTION_INTENT_TABLE_NAME (from ./deploy).
 * When env is present, this suite is mandatory to pass (no skip flag).
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb';
import { getAWSClientConfig } from '../../../utils/aws-client-config';
import { loadEnv } from '../loadEnv';

loadEnv();

const requiredEnvVars = [
  'REVENUE_PLANS_TABLE_NAME',
  'PLAN_LEDGER_TABLE_NAME',
  'PLAN_STEP_EXECUTION_TABLE_NAME',
  'TENANTS_TABLE_NAME',
  'ACTION_INTENT_TABLE_NAME',
];
const hasRequiredEnv = requiredEnvVars.every((name) => process.env[name]);

const region = process.env.AWS_REGION || 'us-west-2';
const tenantsTableName =
  process.env.TENANTS_TABLE_NAME || 'cc-native-tenants';

const testTenantId = `plan-orch-int-${Date.now()}`;

const scheduledEvent = {
  version: '0',
  id: 'test-event-id',
  'detail-type': 'Scheduled Event',
  source: 'events.amazonaws.com',
  account: '123456789012',
  time: new Date().toISOString(),
  region,
  resources: ['arn:aws:events:us-west-2:123456789012:rule/plan-orchestrator'],
  detail: {},
};

(hasRequiredEnv ? describe : describe.skip)(
  'Plan Orchestrator Integration (Phase 6.3 — Mandatory)',
  () => {
    let dynamoClient: DynamoDBDocumentClient;

    beforeAll(async () => {
      const baseClient = new DynamoDBClient(getAWSClientConfig(region));
      dynamoClient = DynamoDBDocumentClient.from(baseClient, {
        marshallOptions: { removeUndefinedValues: true },
      });

      await dynamoClient.send(
        new PutCommand({
          TableName: tenantsTableName,
          Item: {
            tenantId: testTenantId,
            created_at: new Date().toISOString(),
            _integration_test: true,
          },
        })
      );
    });

    afterAll(async () => {
      if (!dynamoClient) return;
      try {
        await dynamoClient.send(
          new DeleteCommand({
            TableName: tenantsTableName,
            Key: { tenantId: testTenantId },
          })
        );
      } catch (e) {
        console.warn('[Plan orchestrator integration] Teardown delete tenant failed:', e);
      }
    });

    it('invokes orchestrator handler with scheduled event and completes without throw', async () => {
      const mod = await import(
        '../../../handlers/phase6/plan-orchestrator-handler'
      );
      const handler = mod.handler as (event: unknown) => Promise<void>;
      await expect(handler(scheduledEvent)).resolves.toBeUndefined();
    });
  }
);
