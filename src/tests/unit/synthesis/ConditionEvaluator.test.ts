/**
 * Unit tests for ConditionEvaluator
 */

import { ConditionEvaluator } from '../../../services/synthesis/ConditionEvaluator';
import { Signal, SignalType, SignalStatus } from '../../../types/SignalTypes';
import { RuleConditions, SignalCondition } from '../../../services/synthesis/RulesetLoader';

describe('ConditionEvaluator', () => {
  const createSignal = (
    signalId: string,
    signalType: SignalType,
    status: SignalStatus,
    accountId: string = 'account-1',
    tenantId: string = 'tenant-1',
    context?: Record<string, any>
  ): Signal => {
    return {
      signalId,
      signalType,
      status,
      accountId,
      tenantId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      traceId: `trace-${signalId}`,
      dedupeKey: `dedupe-${signalId}`,
      windowKey: `window-${signalId}`,
      detectorVersion: 'v1.0.0',
      detectorInputVersion: 'v1.0.0',
      context: context || {},
      metadata: {
        confidence: 0.8,
        confidenceSource: 'direct',
        severity: 'medium',
        ttl: {
          ttlDays: null,
          isPermanent: true,
          expiresAt: null,
        },
      },
      evidence: {
        evidenceRef: {
          s3Uri: `s3://bucket/evidence/${signalId}`,
          sha256: `sha256-${signalId}`,
          capturedAt: new Date().toISOString(),
          schemaVersion: 'v1',
          detectorInputVersion: 'v1.0.0',
        },
        evidenceSchemaVersion: 'v1',
      },
      suppression: {
        suppressed: false,
        suppressedAt: null,
        suppressedBy: null,
        inferenceActive: true,
      },
    };
  };

  describe('evaluateConditions', () => {
    it('should match empty conditions (match-all)', () => {
      const conditions: RuleConditions = {
        conditions: {},
      };
      const activeSignals: Signal[] = [];
      const eventTime = new Date().toISOString();

      const result = ConditionEvaluator.evaluateConditions(conditions, activeSignals, eventTime);
      expect(result).toBe(true);
    });

    it('should match required signal by type and status', () => {
      const conditions: RuleConditions = {
        required_signals: [
          {
            signal_type: SignalType.RENEWAL_WINDOW_ENTERED,
            status: 'ACTIVE',
          },
        ],
      };

      const activeSignals: Signal[] = [
        createSignal('sig-1', SignalType.RENEWAL_WINDOW_ENTERED, SignalStatus.ACTIVE),
      ];

      const result = ConditionEvaluator.evaluateConditions(conditions, activeSignals, new Date().toISOString());
      expect(result).toBe(true);
    });

    it('should not match if required signal is missing', () => {
      const conditions: RuleConditions = {
        required_signals: [
          {
            signal_type: SignalType.RENEWAL_WINDOW_ENTERED,
            status: 'ACTIVE',
          },
        ],
      };

      const activeSignals: Signal[] = [
        createSignal('sig-1', SignalType.USAGE_TREND_CHANGE, SignalStatus.ACTIVE),
      ];

      const result = ConditionEvaluator.evaluateConditions(conditions, activeSignals, new Date().toISOString());
      expect(result).toBe(false);
    });

    it('should not match if required signal has wrong status', () => {
      const conditions: RuleConditions = {
        required_signals: [
          {
            signal_type: SignalType.RENEWAL_WINDOW_ENTERED,
            status: 'ACTIVE',
          },
        ],
      };

      const activeSignals: Signal[] = [
        createSignal('sig-1', SignalType.RENEWAL_WINDOW_ENTERED, SignalStatus.SUPPRESSED),
      ];

      const result = ConditionEvaluator.evaluateConditions(conditions, activeSignals, new Date().toISOString());
      expect(result).toBe(false);
    });

    it('should match signal with where clause (property equals)', () => {
      const conditions: RuleConditions = {
        required_signals: [
          {
            signal_type: SignalType.USAGE_TREND_CHANGE,
            status: 'ACTIVE',
            where: [
              {
                property: 'context.trend_direction',
                operator: 'equals',
                value: 'DOWN',
              },
            ],
          },
        ],
      };

      const activeSignals: Signal[] = [
        createSignal('sig-1', SignalType.USAGE_TREND_CHANGE, SignalStatus.ACTIVE, 'account-1', 'tenant-1', {
          trend_direction: 'DOWN',
        }),
      ];

      const result = ConditionEvaluator.evaluateConditions(conditions, activeSignals, new Date().toISOString());
      expect(result).toBe(true);
    });

    it('should not match signal with where clause if property value differs', () => {
      const conditions: RuleConditions = {
        required_signals: [
          {
            signal_type: SignalType.USAGE_TREND_CHANGE,
            status: 'ACTIVE',
            where: [
              {
                property: 'context.trend_direction',
                operator: 'equals',
                value: 'DOWN',
              },
            ],
          },
        ],
      };

      const activeSignals: Signal[] = [
        createSignal('sig-1', SignalType.USAGE_TREND_CHANGE, SignalStatus.ACTIVE, 'account-1', 'tenant-1', {
          trend_direction: 'UP',
        }),
      ];

      const result = ConditionEvaluator.evaluateConditions(conditions, activeSignals, new Date().toISOString());
      expect(result).toBe(false);
    });

    it('should exclude signals that match excluded_signals', () => {
      const conditions: RuleConditions = {
        required_signals: [
          {
            signal_type: SignalType.RENEWAL_WINDOW_ENTERED,
            status: 'ACTIVE',
          },
        ],
        excluded_signals: [
          {
            signal_type: SignalType.SUPPORT_RISK_EMERGING,
            status: 'ACTIVE',
          },
        ],
      };

      const activeSignals: Signal[] = [
        createSignal('sig-1', SignalType.RENEWAL_WINDOW_ENTERED, SignalStatus.ACTIVE),
        createSignal('sig-2', SignalType.SUPPORT_RISK_EMERGING, SignalStatus.ACTIVE),
      ];

      const result = ConditionEvaluator.evaluateConditions(conditions, activeSignals, new Date().toISOString());
      expect(result).toBe(false); // Excluded signal found
    });

    it('should match when excluded signal is not present', () => {
      const conditions: RuleConditions = {
        required_signals: [
          {
            signal_type: SignalType.RENEWAL_WINDOW_ENTERED,
            status: 'ACTIVE',
          },
        ],
        excluded_signals: [
          {
            signal_type: SignalType.SUPPORT_RISK_EMERGING,
            status: 'ACTIVE',
          },
        ],
      };

      const activeSignals: Signal[] = [
        createSignal('sig-1', SignalType.RENEWAL_WINDOW_ENTERED, SignalStatus.ACTIVE),
      ];

      const result = ConditionEvaluator.evaluateConditions(conditions, activeSignals, new Date().toISOString());
      expect(result).toBe(true); // Excluded signal not found
    });

    it('should evaluate computed predicate: no_engagement_in_days', () => {
      const conditions: RuleConditions = {
        computed_predicates: [
          {
            name: 'no_engagement_in_days',
            params: { days: 30 },
          },
        ],
      };

      // No engagement signals in last 30 days
      const eventTime = new Date().toISOString();
      const oldSignal = createSignal('sig-1', SignalType.FIRST_ENGAGEMENT_OCCURRED, SignalStatus.ACTIVE);
      oldSignal.createdAt = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString(); // 35 days ago

      const activeSignals: Signal[] = [oldSignal];

      const result = ConditionEvaluator.evaluateConditions(conditions, activeSignals, eventTime);
      expect(result).toBe(true); // No engagement in last 30 days
    });

    it('should not match computed predicate if engagement exists in window', () => {
      const conditions: RuleConditions = {
        computed_predicates: [
          {
            name: 'no_engagement_in_days',
            params: { days: 30 },
          },
        ],
      };

      // Engagement signal within last 30 days
      const eventTime = new Date().toISOString();
      const recentSignal = createSignal('sig-1', SignalType.FIRST_ENGAGEMENT_OCCURRED, SignalStatus.ACTIVE);
      recentSignal.createdAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(); // 10 days ago

      const activeSignals: Signal[] = [recentSignal];

      const result = ConditionEvaluator.evaluateConditions(conditions, activeSignals, eventTime);
      expect(result).toBe(false); // Engagement found in window
    });

    it('should evaluate computed predicate: has_engagement_in_days', () => {
      const conditions: RuleConditions = {
        computed_predicates: [
          {
            name: 'has_engagement_in_days',
            params: { days: 30 },
          },
        ],
      };

      // Engagement signal within last 30 days
      const eventTime = new Date().toISOString();
      const recentSignal = createSignal('sig-1', SignalType.FIRST_ENGAGEMENT_OCCURRED, SignalStatus.ACTIVE);
      recentSignal.createdAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(); // 10 days ago

      const activeSignals: Signal[] = [recentSignal];

      const result = ConditionEvaluator.evaluateConditions(conditions, activeSignals, eventTime);
      expect(result).toBe(true); // Engagement found in window
    });
  });

  describe('evaluateWhereClause', () => {
    it('should evaluate multiple where predicates (all must match)', () => {
      const signal = createSignal('sig-1', SignalType.USAGE_TREND_CHANGE, SignalStatus.ACTIVE, 'account-1', 'tenant-1', {
        trend_direction: 'DOWN',
        trend_magnitude: 0.3,
      });

      const whereClause = [
        {
          property: 'context.trend_direction',
          operator: 'equals' as const,
          value: 'DOWN',
        },
        {
          property: 'context.trend_magnitude',
          operator: 'greater_than' as const,
          value: 0.2,
        },
      ];

      const result = ConditionEvaluator.evaluateWhereClause(signal, whereClause, new Date().toISOString());
      expect(result).toBe(true);
    });

    it('should fail if any where predicate does not match', () => {
      const signal = createSignal('sig-1', SignalType.USAGE_TREND_CHANGE, SignalStatus.ACTIVE, 'account-1', 'tenant-1', {
        trend_direction: 'DOWN',
        trend_magnitude: 0.1, // Less than 0.2
      });

      const whereClause = [
        {
          property: 'context.trend_direction',
          operator: 'equals' as const,
          value: 'DOWN',
        },
        {
          property: 'context.trend_magnitude',
          operator: 'greater_than' as const,
          value: 0.2,
        },
      ];

      const result = ConditionEvaluator.evaluateWhereClause(signal, whereClause, new Date().toISOString());
      expect(result).toBe(false);
    });
  });
});
