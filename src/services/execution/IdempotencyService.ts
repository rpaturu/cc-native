/**
 * Idempotency Service - Phase 4.1
 * 
 * Generate and manage idempotency keys (dual-layer idempotency)
 */

import { createHash } from 'crypto';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ExternalWriteDedupe, ExternalObjectRef } from '../../types/ExecutionTypes';

export class IdempotencyService {
  /**
   * Deep canonical JSON: recursively sort object keys for consistent idempotency
   * 
   * Returns a canonicalized value tree (objects with sorted keys, arrays mapped),
   * then JSON.stringify once at the end. This is simpler and safer than recursive
   * JSON.parse/stringify which can behave oddly for Dates, BigInt, undefined, etc.
   * 
   * Policy: undefined values are dropped (consistent with DynamoDB marshalling).
   */
  private deepCanonicalize(obj: any): any {
    if (obj === null) {
      return null;
    }
    
    // Drop undefined values (consistent with DynamoDB removeUndefinedValues: true)
    if (obj === undefined) {
      return undefined;
    }
    
    if (Array.isArray(obj)) {
      // Arrays preserve order (order-sensitive)
      return obj.map(item => this.deepCanonicalize(item));
    }
    
    if (typeof obj === 'object') {
      // Objects: sort keys recursively, drop undefined values
      const sortedKeys = Object.keys(obj).sort();
      const canonicalized: Record<string, any> = {};
      
      for (const key of sortedKeys) {
        const value = this.deepCanonicalize(obj[key]);
        // Drop undefined values
        if (value !== undefined) {
          canonicalized[key] = value;
        }
      }
      
      return canonicalized;
    }
    
    // Primitives (string, number, boolean) pass through
    return obj;
  }

  /**
   * Generate idempotency key for execution (execution-layer idempotency)
   * Format: hash(tenant_id + action_intent_id + tool_name + canonical_params + registry_version)
   * 
   * This key is per-intent: two ActionIntents with identical params will have different keys.
   * Use this for execution-layer dedupe (preventing duplicate Step Functions executions).
   * 
   * Uses deep canonical JSON to ensure consistent keys for semantically identical params.
   */
  generateIdempotencyKey(
    tenantId: string,
    actionIntentId: string,
    toolName: string,
    normalizedParams: Record<string, any>,
    registryVersion: number
  ): string {
    // Deep canonicalize: recursively sort all object keys, drop undefined
    const canonicalized = this.deepCanonicalize(normalizedParams);
    // Stringify once at the end (simpler and safer than recursive parse/stringify)
    const canonicalParams = JSON.stringify(canonicalized);
    
    const input = `${tenantId}:${actionIntentId}:${toolName}:${canonicalParams}:${registryVersion}`;
    return createHash('sha256').update(input, 'utf8').digest('hex');
  }

  /**
   * Generate semantic idempotency key (adapter-level idempotency)
   * Format: hash(tenant_id + tool_name + canonical_params + registry_version)
   * 
   * This key omits action_intent_id, enabling "never double-write externally" even across
   * duplicate ActionIntents with identical params. Use this for ExternalWriteDedupe if
   * your product goal is to prevent duplicate external writes regardless of intent source.
   * 
   * Note: This is optional - current design uses execution-layer key (includes intent_id)
   * for ExternalWriteDedupe. If you want semantic dedupe, use this method instead.
   */
  generateSemanticIdempotencyKey(
    tenantId: string,
    toolName: string,
    normalizedParams: Record<string, any>,
    registryVersion: number
  ): string {
    // Deep canonicalize: recursively sort all object keys, drop undefined
    const canonicalized = this.deepCanonicalize(normalizedParams);
    // Stringify once at the end
    const canonicalParams = JSON.stringify(canonicalized);
    
    const input = `${tenantId}:${toolName}:${canonicalParams}:${registryVersion}`;
    return createHash('sha256').update(input, 'utf8').digest('hex');
  }

