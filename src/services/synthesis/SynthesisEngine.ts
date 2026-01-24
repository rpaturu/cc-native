/**
 * Synthesis Engine - Phase 2
 * 
 * Executes synthesis ruleset and generates AccountPostureState deterministically.
 * Same inputs → same output (bitwise identical JSON ignoring timestamps).
 */

import { Signal, SignalType, SignalStatus, EvidenceSnapshotRef } from '../../types/SignalTypes';
import { AccountState, LifecycleState } from '../../types/LifecycleTypes';
import {
  AccountPostureStateV1,
  PostureState,
  Momentum,
  RiskFactorV1,
  OpportunityV1,
  UnknownV1,
  Severity,
} from '../../types/PostureTypes';
import { RulesetLoader, Ruleset, SynthesisRule, RuleOutputs } from './RulesetLoader';
import { ConditionEvaluator } from './ConditionEvaluator';
import { SignalService } from '../perception/SignalService';
import { LifecycleStateService } from '../perception/LifecycleStateService';
import { Logger } from '../core/Logger';
import { createHash } from 'crypto';

const logger = new Logger('SynthesisEngine');

/**
 * Synthesis Engine Configuration
 */
export interface SynthesisEngineConfig {
  signalService: SignalService;
  lifecycleStateService: LifecycleStateService;
  rulesetVersion?: string;
}

/**
 * Synthesis Engine
 */
export class SynthesisEngine {
  private signalService: SignalService;
  private lifecycleStateService: LifecycleStateService;
  private rulesetVersion: string;

  constructor(config: SynthesisEngineConfig) {
    this.signalService = config.signalService;
    this.lifecycleStateService = config.lifecycleStateService;
    this.rulesetVersion = config.rulesetVersion || 'v1.0.0';
  }

  /**
   * Main synthesis method
   * 
   * Synthesizes AccountPostureState from active signals and lifecycle state.
   * Returns deterministic output (same inputs → same output).
   */
  async synthesize(
    accountId: string,
    tenantId: string,
    eventTime: string
  ): Promise<AccountPostureStateV1> {
    logger.info('Starting synthesis', { accountId, tenantId, eventTime });

    // 1. Load active signals for account (apply TTL, suppression)
    const activeSignals = await this.loadActiveSignals(accountId, tenantId);

    // 2. Load AccountState (lifecycle)
    const accountState = await this.loadAccountState(accountId, tenantId);

    // 3. Load ruleset (cached)
    const ruleset = RulesetLoader.loadRuleset(this.rulesetVersion);

    // 4. Evaluate rules in priority order until first match
    const matchedRule = this.evaluateRules(ruleset, activeSignals, accountState, eventTime);

    if (!matchedRule) {
      throw new Error(
        `No matching rule found for account ${accountId} with ${activeSignals.length} active signals`
      );
    }

    // 5. Generate posture state from matched rule
    const postureState = await this.generatePostureState(
      matchedRule,
      activeSignals,
      accountState,
      eventTime
    );

    logger.info('Synthesis completed', {
      accountId,
      tenantId,
      ruleId: matchedRule.rule_id,
      posture: postureState.posture,
    });

    return postureState;
  }

  /**
   * Load active signals (apply TTL, suppression)
   */
  private async loadActiveSignals(accountId: string, tenantId: string): Promise<Signal[]> {
    // Get all signals for account (SignalService handles TTL and suppression filtering)
    const signals = await this.signalService.getSignalsForAccount(accountId, tenantId, {
      status: SignalStatus.ACTIVE,
    });

    // Filter out expired signals (double-check TTL)
    const now = new Date().toISOString();
    return signals.filter((signal) => {
      const expiresAt = signal.metadata.ttl.expiresAt;
      if (expiresAt && new Date(expiresAt) < new Date(now)) {
        return false; // Expired
      }
      return true; // Active
    });
  }

  /**
   * Load AccountState (lifecycle)
   */
  private async loadAccountState(
    accountId: string,
    tenantId: string
  ): Promise<AccountState | null> {
    return await this.lifecycleStateService.getAccountState(accountId, tenantId);
  }

