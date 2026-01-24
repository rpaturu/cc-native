/**
 * Unit tests for RulesetLoader
 */

import { RulesetLoader, Ruleset, SynthesisRule } from '../../../services/synthesis/RulesetLoader';

describe('RulesetLoader', () => {
  beforeEach(() => {
    // Clear cache before each test
    RulesetLoader.clearCache();
  });

  describe('loadRuleset', () => {
    it('should load and parse v1 ruleset', () => {
      const ruleset = RulesetLoader.loadRuleset('v1.0.0');

      expect(ruleset).toBeDefined();
      expect(ruleset.version).toBe('v1.0.0');
      expect(ruleset.schema_version).toBe('v1');
      expect(Array.isArray(ruleset.rules)).toBe(true);
      expect(ruleset.rules.length).toBeGreaterThan(0);
    });

    it('should cache ruleset after first load', () => {
      const ruleset1 = RulesetLoader.loadRuleset('v1.0.0');
      const ruleset2 = RulesetLoader.loadRuleset('v1.0.0');

      // Should be the same instance (cached)
      expect(ruleset1).toBe(ruleset2);
    });

    it('should validate ruleset schema', () => {
      expect(() => {
        RulesetLoader.loadRuleset('v1.0.0');
      }).not.toThrow();
    });

    it('should validate rule structure', () => {
      const ruleset = RulesetLoader.loadRuleset('v1.0.0');

      for (const rule of ruleset.rules) {
        expect(rule.rule_id).toBeDefined();
        expect(typeof rule.priority).toBe('number');
        // Allow null for fallback rules that match any lifecycle state
        if (rule.lifecycle_state !== null) {
          expect(['PROSPECT', 'SUSPECT', 'CUSTOMER']).toContain(rule.lifecycle_state);
        }
        expect(rule.outputs).toBeDefined();
        expect(['OK', 'WATCH', 'AT_RISK', 'EXPAND', 'DORMANT']).toContain(rule.outputs.posture);
        expect(['UP', 'FLAT', 'DOWN']).toContain(rule.outputs.momentum);
      }
    });

    it('should validate risk factor severity', () => {
      const ruleset = RulesetLoader.loadRuleset('v1.0.0');

      for (const rule of ruleset.rules) {
        if (rule.outputs.risk_factors) {
          for (const risk of rule.outputs.risk_factors) {
            expect(['low', 'medium', 'high']).toContain(risk.severity);
          }
        }
      }
    });

    it('should validate opportunity severity', () => {
      const ruleset = RulesetLoader.loadRuleset('v1.0.0');

      for (const rule of ruleset.rules) {
        if (rule.outputs.opportunities) {
          for (const opp of rule.outputs.opportunities) {
            expect(['low', 'medium', 'high']).toContain(opp.severity);
          }
        }
      }
    });
  });
});
