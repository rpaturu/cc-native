/**
 * Phase 6.1 + 6.4 — Plan lifecycle API: approve, pause, resume, abort; GET list, get plan, get ledger.
 * POST /plans/propose, /plans/:planId/approve | /pause | /resume | /abort
 * GET /plans, GET /plans/:planId, GET /plans/:planId/ledger
 * Auth: JWT authorizer; tenant_id + account_id from claims/query.
 * See PHASE_6_1_CODE_LEVEL_PLAN.md §6; PHASE_6_4_CODE_LEVEL_PLAN.md.
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
import { PlanProposalGeneratorService } from '../../services/plan/PlanProposalGeneratorService';
import { getPlanTypeConfig } from '../../config/planTypeConfig';
import {
  PlanSummary,
  toPlanSummary,
  isValidPlanStatus,
  type PlanStatus,
} from '../../types/plan/PlanTypes';

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
  proposalGenerator: PlanProposalGeneratorService;
} {
  const repo = new PlanRepositoryService(logger, {
    tableName: requireEnv('REVENUE_PLANS_TABLE_NAME'),
    region,
  });
  const ledger = new PlanLedgerService(logger, {
    tableName: requireEnv('PLAN_LEDGER_TABLE_NAME'),
    region,
  });
  const gate = new PlanPolicyGateService({ getPlanTypeConfig });
  const lifecycle = new PlanLifecycleService({
    planRepository: repo,
    planLedger: ledger,
    logger,
  });
  const proposalGenerator = new PlanProposalGeneratorService({ logger });
  return { repo, ledger, gate, lifecycle, proposalGenerator };
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
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      ...res.headers,
    },
  };
}

function auth(event: APIGatewayProxyEvent): { tenantId: string; accountId: string } | { tenantId: string; accountId: '' } | null {
  const claims = event.requestContext?.authorizer?.claims as Record<string, string> | undefined;
  const tenantId = claims?.['custom:tenant_id'] ?? claims?.['tenant_id'];
  const accountId = event.queryStringParameters?.account_id ?? (event.body ? JSON.parse(event.body)?.account_id : undefined);
  if (!tenantId) return null;
  if (accountId) return { tenantId, accountId };
  if (event.httpMethod === 'GET') return { tenantId, accountId: '' };
  return null;
}

function parseBody<T = Record<string, unknown>>(event: APIGatewayProxyEvent): T {
  try {
    return (event.body ? JSON.parse(event.body) : {}) as T;
  } catch {
    return {} as T;
  }
}

interface ProposeBody {
  tenant_id?: string;
  account_id?: string;
  plan_type?: string;
  posture?: Record<string, unknown>;
  signals?: unknown[];
  history?: unknown[];
  tenant_goals?: Record<string, unknown>;
}

async function handlePropose(
  event: APIGatewayProxyEvent,
  services: ReturnType<typeof buildServices>,
  tenantId: string,
  accountId: string
): Promise<APIGatewayProxyResult> {
  const body = parseBody<ProposeBody>(event);
  const planType = body.plan_type ?? 'RENEWAL_DEFENSE';
  if (planType !== 'RENEWAL_DEFENSE') {
    return cors({
      statusCode: 400,
      body: JSON.stringify({ error: 'Invalid plan_type; only RENEWAL_DEFENSE is supported in 6.2', plan_type: planType }),
    });
  }
  const tenant_id = body.tenant_id ?? tenantId;
  const account_id = body.account_id ?? accountId;
  if (tenant_id !== tenantId || account_id !== accountId) {
    return cors({
      statusCode: 403,
      body: JSON.stringify({ error: 'tenant_id and account_id must match authenticated claims' }),
    });
  }
  const { proposalGenerator, repo, ledger } = services;
  try {
    const { plan } = await proposalGenerator.generateProposal({
      tenant_id,
      account_id,
      plan_type: planType,
      posture: body.posture,
      signals: body.signals,
      history: body.history,
      tenant_goals: body.tenant_goals,
    });
    await repo.putPlan(plan);
    await ledger.append({
      plan_id: plan.plan_id,
      tenant_id: plan.tenant_id,
      account_id: plan.account_id,
      event_type: 'PLAN_CREATED',
      data: {
        plan_id: plan.plan_id,
        plan_type: plan.plan_type,
        account_id: plan.account_id,
        tenant_id: plan.tenant_id,
        trigger: 'proposal_generated',
      },
    });
    return cors({ statusCode: 201, body: JSON.stringify({ plan }) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('not supported') || message.includes('rejected')) {
      return cors({ statusCode: 400, body: JSON.stringify({ error: message }) });
    }
    logger.error('Propose error', { tenant_id, account_id, error: message });
    return cors({
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error' }),
    });
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

const DEFAULT_LIST_LIMIT = 50;
const DEFAULT_LEDGER_LIMIT = 50;
const DEFAULT_LIST_STATUSES: PlanStatus[] = ['ACTIVE', 'PAUSED'];

function parseStatusParam(event: APIGatewayProxyEvent): string[] | { error: string } {
  const multi = event.multiValueQueryStringParameters?.status;
  if (multi?.length) {
    const invalid = multi.find((s) => !isValidPlanStatus(s));
    if (invalid) return { error: `Invalid status: ${invalid}` };
    return multi as PlanStatus[];
  }
  const single = event.queryStringParameters?.status;
  if (single === undefined || single === null) return DEFAULT_LIST_STATUSES;
  if (typeof single !== 'string' || single.trim() === '') return DEFAULT_LIST_STATUSES;
  const parts = single.split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return DEFAULT_LIST_STATUSES;
  const invalid = parts.find((s) => !isValidPlanStatus(s));
  if (invalid) return { error: `Invalid status: ${invalid}` };
  return parts as PlanStatus[];
}

async function handleListPlans(
  _event: APIGatewayProxyEvent,
  services: ReturnType<typeof buildServices>,
  tenantId: string,
  accountId: string
): Promise<APIGatewayProxyResult> {
  const statusResult = parseStatusParam(_event);
  if (Array.isArray(statusResult) === false) {
    return cors({
      statusCode: 400,
      body: JSON.stringify({ error: statusResult.error }),
    });
  }
  const statuses = statusResult as PlanStatus[];
  const limitParam = _event.queryStringParameters?.limit;
  const limit = limitParam != null ? Math.min(Number(limitParam) || DEFAULT_LIST_LIMIT, 100) : DEFAULT_LIST_LIMIT;
  const { repo } = services;
  const perStatusLimit = Math.max(limit, 100);
  const all: Array<{ plan_id: string; updated_at: string; summary: PlanSummary }> = [];
  const seen = new Set<string>();
  for (const status of statuses) {
    const plans = await repo.listPlansByTenantAndStatus(tenantId, status, perStatusLimit);
    for (const p of plans) {
      if (p.account_id !== accountId) continue;
      if (seen.has(p.plan_id)) continue;
      seen.add(p.plan_id);
      all.push({
        plan_id: p.plan_id,
        updated_at: p.updated_at,
        summary: toPlanSummary(p),
      });
    }
  }
  all.sort((a, b) => (b.updated_at > a.updated_at ? 1 : b.updated_at < a.updated_at ? -1 : 0));
  const plans: PlanSummary[] = all.slice(0, limit).map((x) => x.summary);
  return cors({ statusCode: 200, body: JSON.stringify({ plans }) });
}

async function handleGetPlan(
  _event: APIGatewayProxyEvent,
  services: ReturnType<typeof buildServices>,
  tenantId: string,
  accountId: string,
  planId: string
): Promise<APIGatewayProxyResult> {
  const plan = await services.repo.getPlan(tenantId, accountId, planId);
  if (!plan) return cors({ statusCode: 404, body: JSON.stringify({ error: 'Plan not found' }) });
  return cors({ statusCode: 200, body: JSON.stringify({ plan }) });
}

async function handleGetPlanLedger(
  event: APIGatewayProxyEvent,
  services: ReturnType<typeof buildServices>,
  tenantId: string,
  accountId: string,
  planId: string
): Promise<APIGatewayProxyResult> {
  const plan = await services.repo.getPlan(tenantId, accountId, planId);
  if (!plan) return cors({ statusCode: 404, body: JSON.stringify({ error: 'Plan not found' }) });
  const limitParam = event.queryStringParameters?.limit;
  const limit = limitParam != null ? Number(limitParam) || DEFAULT_LEDGER_LIMIT : DEFAULT_LEDGER_LIMIT;
  const entries = await services.ledger.getByPlanId(planId, limit);
  return cors({ statusCode: 200, body: JSON.stringify({ entries }) });
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
  if (event.httpMethod === 'GET' && !accountId) {
    return cors({ statusCode: 400, body: JSON.stringify({ error: 'Missing account_id for list/get' }) });
  }
  const path = event.resource || event.path || '';
  const planId = event.pathParameters?.planId;

  try {
    if (event.httpMethod === 'GET') {
      if (!planId && (path === '/plans' || path === '/plans/' || path.endsWith('/plans'))) {
        return await handleListPlans(event, services, tenantId, accountId);
      }
      if (planId && path.endsWith('/ledger')) {
        return await handleGetPlanLedger(event, services, tenantId, accountId, planId);
      }
      if (planId) {
        return await handleGetPlan(event, services, tenantId, accountId, planId);
      }
      return cors({ statusCode: 400, body: JSON.stringify({ error: 'Missing account_id or invalid path' }) });
    }
    if (path.endsWith('/propose') && event.httpMethod === 'POST') {
      return await handlePropose(event, services, tenantId, accountId);
    }
    if (!planId) {
      return cors({ statusCode: 400, body: JSON.stringify({ error: 'Missing planId' }) });
    }
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
