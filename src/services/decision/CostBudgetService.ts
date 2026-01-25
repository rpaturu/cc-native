/**
 * Cost Budget Service - Phase 3
 * 
 * Enforces cost budgets for decision evaluation to prevent unbounded LLM usage.
 */

import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { Logger } from '../core/Logger';

/**
 * Decision Budget
 */
interface DecisionBudget {
  pk: string;
  sk: string;
  daily_decisions_remaining: number;
  monthly_cost_remaining: number;
  last_reset_date: string;
  updated_at: string;
}

/**
 * Cost Budget Service
 */
export class CostBudgetService {
  constructor(
    private dynamoClient: DynamoDBDocumentClient,
    private budgetTableName: string,
    private logger: Logger
  ) {}

  /**
   * Check if decision evaluation is allowed (budget check)
   */
  async canEvaluateDecision(
    accountId: string,
    tenantId: string
  ): Promise<{ allowed: boolean; reason: string; budget_remaining: number }> {
    const budget = await this.getBudget(accountId, tenantId);
    
    if (budget.daily_decisions_remaining <= 0) {
      return {
        allowed: false,
        reason: 'DAILY_BUDGET_EXCEEDED',
        budget_remaining: 0
      };
    }
    
    if (budget.monthly_cost_remaining <= 0) {
      return {
        allowed: false,
        reason: 'MONTHLY_BUDGET_EXCEEDED',
        budget_remaining: 0
      };
    }
    
    return {
      allowed: true,
      reason: 'BUDGET_AVAILABLE',
      budget_remaining: budget.daily_decisions_remaining
    };
  }
  
  /**
   * Consume budget for decision evaluation
   */
  async consumeBudget(
    accountId: string,
    tenantId: string,
    cost: number // Cost in "decision units" (1 = standard decision, 2 = deep context)
  ): Promise<void> {
    const budget = await this.getBudget(accountId, tenantId);
    
    await this.dynamoClient.send(new UpdateCommand({
      TableName: this.budgetTableName,
      Key: {
        pk: `TENANT#${tenantId}#ACCOUNT#${accountId}`,
        sk: 'BUDGET'
      },
      UpdateExpression: 'SET daily_decisions_remaining = daily_decisions_remaining - :cost, monthly_cost_remaining = monthly_cost_remaining - :cost, updated_at = :now',
      ConditionExpression: 'daily_decisions_remaining >= :cost AND monthly_cost_remaining >= :cost',
      ExpressionAttributeValues: {
        ':cost': cost,
        ':now': new Date().toISOString()
      }
    }));
  }
  
  /**
   * Reset daily budget (called by scheduled job)
   * Note: Budget reset can be called per-account or per-tenant batch.
   * Scheduled job should check last_reset_date and reset accounts where date is stale (older than current UTC date).
   */
  async resetDailyBudget(accountId: string, tenantId: string): Promise<void> {
    const now = new Date().toISOString();
    const today = now.split('T')[0];
    
    await this.dynamoClient.send(new UpdateCommand({
      TableName: this.budgetTableName,
      Key: {
        pk: `TENANT#${tenantId}#ACCOUNT#${accountId}`,
        sk: 'BUDGET'
      },
      UpdateExpression: 'SET daily_decisions_remaining = :daily_limit, last_reset_date = :today, updated_at = :now',
      ExpressionAttributeValues: {
        ':daily_limit': 10, // Max 10 decisions per account per day
        ':today': today,
        ':now': now
      }
    }));
  }
  
  private async getBudget(accountId: string, tenantId: string): Promise<DecisionBudget> {
    const result = await this.dynamoClient.send(new GetCommand({
      TableName: this.budgetTableName,
      Key: {
        pk: `TENANT#${tenantId}#ACCOUNT#${accountId}`,
        sk: 'BUDGET'
      }
    }));
    
    if (!result.Item) {
      // Initialize budget and persist to DynamoDB
      const now = new Date().toISOString();
      const initialBudget: DecisionBudget = {
        pk: `TENANT#${tenantId}#ACCOUNT#${accountId}`,
        sk: 'BUDGET',
        daily_decisions_remaining: 10,
        monthly_cost_remaining: 100,
        last_reset_date: now.split('T')[0],
        updated_at: now
      };
      
      // Persist initial budget to DynamoDB
      await this.dynamoClient.send(new PutCommand({
        TableName: this.budgetTableName,
        Item: initialBudget
      }));
      
      return initialBudget;
    }
    
    return result.Item as DecisionBudget;
  }
}
