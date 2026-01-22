# Phase 0: Code-Level Implementation Plan

## Foundations (Platform Skeleton)

**Goal:** Establish tenant identity, event spine, storage, and audit so everything later is governed and traceable.

**Duration:** 2-3 weeks

---

## Implementation Order

1. **Types & Interfaces** (Day 1-2)
2. **Core Services** (Day 3-5)
3. **CDK Infrastructure** (Day 6-8)
4. **Identity & Tenancy** (Day 9-10)
5. **Event Spine** (Day 11-12)
6. **World Model Foundation** (Day 13-16)
   - Evidence Service
   - World State Service
   - Snapshot Service
   - Schema Registry Service
7. **Audit Ledger** (Day 17-18)
8. **Integration Tests** (Day 19-20)

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

/**
 * Provenance Trust Classes (from World Model Contract)
 */
export type TrustClass = 
  | 'PRIMARY'          // Direct system of record (confidence multiplier: 1.0)
  | 'VERIFIED'        // Verified by multiple sources (confidence multiplier: 0.95)
  | 'DERIVED'         // Computed from primary sources (confidence multiplier: 0.85)
  | 'AGENT_INFERENCE' // Agent-generated inference (confidence multiplier: 0.60, max Tier C)
  | 'UNTRUSTED';      // Unverified sources (confidence multiplier: 0.30, Tier D only)

/**
 * Autonomy Tiers (from Agent Read Policy)
 */
export type AutonomyTier = 'TIER_A' | 'TIER_B' | 'TIER_C' | 'TIER_D';
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

[Existing LedgerTypes content...]

### 1.5 Evidence Types

**File:** `src/types/EvidenceTypes.ts`

[See Section 6.1 for full implementation]

### 1.6 World State Types

**File:** `src/types/WorldStateTypes.ts`

[See Section 6.2 for full implementation]

### 1.7 Snapshot Types

**File:** `src/types/SnapshotTypes.ts`

[See Section 6.3 for full implementation]

### 1.8 Schema Types

**File:** `src/types/SchemaTypes.ts`

[See Section 6.4 for full implementation]

---

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

**Note:** For Node.js 18+, consider using `AsyncLocalStorage` for implicit trace propagation to reduce manual context passing.

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
    // Normalize header keys to lowercase for case-insensitive lookup
    // API Gateway and ALB may normalize headers differently
    const normalizedHeaders: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
      normalizedHeaders[key.toLowerCase()] = value;
    }

    const traceId = normalizedHeaders['x-trace-id'];
    const tenantId = normalizedHeaders['x-tenant-id'];
    const accountId = normalizedHeaders['x-account-id'];
    const userId = normalizedHeaders['x-user-id'];
    const agentId = normalizedHeaders['x-agent-id'];

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

**File:** `src/stacks/CCNativeStack.ts`

