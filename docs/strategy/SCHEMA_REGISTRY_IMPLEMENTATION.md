# Schema Registry Implementation

## 1. Purpose

This document defines the **implementation specification** for the Schema Registry - the system that enforces schema validation and critical field requirements for agent decisions.

**Core Principle:**
> **S3 is the immutable source of truth. DynamoDB is the fast index. Hash verification ensures integrity.**

---

## 2. Architecture Overview

### 2.1 Storage Architecture

**S3: Immutable Source of Truth**
* Schema definitions stored as JSON files
* Versioned buckets (Object Lock for compliance)
* Path: `s3://cc-native-schema-registry/{version}/{entity_type}.json`
* Content hash stored with each schema
* Immutable (never modified, only new versions)

**DynamoDB: Fast Index/Pointers**
* Index for fast lookup
* Points to S3 location
* Stores metadata and hashes
* Table: `world_schema_registry`
* GSI for version queries

**Relationship:**
```
DynamoDB → S3 Key → Schema JSON
         → Hash → Verification
```

---

## 3. Registry Record Schema

### 3.1 DynamoDB Record Structure

```typescript
interface SchemaRegistryRecord {
  // Primary Key
  pk: string;                    // "SCHEMA#{entityType}"
  sk: string;                    // "VERSION#{version}#{hash}"
  
  // Core Fields
  entityType: string;            // e.g., "Account", "Contract"
  version: string;               // e.g., "1.0", "1.1"
  schemaHash: string;            // SHA-256 hash of schema JSON
  
  // S3 Location
  s3Bucket: string;              // "cc-native-schema-registry"
  s3Key: string;                 // "{version}/{entity_type}.json"
  s3VersionId?: string;          // S3 version ID (if versioning enabled)
  
  // Schema Metadata
  fields: SchemaField[];
  criticalFields: string[];      // Field names that are critical
  requiredFields: string[];      // Field names that are required
  
  // Field-Level Overrides
  fieldOverrides: Record<string, FieldOverride>;
  
  // Status
  status: "active" | "deprecated" | "archived";
  isDefault: boolean;            // Default version for entity type
  
  // Timestamps
  publishedAt: string;           // ISO 8601 timestamp
  createdAt: string;
  updatedAt: string;
  
  // Metadata
  publishedBy: string;           // CI/CD system or user
  changeLog: string;              // Description of changes
}
```

### 3.2 Schema Field Definition

```typescript
interface SchemaField {
  fieldName: string;
  fieldType: "string" | "number" | "boolean" | "date" | "timestamp" | "object" | "array";
  isRequired: boolean;
  isCritical: boolean;
  description?: string;
  
  // Validation
  minValue?: number;
  maxValue?: number;
  pattern?: string;              // Regex pattern
  enum?: any[];                  // Allowed values
  
  // Defaults
  defaultValue?: any;
}
```

### 3.3 Field Override Definition

```typescript
interface FieldOverride {
  fieldName: string;
  minConfidence?: number;        // Override minimum confidence (0-1)
  maxFreshnessHours?: number;    // Override freshness TTL (hours)
  provenanceCaps?: TrustClass[]; // Allowed provenance trust classes
  ttl?: number;                  // Field-specific TTL (hours)
}
```

### 3.4 S3 Schema JSON Structure

```json
{
  "entityType": "Contract",
  "version": "1.0",
  "schemaHash": "sha256:abc123...",
  "publishedAt": "2024-01-15T10:00:00Z",
  "fields": [
    {
      "fieldName": "contractId",
      "fieldType": "string",
      "isRequired": true,
      "isCritical": true,
      "description": "Unique contract identifier"
    },
    {
      "fieldName": "renewalDate",
      "fieldType": "date",
      "isRequired": true,
      "isCritical": true,
      "description": "Contract renewal date"
    }
  ],
  "criticalFields": ["contractId", "renewalDate", "endDate", "status"],
  "requiredFields": ["contractId", "accountId", "startDate", "endDate"],
  "fieldOverrides": {
    "renewalDate": {
      "minConfidence": 0.90,
      "maxFreshnessHours": 12,
      "provenanceCaps": ["PRIMARY", "VERIFIED"]
    }
  }
}
```

---

## 4. CI/CD Publishing Workflow

