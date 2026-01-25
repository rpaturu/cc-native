/**
 * Decision Evaluation Handler - Phase 3
 * 
 * Handle DECISION_EVALUATION_REQUESTED events and orchestrate decision synthesis.
 */

import { Handler } from 'aws-lambda';
import { Logger } from '../../services/core/Logger';
import { TraceService } from '../../services/core/TraceService';
import { DecisionContextAssembler } from '../../services/decision/DecisionContextAssembler';
import { DecisionSynthesisService } from '../../services/decision/DecisionSynthesisService';
import { PolicyGateService } from '../../services/decision/PolicyGateService';
import { CostBudgetService } from '../../services/decision/CostBudgetService';
import { DecisionProposalStore } from '../../services/decision/DecisionProposalStore';
import { AccountPostureStateService } from '../../services/synthesis/AccountPostureStateService';
import { SignalService } from '../../services/perception/SignalService';
import { GraphService } from '../../services/graph/GraphService';
import { NeptuneConnection } from '../../services/graph/NeptuneConnection';
import { TenantService } from '../../services/core/TenantService';
import { LedgerService } from '../../services/ledger/LedgerService';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { LedgerEventType } from '../../types/LedgerTypes';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { getAWSClientConfig } from '../../utils/aws-client-config';

const logger = new Logger('DecisionEvaluationHandler');
const traceService = new TraceService(logger);

// Initialize AWS clients
const region = process.env.AWS_REGION || 'us-west-2';
const clientConfig = getAWSClientConfig(region);
const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient(clientConfig));
const bedrockClient = new BedrockRuntimeClient(clientConfig);
const eventBridgeClient = new EventBridgeClient(clientConfig);

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
  lifecycleStateService: null as any,
  eventPublisher: null as any,
  ledgerService,
  region
});
// Initialize Neptune connection (singleton pattern)
const neptuneConnection = NeptuneConnection.getInstance();
// Note: initialize() is called lazily on first use, but we can call it here for explicit initialization
neptuneConnection.initialize({
  endpoint: process.env.NEPTUNE_ENDPOINT || '',
  port: parseInt(process.env.NEPTUNE_PORT || '8182'),
  region,
}).catch(err => {
  logger.warn('Neptune connection initialization deferred', { error: err });
});
const graphService = new GraphService(neptuneConnection);
const tenantService = new TenantService(logger, process.env.TENANTS_TABLE_NAME || 'cc-native-tenants', region);

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
const decisionProposalStore = new DecisionProposalStore(
  dynamoClient,
  process.env.DECISION_PROPOSAL_TABLE_NAME || 'cc-native-decision-proposal',
  logger
);

/**
 * EventBridge event detail for DECISION_EVALUATION_REQUESTED
 */
interface DecisionEvaluationRequestedDetail {
  account_id: string;
  tenant_id: string;
  trigger_type: string;
  trigger_event_id?: string;
}

/**
 * EventBridge event envelope
 */
interface EventBridgeEvent {
  source: string;
  'detail-type': string;
  detail: DecisionEvaluationRequestedDetail;
  time?: string;
  id?: string;
}

/**
 * Decision Evaluation Handler
 */
export const handler: Handler<EventBridgeEvent> = async (event, context) => {
  const { account_id, tenant_id, trigger_type } = event.detail;
  const traceId = traceService.generateTraceId();
  
  logger.info('Decision evaluation handler invoked', {
    accountId: account_id,
    tenantId: tenant_id,
    triggerType: trigger_type,
    traceId,
  });
  
  try {
    // 1. Assemble context
    const contextData = await decisionContextAssembler.assembleContext(account_id, tenant_id, traceId);
    
    // 2. Check budget
    const budgetResult = await costBudgetService.canEvaluateDecision(account_id, tenant_id);
    
    if (!budgetResult.allowed) {
      logger.warn('Decision evaluation blocked by budget', { account_id, reason: budgetResult.reason });
      return;
    }
    
    // 3. Synthesize decision
    const proposal = await decisionSynthesisService.synthesizeDecision(contextData);
    
    // 4. Evaluate policy
    const policyResults = await policyGateService.evaluateDecisionProposal(proposal, contextData.policy_context);
    
    // 5. Consume budget
    await costBudgetService.consumeBudget(account_id, tenant_id, 1);
    
    // 6. Store proposal in DecisionProposalTable (authoritative storage for approval/rejection flow)
    await decisionProposalStore.storeProposal(proposal);
    
    // 7. Log to ledger
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
    
    // 8. Log policy evaluations
    for (const result of policyResults) {
      await ledgerService.append({
        eventType: LedgerEventType.POLICY_EVALUATED,
        tenantId: tenant_id,
        accountId: account_id,
        traceId,
        data: result
      });
    }
    
    // 9. Emit DECISION_PROPOSED event (for UI/approval flow)
    await eventBridgeClient.send(new PutEventsCommand({
      Entries: [{
        Source: 'cc-native.decision',
        DetailType: 'DECISION_PROPOSED',
        Detail: JSON.stringify({
          decision: proposal,
          policy_evaluations: policyResults
        }),
        EventBusName: process.env.EVENT_BUS_NAME || 'cc-native-events'
      }]
    }));
    
    logger.info('Decision evaluation completed', {
      accountId: account_id,
      tenantId: tenant_id,
      decisionId: proposal.decision_id,
      actionCount: proposal.actions?.length || 0
    });
  } catch (error) {
    logger.error('Decision evaluation failed', { account_id, tenant_id, error });
    // Send to DLQ (EventBridge will handle retries and DLQ)
    throw error;
  }
};