```typescript
import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export interface CCNativeStackProps extends cdk.StackProps {
  // Add any custom props here
}

export class CCNativeStack extends cdk.Stack {
  // S3 Buckets (World Model Architecture: S3 as Truth)
  public readonly evidenceLedgerBucket: s3.Bucket;        // Immutable evidence (Object Lock)
  public readonly worldStateSnapshotsBucket: s3.Bucket;   // Immutable snapshots (Object Lock)
  public readonly schemaRegistryBucket: s3.Bucket;       // Schema definitions (Object Lock)
  public readonly artifactsBucket: s3.Bucket;             // Artifacts (versioned)
  public readonly ledgerArchivesBucket: s3.Bucket;        // Execution ledger archives (Object Lock)

  // DynamoDB Tables (World Model Architecture: DynamoDB as Belief)
  // World Model Tables
  public readonly worldStateTable: dynamodb.Table;        // Computed entity state
  public readonly evidenceIndexTable: dynamodb.Table;     // Evidence index (points to S3)
  public readonly snapshotsIndexTable: dynamodb.Table;    // Snapshot index (points to S3)
  public readonly schemaRegistryTable: dynamodb.Table;    // Schema registry index
  public readonly criticalFieldRegistryTable: dynamodb.Table; // Critical field registry
  
  // Application Tables
  public readonly accountsTable: dynamodb.Table;
  public readonly signalsTable: dynamodb.Table;
  public readonly toolRunsTable: dynamodb.Table;
  public readonly approvalRequestsTable: dynamodb.Table;
  public readonly actionQueueTable: dynamodb.Table;
  public readonly policyConfigTable: dynamodb.Table;
  public readonly ledgerTable: dynamodb.Table;
  public readonly cacheTable: dynamodb.Table;
  public readonly tenantsTable: dynamodb.Table;

  // EventBridge
  public readonly eventBus: events.EventBus;

  // KMS Keys
  public readonly tenantEncryptionKey: kms.Key;

  constructor(scope: Construct, id: string, props?: CCNativeStackProps) {
    super(scope, id, props);

    // S3 Buckets (World Model: S3 as Immutable Truth)
    // Support using existing buckets from .env.local (via context) or create new ones
    
    // Evidence Ledger Bucket
    const evidenceLedgerBucketName = this.node.tryGetContext('evidenceLedgerBucket') as string | undefined;
    const evidenceLedgerBucketNameFinal = evidenceLedgerBucketName || 
      `cc-native-evidence-ledger-${this.account}-${this.region}`;
    
    if (evidenceLedgerBucketName) {
      // Use existing bucket
      this.evidenceLedgerBucket = s3.Bucket.fromBucketName(this, 'EvidenceLedgerBucket', evidenceLedgerBucketName);
    } else {
      // Create new bucket
      this.evidenceLedgerBucket = new s3.Bucket(this, 'EvidenceLedgerBucket', {
        bucketName: evidenceLedgerBucketNameFinal,
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
    }

    // World State Snapshots (immutable snapshots)
    const worldStateSnapshotsBucketName = this.node.tryGetContext('worldStateSnapshotsBucket') as string | undefined;
    const worldStateSnapshotsBucketNameFinal = worldStateSnapshotsBucketName || 
      `cc-native-world-state-snapshots-${this.account}-${this.region}`;
    
    if (worldStateSnapshotsBucketName) {
      this.worldStateSnapshotsBucket = s3.Bucket.fromBucketName(this, 'WorldStateSnapshotsBucket', worldStateSnapshotsBucketName);
    } else {
      this.worldStateSnapshotsBucket = new s3.Bucket(this, 'WorldStateSnapshotsBucket', {
        bucketName: worldStateSnapshotsBucketNameFinal,
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
    }

    // Schema Registry (immutable schema definitions)
    const schemaRegistryBucketName = this.node.tryGetContext('schemaRegistryBucket') as string | undefined;
    const schemaRegistryBucketNameFinal = schemaRegistryBucketName || 
      `cc-native-schema-registry-${this.account}-${this.region}`;
    
    if (schemaRegistryBucketName) {
      this.schemaRegistryBucket = s3.Bucket.fromBucketName(this, 'SchemaRegistryBucket', schemaRegistryBucketName);
    } else {
      this.schemaRegistryBucket = new s3.Bucket(this, 'SchemaRegistryBucket', {
        bucketName: schemaRegistryBucketNameFinal,
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
    }

    // Artifacts (versioned, no Object Lock)
    const artifactsBucketName = this.node.tryGetContext('artifactsBucket') as string | undefined;
    const artifactsBucketNameFinal = artifactsBucketName || 
      `cc-native-artifacts-${this.account}-${this.region}`;
    
    if (artifactsBucketName) {
      this.artifactsBucket = s3.Bucket.fromBucketName(this, 'ArtifactsBucket', artifactsBucketName);
    } else {
      this.artifactsBucket = new s3.Bucket(this, 'ArtifactsBucket', {
        bucketName: artifactsBucketNameFinal,
        versioned: true,
        encryption: s3.BucketEncryption.S3_MANAGED,
      });
    }

    // Execution Ledger Archives (immutable execution ledger)
    const ledgerArchivesBucketName = this.node.tryGetContext('ledgerArchivesBucket') as string | undefined;
    const ledgerArchivesBucketNameFinal = ledgerArchivesBucketName || 
      `cc-native-ledger-archives-${this.account}-${this.region}`;
    
    if (ledgerArchivesBucketName) {
      this.ledgerArchivesBucket = s3.Bucket.fromBucketName(this, 'LedgerArchivesBucket', ledgerArchivesBucketName);
    } else {
      this.ledgerArchivesBucket = new s3.Bucket(this, 'LedgerArchivesBucket', {
        bucketName: ledgerArchivesBucketNameFinal,
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
    }

    // DynamoDB Tables (World Model: DynamoDB as Computed Belief)
    
    // World State Table (computed entity state)
    this.worldStateTable = new dynamodb.Table(this, 'WorldStateTable', {
      tableName: 'cc-native-world-state',
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
    });

    // Add GSI for entity type queries
    this.worldStateTable.addGlobalSecondaryIndex({
      indexName: 'entityType-index',
      partitionKey: { name: 'gsi1pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'gsi1sk', type: dynamodb.AttributeType.STRING },
    });

    // Evidence Index Table (points to S3 evidence)
    this.evidenceIndexTable = new dynamodb.Table(this, 'EvidenceIndexTable', {
      tableName: 'cc-native-evidence-index',
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
    });

    // Add GSI for entity type + timestamp queries
    this.evidenceIndexTable.addGlobalSecondaryIndex({
      indexName: 'entityType-index',
      partitionKey: { name: 'gsi1pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'gsi1sk', type: dynamodb.AttributeType.STRING },
    });

    // Snapshots Index Table (points to S3 snapshots)
    this.snapshotsIndexTable = new dynamodb.Table(this, 'SnapshotsIndexTable', {
      tableName: 'cc-native-snapshots-index',
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
    });

    // Add GSI for entity type + timestamp queries
    this.snapshotsIndexTable.addGlobalSecondaryIndex({
      indexName: 'entityType-index',
      partitionKey: { name: 'gsi1pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'gsi1sk', type: dynamodb.AttributeType.STRING },
    });

    // Schema Registry Table (schema index)
    this.schemaRegistryTable = new dynamodb.Table(this, 'SchemaRegistryTable', {
      tableName: 'cc-native-schema-registry',
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
    });

    // Critical Field Registry Table
    this.criticalFieldRegistryTable = new dynamodb.Table(this, 'CriticalFieldRegistryTable', {
      tableName: 'cc-native-critical-field-registry',
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
    });

    // Application Tables
    this.accountsTable = new dynamodb.Table(this, 'AccountsTable', {
      tableName: 'cc-native-accounts',
      partitionKey: { name: 'tenantId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'accountId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
    });

    this.signalsTable = new dynamodb.Table(this, 'SignalsTable', {
      tableName: 'cc-native-signals',
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
      tableName: 'cc-native-tool-runs',
      partitionKey: { name: 'traceId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'toolRunId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
    });

    this.approvalRequestsTable = new dynamodb.Table(this, 'ApprovalRequestsTable', {
      tableName: 'cc-native-approval-requests',
      partitionKey: { name: 'tenantId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'requestId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
    });

    this.actionQueueTable = new dynamodb.Table(this, 'ActionQueueTable', {
      tableName: 'cc-native-action-queue',
      partitionKey: { name: 'tenantId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'actionId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
    });

    this.policyConfigTable = new dynamodb.Table(this, 'PolicyConfigTable', {
      tableName: 'cc-native-policy-config',
      partitionKey: { name: 'tenantId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'policyId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
    });

    // Ledger Table (append-only audit trail)
    this.ledgerTable = new dynamodb.Table(this, 'LedgerTable', {
      tableName: 'cc-native-ledger',
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
    });

    // Add GSI for traceId queries
    this.ledgerTable.addGlobalSecondaryIndex({
      indexName: 'gsi1-index',
      partitionKey: { name: 'gsi1pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'gsi1sk', type: dynamodb.AttributeType.STRING },
    });

    // Add GSI for time-range queries (tenant + timestamp)
    this.ledgerTable.addGlobalSecondaryIndex({
      indexName: 'gsi2-index',
      partitionKey: { name: 'gsi2pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'gsi2sk', type: dynamodb.AttributeType.STRING },
    });

    // Cache Table (TTL-based cache)
    this.cacheTable = new dynamodb.Table(this, 'CacheTable', {
      tableName: 'cc-native-cache',
      partitionKey: { name: 'cacheKey', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      pointInTimeRecovery: false, // Cache doesn't need PITR
    });

    // Tenants Table (tenant configuration and metadata)
    this.tenantsTable = new dynamodb.Table(this, 'TenantsTable', {
      tableName: 'cc-native-tenants',
      partitionKey: { name: 'tenantId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
    });

    // EventBridge Custom Bus
    this.eventBus = new events.EventBus(this, 'CCNativeEventBus', {
      eventBusName: 'cc-native-events',
    });

    // KMS Key for tenant encryption
    this.tenantEncryptionKey = new kms.Key(this, 'TenantEncryptionKey', {
      description: 'KMS key for tenant data encryption',
      enableKeyRotation: true,
    });

    // Stack Outputs
    // World Model S3 Buckets (use stored bucket name variables)
    new cdk.CfnOutput(this, 'EvidenceLedgerBucketName', {
      value: evidenceLedgerBucketNameFinal,
    });

    new cdk.CfnOutput(this, 'WorldStateSnapshotsBucketName', {
      value: worldStateSnapshotsBucketNameFinal,
    });

    new cdk.CfnOutput(this, 'SchemaRegistryBucketName', {
      value: schemaRegistryBucketNameFinal,
    });

    // Application S3 Buckets
    new cdk.CfnOutput(this, 'ArtifactsBucketName', {
      value: artifactsBucketNameFinal,
    });

    new cdk.CfnOutput(this, 'LedgerArchivesBucketName', {
      value: ledgerArchivesBucketNameFinal,
    });

    // EventBridge
    new cdk.CfnOutput(this, 'EventBusName', {
      value: this.eventBus.eventBusName,
    });

    // World Model DynamoDB Tables
    new cdk.CfnOutput(this, 'WorldStateTableName', {
      value: this.worldStateTable.tableName,
    });

    new cdk.CfnOutput(this, 'EvidenceIndexTableName', {
      value: this.evidenceIndexTable.tableName,
    });

    new cdk.CfnOutput(this, 'SnapshotsIndexTableName', {
      value: this.snapshotsIndexTable.tableName,
    });

    new cdk.CfnOutput(this, 'SchemaRegistryTableName', {
      value: this.schemaRegistryTable.tableName,
    });

    new cdk.CfnOutput(this, 'CriticalFieldRegistryTableName', {
      value: this.criticalFieldRegistryTable.tableName,
    });

    // Application DynamoDB Tables
    new cdk.CfnOutput(this, 'LedgerTableName', {
      value: this.ledgerTable.tableName,
    });

    new cdk.CfnOutput(this, 'CacheTableName', {
      value: this.cacheTable.tableName,
    });

    new cdk.CfnOutput(this, 'TenantsTableName', {
      value: this.tenantsTable.tableName,
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
import { CCNativeStack } from '../../src/stacks/CCNativeStack';

const app = new cdk.App();

new CCNativeStack(app, 'CCNativeStack', {
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
   * 
   * EventBridge Source is namespaced as 'cc-native.{source}' for routing and auditability.
   */
  async publish(event: EventEnvelope): Promise<void> {
    try {
      const namespacedSource = `cc-native.${event.source}`;
      
      const command = new PutEventsCommand({
        Entries: [{
          Source: namespacedSource,
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
          Source: `cc-native.${event.source}`, // Namespace source for consistency
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
import { ILedgerService } from '../../types/LedgerTypes';
import { Logger } from '../core/Logger';

export class EventRouter {
  private handlers: Map<string, IEventHandler[]> = new Map();
  private logger: Logger;
  private ledgerService?: ILedgerService; // Optional for idempotency checks

  constructor(logger: Logger, ledgerService?: ILedgerService) {
    this.logger = logger;
    this.ledgerService = ledgerService;
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
   * Route an event to appropriate handlers (with idempotency)
   * 
   * EventBridge is at-least-once delivery. This method ensures handlers
   * are idempotent by checking ledger for prior execution.
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

    // Check idempotency if ledger service available
    if (this.ledgerService) {
      const existingEntries = await this.ledgerService.getByTraceId(event.traceId);
      const alreadyProcessed = existingEntries.some(
        entry => entry.eventType === `EVENT_ROUTED_${event.eventType}`
      );
      
      if (alreadyProcessed) {
        this.logger.debug('Event already processed, skipping', {
          eventType: event.eventType,
          traceId: event.traceId,
        });
        return;
      }
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

    // Log event routing completion for idempotency
    if (this.ledgerService) {
      await this.ledgerService.append({
        traceId: event.traceId,
        tenantId: event.tenantId,
        accountId: event.accountId,
        eventType: `EVENT_ROUTED_${event.eventType}`,
        payload: {
          eventType: event.eventType,
          handlerCount: handlers.length,
          results: results.map(r => r.status),
        },
      });
    }
  }
}
```

