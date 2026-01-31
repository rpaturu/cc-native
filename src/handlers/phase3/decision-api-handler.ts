/**
 * Decision API Handler - Phase 3
 * 
 * API endpoints for decision evaluation and approval.
 */

import { Handler, APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Logger } from '../../services/core/Logger';
import { TraceService } from '../../services/core/TraceService';
import { DecisionTriggerService } from '../../services/decision/DecisionTriggerService';
import { CostBudgetService } from '../../services/decision/CostBudgetService';
import { ActionIntentService } from '../../services/decision/ActionIntentService';
import { DecisionProposalStore } from '../../services/decision/DecisionProposalStore';
import { AccountPostureStateService } from '../../services/synthesis/AccountPostureStateService';
import { SignalService } from '../../services/perception/SignalService';
import { LedgerService } from '../../services/ledger/LedgerService';
import { DecisionTriggerType } from '../../types/DecisionTriggerTypes';
import { LedgerEventType } from '../../types/LedgerTypes';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { getAWSClientConfig } from '../../utils/aws-client-config';
import { v4 as uuidv4 } from 'uuid';

const logger = new Logger('DecisionAPIHandler');
const traceService = new TraceService(logger);

/**
 * Helper to add CORS headers to API Gateway responses
 */
function addCorsHeaders(response: APIGatewayProxyResult): APIGatewayProxyResult {
  return {
    ...response,
    headers: {
      'Access-Control-Allow-Origin': '*', // API Gateway CORS config should override this in production
      'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Tenant-Id',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      ...response.headers,
    },
  };
}

// Initialize AWS clients
const region = process.env.AWS_REGION || 'us-west-2';
const clientConfig = getAWSClientConfig(region);
const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient(clientConfig), {
  marshallOptions: {
    removeUndefinedValues: true,
  },
});
const eventBridgeClient = new EventBridgeClient(clientConfig);

// Initialize services (only those needed for API handler - no Neptune/Graph dependencies)
const ledgerService = new LedgerService(logger, process.env.LEDGER_TABLE_NAME || 'cc-native-ledger', region);
const accountPostureStateService = new AccountPostureStateService({
  dynamoClient,
  tableName: process.env.ACCOUNT_POSTURE_STATE_TABLE_NAME || 'cc-native-account-posture-state'
});
const signalService = new SignalService({
  logger,
  signalsTableName: process.env.SIGNALS_TABLE_NAME || 'cc-native-signals',
  accountsTableName: process.env.ACCOUNTS_TABLE_NAME || 'cc-native-accounts',
  lifecycleStateService: null as any, // Will be initialized if needed
  eventPublisher: null as any,
  ledgerService,
  region
});

// ✅ Zero Trust: API handler only needs trigger and budget services (no Neptune/Graph/Bedrock)
const decisionTriggerService = new DecisionTriggerService(
  accountPostureStateService,
  signalService,
  logger
);
const costBudgetService = new CostBudgetService(
  dynamoClient,
  process.env.DECISION_BUDGET_TABLE_NAME || 'cc-native-decision-budget',
  logger
);
const actionIntentService = new ActionIntentService(
  dynamoClient,
  process.env.ACTION_INTENT_TABLE_NAME || 'cc-native-action-intent',
  logger
);
const decisionProposalStore = new DecisionProposalStore(
  dynamoClient,
  process.env.DECISION_PROPOSAL_TABLE_NAME || 'cc-native-decision-proposal',
  logger
);

/**
 * POST /decisions/evaluate
 * Trigger async decision evaluation for an account (Zero Trust: no Neptune access in API handler)
 * 
 * Flow:
 * 1. Validate trigger and budget (fast, synchronous checks)
 * 2. Trigger async evaluation via EventBridge (with Neptune access in evaluation handler)
 * 3. Return evaluation ID for status polling
 */
