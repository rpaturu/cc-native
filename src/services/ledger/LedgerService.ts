import { DynamoDBDocumentClient, PutCommand, QueryCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { LedgerEntry, LedgerQuery, ILedgerService, LedgerEventType } from '../../types/LedgerTypes';
import { Logger } from '../core/Logger';
import { getAWSClientConfig } from '../../utils/aws-client-config';
import { v4 as uuidv4 } from 'uuid';

/**
 * LedgerService - Append-only execution ledger
 * 
 * Ledger entries are append-only and cannot be modified or deleted.
 */
export class LedgerService implements ILedgerService {
  private dynamoClient: DynamoDBDocumentClient;
  private logger: Logger;
  private tableName: string;

  constructor(
    logger: Logger,
    tableName: string,
    region?: string
  ) {
    this.logger = logger;
    this.tableName = tableName;
    
    const clientConfig = getAWSClientConfig(region);
    const client = new DynamoDBClient(clientConfig);
    // Configure to remove undefined values from nested objects/arrays
    // This prevents DynamoDB errors when ledger entry data contains undefined fields
    this.dynamoClient = DynamoDBDocumentClient.from(client, {
      marshallOptions: {
        removeUndefinedValues: true,
      },
    });
  }

  /**
   * Append entry to ledger (append-only)
   */
  async append(entry: Omit<LedgerEntry, 'entryId' | 'timestamp'>): Promise<LedgerEntry> {
    const entryId = `entry-${Date.now()}-${uuidv4()}`;
    const timestamp = new Date().toISOString();

    const ledgerEntry: LedgerEntry = {
      ...entry,
      entryId,
      timestamp,
    };

    try {
      const command = new PutCommand({
        TableName: this.tableName,
        Item: {
          ...ledgerEntry,
          // Composite key: tenantId + entryId for querying
          pk: `TENANT#${entry.tenantId}`,
          sk: `ENTRY#${timestamp}#${entryId}`,
          // GSI1 for traceId queries
          gsi1pk: `TRACE#${entry.traceId}`,
          gsi1sk: timestamp,
          // GSI2 for time-range queries (tenant + timestamp)
          gsi2pk: `TENANT#${entry.tenantId}`,
          gsi2sk: timestamp,
        },
        // Prevent overwrites (append-only)
        ConditionExpression: 'attribute_not_exists(entryId)',
      });

      await this.dynamoClient.send(command);
      
      this.logger.debug('Ledger entry appended', {
        entryId,
        traceId: entry.traceId,
        eventType: entry.eventType,
      });

      return ledgerEntry;
    } catch (error) {
      this.logger.error('Failed to append ledger entry', {
        entryId,
        traceId: entry.traceId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Query ledger entries
   */
  async query(query: LedgerQuery): Promise<LedgerEntry[]> {
    try {
      let keyConditionExpression = '';
      let filterExpression = '';
      const expressionAttributeValues: Record<string, any> = {};
      const expressionAttributeNames: Record<string, string> = {};

      // Determine which index to use
      if (query.traceId) {
        // Use GSI1 for traceId queries
        keyConditionExpression = 'gsi1pk = :gsi1pk';
        expressionAttributeValues[':gsi1pk'] = `TRACE#${query.traceId}`;
      } else if (query.startTime && query.endTime) {
        // Use GSI2 for time-range queries
        keyConditionExpression = 'gsi2pk = :gsi2pk AND gsi2sk BETWEEN :startTime AND :endTime';
        expressionAttributeValues[':gsi2pk'] = `TENANT#${query.tenantId}`;
        expressionAttributeValues[':startTime'] = query.startTime;
        expressionAttributeValues[':endTime'] = query.endTime;
      } else {
        // Default: query by tenant
        keyConditionExpression = 'pk = :pk AND begins_with(sk, :sk)';
        expressionAttributeValues[':pk'] = `TENANT#${query.tenantId}`;
        expressionAttributeValues[':sk'] = 'ENTRY#';
      }

      // Add additional filters
      if (query.eventType) {
        filterExpression += filterExpression ? ' AND eventType = :eventType' : 'eventType = :eventType';
        expressionAttributeValues[':eventType'] = query.eventType;
      }

      if (query.accountId) {
        filterExpression += filterExpression ? ' AND accountId = :accountId' : 'accountId = :accountId';
        expressionAttributeValues[':accountId'] = query.accountId;
      }

      const command = new QueryCommand({
        TableName: this.tableName,
        ...(query.traceId ? { IndexName: 'gsi1-index' } : {}),
        ...(query.startTime && query.endTime && !query.traceId ? { IndexName: 'gsi2-index' } : {}),
        KeyConditionExpression: keyConditionExpression,
        ...(filterExpression ? { FilterExpression: filterExpression } : {}),
        ...(Object.keys(expressionAttributeNames).length > 0 ? { ExpressionAttributeNames: expressionAttributeNames } : {}),
        ExpressionAttributeValues: expressionAttributeValues,
        ...(query.limit ? { Limit: query.limit } : {}),
        ScanIndexForward: false, // Most recent first
      });

      const result = await this.dynamoClient.send(command);
      
      if (!result.Items || result.Items.length === 0) {
        return [];
      }

      // Map DynamoDB items to LedgerEntry (remove composite keys)
      return result.Items.map(item => {
        const { pk, sk, gsi1pk, gsi1sk, gsi2pk, gsi2sk, ...entry } = item;
        return entry as LedgerEntry;
      });
    } catch (error) {
      this.logger.error('Failed to query ledger', {
        query,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get entries by trace ID
   */
  async getByTraceId(traceId: string): Promise<LedgerEntry[]> {
    return this.query({
      tenantId: '', // Will be extracted from traceId if needed
      traceId,
    });
  }

  /**
   * Get entry by entry ID
   */
  async getByEntryId(entryId: string): Promise<LedgerEntry | null> {
    try {
      // Note: This requires a GSI on entryId for efficient lookup
      // For Phase 0, we'll need tenantId to query
      // TODO: Add GSI on entryId for direct lookup
      throw new Error('getByEntryId requires tenantId - use query with entryId filter');
    } catch (error) {
      this.logger.error('Failed to get ledger entry', {
        entryId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
