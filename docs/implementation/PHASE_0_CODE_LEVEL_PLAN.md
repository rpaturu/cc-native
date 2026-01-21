# Phase 0: Code-Level Implementation Plan

## Foundations (Platform Skeleton)

**Goal:** Establish tenant identity, event spine, storage, and audit so everything later is governed and traceable.

**Duration:** 2-3 weeks

---

## Implementation Order

1. **Types & Interfaces** (Day 1-2)
2. **Core Services** (Day 3-5)
3. **CDK Infrastructure** (Day 6-8)
4. **Identity & Tenancy** (Day 9-11)
5. **Event Spine** (Day 12-13)
6. **Audit Ledger** (Day 14-15)
7. **Integration Tests** (Day 16-17)

---

## 1. Types & Interfaces

### 1.1 Common Types

**File:** `src/types/CommonTypes.ts`

```typescript
/**
 * Common types used across the system
 */

export interface TraceContext {
  traceId: string;
  tenantId: string;
  accountId?: string;
  userId?: string;
  agentId?: string;
}

export interface Timestamped {
  createdAt: string;
  updatedAt: string;
}

export interface TenantScoped {
  tenantId: string;
}

export interface Traceable {
  traceId: string;
}

export type EventSource = 
  | 'connector'
  | 'perception'
  | 'decision'
  | 'tool'
  | 'action'
  | 'user'
  | 'system';

export type Severity = 'low' | 'medium' | 'high' | 'critical';

export interface EvidenceRef {
  type: 's3' | 'dynamodb' | 'neptune' | 'external';
  location: string;
  timestamp: string;
}
```

### 1.2 Event Types

**File:** `src/types/EventTypes.ts`

```typescript
import { TraceContext, EventSource, EvidenceRef } from './CommonTypes';

/**
 * Standard event envelope for all system events
 */
export interface EventEnvelope {
  traceId: string;
  tenantId: string;
  accountId?: string;
  source: EventSource;
  eventType: string;
  ts: string;
  payload: Record<string, any>;
  metadata?: {
    correlationId?: string;
    causationId?: string;
    evidenceRefs?: EvidenceRef[];
  };
}

/**
 * Event type registry
 */
export enum EventType {
  // Intent events
  INTENT_RECEIVED = 'INTENT_RECEIVED',
  INTENT_PROCESSED = 'INTENT_PROCESSED',
  
  // Signal events
  SIGNAL_GENERATED = 'SIGNAL_GENERATED',
  SIGNAL_BATCH_READY = 'SIGNAL_BATCH_READY',
  
  // Tool events
  TOOL_CALL_REQUESTED = 'TOOL_CALL_REQUESTED',
  TOOL_CALL_COMPLETED = 'TOOL_CALL_COMPLETED',
  TOOL_CALL_FAILED = 'TOOL_CALL_FAILED',
  
  // Validation events
  VALIDATION_STARTED = 'VALIDATION_STARTED',
  VALIDATION_COMPLETED = 'VALIDATION_COMPLETED',
  VALIDATION_FAILED = 'VALIDATION_FAILED',
  
  // Action events
  ACTION_PROPOSED = 'ACTION_PROPOSED',
  ACTION_APPROVED = 'ACTION_APPROVED',
  ACTION_REJECTED = 'ACTION_REJECTED',
  ACTION_EXECUTED = 'ACTION_EXECUTED',
  ACTION_FAILED = 'ACTION_FAILED',
  
  // Approval events
  APPROVAL_REQUESTED = 'APPROVAL_REQUESTED',
  APPROVAL_GRANTED = 'APPROVAL_GRANTED',
  APPROVAL_DENIED = 'APPROVAL_DENIED',
}

/**
 * Event publisher interface
 */
export interface IEventPublisher {
  publish(event: EventEnvelope): Promise<void>;
  publishBatch(events: EventEnvelope[]): Promise<void>;
}

/**
 * Event handler interface
 */
export interface IEventHandler<T = any> {
  handle(event: EventEnvelope): Promise<T>;
  canHandle(eventType: string): boolean;
}
```

