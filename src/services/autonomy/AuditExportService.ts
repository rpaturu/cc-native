/**
 * Phase 5.6 — Audit export jobs (async pattern).
 * POST creates job (PENDING); GET returns status. Worker Lambda writes S3 and updates job (follow-up).
 */

import { DynamoDBDocumentClient, PutCommand, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { Logger } from '../core/Logger';
import { v4 as uuidv4 } from 'uuid';

const SK_PREFIX = 'EXPORT#';

function pk(tenantId: string): string {
  return `TENANT#${tenantId}`;
}

function sk(exportId: string): string {
  return `${SK_PREFIX}${exportId}`;
}

export interface AuditExportJob {
  pk: string;
  sk: string;
  export_id: string;
  tenant_id: string;
  account_id?: string;
  from: string;
  to: string;
  format: 'json' | 'csv';
  status: 'PENDING' | 'COMPLETED' | 'FAILED';
  created_at: string;
  presigned_url?: string;
  expires_at?: string;
  s3_bucket?: string;
  s3_key?: string;
  error_message?: string;
}

export interface CreateJobInput {
  tenant_id: string;
  account_id?: string;
  from: string;
  to: string;
  format?: 'json' | 'csv';
}

export class AuditExportService {
  constructor(
    private dynamoClient: DynamoDBDocumentClient,
    private tableName: string,
    private logger: Logger
  ) {}

  async createJob(input: CreateJobInput): Promise<{ export_id: string; status: 'PENDING' }> {
    const export_id = `exp-${uuidv4().slice(0, 12)}`;
    const now = new Date().toISOString();
    const item: AuditExportJob = {
      pk: pk(input.tenant_id),
      sk: sk(export_id),
      export_id,
      tenant_id: input.tenant_id,
      account_id: input.account_id,
      from: input.from,
      to: input.to,
      format: input.format || 'json',
      status: 'PENDING',
      created_at: now,
    };
    await this.dynamoClient.send(
      new PutCommand({ TableName: this.tableName, Item: item as unknown as Record<string, unknown> })
    );
    this.logger.debug('Audit export job created', { export_id, tenant_id: input.tenant_id });
    return { export_id, status: 'PENDING' };
  }

  async getJob(exportId: string, tenantId: string): Promise<AuditExportJob | null> {
    const result = await this.dynamoClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { pk: pk(tenantId), sk: sk(exportId) },
      })
    );
    if (!result.Item) return null;
    const item = result.Item as Record<string, unknown>;
    if ((item.tenant_id as string) !== tenantId) return null;
    return item as unknown as AuditExportJob;
  }

  /**
   * Update job status after worker completes (COMPLETED with S3 location, or FAILED with error_message).
   */
  async updateJobCompletion(
    exportId: string,
    tenantId: string,
    update: {
      status: 'COMPLETED' | 'FAILED';
      s3_bucket?: string;
      s3_key?: string;
      error_message?: string;
    }
  ): Promise<void> {
    const now = new Date().toISOString();
    const setParts: string[] = ['#status = :status', 'updated_at = :now'];
    const exprValues: Record<string, unknown> = {
      ':status': update.status,
      ':now': now,
    };
    if (update.s3_bucket) {
      setParts.push('s3_bucket = :s3_bucket');
      exprValues[':s3_bucket'] = update.s3_bucket;
    }
    if (update.s3_key) {
      setParts.push('s3_key = :s3_key');
      exprValues[':s3_key'] = update.s3_key;
    }
    if (update.error_message) {
      setParts.push('error_message = :error_message');
      exprValues[':error_message'] = update.error_message;
    }
    await this.dynamoClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { pk: pk(tenantId), sk: sk(exportId) },
        UpdateExpression: `SET ${setParts.join(', ')}`,
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: exprValues,
      })
    );
    this.logger.debug('Audit export job updated', { export_id: exportId, status: update.status });
  }
}
