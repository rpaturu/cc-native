/**
 * Phase 7.3 — Governance metrics emission: best-effort, never change execution outcome.
 * Namespace CCNative/Governance. See PHASE_7_3_CODE_LEVEL_PLAN.md §2.
 */

import type { ValidatorResult, ValidatorResultKind } from '../../types/governance/ValidatorTypes';
import type { BudgetServiceResultKind } from '../../types/governance/BudgetTypes';
import { Logger } from '../core/Logger';

const NAMESPACE = 'CCNative/Governance';

export interface GovernanceMetricsEmitterConfig {
  logger: Logger;
  /** Optional: inject CloudWatch PutMetricData; if not set, metrics are log-only (best-effort). */
  putMetricData?: (namespace: string, metrics: Array<{ name: string; value: number; dimensions?: Record<string, string> }>) => Promise<void>;
}

/**
 * Emit validator per-result metric (ValidatorResultCount). Call from ValidatorGatewayService when appending each VALIDATOR_RUN.
 * Best-effort: never throw; log on failure.
 */
export function emitValidatorResult(
  config: GovernanceMetricsEmitterConfig,
  validator: string,
  result: ValidatorResultKind
): void {
  const metrics: Array<{ name: string; value: number; dimensions?: Record<string, string> }> = [
    { name: 'ValidatorResultCount', value: 1, dimensions: { ValidatorName: validator, Result: result } },
  ];
  fireAndForget(config, metrics);
}

/**
 * Emit validator run summary metric (ValidatorRunSummaryCount, GovernanceBlocks/GovernanceWarns). Call when appending VALIDATOR_RUN_SUMMARY.
 */
export function emitValidatorRunSummary(
  config: GovernanceMetricsEmitterConfig,
  aggregate: ValidatorResultKind
): void {
  const metrics: Array<{ name: string; value: number; dimensions?: Record<string, string> }> = [
    { name: 'ValidatorRunSummaryCount', value: 1, dimensions: { Aggregate: aggregate } },
  ];
  if (aggregate === 'BLOCK') {
    metrics.push({ name: 'GovernanceBlocks', value: 1, dimensions: { Source: 'VALIDATOR' } });
  } else if (aggregate === 'WARN') {
    metrics.push({ name: 'GovernanceWarns', value: 1, dimensions: { Source: 'VALIDATOR' } });
  }
  fireAndForget(config, metrics);
}

/**
 * Emit budget decision metric. Call from BudgetService after each BUDGET_RESERVE/BUDGET_BLOCK/BUDGET_WARN.
 * For BUDGET_RESERVE only, also pass usage_after and cap_hard for BudgetUsage/BudgetHardCap.
 */
export function emitBudgetResult(
  config: GovernanceMetricsEmitterConfig,
  costClass: string,
  result: BudgetServiceResultKind,
  usageAfter?: number,
  capHard?: number
): void {
  const metrics: Array<{ name: string; value: number; dimensions?: Record<string, string> }> = [
    { name: 'BudgetResultCount', value: 1, dimensions: { CostClass: costClass, Result: result } },
  ];
  if (result === 'BLOCK') {
    metrics.push({ name: 'GovernanceBlocks', value: 1, dimensions: { Source: 'BUDGET' } });
  } else if (result === 'WARN') {
    metrics.push({ name: 'GovernanceWarns', value: 1, dimensions: { Source: 'BUDGET' } });
  }
  if (usageAfter != null) metrics.push({ name: 'BudgetUsage', value: usageAfter, dimensions: { CostClass: costClass } });
  if (capHard != null) metrics.push({ name: 'BudgetHardCap', value: capHard, dimensions: { CostClass: costClass } });
  fireAndForget(config, metrics);
}

function fireAndForget(
  config: GovernanceMetricsEmitterConfig,
  metrics: Array<{ name: string; value: number; dimensions?: Record<string, string> }>
): void {
  if (config.putMetricData) {
    config.putMetricData(NAMESPACE, metrics).catch((err) => {
      config.logger.warn('GovernanceMetricsEmitter: PutMetricData failed (best-effort)', { error: err, metrics });
    });
  } else {
    config.logger.debug('GovernanceMetricsEmitter: metrics (log-only)', { namespace: NAMESPACE, metrics });
  }
}