### 1.3 Tenant Types

**File:** `src/types/TenantTypes.ts`

```typescript
import { Timestamped, Traceable } from './CommonTypes';

/**
 * Tenant model
 */
export interface Tenant extends Timestamped, Traceable {
  tenantId: string;
  name: string;
  status: 'active' | 'suspended' | 'inactive';
  config: TenantConfig;
  metadata?: Record<string, any>;
}

export interface TenantConfig {
  allowedActionClasses: ActionClass[];
  approvalRequiredFor: ActionClass[];
  confidenceThresholds: {
    autonomous: number;
    approval: number;
  };
  complianceConstraints?: ComplianceConstraint[];
  dataAccessBoundaries?: DataAccessBoundary[];
  escalationRules?: EscalationRule[];
}

export type ActionClass = 
  | 'internal_non_destructive'
  | 'internal_state_mutation'
  | 'external_human_touch'
  | 'clarification_escalation';

export interface ComplianceConstraint {
  type: string;
  rules: Record<string, any>;
}

export interface DataAccessBoundary {
  resource: string;
  permissions: string[];
}

export interface EscalationRule {
  condition: string;
  action: 'notify' | 'block' | 'require_approval';
  target: string;
}

/**
 * User identity
 */
export interface UserIdentity {
  userId: string;
  tenantId: string;
  email: string;
  roles: string[];
  permissions: string[];
  metadata?: Record<string, any>;
}

/**
 * Agent identity
 */
export interface AgentIdentity {
  agentId: string;
  tenantId: string;
  name: string;
  allowedTools: string[];
  permissions: string[];
  metadata?: Record<string, any>;
}
```

### 1.4 Ledger Types

**File:** `src/types/LedgerTypes.ts`

```typescript
import { Traceable, TenantScoped, EvidenceRef } from './CommonTypes';

/**
 * Ledger event types
 */
export enum LedgerEventType {
  INTENT = 'INTENT',
  SIGNAL = 'SIGNAL',
  TOOL_CALL = 'TOOL_CALL',
  VALIDATION = 'VALIDATION',
  ACTION = 'ACTION',
  APPROVAL = 'APPROVAL',
}

/**
 * Ledger entry
 */
export interface LedgerEntry extends Traceable, TenantScoped {
  entryId: string;
  eventType: LedgerEventType;
  timestamp: string;
  data: Record<string, any>;
  evidenceRefs?: EvidenceRef[];
  previousEntryId?: string; // For chain of custody
}

/**
 * Ledger query filters
 */
export interface LedgerQuery {
  tenantId: string;
  traceId?: string;
  eventType?: LedgerEventType;
  startTime?: string;
  endTime?: string;
  accountId?: string;
  limit?: number;
}

/**
 * Ledger service interface
 */
export interface ILedgerService {
  append(entry: Omit<LedgerEntry, 'entryId' | 'timestamp'>): Promise<LedgerEntry>;
  query(query: LedgerQuery): Promise<LedgerEntry[]>;
  getByTraceId(traceId: string): Promise<LedgerEntry[]>;
  getByEntryId(entryId: string): Promise<LedgerEntry | null>;
}
```

---

## 2. Core Services

### 2.1 Logger Service

**File:** `src/services/core/Logger.ts`

```typescript
import { TraceContext } from '../../types/CommonTypes';

export interface LogMeta {
  [key: string]: any;
  traceId?: string;
  tenantId?: string;
  accountId?: string;
}

export class Logger {
  private serviceName: string;
  private defaultContext?: TraceContext;

  constructor(serviceName: string, context?: TraceContext) {
    this.serviceName = serviceName;
    this.defaultContext = context;
  }

  private formatMessage(
    level: string,
    message: string,
    meta?: LogMeta
  ): string {
    const timestamp = new Date().toISOString();
    const enrichedMeta = {
      ...this.defaultContext,
      ...meta,
    };
    const metaStr = enrichedMeta ? ` ${JSON.stringify(enrichedMeta)}` : '';
    return `[${timestamp}] [${level.toUpperCase()}] [${this.serviceName}] ${message}${metaStr}`;
  }

  info(message: string, meta?: LogMeta): void {
    console.log(this.formatMessage('info', message, meta));
  }

  error(message: string, meta?: LogMeta): void {
    console.error(this.formatMessage('error', message, meta));
  }

  warn(message: string, meta?: LogMeta): void {
    console.warn(this.formatMessage('warn', message, meta));
  }

  debug(message: string, meta?: LogMeta): void {
    const logLevel = process.env.LOG_LEVEL || 'info';
    if (logLevel === 'debug') {
      console.log(this.formatMessage('debug', message, meta));
    }
  }

  setContext(context: TraceContext): void {
    this.defaultContext = context;
  }
}
```

