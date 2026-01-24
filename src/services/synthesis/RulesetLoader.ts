/**
 * Ruleset Loader - Phase 2
 * 
 * Loads and parses synthesis ruleset from YAML.
 * Caches parsed ruleset in memory for Lambda warm starts.
 */

import * as yaml from 'js-yaml';
import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '../core/Logger';

const logger = new Logger('RulesetLoader');

/**
 * Signal condition in ruleset
 */
export interface SignalCondition {
  signal_type: string;
  status: 'ACTIVE' | 'SUPPRESSED' | 'EXPIRED';
  where?: PropertyPredicate[];
}

/**
 * Property predicate for signal filtering
 */
export interface PropertyPredicate {
  property: string; // e.g., "context.trend_direction", "createdAt"
  operator:
    | 'equals'
    | 'greater_than'
    | 'less_than'
    | 'less_than_or_equal'
    | 'within_last_days'
    | 'in'
    | 'exists'
    | 'not_exists';
  value?: any;
}

/**
 * Computed predicate
 */
export interface ComputedPredicate {
  name: 'no_engagement_in_days' | 'has_engagement_in_days';
  params: Record<string, any>; // e.g., { days: 30 }
}

/**
 * Rule conditions
 */
export interface RuleConditions {
  required_signals?: SignalCondition[];
  excluded_signals?: SignalCondition[];
  computed_predicates?: ComputedPredicate[];
  conditions?: Record<string, any>; // Empty object {} for match-all
}

/**
 * Risk factor output
 */
export interface RiskFactorOutput {
  type: string;
  severity: 'low' | 'medium' | 'high';
  description: string;
  evidence_signals: string[]; // Signal types (will be resolved to IDs)
}

/**
 * Opportunity output
 */
export interface OpportunityOutput {
  type: string;
  severity: 'low' | 'medium' | 'high';
  description: string;
  evidence_signals: string[]; // Signal types (will be resolved to IDs)
}

/**
 * Unknown output
 */
export interface UnknownOutput {
  type: string;
  description: string;
  expires_at_days?: number | null;
  review_after_days?: number | null;
}

/**
 * Rule outputs
 */
export interface RuleOutputs {
  posture: 'OK' | 'WATCH' | 'AT_RISK' | 'EXPAND' | 'DORMANT';
  momentum: 'UP' | 'FLAT' | 'DOWN';
  risk_factors?: RiskFactorOutput[];
  opportunities?: OpportunityOutput[];
  unknowns?: UnknownOutput[];
  evidence_signals: string[]; // Signal types (will be resolved to IDs)
  output_ttl_days: number | null;
}

/**
 * Synthesis rule
 */
export interface SynthesisRule {
  rule_id: string;
  priority: number;
  lifecycle_state: 'PROSPECT' | 'SUSPECT' | 'CUSTOMER' | null; // null for fallback rules that match any lifecycle state
  conditions: RuleConditions;
  outputs: RuleOutputs;
}

/**
 * Ruleset structure
 */
export interface Ruleset {
  version: string;
  schema_version: string;
  description: string;
  rules: SynthesisRule[];
}

/**
 * Ruleset Loader
 */
export class RulesetLoader {
  private static cache: Map<string, Ruleset> = new Map();

  /**
   * Load ruleset by version
   */
  static loadRuleset(version: string = 'v1.0.0'): Ruleset {
    // Check cache first
    if (this.cache.has(version)) {
      logger.debug('Ruleset loaded from cache', { version });
      return this.cache.get(version)!;
    }

    // Load from file
    // Handle both compiled (dist) and source (src) paths
    const basePath = __dirname.includes('dist')
      ? path.join(__dirname, '../synthesis/rules')
      : path.join(__dirname, '../../synthesis/rules');
    const rulesetPath = path.join(basePath, `${version.split('.')[0]}.yaml`);

    logger.info('Loading ruleset from file', { version, path: rulesetPath });

    try {
      const fileContent = fs.readFileSync(rulesetPath, 'utf8');
      const parsed = yaml.load(fileContent) as any;

      // Validate and transform
      const ruleset = this.parseRuleset(parsed);
      this.validateRuleset(ruleset);

      // Cache for future use
      this.cache.set(version, ruleset);

      logger.info('Ruleset loaded successfully', {
        version,
        ruleCount: ruleset.rules.length,
      });

      return ruleset;
    } catch (error) {
      logger.error('Failed to load ruleset', { version, path: rulesetPath, error });
      throw new Error(`Failed to load ruleset ${version}: ${error}`);
    }
  }

  /**
   * Parse YAML content into typed ruleset
   */
  static parseRuleset(yamlContent: any): Ruleset {
    if (!yamlContent.ruleset) {
      throw new Error('Invalid ruleset: missing "ruleset" key');
    }

    const rulesetData = yamlContent.ruleset;

    return {
      version: rulesetData.version || 'v1.0.0',
      schema_version: rulesetData.schema_version || 'v1',
      description: rulesetData.description || '',
      rules: (rulesetData.rules || []).map((rule: any) => this.parseRule(rule)),
    };
  }