  /**
   * Evaluate rules in priority order
   * 
   * Sorts by priority (ascending), then by rule_id (alphabetical) as tie-breaker.
   * Returns first matching rule.
   */
  private evaluateRules(
    ruleset: Ruleset,
    activeSignals: Signal[],
    accountState: AccountState | null,
    eventTime: string
  ): SynthesisRule | null {
    // Filter rules by lifecycle state
    // Allow null lifecycle_state for fallback rules that match any state
    const lifecycleState = accountState?.currentLifecycleState || LifecycleState.PROSPECT;
    const applicableRules = ruleset.rules.filter(
      (rule) => rule.lifecycle_state === null || rule.lifecycle_state === lifecycleState
    );

    // Sort by priority (ascending), then by rule_id (alphabetical) as tie-breaker
    const sortedRules = applicableRules.sort((a, b) => {
      if (a.priority !== b.priority) {
        return a.priority - b.priority; // Lower priority first
      }
      return a.rule_id.localeCompare(b.rule_id); // Alphabetical tie-breaker
    });

    // Evaluate rules in order until first match
    for (const rule of sortedRules) {
      if (ConditionEvaluator.evaluateConditions(rule.conditions, activeSignals, eventTime)) {
        logger.debug('Rule matched', {
          ruleId: rule.rule_id,
          priority: rule.priority,
          lifecycleState,
        });
        return rule;
      }
    }

    return null; // No rule matched
  }

  /**
   * Generate posture state from matched rule
   */
  private async generatePostureState(
    rule: SynthesisRule,
    activeSignals: Signal[],
    accountState: AccountState | null,
    eventTime: string
  ): Promise<AccountPostureStateV1> {
    const now = new Date().toISOString();
    const lifecycleState = accountState?.currentLifecycleState || LifecycleState.PROSPECT;
    const tenantId = accountState?.tenantId || activeSignals[0]?.tenantId || 'unknown';
    const accountId = accountState?.accountId || activeSignals[0]?.accountId || 'unknown';

    // Resolve evidence signals to IDs (IDs-first contract)
    const evidenceSignalIds = this.resolveEvidenceSignals(rule.outputs.evidence_signals, activeSignals);
    const evidenceSnapshotRefs = this.resolveEvidenceSnapshotRefs(evidenceSignalIds, activeSignals);

    // Generate risk factors
    const riskFactors = await this.generateRiskFactors(
      rule.outputs.risk_factors || [],
      activeSignals,
      evidenceSignalIds,
      evidenceSnapshotRefs,
      rule.rule_id,
      this.rulesetVersion
    );

    // Generate opportunities
    const opportunities = await this.generateOpportunities(
      rule.outputs.opportunities || [],
      activeSignals,
      evidenceSignalIds,
      evidenceSnapshotRefs,
      rule.rule_id,
      this.rulesetVersion
    );

    // Generate unknowns
    const unknowns = this.generateUnknowns(
      rule.outputs.unknowns || [],
      eventTime,
      tenantId,
      accountId,
      rule.rule_id,
      this.rulesetVersion
    );

    // Compute hashes
    const activeSignalsHash = this.computeActiveSignalsHash(activeSignals);
    const inputsHash = this.computeInputsHash(activeSignalsHash, lifecycleState, this.rulesetVersion);

    // Build posture state
    const postureState: AccountPostureStateV1 = {
      account_id: accountId,
      tenantId: tenantId,
      posture: rule.outputs.posture as PostureState,
      momentum: rule.outputs.momentum as Momentum,
      risk_factors: riskFactors,
      opportunities: opportunities,
      unknowns: unknowns,
      evidence_signal_ids: evidenceSignalIds,
      evidence_snapshot_refs: evidenceSnapshotRefs,
      evidence_signal_types: rule.outputs.evidence_signals, // Human-readable (documentation only)
      ruleset_version: this.rulesetVersion,
      schema_version: 'v1',
      active_signals_hash: activeSignalsHash,
      inputs_hash: inputsHash,
      evaluated_at: eventTime,
      output_ttl_days: rule.outputs.output_ttl_days,
      rule_id: rule.rule_id,
      createdAt: now,
      updatedAt: now,
    };

    return postureState;
  }