### 2.2 Trace Service

**File:** `src/services/core/TraceService.ts`

```typescript
import { v4 as uuidv4 } from 'uuid';
import { TraceContext } from '../../types/CommonTypes';
import { Logger } from './Logger';

export class TraceService {
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /**
   * Generate a new trace ID
   */
  generateTraceId(): string {
    return `trace-${Date.now()}-${uuidv4()}`;
  }

  /**
   * Create trace context from request
   */
  createContext(
    tenantId: string,
    accountId?: string,
    userId?: string,
    agentId?: string,
    existingTraceId?: string
  ): TraceContext {
    return {
      traceId: existingTraceId || this.generateTraceId(),
      tenantId,
      accountId,
      userId,
      agentId,
    };
  }

  /**
   * Extract trace context from headers/event
   */
  extractFromHeaders(headers: Record<string, string>): TraceContext | null {
    const traceId = headers['x-trace-id'] || headers['X-Trace-Id'];
    const tenantId = headers['x-tenant-id'] || headers['X-Tenant-Id'];
    const accountId = headers['x-account-id'] || headers['X-Account-Id'];
    const userId = headers['x-user-id'] || headers['X-User-Id'];
    const agentId = headers['x-agent-id'] || headers['X-Agent-Id'];

    if (!traceId || !tenantId) {
      return null;
    }

    return {
      traceId,
      tenantId,
      accountId,
      userId,
      agentId,
    };
  }

  /**
   * Extract trace context from Lambda event
   */
  extractFromEvent(event: any): TraceContext | null {
    // Try headers first (API Gateway)
    if (event.headers) {
      return this.extractFromHeaders(event.headers);
    }

    // Try requestContext (API Gateway v2)
    if (event.requestContext) {
      const headers = event.requestContext.headers || {};
      return this.extractFromHeaders(headers);
    }

    // Try direct properties (Step Functions, EventBridge)
    if (event.traceId && event.tenantId) {
      return {
        traceId: event.traceId,
        tenantId: event.tenantId,
        accountId: event.accountId,
        userId: event.userId,
        agentId: event.agentId,
      };
    }

    return null;
  }
}
```

### 2.3 Cache Service

**File:** `src/services/core/CacheService.ts`

```typescript
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { Logger } from './Logger';

export interface CacheConfig {
  ttlHours: number;
  maxEntries?: number;
  compressionEnabled?: boolean;
}

export class CacheService {
  private readonly dynamoClient: DynamoDBDocumentClient;
  private readonly config: CacheConfig;
  private readonly logger: Logger;
  private readonly tableName: string;

  constructor(config: CacheConfig, logger: Logger, tableName: string, region?: string) {
    this.config = config;
    this.logger = logger;
    this.tableName = tableName;
    
    const client = new DynamoDBClient({ region });
    this.dynamoClient = DynamoDBDocumentClient.from(client);
  }

  /**
   * Get cached value
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
      this.logger.error('Cache get error', { 
        key,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Set cached value
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
      this.logger.error('Cache set error', { 
        key,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Delete cached value
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
      this.logger.error('Cache delete error', { 
        key,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
```

---

## 3. CDK Infrastructure

### 3.1 Main Stack

**File:** `src/stacks/AutonomousRevenueStack.ts`

