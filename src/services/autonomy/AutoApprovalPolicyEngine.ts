/**
 * Auto-Approval Policy Engine - Phase 5.1
 *
 * Deterministic, pure, in-process policy evaluation.
 * Same input → same output. No state writes.
 * Returns reason and explanation for BLOCK/REQUIRE_APPROVAL.
 */

import {
  AutoApprovalDecision,
  AutoApprovalPolicyInputV1,
  AutoApprovalPolicyResultV1,
  AutonomyMode,
} from '../../types/autonomy/AutonomyTypes';

const POLICY_VERSION = 'AutoApprovalPolicyV1';

/**
 * Evaluate auto-approval policy. Pure and side-effect free.
 */
export function evaluateAutoApprovalPolicy(
  input: AutoApprovalPolicyInputV1
): AutoApprovalPolicyResultV1 {
  // DISABLED → BLOCK
  if (input.autonomy_mode === 'DISABLED') {
    return {
      decision: 'BLOCK',
      reason: 'ACTION_TYPE_DISABLED',
      explanation: 'This action type is disabled for autonomy.',
      policy_version: POLICY_VERSION,
      policy_clause: 'DISABLED',
    };
  }

  // PROPOSE_ONLY → no execution
  if (input.autonomy_mode === 'PROPOSE_ONLY') {
    return {
      decision: 'REQUIRE_APPROVAL',
      reason: 'PROPOSE_ONLY',
      explanation: 'Autonomy is set to propose only; human approval required.',
      policy_version: POLICY_VERSION,
      policy_clause: 'PROPOSE_ONLY',
    };
  }

  // APPROVAL_REQUIRED → always require approval
  if (input.autonomy_mode === 'APPROVAL_REQUIRED') {
    return {
      decision: 'REQUIRE_APPROVAL',
      reason: 'TENANT_POLICY',
      explanation: 'Tenant policy requires approval for this action type.',
      policy_version: POLICY_VERSION,
      policy_clause: 'APPROVAL_REQUIRED',
    };
  }

  // AUTO_EXECUTE: allow only if risk is LOW or MINIMAL and confidence meets threshold
  if (input.autonomy_mode !== 'AUTO_EXECUTE') {
    return {
      decision: 'REQUIRE_APPROVAL',
      reason: 'UNKNOWN_MODE',
      explanation: `Unexpected autonomy mode: ${input.autonomy_mode}. Defaulting to approval required.`,
      policy_version: POLICY_VERSION,
      policy_clause: 'UNKNOWN_MODE',
    };
  }

  const risk = (input.risk_level || '').toUpperCase();
  const confidence = typeof input.confidence_score === 'number' ? input.confidence_score : 0;

  // HIGH/MEDIUM risk → require approval
  if (risk === 'HIGH' || risk === 'MEDIUM') {
    return {
      decision: 'REQUIRE_APPROVAL',
      reason: 'RISK_LEVEL_HIGH',
      explanation: `Risk level is ${risk}; autonomous execution is only allowed for LOW or MINIMAL risk.`,
      policy_version: POLICY_VERSION,
      policy_clause: 'RISK_LEVEL',
    };
  }

  // Confidence threshold: require at least 0.7 for auto-execute
  const MIN_CONFIDENCE = 0.7;
  if (confidence < MIN_CONFIDENCE) {
    return {
      decision: 'REQUIRE_APPROVAL',
      reason: 'CONFIDENCE_BELOW_THRESHOLD',
      explanation: `Confidence ${confidence.toFixed(2)} is below minimum ${MIN_CONFIDENCE} for auto-execute.`,
      policy_version: POLICY_VERSION,
      policy_clause: 'CONFIDENCE',
    };
  }

  return {
    decision: 'AUTO_EXECUTE',
    explanation: 'Policy allows autonomous execution for this action (low risk, sufficient confidence).',
    policy_version: POLICY_VERSION,
    policy_clause: 'AUTO_EXECUTE_ALLOWED',
  };
}

/**
 * Engine wrapper for dependency injection and future OPA/Lambda swap.
 */
export class AutoApprovalPolicyEngine {
  evaluate(input: AutoApprovalPolicyInputV1): AutoApprovalPolicyResultV1 {
    return evaluateAutoApprovalPolicy(input);
  }
}
