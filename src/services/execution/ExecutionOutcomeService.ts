/**
 * Execution Outcome Service - Phase 4.1
 * 
 * Record structured execution outcomes
 */

import { DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { Logger } from '../core/Logger';
import { ActionOutcomeV1 } from '../../types/ExecutionTypes';

export class ExecutionOutcomeService {
  constructor(
    private dynamoClient: DynamoDBDocumentClient,
    private tableName: string,
    private logger: Logger
  ) {}

  /**
   * Record execution outcome
   * 
   * Populates GSI attributes (gsi1pk, gsi1sk) for querying by action_intent_id.
   * 
   * Write-once: Outcomes are immutable once recorded. Prevents overwriting terminal outcomes
   * from retries or bugs. Uses conditional write to ensure exactly-once recording.
   */
  async recordOutcome(
    outcome: Omit<ActionOutcomeV1, 'pk' | 'sk' | 'gsi1pk' | 'gsi1sk' | 'ttl'>
  ): Promise<ActionOutcomeV1> {
    const ttl = Math.floor(new Date(outcome.completed_at).getTime() / 1000) + 7776000; // 90 days
    
    // GSI attributes for querying by action_intent_id and tenant
    const gsi1pk = `ACTION_INTENT#${outcome.action_intent_id}`;
    const gsi1sk = `COMPLETED_AT#${outcome.completed_at}`;
    const gsi2pk = `TENANT#${outcome.tenant_id}`;
    const gsi2sk = `COMPLETED_AT#${outcome.completed_at}`;
    
    const fullOutcome: ActionOutcomeV1 = {
      ...outcome,
      pk: `TENANT#${outcome.tenant_id}#ACCOUNT#${outcome.account_id}`,
      sk: `OUTCOME#${outcome.action_intent_id}`,
      gsi1pk,
      gsi1sk,
      gsi2pk,
      gsi2sk,
      ttl,
    };
    
    try {
      // Write-once: only create if doesn't exist (immutable outcomes)
      await this.dynamoClient.send(new PutCommand({
        TableName: this.tableName,
        Item: fullOutcome,
        ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)',
      }));
      
      return fullOutcome;
    } catch (error: any) {
      if (error.name === 'ConditionalCheckFailedException') {
        // Outcome already exists - this is fine (idempotent operation)
        // Fetch existing outcome to return
        const existing = await this.getOutcome(
          outcome.action_intent_id,
          outcome.tenant_id,
          outcome.account_id
        );
        if (existing) {
          return existing;
        }
        // Race condition: outcome was deleted between check and get
        throw new Error(
          `Race condition: outcome state changed for action_intent_id: ${outcome.action_intent_id}`
        );
      }
      throw error;
    }
  }

  /**
   * Get outcome by action_intent_id
   */
  async getOutcome(
    actionIntentId: string,
    tenantId: string,
    accountId: string
  ): Promise<ActionOutcomeV1 | null> {
    const result = await this.dynamoClient.send(new GetCommand({
      TableName: this.tableName,
      Key: {
        pk: `TENANT#${tenantId}#ACCOUNT#${accountId}`,
        sk: `OUTCOME#${actionIntentId}`,
      },
    }));
    
    return result.Item as ActionOutcomeV1 | null;
  }

  /**
   * List outcomes for account
   */
  async listOutcomes(
    tenantId: string,
    accountId: string,
    limit: number = 50
  ): Promise<ActionOutcomeV1[]> {
    const result = await this.dynamoClient.send(new QueryCommand({
      TableName: this.tableName,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: {
        ':pk': `TENANT#${tenantId}#ACCOUNT#${accountId}`,
      },
      Limit: limit,
    }));
    
    return (result.Items || []) as ActionOutcomeV1[];
  }
}
