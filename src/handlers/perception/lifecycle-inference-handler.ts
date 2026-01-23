/**
 * Lifecycle Inference Handler
 * 
 * Lambda handler that infers lifecycle state from signals.
 * 
 * Event Flow:
 * 1. Receives SIGNAL_DETECTED event
 * 2. Gets AccountState read model (efficient point read)
 * 3. Infers lifecycle state using priority order (CUSTOMER → SUSPECT → PROSPECT)
 * 4. Checks if transition is needed
 * 5. Records transition if needed
 * 6. Applies suppression via SuppressionEngine
 * 7. Updates AccountState
 */

import { Handler } from 'aws-lambda';
import { Logger } from '../../services/core/Logger';
import { TraceService } from '../../services/core/TraceService';
import { LifecycleStateService } from '../../services/perception/LifecycleStateService';
import { SuppressionEngine } from '../../services/perception/SuppressionEngine';
import { SignalService } from '../../services/perception/SignalService';
import { LedgerService } from '../../services/ledger/LedgerService';
import { EventPublisher } from '../../services/events/EventPublisher';
import { LifecycleState } from '../../types/LifecycleTypes';
import { SignalType, SignalStatus } from '../../types/SignalTypes';

interface LifecycleInferenceEvent {
  accountId: string;
  tenantId: string;
  signalType: SignalType;
  traceId?: string;
}

/**
 * Lifecycle Inference Handler
 */
export const handler: Handler<LifecycleInferenceEvent> = async (event, context) => {
  const logger = new Logger('LifecycleInferenceHandler');
  const traceService = new TraceService(logger);
  const traceId = event.traceId || traceService.generateTraceId();

  logger.info('Lifecycle inference started', {
    accountId: event.accountId,
    tenantId: event.tenantId,
    signalType: event.signalType,
    traceId,
  });

  try {
    // Initialize services
    const ledgerService = new LedgerService(
      logger,
      process.env.LEDGER_TABLE_NAME || 'cc-native-ledger',
      process.env.AWS_REGION
    );
    const suppressionEngine = new SuppressionEngine({
      logger,
      ledgerService,
    });
    const lifecycleStateService = new LifecycleStateService({
      logger,
      accountsTableName: process.env.ACCOUNTS_TABLE_NAME || 'cc-native-accounts',
      ledgerService,
      suppressionEngine,
      region: process.env.AWS_REGION,
    });
    const signalService = new SignalService({
      logger,
      signalsTableName: process.env.SIGNALS_TABLE_NAME || 'cc-native-signals',
      accountsTableName: process.env.ACCOUNTS_TABLE_NAME || 'cc-native-accounts',
      lifecycleStateService,
      eventPublisher: new EventPublisher(
        logger,
        process.env.EVENT_BUS_NAME || 'cc-native-events',
        process.env.AWS_REGION
      ),
      ledgerService,
      region: process.env.AWS_REGION,
    });

    // Get current AccountState
    const accountState = await lifecycleStateService.getAccountState(
      event.accountId,
      event.tenantId
    );

    if (!accountState) {
      logger.warn('AccountState not found', {
        accountId: event.accountId,
        tenantId: event.tenantId,
      });
      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          message: 'AccountState not found, skipping inference',
        }),
      };
    }

    // Get active signals for account
    const activeSignals = await signalService.getSignalsForAccount(
      event.accountId,
      event.tenantId,
      { status: SignalStatus.ACTIVE }
    );

    // Apply precedence rules
    const precedenceResolvedSignals = await suppressionEngine.applyPrecedenceRules(activeSignals);

    // Infer current lifecycle state
    const currentState = await lifecycleStateService.inferLifecycleState(
      event.accountId,
      event.tenantId
    );

    const previousState = accountState.currentLifecycleState;

    // Check if transition is needed
    if (currentState !== previousState) {
      logger.info('Lifecycle transition detected', {
        accountId: event.accountId,
        fromState: previousState,
        toState: currentState,
        traceId,
      });

      // Get signals that triggered transition
      const triggeredBy = precedenceResolvedSignals
        .filter(s => s.status === SignalStatus.ACTIVE)
        .map(s => s.signalType);

      // Compute suppression set
      const suppressionSet = await suppressionEngine.computeSuppressionSet(
        event.accountId,
        event.tenantId,
        previousState,
        currentState,
        precedenceResolvedSignals
      );

      // Apply suppression
      await suppressionEngine.applySuppression(
        suppressionSet,
        signalService,
        event.tenantId
      );

      // Log suppression entries
      await suppressionEngine.logSuppressionEntries(
        suppressionSet,
        event.accountId,
        event.tenantId,
        traceId
      );

      // Record transition
      const transition = await lifecycleStateService.recordTransition(
        event.accountId,
        event.tenantId,
        previousState,
        currentState,
        triggeredBy,
        [], // Evidence refs - would extract from signals
        traceId
      );

      logger.info('Lifecycle transition recorded', {
        transitionId: transition.transitionId,
        fromState: previousState,
        toState: currentState,
        traceId,
      });
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        currentState,
        previousState,
        transitionOccurred: currentState !== previousState,
        traceId,
      }),
    };
  } catch (error) {
    logger.error('Lifecycle inference failed', {
      accountId: event.accountId,
      error: error instanceof Error ? error.message : String(error),
      traceId,
    });
    throw error;
  }
};