```typescript
import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export interface AutonomousRevenueStackProps extends cdk.StackProps {
  // Add any custom props here
}

export class AutonomousRevenueStack extends cdk.Stack {
  // S3 Buckets
  public readonly rawSnapshotsBucket: s3.Bucket;
  public readonly artifactsBucket: s3.Bucket;
  public readonly ledgerArchivesBucket: s3.Bucket;

  // DynamoDB Tables
  public readonly accountsTable: dynamodb.Table;
  public readonly signalsTable: dynamodb.Table;
  public readonly toolRunsTable: dynamodb.Table;
  public readonly approvalRequestsTable: dynamodb.Table;
  public readonly actionQueueTable: dynamodb.Table;
  public readonly policyConfigTable: dynamodb.Table;

  // EventBridge
  public readonly eventBus: events.EventBus;

  // KMS Keys
  public readonly tenantEncryptionKey: kms.Key;

  constructor(scope: Construct, id: string, props?: AutonomousRevenueStackProps) {
    super(scope, id, props);

    // S3 Buckets
    this.rawSnapshotsBucket = new s3.Bucket(this, 'RawSnapshotsBucket', {
      bucketName: `autonomous-revenue-raw-snapshots-${this.account}-${this.region}`,
      versioned: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      lifecycleRules: [{
        id: 'DeleteOldVersions',
        noncurrentVersionExpiration: cdk.Duration.days(90),
      }],
    });

    this.artifactsBucket = new s3.Bucket(this, 'ArtifactsBucket', {
      bucketName: `autonomous-revenue-artifacts-${this.account}-${this.region}`,
      versioned: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
    });

    this.ledgerArchivesBucket = new s3.Bucket(this, 'LedgerArchivesBucket', {
      bucketName: `autonomous-revenue-ledger-archives-${this.account}-${this.region}`,
      versioned: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      objectLockEnabled: true,
      objectLockConfiguration: {
        objectLockEnabled: s3.ObjectLockEnabled.ENABLED,
        objectLockRule: {
          defaultRetention: s3.ObjectLockRetention.compliance(cdk.Duration.days(2555)), // 7 years
        },
      },
    });

    // DynamoDB Tables
    this.accountsTable = new dynamodb.Table(this, 'AccountsTable', {
      tableName: 'autonomous-revenue-accounts',
      partitionKey: { name: 'tenantId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'accountId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
    });

    this.signalsTable = new dynamodb.Table(this, 'SignalsTable', {
      tableName: 'autonomous-revenue-signals',
      partitionKey: { name: 'tenantId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'signalId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
    });

    // Add GSI for accountId queries
    this.signalsTable.addGlobalSecondaryIndex({
      indexName: 'accountId-index',
      partitionKey: { name: 'accountId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.STRING },
    });

    this.toolRunsTable = new dynamodb.Table(this, 'ToolRunsTable', {
      tableName: 'autonomous-revenue-tool-runs',
      partitionKey: { name: 'traceId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'toolRunId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
    });

    this.approvalRequestsTable = new dynamodb.Table(this, 'ApprovalRequestsTable', {
      tableName: 'autonomous-revenue-approval-requests',
      partitionKey: { name: 'tenantId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'requestId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
    });

    this.actionQueueTable = new dynamodb.Table(this, 'ActionQueueTable', {
      tableName: 'autonomous-revenue-action-queue',
      partitionKey: { name: 'tenantId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'actionId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
    });

    this.policyConfigTable = new dynamodb.Table(this, 'PolicyConfigTable', {
      tableName: 'autonomous-revenue-policy-config',
      partitionKey: { name: 'tenantId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'policyId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
    });

    // EventBridge Custom Bus
    this.eventBus = new events.EventBus(this, 'AutonomousRevenueEventBus', {
      eventBusName: 'autonomous-revenue-events',
    });

    // KMS Key for tenant encryption
    this.tenantEncryptionKey = new kms.Key(this, 'TenantEncryptionKey', {
      description: 'KMS key for tenant data encryption',
      enableKeyRotation: true,
    });

    // Stack Outputs
    new cdk.CfnOutput(this, 'RawSnapshotsBucketName', {
      value: this.rawSnapshotsBucket.bucketName,
    });

    new cdk.CfnOutput(this, 'ArtifactsBucketName', {
      value: this.artifactsBucket.bucketName,
    });

    new cdk.CfnOutput(this, 'LedgerArchivesBucketName', {
      value: this.ledgerArchivesBucket.bucketName,
    });

    new cdk.CfnOutput(this, 'EventBusName', {
      value: this.eventBus.eventBusName,
    });
  }
}
```