### 4.1 Workflow Steps

**Step 1: Schema Validation**
```bash
# Validate schema JSON structure
npm run validate-schema -- entity-type=Contract version=1.0
```

**Step 2: Hash Computation**
```typescript
import { createHash } from 'crypto';

function computeSchemaHash(schema: SchemaDefinition): string {
  const schemaString = JSON.stringify(schema, null, 0); // No whitespace
  const hash = createHash('sha256').update(schemaString).digest('hex');
  return `sha256:${hash}`;
}
```

**Step 3: Golden Fixture Replay**
```bash
# Replay golden test fixtures to ensure backward compatibility
npm run test:golden-fixtures -- schema-version=1.0
```

**Step 4: S3 Upload**
```typescript
async function publishSchema(
  schema: SchemaDefinition,
  version: string
): Promise<void> {
  const hash = computeSchemaHash(schema);
  const s3Key = `${version}/${schema.entityType}.json`;
  
  // Upload to S3 with Object Lock
  await s3.putObject({
    Bucket: SCHEMA_REGISTRY_BUCKET,
    Key: s3Key,
    Body: JSON.stringify(schema, null, 2),
    ContentType: 'application/json',
    Metadata: {
      'schema-hash': hash,
      'entity-type': schema.entityType,
      'version': version
    },
    ObjectLockMode: 'COMPLIANCE',
    ObjectLockRetainUntilDate: addYears(new Date(), 7)
  });
  
  // Update DynamoDB index
  await dynamodb.putItem({
    TableName: 'world_schema_registry',
    Item: {
      pk: `SCHEMA#${schema.entityType}`,
      sk: `VERSION#${version}#${hash}`,
      entityType: schema.entityType,
      version: version,
      schemaHash: hash,
      s3Bucket: SCHEMA_REGISTRY_BUCKET,
      s3Key: s3Key,
      fields: schema.fields,
      criticalFields: schema.criticalFields,
      requiredFields: schema.requiredFields,
      fieldOverrides: schema.fieldOverrides,
      status: 'active',
      isDefault: true, // Set previous default to false
      publishedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      publishedBy: 'ci-cd-pipeline',
      changeLog: 'Initial schema publication'
    }
  });
}
```

**Step 5: Version Promotion**
```typescript
// Mark as default version
await dynamodb.updateItem({
  TableName: 'world_schema_registry',
  Key: {
    pk: `SCHEMA#${entityType}`,
    sk: `VERSION#${version}#${hash}`
  },
  UpdateExpression: 'SET isDefault = :true',
  ExpressionAttributeValues: {
    ':true': true
  }
});

// Unset previous default
await dynamodb.updateItem({
  TableName: 'world_schema_registry',
  Key: {
    pk: `SCHEMA#${entityType}`,
    sk: `VERSION#${previousVersion}#${previousHash}`
  },
  UpdateExpression: 'SET isDefault = :false',
  ExpressionAttributeValues: {
    ':false': false
  }
});
```

### 4.2 CI/CD Pipeline

```yaml
# .github/workflows/publish-schema.yml
name: Publish Schema

on:
  push:
    paths:
      - 'schemas/**/*.json'

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Validate Schema
        run: npm run validate-schema
      
      - name: Compute Hash
        run: npm run compute-hash
      
      - name: Replay Golden Fixtures
        run: npm run test:golden-fixtures
      
      - name: Publish to S3
        run: npm run publish-schema
        env:
          AWS_REGION: us-west-2
      
      - name: Update DynamoDB Index
        run: npm run update-registry-index
```

---

## 5. Runtime Resolution Path

### 5.1 Resolution Requirements

**Every Read MUST Include:**
* `entityType` - Entity type (e.g., "Contract")
* `schemaVersion` - Schema version (e.g., "1.0")
* `schemaHash` - Expected schema hash (for verification)

**Resolution Flow:**
```
1. Agent requests: { entityType, schemaVersion, schemaHash }
2. System looks up in DynamoDB index
3. Verify hash matches
4. If match: Load from cache or S3
5. If mismatch: Tier D (fail closed)
6. If missing: Tier D (fail closed)
```

### 5.2 Resolution Implementation

```typescript
interface SchemaResolutionRequest {
  entityType: string;
  schemaVersion: string;
  schemaHash: string;            // Expected hash for verification
}

