/**
 * Phase 7.1 — Compliance / Field Guard validator: restricted fields, prohibited actions.
 * See PHASE_7_1_CODE_LEVEL_PLAN.md §6.
 */

import type { ValidatorContext, ValidatorResult, ExecutablePayload } from '../../../types/governance/ValidatorTypes';
import { getGovernanceConfig } from '../../../config/governanceConfig';

const VALIDATOR_NAME = 'compliance';

function hasRestrictedField(
  obj: Record<string, unknown>,
  restricted: string[]
): string | undefined {
  for (const field of restricted) {
    if (field in obj && obj[field] !== undefined) return field;
  }
  return undefined;
}

function getActionType(step: ExecutablePayload): string | undefined {
  return (step as Record<string, unknown>).action_type as string | undefined;
}

export function validate(context: ValidatorContext): ValidatorResult {
  const { step_or_proposal, writeback_payload } = context;
  const gov = getGovernanceConfig();
  const restricted = gov.restricted_fields ?? [];
  const prohibited = gov.prohibited_action_types ?? [];

  if (!step_or_proposal && !writeback_payload) {
    return { validator: VALIDATOR_NAME, result: 'ALLOW', reason: 'NOT_APPLICABLE' };
  }

  if (step_or_proposal) {
    const stepObj = step_or_proposal as unknown as Record<string, unknown>;
    const field = hasRestrictedField(stepObj, restricted);
    if (field) {
      return {
        validator: VALIDATOR_NAME,
        result: 'BLOCK',
        reason: 'RESTRICTED_FIELD',
        details: { field_or_action: field },
      };
    }
    const actionType = getActionType(step_or_proposal);
    if (actionType && prohibited.includes(actionType)) {
      return {
        validator: VALIDATOR_NAME,
        result: 'BLOCK',
        reason: 'PROHIBITED_ACTION',
        details: { field_or_action: actionType },
      };
    }
  }

  if (writeback_payload && restricted.length) {
    const field = hasRestrictedField(writeback_payload, restricted);
    if (field) {
      return {
        validator: VALIDATOR_NAME,
        result: 'BLOCK',
        reason: 'RESTRICTED_FIELD',
        details: { field_or_action: field },
      };
    }
  }

  return { validator: VALIDATOR_NAME, result: 'ALLOW' };
}
