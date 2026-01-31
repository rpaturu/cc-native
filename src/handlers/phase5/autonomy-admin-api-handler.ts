/**
 * Autonomy Admin API Handler - Phase 5.1
 *
 * CRUD for autonomy mode config and autonomy budget config.
 * Auth: Cognito (admin) or API key. Routes: /autonomy/config, /autonomy/budget.
 */

import {
  Handler,
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
} from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { getAWSClientConfig } from '../../utils/aws-client-config';
import { Logger } from '../../services/core/Logger';
import { AutonomyModeService } from '../../services/autonomy/AutonomyModeService';
import { AutonomyBudgetService } from '../../services/autonomy/AutonomyBudgetService';
import {
  AutonomyModeConfigV1,
  AutonomyBudgetV1,
} from '../../types/autonomy/AutonomyTypes';

const logger = new Logger('AutonomyAdminAPIHandler');

const region = process.env.AWS_REGION || 'us-west-2';
const clientConfig = getAWSClientConfig(region);
const dynamoClient = DynamoDBDocumentClient.from(
  new DynamoDBClient(clientConfig),
  { marshallOptions: { removeUndefinedValues: true } }
);

const autonomyConfigTable =
  process.env.AUTONOMY_CONFIG_TABLE_NAME || 'cc-native-autonomy-config';
const autonomyBudgetStateTable =
  process.env.AUTONOMY_BUDGET_STATE_TABLE_NAME ||
  'cc-native-autonomy-budget-state';

const autonomyModeService = new AutonomyModeService(
  dynamoClient,
  autonomyConfigTable,
  logger
);
const autonomyBudgetService = new AutonomyBudgetService(
  dynamoClient,
  autonomyBudgetStateTable,
  logger
);

function addCorsHeaders(
  response: APIGatewayProxyResult
): APIGatewayProxyResult {
  return {
    ...response,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers':
        'Content-Type,Authorization,X-Api-Key,X-Tenant-Id',
      'Access-Control-Allow-Methods': 'GET,PUT,OPTIONS',
      ...response.headers,
    },
  };
}

function json(body: unknown, statusCode = 200): APIGatewayProxyResult {
  return addCorsHeaders({
    statusCode,
    body: JSON.stringify(body),
  });
}

function err(message: string, statusCode = 400): APIGatewayProxyResult {
  return addCorsHeaders({
    statusCode,
    body: JSON.stringify({ error: message }),
  });
}

/**
 * GET /autonomy/config?tenant_id=&account_id= (account_id optional)
 */
async function listConfig(
  tenantId: string,
  accountId?: string
): Promise<APIGatewayProxyResult> {
  const configs = await autonomyModeService.listConfigs(tenantId, accountId);
  return json({ configs });
}

/**
 * PUT /autonomy/config — body: AutonomyModeConfigV1 (pk, sk, tenant_id, mode, updated_at, ...)
 */
async function putConfig(
  body: unknown,
  updatedBy?: string
): Promise<APIGatewayProxyResult> {
  const item = body as Record<string, unknown>;
  if (!item.tenant_id || !item.mode) {
    return err('Missing tenant_id or mode');
  }
  const pkVal =
    (item.pk as string) ||
    (item.account_id
      ? `TENANT#${item.tenant_id}#ACCOUNT#${item.account_id}`
      : `TENANT#${item.tenant_id}`);
  const skVal =
    (item.sk as string) ||
    (item.action_type ? `AUTONOMY#${item.action_type}` : 'AUTONOMY#DEFAULT');
  const config: AutonomyModeConfigV1 = {
    pk: pkVal,
    sk: skVal,
    tenant_id: item.tenant_id as string,
    account_id: item.account_id as string | undefined,
    action_type: item.action_type as string | undefined,
    mode: item.mode as AutonomyModeConfigV1['mode'],
    updated_at: (item.updated_at as string) || new Date().toISOString(),
    updated_by: (updatedBy as string) || (item.updated_by as string | undefined),
    policy_version: (item.policy_version as string) || 'AutonomyModeConfigV1',
  };
  await autonomyModeService.putConfig(config);
  return json({ config });
}