interface SchemaResolutionResult {
  schema: SchemaDefinition;
  hash: string;
  source: 'cache' | 's3' | 'dynamodb';
  verified: boolean;
}

async function resolveSchema(
  request: SchemaResolutionRequest
): Promise<SchemaResolutionResult> {
  // Step 1: Check cache (with hash verification)
  const cached = await getCachedSchema(request.entityType, request.schemaVersion);
  if (cached && cached.hash === request.schemaHash) {
    return {
      schema: cached.schema,
      hash: cached.hash,
      source: 'cache',
      verified: true
    };
  }
  
  // Step 2: Lookup in DynamoDB
  const record = await dynamodb.getItem({
    TableName: 'world_schema_registry',
    Key: {
      pk: `SCHEMA#${request.entityType}`,
      sk: `VERSION#${request.schemaVersion}#${request.schemaHash}`
    }
  });
  
  if (!record.Item) {
    // Try to find by version (without hash) for hash verification
    const versionRecord = await dynamodb.query({
      TableName: 'world_schema_registry',
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
      ExpressionAttributeValues: {
        ':pk': `SCHEMA#${request.entityType}`,
        ':sk': `VERSION#${request.schemaVersion}#`
      }
    });
    
    if (versionRecord.Items.length === 0) {
      throw new SchemaNotFoundError(
        `Schema not found: ${request.entityType} v${request.schemaVersion}`
      );
    }
    
    // Hash mismatch - fail closed
    throw new SchemaHashMismatchError(
      `Schema hash mismatch: expected ${request.schemaHash}, found ${versionRecord.Items[0].schemaHash}`
    );
  }
  
  // Step 3: Load from S3
  const s3Object = await s3.getObject({
    Bucket: record.Item.s3Bucket,
    Key: record.Item.s3Key
  });
  
  const schema = JSON.parse(s3Object.Body.toString());
  const computedHash = computeSchemaHash(schema);
  
  // Step 4: Verify hash
  if (computedHash !== request.schemaHash) {
    throw new SchemaHashMismatchError(
      `Schema hash verification failed: expected ${request.schemaHash}, computed ${computedHash}`
    );
  }
  
  // Step 5: Cache for future use
  await cacheSchema(request.entityType, request.schemaVersion, schema, computedHash);
  
  return {
    schema,
    hash: computedHash,
    source: 's3',
    verified: true
  };
}
```

---

## 6. Caching Strategy

### 6.1 In-Process Cache

**Cache Structure:**
```typescript
interface SchemaCache {
  [entityType: string]: {
    [version: string]: {
      schema: SchemaDefinition;
      hash: string;
      cachedAt: number;
      ttl: number;               // Milliseconds
    };
  };
}

const schemaCache: SchemaCache = {};
const CACHE_TTL = 3600000; // 1 hour
```

**Cache Operations:**
```typescript
function getCachedSchema(
  entityType: string,
  version: string
): { schema: SchemaDefinition; hash: string } | null {
  const cached = schemaCache[entityType]?.[version];
  if (!cached) return null;
  
  const age = Date.now() - cached.cachedAt;
  if (age > cached.ttl) {
    delete schemaCache[entityType][version];
    return null;
  }
  
  return {
    schema: cached.schema,
    hash: cached.hash
  };
}

function cacheSchema(
  entityType: string,
  version: string,
  schema: SchemaDefinition,
  hash: string
): void {
  if (!schemaCache[entityType]) {
    schemaCache[entityType] = {};
  }
  
  schemaCache[entityType][version] = {
    schema,
    hash,
    cachedAt: Date.now(),
    ttl: CACHE_TTL
  };
}
```

### 6.2 Optional Redis Cache

**Redis Key Pattern:**
```
schema:{entityType}:{version}:{hash}
```

**Redis Implementation:**
```typescript
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL);

async function getCachedSchemaRedis(
  entityType: string,
  version: string,
  hash: string
): Promise<SchemaDefinition | null> {
  const key = `schema:${entityType}:${version}:${hash}`;
  const cached = await redis.get(key);
  
  if (!cached) return null;
  
  const schema = JSON.parse(cached);
  
  // Verify hash matches
  const computedHash = computeSchemaHash(schema);
  if (computedHash !== hash) {
    // Hash mismatch - invalidate cache
    await redis.del(key);
    return null;
  }
  
  return schema;
}

