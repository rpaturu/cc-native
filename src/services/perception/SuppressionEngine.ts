/**
 * SuppressionEngine - Single path for all suppression
 * 
 * Ensures all suppression is deterministic and auditable.
 * Prevents future "quick fix suppression" code paths.
 * 
 * All suppression paths must route through SuppressionEngine.
 */

import { Signal, SignalType, SignalStatus } from '../../types/SignalTypes';
import { LifecycleState, DEFAULT_SUPPRESSION_RULES } from '../../types/LifecycleTypes';
import { Logger } from '../core/Logger';
import { LedgerService } from '../ledger/LedgerService';
import { LedgerEventType } from '../../types/LedgerTypes';

export interface SuppressionEngineConfig {
  logger: Logger;
  ledgerService: LedgerService;
  suppressionRuleVersion?: string;
}

/**
 * Suppression Set
 */
export interface SuppressionSet {
  signalIds: string[];
  signalTypes: SignalType[];
  reason: string;
  suppressedBy: string;
  suppressedAt: string;
}

/**
 * SuppressionEngine
 * 
 * Single engine for all suppression logic.
 */
export class SuppressionEngine {
  private logger: Logger;
  private ledgerService: LedgerService;
  private suppressionRuleVersion: string;

  constructor(config: SuppressionEngineConfig) {
    this.logger = config.logger;
    this.ledgerService = config.ledgerService;
    this.suppressionRuleVersion = config.suppressionRuleVersion || '1.0.0';
  }

  /**
   * Get suppression rule version
   */
  getSuppressionRuleVersion(): string {
    return this.suppressionRuleVersion;
  }

  /**
   * Compute suppression set deterministically
   * 
   * Based on lifecycle transition or signal conflicts.
   */
  async computeSuppressionSet(
    accountId: string,
    tenantId: string,
    fromState: LifecycleState,
    toState: LifecycleState,
    activeSignals: Signal[]
  ): Promise<SuppressionSet> {
    const now = new Date().toISOString();

    // Find applicable suppression rule
    const rule = DEFAULT_SUPPRESSION_RULES.find(r => 
      r.fromState === fromState && r.toState === toState
    );

    if (!rule) {
      // No suppression rule for this transition
      return {
        signalIds: [],
        signalTypes: [],
        reason: 'No suppression rule for transition',
        suppressedBy: 'system',
        suppressedAt: now,
      };
    }

    // Find signals to suppress
    const signalsToSuppress = activeSignals.filter(signal =>
      signal.status === SignalStatus.ACTIVE &&
      rule.suppressSignalTypes.includes(signal.signalType)
    );

    return {
      signalIds: signalsToSuppress.map(s => s.signalId),
      signalTypes: rule.suppressSignalTypes,
      reason: `Lifecycle transition: ${fromState} → ${toState}`,
      suppressedBy: `suppression-rule-${rule.ruleId}`,
      suppressedAt: now,
    };
  }

  /**
   * Apply suppression in bulk
   * 
   * Updates all signals in suppression set to SUPPRESSED status.
   */
  async applySuppression(
    suppressionSet: SuppressionSet,
    signalService: any, // SignalService - avoid circular dependency
    tenantId: string
  ): Promise<void> {
    const suppressedCount = suppressionSet.signalIds.length;

    if (suppressedCount === 0) {
      return; // Nothing to suppress
    }

    this.logger.info('Applying suppression', {
      signalCount: suppressedCount,
      signalTypes: suppressionSet.signalTypes,
      reason: suppressionSet.reason,
    });

    // Suppress each signal
    for (const signalId of suppressionSet.signalIds) {
      try {
        await signalService.updateSignalStatus(
          signalId,
          tenantId,
          SignalStatus.SUPPRESSED,
          suppressionSet.reason
        );
      } catch (error) {
        this.logger.error('Failed to suppress signal', {
          signalId,
          error: error instanceof Error ? error.message : String(error),
        });
        // Continue with other signals even if one fails
      }
    }
  }

  /**
   * Log suppression entries consistently
   * 
   * Creates ledger entries for all suppressed signals.
   */
  async logSuppressionEntries(
    suppressionSet: SuppressionSet,
    accountId: string,
    tenantId: string,
    traceId: string
  ): Promise<void> {
    if (suppressionSet.signalIds.length === 0) {
      return;
    }

    try {
      // Log single entry for the suppression batch
      await this.ledgerService.append({
        eventType: LedgerEventType.VALIDATION,
        accountId,
        tenantId,
        traceId,
        data: {
          suppressionBatch: true,
          signalCount: suppressionSet.signalIds.length,
          signalTypes: suppressionSet.signalTypes,
          reason: suppressionSet.reason,
          suppressedBy: suppressionSet.suppressedBy,
          suppressionRuleVersion: this.suppressionRuleVersion,
        },
      });

      this.logger.debug('Suppression entries logged', {
        signalCount: suppressionSet.signalIds.length,
        accountId,
        tenantId,
      });
    } catch (error) {
      this.logger.error('Failed to log suppression entries', {
        accountId,
        tenantId,
        error: error instanceof Error ? error.message : String(error),
      });
      // Don't throw - suppression should still proceed
    }
  }

  /**
   * Apply precedence rules to active signals
   * 
   * Resolves signal conflicts using precedence rules.
   * Applies to ACTIVE signals only, after TTL expiry and suppression updates.
   */
  async applyPrecedenceRules(activeSignals: Signal[]): Promise<Signal[]> {
    // For Phase 1, precedence rules are simple:
    // - FIRST_ENGAGEMENT_OCCURRED takes precedence over NO_ENGAGEMENT_PRESENT
    // - Other signals are additive (no conflicts)

    const hasFirstEngagement = activeSignals.some(s => 
      s.signalType === SignalType.FIRST_ENGAGEMENT_OCCURRED && s.status === SignalStatus.ACTIVE
    );
    const hasNoEngagement = activeSignals.some(s => 
      s.signalType === SignalType.NO_ENGAGEMENT_PRESENT && s.status === SignalStatus.ACTIVE
    );

    // If both exist, NO_ENGAGEMENT_PRESENT should be suppressed
    if (hasFirstEngagement && hasNoEngagement) {
      const noEngagementSignal = activeSignals.find(s => 
        s.signalType === SignalType.NO_ENGAGEMENT_PRESENT && s.status === SignalStatus.ACTIVE
      );

      if (noEngagementSignal) {
        this.logger.debug('Precedence rule: suppressing NO_ENGAGEMENT_PRESENT', {
          signalId: noEngagementSignal.signalId,
          reason: 'FIRST_ENGAGEMENT_OCCURRED takes precedence',
        });

        // Return signal marked for suppression (caller will handle actual suppression)
        return activeSignals.map(s => 
          s.signalId === noEngagementSignal.signalId
            ? { ...s, status: SignalStatus.SUPPRESSED as SignalStatus }
            : s
        );
      }
    }

    return activeSignals;
  }
}
