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
const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient(clientConfig), {
  marshallOptions: {
    removeUndefinedValues: true,
  },
});
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
// Get model ID from environment (set by CDK from config)
const bedrockModelId = process.env.BEDROCK_MODEL_ID || 'anthropic.claude-3-5-sonnet-20241022-v2:0';
logger.info('Initializing DecisionSynthesisService', { bedrockModelId });
const decisionSynthesisService = new DecisionSynthesisService(
  bedrockClient,
  bedrockModelId,
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
  evaluation_id?: string; // Optional: provided by API handler for tracking
  trace_id?: string; // Optional: provided by API handler for trace continuity
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
  const { account_id, tenant_id, trigger_type, evaluation_id, trace_id } = event.detail;
  // Use provided trace_id (from API handler) or generate new one
  const traceId = trace_id || traceService.generateTraceId();
  
  const startTime = Date.now();
  logger.info('Decision evaluation handler invoked', {
    accountId: account_id,
    tenantId: tenant_id,
    triggerType: trigger_type,
    evaluationId: evaluation_id,
    traceId,
  });
  
  try {
    // 1. Assemble context
    const contextStartTime = Date.now();
    const contextData = await decisionContextAssembler.assembleContext(account_id, tenant_id, traceId);
    const contextDuration = Date.now() - contextStartTime;
    logger.info('Context assembly completed', { durationMs: contextDuration });
    
    // 2. Check budget
    const budgetStartTime = Date.now();
    const budgetResult = await costBudgetService.canEvaluateDecision(account_id, tenant_id);
    const budgetDuration = Date.now() - budgetStartTime;
    logger.info('Budget check completed', { durationMs: budgetDuration, allowed: budgetResult.allowed });
    
    if (!budgetResult.allowed) {
      logger.warn('Decision evaluation blocked by budget', { account_id, reason: budgetResult.reason });
      return;
    }
    
    // 3. Synthesize decision (SLOWEST OPERATION - Bedrock LLM call)
    const synthesisStartTime = Date.now();
    const proposal = await decisionSynthesisService.synthesizeDecision(contextData);
    const synthesisDuration = Date.now() - synthesisStartTime;
    logger.info('Decision synthesis completed', { durationMs: synthesisDuration, decisionType: proposal.decision_type });
    
    // 4. Evaluate policy
    const policyStartTime = Date.now();
    const policyResults = await policyGateService.evaluateDecisionProposal(proposal, contextData.policy_context);
    const policyDuration = Date.now() - policyStartTime;
    logger.info('Policy evaluation completed', { durationMs: policyDuration, resultCount: policyResults.length });
    
    // 5. Consume budget
    const consumeStartTime = Date.now();
    await costBudgetService.consumeBudget(account_id, tenant_id, 1);
    const consumeDuration = Date.now() - consumeStartTime;
    logger.info('Budget consumption completed', { durationMs: consumeDuration });
    
    // 6. Store proposal in DecisionProposalTable (authoritative storage for approval/rejection flow)
    const storeStartTime = Date.now();
    await decisionProposalStore.storeProposal(proposal);
    const storeDuration = Date.now() - storeStartTime;
    logger.info('Proposal storage completed', { durationMs: storeDuration });
    
    // 7. Log to ledger
    const ledgerStartTime = Date.now();
    await ledgerService.append({
      eventType: LedgerEventType.DECISION_PROPOSED,
      tenantId: tenant_id,
      accountId: account_id,
      traceId,
      data: {
        decision_id: proposal.decision_id,
        decision_type: proposal.decision_type,
        action_count: proposal.actions?.length || 0,
        evaluation_id: evaluation_id, // Link back to evaluation request
      }
    });
    const ledgerDuration = Date.now() - ledgerStartTime;
    logger.info('Ledger append completed', { durationMs: ledgerDuration });
    
    // 8. Log policy evaluations
    const policyLogStartTime = Date.now();
    for (const result of policyResults) {
      await ledgerService.append({
        eventType: LedgerEventType.POLICY_EVALUATED,
        tenantId: tenant_id,
        accountId: account_id,
        traceId,
        data: result
      });
    }
    const policyLogDuration = Date.now() - policyLogStartTime;
    logger.info('Policy evaluation logging completed', { durationMs: policyLogDuration });
    
    // 9. Emit DECISION_PROPOSED event (for UI/approval flow)
    const eventStartTime = Date.now();
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
    const eventDuration = Date.now() - eventStartTime;
    logger.info('EventBridge event emitted', { durationMs: eventDuration });
    
    const totalDuration = Date.now() - startTime;
    logger.info('Decision evaluation completed', {
      accountId: account_id,
      tenantId: tenant_id,
      decisionId: proposal.decision_id,
      actionCount: proposal.actions?.length || 0,
      totalDurationMs: totalDuration,
      breakdown: {
        context: contextDuration,
        budget: budgetDuration,
        synthesis: synthesisDuration,
        policy: policyDuration,
        consume: consumeDuration,
        store: storeDuration,
        ledger: ledgerDuration,
        policyLog: policyLogDuration,
        event: eventDuration
      }
    });
  } catch (error) {
    logger.error('Decision evaluation failed', { account_id, tenant_id, error });
    // Send to DLQ (EventBridge will handle retries and DLQ)
    throw error;
  }
};
