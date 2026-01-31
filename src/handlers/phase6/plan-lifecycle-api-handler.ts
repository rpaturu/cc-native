/**
 * Phase 6.1 — Plan lifecycle API: approve, pause, resume, abort.
 * POST /plans/:planId/approve | /pause | /resume | /abort
 * Auth: plan-approver (JWT authorizer; tenant_id + account_id from claims/query).
 * See PHASE_6_1_CODE_LEVEL_PLAN.md §6.
 */

import {
  Handler,
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
} from 'aws-lambda';
import { Logger } from '../../services/core/Logger';
import { PlanRepositoryService } from '../../services/plan/PlanRepositoryService';
import { PlanLedgerService } from '../../services/plan/PlanLedgerService';
import { PlanPolicyGateService } from '../../services/plan/PlanPolicyGateService';
import { PlanLifecycleService } from '../../services/plan/PlanLifecycleService';

const logger = new Logger('PlanLifecycleAPI');

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`[PlanLifecycleAPI] Missing env: ${name}`);
  return v;
}

const revenuePlansTableName = process.env.REVENUE_PLANS_TABLE_NAME ?? '';
const planLedgerTableName = process.env.PLAN_LEDGER_TABLE_NAME ?? '';
const region = process.env.AWS_REGION ?? 'us-east-1';

function buildServices(): {
  repo: PlanRepositoryService;
  ledger: PlanLedgerService;
  gate: PlanPolicyGateService;
  lifecycle: PlanLifecycleService;
} {
  const repo = new PlanRepositoryService(logger, {
    tableName: requireEnv('REVENUE_PLANS_TABLE_NAME'),
    region,
  });
  const ledger = new PlanLedgerService(logger, {
    tableName: requireEnv('PLAN_LEDGER_TABLE_NAME'),
    region,
  });
  const gate = new PlanPolicyGateService({});
  const lifecycle = new PlanLifecycleService({
    planRepository: repo,
    planLedger: ledger,
    logger,
  });
  return { repo, ledger, gate, lifecycle };
}

let cached: ReturnType<typeof buildServices> | null = null;
function getServices(): ReturnType<typeof buildServices> | null {
  if (!revenuePlansTableName || !planLedgerTableName) return null;
  try {
    if (!cached) cached = buildServices();
    return cached;
  } catch {
    return null;
  }
}

function cors(res: APIGatewayProxyResult): APIGatewayProxyResult {
  return {
    ...res,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Tenant-Id',
      'Access-Control-Allow-Methods': 'POST,OPTIONS',
      ...res.headers,
    },
  };
}

function auth(event: APIGatewayProxyEvent): { tenantId: string; accountId: string } | null {
  const claims = event.requestContext?.authorizer?.claims as Record<string, string> | undefined;
  const tenantId = claims?.['custom:tenant_id'] ?? claims?.['tenant_id'];
  const accountId = event.queryStringParameters?.account_id ?? (JSON.parse(event.body || '{}')?.account_id);
  if (tenantId && accountId) return { tenantId, accountId };
  return null;
}

function parseBody<T = Record<string, unknown>>(event: APIGatewayProxyEvent): T {
  try {
    return (event.body ? JSON.parse(event.body) : {}) as T;
  } catch {
    return {} as T;
  }
}

async function handleApprove(
  _event: APIGatewayProxyEvent,
  services: ReturnType<typeof buildServices>,
  tenantId: string,
  accountId: string,
  planId: string
): Promise<APIGatewayProxyResult> {
  const { repo, gate, lifecycle } = services;
  const plan = await repo.getPlan(tenantId, accountId, planId);
  if (!plan) return cors({ statusCode: 404, body: JSON.stringify({ error: 'Plan not found' }) });
  if (plan.plan_status !== 'DRAFT') {
    return cors({
      statusCode: 400,
      body: JSON.stringify({ error: 'Plan must be in DRAFT to approve', status: plan.plan_status }),
    });
  }
  const { valid, reasons } = await gate.validateForApproval(plan, tenantId);
  if (!valid) {
    return cors({ statusCode: 400, body: JSON.stringify({ error: 'Validation failed', reasons }) });
  }
  await lifecycle.transition(plan, 'APPROVED');
  return cors({ statusCode: 200, body: JSON.stringify({ success: true, plan_id: planId }) });
}

