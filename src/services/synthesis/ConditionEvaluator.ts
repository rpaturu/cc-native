/**
 * Condition Evaluator - Phase 2
 * 
 * Evaluates rule conditions against active signals.
 * All evaluation is deterministic (same inputs → same outputs).
 */

import { Signal, SignalType, SignalStatus } from '../../types/SignalTypes';
import {
  RuleConditions,
  SignalCondition,
  PropertyPredicate,
  ComputedPredicate,
} from './RulesetLoader';
import { Logger } from '../core/Logger';

const logger = new Logger('ConditionEvaluator');

/**
 * Engagement signal types (canonical list)
 */
const ENGAGEMENT_SIGNAL_TYPES: SignalType[] = [
  SignalType.FIRST_ENGAGEMENT_OCCURRED,
  SignalType.ACCOUNT_ACTIVATION_DETECTED,
];

/**
 * Condition Evaluator
 */
export class ConditionEvaluator {
  /**
   * Evaluate rule conditions against active signals
   */
  static evaluateConditions(
    conditions: RuleConditions,
    activeSignals: Signal[],
    eventTime: string
  ): boolean {
    // Match-all rule (empty conditions)
    if (conditions.conditions && Object.keys(conditions.conditions).length === 0) {
      return true;
    }

    // Evaluate required signals (all must match)
    if (conditions.required_signals) {
      for (const required of conditions.required_signals) {
        if (!this.evaluateRequiredSignal(required, activeSignals, eventTime)) {
          return false;
        }
      }
    }

    // Evaluate excluded signals (none must match)
    if (conditions.excluded_signals) {
      for (const excluded of conditions.excluded_signals) {
        if (this.evaluateRequiredSignal(excluded, activeSignals, eventTime)) {
          return false; // Excluded signal found
        }
      }
    }

    // Evaluate computed predicates (all must match)
    if (conditions.computed_predicates) {
      for (const predicate of conditions.computed_predicates) {
        if (!this.evaluateComputedPredicate(predicate, activeSignals, eventTime)) {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * Evaluate required signal condition
   */
  private static evaluateRequiredSignal(
    condition: SignalCondition,
    activeSignals: Signal[],
    eventTime: string
  ): boolean {
    // Find matching signals by type and status
    const matchingSignals = activeSignals.filter(
      (signal) =>
        signal.signalType === condition.signal_type &&
        signal.status === condition.status
    );

    if (matchingSignals.length === 0) {
      return false;
    }

    // If where clause exists, evaluate property predicates
    if (condition.where && condition.where.length > 0) {
      // At least one matching signal must satisfy all where predicates
      for (const signal of matchingSignals) {
        if (this.evaluateWhereClause(signal, condition.where, eventTime)) {
          return true; // Found at least one signal that matches
        }
      }
      return false; // No signal matched all where predicates
    }

    return true; // Signal type and status matched, no where clause
  }

  /**
   * Evaluate where clause (property predicates)
   */
  static evaluateWhereClause(
    signal: Signal,
    whereClause: PropertyPredicate[],
    eventTime: string
  ): boolean {
    for (const predicate of whereClause) {
      if (!this.evaluatePropertyPredicate(signal, predicate, eventTime)) {
        return false; // At least one predicate failed
      }
    }
    return true; // All predicates passed
  }

  /**
   * Evaluate property predicate
   */
  private static evaluatePropertyPredicate(
    signal: Signal,
    predicate: PropertyPredicate,
    eventTime: string
  ): boolean {
    const value = this.getPropertyValue(signal, predicate.property);

    switch (predicate.operator) {
      case 'equals':
        return value === predicate.value;

      case 'greater_than':
        return typeof value === 'number' && value > (predicate.value as number);

      case 'less_than':
        return typeof value === 'number' && value < (predicate.value as number);

      case 'less_than_or_equal':
        return typeof value === 'number' && value <= (predicate.value as number);

      case 'within_last_days':
        if (predicate.property === 'createdAt') {
          const signalTime = new Date(signal.createdAt).getTime();
          const eventTimeMs = new Date(eventTime).getTime();
          const daysAgo = (eventTimeMs - signalTime) / (1000 * 60 * 60 * 24);
          return daysAgo <= (predicate.value as number) && daysAgo >= 0;
        }
        return false;

      case 'in':
        return Array.isArray(predicate.value) && predicate.value.includes(value);

      case 'exists':
        return value !== undefined && value !== null;

      case 'not_exists':
        return value === undefined || value === null;

      default:
        logger.warn('Unknown predicate operator', { operator: predicate.operator });
        return false;
    }
  }

  /**
   * Get property value from signal
   * 
   * Supports:
   * - "createdAt" for time-based comparisons
   * - "context.{property_name}" for context properties
   * - "metadata.{property_name}" for metadata properties
   */
  private static getPropertyValue(signal: Signal, propertyPath: string): any {
    if (propertyPath === 'createdAt') {
      return signal.createdAt;
    }

    if (propertyPath.startsWith('context.')) {
      const key = propertyPath.replace('context.', '');
      return signal.context?.[key];
    }

    if (propertyPath.startsWith('metadata.')) {
      const key = propertyPath.replace('metadata.', '');
      return signal.metadata?.[key as keyof typeof signal.metadata];
    }

    // Direct property access
    return (signal as any)[propertyPath];
  }

  /**
   * Evaluate computed predicate
   */
  static evaluateComputedPredicate(
    predicate: ComputedPredicate,
    activeSignals: Signal[],
    eventTime: string
  ): boolean {
    switch (predicate.name) {
      case 'no_engagement_in_days':
        return this.evaluateNoEngagementInDays(
          activeSignals,
          eventTime,
          predicate.params.days || 30
        );

      case 'has_engagement_in_days':
        return this.evaluateHasEngagementInDays(
          activeSignals,
          eventTime,
          predicate.params.days || 30
        );

      default:
        logger.warn('Unknown computed predicate', { name: predicate.name });
        return false;
    }
  }

  /**
   * Evaluate: no engagement signals in last N days
   */
  private static evaluateNoEngagementInDays(
    activeSignals: Signal[],
    eventTime: string,
    days: number
  ): boolean {
    const eventTimeMs = new Date(eventTime).getTime();
    const cutoffTime = eventTimeMs - days * 24 * 60 * 60 * 1000;

    // Check if any engagement signals exist in the time window
    const hasEngagement = activeSignals.some((signal) => {
      if (!ENGAGEMENT_SIGNAL_TYPES.includes(signal.signalType)) {
        return false;
      }

      const signalTime = new Date(signal.createdAt).getTime();
      return signalTime >= cutoffTime && signalTime <= eventTimeMs;
    });

    return !hasEngagement; // No engagement = true
  }

  /**
   * Evaluate: has engagement signals in last N days
   */
  private static evaluateHasEngagementInDays(
    activeSignals: Signal[],
    eventTime: string,
    days: number
  ): boolean {
    const eventTimeMs = new Date(eventTime).getTime();
    const cutoffTime = eventTimeMs - days * 24 * 60 * 60 * 1000;

    // Check if any engagement signals exist in the time window
    return activeSignals.some((signal) => {
      if (!ENGAGEMENT_SIGNAL_TYPES.includes(signal.signalType)) {
        return false;
      }

      const signalTime = new Date(signal.createdAt).getTime();
      return signalTime >= cutoffTime && signalTime <= eventTimeMs;
    });
  }
}
