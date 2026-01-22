import { LedgerService } from '../../../services/ledger/LedgerService';
import { Logger } from '../../../services/core/Logger';
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { mockDynamoDBDocumentClient, resetAllMocks } from '../../__mocks__/aws-sdk-clients';
import { LedgerEventType } from '../../../types/LedgerTypes';

// Mock the DynamoDBDocumentClient
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn(() => mockDynamoDBDocumentClient),
  },
  PutCommand: jest.fn(),
  QueryCommand: jest.fn(),
}));

describe('LedgerService', () => {
  let ledgerService: LedgerService;
  let logger: Logger;

  beforeEach(() => {
    resetAllMocks();
    logger = new Logger('LedgerServiceTest');
    ledgerService = new LedgerService(logger, 'test-ledger-table', 'us-west-2');
  });

  describe('append', () => {
    it('should append entry to ledger', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({});

      const entry = await ledgerService.append({
        traceId: 'trace-123',
        tenantId: 'tenant-456',
        accountId: 'account-789',
        eventType: 'INTENT' as LedgerEventType,
        data: { action: 'test' },
      });

      expect(entry.entryId).toBeDefined();
      expect(entry.traceId).toBe('trace-123');
      expect(entry.tenantId).toBe('tenant-456');
      expect(mockDynamoDBDocumentClient.send).toHaveBeenCalledTimes(1);
      expect(PutCommand).toHaveBeenCalled();
    });

    it('should generate unique entry IDs', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({});

      const entry1 = await ledgerService.append({
        traceId: 'trace-1',
        tenantId: 'tenant-1',
        eventType: 'INTENT' as LedgerEventType,
        data: {},
      });

      const entry2 = await ledgerService.append({
        traceId: 'trace-2',
        tenantId: 'tenant-2',
        eventType: 'INTENT' as LedgerEventType,
        data: {},
      });

      expect(entry1.entryId).not.toBe(entry2.entryId);
    });

    it('should prevent overwrites (append-only)', async () => {
      const error = new Error('ConditionalCheckFailedException');
      (error as any).name = 'ConditionalCheckFailedException';
      mockDynamoDBDocumentClient.send.mockRejectedValue(error);

      await expect(
        ledgerService.append({
          traceId: 'trace-123',
          tenantId: 'tenant-456',
          eventType: 'INTENT' as LedgerEventType,
          data: {},
        })
      ).rejects.toThrow();
    });
  });

  describe('query', () => {
    it('should query by tenantId', async () => {
      const entries = [
        {
          entryId: 'entry-1',
          traceId: 'trace-123',
          tenantId: 'tenant-456',
          eventType: 'INTENT' as LedgerEventType,
          timestamp: new Date().toISOString(),
          data: {},
        },
      ];

      mockDynamoDBDocumentClient.send.mockResolvedValue({
        Items: entries.map(e => ({
          ...e,
          pk: `TENANT#${e.tenantId}`,
          sk: `ENTRY#${e.timestamp}#${e.entryId}`,
        })),
      });

      const result = await ledgerService.query({
        tenantId: 'tenant-456',
      });

      expect(result).toHaveLength(1);
      expect(result[0].entryId).toBe('entry-1');
      expect(mockDynamoDBDocumentClient.send).toHaveBeenCalledTimes(1);
    });

    it('should query by traceId using GSI', async () => {
      const entries = [
        {
          entryId: 'entry-1',
          traceId: 'trace-123',
          tenantId: 'tenant-456',
          eventType: 'INTENT' as LedgerEventType,
          timestamp: new Date().toISOString(),
          data: {},
        },
      ];

      mockDynamoDBDocumentClient.send.mockResolvedValue({
        Items: entries.map(e => ({
          ...e,
          gsi1pk: `TRACE#${e.traceId}`,
          gsi1sk: e.timestamp,
        })),
      });

      const result = await ledgerService.query({
        tenantId: 'tenant-456',
        traceId: 'trace-123',
      });

      expect(result).toHaveLength(1);
      expect(result[0].traceId).toBe('trace-123');
    });

    it('should query by time range using GSI2', async () => {
      const startTime = '2024-01-01T00:00:00Z';
      const endTime = '2024-01-02T00:00:00Z';

      const entries = [
        {
          entryId: 'entry-1',
          traceId: 'trace-123',
          tenantId: 'tenant-456',
          eventType: 'INTENT' as LedgerEventType,
          timestamp: '2024-01-01T12:00:00Z',
          data: {},
        },
      ];

      mockDynamoDBDocumentClient.send.mockResolvedValue({
        Items: entries.map(e => ({
          ...e,
          gsi2pk: `TENANT#${e.tenantId}`,
          gsi2sk: e.timestamp,
        })),
      });

      const result = await ledgerService.query({
        tenantId: 'tenant-456',
        startTime,
        endTime,
      });

      expect(result).toHaveLength(1);
    });

    it('should filter by eventType', async () => {
      const entries = [
        {
          entryId: 'entry-1',
          traceId: 'trace-123',
          tenantId: 'tenant-456',
          eventType: 'INTENT' as LedgerEventType,
          timestamp: new Date().toISOString(),
          data: {},
        },
      ];

      mockDynamoDBDocumentClient.send.mockResolvedValue({
        Items: entries.map(e => ({
          ...e,
          pk: `TENANT#${e.tenantId}`,
          sk: `ENTRY#${e.timestamp}#${e.entryId}`,
        })),
      });

      const result = await ledgerService.query({
        tenantId: 'tenant-456',
        eventType: 'INTENT' as LedgerEventType,
      });

      expect(result).toHaveLength(1);
      expect(result[0].eventType).toBe('INTENT');
    });

    it('should return empty array for no results', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({
        Items: [],
      });

      const result = await ledgerService.query({
        tenantId: 'tenant-456',
      });

      expect(result).toHaveLength(0);
    });
  });

  describe('getByTraceId', () => {
    it('should get entries by trace ID', async () => {
      const entries = [
        {
          entryId: 'entry-1',
          traceId: 'trace-123',
          tenantId: 'tenant-456',
          eventType: 'INTENT' as LedgerEventType,
          timestamp: new Date().toISOString(),
          data: {},
        },
      ];

      mockDynamoDBDocumentClient.send.mockResolvedValue({
        Items: entries.map(e => ({
          ...e,
          gsi1pk: `TRACE#${e.traceId}`,
          gsi1sk: e.timestamp,
        })),
      });

      const result = await ledgerService.getByTraceId('trace-123');

      expect(result).toHaveLength(1);
      expect(result[0].traceId).toBe('trace-123');
    });
  });
});
