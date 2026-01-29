/**
 * SynthesisEngine Unit Tests - Phase 2 Synthesis
 */

import { Signal, SignalType, SignalStatus } from '../../../types/SignalTypes';
import { AccountState, LifecycleState } from '../../../types/LifecycleTypes';

function emptyActiveSignalIndex(): Record<SignalType, string[]> {
  const entries = Object.values(SignalType).map((t) => [t, [] as string[]]);
  return Object.fromEntries(entries) as unknown as Record<SignalType, string[]>;
}
import { PostureState, Momentum } from '../../../types/PostureTypes';
import { Ruleset, SynthesisRule } from '../../../services/synthesis/RulesetLoader';
import { SynthesisEngine } from '../../../services/synthesis/SynthesisEngine';

const minimalRuleset: Ruleset = {
  version: 'v1.0.0',
  schema_version: 'v1',
  description: 'Test ruleset',
  rules: [
    {
      rule_id: 'test-prospect-ok',
      priority: 1,
      lifecycle_state: 'PROSPECT',
      conditions: { conditions: {} },
      outputs: {
        posture: 'OK',
        momentum: 'FLAT',
        evidence_signals: [],
        output_ttl_days: 7,
      },
    } as SynthesisRule,
  ],
};

jest.mock('../../../services/synthesis/RulesetLoader', () => ({
  RulesetLoader: {
    loadRuleset: jest.fn(() => minimalRuleset),
  },
}));

function makeSignal(overrides: Partial<Signal> = {}): Signal {
  return {
    signalId: 'sig-1',
    signalType: SignalType.ACCOUNT_ACTIVATION_DETECTED,
    accountId: 'acc-1',
    tenantId: 't1',
    traceId: 'trace-1',
    dedupeKey: 'dk-1',
    windowKey: 'wk-1',
    detectorVersion: '1.0.0',
    detectorInputVersion: '1.0.0',
    status: SignalStatus.ACTIVE,
    metadata: {
      confidence: 0.9,
      confidenceSource: 'direct',
      severity: 'medium',
      ttl: {
        ttlDays: 90,
        expiresAt: null,
        isPermanent: false,
      },
    },
    evidence: {
      evidenceRef: {
        s3Uri: 's3://b/k',
        sha256: 'abc',
        capturedAt: new Date().toISOString(),
        schemaVersion: '1',
        detectorInputVersion: '1.0.0',
      },
      evidenceSchemaVersion: '1',
    },
    suppression: { suppressed: false, suppressedAt: null, suppressedBy: null, inferenceActive: true },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  } as Signal;
}

const minimalAccountState: AccountState = {
  accountId: 'acc-1',
  tenantId: 't1',
  currentLifecycleState: LifecycleState.PROSPECT,
  activeSignalIndex: emptyActiveSignalIndex(),
  lastTransitionAt: null,
  lastEngagementAt: null,
  hasActiveContract: false,
  lastInferenceAt: new Date().toISOString(),
  inferenceRuleVersion: '1.0.0',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe('SynthesisEngine', () => {
  let mockSignalService: { getSignalsForAccount: jest.Mock };
  let mockLifecycleStateService: { getAccountState: jest.Mock };
  let engine: SynthesisEngine;

  beforeEach(() => {
    mockSignalService = { getSignalsForAccount: jest.fn() };
    mockLifecycleStateService = { getAccountState: jest.fn() };
    mockSignalService.getSignalsForAccount.mockResolvedValue([makeSignal()]);
    mockLifecycleStateService.getAccountState.mockResolvedValue(minimalAccountState);
    engine = new SynthesisEngine({
      signalService: mockSignalService as any,
      lifecycleStateService: mockLifecycleStateService as any,
      rulesetVersion: 'v1.0.0',
    });
  });

  describe('synthesize', () => {
    it('returns AccountPostureStateV1 when a rule matches', async () => {
      const eventTime = new Date().toISOString();
      const result = await engine.synthesize('acc-1', 't1', eventTime);

      expect(result.account_id).toBe('acc-1');
      expect(result.tenantId).toBe('t1');
      expect(result.posture).toBe(PostureState.OK);
      expect(result.momentum).toBe(Momentum.FLAT);
      expect(result.ruleset_version).toBe('v1.0.0');
      expect(result.rule_id).toBe('test-prospect-ok');
      expect(result.inputs_hash).toBeDefined();
      expect(result.active_signals_hash).toBeDefined();
    });

    it('throws when no rule matches', async () => {
      const noMatchRuleset: Ruleset = {
        ...minimalRuleset,
        rules: [
          {
            rule_id: 'customer-only',
            priority: 1,
            lifecycle_state: 'CUSTOMER',
            conditions: { conditions: {} },
            outputs: {
              posture: 'OK',
              momentum: 'FLAT',
              evidence_signals: [],
              output_ttl_days: 7,
            },
          } as SynthesisRule,
        ],
      };
      const { RulesetLoader } = require('../../../services/synthesis/RulesetLoader');
      RulesetLoader.loadRuleset.mockReturnValueOnce(noMatchRuleset);

      await expect(
        engine.synthesize('acc-1', 't1', new Date().toISOString())
      ).rejects.toThrow(/No matching rule found/);
    });

    it('filters expired signals by TTL', async () => {
      const expiredSignal = makeSignal({
        metadata: {
          confidence: 0.9,
          confidenceSource: 'direct',
          severity: 'medium',
          ttl: {
            ttlDays: 1,
            expiresAt: new Date(Date.now() - 86400 * 1000).toISOString(),
            isPermanent: false,
          },
        },
      });
      mockSignalService.getSignalsForAccount.mockResolvedValue([expiredSignal]);

      const eventTime = new Date().toISOString();
      const result = await engine.synthesize('acc-1', 't1', eventTime);

      expect(result.account_id).toBe('acc-1');
      expect(result.posture).toBe(PostureState.OK);
    });
  });
});