async function cacheSchemaRedis(
  entityType: string,
  version: string,
  hash: string,
  schema: SchemaDefinition,
  ttl: number = 3600
): Promise<void> {
  const key = `schema:${entityType}:${version}:${hash}`;
  await redis.setex(key, ttl, JSON.stringify(schema));
}
```

### 6.3 Hash Verification in Cache

**Critical:** Always verify hash when retrieving from cache.

```typescript
function verifyCachedSchema(
  cached: { schema: SchemaDefinition; hash: string },
  expectedHash: string
): boolean {
  // Verify stored hash matches expected
  if (cached.hash !== expectedHash) {
    return false;
  }
  
  // Recompute hash to ensure integrity
  const computedHash = computeSchemaHash(cached.schema);
  return computedHash === expectedHash;
}
```

---

## 7. Fail-Closed Rules

### 7.1 Tier D Triggers

**Any of the following → Tier D (Blocked):**

1. **Schema Not Found**
   * Entity type not in registry
   * Version not found
   * → Tier D: "Schema not found"

2. **Hash Mismatch**
   * Expected hash ≠ computed hash
   * Cache hash ≠ S3 hash
   * → Tier D: "Schema hash mismatch"

3. **Missing Critical Fields**
   * Critical field not in entity state
   * → Tier D: "Missing critical field: {fieldName}"

4. **Schema Drift Detected**
   * QualityCheck detects schema inconsistency
   * → Tier D: "Schema drift detected"

5. **Cache Corruption**
   * Cached schema fails hash verification
   * → Tier D: "Cache verification failed"

### 7.2 Fail-Closed Implementation

```typescript
async function resolveSchemaWithFailClosed(
  request: SchemaResolutionRequest
): Promise<SchemaResolutionResult> {
  try {
    return await resolveSchema(request);
  } catch (error) {
    if (error instanceof SchemaNotFoundError) {
      // Log and return Tier D
      await logSchemaError({
        entityType: request.entityType,
        version: request.schemaVersion,
        error: 'SCHEMA_NOT_FOUND',
        tier: 'TIER_D'
      });
      throw new TierDError('Schema not found - fail closed to Tier D');
    }
    
    if (error instanceof SchemaHashMismatchError) {
      // Log and return Tier D
      await logSchemaError({
        entityType: request.entityType,
        version: request.schemaVersion,
        error: 'SCHEMA_HASH_MISMATCH',
        tier: 'TIER_D'
      });
      throw new TierDError('Schema hash mismatch - fail closed to Tier D');
    }
    
    throw error;
  }
}
```

---

## 8. Drift Detection

### 8.1 QualityCheck Integration

**QualityCheck for Schema Drift:**
```typescript
interface SchemaDriftCheck extends QualityCheck {
  checkType: "schema_drift";
  entityType: string;
  schemaVersion: string;
  expectedHash: string;
  actualHash?: string;
  driftDetails?: {
    missingFields: string[];
    unexpectedFields: string[];
    typeMismatches: Array<{
      field: string;
      expected: string;
      actual: string;
    }>;
  };
}

