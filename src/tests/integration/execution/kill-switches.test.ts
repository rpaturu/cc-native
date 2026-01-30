/**
 * Phase 4.5B — Kill Switches Integration Tests
 *
 * Validates kill switch behavior against real DynamoDB (tenants table):
 * - GLOBAL_EXECUTION_STOP env → isExecutionEnabled returns false (no DynamoDB call)
 * - Tenant execution_enabled: false → isExecutionEnabled returns false
 * - Tenant disabled_action_types includes action type → isExecutionEnabled returns false
 * - Tenant execution_enabled: true, no disabled types → isExecutionEnabled returns true
 *
 * Requires deployed stack and env TENANTS_TABLE_NAME.
 * Skip when SKIP_KILL_SWITCHES_INTEGRATION=1.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { getAWSClientConfig } from '../../../utils/aws-client-config';
import { KillSwitchService } from '../../../services/execution/KillSwitchService';
import { Logger } from '../../../services/core/Logger';

const loadEnv = (): void => {
  try {
    require('dotenv').config({ path: '.env.local' });
    require('dotenv').config({ path: '.env' });
  } catch {
    // dotenv not available
  }
};

loadEnv();

const requiredEnvVars = ['TENANTS_TABLE_NAME'];
const hasRequiredEnv = requiredEnvVars.every((name) => process.env[name]);
const skipIntegration = process.env.SKIP_KILL_SWITCHES_INTEGRATION === '1';

const region = process.env.AWS_REGION || 'us-west-2';
const tenantsTable =
  process.env.TENANTS_TABLE_NAME || 'cc-native-tenants';

const testTenantPrefix = `test-tenant-ks-${Date.now()}`;
let originalGLOBAL_EXECUTION_STOP: string | undefined;

(skipIntegration ? describe.skip : describe)(
  'Kill Switches Integration (KillSwitchService)',
  () => {
    let killSwitchService: KillSwitchService;
    let dynamoClient: DynamoDBDocumentClient;
    const logger = new Logger('KillSwitchesIntegrationTest');

    beforeAll(async () => {
      if (!hasRequiredEnv) {
        const missing = requiredEnvVars.filter((name) => !process.env[name]);
        throw new Error(
          `[Kill switches integration] Missing required env: ${missing.join(', ')}. ` +
            'Set them (e.g. run ./deploy to write .env) or set SKIP_KILL_SWITCHES_INTEGRATION=1 to skip.'
        );
      }
      originalGLOBAL_EXECUTION_STOP = process.env.GLOBAL_EXECUTION_STOP;
      const clientConfig = getAWSClientConfig(region);
      const baseClient = new DynamoDBClient(clientConfig);
      dynamoClient = DynamoDBDocumentClient.from(baseClient, {
        marshallOptions: { removeUndefinedValues: true },
      });
      killSwitchService = new KillSwitchService(
        dynamoClient,
        tenantsTable,
        logger
      );
    });

    afterAll(() => {
      if (originalGLOBAL_EXECUTION_STOP !== undefined) {
        process.env.GLOBAL_EXECUTION_STOP = originalGLOBAL_EXECUTION_STOP;
      } else {
        delete process.env.GLOBAL_EXECUTION_STOP;
      }
    });

    describe('GLOBAL_EXECUTION_STOP', () => {
      it('when GLOBAL_EXECUTION_STOP=true, isExecutionEnabled returns false', async () => {
        process.env.GLOBAL_EXECUTION_STOP = 'true';

        const enabled = await killSwitchService.isExecutionEnabled(
          'any-tenant',
          'CREATE_TASK'
        );

        expect(enabled).toBe(false);
      });
    });

    describe('Tenant config (DynamoDB)', () => {
      it('when tenant execution_enabled is false, isExecutionEnabled returns false', async () => {
        delete process.env.GLOBAL_EXECUTION_STOP;
        const tenantId = `${testTenantPrefix}-disabled`;

        await dynamoClient.send(
          new PutCommand({
            TableName: tenantsTable,
            Item: {
              tenantId,
              execution_enabled: false,
              disabled_action_types: [],
            },
          })
        );

        const enabled = await killSwitchService.isExecutionEnabled(tenantId);

        expect(enabled).toBe(false);

        await dynamoClient.send(
          new DeleteCommand({
            TableName: tenantsTable,
            Key: { tenantId },
          })
        );
      });

      it('when action type is in disabled_action_types, isExecutionEnabled returns false', async () => {
        delete process.env.GLOBAL_EXECUTION_STOP;
        const tenantId = `${testTenantPrefix}-action-disabled`;

        await dynamoClient.send(
          new PutCommand({
            TableName: tenantsTable,
            Item: {
              tenantId,
              execution_enabled: true,
              disabled_action_types: ['CREATE_CRM_TASK', 'SEND_EMAIL'],
            },
          })
        );

        const enabled = await killSwitchService.isExecutionEnabled(
          tenantId,
          'CREATE_CRM_TASK'
        );

        expect(enabled).toBe(false);

        const enabledOther = await killSwitchService.isExecutionEnabled(
          tenantId,
          'INTERNAL_CREATE_TASK'
        );

        expect(enabledOther).toBe(true);

        await dynamoClient.send(
          new DeleteCommand({
            TableName: tenantsTable,
            Key: { tenantId },
          })
        );
      });

      it('when tenant execution_enabled is true and no disabled types, isExecutionEnabled returns true', async () => {
        delete process.env.GLOBAL_EXECUTION_STOP;
        const tenantId = `${testTenantPrefix}-enabled`;

        await dynamoClient.send(
          new PutCommand({
            TableName: tenantsTable,
            Item: {
              tenantId,
              execution_enabled: true,
              disabled_action_types: [],
            },
          })
        );

        const enabled = await killSwitchService.isExecutionEnabled(
          tenantId,
          'CREATE_TASK'
        );

        expect(enabled).toBe(true);

        await dynamoClient.send(
          new DeleteCommand({
            TableName: tenantsTable,
            Key: { tenantId },
          })
        );
      });

      it('when tenant does not exist, defaults to execution enabled', async () => {
        delete process.env.GLOBAL_EXECUTION_STOP;
        const tenantId = `${testTenantPrefix}-nonexistent`;

        const enabled = await killSwitchService.isExecutionEnabled(tenantId);

        expect(enabled).toBe(true);
      });
    });
  }
);
