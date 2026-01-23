import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { Logger } from './Logger';
import { getAWSClientConfig } from '../../utils/aws-client-config';

export interface CacheConfig {
  ttlHours: number;
  maxEntries?: number;
  compressionEnabled?: boolean;
}

/**
 * CacheService - DynamoDB-based TTL cache (best-effort semantics)
 * 
 * Critical: Cache failures must NOT break core flows.
 * All methods handle errors gracefully and return null/void on failure.
 */
export class CacheService {
  private readonly dynamoClient: DynamoDBDocumentClient;
  private readonly config: CacheConfig;
  private readonly logger: Logger;
  private readonly tableName: string;

  constructor(config: CacheConfig, logger: Logger, tableName: string, region?: string) {
    this.config = config;
    this.logger = logger;
    this.tableName = tableName;
    
    const clientConfig = getAWSClientConfig(region);
    const client = new DynamoDBClient(clientConfig);
    this.dynamoClient = DynamoDBDocumentClient.from(client);
  }

  /**
   * Get cached value (returns null on miss/failure)
   */
  async get<T>(key: string): Promise<T | null> {
    try {
      const command = new GetCommand({
        TableName: this.tableName,
        Key: { cacheKey: key },
      });

      const result = await this.dynamoClient.send(command);
      
      if (!result.Item) {
        this.logger.debug('Cache miss', { key });
        return null;
      }

      // Check TTL
      const now = Math.floor(Date.now() / 1000);
      if (result.Item.ttl && result.Item.ttl < now) {
        this.logger.debug('Cache expired', { key });
        return null;
      }

      this.logger.debug('Cache hit', { key });
      return result.Item.data as T;
    } catch (error) {
      // Best-effort: log error but don't throw
      this.logger.warn('Cache get error (best-effort)', { 
        key,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Set cached value (best-effort, failures don't throw)
   */
  async set<T>(key: string, value: T, ttlHours?: number): Promise<void> {
    try {
      const ttl = ttlHours || this.config.ttlHours;
      const ttlSeconds = Math.floor(Date.now() / 1000) + (ttl * 60 * 60);

      const command = new PutCommand({
        TableName: this.tableName,
        Item: {
          cacheKey: key,
          data: value,
          ttl: ttlSeconds,
          createdAt: new Date().toISOString(),
        },
      });

      await this.dynamoClient.send(command);
      this.logger.debug('Cache set', { key, ttlHours: ttl });
    } catch (error) {
      // Best-effort: log error but don't throw
      this.logger.warn('Cache set error (best-effort)', { 
        key,
        error: error instanceof Error ? error.message : String(error),
      });
      // Don't throw - cache failures should not break core flows
    }
  }

  /**
   * Delete cached value (best-effort)
   */
  async delete(key: string): Promise<void> {
    try {
      const command = new DeleteCommand({
        TableName: this.tableName,
        Key: { cacheKey: key },
      });

      await this.dynamoClient.send(command);
      this.logger.debug('Cache delete', { key });
    } catch (error) {
      // Best-effort: log error but don't throw
      this.logger.warn('Cache delete error (best-effort)', { 
        key,
        error: error instanceof Error ? error.message : String(error),
      });
      // Don't throw - cache failures should not break core flows
    }
  }
}
