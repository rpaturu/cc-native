/**
 * Phase 5.6 - EventBridge event detail for async audit export worker.
 */

export interface AuditExportRequestedDetail {
  export_id: string;
  tenant_id: string;
  account_id?: string;
  from: string;
  to: string;
  format: 'json' | 'csv';
}
