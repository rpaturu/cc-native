/**
 * Phase 5.6 — Control Center route handlers (kill-switches, ledger explanation, audit exports).
 * Used by autonomy-admin-api-handler. No I/O at module load; services passed in.
 */

import type { APIGatewayProxyResult } from 'aws-lambda';
import type { KillSwitchService } from '../../services/execution/KillSwitchService';
import type { LedgerExplanationService } from '../../services/autonomy/LedgerExplanationService';
import type { AuditExportService } from '../../services/autonomy/AuditExportService';
import type { LedgerExplanationV1 } from '../../types/phase5/ControlCenterTypes';

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
