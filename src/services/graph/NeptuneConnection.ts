/**
 * Neptune Connection Utility - Phase 2
 * 
 * Manages Gremlin connection to Neptune cluster with lazy singleton pattern,
 * reconnect-on-failure, and graceful handling of cold starts.
 */

import * as gremlin from 'gremlin';
import { Logger } from '../core/Logger';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import { SignatureV4 } from '@aws-sdk/signature-v4';
import { Sha256 } from '@aws-crypto/sha256-js';
import { loadConfig } from '@smithy/node-config-provider';
import { NODE_REGION_CONFIG_FILE_OPTIONS, NODE_REGION_CONFIG_OPTIONS } from '@smithy/config-resolver';

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

      logger.info('Connecting to Neptune', { endpoint, port, iamAuthEnabled: this.config.iamAuthEnabled !== false });

      const traversal = gremlin.process.AnonymousTraversalSource.traversal;
      const DriverRemoteConnection = gremlin.driver.DriverRemoteConnection;

      // Use IAM authentication if enabled (default: true)
      if (this.config.iamAuthEnabled !== false) {
        logger.debug('Using IAM authentication for Neptune (custom AWS SDK v3 SigV4)');
        
        // Get credentials using AWS SDK v3 credential provider chain
        // This works with our Jest mock on EC2 (uses IAM role via instance metadata)
        let credentials;
        try {
          credentials = await fromNodeProviderChain()();
          logger.info('Retrieved credentials', { 
            hasAccessKeyId: !!credentials.accessKeyId,
            hasSecretAccessKey: !!credentials.secretAccessKey,
            hasSessionToken: !!credentials.sessionToken,
            credentialKeys: Object.keys(credentials)
          });
        } catch (error) {
          logger.error('Failed to get AWS credentials', { error });
          throw new Error('Failed to get AWS credentials for Neptune IAM authentication');
        }
        
        // Get region from config or use default
        let region = this.config.region;
        try {
          region = await loadConfig(NODE_REGION_CONFIG_OPTIONS, NODE_REGION_CONFIG_FILE_OPTIONS)() || this.config.region;
        } catch (e) {
          // Use configured region if config loading fails
          region = this.config.region;
        }
        
        // Custom SigV4 signing for Neptune WebSocket using AWS SDK v3
        logger.debug('Creating SigV4 signer', { endpoint, port, region });
        
        const signer = new SignatureV4({
          service: 'neptune-db',
          region,
          credentials,
          sha256: Sha256,
        });

        // Generate WebSocket upgrade request headers
        // sec-websocket-key must be a base64-encoded 16-byte random value (RFC 6455)
        const now = new Date();
        const randomBytes = Buffer.allocUnsafe(16);
        for (let i = 0; i < 16; i++) {
          randomBytes[i] = Math.floor(Math.random() * 256);
        }
        const secWebSocketKey = randomBytes.toString('base64');
        
        // Sign the WebSocket upgrade request
        const signedRequest = await signer.sign({
          method: 'GET',
          hostname: endpoint,
          port,
          path: '/gremlin',
          protocol: 'wss:',
          headers: {
            'host': `${endpoint}:${port}`,
            'upgrade': 'websocket',
            'connection': 'upgrade',
            'sec-websocket-key': secWebSocketKey,
            'sec-websocket-version': '13',
            'sec-websocket-protocol': 'graphson-v2.0, graphson-v1.0'
          },
          query: {}
        }, { signingDate: now });

        logger.debug('SigV4 signing succeeded', { 
          hasHeaders: !!signedRequest.headers,
          headerCount: Object.keys(signedRequest.headers || {}).length
        });

        // Create connection with signed headers
        const url = `wss://${endpoint}:${port}/gremlin`;
        const connectionOptions: any = {
          mimeType: 'application/vnd.gremlin-v2.0+json',
          headers: signedRequest.headers,
        };
        
        this.connection = new DriverRemoteConnection(url, connectionOptions);
      } else {
        logger.debug('Using basic connection (IAM auth disabled)');
        
        // Fallback to standard connection without IAM auth
        const url = `wss://${endpoint}:${port}/gremlin`;
        const connectionOptions: any = {
          mimeType: 'application/vnd.gremlin-v2.0+json',
        };
        
        this.connection = new DriverRemoteConnection(url, connectionOptions);
      }
      
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
