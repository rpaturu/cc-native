/**
 * DecisionContextAssembler Unit Tests - Phase 3 Decision
 */

import { DecisionContextAssembler } from '../../../services/decision/DecisionContextAssembler';
import { Logger } from '../../../services/core/Logger';
import { AccountPostureStateV1, PostureState, Momentum } from '../../../types/PostureTypes';
import { LifecycleState } from '../../../types/SignalTypes';

describe('DecisionContextAssembler', () => {
  let assembler: DecisionContextAssembler;
  let logger: Logger;
  let mockAccountPostureStateService: { getPostureState: jest.Mock };
  let mockSignalService: { getSignalsForAccount: jest.Mock };
  let mockGraphService: { getNeighbors: jest.Mock };
  let mockTenantService: { getTenant: jest.Mock };

  const minimalPosture: AccountPostureStateV1 = {
    account_id: 'acc-1',
    tenantId: 't1',
    posture: PostureState.OK,
    momentum: Momentum.FLAT,
    risk_factors: [],
    opportunities: [],
    unknowns: [],
    evidence_signal_ids: [],
    evidence_snapshot_refs: [],
    evidence_signal_types: [],
    ruleset_version: 'v1.0.0',
    schema_version: 'v1',
    active_signals_hash: 'h1',
    inputs_hash: 'i1',
    evaluated_at: new Date().toISOString(),
    output_ttl_days: 7,
    rule_id: 'rule-1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  beforeEach(() => {
    logger = new Logger('DecisionContextAssemblerTest');
    mockAccountPostureStateService = { getPostureState: jest.fn() };
    mockSignalService = { getSignalsForAccount: jest.fn() };
    mockGraphService = { getNeighbors: jest.fn() };
    mockTenantService = { getTenant: jest.fn() };

    mockAccountPostureStateService.getPostureState.mockResolvedValue(minimalPosture);
    mockSignalService.getSignalsForAccount.mockResolvedValue([]);
    mockGraphService.getNeighbors.mockResolvedValue([]);
    mockTenantService.getTenant.mockResolvedValue({
      tenantId: 't1',
      config: {
        min_confidence_threshold: 0.7,
        decision_cost_budget_remaining: 100,
      },
    });

    assembler = new DecisionContextAssembler(
      mockAccountPostureStateService as any,
      mockSignalService as any,
      mockGraphService as any,
      mockTenantService as any,
      logger
    );
  });

  describe('assembleContext', () => {
    it('throws when AccountPostureState not found', async () => {
      mockAccountPostureStateService.getPostureState.mockResolvedValue(null);

      await expect(
        assembler.assembleContext('acc-1', 't1', 'trace-1')
      ).rejects.toThrow(/AccountPostureState not found/);
    });

    it('throws when tenant not found', async () => {
      mockTenantService.getTenant.mockResolvedValue(null);

      await expect(
        assembler.assembleContext('acc-1', 't1', 'trace-1')
      ).rejects.toThrow(/Tenant not found/);
    });

    it('returns DecisionContextV1 with posture, signals, graph refs, policy', async () => {
      const result = await assembler.assembleContext('acc-1', 't1', 'trace-1');

      expect(result.tenant_id).toBe('t1');
      expect(result.account_id).toBe('acc-1');
      expect(result.trace_id).toBe('trace-1');
      expect(result.posture_state).toEqual(minimalPosture);
      expect(result.risk_factors).toEqual([]);
      expect(result.opportunities).toEqual([]);
      expect(result.unknowns).toEqual([]);
      expect(result.graph_context_refs).toEqual([]);
      expect(result.policy_context).toBeDefined();
      expect(result.policy_context.tenant_id).toBe('t1');
      expect(result.policy_context.min_confidence_threshold).toBe(0.7);
      expect([LifecycleState.PROSPECT, LifecycleState.SUSPECT, LifecycleState.CUSTOMER]).toContain(
        result.lifecycle_state
      );
    });

    it('calls getNeighbors with account vertex and maxDepth 2', async () => {
      await assembler.assembleContext('acc-1', 't1', 'trace-1');

      expect(mockGraphService.getNeighbors).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ maxDepth: 2 })
      );
    });
  });
});
