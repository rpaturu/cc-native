/**
 * AuditExportService Unit Tests - Phase 5.6
 */

import { AuditExportService } from '../../../services/autonomy/AuditExportService';
import { Logger } from '../../../services/core/Logger';
import { PutCommand, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { mockDynamoDBDocumentClient, resetAllMocks } from '../../__mocks__/aws-sdk-clients';

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn(() => mockDynamoDBDocumentClient) },
  PutCommand: jest.fn(),
  GetCommand: jest.fn(),
  UpdateCommand: jest.fn(),
}));

describe('AuditExportService', () => {
  let service: AuditExportService;
  const tableName = 'test-audit-export';

  beforeEach(() => {
    resetAllMocks();
    jest.clearAllMocks();
    service = new AuditExportService(
      mockDynamoDBDocumentClient as any,
      tableName,
      new Logger('AuditExportServiceTest')
    );
  });

  describe('createJob', () => {
    it('writes job with PENDING and returns export_id and status', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({});

      const result = await service.createJob({
        tenant_id: 't1',
        from: '2026-01-01',
        to: '2026-01-31',
      });

      expect(result.status).toBe('PENDING');
      expect(result.export_id).toMatch(/^exp-[a-f0-9-]+$/);
      expect(result.export_id.length).toBeGreaterThanOrEqual(10);
      expect(PutCommand).toHaveBeenCalledTimes(1);
      const call = (PutCommand as unknown as jest.Mock).mock.calls[0][0];
      expect(call.TableName).toBe(tableName);
      expect(call.Item.pk).toBe('TENANT#t1');
      expect(call.Item.sk).toMatch(/^EXPORT#exp-/);
      expect(call.Item.tenant_id).toBe('t1');
      expect(call.Item.from).toBe('2026-01-01');
      expect(call.Item.to).toBe('2026-01-31');
      expect(call.Item.status).toBe('PENDING');
      expect(call.Item.format).toBe('json');
    });

    it('includes account_id and format when provided', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({});

      await service.createJob({
        tenant_id: 't1',
        account_id: 'a1',
        from: '2026-01-01',
        to: '2026-01-31',
        format: 'csv',
      });

      const call = (PutCommand as unknown as jest.Mock).mock.calls[0][0];
      expect(call.Item.account_id).toBe('a1');
      expect(call.Item.format).toBe('csv');
    });
  });

  describe('getJob', () => {
    it('returns job when found and tenant matches', async () => {
      const item = {
        pk: 'TENANT#t1',
        sk: 'EXPORT#exp-abc123',
        export_id: 'exp-abc123',
        tenant_id: 't1',
        status: 'PENDING',
        from: '2026-01-01',
        to: '2026-01-31',
        format: 'json',
        created_at: '2026-01-28T00:00:00Z',
      };
      mockDynamoDBDocumentClient.send.mockResolvedValue({ Item: item });

      const result = await service.getJob('exp-abc123', 't1');

      expect(result).toEqual(item);
      expect(GetCommand).toHaveBeenCalledWith({
        TableName: tableName,
        Key: { pk: 'TENANT#t1', sk: 'EXPORT#exp-abc123' },
      });
    });

    it('returns null when item not found', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({ Item: undefined });

      const result = await service.getJob('exp-abc123', 't1');

      expect(result).toBeNull();
    });

    it('returns null when tenant_id does not match', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({
        Item: { pk: 'TENANT#t1', sk: 'EXPORT#exp-abc123', tenant_id: 't1', export_id: 'exp-abc123' },
      });

      const result = await service.getJob('exp-abc123', 't2');

      expect(result).toBeNull();
    });
  });

  describe('updateJobCompletion', () => {
    it('updates job to COMPLETED with s3_bucket and s3_key', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({});

      await service.updateJobCompletion('exp-abc123', 't1', {
        status: 'COMPLETED',
        s3_bucket: 'my-bucket',
        s3_key: 'audit-exports/t1/exp-abc123.json',
      });

      expect(UpdateCommand).toHaveBeenCalledTimes(1);
      const call = (UpdateCommand as unknown as jest.Mock).mock.calls[0][0];
      expect(call.TableName).toBe(tableName);
      expect(call.Key).toEqual({ pk: 'TENANT#t1', sk: 'EXPORT#exp-abc123' });
      expect(call.UpdateExpression).toContain('#status = :status');
      expect(call.UpdateExpression).toContain('s3_bucket = :s3_bucket');
      expect(call.UpdateExpression).toContain('s3_key = :s3_key');
      expect(call.ExpressionAttributeValues[':status']).toBe('COMPLETED');
      expect(call.ExpressionAttributeValues[':s3_bucket']).toBe('my-bucket');
      expect(call.ExpressionAttributeValues[':s3_key']).toBe('audit-exports/t1/exp-abc123.json');
    });

    it('updates job to FAILED with error_message', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({});

      await service.updateJobCompletion('exp-abc123', 't1', {
        status: 'FAILED',
        error_message: 'Ledger query failed',
      });

      const call = (UpdateCommand as unknown as jest.Mock).mock.calls[0][0];
      expect(call.ExpressionAttributeValues[':status']).toBe('FAILED');
      expect(call.ExpressionAttributeValues[':error_message']).toBe('Ledger query failed');
    });

    it('includes only status and updated_at when no optional fields', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({});

      await service.updateJobCompletion('exp-abc123', 't1', { status: 'COMPLETED' });

      const call = (UpdateCommand as unknown as jest.Mock).mock.calls[0][0];
      expect(call.UpdateExpression).not.toContain('s3_bucket');
      expect(call.UpdateExpression).not.toContain('error_message');
    });
  });
});