### 3.2 Update Infrastructure Entry Point

**File:** `infrastructure/bin/infrastructure.ts`

```typescript
#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { AutonomousRevenueStack } from '../../src/stacks/AutonomousRevenueStack';

const app = new cdk.App();

new AutonomousRevenueStack(app, 'AutonomousRevenueStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'us-west-2',
  },
});
```

---

## 4. Identity & Tenancy

### 4.1 Tenant Service

**File:** `src/services/identity/TenantService.ts`

```typescript
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { Tenant, TenantConfig } from '../../types/TenantTypes';
import { Logger } from '../core/Logger';
import { TraceService } from '../core/TraceService';
import { v4 as uuidv4 } from 'uuid';

export class TenantService {
  private dynamoClient: DynamoDBDocumentClient;
  private logger: Logger;
  private traceService: TraceService;
  private tableName: string;

  constructor(
    logger: Logger,
    traceService: TraceService,
    tableName: string,
    region?: string
  ) {
    this.logger = logger;
    this.traceService = traceService;
    this.tableName = tableName;
    
    const client = new DynamoDBClient({ region });
    this.dynamoClient = DynamoDBDocumentClient.from(client);
  }

  /**
   * Create a new tenant
   */
  async create(
    name: string,
    config: TenantConfig,
    traceId: string
  ): Promise<Tenant> {
    const tenantId = `tenant-${uuidv4()}`;
    const now = new Date().toISOString();

    const tenant: Tenant = {
      tenantId,
      name,
      status: 'active',
      config,
      traceId,
      createdAt: now,
      updatedAt: now,
    };

    try {
      const command = new PutCommand({
        TableName: this.tableName,
        Item: tenant,
      });

      await this.dynamoClient.send(command);
      this.logger.info('Tenant created', { tenantId, traceId });
      return tenant;
    } catch (error) {
      this.logger.error('Failed to create tenant', {
        tenantId,
        traceId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get tenant by ID
   */
  async get(tenantId: string): Promise<Tenant | null> {
    try {
      const command = new GetCommand({
        TableName: this.tableName,
        Key: { tenantId },
      });

      const result = await this.dynamoClient.send(command);
      
      if (!result.Item) {
        return null;
      }

      return result.Item as Tenant;
    } catch (error) {
      this.logger.error('Failed to get tenant', {
        tenantId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Update tenant config
   */
  async updateConfig(
    tenantId: string,
    config: Partial<TenantConfig>,
    traceId: string
  ): Promise<Tenant> {
    try {
      const tenant = await this.get(tenantId);
      if (!tenant) {
        throw new Error(`Tenant not found: ${tenantId}`);
      }

      const updatedConfig = { ...tenant.config, ...config };
      const updatedAt = new Date().toISOString();

      const command = new UpdateCommand({
        TableName: this.tableName,
        Key: { tenantId },
        UpdateExpression: 'SET #config = :config, #updatedAt = :updatedAt, #traceId = :traceId',
        ExpressionAttributeNames: {
          '#config': 'config',
          '#updatedAt': 'updatedAt',
          '#traceId': 'traceId',
        },
        ExpressionAttributeValues: {
          ':config': updatedConfig,
          ':updatedAt': updatedAt,
          ':traceId': traceId,
        },
        ReturnValues: 'ALL_NEW',
      });

      const result = await this.dynamoClient.send(command);
      return result.Attributes as Tenant;
    } catch (error) {
      this.logger.error('Failed to update tenant config', {
        tenantId,
        traceId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
```

