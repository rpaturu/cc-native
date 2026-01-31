/**
 * Phase 5.6 — Control Center route handlers (kill-switches, ledger explanation, audit exports).
 * Used by autonomy-admin-api-handler. No I/O at module load; services passed in.
 */

import type { APIGatewayProxyResult } from 'aws-lambda';
import type { KillSwitchService } from '../../services/execution/KillSwitchService';
import type { LedgerExplanationService } from '../../services/autonomy/LedgerExplanationService';
import type { AuditExportService } from '../../services/autonomy/AuditExportService';
import type { ActionIntentService } from '../../services/decision/ActionIntentService';
import type { LedgerService } from '../../services/ledger/LedgerService';
import type { LedgerExplanationV1 } from '../../types/phase5/ControlCenterTypes';
import { LedgerEventType } from '../../types/LedgerTypes';

/**
 * Resolves tenant_id from JWT/authorizer. Canonical claim: custom:tenant_id (Cognito custom attribute).
 * Fallback: authorizer.tenantId (for custom authorizers). Production should use auth-only; do not
 * rely on query/header tenant_id for Control Center (audit export, ledger explanation) authorization.
 */
export function resolveTenantFromAuth(event: { requestContext?: { authorizer?: unknown } }): string | null {
  const auth = event.requestContext?.authorizer as Record<string, unknown> | undefined;
  if (!auth) return null;
  const claims = auth.claims as Record<string, string> | undefined;
  if (claims?.['custom:tenant_id']) return claims['custom:tenant_id'];
  if (typeof auth.tenantId === 'string') return auth.tenantId;
  return null;
}

export async function getKillSwitches(
  killSwitchService: KillSwitchService,
  tenantId: string
): Promise<APIGatewayProxyResult> {
  const config = await killSwitchService.getKillSwitchConfig(tenantId);
  return { statusCode: 200, body: JSON.stringify(config), headers: {} };
}

export async function putKillSwitches(
  killSwitchService: KillSwitchService,
  tenantId: string,
  body: { execution_enabled?: boolean; disabled_action_types?: string[] }
): Promise<APIGatewayProxyResult> {
  await killSwitchService.updateKillSwitchConfig(tenantId, {
    execution_enabled: body.execution_enabled,
    disabled_action_types: body.disabled_action_types,
  });
  const config = await killSwitchService.getKillSwitchConfig(tenantId);
  return { statusCode: 200, body: JSON.stringify(config), headers: {} };
}

export async function getLedgerExplanation(
  ledgerExplanationService: LedgerExplanationService,
  actionIntentId: string,
  tenantId: string,
  accountId: string
): Promise<APIGatewayProxyResult> {
  const explanation: LedgerExplanationV1 | null = await ledgerExplanationService.getExplanation(
    actionIntentId,
    tenantId,
    accountId
  );
  if (!explanation) {
    return { statusCode: 404, body: JSON.stringify({ error: 'Explanation not found' }), headers: {} };
  }
  return { statusCode: 200, body: JSON.stringify(explanation), headers: {} };
}

export async function postAuditExports(
  auditExportService: AuditExportService,
  tenantId: string,
  body: { from: string; to: string; format?: 'json' | 'csv'; account_id?: string }
): Promise<APIGatewayProxyResult> {
  if (!body.from || !body.to) {
    return { statusCode: 400, body: JSON.stringify({ error: 'from and to required' }), headers: {} };
  }
  const { export_id, status } = await auditExportService.createJob({
    tenant_id: tenantId,
    account_id: body.account_id,
    from: body.from,
    to: body.to,
    format: body.format,
  });
  return { statusCode: 202, body: JSON.stringify({ export_id, status }), headers: {} };
}

export async function getAuditExportStatus(
  auditExportService: AuditExportService,
  exportId: string,
  tenantId: string
): Promise<APIGatewayProxyResult> {
  const job = await auditExportService.getJob(exportId, tenantId);
  if (!job) {
    return { statusCode: 404, body: JSON.stringify({ error: 'Export not found' }), headers: {} };
  }
  const response = {
    export_id: job.export_id,
    status: job.status,
    presigned_url: job.presigned_url,
    expires_at: job.expires_at,
    s3_bucket: job.s3_bucket,
    s3_key: job.s3_key,
    error_message: job.error_message,
  };
  return { statusCode: 200, body: JSON.stringify(response), headers: {} };
}

/** Phase 5.7: Replay execution. AuthZ: tenant from JWT, account_id in body (in scope). */
export async function postReplayExecution(
  actionIntentService: ActionIntentService,
  ledgerService: LedgerService,
  putReplayEvent: (detail: {
    action_intent_id: string;
    tenant_id: string;
    account_id: string;
    replay_reason: string;
    requested_by: string;
  }) => Promise<void>,
  tenantId: string,
  body: { action_intent_id: string; account_id: string; replay_reason: string; requested_by: string }
): Promise<APIGatewayProxyResult> {
  if (!body.action_intent_id || !body.account_id || !body.replay_reason || !body.requested_by) {
    return { statusCode: 400, body: JSON.stringify({ error: 'action_intent_id, account_id, replay_reason, requested_by required' }), headers: {} };
  }
  const intent = await actionIntentService.getIntent(
    body.action_intent_id,
    tenantId,
    body.account_id
  );
  if (!intent) {
    return { statusCode: 404, body: JSON.stringify({ error: 'Intent not found' }), headers: {} };
  }
  const replayTraceId = `replay-request-${Date.now()}-${body.action_intent_id}`;
  await ledgerService.append({
    eventType: LedgerEventType.REPLAY_REQUESTED,
    tenantId,
    accountId: body.account_id,
    traceId: replayTraceId,
    data: {
      action_intent_id: body.action_intent_id,
      replay_reason: body.replay_reason,
      requested_by: body.requested_by,
    },
  });
  await putReplayEvent({
    action_intent_id: body.action_intent_id,
    tenant_id: tenantId,
    account_id: body.account_id,
    replay_reason: body.replay_reason,
    requested_by: body.requested_by,
  });
  return { statusCode: 202, body: JSON.stringify({ status: 'replay_requested', action_intent_id: body.action_intent_id }), headers: {} };
}
