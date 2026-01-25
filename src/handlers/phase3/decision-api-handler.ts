/**
 * Decision API Handler - Phase 3
 * 
 * API endpoints for decision evaluation and approval.
 */

import { Handler, APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Logger } from '../../services/core/Logger';
import { TraceService } from '../../services/core/TraceService';
import { DecisionTriggerService } from '../../services/decision/DecisionTriggerService';
import { DecisionContextAssembler } from '../../services/decision/DecisionContextAssembler';
import { DecisionSynthesisService } from '../../services/decision/DecisionSynthesisService';
import { PolicyGateService } from '../../services/decision/PolicyGateService';
import { CostBudgetService } from '../../services/decision/CostBudgetService';
import { ActionIntentService } from '../../services/decision/ActionIntentService';
import { DecisionProposalStore } from '../../services/decision/DecisionProposalStore';
import { AccountPostureStateService } from '../../services/synthesis/AccountPostureStateService';
import { SignalService } from '../../services/perception/SignalService';
import { GraphService } from '../../services/graph/GraphService';
import { NeptuneConnection } from '../../services/graph/NeptuneConnection';
import { TenantService } from '../../services/core/TenantService';
import { LedgerService } from '../../services/ledger/LedgerService';
import { DecisionTriggerType } from '../../types/DecisionTriggerTypes';
import { LedgerEventType } from '../../types/LedgerTypes';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { getAWSClientConfig } from '../../utils/aws-client-config';

const logger = new Logger('DecisionAPIHandler');
const traceService = new TraceService(logger);

// Initialize AWS clients
const region = process.env.AWS_REGION || 'us-west-2';
const clientConfig = getAWSClientConfig(region);
const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient(clientConfig));
const bedrockClient = new BedrockRuntimeClient(clientConfig);

// Initialize services
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
// Initialize Neptune connection (singleton pattern - initialization happens lazily on first use)
const neptuneConnection = NeptuneConnection.getInstance();
// Initialize connection (will be called lazily on first use if not called here)
// Note: initialize() is async, but we can't use top-level await in Lambda handlers
// Connection will be initialized on first getTraversal() call if not initialized here
neptuneConnection.initialize({
  endpoint: process.env.NEPTUNE_ENDPOINT || '',
  port: parseInt(process.env.NEPTUNE_PORT || '8182'),
  region,
}).catch(err => {
  logger.warn('Neptune connection initialization deferred', { error: err });
});
const graphService = new GraphService(neptuneConnection);
const tenantService = new TenantService(logger, process.env.TENANTS_TABLE_NAME || 'cc-native-tenants', region);

const decisionTriggerService = new DecisionTriggerService(
  accountPostureStateService,
  signalService,
  logger
);
const decisionContextAssembler = new DecisionContextAssembler(
  accountPostureStateService,
  signalService,
  graphService,
  tenantService,
  logger
);
const decisionSynthesisService = new DecisionSynthesisService(
  bedrockClient,
  process.env.BEDROCK_MODEL_ID || 'anthropic.claude-3-5-sonnet-20241022-v2:0',
  logger
);
const policyGateService = new PolicyGateService(logger);
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
 * Trigger decision evaluation for an account
 */
export async function evaluateDecisionHandler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const traceId = traceService.generateTraceId();
  const { account_id, tenant_id, trigger_type } = JSON.parse(event.body || '{}');
  
  try {
    // 1. Check trigger
    const triggerResult = await decisionTriggerService.shouldTriggerDecision(
      account_id,
      tenant_id,
      trigger_type as DecisionTriggerType
    );
    
    if (!triggerResult.should_evaluate) {
      return {
        statusCode: 200,
        body: JSON.stringify({ message: 'Decision not triggered', reason: triggerResult.reason })
      };
    }
    
    // 2. Check budget
    const budgetResult = await costBudgetService.canEvaluateDecision(account_id, tenant_id);
    
    if (!budgetResult.allowed) {
      return {
        statusCode: 429,
        body: JSON.stringify({ message: 'Budget exceeded', reason: budgetResult.reason })
      };
    }
    
    // 3. Assemble context
    const context = await decisionContextAssembler.assembleContext(account_id, tenant_id, traceId);
    
    // 4. Synthesize decision
    const proposal = await decisionSynthesisService.synthesizeDecision(context);
    
    // 5. Evaluate policy
    const policyResults = await policyGateService.evaluateDecisionProposal(proposal, context.policy_context);
    
    // 6. Consume budget
    await costBudgetService.consumeBudget(account_id, tenant_id, 1);
    
    // 7. Store proposal in DecisionProposalTable (authoritative storage for approval/rejection flow)
    await decisionProposalStore.storeProposal(proposal);
    
    // 8. Log to ledger
    await ledgerService.append({
      eventType: LedgerEventType.DECISION_PROPOSED,
      tenantId: tenant_id,
      accountId: account_id,
      traceId,
      data: {
        decision_id: proposal.decision_id,
        decision_type: proposal.decision_type,
        action_count: proposal.actions?.length || 0
      }
    });
    
    return {
      statusCode: 200,
      body: JSON.stringify({
        decision: proposal,
        policy_evaluations: policyResults
      })
    };
  } catch (error) {
    logger.error('Decision evaluation failed', { account_id, tenant_id, error });
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
}

/**
 * GET /accounts/{id}/decisions
 * Get decision history for an account
 */
export async function getAccountDecisionsHandler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const accountId = event.pathParameters?.account_id;
  const tenantId = event.headers['x-tenant-id'];
  
  if (!accountId || !tenantId) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Missing account_id or tenant_id' })
    };
  }
  
  try {
    // Query ledger for DECISION_PROPOSED events
    const decisions = await ledgerService.query({
      tenantId,
      accountId,
      eventType: LedgerEventType.DECISION_PROPOSED,
      limit: 50
    });
    
    return {
      statusCode: 200,
      body: JSON.stringify({ decisions })
    };
  } catch (error) {
    logger.error('Failed to get account decisions', { accountId, tenantId, error });
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error' })
    };
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
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Missing required fields: action_id, decision_id, tenant_id' })
    };
  }
  
  try {
    // CRITICAL: Do not trust client payload. Load proposal from server storage.
    const proposal = await decisionProposalStore.getProposal(decision_id, tenantId);
    
    if (!proposal) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Decision not found' })
      };
    }
    
    // Find the specific action proposal by action_ref (proposal identifier)
    const actionProposal = proposal.actions.find(a => a.action_ref === actionId);
    if (!actionProposal) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Action proposal not found in decision' })
      };
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
    
    return {
      statusCode: 200,
      body: JSON.stringify({ intent })
    };
  } catch (error) {
    logger.error('Action approval failed', { actionId, decision_id, tenantId, error });
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error' })
    };
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
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Missing required fields: action_id, decision_id, tenant_id' })
    };
  }
  
  try {
    // CRITICAL: Do not trust client payload. Load proposal from server storage.
    const proposal = await decisionProposalStore.getProposal(decision_id, tenantId);
    
    if (!proposal) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Decision not found' })
      };
    }
    
    // Find the specific action proposal by action_ref (proposal identifier)
    const actionProposal = proposal.actions.find(a => a.action_ref === actionId);
    if (!actionProposal) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Action proposal not found in decision' })
      };
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
    
    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Action rejected' })
    };
  } catch (error) {
    logger.error('Action rejection failed', { actionId, decision_id, tenantId, error });
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
}