async function handlePause(
  event: APIGatewayProxyEvent,
  services: ReturnType<typeof buildServices>,
  tenantId: string,
  accountId: string,
  planId: string
): Promise<APIGatewayProxyResult> {
  const { repo, lifecycle } = services;
  const plan = await repo.getPlan(tenantId, accountId, planId);
  if (!plan) return cors({ statusCode: 404, body: JSON.stringify({ error: 'Plan not found' }) });
  if (plan.plan_status !== 'ACTIVE') {
    return cors({
      statusCode: 400,
      body: JSON.stringify({ error: 'Plan must be ACTIVE to pause', status: plan.plan_status }),
    });
  }
  const body = parseBody<{ reason?: string }>(event);
  await lifecycle.transition(plan, 'PAUSED', { reason: body.reason });
  return cors({ statusCode: 200, body: JSON.stringify({ success: true, plan_id: planId }) });
}

async function handleResume(
  event: APIGatewayProxyEvent,
  services: ReturnType<typeof buildServices>,
  tenantId: string,
  accountId: string,
  planId: string
): Promise<APIGatewayProxyResult> {
  const { repo, gate, lifecycle } = services;
  const plan = await repo.getPlan(tenantId, accountId, planId);
  if (!plan) return cors({ statusCode: 404, body: JSON.stringify({ error: 'Plan not found' }) });
  if (plan.plan_status !== 'PAUSED') {
    return cors({
      statusCode: 400,
      body: JSON.stringify({ error: 'Plan must be PAUSED to resume', status: plan.plan_status }),
    });
  }
  const active = await repo.existsActivePlanForAccountAndType(tenantId, accountId, plan.plan_type);
  const existing_active_plan_ids = active.exists && active.planId ? [active.planId] : [];
  const body = parseBody<{ preconditions_met?: boolean }>(event);
  const preconditions_met = body.preconditions_met !== false;
  const result = await gate.evaluateCanActivate({
    plan,
    tenant_id: tenantId,
    account_id: accountId,
    existing_active_plan_ids,
    preconditions_met,
  });
  if (!result.can_activate) {
    return cors({
      statusCode: 400,
      body: JSON.stringify({ error: 'Cannot resume', reasons: result.reasons }),
    });
  }
  await lifecycle.transition(plan, 'ACTIVE');
  return cors({ statusCode: 200, body: JSON.stringify({ success: true, plan_id: planId }) });
}

async function handleAbort(
  event: APIGatewayProxyEvent,
  services: ReturnType<typeof buildServices>,
  tenantId: string,
  accountId: string,
  planId: string
): Promise<APIGatewayProxyResult> {
  const { repo, lifecycle } = services;
  const plan = await repo.getPlan(tenantId, accountId, planId);
  if (!plan) return cors({ statusCode: 404, body: JSON.stringify({ error: 'Plan not found' }) });
  const terminal = ['COMPLETED', 'ABORTED', 'EXPIRED'];
  if (terminal.includes(plan.plan_status)) {
    return cors({
      statusCode: 400,
      body: JSON.stringify({ error: 'Plan is already terminal', status: plan.plan_status }),
    });
  }
  const body = parseBody<{ reason?: string }>(event);
  const aborted_at = new Date().toISOString();
  await lifecycle.transition(plan, 'ABORTED', { reason: body.reason, aborted_at });
  return cors({ statusCode: 200, body: JSON.stringify({ success: true, plan_id: planId }) });
}

export const handler: Handler<APIGatewayProxyEvent, APIGatewayProxyResult> = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  if (event.httpMethod === 'OPTIONS') return cors({ statusCode: 200, body: '' });

  const services = getServices();
  if (!services) {
    return cors({ statusCode: 503, body: JSON.stringify({ error: 'Service not configured' }) });
  }

  const authResult = auth(event);
  if (!authResult) {
    return cors({ statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) });
  }
  const { tenantId, accountId } = authResult;
  const planId = event.pathParameters?.planId;
  if (!planId) {
    return cors({ statusCode: 400, body: JSON.stringify({ error: 'Missing planId' }) });
  }

  const path = event.resource || event.path || '';
  try {
    if (path.endsWith('/approve') && event.httpMethod === 'POST') {
      return await handleApprove(event, services, tenantId, accountId, planId);
    }
    if (path.endsWith('/pause') && event.httpMethod === 'POST') {
      return await handlePause(event, services, tenantId, accountId, planId);
    }
    if (path.endsWith('/resume') && event.httpMethod === 'POST') {
      return await handleResume(event, services, tenantId, accountId, planId);
    }
    if (path.endsWith('/abort') && event.httpMethod === 'POST') {
      return await handleAbort(event, services, tenantId, accountId, planId);
    }
    return cors({ statusCode: 404, body: JSON.stringify({ error: 'Not found', path }) });
  } catch (err) {
    logger.error('Plan lifecycle API error', {
      planId,
      path,
      error: err instanceof Error ? err.message : String(err),
    });
    return cors({
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error' }),
    });
  }
};
