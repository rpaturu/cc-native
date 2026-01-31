/**
 * Phase 6.5 — Conflict Resolution Integration Tests (Mandatory)
 *
 * Seeds two plans for the same (tenant_id, account_id, plan_type): one ACTIVE,
 * one PAUSED. Invokes plan-lifecycle-api-handler POST /plans/:planId/resume for
 * the PAUSED plan. Asserts 409 Conflict with body.error 'Conflict' and CONFLICT_ACTIVE_PLAN in reasons (invariant:
 * one ACTIVE per account+plan_type). Teardown: delete both seeded plans.
 *
 * Requires deployed stack and .env: REVENUE_PLANS_TABLE_NAME (from ./deploy).
 * When env is present, this suite is mandatory to pass (no skip flag).
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb';
import { getAWSClientConfig } from '../../../utils/aws-client-config';
import { loadEnv } from '../loadEnv';

loadEnv();

const requiredEnvVars = ['REVENUE_PLANS_TABLE_NAME'];
const hasRequiredEnv = requiredEnvVars.every((name) => process.env[name]);

const region = process.env.AWS_REGION || 'us-west-2';
const revenuePlansTableName =
  process.env.REVENUE_PLANS_TABLE_NAME || 'cc-native-revenue-plans';

const testTenantId = `plan-int-6-5-tenant-${Date.now()}`;
const testAccountId = `plan-int-6-5-acc-${Date.now()}`;
const planActiveId = `plan-int-6-5-active-${Date.now()}`;
const planPausedId = `plan-int-6-5-paused-${Date.now()}`;

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
  'Conflict Resolution Integration (Phase 6.5 — Mandatory)',
  () => {
    let dynamoClient: DynamoDBDocumentClient;
    const now = new Date().toISOString();

    beforeAll(async () => {
      const baseClient = new DynamoDBClient(getAWSClientConfig(region));
      dynamoClient = DynamoDBDocumentClient.from(baseClient, {
        marshallOptions: { removeUndefinedValues: true },
      });

      const planType = 'RENEWAL_DEFENSE';

      // Plan A: ACTIVE (same account + plan_type)
      await dynamoClient.send(
        new PutCommand({
          TableName: revenuePlansTableName,
          Item: {
            pk: planPk(testTenantId, testAccountId),
            sk: planSk(planActiveId),
            gsi1pk: gsi1Pk(testTenantId, 'ACTIVE'),
            gsi1sk: now,
            gsi2pk: gsi2Pk(testTenantId),
            gsi2sk: gsi2Sk(testAccountId, now),
            plan_id: planActiveId,
            plan_type: planType,
            account_id: testAccountId,
            tenant_id: testTenantId,
            objective: 'Conflict test active',
            plan_status: 'ACTIVE',
            steps: [
              { step_id: 's1', action_type: 'EMAIL', status: 'PENDING', sequence: 1 },
            ],
            expires_at: now,
            created_at: now,
            updated_at: now,
            _integration_test: true,
          },
        })
      );

      // Plan B: PAUSED (same account + plan_type) — resume should be rejected
      const now2 = new Date(Date.now() + 1).toISOString();
      await dynamoClient.send(
        new PutCommand({
          TableName: revenuePlansTableName,
          Item: {
            pk: planPk(testTenantId, testAccountId),
            sk: planSk(planPausedId),
            gsi1pk: gsi1Pk(testTenantId, 'PAUSED'),
            gsi1sk: now2,
            gsi2pk: gsi2Pk(testTenantId),
            gsi2sk: gsi2Sk(testAccountId, now2),
            plan_id: planPausedId,
            plan_type: planType,
            account_id: testAccountId,
            tenant_id: testTenantId,
            objective: 'Conflict test paused',
            plan_status: 'PAUSED',
            steps: [
              { step_id: 's1', action_type: 'EMAIL', status: 'PENDING', sequence: 1 },
            ],
            expires_at: now2,
            created_at: now2,
            updated_at: now2,
            _integration_test: true,
          },
        })
      );
    });

    afterAll(async () => {
      if (!dynamoClient) return;
      for (const planId of [planActiveId, planPausedId]) {
        try {
          await dynamoClient.send(
            new DeleteCommand({
              TableName: revenuePlansTableName,
              Key: { pk: planPk(testTenantId, testAccountId), sk: planSk(planId) },
            })
          );
        } catch (e) {
          console.warn(
            '[Conflict resolution integration] Teardown delete plan failed:',
            planId,
            e
          );
        }
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

    it('POST /plans/:planId/resume returns 409 Conflict with CONFLICT_ACTIVE_PLAN when another ACTIVE plan exists for same account+plan_type', async () => {
      const event: APIGatewayProxyEvent = {
        httpMethod: 'POST',
        path: `/plans/${planPausedId}/resume`,
        resource: '/plans/{planId}/resume',
        pathParameters: { planId: planPausedId },
        queryStringParameters: { account_id: testAccountId },
        multiValueQueryStringParameters: null,
        body: '{}',
        isBase64Encoded: false,
        requestContext: {
          authorizer: {
            claims: { 'custom:tenant_id': testTenantId },
          },
        },
      } as unknown as APIGatewayProxyEvent;

      const res = await invokeHandler(event);
      expect(res.statusCode).toBe(409);
      const body = JSON.parse(res.body || '{}');
      expect(body.error).toBe('Conflict');
      expect(body.reasons).toBeDefined();
      expect(Array.isArray(body.reasons)).toBe(true);
      const conflictReason = body.reasons.find(
        (r: { code: string }) => r.code === 'CONFLICT_ACTIVE_PLAN'
      );
      expect(conflictReason).toBeDefined();
      expect(conflictReason.message).toBeDefined();
      expect(typeof conflictReason.message).toBe('string');
    });
  }
);
