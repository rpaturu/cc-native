/**
 * Phase 7.1 — Grounding validator: action-level evidence reference shape.
 * See PHASE_7_1_CODE_LEVEL_PLAN.md §4.
 */

import type {
  ValidatorContext,
  ValidatorResult,
  EvidenceReference,
  ExecutablePayload,
} from '../../../types/governance/ValidatorTypes';
import { getGovernanceConfig } from '../../../config/governanceConfig';

const VALIDATOR_NAME = 'grounding';

function isEvidenceReference(x: unknown): x is EvidenceReference {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  if ('source_type' in o && 'source_id' in o && typeof o.source_type === 'string' && typeof o.source_id === 'string') return true;
  if ('ledger_event_id' in o && typeof o.ledger_event_id === 'string') return true;
  if ('record_locator' in o && o.record_locator && typeof o.record_locator === 'object') {
    const r = o.record_locator as Record<string, unknown>;
    return typeof r.system === 'string' && typeof r.object === 'string' && typeof r.id === 'string';
  }
  return false;
}

function getEvidence(step: ExecutablePayload): EvidenceReference[] | undefined {
  const ev = step.evidence;
  if (Array.isArray(ev)) return ev;
  const refs = (step as Record<string, unknown>).evidence_refs;
  if (Array.isArray(refs)) return refs as EvidenceReference[];
  return undefined;
}

export function validate(context: ValidatorContext): ValidatorResult {
  const step = context.step_or_proposal;
  if (!step) {
    return { validator: VALIDATOR_NAME, result: 'ALLOW', reason: 'NOT_APPLICABLE' };
  }

  const evidence = getEvidence(step);
  if (!evidence?.length) {
    const action = getGovernanceConfig().grounding_missing_action;
    return {
      validator: VALIDATOR_NAME,
      result: action,
      reason: 'MISSING_EVIDENCE',
      details: { expected: 'evidence or evidence_refs array with ≥1 valid reference' },
    };
  }

  const refsValid = evidence.every(isEvidenceReference);
  if (!refsValid) {
    const action = getGovernanceConfig().grounding_missing_action;
    return {
      validator: VALIDATOR_NAME,
      result: action,
      reason: 'INVALID_EVIDENCE_SHAPE',
      details: { expected: 'source_type+source_id | ledger_event_id | record_locator' },
    };
  }

  const whitelist = context.evidence_references;
  if (whitelist?.length) {
    const allowed = new Set(whitelist.map((r) => JSON.stringify(r)));
    const allMatch = evidence.every((e) => allowed.has(JSON.stringify(e)));
    if (!allMatch) {
      const action = getGovernanceConfig().grounding_missing_action;
      return {
        validator: VALIDATOR_NAME,
        result: action,
        reason: 'EVIDENCE_NOT_IN_WHITELIST',
      };
    }
  }

  return { validator: VALIDATOR_NAME, result: 'ALLOW' };
}
