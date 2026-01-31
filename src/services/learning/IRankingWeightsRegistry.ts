/**
 * Phase 5.5 — Ranking weights registry interface.
 * Production ranking only uses weights for active_version (ACTIVE); resolution: tenant → GLOBAL.
 */

import type { RankingWeightsRegistryV1, RankingWeightsV1 } from '../../types/learning/LearningTypes';

export interface IRankingWeightsRegistry {
  /** Get registry row for tenant (or GLOBAL). */
  getRegistry(tenantId: string): Promise<RankingWeightsRegistryV1 | null>;

  /** Resolve active version: tenant active_version, else GLOBAL active_version. */
  resolveActiveVersion(tenantId: string): Promise<string | null>;

  /** Get weight artifact by tenant and version. */
  getWeights(tenantId: string, version: string): Promise<RankingWeightsV1 | null>;

  /** Store weight artifact; does not change active/candidate. */
  putWeights(weights: RankingWeightsV1): Promise<void>;

  /** Set candidate_version for tenant (calibration job writes CANDIDATE). */
  setCandidate(tenantId: string, version: string): Promise<void>;

  /** Promote candidate to active (conditional update + ledger). Fails if no candidate or race. */
  promoteCandidateToActive(tenantId: string, activatedBy: string): Promise<void>;

  /** Rollback: set active_version to targetVersion; rollback_of = previous active (audit). */
  rollback(tenantId: string, targetVersion: string, activatedBy: string): Promise<void>;
}