  /**
   * Parse individual rule
   */
  private static parseRule(ruleData: any): SynthesisRule {
    return {
      rule_id: ruleData.rule_id,
      priority: ruleData.priority,
      lifecycle_state: ruleData.lifecycle_state === null ? null : ruleData.lifecycle_state,
      conditions: this.parseConditions(ruleData.conditions || {}),
      outputs: this.parseOutputs(ruleData.outputs),
    };
  }

  /**
   * Parse rule conditions
   */
  private static parseConditions(conditionsData: any): RuleConditions {
    const conditions: RuleConditions = {};

    if (conditionsData.required_signals) {
      conditions.required_signals = conditionsData.required_signals.map((sig: any) => ({
        signal_type: sig.signal_type,
        status: sig.status,
        where: sig.where || [],
      }));
    }

    if (conditionsData.excluded_signals) {
      conditions.excluded_signals = conditionsData.excluded_signals.map((sig: any) => ({
        signal_type: sig.signal_type,
        status: sig.status,
        where: sig.where || [],
      }));
    }

    if (conditionsData.computed_predicates) {
      conditions.computed_predicates = conditionsData.computed_predicates.map((pred: any) => ({
        name: pred.name,
        params: pred.params || {},
      }));
    }

    // Empty conditions object for match-all
    if (Object.keys(conditionsData).length === 0) {
      conditions.conditions = {};
    }

    return conditions;
  }

  /**
   * Parse rule outputs
   */
  private static parseOutputs(outputsData: any): RuleOutputs {
    return {
      posture: outputsData.posture,
      momentum: outputsData.momentum,
      risk_factors: outputsData.risk_factors || [],
      opportunities: outputsData.opportunities || [],
      unknowns: outputsData.unknowns || [],
      evidence_signals: outputsData.evidence_signals || [],
      output_ttl_days: outputsData.output_ttl_days ?? null,
    };
  }

  /**
   * Validate ruleset schema
   */
  static validateRuleset(ruleset: Ruleset): void {
    if (!ruleset.version) {
      throw new Error('Invalid ruleset: missing version');
    }

    if (!ruleset.schema_version) {
      throw new Error('Invalid ruleset: missing schema_version');
    }

    if (!Array.isArray(ruleset.rules)) {
      throw new Error('Invalid ruleset: rules must be an array');
    }

    for (const rule of ruleset.rules) {
      this.validateRule(rule);
    }

    logger.debug('Ruleset validation passed', { version: ruleset.version });
  }

  /**
   * Validate individual rule
   */
  private static validateRule(rule: SynthesisRule): void {
    if (!rule.rule_id) {
      throw new Error('Invalid rule: missing rule_id');
    }

    if (typeof rule.priority !== 'number') {
      throw new Error(`Invalid rule ${rule.rule_id}: priority must be a number`);
    }

    // Allow null for fallback rules that match any lifecycle state
    if (rule.lifecycle_state !== null && !['PROSPECT', 'SUSPECT', 'CUSTOMER'].includes(rule.lifecycle_state)) {
      throw new Error(
        `Invalid rule ${rule.rule_id}: lifecycle_state must be PROSPECT, SUSPECT, CUSTOMER, or null (for fallback rules)`
      );
    }

    if (!rule.outputs) {
      throw new Error(`Invalid rule ${rule.rule_id}: missing outputs`);
    }

    if (!['OK', 'WATCH', 'AT_RISK', 'EXPAND', 'DORMANT'].includes(rule.outputs.posture)) {
      throw new Error(
        `Invalid rule ${rule.rule_id}: posture must be OK, WATCH, AT_RISK, EXPAND, or DORMANT`
      );
    }

    if (!['UP', 'FLAT', 'DOWN'].includes(rule.outputs.momentum)) {
      throw new Error(`Invalid rule ${rule.rule_id}: momentum must be UP, FLAT, or DOWN`);
    }

    // Validate risk factors severity
    if (rule.outputs.risk_factors) {
      for (const risk of rule.outputs.risk_factors) {
        if (!['low', 'medium', 'high'].includes(risk.severity)) {
          throw new Error(
            `Invalid rule ${rule.rule_id}: risk factor severity must be low, medium, or high`
          );
        }
      }
    }

    // Validate opportunities severity
    if (rule.outputs.opportunities) {
      for (const opp of rule.outputs.opportunities) {
        if (!['low', 'medium', 'high'].includes(opp.severity)) {
          throw new Error(
            `Invalid rule ${rule.rule_id}: opportunity severity must be low, medium, or high`
          );
        }
      }
    }
  }

  /**
   * Clear cache (for testing or ruleset updates)
   */
  static clearCache(): void {
    this.cache.clear();
    logger.debug('Ruleset cache cleared');
  }
}