async function checkSchemaDrift(
  entityType: string,
  entityState: EntityState,
  schemaVersion: string,
  expectedHash: string
): Promise<SchemaDriftCheck> {
  const schema = await resolveSchema({
    entityType,
    schemaVersion,
    schemaHash: expectedHash
  });
  
  const driftDetails = {
    missingFields: [] as string[],
    unexpectedFields: [] as string[],
    typeMismatches: [] as Array<{ field: string; expected: string; actual: string }>
  };
  
  // Check required fields
  for (const field of schema.schema.requiredFields) {
    if (!entityState.fields[field]) {
      driftDetails.missingFields.push(field);
    }
  }
  
  // Check field types
  for (const [fieldName, fieldValue] of Object.entries(entityState.fields)) {
    const fieldDef = schema.schema.fields.find(f => f.fieldName === fieldName);
    if (!fieldDef) {
      driftDetails.unexpectedFields.push(fieldName);
    } else {
      // Type validation
      const actualType = inferType(fieldValue.value);
      if (actualType !== fieldDef.fieldType) {
        driftDetails.typeMismatches.push({
          field: fieldName,
          expected: fieldDef.fieldType,
          actual: actualType
        });
      }
    }
  }
  
  const hasDrift = driftDetails.missingFields.length > 0 ||
                   driftDetails.unexpectedFields.length > 0 ||
                   driftDetails.typeMismatches.length > 0;
  
  return {
    checkId: `schema_drift_${Date.now()}`,
    traceId: generateTraceId(),
    checkType: "schema_drift",
    status: hasDrift ? "fail" : "pass",
    score: hasDrift ? 0 : 1,
    threshold: 1,
    details: hasDrift ? JSON.stringify(driftDetails) : "No drift detected",
    entityType,
    schemaVersion,
    expectedHash,
    driftDetails: hasDrift ? driftDetails : undefined,
    checkedAt: new Date().toISOString(),
    version: "1.0"
  };
}
```

### 8.2 Agent Logging

**Agent MUST Log Schema Resolution:**
```typescript
await logger.info('Schema resolution', {
  entityType: request.entityType,
  schemaVersion: request.schemaVersion,
  schemaHash: request.schemaHash,
  resolutionResult: result.source,
  verified: result.verified,
  tier: calculatedTier
});
```

**On Drift Detection:**
```typescript
await logger.error('Schema drift detected', {
  entityType,
  schemaVersion,
  driftDetails,
  tier: 'TIER_D',
  action: 'blocked'
});
```

---

## 9. Registry API

### 9.1 Minimal API Interface

**Get Schema:**
```typescript
GET /api/v1/schema/{entityType}/{version}?hash={expectedHash}

Response:
{
  "schema": SchemaDefinition,
  "hash": string,
  "verified": boolean,
  "source": "cache" | "s3" | "dynamodb"
}
```

**List Versions:**
```typescript
GET /api/v1/schema/{entityType}/versions

Response:
{
  "versions": Array<{
    "version": string,
    "hash": string,
    "isDefault": boolean,
    "publishedAt": string
  }>
}
```

**Validate Entity State:**
```typescript
POST /api/v1/schema/{entityType}/{version}/validate

Request:
{
  "entityState": EntityState,
  "expectedHash": string
}

Response:
{
  "valid": boolean,
  "tier": AutonomyTier,
  "errors": string[],
  "missingFields": string[]
}
```

### 9.2 Agent Library Interface

```typescript
class SchemaRegistryClient {
  async getSchema(
    entityType: string,
    version: string,
    expectedHash: string
  ): Promise<SchemaDefinition>;
  
  async validateEntityState(
    entityType: string,
    entityState: EntityState,
    version: string,
    expectedHash: string
  ): Promise<ValidationResult>;
  
  async checkDrift(
    entityType: string,
    entityState: EntityState,
    version: string,
    expectedHash: string
  ): Promise<SchemaDriftCheck>;
}
```

---

## 10. Implementation Checklist

### 10.1 Infrastructure

- [ ] Create S3 bucket with Object Lock
- [ ] Create DynamoDB table `world_schema_registry`
- [ ] Create DynamoDB GSI for version queries
- [ ] Set up IAM policies (read-only for agents)
- [ ] Configure Redis (optional)

### 10.2 CI/CD

- [ ] Create schema validation script
- [ ] Create hash computation utility
- [ ] Set up golden fixture replay tests
- [ ] Create S3 upload script
- [ ] Create DynamoDB index update script
- [ ] Set up GitHub Actions workflow

### 10.3 Runtime

- [ ] Implement schema resolution service
- [ ] Implement in-process cache
- [ ] Implement Redis cache (optional)
- [ ] Implement hash verification
- [ ] Implement fail-closed error handling
- [ ] Implement drift detection

### 10.4 API & Library

- [ ] Create Registry API endpoints
- [ ] Create agent library client
- [ ] Add logging and monitoring
- [ ] Add CloudWatch alarms

---

## 11. Final Note

This implementation ensures **schema integrity** and **fail-closed safety**.

**Key Guarantees:**
* S3 = immutable truth
* Hash verification = integrity
* Fail-closed = safety
* Caching = performance
* Drift detection = quality

**This is the foundation of schema enforcement.**
