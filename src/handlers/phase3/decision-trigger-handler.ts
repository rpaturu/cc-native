/**
 * Decision Trigger Handler - Phase 3
 * 
 * Handle event-driven decision triggers (lifecycle transitions, high-signal events).
 */

import { Handler } from 'aws-lambda';
import { Logger } from '../../services/core/Logger';
import { TraceService } from '../../services/core/TraceService';
import { DecisionTriggerService } from '../../services/decision/DecisionTriggerService';
import { AccountPostureStateService } from '../../services/synthesis/AccountPostureStateService';
import { SignalService } from '../../services/perception/SignalService';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { DecisionTriggerType } from '../../types/DecisionTriggerTypes';
import { SignalType } from '../../types/SignalTypes';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { getAWSClientConfig } from '../../utils/aws-client-config';

const logger = new Logger('DecisionTriggerHandler');
const traceService = new TraceService(logger);

// Initialize AWS clients
const region = process.env.AWS_REGION || 'us-west-2';
const clientConfig = getAWSClientConfig(region);
const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient(clientConfig));
const eventBridgeClient = new EventBridgeClient(clientConfig);

// Initialize services
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
  ledgerService: null as any,
  region
});

const decisionTriggerService = new DecisionTriggerService(
  accountPostureStateService,
  signalService,
  logger
);

/**
 * EventBridge event envelope
 */
interface EventEnvelope {
  source: string;
  'detail-type': string;
  detail: Record<string, any>;
  id?: string;
  time?: string;
}

/**
 * Decision Trigger Handler
 */
export const handler: Handler<EventEnvelope> = async (event, context) => {
  const envelope = event;
  const { account_id, tenant_id } = envelope.detail;
  
  logger.info('Decision trigger handler invoked', {
    source: envelope.source,
    detailType: envelope['detail-type'],
    accountId: account_id,
    tenantId: tenant_id,
  });
  
  try {
    // Check if trigger is valid
    const triggerType = inferTriggerType(envelope);
    
    if (!triggerType) {
      logger.warn('Unknown trigger event, blocking', { 
        account_id, 
        detailType: envelope['detail-type'],
        source: envelope.source 
      });
      return; // Block unknown events
    }
    
    const triggerResult = await decisionTriggerService.shouldTriggerDecision(
      account_id,
      tenant_id,
      triggerType,
      envelope.id
    );
    
    if (!triggerResult.should_evaluate) {
      logger.info('Decision not triggered', { account_id, reason: triggerResult.reason });
      return;
    }
    
    // Trigger decision evaluation (async, via EventBridge)
    await eventBridgeClient.send(new PutEventsCommand({
      Entries: [{
        Source: 'cc-native.decision',
        DetailType: 'DECISION_EVALUATION_REQUESTED',
        Detail: JSON.stringify({
          account_id,
          tenant_id,
          trigger_type: triggerType,
          trigger_event_id: envelope.id
        }),
        EventBusName: process.env.EVENT_BUS_NAME || 'cc-native-events'
      }]
    }));
    
    logger.info('Decision evaluation requested', { account_id, tenant_id, triggerType });
  } catch (error) {
    logger.error('Decision trigger handler failed', { account_id, tenant_id, error });
    throw error;
  }
};

/**
 * Infer trigger type from event envelope
 */
function inferTriggerType(envelope: EventEnvelope): DecisionTriggerType | null {
  if (envelope['detail-type'] === 'LIFECYCLE_STATE_CHANGED') {
    return DecisionTriggerType.LIFECYCLE_TRANSITION;
  }
  
  if (envelope['detail-type'] === 'SIGNAL_DETECTED') {
    const signalType = envelope.detail.signal_type;
    const highSignalTypes = [
      SignalType.RENEWAL_WINDOW_ENTERED,
      SignalType.SUPPORT_RISK_EMERGING,
      SignalType.USAGE_TREND_CHANGE
    ];
    
    if (highSignalTypes.includes(signalType)) {
      return DecisionTriggerType.HIGH_SIGNAL_ARRIVAL;
    }
  }
  
  // Only allow periodic triggers from scheduler events we control
  if (envelope.source === 'cc-native.scheduler' && envelope['detail-type'] === 'PERIODIC_DECISION_EVALUATION') {
    return DecisionTriggerType.COOLDOWN_GATED_PERIODIC;
  }
  
  // Unknown event - return null to block
  return null;
}
