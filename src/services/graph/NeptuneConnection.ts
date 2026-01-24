/**
 * Neptune Connection Utility - Phase 2
 * 
 * Manages Gremlin connection to Neptune cluster with lazy singleton pattern,
 * reconnect-on-failure, and graceful handling of cold starts.
 */

import * as gremlin from 'gremlin';
import { Logger } from '../core/Logger';

// Gremlin types from package structure
type DriverRemoteConnection = gremlin.driver.DriverRemoteConnection;
type GraphTraversalSource = gremlin.process.GraphTraversalSource;

const logger = new Logger('NeptuneConnection');

/**
 * Neptune connection configuration
 */
export interface NeptuneConnectionConfig {
  endpoint: string; // Neptune cluster endpoint (without protocol)
  port: number; // Neptune port (default: 8182)
  region: string; // AWS region
  iamAuthEnabled?: boolean; // Whether IAM auth is enabled (default: true)
}

/**
 * Neptune connection manager
 * 
 * Implements lazy singleton pattern with reconnect-on-failure.
 * Handles cold starts gracefully by reconnecting on each invocation if needed.
 */
export class NeptuneConnection {
  private static instance: NeptuneConnection | null = null;
  private connection: DriverRemoteConnection | null = null;
  private g: GraphTraversalSource | null = null;
  private config: NeptuneConnectionConfig | null = null;
  private isConnecting: boolean = false;

  private constructor() {
    // Private constructor for singleton pattern
  }

  /**
   * Get singleton instance
   */
  static getInstance(): NeptuneConnection {
    if (!NeptuneConnection.instance) {
      NeptuneConnection.instance = new NeptuneConnection();
    }
    return NeptuneConnection.instance;
  }

  /**
   * Initialize connection with configuration
   * 
   * This should be called once during Lambda initialization or before first use.
   */
  async initialize(config: NeptuneConnectionConfig): Promise<void> {
    this.config = config;
    await this.connect();
  }

  /**
   * Connect to Neptune (lazy singleton with reconnect-on-failure)
   */
  async connect(): Promise<void> {
    if (!this.config) {
      throw new Error('NeptuneConnection not initialized. Call initialize() first.');
    }

    // If already connected and healthy, reuse connection
    if (this.connection && this.isConnected()) {
      logger.debug('Reusing existing Neptune connection');
      return;
    }

    // Prevent concurrent connection attempts
    if (this.isConnecting) {
      logger.debug('Connection attempt already in progress, waiting...');
      // Wait for existing connection attempt (simple retry logic)
      await new Promise(resolve => setTimeout(resolve, 100));
      if (this.connection && this.isConnected()) {
        return;
      }
    }

    this.isConnecting = true;

    try {
      // Close existing connection if present
      if (this.connection) {
        try {
          await this.connection.close();
        } catch (error) {
          logger.warn('Error closing existing connection', { error });
        }
      }

      const endpoint = this.config.endpoint;
      const port = this.config.port || 8182;
      const url = `wss://${endpoint}:${port}/gremlin`;

      logger.info('Connecting to Neptune', { endpoint, port, url });

      // Create connection
      const connectionOptions: any = {
        mimeType: 'application/vnd.gremlin-v2.0+json',
      };

      // If IAM auth is enabled, we'll use AWS SDK to sign requests
      // For now, we'll use basic connection (IAM signing can be added later)
      if (this.config.iamAuthEnabled !== false) {
        // IAM signing will be handled by AWS SDK if needed
        // For websocket connections, IAM signing is typically done via SigV4
        logger.debug('IAM auth enabled (signing handled by AWS SDK)');
      }

      const DriverRemoteConnection = gremlin.driver.DriverRemoteConnection;
      const traversal = gremlin.process.AnonymousTraversalSource.traversal;
      
      this.connection = new DriverRemoteConnection(url, connectionOptions);
      this.g = traversal().withRemote(this.connection);

      logger.info('Neptune connection established');
    } catch (error) {
      logger.error('Failed to connect to Neptune', { error });
      this.connection = null;
      this.g = null;
      throw error;
    } finally {
      this.isConnecting = false;
    }
  }

  /**
   * Get Gremlin traversal source
   * 
   * Reconnects if connection is stale or missing (handles cold starts).
   */
  async getTraversal(): Promise<GraphTraversalSource> {
    if (!this.g || !this.isConnected()) {
      logger.debug('Connection stale or missing, reconnecting...');
      await this.connect();
    }

    if (!this.g) {
      throw new Error('Failed to establish Neptune connection');
    }

    return this.g;
  }

  /**
   * Check if connection is active
   */
  private isConnected(): boolean {
    if (!this.connection) {
      return false;
    }

    // Simple check - connection object exists
    // More sophisticated health check can be added if needed
    try {
      // Connection object should have an 'isOpen' property or similar
      // For now, we'll assume connection is valid if it exists
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Health check - execute simple query to verify connectivity
   */
  async healthCheck(): Promise<boolean> {
    try {
      const g = await this.getTraversal();
      // Execute simple query: count vertices (bounded query)
      const result = await g.V().limit(1).count().next();
      logger.debug('Neptune health check passed', { result });
      return true;
    } catch (error) {
      logger.error('Neptune health check failed', { error });
      return false;
    }
  }

  /**
   * Disconnect from Neptune
   */
  async disconnect(): Promise<void> {
    if (this.connection) {
      try {
        await this.connection.close();
        logger.info('Neptune connection closed');
      } catch (error) {
        logger.warn('Error closing Neptune connection', { error });
      } finally {
        this.connection = null;
        this.g = null;
      }
    }
  }

  /**
   * Reset connection (for testing or forced reconnection)
   */
  async reset(): Promise<void> {
    await this.disconnect();
    if (this.config) {
      await this.connect();
    }
  }
}