export async function evaluateDecisionHandler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const traceId = traceService.generateTraceId();
  const { account_id, tenant_id, trigger_type } = JSON.parse(event.body || '{}');
  
  try {
    // 1. Check trigger (fast synchronous check)
    const triggerResult = await decisionTriggerService.shouldTriggerDecision(
      account_id,
      tenant_id,
      trigger_type as DecisionTriggerType
    );
    
    if (!triggerResult.should_evaluate) {
      return addCorsHeaders({
        statusCode: 200,
        body: JSON.stringify({ message: 'Decision not triggered', reason: triggerResult.reason })
      });
    }
    
    // 2. Check budget (fast synchronous check)
    const budgetResult = await costBudgetService.canEvaluateDecision(account_id, tenant_id);
    
    if (!budgetResult.allowed) {
      return addCorsHeaders({
        statusCode: 429,
        body: JSON.stringify({ message: 'Budget exceeded', reason: budgetResult.reason })
      });
    }
    
    // 3. Generate evaluation ID for tracking
    const evaluationId = `eval_${uuidv4()}`;
    
    // 4. Trigger async decision evaluation via EventBridge
    // ✅ Zero Trust: Evaluation handler (with VPC/Neptune access) processes this
    await eventBridgeClient.send(new PutEventsCommand({
      Entries: [{
        Source: 'cc-native.decision',
        DetailType: 'DECISION_EVALUATION_REQUESTED',
        Detail: JSON.stringify({
          account_id,
          tenant_id,
          trigger_type: trigger_type || DecisionTriggerType.EXPLICIT_USER_REQUEST,
          evaluation_id: evaluationId, // Track this evaluation
          trace_id: traceId,
        }),
        EventBusName: process.env.EVENT_BUS_NAME || 'cc-native-events'
      }]
    }));
    
    // 5. Log evaluation initiation to ledger
    await ledgerService.append({
      eventType: LedgerEventType.DECISION_EVALUATION_REQUESTED,
      tenantId: tenant_id,
      accountId: account_id,
      traceId,
      data: {
        evaluation_id: evaluationId,
        trigger_type: trigger_type || DecisionTriggerType.EXPLICIT_USER_REQUEST,
        status: 'PENDING'
      }
    });
    
    logger.info('Decision evaluation initiated', { account_id, tenant_id, evaluationId, traceId });
    
    // 6. Return 202 Accepted with evaluation ID for status polling
    return addCorsHeaders({
      statusCode: 202,
      body: JSON.stringify({
        message: 'Decision evaluation initiated',
        evaluation_id: evaluationId,
        status: 'PENDING',
        status_url: `/decisions/${evaluationId}/status`
      })
    });
  } catch (error) {
    logger.error('Failed to initiate decision evaluation', { account_id, tenant_id, error });
    return addCorsHeaders({
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error' })
    });
  }
}

/**
 * GET /accounts/{id}/decisions
 * Get decision history for an account
 */
