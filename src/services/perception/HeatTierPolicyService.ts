/**
 * Heat Tier Policy Service - Phase 5.3
 *
 * Deterministic cadence mapping (HeatTierPolicyV1) and hysteresis.
 * HOT = deep every 1h + shallow on signal; WARM = shallow every 6h; COLD = shallow every 3–7d.
 */

import {
  HeatTier,
  HeatTierPolicyV1,
  PullDepth,
} from '../../types/perception/PerceptionSchedulerTypes';

/** Default policy mapping (reference from PHASE_5_3_CODE_LEVEL_PLAN). */
export const DEFAULT_HEAT_TIER_POLICIES: HeatTierPolicyV1[] = [
  {
    tier: 'HOT',
    pull_cadence: '1h',
    default_depth: 'DEEP',
    promotion_signals_in_hours: 2,
    promotion_window_hours: 1,
    demotion_cooldown_hours: 4,
  },
  {
    tier: 'WARM',
    pull_cadence: '6h',
    default_depth: 'SHALLOW',
    promotion_signals_in_hours: 1,
    promotion_window_hours: 6,
    demotion_cooldown_hours: 24,
  },
  {
    tier: 'COLD',
    pull_cadence: '3d',
    default_depth: 'SHALLOW',
    demotion_cooldown_hours: 48,
  },
];

export class HeatTierPolicyService {
  private policiesByTier: Map<HeatTier, HeatTierPolicyV1>;

  constructor(policies?: HeatTierPolicyV1[]) {
    const list = policies ?? DEFAULT_HEAT_TIER_POLICIES;
    this.policiesByTier = new Map(list.map((p) => [p.tier, p]));
  }

  /** Get policy for a tier. */
  getPolicy(tier: HeatTier): HeatTierPolicyV1 | undefined {
    return this.policiesByTier.get(tier);
  }

  /** Default depth for tier (SHALLOW or DEEP). */
  getDefaultDepth(tier: HeatTier): PullDepth {
    const policy = this.policiesByTier.get(tier);
    return policy?.default_depth ?? 'SHALLOW';
  }

  /** Pull cadence string for tier (e.g. '1h', '6h', '3d'). */
  getPullCadence(tier: HeatTier): string {
    const policy = this.policiesByTier.get(tier);
    return policy?.pull_cadence ?? '3d';
  }

  /** Demotion cooldown in hours (avoid tier flapping). */
  getDemotionCooldownHours(tier: HeatTier): number {
    const policy = this.policiesByTier.get(tier);
    return policy?.demotion_cooldown_hours ?? 48;
  }
}
