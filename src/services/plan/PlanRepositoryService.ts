/**
 * Phase 6.1 — Plan repository: CRUD for plans; tenant/account scoped.
 * DRAFT-only mutability for updates. See PHASE_6_1_CODE_LEVEL_PLAN.md §5.
 */

import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { RevenuePlanV1, PlanStatus } from '../../types/plan/PlanTypes';
import { Logger } from '../core/Logger';
import { getAWSClientConfig } from '../../utils/aws-client-config';

export interface PlanRepositoryServiceConfig {
  tableName: string;
  region?: string;
  gsi1IndexName?: string;
  gsi2IndexName?: string;
}

const DEFAULT_GSI1 = 'gsi1-index';
const DEFAULT_GSI2 = 'gsi2-index';

function planPk(tenantId: string, accountId: string): string {
  return `TENANT#${tenantId}#ACCOUNT#${accountId}`;
}

function planSk(planId: string): string {
  return `PLAN#${planId}`;
}

function gsi1Pk(tenantId: string, planStatus: PlanStatus): string {
  return `TENANT#${tenantId}#STATUS#${planStatus}`;
}

function gsi2Pk(tenantId: string): string {
  return `TENANT#${tenantId}`;
}

function gsi2Sk(accountId: string, updatedAt: string): string {
  return `ACCOUNT#${accountId}#${updatedAt}`;
}

export class PlanRepositoryService {
  private dynamoClient: DynamoDBDocumentClient;
  private logger: Logger;
  private tableName: string;
  private gsi1IndexName: string;
  private gsi2IndexName: string;

  constructor(logger: Logger, config: PlanRepositoryServiceConfig) {
    this.logger = logger;
    this.tableName = config.tableName;
    this.gsi1IndexName = config.gsi1IndexName ?? DEFAULT_GSI1;
    this.gsi2IndexName = config.gsi2IndexName ?? DEFAULT_GSI2;
    const client = new DynamoDBClient(getAWSClientConfig(config.region));
    this.dynamoClient = DynamoDBDocumentClient.from(client, {
      marshallOptions: { removeUndefinedValues: true },
    });
  }

  async getPlan(
    tenantId: string,
    accountId: string,
    planId: string
  ): Promise<RevenuePlanV1 | null> {
    const command = new GetCommand({
      TableName: this.tableName,
      Key: { pk: planPk(tenantId, accountId), sk: planSk(planId) },
    });
    const result = await this.dynamoClient.send(command);
    if (!result.Item) return null;
    const { pk, sk, gsi1pk, gsi1sk, gsi2pk, gsi2sk, ...plan } = result.Item;
    return plan as RevenuePlanV1;
  }

  async putPlan(plan: RevenuePlanV1): Promise<void> {
    const existing = await this.getPlan(plan.tenant_id, plan.account_id, plan.plan_id);
    if (existing && existing.plan_status !== 'DRAFT') {
      throw new Error(
        `Plan ${plan.plan_id} is not in DRAFT; steps/constraints are immutable. Current status: ${existing.plan_status}.`
      );
    }
    const now = new Date().toISOString();
    const updated_at = plan.updated_at || now;
    const item = {
      ...plan,
      updated_at: plan.created_at ? plan.updated_at : updated_at,
      created_at: plan.created_at || now,
      pk: planPk(plan.tenant_id, plan.account_id),
      sk: planSk(plan.plan_id),
      gsi1pk: gsi1Pk(plan.tenant_id, plan.plan_status),
      gsi1sk: updated_at,
      gsi2pk: gsi2Pk(plan.tenant_id),
      gsi2sk: gsi2Sk(plan.account_id, updated_at),
    };
    await this.dynamoClient.send(
      new PutCommand({ TableName: this.tableName, Item: item })
    );
  }

