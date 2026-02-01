/**
 * Phase 7.1 — Freshness validator: hard_ttl → BLOCK, soft_ttl → WARN, age from evaluation_time.
 * See PHASE_7_1_CODE_LEVEL_PLAN.md §3.
 */

import type { ValidatorContext, ValidatorResult } from '../../../types/governance/ValidatorTypes';
import { getTtlForSource } from '../../../config/freshnessTtlConfig';

const VALIDATOR_NAME = 'freshness';

export function validate(context: ValidatorContext): ValidatorResult {
  const sources = context.data_sources;
  if (!sources?.length) {
    return { validator: VALIDATOR_NAME, result: 'ALLOW', reason: 'NOT_APPLICABLE' };
  }

  const evaluationTime = context.evaluation_time_utc_ms;
  const evaluated: Array<{
    source_id: string;
    age_ms: number;
    soft_ttl_ms: number;
    hard_ttl_ms: number;
    result: 'ALLOW' | 'WARN' | 'BLOCK';
  }> = [];
  for (const { source_id, last_updated_utc_ms } of sources) {
    const age_ms = evaluationTime - last_updated_utc_ms;
    const { hard_ttl_ms, soft_ttl_ms } = getTtlForSource(source_id, false);
    let result: 'ALLOW' | 'WARN' | 'BLOCK' = 'ALLOW';
    if (age_ms > hard_ttl_ms) result = 'BLOCK';
    else if (age_ms > soft_ttl_ms) result = 'WARN';

    evaluated.push({ source_id, age_ms, soft_ttl_ms, hard_ttl_ms, result });
  }

  const aggregate: 'ALLOW' | 'WARN' | 'BLOCK' =
    evaluated.some((e) => e.result === 'BLOCK')
      ? 'BLOCK'
      : evaluated.some((e) => e.result === 'WARN')
        ? 'WARN'
        : 'ALLOW';
  const worstSource =
    aggregate === 'BLOCK'
      ? evaluated.find((e) => e.result === 'BLOCK')
      : aggregate === 'WARN'
        ? evaluated.find((e) => e.result === 'WARN')
        : undefined;

  return {
    validator: VALIDATOR_NAME,
    result: aggregate,
    reason: aggregate !== 'ALLOW' ? 'DATA_STALE' : undefined,
    details: {
      evaluated_sources: evaluated,
      worst_result: aggregate,
      worst_source_id: worstSource?.source_id,
    },
  };
}