---

## 6. World Model Foundation

### 6.1 Evidence Types

**File:** `src/types/EvidenceTypes.ts`

```typescript
import { TrustClass } from './CommonTypes';

/**
 * Evidence source types
 */
export type EvidenceSource = 
  | 'crm'
  | 'scrape'
  | 'transcript'
  | 'agent_inference'
  | 'user_input'
  | 'telemetry'
  | 'support'
  | 'external';

/**
 * Evidence record (immutable, stored in S3)
 */
export interface Evidence {
  evidenceId: string;
  entityId: string;
  entityType: string;
  source: EvidenceSource;
  timestamp: string;
  payload: Record<string, any>;
  provenance: {
    trustClass: TrustClass;
    sourceSystem: string;
    extractedBy?: string;
    verified?: boolean;
  };
  metadata: {
    traceId: string;
    tenantId: string;
    accountId?: string;
  };
}

/**
 * Evidence index record (DynamoDB)
 */
export interface EvidenceIndex {
  pk: string;                    // "ENTITY#{entityId}"
  sk: string;                    // "EVIDENCE#{timestamp}#{evidenceId}"
  evidenceId: string;
  entityId: string;
  entityType: string;
  timestamp: string;
  s3Key: string;                 // S3 location of evidence
  source: EvidenceSource;
  trustClass: TrustClass;
  gsi1pk: string;                // "ENTITY_TYPE#{entityType}"
  gsi1sk: string;                // timestamp
}
```

### 6.2 World State Types

**File:** `src/types/WorldStateTypes.ts`

```typescript
import { TrustClass } from './CommonTypes';

/**
 * Field-level state with confidence
 */
export interface FieldState {
  value: any;
  confidence: number;            // [0, 1]
  freshness: number;             // Hours since last update
  contradiction: number;         // [0, 1]
  provenanceTrust: TrustClass;
  lastUpdated: string;
  evidenceRefs: string[];        // Evidence IDs
}

/**
 * Entity state (computed from evidence)
 */
export interface EntityState {
  entityId: string;
  entityType: string;
  fields: Record<string, FieldState>;
  computedAt: string;
  version: string;               // Schema version used
}

/**
 * World state record (DynamoDB)
 */
export interface WorldStateRecord {
  pk: string;                    // "ENTITY#{entityId}"
  sk: string;                    // "STATE#{computedAt}"
  entityId: string;
  entityType: string;
  state: EntityState;
  gsi1pk: string;                // "ENTITY_TYPE#{entityType}"
  gsi1sk: string;                // computedAt
}
```

### 6.3 Snapshot Types

**File:** `src/types/SnapshotTypes.ts`

```typescript
import { EntityState, FieldState } from './WorldStateTypes';
import { TrustClass, AutonomyTier } from './CommonTypes';

/**
 * World snapshot (immutable, stored in S3)
 */
export interface WorldSnapshot {
  snapshotId: string;
  entityId: string;
  entityType: string;
  version: string;               // Schema version
  timestamp: string;
  asOf: string;
  
  state: {
    [fieldName: string]: FieldState;
  };
  
  metadata: {
    snapshotVersion: string;
    criticalFields: string[];
    registryVersion: string;
    computedAt: string;
    computedBy: string;
  };
  
  audit: {
    createdBy: string;
    purpose: string;
    decisionContext?: string;
  };
}

/**
 * Snapshot index record (DynamoDB)
 */
export interface SnapshotIndex {
  pk: string;                    // "ENTITY#{entityId}"
  sk: string;                    // "SNAPSHOT#{timestamp}#{snapshotId}"
  snapshotId: string;
  entityId: string;
  entityType: string;
  timestamp: string;
  s3Key: string;                 // S3 location of snapshot
  version: string;
  gsi1pk: string;                // "ENTITY_TYPE#{entityType}"
  gsi1sk: string;                // timestamp
}
```

### 6.4 Schema Types

**File:** `src/types/SchemaTypes.ts`

```typescript
/**
 * Schema field definition
 */
export interface SchemaField {
  fieldName: string;
  fieldType: 'string' | 'number' | 'boolean' | 'date' | 'timestamp' | 'object' | 'array';
  isRequired: boolean;
  isCritical: boolean;
  description?: string;
  minValue?: number;
  maxValue?: number;
  pattern?: string;
  enum?: any[];
  defaultValue?: any;
}

/**
 * Field override (from critical field registry)
 */
export interface FieldOverride {
  fieldName: string;
  minConfidence?: number;
  maxFreshnessHours?: number;
  provenanceCaps?: TrustClass[];
  ttl?: number;
}

/**
 * Schema definition
 */
export interface SchemaDefinition {
  entityType: string;
  version: string;
  schemaHash: string;
  publishedAt: string;
  fields: SchemaField[];
  criticalFields: string[];
  requiredFields: string[];
  fieldOverrides: Record<string, FieldOverride>;
}

/**
 * Schema registry record (DynamoDB)
 */
export interface SchemaRegistryRecord {
  pk: string;                    // "SCHEMA#{entityType}"
  sk: string;                    // "VERSION#{version}#{hash}"
  entityType: string;
  version: string;
  schemaHash: string;
  s3Bucket: string;
  s3Key: string;
  fields: SchemaField[];
  criticalFields: string[];
  requiredFields: string[];
  fieldOverrides: Record<string, FieldOverride>;
  status: 'active' | 'deprecated' | 'archived';
  isDefault: boolean;
  publishedAt: string;
  publishedBy: string;
}

/**
 * Critical field registry record (DynamoDB)
 */
export interface CriticalFieldRecord {
  pk: string;                    // entityType
  sk: string;                    // fieldName
  entityType: string;
  fieldName: string;
  isCritical: boolean;
  minConfidence?: number;
  maxFreshnessHours?: number;
  provenanceCaps?: TrustClass[];
  ttl?: number;
  version: string;
}
```

### 6.5 Evidence Service

**File:** `src/services/world-model/EvidenceService.ts`