export async function getAccountDecisionsHandler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const accountId = event.pathParameters?.account_id;
  // API Gateway headers are case-insensitive, but we need to check both cases
  const tenantId = event.headers['x-tenant-id'] || event.headers['X-Tenant-Id'] || event.headers['X-TENANT-ID'];
  
  logger.info('getAccountDecisionsHandler called', {
    accountId,
    tenantId,
    headers: Object.keys(event.headers || {}),
    pathParameters: event.pathParameters
  });
  
  if (!accountId || !tenantId) {
    return addCorsHeaders({
      statusCode: 400,
      body: JSON.stringify({ 
        error: 'Missing account_id or tenant_id',
        accountId: accountId || 'missing',
        tenantId: tenantId || 'missing',
        availableHeaders: Object.keys(event.headers || {})
      })
    });
  }
  
  try {
    // Query ledger for DECISION_PROPOSED events
    logger.info('Querying ledger for decisions', { accountId, tenantId });
    const decisions = await ledgerService.query({
      tenantId,
      accountId,
      eventType: LedgerEventType.DECISION_PROPOSED,
      limit: 50
    });
    
    logger.info('Successfully queried decisions', { accountId, tenantId, count: decisions.length });
    
    return addCorsHeaders({
      statusCode: 200,
      body: JSON.stringify({ decisions })
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    logger.error('Failed to get account decisions', { 
      accountId, 
      tenantId, 
      error: errorMessage,
      stack: errorStack,
      errorDetails: error
    });
    return addCorsHeaders({
      statusCode: 500,
      body: JSON.stringify({ 
        error: 'Internal server error',
        message: errorMessage
      })
    });
  }
}

/**
 * POST /actions/{id}/approve
 * Approve an action proposal
 */
export async function approveActionHandler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const actionId = event.pathParameters?.action_id;
  const { decision_id, edits } = JSON.parse(event.body || '{}');
  const userId = event.requestContext.authorizer?.userId || 'unknown';
  const tenantId = event.headers['x-tenant-id'];
  
  if (!actionId || !decision_id || !tenantId) {
    return addCorsHeaders({
      statusCode: 400,
      body: JSON.stringify({ error: 'Missing required fields: action_id, decision_id, tenant_id' })
    });
  }
  
  try {
    // CRITICAL: Do not trust client payload. Load proposal from server storage.
    const proposal = await decisionProposalStore.getProposal(decision_id, tenantId);
    
    if (!proposal) {
      return addCorsHeaders({
        statusCode: 404,
        body: JSON.stringify({ error: 'Decision not found' })
      });
    }
    
    // Find the specific action proposal by action_ref (proposal identifier)
    const actionProposal = proposal.actions.find(a => a.action_ref === actionId);
    if (!actionProposal) {
      return addCorsHeaders({
        statusCode: 404,
        body: JSON.stringify({ error: 'Action proposal not found in decision' })
      });
    }
    
    // Derive tenant/account/trace from proposal (server-authoritative)
    const accountId = proposal.account_id;
    const traceId = proposal.trace_id;
    
    // Create action intent
    const intent = await actionIntentService.createIntent(
      actionProposal,
      proposal.decision_id,
      userId,
      tenantId,
      accountId,
      traceId,
      edits ? Object.keys(edits) : undefined
    );
    
    // Log to ledger
    await ledgerService.append({
      eventType: LedgerEventType.ACTION_APPROVED,
      tenantId,
      accountId,
      traceId,
      data: {
        action_intent_id: intent.action_intent_id,
        decision_id: proposal.decision_id,
        edited_fields: intent.edited_fields
      }
    });

    // Publish ACTION_APPROVED to EventBridge so execution Step Functions starts (Phase 4).
    // Contract: ExecutionInfrastructure rule matches detailType ACTION_APPROVED and passes
    // $.detail.data.{ action_intent_id, tenant_id, account_id } to Step Functions.
    await eventBridgeClient.send(new PutEventsCommand({
      Entries: [{
        Source: 'cc-native',
        DetailType: 'ACTION_APPROVED',
        Detail: JSON.stringify({
          data: {
            action_intent_id: intent.action_intent_id,
            tenant_id: tenantId,
            account_id: accountId,
            approval_source: 'HUMAN',
            auto_executed: false,
          },
        }),
        EventBusName: process.env.EVENT_BUS_NAME || 'cc-native-events',
      }],
    }));

    return addCorsHeaders({
      statusCode: 200,
      body: JSON.stringify({ intent })
    });
  } catch (error) {
    logger.error('Action approval failed', { actionId, decision_id, tenantId, error });
    return addCorsHeaders({
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error' })
    });
  }
}

/**
 * POST /actions/{id}/reject
 * Reject an action proposal
 */
export async function rejectActionHandler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const actionId = event.pathParameters?.action_id;
  const { decision_id, reason } = JSON.parse(event.body || '{}');
  const userId = event.requestContext.authorizer?.userId || 'unknown';
  const tenantId = event.headers['x-tenant-id'];
  
  if (!actionId || !decision_id || !tenantId) {
    return addCorsHeaders({
      statusCode: 400,
      body: JSON.stringify({ error: 'Missing required fields: action_id, decision_id, tenant_id' })
    });
  }
  
  try {
    // CRITICAL: Do not trust client payload. Load proposal from server storage.
    const proposal = await decisionProposalStore.getProposal(decision_id, tenantId);
    
    if (!proposal) {
      return addCorsHeaders({
        statusCode: 404,
        body: JSON.stringify({ error: 'Decision not found' })
      });
    }
    
    // Find the specific action proposal by action_ref (proposal identifier)
    const actionProposal = proposal.actions.find(a => a.action_ref === actionId);
    if (!actionProposal) {
      return addCorsHeaders({
        statusCode: 404,
        body: JSON.stringify({ error: 'Action proposal not found in decision' })
      });
    }
    
    // Derive tenant/account/trace from proposal (server-authoritative)
    const accountId = proposal.account_id;
    const traceId = proposal.trace_id;
    
    // Log rejection to ledger (use action_ref from proposal, not action_intent_id which doesn't exist yet)
    await ledgerService.append({
      eventType: LedgerEventType.ACTION_REJECTED,
      tenantId,
      accountId,
      traceId,
      data: {
        action_ref: actionId, // Use action_ref from proposal (before approval, no action_intent_id exists yet)
        decision_id: proposal.decision_id,
        rejected_by: userId,
        rejection_reason: reason
      }
    });
    
    return addCorsHeaders({
      statusCode: 200,
      body: JSON.stringify({ message: 'Action rejected' })
    });
  } catch (error) {
    logger.error('Action rejection failed', { actionId, decision_id, tenantId, error });
    return addCorsHeaders({
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error' })
    });
  }
}