  /**
   * Resolve evidence signals to IDs (IDs-first contract)
   * 
   * Resolves signal types to actual signal IDs from active signals.
   * Returns top K signal IDs (authoritative).
   */
  private resolveEvidenceSignals(
    evidenceSignalTypes: string[],
    activeSignals: Signal[]
  ): string[] {
    const signalIds: string[] = [];

    for (const signalType of evidenceSignalTypes) {
      // Find matching signals by type
      const matchingSignals = activeSignals.filter((s) => s.signalType === signalType);

      // Add signal IDs (top K - take first 10 per type to limit size)
      for (const signal of matchingSignals.slice(0, 10)) {
        if (!signalIds.includes(signal.signalId)) {
          signalIds.push(signal.signalId);
        }
      }
    }

    // Sort for determinism
    return signalIds.sort();
  }

  /**
   * Resolve evidence snapshot refs from signal IDs
   */
  private resolveEvidenceSnapshotRefs(
    signalIds: string[],
    activeSignals: Signal[]
  ): EvidenceSnapshotRef[] {
    const snapshotRefs: EvidenceSnapshotRef[] = [];
    const seenHashes = new Set<string>();

    for (const signalId of signalIds) {
      const signal = activeSignals.find((s) => s.signalId === signalId);
      if (signal && signal.evidence?.evidenceRef) {
        const ref = signal.evidence.evidenceRef;
        // Deduplicate by SHA256 hash
        if (!seenHashes.has(ref.sha256)) {
          snapshotRefs.push(ref);
          seenHashes.add(ref.sha256);
        }
      }
    }

    // Limit to top K (first 10)
    return snapshotRefs.slice(0, 10);
  }

  /**
   * Generate risk factors
   */
  private async generateRiskFactors(
    riskFactorOutputs: Array<{
      type: string;
      severity: string;
      description: string;
      evidence_signals: string[];
    }>,
    activeSignals: Signal[],
    evidenceSignalIds: string[],
    evidenceSnapshotRefs: EvidenceSnapshotRef[],
    ruleId: string,
    rulesetVersion: string
  ): Promise<RiskFactorV1[]> {
    const now = new Date().toISOString();

    return riskFactorOutputs.map((output) => {
      // Generate deterministic risk_id hash
      const riskId = this.computeRiskFactorId(
        activeSignals[0]?.tenantId || 'unknown',
        activeSignals[0]?.accountId || 'unknown',
        rulesetVersion,
        output.type,
        ruleId
      );

      return {
        risk_id: riskId,
        type: output.type,
        severity: output.severity as Severity,
        description: output.description,
        evidence_signal_ids: evidenceSignalIds.slice(0, 10), // Top K
        evidence_snapshot_refs: evidenceSnapshotRefs.slice(0, 10), // Top K
        introduced_at: now,
        expires_at: null,
        rule_id: ruleId,
        ruleset_version: rulesetVersion,
      };
    });
  }

  /**
   * Generate opportunities
   */
  private async generateOpportunities(
    opportunityOutputs: Array<{
      type: string;
      severity: string;
      description: string;
      evidence_signals: string[];
    }>,
    activeSignals: Signal[],
    evidenceSignalIds: string[],
    evidenceSnapshotRefs: EvidenceSnapshotRef[],
    ruleId: string,
    rulesetVersion: string
  ): Promise<OpportunityV1[]> {
    const now = new Date().toISOString();

    return opportunityOutputs.map((output) => {
      // Generate deterministic opportunity_id hash
      const opportunityId = this.computeOpportunityId(
        activeSignals[0]?.tenantId || 'unknown',
        activeSignals[0]?.accountId || 'unknown',
        rulesetVersion,
        output.type,
        ruleId
      );

      return {
        opportunity_id: opportunityId,
        type: output.type,
        severity: output.severity as Severity,
        description: output.description,
        evidence_signal_ids: evidenceSignalIds.slice(0, 10), // Top K
        evidence_snapshot_refs: evidenceSnapshotRefs.slice(0, 10), // Top K
        introduced_at: now,
        expires_at: null,
        rule_id: ruleId,
        ruleset_version: rulesetVersion,
      };
    });
  }

