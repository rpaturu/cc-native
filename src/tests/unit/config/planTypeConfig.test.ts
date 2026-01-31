/**
 * Phase 6.2 — planTypeConfig unit tests.
 */

import { getPlanTypeConfig, RENEWAL_DEFENSE_CONFIG } from '../../../config/planTypeConfig';
import { RENEWAL_DEFENSE_STEP_ACTION_TYPES } from '../../../types/plan/PlanTypeConfig';

describe('planTypeConfig', () => {
  describe('getPlanTypeConfig', () => {
    it('returns config for RENEWAL_DEFENSE', () => {
      const config = getPlanTypeConfig('RENEWAL_DEFENSE');
      expect(config).not.toBeNull();
      expect(config?.plan_type).toBe('RENEWAL_DEFENSE');
      expect(config?.allowed_step_action_types).toEqual([...RENEWAL_DEFENSE_STEP_ACTION_TYPES]);
      expect(config?.default_sequence).toEqual([
        'REQUEST_RENEWAL_MEETING',
        'PREP_RENEWAL_BRIEF',
        'ESCALATE_SUPPORT_RISK',
      ]);
      expect(config?.objective_template).toBe('Secure renewal before day -30');
      expect(config?.expires_at_days_from_creation).toBe(30);
    });

    it('returns null for unknown plan type', () => {
      expect(getPlanTypeConfig('OTHER_TYPE')).toBeNull();
      expect(getPlanTypeConfig('')).toBeNull();
      expect(getPlanTypeConfig('renewal_defense')).toBeNull();
    });
  });

  describe('RENEWAL_DEFENSE_CONFIG', () => {
    it('matches getPlanTypeConfig result', () => {
      expect(getPlanTypeConfig('RENEWAL_DEFENSE')).toEqual(RENEWAL_DEFENSE_CONFIG);
    });
  });
});
