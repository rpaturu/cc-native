/**
 * Phase 6.1 — Plan Ledger: append-only plan events.
 * See PHASE_6_1_CODE_LEVEL_PLAN.md §5 PlanLedgerService.
 */

import { DynamoDBDocumentClient, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { PlanLedgerEntry } from '../../types/plan/PlanLedgerTypes';
import { Logger } from '../core/Logger';
import { getAWSClientConfig } from '../../utils/aws-client-config';
import { v4 as uuidv4 } from 'uuid';

export interface PlanLedgerServiceConfig {
  tableName: string;
  region?: string;
}

export class PlanLedgerService {
  private dynamoClient: DynamoDBDocumentClient;
  private logger: Logger;
  private tableName: string;

  constructor(logger: Logger, config: PlanLedgerServiceConfig) {
    this.logger = logger;
    this.tableName = config.tableName;
    const client = new DynamoDBClient(getAWSClientConfig(config.region));
    this.dynamoClient = DynamoDBDocumentClient.from(client, {
      marshallOptions: { removeUndefinedValues: true },
    });
  }

  /**
   * Append event to plan ledger. Uses attribute_not_exists(sk) so sk is unique per event.
   */
  async append(
    entry: Omit<PlanLedgerEntry, 'entry_id' | 'timestamp'>
  ): Promise<PlanLedgerEntry> {
    const entry_id = uuidv4();
    const timestamp = new Date().toISOString();
    const full: PlanLedgerEntry = {
      ...entry,
      entry_id,
      timestamp,
    };
    const pk = `PLAN#${entry.plan_id}`;
    const sk = `EVENT#${timestamp}#${entry_id}`;
    const gsi1pk = `TENANT#${entry.tenant_id}`;
    const gsi1sk = `PLAN#${entry.plan_id}#${timestamp}`;

    const command = new PutCommand({
      TableName: this.tableName,
      Item: {
        ...full,
        pk,
        sk,
        gsi1pk,
        gsi1sk,
      },
      ConditionExpression: 'attribute_not_exists(sk)',
    });

    await this.dynamoClient.send(command);
    this.logger.debug('Plan ledger entry appended', { plan_id: entry.plan_id, event_type: entry.event_type, entry_id });
    return full;
  }

  /**
   * Get events for a plan, latest first (descending sk).
   */
  async getByPlanId(planId: string, limit?: number): Promise<PlanLedgerEntry[]> {
    const pk = `PLAN#${planId}`;
    const command = new QueryCommand({
      TableName: this.tableName,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: {
        ':pk': pk,
        ':prefix': 'EVENT#',
      },
      ScanIndexForward: false,
      ...(limit != null ? { Limit: limit } : {}),
    });

    const result = await this.dynamoClient.send(command);
    if (!result.Items?.length) return [];

    return result.Items.map((item) => {
      const { pk: _pk, sk: _sk, gsi1pk: _g1, gsi1sk: _g2, ...entry } = item;
      return entry as PlanLedgerEntry;
    });
  }
}
