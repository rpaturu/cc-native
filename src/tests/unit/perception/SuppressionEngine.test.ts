/**
 * SuppressionEngine Unit Tests - Phase 1 Perception
 */

import { SuppressionEngine } from '../../../services/perception/SuppressionEngine';
import { Logger } from '../../../services/core/Logger';
import { Signal, SignalType, SignalStatus } from '../../../types/SignalTypes';
import { LifecycleState } from '../../../types/LifecycleTypes';
import { mockDynamoDBDocumentClient, resetAllMocks } from '../../__mocks__/aws-sdk-clients';

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn(() => mockDynamoDBDocumentClient) },
  PutCommand: jest.fn(),
  QueryCommand: jest.fn(),
}));

describe('SuppressionEngine', () => {
  let engine: SuppressionEngine;
  let logger: Logger;
  let mockLedgerService: { append: jest.Mock };

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
      metadata: {} as any,
      evidence: {} as any,
      suppression: {} as any,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...overrides,
    };
  }

  beforeEach(() => {
    resetAllMocks();
    logger = new Logger('SuppressionEngineTest');
    mockLedgerService = { append: jest.fn().mockResolvedValue(undefined) };
    engine = new SuppressionEngine({
      logger,
      ledgerService: mockLedgerService as any,
      suppressionRuleVersion: '1.0.0',
    });
  });

  describe('getSuppressionRuleVersion', () => {
    it('returns configured version', () => {
      expect(engine.getSuppressionRuleVersion()).toBe('1.0.0');
    });
  });

  describe('computeSuppressionSet', () => {
    it('returns empty suppression when no rule for transition', async () => {
      const result = await engine.computeSuppressionSet(
        'acc-1',
        't1',
        LifecycleState.SUSPECT,
        LifecycleState.PROSPECT,
        [makeSignal()]
      );

      expect(result.signalIds).toEqual([]);
      expect(result.reason).toBe('No suppression rule for transition');
    });

    it('returns suppressed signal ids for PROSPECT→SUSPECT rule', async () => {
      const s1 = makeSignal({
        signalId: 'sig-a',
        signalType: SignalType.ACCOUNT_ACTIVATION_DETECTED,
        status: SignalStatus.ACTIVE,
      });
      const s2 = makeSignal({
        signalId: 'sig-b',
        signalType: SignalType.NO_ENGAGEMENT_PRESENT,
        status: SignalStatus.ACTIVE,
      });
      const s3 = makeSignal({
        signalId: 'sig-c',
        signalType: SignalType.FIRST_ENGAGEMENT_OCCURRED,
        status: SignalStatus.ACTIVE,
      });

      const result = await engine.computeSuppressionSet(
        'acc-1',
        't1',
        LifecycleState.PROSPECT,
        LifecycleState.SUSPECT,
        [s1, s2, s3]
      );

      expect(result.signalIds).toContain('sig-a');
      expect(result.signalIds).toContain('sig-b');
      expect(result.signalIds).not.toContain('sig-c');
      expect(result.reason).toContain('PROSPECT');
      expect(result.reason).toContain('SUSPECT');
    });

    it('excludes non-ACTIVE signals from suppression set', async () => {
      const s1 = makeSignal({
        signalId: 'sig-a',
        signalType: SignalType.ACCOUNT_ACTIVATION_DETECTED,
        status: SignalStatus.SUPPRESSED,
      });

      const result = await engine.computeSuppressionSet(
        'acc-1',
        't1',
        LifecycleState.PROSPECT,
        LifecycleState.SUSPECT,
        [s1]
      );

      expect(result.signalIds).toEqual([]);
    });
  });

  describe('applySuppression', () => {
    it('does nothing when suppression set is empty', async () => {
      const mockSignalService = { updateSignalStatus: jest.fn() };

      await engine.applySuppression(
        { signalIds: [], signalTypes: [], reason: 'test', suppressedBy: 'system', suppressedAt: new Date().toISOString() },
        mockSignalService as any,
        't1'
      );

      expect(mockSignalService.updateSignalStatus).not.toHaveBeenCalled();
    });

    it('calls updateSignalStatus for each signal in set', async () => {
      const mockSignalService = { updateSignalStatus: jest.fn().mockResolvedValue(undefined) };

      await engine.applySuppression(
        {
          signalIds: ['sig-1', 'sig-2'],
          signalTypes: [SignalType.ACCOUNT_ACTIVATION_DETECTED],
          reason: 'Lifecycle transition',
          suppressedBy: 'rule-1',
          suppressedAt: new Date().toISOString(),
        },
        mockSignalService as any,
        't1'
      );

      expect(mockSignalService.updateSignalStatus).toHaveBeenCalledTimes(2);
      expect(mockSignalService.updateSignalStatus).toHaveBeenCalledWith(
        'sig-1',
        't1',
        SignalStatus.SUPPRESSED,
        'Lifecycle transition'
      );
      expect(mockSignalService.updateSignalStatus).toHaveBeenCalledWith(
        'sig-2',
        't1',
        SignalStatus.SUPPRESSED,
        'Lifecycle transition'
      );
    });
  });

  describe('logSuppressionEntries', () => {
    it('does nothing when signalIds is empty', async () => {
      await engine.logSuppressionEntries(
        { signalIds: [], signalTypes: [], reason: 'r', suppressedBy: 's', suppressedAt: new Date().toISOString() },
        'acc-1',
        't1',
        'trace-1'
      );

      expect(mockLedgerService.append).not.toHaveBeenCalled();
    });

    it('appends one ledger entry for suppression batch', async () => {
      await engine.logSuppressionEntries(
        {
          signalIds: ['sig-1'],
          signalTypes: [SignalType.ACCOUNT_ACTIVATION_DETECTED],
          reason: 'Transition',
          suppressedBy: 'rule-1',
          suppressedAt: new Date().toISOString(),
        },
        'acc-1',
        't1',
        'trace-1'
      );

      expect(mockLedgerService.append).toHaveBeenCalledTimes(1);
      expect(mockLedgerService.append).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'VALIDATION',
          accountId: 'acc-1',
          tenantId: 't1',
          traceId: 'trace-1',
          data: expect.objectContaining({
            suppressionBatch: true,
            signalCount: 1,
            signalTypes: [SignalType.ACCOUNT_ACTIVATION_DETECTED],
            reason: 'Transition',
          }),
        })
      );
    });
  });

  describe('applyPrecedenceRules', () => {
    it('returns same signals when no FIRST_ENGAGEMENT vs NO_ENGAGEMENT conflict', async () => {
      const signals = [
        makeSignal({ signalType: SignalType.ACCOUNT_ACTIVATION_DETECTED }),
      ];

      const result = await engine.applyPrecedenceRules(signals);

      expect(result).toEqual(signals);
    });

    it('marks NO_ENGAGEMENT_PRESENT as SUPPRESSED when FIRST_ENGAGEMENT_OCCURRED present', async () => {
      const noEng = makeSignal({
        signalId: 'sig-no',
        signalType: SignalType.NO_ENGAGEMENT_PRESENT,
        status: SignalStatus.ACTIVE,
      });
      const firstEng = makeSignal({
        signalId: 'sig-first',
        signalType: SignalType.FIRST_ENGAGEMENT_OCCURRED,
        status: SignalStatus.ACTIVE,
      });

      const result = await engine.applyPrecedenceRules([noEng, firstEng]);

      const noEngResult = result.find(s => s.signalId === 'sig-no');
      expect(noEngResult!.status).toBe(SignalStatus.SUPPRESSED);
      const firstEngResult = result.find(s => s.signalId === 'sig-first');
      expect(firstEngResult!.status).toBe(SignalStatus.ACTIVE);
    });
  });
});
