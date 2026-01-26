/**
 * Execution Attempt Service - Phase 4.1
 * 
 * Manage execution attempt locking (exactly-once guarantee)
 */

import { DynamoDBDocumentClient, PutCommand, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { Logger } from '../core/Logger';
import { ExecutionAttempt } from '../../types/ExecutionTypes';

export class ExecutionAttemptService {
  constructor(
    private dynamoClient: DynamoDBDocumentClient,
    private tableName: string,
    private logger: Logger
  ) {}

  /**
   * Start execution attempt (exactly-once guarantee)
   * 
   * Model A: ExecutionLock - one item per intent
   * - Creates lock if not exists (first attempt)
   * - Allows re-run if status is terminal (SUCCEEDED, FAILED, CANCELLED) AND allow_rerun=true
   * - Throws if status is RUNNING (already executing)
   * 
   * IMPORTANT: Reruns (terminal → RUNNING) are admin-only / explicitly initiated,
   * NOT automatic SFN retries. Step Functions retries only occur for RUNNING → RUNNING
   * transitions (not terminal → RUNNING). This prevents accidental double-writes from
   * treating reruns as normal retry semantics.
   * 
   * The `allow_rerun` flag provides explicit gating:
   * - Normal execution path (from EventBridge) always calls with allow_rerun=false
   * - Admin/manual rerun path explicitly sets allow_rerun=true
   * - This prevents accidental reruns from duplicate events or conditional logic changes
   * 
   * Uses conditional write to prevent race conditions.
   */
  async startAttempt(
    actionIntentId: string,
    tenantId: string,
    accountId: string,
    traceId: string,
    idempotencyKey: string,
    stateMachineTimeoutSeconds?: number, // Optional: SFN timeout in seconds (from config)
    allowRerun: boolean = false // Explicit rerun flag (default false - normal execution path)
  ): Promise<ExecutionAttempt> {
    const attemptId = `attempt_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const now = new Date().toISOString();
    
    // TTL should be tied to SFN timeout, not hardcoded
    // Default: 1 hour if not provided (backwards compatibility)
    // Buffer: 15 minutes to prevent RUNNING state from vanishing mid-flight during retries/backoff
    const timeoutSeconds = stateMachineTimeoutSeconds || 3600; // Default 1 hour
    const bufferSeconds = 900; // 15 minutes buffer
    const ttl = Math.floor(Date.now() / 1000) + timeoutSeconds + bufferSeconds;
    
    const pk = `TENANT#${tenantId}#ACCOUNT#${accountId}`;
    const sk = `EXECUTION#${actionIntentId}`;
    
    // Try to create new lock (if doesn't exist)
    // Populate GSI attributes for querying by action_intent_id and tenant
    const gsi1pk = `ACTION_INTENT#${actionIntentId}`;
    const gsi1sk = `UPDATED_AT#${now}`;
    const gsi2pk = `TENANT#${tenantId}`;
    const gsi2sk = `UPDATED_AT#${now}`;
    
    const attempt: ExecutionAttempt = {
      pk,
      sk,
      gsi1pk,
      gsi1sk,
      gsi2pk,
      gsi2sk,
      action_intent_id: actionIntentId,
      attempt_count: 1,
      last_attempt_id: attemptId,
      status: 'RUNNING',
      idempotency_key: idempotencyKey,
      started_at: now,
      updated_at: now,
      tenant_id: tenantId,
      account_id: accountId,
      trace_id: traceId,
      ttl,
    };
    
    try {
      // Conditional write: only succeed if execution doesn't exist
      await this.dynamoClient.send(new PutCommand({
        TableName: this.tableName,
        Item: attempt,
        ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)',
      }));
      
      return attempt;
    } catch (error: any) {
      if (error.name === 'ConditionalCheckFailedException') {
        // Lock exists - check if we can re-run (status is terminal)
        const existing = await this.getAttempt(actionIntentId, tenantId, accountId);
        if (!existing) {
          // Race condition: item was deleted between check and get
          throw new Error(`Race condition: execution lock state changed for action_intent_id: ${actionIntentId}`);
        }
        
        if (existing.status === 'RUNNING') {
          throw new Error(`Execution already in progress for action_intent_id: ${actionIntentId}`);
        }
        
        // Status is terminal - check if rerun is explicitly allowed
        if (!allowRerun) {
          throw new Error(
            `Execution already completed for action_intent_id: ${actionIntentId} (status: ${existing.status}). ` +
            `Reruns are not allowed without explicit allow_rerun=true flag. ` +
            `This prevents accidental reruns from duplicate events. ` +
            `If this is an intentional rerun, use the admin rerun path with allow_rerun=true.`
          );
        }
        
        // Status is terminal AND allow_rerun=true - allow re-run by updating lock (admin-only, not automatic SFN retry)
        // Use UpdateCommand (not PutCommand) for safe partial updates
        // This prevents unintentionally wiping fields if schema evolves
        // Update GSI attributes for querying by action_intent_id and tenant
        const gsi1pk = `ACTION_INTENT#${actionIntentId}`;
        const gsi1sk = `UPDATED_AT#${now}`;
        const gsi2pk = `TENANT#${tenantId}`;
        const gsi2sk = `UPDATED_AT#${now}`;
        
        await this.dynamoClient.send(new UpdateCommand({
          TableName: this.tableName,
          Key: {
            pk,
            sk,
          },
          UpdateExpression: [
            'SET #status = :running',
            '#attempt_count = #attempt_count + :one',
            '#last_attempt_id = :attempt_id',
            '#idempotency_key = :idempotency_key',
            '#started_at = :started_at',
            '#updated_at = :updated_at',
            '#trace_id = :trace_id',
            '#ttl = :ttl',
            '#gsi1pk = :gsi1pk',
            '#gsi1sk = :gsi1sk',
            '#gsi2pk = :gsi2pk',
            '#gsi2sk = :gsi2sk',
            'REMOVE #last_error_class', // Clear error from previous attempt
          ].join(', '),
          ConditionExpression: '#status IN (:succeeded, :failed, :cancelled)',
          ExpressionAttributeNames: {
            '#status': 'status',
            '#attempt_count': 'attempt_count',
            '#last_attempt_id': 'last_attempt_id',
            '#idempotency_key': 'idempotency_key',
            '#started_at': 'started_at',
            '#updated_at': 'updated_at',
            '#trace_id': 'trace_id',
            '#ttl': 'ttl',
            '#gsi1pk': 'gsi1pk',
            '#gsi1sk': 'gsi1sk',
            '#last_error_class': 'last_error_class',
          },
          ExpressionAttributeValues: {
            ':running': 'RUNNING',
            ':one': 1,
            ':attempt_id': attemptId,
            ':idempotency_key': idempotencyKey,
            ':started_at': now,
            ':updated_at': now,
            ':trace_id': traceId,
            ':ttl': ttl,
            ':gsi1pk': gsi1pk,
            ':gsi1sk': gsi1sk,
            ':succeeded': 'SUCCEEDED',
            ':failed': 'FAILED',
            ':cancelled': 'CANCELLED',
          },
        }));
        
        // Fetch updated attempt to return
        const updatedAttempt = await this.getAttempt(actionIntentId, tenantId, accountId);
        if (!updatedAttempt) {
          throw new Error(`Failed to fetch updated attempt for action_intent_id: ${actionIntentId}`);
        }
        
        return updatedAttempt;
      }
      throw error;
    }
  }

  /**
   * Update attempt status (terminal states only)
   * 
   * Safety: Only allows transition from RUNNING to terminal state.
   * Prevents state corruption (e.g., SUCCEEDED → RUNNING via retries/bugs).
   */
  async updateStatus(
    actionIntentId: string,
    tenantId: string,
    accountId: string,
    status: 'SUCCEEDED' | 'FAILED' | 'CANCELLED',
    errorClass?: string
  ): Promise<void> {
    const now = new Date().toISOString();
    
    // Update GSI attributes for querying by action_intent_id and tenant
    const gsi1pk = `ACTION_INTENT#${actionIntentId}`;
    const gsi1sk = `UPDATED_AT#${now}`;
    const gsi2pk = `TENANT#${tenantId}`;
    const gsi2sk = `UPDATED_AT#${now}`;
    
    const updateExpression: string[] = [
      'SET #status = :status',
      '#updated_at = :updated_at',
      '#gsi1pk = :gsi1pk',
      '#gsi1sk = :gsi1sk',
      '#gsi2pk = :gsi2pk',
      '#gsi2sk = :gsi2sk',
    ];
    const expressionAttributeValues: Record<string, any> = {
      ':status': status,
      ':updated_at': now,
      ':gsi1pk': gsi1pk,
      ':gsi1sk': gsi1sk,
      ':gsi2pk': gsi2pk,
      ':gsi2sk': gsi2sk,
      ':running': 'RUNNING',
    };
    
    if (errorClass) {
      updateExpression.push('#last_error_class = :error_class');
      expressionAttributeValues[':error_class'] = errorClass;
    }
    
    try {
      await this.dynamoClient.send(new UpdateCommand({
        TableName: this.tableName,
        Key: {
          pk: `TENANT#${tenantId}#ACCOUNT#${accountId}`,
          sk: `EXECUTION#${actionIntentId}`,
        },
        UpdateExpression: updateExpression.join(', '),
        ConditionExpression: '#status = :running', // Only allow update if currently RUNNING
        ExpressionAttributeNames: {
          '#status': 'status',
          '#updated_at': 'updated_at',
          '#gsi1pk': 'gsi1pk',
          '#gsi1sk': 'gsi1sk',
          '#gsi2pk': 'gsi2pk',
          '#gsi2sk': 'gsi2sk',
          ...(errorClass ? { '#last_error_class': 'last_error_class' } : {}),
        },
        ExpressionAttributeValues: expressionAttributeValues,
      }));
    } catch (error: any) {
      if (error.name === 'ConditionalCheckFailedException') {
        // Status is not RUNNING - cannot transition to terminal
        throw new Error(
          `Cannot update status to ${status} for action_intent_id: ${actionIntentId}. ` +
          `Current status is not RUNNING. This may indicate a duplicate update or state corruption.`
        );
      }
      throw error;
    }
  }

  /**
   * Get attempt by action_intent_id
   */
  async getAttempt(
    actionIntentId: string,
    tenantId: string,
    accountId: string
  ): Promise<ExecutionAttempt | null> {
    const result = await this.dynamoClient.send(new GetCommand({
      TableName: this.tableName,
      Key: {
        pk: `TENANT#${tenantId}#ACCOUNT#${accountId}`,
        sk: `EXECUTION#${actionIntentId}`,
      },
    }));
    
    return result.Item as ExecutionAttempt | null;
  }
}
