/**
 * Phase 4.5B — Connector Adapters Integration Tests
 *
 * Validates internal adapter handler with real DynamoDB: invoke with valid payload,
 * assert MCP response shape and that task/note was persisted.
 *
 * Requires deployed stack and env (INTERNAL_TASKS_TABLE_NAME, INTERNAL_NOTES_TABLE_NAME).
 * Skip when SKIP_CONNECTOR_ADAPTERS_INTEGRATION=1.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { getAWSClientConfig } from '../../../utils/aws-client-config';
import type { Handler } from 'aws-lambda';
import { InternalConnectorAdapter } from '../../../adapters/internal/InternalConnectorAdapter';
import { createHandler } from '../../../handlers/phase4/internal-adapter-handler';
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

const requiredEnvVars = ['INTERNAL_TASKS_TABLE_NAME', 'INTERNAL_NOTES_TABLE_NAME'];
const hasRequiredEnv = requiredEnvVars.every((name) => process.env[name]);
const skipIntegration = process.env.SKIP_CONNECTOR_ADAPTERS_INTEGRATION === '1';

const region = process.env.AWS_REGION || 'us-west-2';
const tasksTable =
  process.env.INTERNAL_TASKS_TABLE_NAME || 'cc-native-internal-tasks';
const notesTable =
  process.env.INTERNAL_NOTES_TABLE_NAME || 'cc-native-internal-notes';

const testTenantId = `test-tenant-ca-${Date.now()}`;
const testAccountId = `test-account-ca-${Date.now()}`;

(skipIntegration ? describe.skip : describe)(
  'Connector Adapters Integration (Internal adapter)',
  () => {
    let handler: Handler;
    let dynamoClient: DynamoDBDocumentClient;
    const logger = new Logger('ConnectorAdaptersIntegrationTest');

    beforeAll(async () => {
      if (!hasRequiredEnv) {
        const missing = requiredEnvVars.filter((name) => !process.env[name]);
        throw new Error(
          `[Connector adapters integration] Missing required env: ${missing.join(', ')}. ` +
            'Set them (e.g. run ./deploy to write .env) or set SKIP_CONNECTOR_ADAPTERS_INTEGRATION=1 to skip.'
        );
      }
      const clientConfig = getAWSClientConfig(region);
      const baseClient = new DynamoDBClient(clientConfig);
      dynamoClient = DynamoDBDocumentClient.from(baseClient, {
        marshallOptions: { removeUndefinedValues: true },
      });
      const adapter = new InternalConnectorAdapter(
        dynamoClient,
        notesTable,
        tasksTable,
        logger
      );
      handler = createHandler(adapter, logger);
    });

    it('internal.create_task: invoke handler, assert response and task in DynamoDB', async () => {
      const title = `Task CA ${Date.now()}`;
      const description = 'Connector adapters integration test';
      const event = { title, description, tenant_id: testTenantId, account_id: testAccountId };
      const context = {
        clientContext: {
          custom: {
            bedrockAgentCoreToolName: 'internal-adapter___internal.create_task',
            bedrockAgentCoreGatewayId: 'gateway-test',
            bedrockAgentCoreTargetId: 'target-test',
            bedrockAgentCoreMcpMessageId: `mcp-${Date.now()}`,
            bedrockAgentCoreIdentity: {
              accessToken: 'test-token',
              tenantId: testTenantId,
              userId: 'test-user',
            },
          },
        },
        getRemainingTimeInMillis: () => 30000,
      };

      const response = await handler(event, context);

      expect(response).toBeDefined();
      expect(response.jsonrpc).toBe('2.0');
      expect(response.result?.content).toBeDefined();
      const textContent = response.result?.content?.find((c: any) => c.type === 'text')?.text;
      expect(textContent).toBeDefined();
      const parsed = JSON.parse(textContent as string);
      expect(parsed.success).toBe(true);
      expect(Array.isArray(parsed.external_object_refs)).toBe(true);
      expect(parsed.external_object_refs.length).toBeGreaterThanOrEqual(1);

      const pk = `TENANT#${testTenantId}#ACCOUNT#${testAccountId}`;
      const queryResult = await dynamoClient.send(
        new QueryCommand({
          TableName: tasksTable,
          KeyConditionExpression: 'pk = :pk AND begins_with(sk, :skPrefix)',
          ExpressionAttributeValues: { ':pk': pk, ':skPrefix': 'TASK#' },
        })
      );
      expect(queryResult.Items && queryResult.Items.length).toBeGreaterThanOrEqual(1);
      const task = queryResult.Items!.find((i: any) => i.title === title);
      expect(task).toBeDefined();
      expect(task?.title).toBe(title);
      expect(task?.tenant_id).toBe(testTenantId);
      expect(task?.account_id).toBe(testAccountId);
    });

    it('internal.create_note: invoke handler, assert response and note in DynamoDB', async () => {
      const content = `Note CA ${Date.now()}`;
      const event = { content, tenant_id: testTenantId, account_id: testAccountId };
      const context = {
        clientContext: {
          custom: {
            bedrockAgentCoreToolName: 'internal-adapter___internal.create_note',
            bedrockAgentCoreGatewayId: 'gateway-test',
            bedrockAgentCoreTargetId: 'target-test',
            bedrockAgentCoreMcpMessageId: `mcp-note-${Date.now()}`,
            bedrockAgentCoreIdentity: {
              accessToken: 'test-token',
              tenantId: testTenantId,
              userId: 'test-user',
            },
          },
        },
        getRemainingTimeInMillis: () => 30000,
      };

      const response = await handler(event, context);

      expect(response).toBeDefined();
      expect(response.result?.content).toBeDefined();
      const textContent = response.result?.content?.find((c: any) => c.type === 'text')?.text;
      const parsed = JSON.parse(textContent as string);
      expect(parsed.success).toBe(true);

      const pk = `TENANT#${testTenantId}#ACCOUNT#${testAccountId}`;
      const queryResult = await dynamoClient.send(
        new QueryCommand({
          TableName: notesTable,
          KeyConditionExpression: 'pk = :pk AND begins_with(sk, :skPrefix)',
          ExpressionAttributeValues: { ':pk': pk, ':skPrefix': 'NOTE#' },
        })
      );
      expect(queryResult.Items && queryResult.Items.length).toBeGreaterThanOrEqual(1);
      const note = queryResult.Items!.find((i: any) => i.content === content);
      expect(note).toBeDefined();
      expect(note?.content).toBe(content);
      expect(note?.tenant_id).toBe(testTenantId);
    });
  }
);
