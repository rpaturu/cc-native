/**
 * Phase 6.4 — Plans API Integration Tests (Mandatory)
 *
 * Seeds a test plan (and optional ledger entry) in DynamoDB, invokes the plan-lifecycle
 * Lambda handler directly with GET events (list, get plan, get ledger), then tears down
 * seeded data. Follows 6.3 approach: seed → invoke handler → teardown.
 *
 * Requires deployed stack and .env: REVENUE_PLANS_TABLE_NAME, PLAN_LEDGER_TABLE_NAME
 * (from ./deploy). When env is present, this suite is mandatory to pass (no skip flag).
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  DeleteCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { getAWSClientConfig } from '../../../utils/aws-client-config';
import { loadEnv } from '../loadEnv';

loadEnv();

const requiredEnvVars = ['REVENUE_PLANS_TABLE_NAME', 'PLAN_LEDGER_TABLE_NAME'];
const hasRequiredEnv = requiredEnvVars.every((name) => process.env[name]);

const region = process.env.AWS_REGION || 'us-west-2';
const revenuePlansTableName =
  process.env.REVENUE_PLANS_TABLE_NAME || 'cc-native-revenue-plans';
const planLedgerTableName =
  process.env.PLAN_LEDGER_TABLE_NAME || 'cc-native-plan-ledger';

const testTenantId = `plan-int-6-4-tenant-${Date.now()}`;
const testAccountId = `plan-int-6-4-acc-${Date.now()}`;
const testPlanId = `plan-int-6-4-${Date.now()}`;

function planPk(tenantId: string, accountId: string): string {
  return `TENANT#${tenantId}#ACCOUNT#${accountId}`;
}
function planSk(planId: string): string {
  return `PLAN#${planId}`;
}
function gsi1Pk(tenantId: string, planStatus: string): string {
  return `TENANT#${tenantId}#STATUS#${planStatus}`;
}
function gsi2Pk(tenantId: string): string {
  return `TENANT#${tenantId}`;
}
function gsi2Sk(accountId: string, updatedAt: string): string {
  return `ACCOUNT#${accountId}#${updatedAt}`;
}

(hasRequiredEnv ? describe : describe.skip)(
  'Plans API Integration (Phase 6.4 — Mandatory)',
  () => {
    let dynamoClient: DynamoDBDocumentClient;
    const now = new Date().toISOString();

    beforeAll(async () => {
      const baseClient = new DynamoDBClient(getAWSClientConfig(region));
      dynamoClient = DynamoDBDocumentClient.from(baseClient, {
        marshallOptions: { removeUndefinedValues: true },
      });

      const pk = planPk(testTenantId, testAccountId);
      const sk = planSk(testPlanId);
      const gsi1pk = gsi1Pk(testTenantId, 'ACTIVE');
      const gsi1sk = now;
      const gsi2pk = gsi2Pk(testTenantId);
      const gsi2sk = gsi2Sk(testAccountId, now);

      await dynamoClient.send(
        new PutCommand({
          TableName: revenuePlansTableName,
          Item: {
            pk,
            sk,
            gsi1pk,
            gsi1sk,
            gsi2pk,
            gsi2sk,
            plan_id: testPlanId,
            plan_type: 'RENEWAL_DEFENSE',
            account_id: testAccountId,
            tenant_id: testTenantId,
            objective: 'Integration test plan',
            plan_status: 'ACTIVE',
            steps: [{ step_id: 's1', action_type: 'EMAIL', status: 'PENDING', sequence: 1 }],
            expires_at: now,
            created_at: now,
            updated_at: now,
            _integration_test: true,
          },
        })
      );

      await dynamoClient.send(
        new PutCommand({
          TableName: planLedgerTableName,
          Item: {
            pk: `PLAN#${testPlanId}`,
            sk: `EVENT#${now}#int-6-4-ledger-1`,
            gsi1pk: `TENANT#${testTenantId}`,
            gsi1sk: `PLAN#${testPlanId}#${now}`,
            plan_id: testPlanId,
            tenant_id: testTenantId,
            account_id: testAccountId,
            entry_id: 'int-6-4-ledger-1',
            event_type: 'PLAN_CREATED',
            timestamp: now,
            data: { _integration_test: true },
            _integration_test: true,
          },
        })
      );
    });

    afterAll(async () => {
      if (!dynamoClient) return;

      const pk = planPk(testTenantId, testAccountId);
      const sk = planSk(testPlanId);

      try {
        await dynamoClient.send(
          new DeleteCommand({
            TableName: revenuePlansTableName,
            Key: { pk, sk },
          })
        );
      } catch (e) {
        console.warn('[Plans API integration] Teardown delete plan failed:', e);
      }

      const ledgerPk = `PLAN#${testPlanId}`;
      try {
        const q = await dynamoClient.send(
          new QueryCommand({
            TableName: planLedgerTableName,
            KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
            ExpressionAttributeValues: { ':pk': ledgerPk, ':prefix': 'EVENT#' },
          })
        );
        for (const item of q.Items || []) {
          if (item._integration_test) {
            await dynamoClient.send(
              new DeleteCommand({
                TableName: planLedgerTableName,
                Key: { pk: item.pk, sk: item.sk },
              })
            );
          }
        }
      } catch (e) {
        console.warn('[Plans API integration] Teardown delete ledger failed:', e);
      }
    });

    async function invokeHandler(
      event: APIGatewayProxyEvent
    ): Promise<APIGatewayProxyResult> {
      const mod = await import(
        '../../../handlers/phase6/plan-lifecycle-api-handler'
      );
      const handler = mod.handler as (
        event: APIGatewayProxyEvent
      ) => Promise<APIGatewayProxyResult>;
      return handler(event);
    }

    it('GET /plans returns 200 and plans array containing seeded plan', async () => {
      const event: APIGatewayProxyEvent = {
        httpMethod: 'GET',
        path: '/plans',
        resource: '/plans',
        pathParameters: null,
        queryStringParameters: { account_id: testAccountId },
        multiValueQueryStringParameters: null,
        body: null,
        isBase64Encoded: false,
        requestContext: {
          authorizer: {
            claims: { 'custom:tenant_id': testTenantId },
          },
        },
      } as unknown as APIGatewayProxyEvent;

      const res = await invokeHandler(event);
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body || '{}');
      expect(body.plans).toBeDefined();
      expect(Array.isArray(body.plans)).toBe(true);
      const found = body.plans.find((p: { plan_id: string }) => p.plan_id === testPlanId);
      expect(found).toBeDefined();
      expect(found.plan_status).toBe('ACTIVE');
      expect(found.account_id).toBe(testAccountId);
      expect(found.tenant_id).toBe(testTenantId);
      expect(found.steps).toBeUndefined();
    });

    it('GET /plans/:planId returns 200 and full plan with steps', async () => {
      const event: APIGatewayProxyEvent = {
        httpMethod: 'GET',
        path: `/plans/${testPlanId}`,
        resource: '/plans/{planId}',
        pathParameters: { planId: testPlanId },
        queryStringParameters: { account_id: testAccountId },
        multiValueQueryStringParameters: null,
        body: null,
        isBase64Encoded: false,
        requestContext: {
          authorizer: {
            claims: { 'custom:tenant_id': testTenantId },
          },
        },
      } as unknown as APIGatewayProxyEvent;

      const res = await invokeHandler(event);
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body || '{}');
      expect(body.plan).toBeDefined();
      expect(body.plan.plan_id).toBe(testPlanId);
      expect(body.plan.steps).toBeDefined();
      expect(body.plan.steps).toHaveLength(1);
      expect(body.plan.account_id).toBe(testAccountId);
    });

    it('GET /plans/:planId/ledger returns 200 and entries array', async () => {
      const event: APIGatewayProxyEvent = {
        httpMethod: 'GET',
        path: `/plans/${testPlanId}/ledger`,
        resource: '/plans/{planId}/ledger',
        pathParameters: { planId: testPlanId },
        queryStringParameters: { account_id: testAccountId },
        multiValueQueryStringParameters: null,
        body: null,
        isBase64Encoded: false,
        requestContext: {
          authorizer: {
            claims: { 'custom:tenant_id': testTenantId },
          },
        },
      } as unknown as APIGatewayProxyEvent;

      const res = await invokeHandler(event);
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body || '{}');
      expect(body.entries).toBeDefined();
      expect(Array.isArray(body.entries)).toBe(true);
      expect(body.entries.length).toBeGreaterThanOrEqual(1);
      const created = body.entries.find(
        (e: { event_type: string }) => e.event_type === 'PLAN_CREATED'
      );
      expect(created).toBeDefined();
    });

    it('GET /plans/:planId for non-existent plan returns 404', async () => {
      const event: APIGatewayProxyEvent = {
        httpMethod: 'GET',
        path: '/plans/non-existent-plan-id',
        resource: '/plans/{planId}',
        pathParameters: { planId: 'non-existent-plan-id' },
        queryStringParameters: { account_id: testAccountId },
        multiValueQueryStringParameters: null,
        body: null,
        isBase64Encoded: false,
        requestContext: {
          authorizer: {
            claims: { 'custom:tenant_id': testTenantId },
          },
        },
      } as unknown as APIGatewayProxyEvent;

      const res = await invokeHandler(event);
      expect(res.statusCode).toBe(404);
      const body = JSON.parse(res.body || '{}');
      expect(body.error).toBe('Plan not found');
    });
  }
);
