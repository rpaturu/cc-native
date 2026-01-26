/**
 * Budget Reset Handler - Phase 3
 * 
 * Scheduled handler to reset daily decision budgets at midnight UTC.
 * Called by EventBridge scheduled rule.
 */

import { Handler } from 'aws-lambda';
import { Logger } from '../../services/core/Logger';
import { CostBudgetService } from '../../services/decision/CostBudgetService';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { getAWSClientConfig } from '../../utils/aws-client-config';

const logger = new Logger('BudgetResetHandler');

// Initialize AWS clients
const region = process.env.AWS_REGION || 'us-west-2';
const clientConfig = getAWSClientConfig(region);
const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient(clientConfig), {
  marshallOptions: {
    removeUndefinedValues: true,
  },
});

const costBudgetService = new CostBudgetService(
  dynamoClient,
  process.env.DECISION_BUDGET_TABLE_NAME || 'cc-native-decision-budget',
  logger
);

/**
 * Budget Reset Handler
 * Resets daily budgets for all accounts where last_reset_date is stale (older than current UTC date).
 * 
 * Note: This handler can be called:
 * 1. By EventBridge scheduled rule (daily at midnight UTC)
 * 2. With a specific account_id/tenant_id in the event detail (for targeted reset)
 */
export const handler: Handler = async (event, context) => {
  logger.info('Budget reset handler invoked', { event });
  
  try {
    // If event contains specific account/tenant, reset only that account
    if (event.detail?.account_id && event.detail?.tenant_id) {
      const { account_id, tenant_id } = event.detail;
      await costBudgetService.resetDailyBudget(account_id, tenant_id);
      logger.info('Budget reset for specific account', { account_id, tenant_id });
      return { reset: 1 };
    }
    
    // Otherwise, this is a scheduled batch reset
    // Note: For batch reset, we would need to scan the budget table and reset all stale budgets
    // For now, we'll log that batch reset is not implemented (can be added later if needed)
    logger.warn('Batch budget reset not implemented - use account-specific reset or implement table scan');
    
    return { reset: 0, message: 'Batch reset not implemented - use account-specific reset' };
  } catch (error) {
    logger.error('Budget reset failed', { error });
    throw error;
  }
};
