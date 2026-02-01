/**
 * Phase 7.1 — Contradiction validator: canonical snapshot vs step; field allowlist only.
 * See PHASE_7_1_CODE_LEVEL_PLAN.md §5.
 */

import type { ValidatorContext, ValidatorResult, ExecutablePayload } from '../../../types/governance/ValidatorTypes';
import {
  getContradictionFieldConfig,
  type ContradictionFieldConfig,
  type ContradictionFieldRule,
} from '../../../config/contradictionFieldConfig';

const VALIDATOR_NAME = 'contradiction';

function getStepPayload(step: ExecutablePayload): Record<string, unknown> {
  return step as unknown as Record<string, unknown>;
}

/** Returns true if step contradicts snapshot for this rule. */
function isContradiction(
  rule: ContradictionFieldRule,
  snapshotVal: unknown,
  stepVal: unknown
): boolean {
  if (snapshotVal == null || stepVal == null) return false;
  if (rule.kind === 'eq') return snapshotVal !== stepVal;
  if (rule.kind === 'no_backward') {
    const idxSnap = rule.ordering.indexOf(String(snapshotVal));
    const idxStep = rule.ordering.indexOf(String(stepVal));
    if (idxSnap === -1 || idxStep === -1) return false;
    return idxStep < idxSnap;
  }
  if (rule.kind === 'date_window') {
    const d1 = new Date(String(snapshotVal)).getTime();
    const d2 = new Date(String(stepVal)).getTime();
    if (Number.isNaN(d1) || Number.isNaN(d2)) return false;
    const deltaDays = Math.abs(d2 - d1) / (86400 * 1000);
    return deltaDays > rule.max_days_delta;
  }
  return false;
}

export function validate(context: ValidatorContext): ValidatorResult {
  const step = context.step_or_proposal;
  const snapshot = context.canonical_snapshot;
  if (!step || !snapshot) {
    return { validator: VALIDATOR_NAME, result: 'ALLOW', reason: 'NOT_APPLICABLE' };
  }

  const configs: ContradictionFieldConfig[] = getContradictionFieldConfig();
  const stepPayload = getStepPayload(step);

  for (const { field, rule } of configs) {
    const snapshotVal = snapshot[field];
    const stepVal = stepPayload[field];
    if (snapshotVal == null || stepVal == null) continue;
    if (isContradiction(rule, snapshotVal, stepVal)) {
      return {
        validator: VALIDATOR_NAME,
        result: 'BLOCK',
        reason: 'CONTRADICTION',
        details: { field, snapshot_value: snapshotVal, step_value: stepVal },
      };
    }
  }

  return { validator: VALIDATOR_NAME, result: 'ALLOW' };
}