### 4.2 Identity Service

**File:** `src/services/identity/IdentityService.ts`

```typescript
import { UserIdentity, AgentIdentity } from '../../types/TenantTypes';
import { Logger } from '../core/Logger';
import { TraceService } from '../core/TraceService';

export class IdentityService {
  private logger: Logger;
  private traceService: TraceService;

  constructor(logger: Logger, traceService: TraceService) {
    this.logger = logger;
    this.traceService = traceService;
  }

  /**
   * Validate user identity (placeholder for Cognito integration)
   */
  async validateUser(token: string): Promise<UserIdentity | null> {
    // TODO: Integrate with Cognito
    // For now, return mock identity
    this.logger.warn('User validation not implemented', { token });
    return null;
  }

  /**
   * Validate agent identity (placeholder for AgentCore Identity)
   */
  async validateAgent(token: string): Promise<AgentIdentity | null> {
    // TODO: Integrate with AgentCore Identity
    // For now, return mock identity
    this.logger.warn('Agent validation not implemented', { token });
    return null;
  }

  /**
   * Get tenant ID from identity
   */
  async getTenantId(identity: UserIdentity | AgentIdentity): Promise<string> {
    return identity.tenantId;
  }
}
```

---

## 5. Event Spine

### 5.1 Event Publisher

**File:** `src/services/events/EventPublisher.ts`

```typescript
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { EventEnvelope, IEventPublisher } from '../../types/EventTypes';
import { Logger } from '../core/Logger';

export class EventPublisher implements IEventPublisher {
  private eventBridgeClient: EventBridgeClient;
  private logger: Logger;
  private eventBusName: string;

  constructor(logger: Logger, eventBusName: string, region?: string) {
    this.logger = logger;
    this.eventBusName = eventBusName;
    this.eventBridgeClient = new EventBridgeClient({ region });
  }

  /**
   * Publish a single event
   */
  async publish(event: EventEnvelope): Promise<void> {
    try {
      const command = new PutEventsCommand({
        Entries: [{
          Source: event.source,
          DetailType: event.eventType,
          Detail: JSON.stringify(event),
          EventBusName: this.eventBusName,
        }],
      });

      const result = await this.eventBridgeClient.send(command);
      
      if (result.FailedEntryCount && result.FailedEntryCount > 0) {
        this.logger.error('Event publish failed', {
          traceId: event.traceId,
          eventType: event.eventType,
          failures: result.Entries?.filter(e => e.ErrorMessage),
        });
        throw new Error('Failed to publish event');
      }

      this.logger.debug('Event published', {
        traceId: event.traceId,
        eventType: event.eventType,
      });
    } catch (error) {
      this.logger.error('Event publish error', {
        traceId: event.traceId,
        eventType: event.eventType,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Publish multiple events (batch)
   */
  async publishBatch(events: EventEnvelope[]): Promise<void> {
    try {
      const command = new PutEventsCommand({
        Entries: events.map(event => ({
          Source: event.source,
          DetailType: event.eventType,
          Detail: JSON.stringify(event),
          EventBusName: this.eventBusName,
        })),
      });

      const result = await this.eventBridgeClient.send(command);
      
      if (result.FailedEntryCount && result.FailedEntryCount > 0) {
        this.logger.error('Event batch publish failed', {
          failedCount: result.FailedEntryCount,
          failures: result.Entries?.filter(e => e.ErrorMessage),
        });
        throw new Error(`Failed to publish ${result.FailedEntryCount} events`);
      }

      this.logger.debug('Events published', {
        count: events.length,
      });
    } catch (error) {
      this.logger.error('Event batch publish error', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
```

### 5.2 Event Router

**File:** `src/services/events/EventRouter.ts`

