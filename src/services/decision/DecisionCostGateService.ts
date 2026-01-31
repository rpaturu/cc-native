/**
 * Decision Cost Gate Service - Phase 5.2
 *
 * Deterministic pre-Phase-3 gate: ALLOW | DEFER | SKIP. Same input → same output.
 * Run-count budget and recency (from DecisionRunState) drive the decision.
 */

import { Logger } from '../core/Logger';
import {
  DecisionCostGateInputV1,
  DecisionCostGateOutputV1,
  DecisionTriggerRegistryEntryV1,
  DecisionTriggerType,
} from '../../types/decision/DecisionTriggerTypes';

/**
 * Default trigger registry: cooldown and debounce per trigger type.
 */
export const DEFAULT_TRIGGER_REGISTRY: Record<
  DecisionTriggerType,
  DecisionTriggerRegistryEntryV1
> = {
  SIGNAL_ARRIVED: {
    trigger_type: 'SIGNAL_ARRIVED',
    debounce_seconds: 60,
    cooldown_seconds: 300,
    max_per_account_per_hour: 12,
  },
  LIFECYCLE_STATE_CHANGE: {
    trigger_type: 'LIFECYCLE_STATE_CHANGE',
    debounce_seconds: 120,
    cooldown_seconds: 600,
    max_per_account_per_hour: 6,
  },
  POSTURE_CHANGE: {
    trigger_type: 'POSTURE_CHANGE',
    debounce_seconds: 120,
    cooldown_seconds: 600,
    max_per_account_per_hour: 6,
  },
  TIME_RITUAL_DAILY_BRIEF: {
    trigger_type: 'TIME_RITUAL_DAILY_BRIEF',
    debounce_seconds: 0,
    cooldown_seconds: 86400,
    max_per_account_per_hour: 1,
  },
  TIME_RITUAL_WEEKLY_REVIEW: {
    trigger_type: 'TIME_RITUAL_WEEKLY_REVIEW',
    debounce_seconds: 0,
    cooldown_seconds: 604800,
    max_per_account_per_hour: 1,
  },
  TIME_RITUAL_RENEWAL_RUNWAY: {
    trigger_type: 'TIME_RITUAL_RENEWAL_RUNWAY',
    debounce_seconds: 0,
    cooldown_seconds: 86400,
    max_per_account_per_hour: 2,
  },
};

export class DecisionCostGateService {
  constructor(
    private logger: Logger,
    private getRegistryEntry?: (
      triggerType: DecisionTriggerType
    ) => DecisionTriggerRegistryEntryV1 | null
  ) {}

  /**
   * Evaluate cost gate. Deterministic: same input → same output.
   * Call after IdempotencyStore reserve and RunState admission lock (plan: lock first, then CostGate).
   */
  evaluate(input: DecisionCostGateInputV1): DecisionCostGateOutputV1 {
    const evaluatedAt = new Date().toISOString();
    const nowEpoch = Math.floor(Date.now() / 1000);
    const registry = this.getRegistryEntry
      ? this.getRegistryEntry(input.trigger_type)
      : DEFAULT_TRIGGER_REGISTRY[input.trigger_type];

    if (!registry) {
      this.logger.warn('Unknown trigger type, skipping', {
        trigger_type: input.trigger_type,
      });
      return {
        result: 'SKIP',
        reason: 'UNKNOWN_TRIGGER_TYPE',
        explanation: `Trigger type ${input.trigger_type} not in registry`,
        evaluated_at: evaluatedAt,
      };
    }

    if (
      input.budget_remaining != null &&
      input.budget_remaining <= 0
    ) {
      return {
        result: 'SKIP',
        reason: 'BUDGET_EXHAUSTED',
        explanation: 'Run-count budget exhausted',
        evaluated_at: evaluatedAt,
      };
    }

    if (input.recency_last_run_epoch != null && registry.cooldown_seconds > 0) {
      const elapsed = nowEpoch - input.recency_last_run_epoch;
      if (elapsed < registry.cooldown_seconds) {
        const retryAfterSeconds = registry.cooldown_seconds - elapsed;
        const deferUntilEpoch =
          input.recency_last_run_epoch + registry.cooldown_seconds;
        return {
          result: 'DEFER',
          reason: 'COOLDOWN',
          explanation: `Cooldown: ${retryAfterSeconds}s remaining`,
          evaluated_at: evaluatedAt,
          defer_until_epoch: deferUntilEpoch,
          retry_after_seconds: retryAfterSeconds,
        };
      }
    }

    if (
      input.action_saturation_score != null &&
      input.action_saturation_score >= 1
    ) {
      return {
        result: 'SKIP',
        reason: 'MARGINAL_VALUE_LOW',
        explanation: 'Action saturation high; skip this cycle',
        evaluated_at: evaluatedAt,
      };
    }

    return {
      result: 'ALLOW',
      evaluated_at: evaluatedAt,
    };
  }
}
