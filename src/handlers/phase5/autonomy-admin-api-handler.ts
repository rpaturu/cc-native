/**
 * Autonomy Admin API Handler - Phase 5.1 + 5.6
 *
 * CRUD for autonomy config, budget; Phase 5.6: kill-switches, ledger explanation, audit exports.
 * Auth: tenant from JWT (custom:tenant_id) when present; fallback query/header for dev.
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
import { ExecutionOutcomeService } from '../../services/execution/ExecutionOutcomeService';
import { KillSwitchService } from '../../services/execution/KillSwitchService';
import { LedgerService } from '../../services/ledger/LedgerService';
import { LedgerExplanationService } from '../../services/autonomy/LedgerExplanationService';
import { AuditExportService } from '../../services/autonomy/AuditExportService';
import {
  AutonomyModeConfigV1,
  AutonomyBudgetV1,
} from '../../types/autonomy/AutonomyTypes';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  resolveTenantFromAuth,
  getKillSwitches as routeGetKillSwitches,
  putKillSwitches as routePutKillSwitches,
  getLedgerExplanation as routeGetLedgerExplanation,
  postAuditExports as routePostAuditExports,
  getAuditExportStatus as routeGetAuditExportStatus,
} from './autonomy-control-center-routes';

const logger = new Logger('AutonomyAdminAPIHandler');

const region = process.env.AWS_REGION || 'us-west-2';
const clientConfig = getAWSClientConfig(region);
const dynamoClient = DynamoDBDocumentClient.from(
  new DynamoDBClient(clientConfig),
  { marshallOptions: { removeUndefinedValues: true } }
);
const eventBridgeClient = new EventBridgeClient(clientConfig);
const s3Client = new S3Client(clientConfig);
const PRESIGNED_URL_EXPIRY_SECONDS = 3600;

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

function getPhase56Services(): {
  killSwitch: KillSwitchService | null;
  ledgerExplanation: LedgerExplanationService | null;
  auditExport: AuditExportService | null;
} {
  const tenantsTable = process.env.TENANTS_TABLE_NAME;
  const ledgerTable = process.env.LEDGER_TABLE_NAME;
  const outcomesTable = process.env.EXECUTION_OUTCOMES_TABLE_NAME;
  const auditExportTable = process.env.AUDIT_EXPORT_TABLE_NAME;
  return {
    killSwitch: tenantsTable ? new KillSwitchService(dynamoClient, tenantsTable, logger) : null,
    ledgerExplanation:
      ledgerTable && outcomesTable
        ? new LedgerExplanationService({
            executionOutcomeService: new ExecutionOutcomeService(dynamoClient, outcomesTable, logger),
            ledgerService: new LedgerService(logger, ledgerTable, region),
            logger,
          })
        : null,
    auditExport: auditExportTable
      ? new AuditExportService(dynamoClient, auditExportTable, logger)
      : null,
  };
}

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
 * GET /autonomy/budget?tenant_id=&account_id= — includes remaining_today (UTC).
 */
