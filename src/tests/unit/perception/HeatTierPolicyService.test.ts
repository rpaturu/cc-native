/**
 * Unit tests for HeatTierPolicyService - Phase 5.3
 */

import { HeatTierPolicyService } from '../../../services/perception/HeatTierPolicyService';
import type { HeatTierPolicyV1 } from '../../../types/perception/PerceptionSchedulerTypes';

describe('HeatTierPolicyService', () => {
  describe('default policies', () => {
    let service: HeatTierPolicyService;

    beforeEach(() => {
      service = new HeatTierPolicyService();
    });

    it('getPolicy returns policy for HOT, WARM, COLD', () => {
      expect(service.getPolicy('HOT')).toBeDefined();
      expect(service.getPolicy('HOT')?.tier).toBe('HOT');
      expect(service.getPolicy('WARM')?.tier).toBe('WARM');
      expect(service.getPolicy('COLD')?.tier).toBe('COLD');
    });

    it('getDefaultDepth returns DEEP for HOT, SHALLOW for WARM and COLD', () => {
      expect(service.getDefaultDepth('HOT')).toBe('DEEP');
      expect(service.getDefaultDepth('WARM')).toBe('SHALLOW');
      expect(service.getDefaultDepth('COLD')).toBe('SHALLOW');
    });

    it('getPullCadence returns cadence string per tier', () => {
      expect(service.getPullCadence('HOT')).toBe('1h');
      expect(service.getPullCadence('WARM')).toBe('6h');
      expect(service.getPullCadence('COLD')).toBe('3d');
    });

    it('getDemotionCooldownHours returns hours per tier', () => {
      expect(service.getDemotionCooldownHours('HOT')).toBe(4);
      expect(service.getDemotionCooldownHours('WARM')).toBe(24);
      expect(service.getDemotionCooldownHours('COLD')).toBe(48);
    });
  });

  describe('custom policies', () => {
    it('uses provided policies when passed', () => {
      const custom: HeatTierPolicyV1[] = [
        { tier: 'HOT', pull_cadence: '30m', default_depth: 'DEEP', demotion_cooldown_hours: 2 },
        { tier: 'WARM', pull_cadence: '12h', default_depth: 'SHALLOW', demotion_cooldown_hours: 12 },
        { tier: 'COLD', pull_cadence: '7d', default_depth: 'SHALLOW', demotion_cooldown_hours: 72 },
      ];
      const service = new HeatTierPolicyService(custom);
      expect(service.getPullCadence('HOT')).toBe('30m');
      expect(service.getDemotionCooldownHours('COLD')).toBe(72);
    });

    it('getDefaultDepth falls back to SHALLOW for unknown tier', () => {
      const service = new HeatTierPolicyService([]);
      expect(service.getDefaultDepth('HOT')).toBe('SHALLOW');
      expect(service.getPullCadence('HOT')).toBe('3d');
      expect(service.getDemotionCooldownHours('HOT')).toBe(48);
    });
  });
});
