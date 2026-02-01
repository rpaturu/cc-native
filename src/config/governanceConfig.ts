/**
 * Phase 7.1 — Governance config: grounding (WARN|BLOCK), compliance (restricted fields, prohibited actions).
 * See PHASE_7_1_CODE_LEVEL_PLAN.md §4, §6, §9.
 */

export type GroundingMissingAction = 'WARN' | 'BLOCK';

export interface GovernanceConfig {
  grounding_missing_action: GroundingMissingAction;
  restricted_fields: string[];
  prohibited_action_types: string[];
}

const DEFAULT: GovernanceConfig = {
  grounding_missing_action: 'BLOCK',
  restricted_fields: [],
  prohibited_action_types: [],
};

let config: GovernanceConfig = { ...DEFAULT };

export function getGovernanceConfig(): GovernanceConfig {
  return config;
}

export function setGovernanceConfig(overrides: Partial<GovernanceConfig>): void {
  config = { ...DEFAULT, ...config, ...overrides };
}