  /**
   * Generate unknowns
   */
  private generateUnknowns(
    unknownOutputs: Array<{
      type: string;
      description: string;
      expires_at_days?: number | null;
      review_after_days?: number | null;
    }>,
    eventTime: string,
    tenantId: string,
    accountId: string,
    ruleId: string,
    rulesetVersion: string
  ): UnknownV1[] {
    const eventTimeDate = new Date(eventTime);

    return unknownOutputs.map((output) => {
      // Generate deterministic unknown_id hash
      const unknownId = this.computeUnknownId(
        tenantId,
        accountId,
        rulesetVersion,
        output.type,
        ruleId
      );

      const introducedAt = eventTime;
      let expiresAt: string | null = null;
      let reviewAfter: string = eventTime; // Default to eventTime if not specified

      if (output.expires_at_days !== null && output.expires_at_days !== undefined) {
        const expiresDate = new Date(eventTimeDate);
        expiresDate.setDate(expiresDate.getDate() + output.expires_at_days);
        expiresAt = expiresDate.toISOString();
      }

      if (output.review_after_days !== null && output.review_after_days !== undefined) {
        const reviewDate = new Date(eventTimeDate);
        reviewDate.setDate(reviewDate.getDate() + output.review_after_days);
        reviewAfter = reviewDate.toISOString();
      }

      return {
        unknown_id: unknownId,
        type: output.type,
        description: output.description,
        introduced_at: introducedAt,
        expires_at: expiresAt,
        review_after: reviewAfter, // Always set (required field)
        rule_id: ruleId,
        ruleset_version: rulesetVersion,
      };
    });
  }

  /**
   * Compute active signals hash
   * 
   * SHA256 hash of ALL active signal IDs (after TTL + suppression), sorted lexicographically.
   */
  private computeActiveSignalsHash(activeSignals: Signal[]): string {
    const signalIds = activeSignals.map((s) => s.signalId).sort(); // Lexicographically sorted
    const hashInput = JSON.stringify(signalIds);
    return createHash('sha256').update(hashInput).digest('hex');
  }

  /**
   * Compute inputs hash
   * 
   * SHA256 hash of (active_signals_hash + lifecycle_state + ruleset_version).
   */
  private computeInputsHash(
    activeSignalsHash: string,
    lifecycleState: LifecycleState,
    rulesetVersion: string
  ): string {
    const hashInput = JSON.stringify({
      active_signals_hash: activeSignalsHash,
      lifecycle_state: lifecycleState,
      ruleset_version: rulesetVersion,
    });
    return createHash('sha256').update(hashInput).digest('hex');
  }

  /**
   * Compute risk factor ID (deterministic hash)
   */
  private computeRiskFactorId(
    tenantId: string,
    accountId: string,
    rulesetVersion: string,
    riskType: string,
    ruleId: string
  ): string {
    const hashInput = JSON.stringify({
      tenant_id: tenantId,
      account_id: accountId,
      ruleset_version: rulesetVersion,
      type: 'RISK_FACTOR',
      risk_type: riskType,
      rule_id: ruleId,
    });
    return createHash('sha256').update(hashInput).digest('hex');
  }

  /**
   * Compute opportunity ID (deterministic hash)
   */
  private computeOpportunityId(
    tenantId: string,
    accountId: string,
    rulesetVersion: string,
    opportunityType: string,
    ruleId: string
  ): string {
    const hashInput = JSON.stringify({
      tenant_id: tenantId,
      account_id: accountId,
      ruleset_version: rulesetVersion,
      type: 'OPPORTUNITY',
      opportunity_type: opportunityType,
      rule_id: ruleId,
    });
    return createHash('sha256').update(hashInput).digest('hex');
  }

  /**
   * Compute unknown ID (deterministic hash)
   */
  private computeUnknownId(
    tenantId: string,
    accountId: string,
    rulesetVersion: string,
    unknownType: string,
    ruleId: string
  ): string {
    const hashInput = JSON.stringify({
      tenant_id: tenantId,
      account_id: accountId,
      ruleset_version: rulesetVersion,
      type: 'UNKNOWN',
      unknown_type: unknownType,
      rule_id: ruleId,
    });
    return createHash('sha256').update(hashInput).digest('hex');
  }
}