  async updatePlanStatus(
    tenantId: string,
    accountId: string,
    planId: string,
    newStatus: PlanStatus,
    options?: {
      reason?: string;
      completed_at?: string;
      aborted_at?: string;
      expired_at?: string;
      completion_reason?: 'objective_met' | 'all_steps_done';
    }
  ): Promise<void> {
    const plan = await this.getPlan(tenantId, accountId, planId);
    if (!plan) {
      throw new Error(`Plan not found: ${planId}`);
    }
    const fromStatus = plan.plan_status;
    const updated_at = new Date().toISOString();
    const updateExpr: string[] = [
      'set plan_status = :to',
      '#updated_at = :updated_at',
      'gsi1pk = :gsi1pk',
      'gsi1sk = :gsi1sk',
      'gsi2pk = :gsi2pk',
      'gsi2sk = :gsi2sk',
    ];
    const exprValues: Record<string, unknown> = {
      ':to': newStatus,
      ':updated_at': updated_at,
      ':from': fromStatus,
      ':gsi1pk': gsi1Pk(tenantId, newStatus),
      ':gsi1sk': updated_at,
      ':gsi2pk': gsi2Pk(tenantId),
      ':gsi2sk': gsi2Sk(accountId, updated_at),
    };
    if (options?.completed_at != null) {
      updateExpr.push('completed_at = :completed_at');
      exprValues[':completed_at'] = options.completed_at;
    }
    if (options?.completion_reason != null) {
      updateExpr.push('completion_reason = :completion_reason');
      exprValues[':completion_reason'] = options.completion_reason;
    }
    if (options?.aborted_at != null) {
      updateExpr.push('aborted_at = :aborted_at');
      exprValues[':aborted_at'] = options.aborted_at;
    }
    if (options?.expired_at != null) {
      updateExpr.push('expired_at = :expired_at');
      exprValues[':expired_at'] = options.expired_at;
    }
    await this.dynamoClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { pk: planPk(tenantId, accountId), sk: planSk(planId) },
        ConditionExpression: 'plan_status = :from',
        UpdateExpression: updateExpr.join(', '),
        ExpressionAttributeNames: { '#updated_at': 'updated_at' },
        ExpressionAttributeValues: exprValues,
      })
    );
  }

  async listPlansByTenantAndStatus(
    tenantId: string,
    status: PlanStatus,
    limit?: number
  ): Promise<RevenuePlanV1[]> {
    const command = new QueryCommand({
      TableName: this.tableName,
      IndexName: this.gsi1IndexName,
      KeyConditionExpression: 'gsi1pk = :gsi1pk',
      ExpressionAttributeValues: { ':gsi1pk': gsi1Pk(tenantId, status) },
      ...(limit != null ? { Limit: limit } : {}),
    });
    const result = await this.dynamoClient.send(command);
    if (!result.Items?.length) return [];
    return result.Items.map((item) => {
      const { pk, sk, gsi1pk, gsi1sk, gsi2pk, gsi2sk, ...plan } = item;
      return plan as RevenuePlanV1;
    });
  }

  async listPlansByTenantAndAccount(
    tenantId: string,
    accountId: string,
    limit?: number
  ): Promise<RevenuePlanV1[]> {
    const command = new QueryCommand({
      TableName: this.tableName,
      IndexName: this.gsi2IndexName,
      KeyConditionExpression: 'gsi2pk = :gsi2pk AND begins_with(gsi2sk, :prefix)',
      ExpressionAttributeValues: {
        ':gsi2pk': gsi2Pk(tenantId),
        ':prefix': `ACCOUNT#${accountId}#`,
      },
      ...(limit != null ? { Limit: limit } : {}),
    });
    const result = await this.dynamoClient.send(command);
    if (!result.Items?.length) return [];
    return result.Items.map((item) => {
      const { pk, sk, gsi1pk, gsi1sk, gsi2pk, gsi2sk, ...plan } = item;
      return plan as RevenuePlanV1;
    });
  }

  async existsActivePlanForAccountAndType(
    tenantId: string,
    accountId: string,
    planType: string
  ): Promise<{ exists: boolean; planId?: string }> {
    const plans = await this.listPlansByTenantAndStatus(tenantId, 'ACTIVE', 100);
    const match = plans.find(
      (p) => p.account_id === accountId && p.plan_type === planType
    );
    return match
      ? { exists: true, planId: match.plan_id }
      : { exists: false };
  }
}
