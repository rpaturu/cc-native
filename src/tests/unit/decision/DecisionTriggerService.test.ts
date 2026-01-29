/**
 * DecisionTriggerService Unit Tests - Phase 3 Decision
 */

import { DecisionTriggerService } from '../../../services/decision/DecisionTriggerService';
import { Logger } from '../../../services/core/Logger';
import { DecisionTriggerType } from '../../../types/DecisionTriggerTypes';

describe('DecisionTriggerService', () => {
  let service: DecisionTriggerService;
  let logger: Logger;
  let mockAccountPostureStateService: { getPostureState: jest.Mock };
  let mockSignalService: Record<string, unknown>;

  beforeEach(() => {
    logger = new Logger('DecisionTriggerServiceTest');
    mockAccountPostureStateService = { getPostureState: jest.fn() };
    mockSignalService = {};
    service = new DecisionTriggerService(
      mockAccountPostureStateService as any,
      mockSignalService as any,
      logger
    );
  });

  describe('shouldTriggerDecision', () => {
    it('returns should_evaluate true for LIFECYCLE_TRANSITION', async () => {
      mockAccountPostureStateService.getPostureState.mockResolvedValue(null);

      const result = await service.shouldTriggerDecision(
        'acc-1',
        't1',
        DecisionTriggerType.LIFECYCLE_TRANSITION,
        'evt-1'
      );

      expect(result.should_evaluate).toBe(true);
      expect(result.reason).toContain('LIFECYCLE_TRANSITION');
    });

    it('returns should_evaluate true for HIGH_SIGNAL_ARRIVAL', async () => {
      mockAccountPostureStateService.getPostureState.mockResolvedValue(null);

      const result = await service.shouldTriggerDecision(
        'acc-1',
        't1',
        DecisionTriggerType.HIGH_SIGNAL_ARRIVAL
      );

      expect(result.should_evaluate).toBe(true);
      expect(result.reason).toContain('HIGH_SIGNAL_ARRIVAL');
    });

    it('returns should_evaluate true for EXPLICIT_USER_REQUEST (bypasses cooldown)', async () => {
      const evaluatedAt = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();
      mockAccountPostureStateService.getPostureState.mockResolvedValue({
        account_id: 'acc-1',
        tenantId: 't1',
        evaluated_at: evaluatedAt,
      });

      const result = await service.shouldTriggerDecision(
        'acc-1',
        't1',
        DecisionTriggerType.EXPLICIT_USER_REQUEST
      );

      expect(result.should_evaluate).toBe(true);
      expect(result.reason).toBe('USER_REQUESTED');
    });

    it('returns should_evaluate false when cooldown active for non-user trigger', async () => {
      const evaluatedAt = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();
      mockAccountPostureStateService.getPostureState.mockResolvedValue({
        account_id: 'acc-1',
        tenantId: 't1',
        evaluated_at: evaluatedAt,
      });

      const result = await service.shouldTriggerDecision(
        'acc-1',
        't1',
        DecisionTriggerType.HIGH_SIGNAL_ARRIVAL
      );

      expect(result.should_evaluate).toBe(false);
      expect(result.reason).toBe('COOLDOWN_ACTIVE');
      expect(result.cooldown_until).toBeDefined();
    });

    it('returns should_evaluate true for COOLDOWN_GATED_PERIODIC when no posture', async () => {
      mockAccountPostureStateService.getPostureState.mockResolvedValue(null);

      const result = await service.shouldTriggerDecision(
        'acc-1',
        't1',
        DecisionTriggerType.COOLDOWN_GATED_PERIODIC
      );

      expect(result.should_evaluate).toBe(true);
      expect(result.reason).toBe('COOLDOWN_EXPIRED');
    });

    it('returns should_evaluate false when no trigger condition met', async () => {
      mockAccountPostureStateService.getPostureState.mockResolvedValue(null);

      const result = await service.shouldTriggerDecision(
        'acc-1',
        't1',
        'UNKNOWN_TRIGGER' as DecisionTriggerType
      );

      expect(result.should_evaluate).toBe(false);
      expect(result.reason).toBe('NO_TRIGGER_CONDITION_MET');
    });
  });
});