async function getBudget(
  tenantId: string,
  accountId: string
): Promise<APIGatewayProxyResult> {
  const config = await autonomyBudgetService.getConfig(tenantId, accountId);
  if (!config) {
    return json({ config: null, remaining_today: 0 }, 200);
  }
  const todayUtc = new Date().toISOString().slice(0, 10);
  const state = await autonomyBudgetService.getStateForDate(tenantId, accountId, todayUtc);
  const consumed = state?.total ?? 0;
  const remaining_today = Math.max(0, config.max_autonomous_per_day - consumed);
  return json({ config, remaining_today });
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
    const tenantFromAuth = resolveTenantFromAuth(event);
    const tenantId =
      tenantFromAuth ??
      event.queryStringParameters?.tenant_id ??
      event.headers['x-tenant-id'] ??
      '';
    const accountId = event.queryStringParameters?.account_id || '';
    const dateKey = event.queryStringParameters?.date || new Date().toISOString().slice(0, 10);
    const userId =
      (event.requestContext.authorizer as Record<string, string> | undefined)
        ?.userId || 'unknown';

    try {
      // Phase 5.6: kill-switches
      if (path.includes('/kill-switches')) {
        if (!tenantId) return err('tenant_id required (from auth or query)');
        const { killSwitch } = getPhase56Services();
        if (!killSwitch) return err('Kill switches not configured', 503);
        if (method === 'GET') {
          const result = await routeGetKillSwitches(killSwitch, tenantId);
          return addCorsHeaders(result);
        }
        if (method === 'PUT') {
          const body = event.body ? JSON.parse(event.body) : {};
          const result = await routePutKillSwitches(killSwitch, tenantId, body);
          return addCorsHeaders(result);
        }
      }

      // Phase 5.6: ledger explanation (canonical: action_intent_id; execution_id = action_intent_id)
      if (path.includes('/ledger/explanation')) {
        if (method !== 'GET') return err('Method not allowed', 405);
        const executionId = event.queryStringParameters?.execution_id;
        const actionIntentId = event.queryStringParameters?.action_intent_id ?? executionId;
        if (!actionIntentId) return err('execution_id or action_intent_id required');
        if (!tenantId || !accountId) return err('tenant_id and account_id required (from auth or query)');
        const { ledgerExplanation } = getPhase56Services();
        if (!ledgerExplanation) return err('Ledger explanation not configured', 503);
        const result = await routeGetLedgerExplanation(
          ledgerExplanation,
          actionIntentId,
          tenantId,
          accountId
        );
        return addCorsHeaders(result);
      }

      // Phase 5.6: audit exports (async)
      if (path.includes('/audit/exports')) {
        if (!tenantId) return err('tenant_id required (from auth or query)');
        const { auditExport } = getPhase56Services();
        if (!auditExport) return err('Audit export not configured', 503);
        const pathParts = path.split('/').filter(Boolean);
        const exportId = pathParts[pathParts.length - 1];
        const isExportById = pathParts[pathParts.length - 2] === 'exports' && exportId && exportId !== 'exports';
        if (method === 'POST' && !isExportById) {
          const body = event.body ? JSON.parse(event.body) : {};
          const result = await routePostAuditExports(auditExport, tenantId, body);
          if (result.statusCode === 202) {
            const parsed = JSON.parse(result.body) as { export_id: string };
            const eventBusName = process.env.EVENT_BUS_NAME;
            if (eventBusName && parsed.export_id) {
              try {
                await eventBridgeClient.send(
                  new PutEventsCommand({
                    Entries: [
                      {
                        Source: 'cc-native.autonomy',
                        DetailType: 'AuditExportRequested',
                        Detail: JSON.stringify({
                          export_id: parsed.export_id,
                          tenant_id: tenantId,
                          account_id: body.account_id,
                          from: body.from,
                          to: body.to,
                          format: body.format || 'json',
                        }),
                        EventBusName: eventBusName,
                      },
                    ],
                  })
                );
              } catch (e) {
                logger.error('Failed to emit AuditExportRequested', { export_id: parsed.export_id, error: e });
              }
            }
          }
          return addCorsHeaders(result);
        }
        if (method === 'GET' && isExportById) {
          let result = await routeGetAuditExportStatus(auditExport, exportId, tenantId);
          if (result.statusCode === 200) {
            const body = JSON.parse(result.body) as {
              export_id: string;
              status: string;
              presigned_url?: string;
              expires_at?: string;
              s3_bucket?: string;
              s3_key?: string;
              error_message?: string;
            };
            if (
              body.status === 'COMPLETED' &&
              body.s3_bucket &&
              body.s3_key
            ) {
              try {
                const url = await getSignedUrl(
                  s3Client,
                  new GetObjectCommand({ Bucket: body.s3_bucket, Key: body.s3_key }),
                  { expiresIn: PRESIGNED_URL_EXPIRY_SECONDS }
                );
                body.presigned_url = url;
                body.expires_at = new Date(Date.now() + PRESIGNED_URL_EXPIRY_SECONDS * 1000).toISOString();
              } catch (e) {
                logger.warn('Failed to generate presigned URL', { export_id: exportId, error: e });
              }
              delete body.s3_bucket;
              delete body.s3_key;
            }
            result = { ...result, body: JSON.stringify(body) };
          }
          return addCorsHeaders(result);
        }
      }

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