/**
 * GET /decisions/{evaluation_id}/status
 * Get status of a decision evaluation
 */
export async function getEvaluationStatusHandler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const evaluationId = event.pathParameters?.evaluation_id;
  const tenantId = event.headers['x-tenant-id'] || event.headers['X-Tenant-Id'] || event.headers['X-TENANT-ID'];
  
  if (!evaluationId || !tenantId) {
    return addCorsHeaders({
      statusCode: 400,
      body: JSON.stringify({ error: 'Missing evaluation_id or tenant_id' })
    });
  }
  
  try {
    // Query ledger for evaluation initiation event
    const evaluationEvents = await ledgerService.query({
      tenantId,
      eventType: LedgerEventType.DECISION_EVALUATION_REQUESTED,
      limit: 100 // Get more events to find the specific evaluation
    });
    
    // Find the specific evaluation by evaluation_id
    const evaluationEvent = evaluationEvents.find((e: any) => e.data?.evaluation_id === evaluationId);
    
    if (!evaluationEvent) {
      return addCorsHeaders({
        statusCode: 404,
        body: JSON.stringify({ error: 'Evaluation not found' })
      });
    }
    
    const accountId = evaluationEvent.accountId;
    const traceId = evaluationEvent.traceId;
    
    // Check if decision was proposed (evaluation completed)
    // Query by account and look for decision with matching evaluation_id or trace_id
    const decisionEvents = await ledgerService.query({
      tenantId,
      accountId,
      eventType: LedgerEventType.DECISION_PROPOSED,
      limit: 50
    });
    
    // Find decision that matches this evaluation (by evaluation_id in data or trace_id)
    const relatedDecision = decisionEvents.find((d: any) => 
      d.data?.evaluation_id === evaluationId || 
      d.traceId === traceId
    );
    
    if (relatedDecision && relatedDecision.data?.decision_id) {
      // Evaluation completed - fetch the proposal
      const proposal = await decisionProposalStore.getProposal(
        relatedDecision.data.decision_id,
        tenantId
      );
      
      return addCorsHeaders({
        statusCode: 200,
        body: JSON.stringify({
          evaluation_id: evaluationId,
          status: 'COMPLETED',
          decision_id: relatedDecision.data.decision_id,
          decision: proposal,
          created_at: evaluationEvent.timestamp,
          completed_at: relatedDecision.timestamp
        })
      });
    }
    
    // Evaluation still pending
    return addCorsHeaders({
      statusCode: 200,
      body: JSON.stringify({
        evaluation_id: evaluationId,
        status: 'PENDING',
        created_at: evaluationEvent.timestamp,
        message: 'Decision evaluation in progress'
      })
    });
  } catch (error) {
    logger.error('Failed to get evaluation status', { evaluationId, tenantId, error });
    return addCorsHeaders({
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error' })
    });
  }
}

/**
 * Main handler - routes API Gateway requests to appropriate handler functions
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const { httpMethod, resource, path, pathParameters } = event;
  const route = resource || path;

  logger.info('API request received', {
    httpMethod,
    route,
    resource,
    path,
  });

  try {
    // Route based on HTTP method and path pattern
    // POST /decisions/evaluate
    if (httpMethod === 'POST' && (route === '/decisions/evaluate' || route.endsWith('/decisions/evaluate'))) {
      return await evaluateDecisionHandler(event);
    }
    // GET /decisions/{evaluation_id}/status
    else if (httpMethod === 'GET' && pathParameters?.evaluation_id && route.includes('/decisions/') && route.includes('/status')) {
      return await getEvaluationStatusHandler(event);
    }
    // GET /accounts/{account_id}/decisions
    else if (httpMethod === 'GET' && pathParameters?.account_id && (route.includes('/accounts/') && route.includes('/decisions'))) {
      return await getAccountDecisionsHandler(event);
    }
    // POST /actions/{action_id}/approve
    else if (httpMethod === 'POST' && pathParameters?.action_id && route.includes('/approve')) {
      return await approveActionHandler(event);
    }
    // POST /actions/{action_id}/reject
    else if (httpMethod === 'POST' && pathParameters?.action_id && route.includes('/reject')) {
      return await rejectActionHandler(event);
    }
    else {
      logger.warn('Unknown route', { httpMethod, route, resource, path });
      return addCorsHeaders({
        statusCode: 404,
        body: JSON.stringify({ error: 'Not found', path: route })
      });
    }
  } catch (error) {
    logger.error('Handler routing failed', { error, httpMethod, route, resource, path });
    return addCorsHeaders({
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error' })
    });
  }
};