```typescript
import { EventEnvelope, IEventHandler } from '../../types/EventTypes';
import { Logger } from '../core/Logger';

export class EventRouter {
  private handlers: Map<string, IEventHandler[]> = new Map();
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /**
   * Register an event handler
   */
  register(eventType: string, handler: IEventHandler): void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, []);
    }
    this.handlers.get(eventType)!.push(handler);
  }

  /**
   * Route an event to appropriate handlers
   */
  async route(event: EventEnvelope): Promise<void> {
    const handlers = this.handlers.get(event.eventType) || [];
    
    if (handlers.length === 0) {
      this.logger.warn('No handlers for event type', {
        eventType: event.eventType,
        traceId: event.traceId,
      });
      return;
    }

    const results = await Promise.allSettled(
      handlers.map(handler => handler.handle(event))
    );

    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        this.logger.error('Event handler failed', {
          eventType: event.eventType,
          traceId: event.traceId,
          handlerIndex: index,
          error: result.reason,
        });
      }
    });
  }
}
```

---

## 6. Audit Ledger

### 6.1 Ledger Service (DynamoDB Implementation)

**File:** `src/services/ledger/LedgerService.ts`

```typescript
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { LedgerEntry, LedgerQuery, ILedgerService, LedgerEventType } from '../../types/LedgerTypes';
import { Logger } from '../core/Logger';
import { v4 as uuidv4 } from 'uuid';

export class LedgerService implements ILedgerService {
  private dynamoClient: DynamoDBDocumentClient;
  private logger: Logger;
  private tableName: string;
  private s3BucketName: string;

  constructor(
    logger: Logger,
    tableName: string,
    s3BucketName: string,
    region?: string
  ) {
    this.logger = logger;
    this.tableName = tableName;
    this.s3BucketName = s3BucketName;
    
    const client = new DynamoDBClient({ region });
    this.dynamoClient = DynamoDBDocumentClient.from(client);
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
          // Composite key: tenantId + timestamp for querying
          pk: `TENANT#${entry.tenantId}`,
          sk: `ENTRY#${timestamp}#${entryId}`,
          // GSI for traceId queries
          gsi1pk: `TRACE#${entry.traceId}`,
          gsi1sk: timestamp,
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
      const command = new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'pk = :pk',
        ExpressionAttributeValues: {
          ':pk': `TENANT#${query.tenantId}`,
        },
        ...(query.startTime && query.endTime && {
          FilterExpression: '#ts BETWEEN :start AND :end',
          ExpressionAttributeNames: {
            '#ts': 'timestamp',
          },
          ExpressionAttributeValues: {
            ':pk': `TENANT#${query.tenantId}`,
            ':start': query.startTime,
            ':end': query.endTime,
          },
        }),
        ...(query.eventType && {
          FilterExpression: 'eventType = :eventType',
          ExpressionAttributeValues: {
            ':pk': `TENANT#${query.tenantId}`,
            ':eventType': query.eventType,
          },
        }),
        Limit: query.limit || 100,
        ScanIndexForward: false, // Most recent first
      });

      const result = await this.dynamoClient.send(command);
      return (result.Items || []) as LedgerEntry[];
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
    try {
      const command = new QueryCommand({
        TableName: this.tableName,
        IndexName: 'gsi1-index',
        KeyConditionExpression: 'gsi1pk = :pk',
        ExpressionAttributeValues: {
          ':pk': `TRACE#${traceId}`,
        },
        ScanIndexForward: true, // Chronological order
      });

      const result = await this.dynamoClient.send(command);
      return (result.Items || []) as LedgerEntry[];
    } catch (error) {
      this.logger.error('Failed to get ledger entries by trace ID', {
        traceId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get entry by entry ID
   */
  async getByEntryId(entryId: string): Promise<LedgerEntry | null> {
    // This requires a scan or secondary index
    // For now, return null - implement if needed
    this.logger.warn('getByEntryId not implemented', { entryId });
    return null;
  }
}
```

---

## 7. Testing

### 7.1 Unit Tests Structure

```
src/
├── services/
│   ├── core/
│   │   ├── Logger.test.ts
│   │   ├── TraceService.test.ts
│   │   └── CacheService.test.ts
│   ├── identity/
│   │   ├── TenantService.test.ts
│   │   └── IdentityService.test.ts
│   ├── events/
│   │   ├── EventPublisher.test.ts
│   │   └── EventRouter.test.ts
│   └── ledger/
│       └── LedgerService.test.ts
```

### 7.2 Integration Test

**File:** `src/tests/integration/Phase0Integration.test.ts`

```typescript
import { TenantService } from '../../services/identity/TenantService';
import { EventPublisher } from '../../services/events/EventPublisher';
import { LedgerService } from '../../services/ledger/LedgerService';
import { Logger } from '../../services/core/Logger';
import { TraceService } from '../../services/core/TraceService';
import { EventType } from '../../types/EventTypes';
import { LedgerEventType } from '../../types/LedgerTypes';

describe('Phase 0 Integration Test', () => {
  it('should create tenant → emit event → verify ledger entry', async () => {
    // Setup
    const logger = new Logger('IntegrationTest');
    const traceService = new TraceService(logger);
    const traceId = traceService.generateTraceId();
    
    // Create tenant
    const tenantService = new TenantService(/* ... */);
    const tenant = await tenantService.create(
      'Test Tenant',
      { /* default config */ },
      traceId
    );

    // Emit event
    const eventPublisher = new EventPublisher(/* ... */);
    await eventPublisher.publish({
      traceId,
      tenantId: tenant.tenantId,
      source: 'system',
      eventType: EventType.INTENT_RECEIVED,
      ts: new Date().toISOString(),
      payload: { test: true },
    });

    // Verify ledger entry
    const ledgerService = new LedgerService(/* ... */);
    const entries = await ledgerService.getByTraceId(traceId);
    
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0].eventType).toBe(LedgerEventType.INTENT);
    expect(entries[0].tenantId).toBe(tenant.tenantId);
  });
});
```

---

## 8. Implementation Checklist

### Week 1: Types & Core Services
- [ ] Day 1: Create all type files
- [ ] Day 2: Implement Logger, TraceService, CacheService
- [ ] Day 3: Unit tests for core services

### Week 2: Infrastructure & Identity
- [ ] Day 4-5: CDK stack implementation
- [ ] Day 6: Deploy and verify infrastructure
- [ ] Day 7-8: TenantService and IdentityService
- [ ] Day 9: Unit tests for identity services

### Week 3: Events & Ledger
- [ ] Day 10-11: EventPublisher and EventRouter
- [ ] Day 12-13: LedgerService implementation
- [ ] Day 14: Integration test
- [ ] Day 15: Documentation and code review

---

## 9. Environment Variables

Create `.env.local` template:

```bash
# AWS Configuration
AWS_REGION=us-west-2
AWS_PROFILE=default