  /**
   * Deep equality check for ExternalObjectRef arrays
   * Compares arrays by normalizing order and comparing each object
   */
  private arraysEqual(a: ExternalObjectRef[], b: ExternalObjectRef[]): boolean {
    if (a.length !== b.length) return false;
    
    // Sort by object_id for comparison (order-independent)
    const sortedA = [...a].sort((x, y) => x.object_id.localeCompare(y.object_id));
    const sortedB = [...b].sort((x, y) => x.object_id.localeCompare(y.object_id));
    
    return sortedA.every((refA, index) => {
      const refB = sortedB[index];
      return (
        refA.system === refB.system &&
        refA.object_type === refB.object_type &&
        refA.object_id === refB.object_id &&
        refA.object_url === refB.object_url
      );
    });
  }

  /**
   * Check if external write already happened (adapter-level idempotency)
   * Uses LATEST pointer for fast lookup (best-effort)
   * 
   * Phase 4.3 Enhancement: Returns ExternalObjectRef[] instead of string | null
   * 
   * Note: LATEST pointer is best-effort; source of truth is history items.
   * If LATEST pointer is missing, falls back to querying history items.
   * 
   * Backwards compatibility: Handles both old format (external_object_id) and new format (external_object_refs)
   */
  async checkExternalWriteDedupe(
    dynamoClient: DynamoDBDocumentClient,
    tableName: string,
    idempotencyKey: string
  ): Promise<ExternalObjectRef[] | null> {
    // First, check LATEST pointer (best-effort fast path)
    const latestResult = await dynamoClient.send(new GetCommand({
      TableName: tableName,
      Key: {
        pk: `IDEMPOTENCY_KEY#${idempotencyKey}`,
        sk: 'LATEST',
      },
    }));
    
    if (latestResult.Item) {
      const latest = latestResult.Item as any; // Use any to handle both old and new formats
      // If pointer exists, fetch the actual record it points to
      if (latest.latest_sk) {
        const actualResult = await dynamoClient.send(new GetCommand({
          TableName: tableName,
          Key: {
            pk: `IDEMPOTENCY_KEY#${idempotencyKey}`,
            sk: latest.latest_sk,
          },
        }));
        
        if (actualResult.Item) {
          const item = actualResult.Item as any;
          // ✅ Phase 4.3: Handle new format (external_object_refs)
          if (item.external_object_refs && Array.isArray(item.external_object_refs)) {
            return item.external_object_refs;
          }
          // ✅ Backwards compatibility: Handle old format (external_object_id)
          if (item.external_object_id) {
            return [{
              system: 'CRM', // Default - may not be accurate for all old records
              object_type: 'Unknown',
              object_id: item.external_object_id,
            }];
          }
        }
      }
      // Fallback: LATEST item itself has the data
      // ✅ Phase 4.3: Handle new format (external_object_refs)
      if (latest.external_object_refs && Array.isArray(latest.external_object_refs)) {
        return latest.external_object_refs;
      }
      // ✅ Backwards compatibility: Handle old format (external_object_id)
      if (latest.external_object_id) {
        return [{
          system: 'CRM', // Default - may not be accurate for all old records
          object_type: 'Unknown',
          object_id: latest.external_object_id,
        }];
      }
    }
    
    // LATEST pointer missing - query history items directly (source of truth)
    // This is slower but ensures correctness even if LATEST pointer write failed
    // Query all history items for this idempotency_key and return the most recent one
    const historyResult = await dynamoClient.send(new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :skPrefix)',
      ExpressionAttributeValues: {
        ':pk': `IDEMPOTENCY_KEY#${idempotencyKey}`,
        ':skPrefix': 'CREATED_AT#',
      },
      ScanIndexForward: false, // Sort descending (newest first)
      Limit: 1, // Only need the most recent
    }));
    
    if (historyResult.Items && historyResult.Items.length > 0) {
      const historyItem = historyResult.Items[0] as any;
      // ✅ Phase 4.3: Handle new format (external_object_refs)
      if (historyItem.external_object_refs && Array.isArray(historyItem.external_object_refs)) {
        return historyItem.external_object_refs;
      }
      // ✅ Backwards compatibility: Handle old format (external_object_id)
      if (historyItem.external_object_id) {
        return [{
          system: 'CRM', // Default - may not be accurate for all old records
          object_type: 'Unknown',
          object_id: historyItem.external_object_id,
        }];
      }
    }
    
    return null;
  }

  /**
   * Record external write dedupe (adapter-level idempotency)
   * 
   * Phase 4.3 Enhancement: Accepts ExternalObjectRef[] instead of single externalObjectId string
   * 
   * Option A: Immutable per idempotency_key with history
   * - Creates new item with sk = CREATED_AT#<timestamp> (preserves history)
   * - Updates LATEST pointer to point to new item
   * - If idempotency_key already exists with same external_object_refs, returns (idempotent)
   * - If idempotency_key exists with different external_object_refs, throws collision error
   */
  async recordExternalWriteDedupe(
    dynamoClient: DynamoDBDocumentClient,
    tableName: string,
    idempotencyKey: string,
    externalObjectRefs: ExternalObjectRef[],
    actionIntentId: string,
    toolName: string
  ): Promise<void> {
    const now = new Date().toISOString();
    const timestamp = Date.now();
    const ttl = Math.floor(timestamp / 1000) + 604800; // 7 days
    
    const historySk = `CREATED_AT#${timestamp}`;
    
    // Check if this idempotency_key already exists
    const existing = await this.checkExternalWriteDedupe(dynamoClient, tableName, idempotencyKey);
    
    if (existing) {
      // ✅ Phase 4.3: Compare arrays (deep equality, order-independent)
      if (!this.arraysEqual(existing, externalObjectRefs)) {
        // Collision - different external_object_refs for same idempotency_key
        const error = new Error(
          `Idempotency key collision: ${idempotencyKey} maps to different external_object_refs. ` +
          `Expected: ${JSON.stringify(externalObjectRefs)}, Found: ${JSON.stringify(existing)}. ` +
          `This may indicate a bug in idempotency key generation.`
        );
        error.name = 'IdempotencyCollisionError';
        
        // This is a sev-worthy incident - must produce:
        // 1. Ledger event (for audit trail)
        // 2. Structured log (for CloudWatch alarms)
        // 3. Metric increment (for monitoring)
        // 
        // TODO (Phase 4.2): Refactor IdempotencyService to accept LedgerService and trace context
        // to emit incident signals. For Phase 4.1, this error is thrown and should be caught by
        // handler/logging layer to emit structured logs and metrics.
        
        throw error;
      }
      // Same external_object_refs - idempotent operation, no-op
      return;
    }
    
    // Create history item (immutable, preserves audit trail)
    const historyItem: ExternalWriteDedupe = {
      pk: `IDEMPOTENCY_KEY#${idempotencyKey}`,
      sk: historySk,
      idempotency_key: idempotencyKey,
      external_object_refs: externalObjectRefs, // ✅ Phase 4.3: Array format
      action_intent_id: actionIntentId,
      tool_name: toolName,
      created_at: now,
      ttl,
    };
    
    // Create LATEST pointer item (points to history item)
    const latestItem: ExternalWriteDedupe = {
      pk: `IDEMPOTENCY_KEY#${idempotencyKey}`,
      sk: 'LATEST',
      idempotency_key: idempotencyKey,
      external_object_refs: externalObjectRefs, // ✅ Phase 4.3: Array format
      action_intent_id: actionIntentId,
      tool_name: toolName,
      created_at: now,
      latest_sk: historySk, // Points to actual history item
      ttl,
    };
    
    // Write both items (best-effort atomicity)
    // For Phase 4.1: write history first, then LATEST (if LATEST write fails, history still exists)
    // Note: LATEST pointer is best-effort; source of truth is history items.
    // If LATEST pointer is missing, fall back to querying history items by created_at descending.
    await dynamoClient.send(new PutCommand({
      TableName: tableName,
      Item: historyItem,
      ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)',
    }));
    
    // Update LATEST pointer (allow overwrite - it's just a pointer, best-effort)
    // If this write fails, history item still exists and can be queried directly
    await dynamoClient.send(new PutCommand({
      TableName: tableName,
      Item: latestItem,
    }));
  }
}
