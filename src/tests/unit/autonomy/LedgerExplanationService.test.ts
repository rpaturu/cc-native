/**
 * LedgerExplanationService Unit Tests - Phase 5.6
 */

import { LedgerExplanationService } from '../../../services/autonomy/LedgerExplanationService';
import { Logger } from '../../../services/core/Logger';
import { LedgerEventType } from '../../../types/LedgerTypes';

const mockGetOutcome = jest.fn();
const mockQuery = jest.fn();

const mockExecutionOutcomeService = {
  getOutcome: mockGetOutcome,
};
const mockLedgerService = {
  query: mockQuery,
};

describe('LedgerExplanationService', () => {
  let service: LedgerExplanationService;
  const logger = new Logger('LedgerExplanationServiceTest');

  beforeEach(() => {
    jest.clearAllMocks();
    service = new LedgerExplanationService({
      executionOutcomeService: mockExecutionOutcomeService as any,
      ledgerService: mockLedgerService as any,
      logger,
    });
  });

  describe('getExplanation', () => {
    it('returns null when outcome not found', async () => {
      mockGetOutcome.mockResolvedValue(null);

      const result = await service.getExplanation('intent-1', 't1', 'a1');

      expect(result).toBeNull();
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('returns LedgerExplanationV1 when outcome and entries exist', async () => {
      const outcome = {
        action_intent_id: 'intent-1',
        tenant_id: 't1',
        account_id: 'a1',
        status: 'SUCCEEDED',
        trace_id: 'trace-1',
        approval_source: 'POLICY',
        auto_executed: true,
      };
      mockGetOutcome.mockResolvedValue(outcome);
      mockQuery.mockResolvedValue([
        { eventType: LedgerEventType.POLICY_EVALUATED, data: { evaluation: 'AUTO_EXECUTE', explanation: 'Policy allowed', policy_version: 'v1' } },
        { eventType: LedgerEventType.ACTION_EXECUTED, data: {} },
      ]);

      const result = await service.getExplanation('intent-1', 't1', 'a1');

      expect(result).not.toBeNull();
      expect(result!.execution_id).toBe('intent-1');
      expect(result!.action_intent_id).toBe('intent-1');
      expect(result!.account_id).toBe('a1');
      expect(result!.tenant_id).toBe('t1');
      expect(result!.why.policy_decision).toBe('AUTO_EXECUTE');
      expect(result!.why.explanation).toBe('Action executed successfully.');
      expect(result!.which_policy.policy_version).toBe('v1');
      expect(result!.approval_source).toBe('POLICY');
      expect(result!.auto_executed).toBe(true);
      expect(mockQuery).toHaveBeenCalledWith({ tenantId: 't1', traceId: 'trace-1', limit: 100 });
    });

    it('derives why from ACTION_APPROVED when present', async () => {
      mockGetOutcome.mockResolvedValue({
        action_intent_id: 'i1',
        tenant_id: 't1',
        account_id: 'a1',
        status: 'SUCCEEDED',
        trace_id: 'trace-1',
      });
      mockQuery.mockResolvedValue([
        { eventType: LedgerEventType.ACTION_APPROVED, data: {} },
      ]);

      const result = await service.getExplanation('i1', 't1', 'a1');

      expect(result!.why.trigger_type).toBe('APPROVAL');
      expect(result!.why.policy_decision).toBe('AUTO_EXECUTE');
      expect(result!.why.explanation).toBe('Action approved (human or policy).');
    });

    it('derives why from ACTION_FAILED when outcome status FAILED', async () => {
      mockGetOutcome.mockResolvedValue({
        action_intent_id: 'i1',
        tenant_id: 't1',
        account_id: 'a1',
        status: 'FAILED',
        trace_id: 'trace-1',
      });
      mockQuery.mockResolvedValue([
        { eventType: LedgerEventType.ACTION_FAILED, data: { error_message: 'Connector error', error_class: 'ConnectionTimeout' } },
      ]);

      const result = await service.getExplanation('i1', 't1', 'a1');

      expect(result!.why.explanation).toBe('Connector error');
      expect(result!.why.reason).toBe('ConnectionTimeout');
    });

    it('includes what_it_knew when DECISION_PROPOSED has snapshot', async () => {
      mockGetOutcome.mockResolvedValue({
        action_intent_id: 'i1',
        tenant_id: 't1',
        account_id: 'a1',
        status: 'SUCCEEDED',
        trace_id: 'trace-1',
      });
      mockQuery.mockResolvedValue([
        {
          eventType: LedgerEventType.DECISION_PROPOSED,
          data: {
            signals_snapshot: { heat: 0.8 },
            posture_snapshot: { tier: 'high' },
            intent_snapshot: { action_type: 'CREATE_NOTE' },
          },
        },
      ]);

      const result = await service.getExplanation('i1', 't1', 'a1');

      expect(result!.what_it_knew).toEqual({
        signals_snapshot: { heat: 0.8 },
        posture_snapshot: { tier: 'high' },
        intent_snapshot: { action_type: 'CREATE_NOTE' },
      });
    });

    it('omits what_it_knew when empty', async () => {
      mockGetOutcome.mockResolvedValue({
        action_intent_id: 'i1',
        tenant_id: 't1',
        account_id: 'a1',
        status: 'SUCCEEDED',
        trace_id: 'trace-1',
      });
      mockQuery.mockResolvedValue([]);

      const result = await service.getExplanation('i1', 't1', 'a1');

      expect(result!.what_it_knew).toBeUndefined();
    });

    it('derives which_policy with policy_clause when present', async () => {
      mockGetOutcome.mockResolvedValue({
        action_intent_id: 'i1',
        tenant_id: 't1',
        account_id: 'a1',
        status: 'SUCCEEDED',
        trace_id: 'trace-1',
      });
      mockQuery.mockResolvedValue([
        {
          eventType: LedgerEventType.POLICY_EVALUATED,
          data: { policy_version: 'v2', policy_clause: 'autonomy_allow' },
        },
      ]);

      const result = await service.getExplanation('i1', 't1', 'a1');

      expect(result!.which_policy).toEqual({ policy_version: 'v2', policy_clause: 'autonomy_allow' });
    });

    it('defaults which_policy to unknown when no POLICY_EVALUATED', async () => {
      mockGetOutcome.mockResolvedValue({
        action_intent_id: 'i1',
        tenant_id: 't1',
        account_id: 'a1',
        status: 'SUCCEEDED',
        trace_id: 'trace-1',
      });
      mockQuery.mockResolvedValue([]);

      const result = await service.getExplanation('i1', 't1', 'a1');

      expect(result!.which_policy).toEqual({ policy_version: 'unknown', policy_clause: undefined });
    });
  });
});