```typescript
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { Evidence, EvidenceIndex, EvidenceSource } from '../../types/EvidenceTypes';
import { TrustClass } from '../../types/CommonTypes';
import { Logger } from '../core/Logger';
import { v4 as uuidv4 } from 'uuid';

export class EvidenceService {
  private s3Client: S3Client;
  private dynamoClient: DynamoDBDocumentClient;
  private logger: Logger;
  private evidenceBucket: string;
  private indexTableName: string;

  constructor(
    logger: Logger,
    evidenceBucket: string,
    indexTableName: string,
    region?: string
  ) {
    this.logger = logger;
    this.evidenceBucket = evidenceBucket;
    this.indexTableName = indexTableName;
    
    this.s3Client = new S3Client({ region });
    this.dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));
  }

  /**
   * Store immutable evidence (append-only)
   */
  async store(evidence: Omit<Evidence, 'evidenceId'>): Promise<Evidence> {
    const evidenceId = `evt_${Date.now()}_${uuidv4()}`;
    const timestamp = new Date().toISOString();
    
    const evidenceRecord: Evidence = {
      ...evidence,
      evidenceId,
      timestamp,
    };

    try {
      // Store in S3 (immutable)
      const s3Key = `evidence/${evidence.entityType}/${evidence.entityId}/${evidenceId}.json`;
      
      await this.s3Client.send(new PutObjectCommand({
        Bucket: this.evidenceBucket,
        Key: s3Key,
        Body: JSON.stringify(evidenceRecord, null, 2),
        ContentType: 'application/json',
        ObjectLockMode: 'COMPLIANCE',
        ObjectLockRetainUntilDate: addYears(new Date(), 7)
      }));

      // Index in DynamoDB
      const indexRecord: EvidenceIndex = {
        pk: `ENTITY#${evidence.entityId}`,
        sk: `EVIDENCE#${timestamp}#${evidenceId}`,
        evidenceId,
        entityId: evidence.entityId,
        entityType: evidence.entityType,
        timestamp,
        s3Key,
        source: evidence.source,
        trustClass: evidence.provenance.trustClass,
        gsi1pk: `ENTITY_TYPE#${evidence.entityType}`,
        gsi1sk: timestamp,
      };

      await this.dynamoClient.send(new PutCommand({
        TableName: this.indexTableName,
        Item: indexRecord,
      }));

      this.logger.debug('Evidence stored', {
        evidenceId,
        entityId: evidence.entityId,
        entityType: evidence.entityType,
        source: evidence.source,
      });

      return evidenceRecord;
    } catch (error) {
      this.logger.error('Failed to store evidence', {
        evidenceId,
        entityId: evidence.entityId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Retrieve evidence from S3
   */
  async get(evidenceId: string, entityId: string): Promise<Evidence | null> {
    try {
      // Lookup in index
      const indexResult = await this.dynamoClient.send(new QueryCommand({
        TableName: this.indexTableName,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
        FilterExpression: 'evidenceId = :evidenceId',
        ExpressionAttributeValues: {
          ':pk': `ENTITY#${entityId}`,
          ':sk': `EVIDENCE#`,
          ':evidenceId': evidenceId
        }
      }));

      if (!indexResult.Items || indexResult.Items.length === 0) {
        return null;
      }

      const index = indexResult.Items[0] as EvidenceIndex;

      // Retrieve from S3
      const s3Result = await this.s3Client.send(new GetObjectCommand({
        Bucket: this.evidenceBucket,
        Key: index.s3Key,
      }));

      const evidence = JSON.parse(await s3Result.Body!.transformToString()) as Evidence;
      return evidence;
    } catch (error) {
      this.logger.error('Failed to retrieve evidence', {
        evidenceId,
        entityId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}

function addYears(date: Date, years: number): Date {
  const result = new Date(date);
  result.setFullYear(result.getFullYear() + years);
  return result;
}
```

### 6.6 World State Service

**File:** `src/services/world-model/WorldStateService.ts`

```typescript
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { EntityState, FieldState, WorldStateRecord } from '../../types/WorldStateTypes';
import { Evidence } from '../../types/EvidenceTypes';
import { TrustClass } from '../../types/CommonTypes';
import { Logger } from '../core/Logger';
import { EvidenceService } from './EvidenceService';

export class WorldStateService {
  private dynamoClient: DynamoDBDocumentClient;
  private logger: Logger;
  private evidenceService: EvidenceService;
  private stateTableName: string;

  constructor(
    logger: Logger,
    evidenceService: EvidenceService,
    stateTableName: string,
    region?: string
  ) {
    this.logger = logger;
    this.evidenceService = evidenceService;
    this.stateTableName = stateTableName;
    
    this.dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));
  }

  /**
   * Compute state from evidence (deterministic)
   */
  async computeState(
    entityId: string,
    entityType: string,
    evidenceIds: string[]
  ): Promise<EntityState> {
    try {
      // Retrieve all evidence in parallel (with concurrency limit)
      const CONCURRENCY_LIMIT = 10;
      const evidenceRecords: Evidence[] = [];
      
      for (let i = 0; i < evidenceIds.length; i += CONCURRENCY_LIMIT) {
        const batch = evidenceIds.slice(i, i + CONCURRENCY_LIMIT);
        const results = await Promise.all(
          batch.map(evidenceId => 
            this.evidenceService.get(evidenceId, entityId).catch(err => {
              this.logger.warn('Failed to retrieve evidence', {
                evidenceId,
                entityId,
                error: err instanceof Error ? err.message : String(err),
              });
              return null;
            })
          )
        );
        
        evidenceRecords.push(...results.filter((e): e is Evidence => e !== null));
      }

      // Compute state deterministically
      const fields: Record<string, FieldState> = {};
      
      // Group evidence by field
      const fieldEvidence = new Map<string, Evidence[]>();
      for (const evidence of evidenceRecords) {
        // Extract fields from evidence payload
        for (const [fieldName, fieldValue] of Object.entries(evidence.payload)) {
          if (!fieldEvidence.has(fieldName)) {
            fieldEvidence.set(fieldName, []);
          }
          fieldEvidence.get(fieldName)!.push(evidence);
        }
      }

      // Compute field state for each field
      for (const [fieldName, evidenceList] of fieldEvidence.entries()) {
        fields[fieldName] = this.computeFieldState(fieldName, evidenceList);
      }

      const computedAt = new Date().toISOString();
      const state: EntityState = {
        entityId,
        entityType,
        fields,
        computedAt,
        version: '1.0', // Schema version
      };

      // Store computed state
      await this.storeState(state);

      return state;
    } catch (error) {
      this.logger.error('Failed to compute state', {
        entityId,
        entityType,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Compute field state from evidence (deterministic aggregation)
   */
  private computeFieldState(fieldName: string, evidence: Evidence[]): FieldState {
    // Sort by timestamp (most recent first)
    const sorted = evidence.sort((a, b) => 
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );

    const latest = sorted[0];
    const value = latest.payload[fieldName];

    // Compute confidence (weighted by trust class and recency)
    const confidence = this.computeConfidence(sorted);

    // Compute freshness
    const freshness = this.computeFreshness(latest.timestamp);

    // Compute contradiction score (field-specific)
    const contradiction = this.computeContradiction(fieldName, sorted, value);

    // Determine provenance trust (highest trust class)
    const provenanceTrust = this.determineProvenanceTrust(sorted);

    return {
      value,
      confidence,
      freshness,
      contradiction,
      provenanceTrust,
      lastUpdated: latest.timestamp,
      evidenceRefs: sorted.map(e => e.evidenceId),
    };
  }

  /**
   * Compute confidence from evidence (deterministic)
   */
  private computeConfidence(evidence: Evidence[]): number {
    const trustMultipliers: Record<TrustClass, number> = {
      PRIMARY: 1.0,
      VERIFIED: 0.95,
      DERIVED: 0.85,
      AGENT_INFERENCE: 0.60,
      UNTRUSTED: 0.30,
    };

    // Weight by trust class and recency
    let totalWeight = 0;
    let weightedSum = 0;

    for (const ev of evidence) {
      const trustMultiplier = trustMultipliers[ev.provenance.trustClass];
      const recencyWeight = this.computeRecencyWeight(ev.timestamp);
      const weight = trustMultiplier * recencyWeight;
      
      weightedSum += weight;
      totalWeight += weight;
    }

    return totalWeight > 0 ? Math.min(1.0, weightedSum / evidence.length) : 0;
  }

  /**
   * Compute recency weight (decay over time)
   */
  private computeRecencyWeight(timestamp: string): number {
    const ageHours = (Date.now() - new Date(timestamp).getTime()) / (1000 * 60 * 60);
    // Exponential decay: 1.0 at 0 hours, 0.5 at 24 hours, 0.25 at 48 hours
    return Math.exp(-ageHours / 24);
  }

  /**
   * Compute freshness (hours since last update)
   */
  private computeFreshness(timestamp: string): number {
    return (Date.now() - new Date(timestamp).getTime()) / (1000 * 60 * 60);
  }

  /**
   * Compute contradiction score (field-specific)
   * 
   * Compares field values across evidence, not entire payloads.
   * Normalizes values for semantic equality (dates, numbers, strings).
   */
  private computeContradiction(fieldName: string, evidence: Evidence[], expectedValue: any): number {
    if (evidence.length === 0) return 0;
    
    // Extract field values from evidence
    const fieldValues = evidence
      .map(e => e.payload?.[fieldName])
      .filter(v => v !== undefined);
    
    if (fieldValues.length === 0) return 0;
    
    // Normalize expected value for comparison
    const normalizedExpected = this.normalizeValue(expectedValue);
    
    // Count contradictions (values that differ from expected)
    const contradictions = fieldValues.filter(fieldValue => {
      const normalized = this.normalizeValue(fieldValue);
      return normalized !== normalizedExpected;
    });
    
    if (contradictions.length === 0) return 0;
    
    // Normalize to [0, 1]
    return Math.min(1.0, contradictions.length / fieldValues.length);
  }

  /**
   * Normalize value for comparison (handles dates, numbers, strings)
   */
  private normalizeValue(value: any): string {
    if (value === null || value === undefined) return '';
    
    // Normalize dates to ISO string
    if (value instanceof Date) {
      return value.toISOString();
    }
    
    // Normalize date strings
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
      try {
        return new Date(value).toISOString();
      } catch {
        // Not a valid date, continue
      }
    }
    
    // Normalize numbers
    if (typeof value === 'number') {
      return value.toString();
    }
    
    // Normalize strings (trim, lowercase for comparison)
    if (typeof value === 'string') {
      return value.trim().toLowerCase();
    }
    
    // For objects/arrays, use sorted JSON string
    return JSON.stringify(value, Object.keys(value).sort());
  }

  /**
   * Determine highest provenance trust class
   */
  private determineProvenanceTrust(evidence: Evidence[]): TrustClass {
    const trustOrder: TrustClass[] = ['PRIMARY', 'VERIFIED', 'DERIVED', 'AGENT_INFERENCE', 'UNTRUSTED'];
    
    for (const trust of trustOrder) {
      if (evidence.some(e => e.provenance.trustClass === trust)) {
        return trust;
      }
    }
    
    return 'UNTRUSTED';
  }

  /**
   * Store computed state
   */
  private async storeState(state: EntityState): Promise<void> {
    const record: WorldStateRecord = {
      pk: `ENTITY#${state.entityId}`,
      sk: `STATE#${state.computedAt}`,
      entityId: state.entityId,
      entityType: state.entityType,
      state,
      gsi1pk: `ENTITY_TYPE#${state.entityType}`,
      gsi1sk: state.computedAt,
    };

    await this.dynamoClient.send(new PutCommand({
      TableName: this.stateTableName,
      Item: record,
    }));
  }

  /**
   * Get current state for entity
   */
  async getCurrentState(entityId: string): Promise<EntityState | null> {
    try {
      const result = await this.dynamoClient.send(new QueryCommand({
        TableName: this.stateTableName,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
        ExpressionAttributeValues: {
          ':pk': `ENTITY#${entityId}`,
          ':sk': 'STATE#'
        },
        ScanIndexForward: false, // Most recent first
        Limit: 1,
      }));

      if (!result.Items || result.Items.length === 0) {
        return null;
      }

      return (result.Items[0] as WorldStateRecord).state;
    } catch (error) {
      this.logger.error('Failed to get current state', {
        entityId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
```

### 6.7 Snapshot Service

**File:** `src/services/world-model/SnapshotService.ts`

```typescript
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { WorldSnapshot, SnapshotIndex } from '../../types/SnapshotTypes';
import { EntityState } from '../../types/WorldStateTypes';
import { Logger } from '../core/Logger';
import { WorldStateService } from './WorldStateService';
import { SchemaRegistryService } from './SchemaRegistryService';
import { v4 as uuidv4 } from 'uuid';

export class SnapshotService {
  private s3Client: S3Client;
  private dynamoClient: DynamoDBDocumentClient;
  private logger: Logger;
  private worldStateService: WorldStateService;
  private schemaRegistryService: SchemaRegistryService;
  private snapshotsBucket: string;
  private indexTableName: string;

  constructor(
    logger: Logger,
    worldStateService: WorldStateService,
    schemaRegistryService: SchemaRegistryService,
    snapshotsBucket: string,
    indexTableName: string,
    region?: string
  ) {
    this.logger = logger;
    this.worldStateService = worldStateService;
    this.schemaRegistryService = schemaRegistryService;
    this.snapshotsBucket = snapshotsBucket;
    this.indexTableName = indexTableName;
    
    this.s3Client = new S3Client({ region });
    this.dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));
  }

  /**
   * Create immutable snapshot of world state
   */
  async createSnapshot(
    entityId: string,
    entityType: string,
    schemaVersion: string,
    schemaHash: string,
    createdBy: string,
    purpose: string,
    decisionContext?: string
  ): Promise<WorldSnapshot> {
    try {
      // Get current state
      const state = await this.worldStateService.getCurrentState(entityId);
      if (!state) {
        throw new Error(`No state found for entity ${entityId}`);
      }

      // Validate schema
      const schema = await this.schemaRegistryService.getSchema(
        entityType,
        schemaVersion,
        schemaHash
      );

      // Verify critical fields present
      const missingFields = schema.criticalFields.filter(
        field => !state.fields[field]
      );
      if (missingFields.length > 0) {
        throw new Error(`Missing critical fields: ${missingFields.join(', ')}`);
      }

      // Create snapshot
      const snapshotId = `snap_${Date.now()}_${entityId.replace(/:/g, '_')}_v${schemaVersion}`;
      const timestamp = new Date().toISOString();

      const snapshot: WorldSnapshot = {
        snapshotId,
        entityId,
        entityType,
        version: schemaVersion,
        timestamp,
        asOf: timestamp,
        state: state.fields,
        metadata: {
          snapshotVersion: '1.0',
          criticalFields: schema.criticalFields,
          registryVersion: schemaVersion,
          computedAt: state.computedAt,
          computedBy: 'world-model-snapshot-service',
        },
        audit: {
          createdBy,
          purpose,
          decisionContext,
        },
      };

      // Store in S3 (immutable)
      const s3Key = `snapshots/${entityType}/${entityId}/${snapshotId}.json`;
      
      await this.s3Client.send(new PutObjectCommand({
        Bucket: this.snapshotsBucket,
        Key: s3Key,
        Body: JSON.stringify(snapshot, null, 2),
        ContentType: 'application/json',
        ObjectLockMode: 'COMPLIANCE',
        ObjectLockRetainUntilDate: addYears(new Date(), 7)
      }));

      // Index in DynamoDB
      const indexRecord: SnapshotIndex = {
        pk: `ENTITY#${entityId}`,
        sk: `SNAPSHOT#${timestamp}#${snapshotId}`,
        snapshotId,
        entityId,
        entityType,
        timestamp,
        s3Key,
        version: schemaVersion,
        gsi1pk: `ENTITY_TYPE#${entityType}`,
        gsi1sk: timestamp,
      };

      await this.dynamoClient.send(new PutCommand({
        TableName: this.indexTableName,
        Item: indexRecord,
      }));

      this.logger.debug('Snapshot created', {
        snapshotId,
        entityId,
        entityType,
        purpose,
      });

      return snapshot;
    } catch (error) {
      this.logger.error('Failed to create snapshot', {
        entityId,
        entityType,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Retrieve snapshot by ID
   */
  async getSnapshot(snapshotId: string, entityId: string): Promise<WorldSnapshot | null> {
    try {
      // Lookup in index
      const indexResult = await this.dynamoClient.send(new QueryCommand({
        TableName: this.indexTableName,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
        ExpressionAttributeValues: {
          ':pk': `ENTITY#${entityId}`,
          ':sk': 'SNAPSHOT#'
        },
        FilterExpression: 'snapshotId = :snapshotId',
        ExpressionAttributeValues: {
          ':snapshotId': snapshotId
        }
      }));

      if (!indexResult.Items || indexResult.Items.length === 0) {
        return null;
      }

      const index = indexResult.Items[0] as SnapshotIndex;

      // Retrieve from S3
      const s3Result = await this.s3Client.send(new GetObjectCommand({
        Bucket: this.snapshotsBucket,
        Key: index.s3Key,
      }));

      const snapshot = JSON.parse(await s3Result.Body!.transformToString()) as WorldSnapshot;
      return snapshot;
    } catch (error) {
      this.logger.error('Failed to retrieve snapshot', {
        snapshotId,
        entityId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get snapshot by timestamp (time-travel)
   */
  async getSnapshotByTimestamp(
    entityId: string,
    asOf: string
  ): Promise<WorldSnapshot | null> {
    try {
      // Find snapshot closest to timestamp
      const result = await this.dynamoClient.send(new QueryCommand({
        TableName: this.indexTableName,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
        FilterExpression: 'timestamp <= :asOf',
        ExpressionAttributeValues: {
          ':pk': `ENTITY#${entityId}`,
          ':sk': 'SNAPSHOT#',
          ':asOf': asOf
        },
        ScanIndexForward: false, // Most recent first
        Limit: 1,
      }));

      if (!result.Items || result.Items.length === 0) {
        return null;
      }

      const index = result.Items[0] as SnapshotIndex;
      return await this.getSnapshot(index.snapshotId, entityId);
    } catch (error) {
      this.logger.error('Failed to get snapshot by timestamp', {
        entityId,
        asOf,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}

function addYears(date: Date, years: number): Date {
  const result = new Date(date);
  result.setFullYear(result.getFullYear() + years);
  return result;
}
```

### 6.8 Schema Registry Service

**File:** `src/services/world-model/SchemaRegistryService.ts`

```typescript
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { SchemaDefinition, SchemaRegistryRecord, CriticalFieldRecord } from '../../types/SchemaTypes';
import { EntityState } from '../../types/WorldStateTypes';
import { AutonomyTier } from '../../types/CommonTypes';
import { Logger } from '../core/Logger';
import { createHash } from 'crypto';

export class SchemaRegistryService {
  private s3Client: S3Client;
  private dynamoClient: DynamoDBDocumentClient;
  private logger: Logger;
  private schemaBucket: string;
  private registryTableName: string;
  private criticalFieldsTableName: string;
  private cache: Map<string, { schema: SchemaDefinition; hash: string; cachedAt: number }> = new Map();
  private CACHE_TTL = 3600000; // 1 hour

  constructor(
    logger: Logger,
    schemaBucket: string,
    registryTableName: string,
    criticalFieldsTableName: string,
    region?: string
  ) {
    this.logger = logger;
    this.schemaBucket = schemaBucket;
    this.registryTableName = registryTableName;
    this.criticalFieldsTableName = criticalFieldsTableName;
    
    this.s3Client = new S3Client({ region });
    this.dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));
  }

  /**
   * Resolve schema with hash verification (fail-closed)
   * 
   * **CRITICAL: Schema Immutability Enforcement**
   * - Schemas are immutable: (entityType, version) + hash uniquely identifies schema
   * - Never overwrite existing schema objects
   * - New version = new hash = new S3 object
   * - CI/CD must enforce: no schema mutation without version bump
   * - Hash mismatch = fail-closed (Tier D)
   */
  async getSchema(
    entityType: string,
    version: string,
    expectedHash: string
  ): Promise<SchemaDefinition> {
    // Check cache
    const cacheKey = `${entityType}:${version}:${expectedHash}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < this.CACHE_TTL) {
      // Verify hash
      if (cached.hash === expectedHash) {
        return cached.schema;
      }
      // Hash mismatch - invalidate cache
      this.cache.delete(cacheKey);
    }

    // Lookup in DynamoDB
    const record = await this.dynamoClient.send(new GetCommand({
      TableName: this.registryTableName,
      Key: {
        pk: `SCHEMA#${entityType}`,
        sk: `VERSION#${version}#${expectedHash}`
      }
    }));

    if (!record.Item) {
      // Try to find by version (without hash) for error reporting
      const versionResult = await this.dynamoClient.send(new QueryCommand({
        TableName: this.registryTableName,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
        ExpressionAttributeValues: {
          ':pk': `SCHEMA#${entityType}`,
          ':sk': `VERSION#${version}#`
        }
      }));

      if (!versionResult.Items || versionResult.Items.length === 0) {
        throw new SchemaNotFoundError(
          `Schema not found: ${entityType} v${version}`
        );
      }

      // Hash mismatch - fail closed
      throw new SchemaHashMismatchError(
        `Schema hash mismatch: expected ${expectedHash}, found ${versionResult.Items[0].schemaHash}`
      );
    }

    const registryRecord = record.Item as SchemaRegistryRecord;

    // Load from S3
    const s3Result = await this.s3Client.send(new GetObjectCommand({
      Bucket: registryRecord.s3Bucket,
      Key: registryRecord.s3Key,
    }));

    const schema = JSON.parse(await s3Result.Body!.transformToString()) as SchemaDefinition;
    const computedHash = this.computeSchemaHash(schema);

    // Verify hash
    if (computedHash !== expectedHash) {
      throw new SchemaHashMismatchError(
        `Schema hash verification failed: expected ${expectedHash}, computed ${computedHash}`
      );
    }

    // Cache
    this.cache.set(cacheKey, {
      schema,
      hash: computedHash,
      cachedAt: Date.now()
    });

    return schema;
  }

  /**
   * Get critical fields for entity type
   */
  async getCriticalFields(entityType: string, version: string): Promise<CriticalFieldRecord[]> {
    try {
      const result = await this.dynamoClient.send(new QueryCommand({
        TableName: this.criticalFieldsTableName,
        KeyConditionExpression: 'pk = :pk',
        FilterExpression: 'isCritical = :true AND version = :version',
        ExpressionAttributeValues: {
          ':pk': entityType,
          ':true': true,
          ':version': version
        }
      }));

      return (result.Items || []) as CriticalFieldRecord[];
    } catch (error) {
      this.logger.error('Failed to get critical fields', {
        entityType,
        version,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Validate entity state against schema
   */
  async validateEntityState(
    entityType: string,
    entityState: EntityState,
    version: string,
    expectedHash: string
  ): Promise<{ valid: boolean; tier: AutonomyTier; errors: string[] }> {
    try {
      const schema = await this.getSchema(entityType, version, expectedHash);
      const criticalFields = await this.getCriticalFields(entityType, version);

      const errors: string[] = [];
      
      // Check critical fields
      for (const field of criticalFields) {
        if (!entityState.fields[field.fieldName]) {
          errors.push(`Missing critical field: ${field.fieldName}`);
        }
      }

      // Check required fields
      for (const fieldName of schema.requiredFields) {
        if (!entityState.fields[fieldName]) {
          errors.push(`Missing required field: ${fieldName}`);
        }
      }

      if (errors.length > 0) {
        return {
          valid: false,
          tier: 'TIER_D',
          errors
        };
      }

      // Validation passed (tier calculation happens elsewhere)
      return {
        valid: true,
        tier: 'TIER_A', // Placeholder - actual tier from Agent Read Policy
        errors: []
      };
    } catch (error) {
      if (error instanceof SchemaNotFoundError || error instanceof SchemaHashMismatchError) {
        return {
          valid: false,
          tier: 'TIER_D',
          errors: [error.message]
        };
      }
      throw error;
    }
  }

  /**
   * Compute schema hash (SHA-256)
   */
  private computeSchemaHash(schema: SchemaDefinition): string {
    const schemaString = JSON.stringify(schema, null, 0); // No whitespace
    const hash = createHash('sha256').update(schemaString).digest('hex');
    return `sha256:${hash}`;
  }
}

class SchemaNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SchemaNotFoundError';
  }
}

class SchemaHashMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SchemaHashMismatchError';
  }
}
```

---

## 7. Audit Ledger

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
   * 
   * Uses GSI2 for time-range queries (efficient) or main table for event-type-only queries.
   */
  async query(query: LedgerQuery): Promise<LedgerEntry[]> {
    try {
      // If time range is specified, use GSI2 for efficient time-range queries
      if (query.startTime && query.endTime) {
        const filterExpressions: string[] = [];
        const expressionAttributeNames: Record<string, string> = {};
        const expressionAttributeValues: Record<string, any> = {
          ':pk': `TENANT#${query.tenantId}`,
          ':start': query.startTime,
          ':end': query.endTime,
        };

        // Add event type filter if provided
        if (query.eventType) {
          filterExpressions.push('eventType = :eventType');
          expressionAttributeValues[':eventType'] = query.eventType;
        }

        const commandParams: any = {
          TableName: this.tableName,
          IndexName: 'gsi2-index',
          KeyConditionExpression: 'gsi2pk = :pk AND gsi2sk BETWEEN :start AND :end',
          ExpressionAttributeValues: expressionAttributeValues,
          Limit: query.limit || 100,
          ScanIndexForward: false, // Most recent first
        };

        if (filterExpressions.length > 0) {
          commandParams.FilterExpression = filterExpressions.join(' AND ');
          if (Object.keys(expressionAttributeNames).length > 0) {
            commandParams.ExpressionAttributeNames = expressionAttributeNames;
          }
        }

        const command = new QueryCommand(commandParams);
        const result = await this.dynamoClient.send(command);
        return (result.Items || []) as LedgerEntry[];
      }

      // No time range: query main table with filters
      const filterExpressions: string[] = [];
      const expressionAttributeNames: Record<string, string> = {};
      const expressionAttributeValues: Record<string, any> = {
        ':pk': `TENANT#${query.tenantId}`,
      };

      if (query.eventType) {
        filterExpressions.push('eventType = :eventType');
        expressionAttributeValues[':eventType'] = query.eventType;
      }

      const commandParams: any = {
        TableName: this.tableName,
        KeyConditionExpression: 'pk = :pk',
        ExpressionAttributeValues: expressionAttributeValues,
        Limit: query.limit || 100,
        ScanIndexForward: false, // Most recent first
      };

      if (filterExpressions.length > 0) {
        commandParams.FilterExpression = filterExpressions.join(' AND ');
        if (Object.keys(expressionAttributeNames).length > 0) {
          commandParams.ExpressionAttributeNames = expressionAttributeNames;
        }
      }

      const command = new QueryCommand(commandParams);
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
  it('should create tenant → store evidence → compute state → create snapshot → verify ledger entry', async () => {
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

    // Store evidence (World Model)
    const evidenceService = new EvidenceService(/* ... */);
    const evidence = await evidenceService.store({
      entityId: 'account:acme_corp',
      entityType: 'Account',
      source: 'crm',
      payload: {
        accountName: 'Acme Corporation',
        renewalDate: '2024-12-31'
      },
      provenance: {
        trustClass: 'PRIMARY',
        sourceSystem: 'salesforce',
        verified: true
      },
      metadata: {
        traceId,
        tenantId: tenant.tenantId,
        accountId: 'acme_corp'
      }
    });

    // Compute state from evidence
    const worldStateService = new WorldStateService(/* ... */);
    const state = await worldStateService.computeState(
      'account:acme_corp',
      'Account',
      [evidence.evidenceId]
    );

    // Create snapshot
    const schemaRegistryService = new SchemaRegistryService(/* ... */);
    const snapshotService = new SnapshotService(
      logger,
      worldStateService,
      schemaRegistryService,
      /* ... */
    );
    const snapshot = await snapshotService.createSnapshot(
      'account:acme_corp',
      'Account',
      '1.0',
      'sha256:expected_hash',
      'agent:test',
      'integration_test',
      'test_decision_context'
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

    // Verify ledger entry (with snapshot binding)
    const ledgerService = new LedgerService(/* ... */);
    const entries = await ledgerService.getByTraceId(traceId);
    
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0].eventType).toBe(LedgerEventType.INTENT);
    expect(entries[0].tenantId).toBe(tenant.tenantId);
    
    // Verify World Model components
    expect(state).toBeDefined();
    expect(state.fields.accountName).toBeDefined();
    expect(snapshot).toBeDefined();
    expect(snapshot.snapshotId).toBeDefined();
  });
});
```

---

## 8. Implementation Checklist

### Week 1: Types & Core Services
- [ ] Day 1: Create all type files (Common, Event, Tenant, Ledger, Evidence, WorldState, Snapshot, Schema)
- [ ] Day 2: Implement Logger, TraceService, CacheService
- [ ] Day 3: Unit tests for core services

### Week 2: Infrastructure & Identity
- [ ] Day 4-5: CDK stack implementation (World Model architecture: S3 as truth, DynamoDB as belief)
- [ ] Day 6: Deploy and verify infrastructure
- [ ] Day 7-8: TenantService and IdentityService
- [ ] Day 9: Unit tests for identity services

### Week 3: Events & World Model Foundation
- [ ] Day 10-11: EventPublisher and EventRouter
- [ ] Day 12-13: World Model services (EvidenceService, WorldStateService, SnapshotService, SchemaRegistryService)
- [ ] Day 14: Unit tests for World Model services

### Week 4: Ledger & Integration
- [ ] Day 15-16: LedgerService implementation (with snapshot binding)
- [ ] Day 17: Integration test (tenant → evidence → state → snapshot → ledger)
- [ ] Day 18: Documentation and code review

---

## 9. Environment Variables

### 9.1 Lambda Environment Variables (CDK)

For deployed Lambdas, set environment variables in the CDK stack. Table names and other resources should be passed as Lambda environment variables:

```typescript
// In CDK stack, when creating Lambda functions
const lambdaFunction = new lambda.Function(this, 'MyFunction', {
  // ... other config
  environment: {
    ACCOUNTS_TABLE_NAME: this.accountsTable.tableName,
    SIGNALS_TABLE_NAME: this.signalsTable.tableName,
    TOOL_RUNS_TABLE_NAME: this.toolRunsTable.tableName,
    APPROVAL_REQUESTS_TABLE_NAME: this.approvalRequestsTable.tableName,
    ACTION_QUEUE_TABLE_NAME: this.actionQueueTable.tableName,
    POLICY_CONFIG_TABLE_NAME: this.policyConfigTable.tableName,
    LEDGER_TABLE_NAME: this.ledgerTable.tableName,
    CACHE_TABLE_NAME: this.cacheTable.tableName,
    TENANTS_TABLE_NAME: this.tenantsTable.tableName,
    RAW_SNAPSHOTS_BUCKET: this.rawSnapshotsBucket.bucketName,
    ARTIFACTS_BUCKET: this.artifactsBucket.bucketName,
    LEDGER_ARCHIVES_BUCKET: this.ledgerArchivesBucket.bucketName,
    EVENT_BUS_NAME: this.eventBus.eventBusName,
    LOG_LEVEL: 'info',
  },
});
```

### 9.2 How Services Get Table Names

Services read table names from `process.env.TABLE_NAME` with fallback defaults:

```typescript
// Example from LedgerService
this.tableName = process.env.LEDGER_TABLE_NAME || 'cc-native-ledger';
```

**Key Points:**
- **In Lambda (production)**: Table names come from CDK `environment` configuration (set in CDK stack)
- **Local development**: Services use fallback defaults (hardcoded table names matching CDK `tableName`)
- **No .env file needed**: Table names are deterministic (hardcoded in CDK), so no need to generate them in `.env`
- **CDK is source of truth**: Table names are defined once in CDK `tableName` property and propagated to Lambda via `environment`

**Note:** The `.env` file (if generated) is only for API keys/secrets, not for infrastructure resource names. Table names are always available via CDK configuration or service fallback defaults.

---

## 10. World Model Alignment Summary

### 10.1 Architecture Changes

**S3 as Truth (Immutable Evidence):**
- `evidenceLedgerBucket`: Immutable evidence records (Object Lock)
- `worldStateSnapshotsBucket`: Immutable snapshots (Object Lock)
- `schemaRegistryBucket`: Immutable schema definitions (Object Lock)

**DynamoDB as Belief (Computed State):**
- `worldStateTable`: Computed entity state from evidence
- `evidenceIndexTable`: Fast lookup for evidence (points to S3)
- `snapshotsIndexTable`: Fast lookup for snapshots (points to S3)
- `schemaRegistryTable`: Schema registry index (points to S3)
- `criticalFieldRegistryTable`: Critical field definitions for tier calculation

### 10.2 New Services

**World Model Foundation Services:**
1. **EvidenceService**: Store immutable evidence in S3, index in DynamoDB
2. **WorldStateService**: Compute state from evidence (deterministic)
3. **SnapshotService**: Create and retrieve immutable snapshots
4. **SchemaRegistryService**: Schema resolution with hash verification (fail-closed)

### 10.3 New Types

**World Model Types:**
- `EvidenceTypes.ts`: Evidence records and index
- `WorldStateTypes.ts`: Entity state with confidence
- `SnapshotTypes.ts`: Immutable snapshots
- `SchemaTypes.ts`: Schema registry and critical fields

**Updated Common Types:**
- Added `TrustClass` (PRIMARY, VERIFIED, DERIVED, AGENT_INFERENCE, UNTRUSTED)
- Added `AutonomyTier` (TIER_A, TIER_B, TIER_C, TIER_D)

### 10.4 Key Principles Enforced

1. **S3 = Immutable Truth**: Evidence, snapshots, schemas stored immutably
2. **DynamoDB = Computed Belief**: State computed deterministically from evidence
3. **Fail-Closed Safety**: Missing schema or hash mismatch → Tier D
4. **Snapshot Binding**: Every decision must bind to a snapshot
5. **No AI Mutation**: State computed deterministically, not by agents

### 10.5 References

- [World Model Contract](../strategy/WORLD_MODEL_CONTRACT.md)
- [World Model AWS Realization](../strategy/WORLD_MODEL_AWS_REALIZATION.md)
- [Agent Read Policy](../strategy/AGENT_READ_POLICY.md)
- [World Snapshot Contract](../strategy/WORLD_SNAPSHOT_CONTRACT.md)
- [World State Schema v1](../strategy/WORLD_STATE_SCHEMA_V1.md)
- [Schema Registry Implementation](../strategy/SCHEMA_REGISTRY_IMPLEMENTATION.md)

---

## 11. Critical Fixes Applied (Review Feedback)

### 11.1 EvidenceService.get() - Fixed DynamoDB Bug

**Issue:** Duplicate `ExpressionAttributeValues` overwriting each other

**Fix:** Merged into single map:
```typescript
ExpressionAttributeValues: {
  ':pk': `ENTITY#${entityId}`,
  ':sk': `EVIDENCE#`,
  ':evidenceId': evidenceId
}
```

### 11.2 WorldStateService.computeContradiction() - Fixed Logic

**Issue:** Compared entire payload vs single field value, order-dependent, overcounted contradictions

**Fix:** 
- Field-specific comparison (`payload[fieldName]` only)
- Value normalization (dates, numbers, strings)
- Semantic equality for strings/dates
- Proper contradiction counting

### 11.3 WorldStateService.computeState() - Parallelized Evidence Fetching

**Issue:** Serial evidence fetching doesn't scale

**Fix:** 
- `Promise.all` with concurrency limit (10)
- Batch processing with error handling
- Non-blocking parallel retrieval

### 11.4 SchemaRegistryService - Immutability Enforcement

**Issue:** Schema mutation race conditions possible

**Fix:**
- Added documentation: schemas are immutable
- (entityType, version) + hash uniquely identifies schema
- CI/CD must enforce: no schema mutation without version bump
- Hash mismatch = fail-closed (Tier D)

### 11.5 EventRouter - Added Idempotency

**Issue:** EventBridge at-least-once delivery can cause duplicate handler execution

**Fix:**
- Optional ledger service for idempotency checks
- Checks ledger for prior execution before routing
- Logs event routing completion for future checks

### 11.6 TraceContext Propagation - Added Note

**Issue:** Manual trace context passing is error-prone

**Fix:**
- Added note recommending `AsyncLocalStorage` (Node 18+) for implicit propagation
- Reduces human error in trace context passing

### 11.7 Additional DynamoDB ExpressionAttributeValues Fixes

**Fixed duplicate ExpressionAttributeValues in:**
- `getSnapshotByTimestamp()` - merged into single map
- `getCriticalFields()` - merged into single map

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

---

## 12. Review Feedback & Fixes Applied

### 12.1 Critical Issues Fixed (Red)

✅ **EvidenceService.get() - DynamoDB Bug**
- **Issue:** Duplicate `ExpressionAttributeValues` overwriting each other
- **Fix:** Merged into single map (lines 1713-1717)
- **Impact:** Prevents silent query failures

✅ **WorldStateService.computeContradiction() - Logic Fix**
- **Issue:** Compared entire payload vs field value, order-dependent, overcounted
- **Fix:** Field-specific comparison with value normalization (lines 1930-1975)
- **Impact:** Accurate contradiction scores

✅ **SchemaRegistryService - Immutability Enforcement**
- **Issue:** Schema mutation race conditions possible
- **Fix:** Added documentation and enforcement notes (lines 2393-2397)
- **Impact:** Prevents schema corruption, enforces versioning

### 12.2 Medium-Priority Improvements (Yellow)

✅ **WorldStateService - Parallelized Evidence Fetching**
- **Issue:** Serial evidence fetching doesn't scale
- **Fix:** `Promise.all` with concurrency limit (lines 1796-1810)
- **Impact:** Better performance for large evidence sets

✅ **EventRouter - Idempotency Added**
- **Issue:** EventBridge at-least-once delivery can cause duplicates
- **Fix:** Ledger-based idempotency checks (lines 1346-1390)
- **Impact:** Prevents duplicate handler execution

✅ **TraceService - Propagation Helper**
- **Issue:** Manual trace context passing is error-prone
- **Fix:** Added `withTrace()` helper with AsyncLocalStorage note (lines 470-490)
- **Impact:** Reduces human error in trace propagation

### 12.3 Additional Fixes

✅ **getSnapshotByTimestamp() - Fixed DynamoDB Bug**
- Merged duplicate `ExpressionAttributeValues` (lines 2314-2318)

✅ **getCriticalFields() - Fixed DynamoDB Bug**
- Merged duplicate `ExpressionAttributeValues` (lines 2478-2484)

### 12.4 Architecture Strengths (Preserved)

✅ **No agent-written state** - Agents are read-only consumers
✅ **No mutable world model** - State computed deterministically
✅ **No LLM confidence shortcuts** - Explicit confidence calculation
✅ **Deterministic recomputation** - State can be rebuilt from evidence
✅ **Snapshot binding** - Every decision bound to immutable snapshot
✅ **Schema hash verification** - Fail-closed on mismatch

**These principles are correct and must remain frozen.**
