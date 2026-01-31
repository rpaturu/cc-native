/**
 * Phase 5.6 - Async audit export worker.
 * Invoked by EventBridge when an audit export job is created (PENDING).
 * Queries ledger for range, writes JSON/CSV to S3, updates job to COMPLETED or FAILED.
 */

import { EventBridgeEvent, Context } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getAWSClientConfig } from '../../utils/aws-client-config';
import { Logger } from '../../services/core/Logger';
import { LedgerService } from '../../services/ledger/LedgerService';
import { AuditExportService } from '../../services/autonomy/AuditExportService';
import type { AuditExportRequestedDetail } from "../../types/phase5/AuditExportEventTypes";
import type { LedgerEntry } from "../../types/LedgerTypes";

const logger = new Logger('AuditExportWorker');

const region = process.env.AWS_REGION || "us-west-2";
const clientConfig = getAWSClientConfig(region);
const dynamoClient = DynamoDBDocumentClient.from(
  new DynamoDBClient(clientConfig),
  { marshallOptions: { removeUndefinedValues: true } }
);
const s3Client = new S3Client(clientConfig);

const MAX_LEDGER_LIMIT = 10_000;

function toCsvRow(entry: LedgerEntry): string {
  const dataStr = JSON.stringify(entry.data ?? {}).replace(/"/g, '""');
  return [
    entry.timestamp,
    entry.eventType,
    entry.entryId,
    entry.tenantId ?? '',
    entry.accountId ?? '',
    entry.traceId ?? '',
    `"${dataStr}"`,
  ].join(',');
}

function csvHeader(): string {
  return 'timestamp,eventType,entryId,tenantId,accountId,traceId,data';
}

export async function handler(
  event: EventBridgeEvent<'AuditExportRequested', AuditExportRequestedDetail>,
  _context: Context
): Promise<void> {
  const detail = event.detail;
  if (!detail?.export_id || !detail?.tenant_id || !detail?.from || !detail?.to) {
    logger.warn('Invalid event detail', { detail });
    return;
  }
  const ledgerTableName = process.env.LEDGER_TABLE_NAME;
  const auditExportTableName = process.env.AUDIT_EXPORT_TABLE_NAME;
  const auditExportBucketName = process.env.AUDIT_EXPORT_BUCKET_NAME;
  if (!ledgerTableName || !auditExportTableName || !auditExportBucketName) {
    logger.error('Missing env: LEDGER_TABLE_NAME, AUDIT_EXPORT_TABLE_NAME, or AUDIT_EXPORT_BUCKET_NAME');
    await markFailed(detail.export_id, detail.tenant_id, 'Worker misconfigured');
    return;
  }

  const ledgerService = new LedgerService(logger, ledgerTableName, region);
  const auditExportService = new AuditExportService(
    dynamoClient,
    auditExportTableName,
    logger
  );

  const job = await auditExportService.getJob(detail.export_id, detail.tenant_id);
  if (!job) {
    logger.warn('Export job not found', { export_id: detail.export_id, tenant_id: detail.tenant_id });
    return;
  }
  if (job.status !== 'PENDING') {
    logger.info('Job already processed', { export_id: detail.export_id, status: job.status });
    return;
  }

  try {
    const entries = await ledgerService.query({
      tenantId: detail.tenant_id,
      accountId: detail.account_id,
      startTime: detail.from,
      endTime: detail.to,
      limit: MAX_LEDGER_LIMIT,
    });

    const format = detail.format || 'json';
    const ext = format === 'csv' ? 'csv' : 'json';
    const s3Key = `audit-exports/${detail.tenant_id}/${detail.export_id}.${ext}`;

    if (format === 'csv') {
      const lines = [csvHeader(), ...entries.map(toCsvRow)];
      const body = lines.join('\n');
      await s3Client.send(
        new PutObjectCommand({
          Bucket: auditExportBucketName,
          Key: s3Key,
          Body: body,
          ContentType: 'text/csv',
        })
      );
    } else {
      const body = JSON.stringify(entries, null, 2);
      await s3Client.send(
        new PutObjectCommand({
          Bucket: auditExportBucketName,
          Key: s3Key,
          Body: body,
          ContentType: 'application/json',
        })
      );
    }

    await auditExportService.updateJobCompletion(detail.export_id, detail.tenant_id, {
      status: 'COMPLETED',
      s3_bucket: auditExportBucketName,
      s3_key: s3Key,
    });
    logger.info('Audit export completed', {
      export_id: detail.export_id,
      tenant_id: detail.tenant_id,
      entry_count: entries.length,
      s3_key: s3Key,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Audit export failed', { export_id: detail.export_id, error: message });
    await markFailed(detail.export_id, detail.tenant_id, message);
  }
}

async function markFailed(
  exportId: string,
  tenantId: string,
  errorMessage: string
): Promise<void> {
  const auditExportTableName = process.env.AUDIT_EXPORT_TABLE_NAME;
  if (!auditExportTableName) return;
  const auditExportService = new AuditExportService(
    dynamoClient,
    auditExportTableName,
    logger
  );
  await auditExportService.updateJobCompletion(exportId, tenantId, {
    status: 'FAILED',
    error_message: errorMessage,
  });
}