# DynamoDB Tables (from CDK outputs)
ACCOUNTS_TABLE_NAME=autonomous-revenue-accounts
SIGNALS_TABLE_NAME=autonomous-revenue-signals
TOOL_RUNS_TABLE_NAME=autonomous-revenue-tool-runs
APPROVAL_REQUESTS_TABLE_NAME=autonomous-revenue-approval-requests
ACTION_QUEUE_TABLE_NAME=autonomous-revenue-action-queue
POLICY_CONFIG_TABLE_NAME=autonomous-revenue-policy-config

# S3 Buckets (from CDK outputs)
RAW_SNAPSHOTS_BUCKET=autonomous-revenue-raw-snapshots-...
ARTIFACTS_BUCKET=autonomous-revenue-artifacts-...
LEDGER_ARCHIVES_BUCKET=autonomous-revenue-ledger-archives-...

# EventBridge
EVENT_BUS_NAME=autonomous-revenue-events

# Logging
LOG_LEVEL=info
```

---

## 10. Next Steps After Phase 0

Once Phase 0 is complete:
1. Verify all Definition of Done criteria met
2. Run full integration test suite
3. Document API contracts
4. Begin Phase 1: Perception V1

---

## Notes

- **Single Intent Files**: Each file has one clear purpose
- **No Circular References**: Maintain clean dependency graph
- **No Inline Imports**: All imports at top
- **File Size <500 Lines**: Keep code maintainable
- **Incremental Development**: Build, test, commit frequently