/**
 * GET /autonomy/budget?tenant_id=&account_id=
 */
async function getBudget(
  tenantId: string,
  accountId: string
): Promise<APIGatewayProxyResult> {
  const config = await autonomyBudgetService.getConfig(tenantId, accountId);
  if (!config) {
    return json({ config: null }, 200);
  }
  return json({ config });
}

/**
 * PUT /autonomy/budget — body: AutonomyBudgetV1
 */
async function putBudget(body: unknown): Promise<APIGatewayProxyResult> {
  const item = body as Record<string, unknown>;
  if (!item.tenant_id || !item.account_id || item.max_autonomous_per_day == null) {
    return err('Missing tenant_id, account_id, or max_autonomous_per_day');
  }
  const config: AutonomyBudgetV1 = {
    pk: (item.pk as string) || `TENANT#${item.tenant_id}#ACCOUNT#${item.account_id}`,
    sk: (item.sk as string) || 'BUDGET#CONFIG',
    tenant_id: item.tenant_id as string,
    account_id: item.account_id as string,
    max_autonomous_per_day: Number(item.max_autonomous_per_day),
    max_per_action_type: item.max_per_action_type as Record<string, number> | undefined,
    decay_if_unused: item.decay_if_unused as boolean | undefined,
    updated_at: (item.updated_at as string) || new Date().toISOString(),
  };
  await autonomyBudgetService.putConfig(config);
  return json({ config });
}

/**
 * GET /autonomy/budget/state?tenant_id=&account_id=&date= (date YYYY-MM-DD)
 */
async function getBudgetState(
  tenantId: string,
  accountId: string,
  dateKey: string
): Promise<APIGatewayProxyResult> {
  const state = await autonomyBudgetService.getStateForDate(
    tenantId,
    accountId,
    dateKey
  );
  return json({ state: state || null });
}

/**
 * Main handler: route by path and method.
 */
export const handler: Handler<APIGatewayProxyEvent, APIGatewayProxyResult> =
  async (event) => {
    if (event.httpMethod === 'OPTIONS') {
      return addCorsHeaders({ statusCode: 204, body: '' });
    }

    const path = event.path ?? '';
    const method = event.httpMethod ?? 'GET';
    const tenantId =
      event.queryStringParameters?.tenant_id ||
      event.headers['x-tenant-id'] ||
      '';
    const accountId = event.queryStringParameters?.account_id || '';
    const dateKey = event.queryStringParameters?.date || new Date().toISOString().slice(0, 10);
    const userId =
      (event.requestContext.authorizer as Record<string, string> | undefined)
        ?.userId || 'unknown';

    try {
      // More specific path first: /budget/state before /budget
      if (path.includes('/budget/state')) {
        if (method === 'GET') {
          if (!tenantId || !accountId)
            return err('tenant_id and account_id required');
          return await getBudgetState(tenantId, accountId, dateKey);
        }
      }

      if (path.includes('/budget')) {
        if (method === 'GET') {
          if (!tenantId || !accountId)
            return err('tenant_id and account_id required');
          return await getBudget(tenantId, accountId);
        }
        if (method === 'PUT') {
          const body = event.body ? JSON.parse(event.body) : {};
          return await putBudget(body);
        }
      }

      if (path.includes('/config')) {
        if (method === 'GET') {
          if (!tenantId) return err('tenant_id required');
          return await listConfig(tenantId, accountId || undefined);
        }
        if (method === 'PUT') {
          const body = event.body ? JSON.parse(event.body) : {};
          return await putConfig(body, userId);
        }
      }

      return err('Not found', 404);
    } catch (e) {
      logger.error('Autonomy admin API error', { path, method, error: e });
      return addCorsHeaders({
        statusCode: 500,
        body: JSON.stringify({ error: 'Internal server error' }),
      });
    }
  };
