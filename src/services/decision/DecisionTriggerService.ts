/**
 * Decision Trigger Service - Phase 3
 * 
 * Evaluates whether a decision should be triggered for an account.
 * Enforces cooldown periods and validates trigger types.
 */

import { DecisionTriggerType, TriggerEvaluationResult } from '../../types/DecisionTriggerTypes';
import { AccountPostureStateService } from '../synthesis/AccountPostureStateService';
import { SignalService } from '../perception/SignalService';
import { Logger } from '../core/Logger';

/**
 * Decision Trigger Service
 */
export class DecisionTriggerService {
  constructor(
    private accountPostureStateService: AccountPostureStateService,
    private signalService: SignalService,
    private logger: Logger
  ) {}

  /**
   * Evaluate if decision should be triggered
   * Returns should_evaluate=true only if:
   * - Explicit trigger event (lifecycle transition, high-signal)
   * - User-initiated request
   * - Cooldown period has passed (24 hours)
   */
  async shouldTriggerDecision(
    accountId: string,
    tenantId: string,
    triggerType: DecisionTriggerType,
    triggerEventId?: string
  ): Promise<TriggerEvaluationResult> {
    // Check cooldown (24-hour window)
    const postureState = await this.accountPostureStateService.getPostureState(
      accountId,
      tenantId
    );
    
    if (postureState?.evaluated_at) {
      const lastEvaluation = new Date(postureState.evaluated_at);
      const cooldownUntil = new Date(lastEvaluation.getTime() + 24 * 60 * 60 * 1000);
      
      if (new Date() < cooldownUntil && triggerType !== DecisionTriggerType.EXPLICIT_USER_REQUEST) {
        return {
          should_evaluate: false,
          reason: 'COOLDOWN_ACTIVE',
          cooldown_until: cooldownUntil.toISOString()
        };
      }
    }
    
    // Event-driven triggers (lifecycle transition, high-signal)
    if (triggerType === DecisionTriggerType.LIFECYCLE_TRANSITION ||
        triggerType === DecisionTriggerType.HIGH_SIGNAL_ARRIVAL) {
      return {
        should_evaluate: true,
        reason: `TRIGGERED_BY_${triggerType}`
      };
    }
    
    // User-initiated (always allowed, bypasses cooldown)
    if (triggerType === DecisionTriggerType.EXPLICIT_USER_REQUEST) {
      return {
        should_evaluate: true,
        reason: 'USER_REQUESTED'
      };
    }
    
    // Cooldown-gated periodic (only if cooldown passed)
    if (triggerType === DecisionTriggerType.COOLDOWN_GATED_PERIODIC) {
      return {
        should_evaluate: true,
        reason: 'COOLDOWN_EXPIRED'
      };
    }
    
    return {
      should_evaluate: false,
      reason: 'NO_TRIGGER_CONDITION_MET'
    };
  }
}
