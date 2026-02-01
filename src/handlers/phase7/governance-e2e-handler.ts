/**
 * Phase 7 E2E — Governance E2E handler: budget reserve (and optional outcomes capture) for post-deploy E2E scripts.
 * Invoked by scripts/phase_7/test-phase7-budget-reserve.sh with action=budget_reserve.
 * Writes BUDGET_RESERVE to Plan Ledger; E2E asserts ledger entry.
 * See PHASE_7_E2E_TEST_PLAN.md.
 */

import { Handler } from 'aws-lambda';
import { Logger } from '../../services/core/Logger';
import { PlanLedgerService } from '../../services/plan/PlanLedgerService';
import { BudgetService } from '../../services/governance/BudgetService';
import { BudgetUsageStore } from '../../services/governance/BudgetUsageStore';
import type { BudgetScope, CostClass } from '../../types/governance/BudgetTypes';

const logger = new Logger('GovernanceE2E');

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`[GovernanceE2E] Missing env: ${name}`);
  return v;
}

interface BudgetReserveBody {
  action: 'budget_reserve';
  plan_id: string;
  tenant_id: string;
  account_id?: string;
  period_key?: string;
  cost_class?: CostClass;
  amount?: number;
  operation_id?: string;
}

interface InvokeEvent {
  body?: string;
}

export const handler: Handler<InvokeEvent, { statusCode: number; body: string }> = async (event) => {
  const region = process.env.AWS_REGION ?? 'us-east-1';
  const planLedgerTableName = process.env.PLAN_LEDGER_TABLE_NAME ?? '';
  if (!planLedgerTableName) {
    return { statusCode: 500, body: JSON.stringify({ error: 'PLAN_LEDGER_TABLE_NAME not set' }) };
  }

  let body: BudgetReserveBody;
  try {
    body = event.body ? JSON.parse(event.body) : {};
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  if (body.action !== 'budget_reserve') {
    return { statusCode: 400, body: JSON.stringify({ error: 'action must be budget_reserve' }) };
  }

  const planId = body.plan_id ?? '';
  const tenantId = body.tenant_id ?? '';
  if (!planId || !tenantId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'plan_id and tenant_id required' }) };
  }

  const ledger = new PlanLedgerService(logger, {
    tableName: requireEnv('PLAN_LEDGER_TABLE_NAME'),
    region,
  });
  const usageStore = new BudgetUsageStore();
  const budgetService = new BudgetService({
    usageStore,
    planLedger: ledger,
    logger,
    defaultPlanId: planId,
    defaultAccountId: body.account_id ?? '',
  });

  const scope: BudgetScope = {
    tenant_id: tenantId,
    account_id: body.account_id ?? undefined,
    plan_id: planId,
  };
  const periodKey = body.period_key ?? new Date().toISOString().slice(0, 10);
  const costClass: CostClass = body.cost_class ?? 'EXPENSIVE';
  const amount = body.amount ?? 1;
  const operationId = body.operation_id ?? `e2e-p7-budget-${Date.now()}`;

  const result = await budgetService.reserve({
    scope,
    period_key: periodKey,
    cost_class: costClass,
    operation_id: operationId,
    amount,
  });

  return {
    statusCode: 200,
    body: JSON.stringify({ result: result.result, reason: result.reason, details: result.details }),
  };
};
