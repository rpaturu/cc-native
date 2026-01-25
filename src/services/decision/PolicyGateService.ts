/**
 * Policy Gate Service - Phase 3
 * 
 * Deterministic policy evaluation of action proposals (code-only, no LLM).
 */

import { PolicyEvaluationResult, ActionProposalV1, DecisionProposalV1, PolicyContext } from '../../types/DecisionTypes';
import { Logger } from '../core/Logger';

/**
 * Policy Gate Service
 */
export class PolicyGateService {
  constructor(
    private logger: Logger
  ) {}

  /**
   * Evaluate action proposal against policy
   * Deterministic: same proposal → same result
   * Evaluation order: 1) Unknown action type, 2) Blocking unknowns, 3) Tier rules
   */
  async evaluateAction(
    proposal: ActionProposalV1,
    policyContext: PolicyContext
  ): Promise<PolicyEvaluationResult> {
    // Step 1: Check for unknown action type (block immediately)
    const actionPermission = policyContext.action_type_permissions[proposal.action_type];
    if (!actionPermission) {
      return {
        action_ref: proposal.action_ref, // Use action_ref from proposal (before approval)
        evaluation: 'BLOCKED',
        reason_codes: ['UNKNOWN_ACTION_TYPE'],
        confidence_threshold_met: false,
        policy_risk_tier: 'HIGH',
        approval_required: false,
        needs_human_input: false,
        blocked_reason: 'UNKNOWN_ACTION_TYPE',
        llm_suggests_human_review: proposal.llm_suggests_human_review,
        llm_risk_level: proposal.risk_level
      };
    }
    
    // Step 2: Check for blocking unknowns (block immediately, needs human input)
    const hasBlockingUnknowns = proposal.blocking_unknowns && proposal.blocking_unknowns.length > 0;
    if (hasBlockingUnknowns) {
      return {
        action_ref: proposal.action_ref, // Use action_ref from proposal (before approval)
        evaluation: 'BLOCKED',
        reason_codes: ['BLOCKING_UNKNOWNS_PRESENT'],
        confidence_threshold_met: false,
        policy_risk_tier: actionPermission.risk_tier,
        approval_required: false,
        needs_human_input: true, // Blocking unknowns require human question/input
        blocked_reason: 'BLOCKING_UNKNOWNS_PRESENT',
        llm_suggests_human_review: proposal.llm_suggests_human_review,
        llm_risk_level: proposal.risk_level
      };
    }
    
    // Step 3: Evaluate by tier rules (deterministic)
    const confidenceThresholdMet = proposal.confidence >= actionPermission.min_confidence;
    const riskTier = actionPermission.risk_tier;
    
    let evaluation: 'ALLOWED' | 'BLOCKED' | 'APPROVAL_REQUIRED';
    let reasonCodes: string[] = [];
    
    // HIGH risk actions always require approval
    if (riskTier === 'HIGH') {
      evaluation = 'APPROVAL_REQUIRED';
      reasonCodes.push('HIGH_RISK_ACTION');
    }
    // MEDIUM risk: always requires approval (policy tier is authoritative, LLM risk_level is advisory only)
    else if (riskTier === 'MEDIUM') {
      evaluation = 'APPROVAL_REQUIRED';
      reasonCodes.push('MEDIUM_RISK_ACTION');
    }
    // LOW risk: auto-allowed if confidence threshold met
    else if (riskTier === 'LOW') {
      if (confidenceThresholdMet) {
        evaluation = 'ALLOWED';
        reasonCodes.push('LOW_RISK_CONFIDENCE_THRESHOLD_MET');
      } else {
        evaluation = 'BLOCKED';
        reasonCodes.push('CONFIDENCE_BELOW_THRESHOLD');
      }
    }
    // MINIMAL risk: auto-allowed if confidence >= 0.60
    else {
      if (proposal.confidence >= 0.60) {
        evaluation = 'ALLOWED';
        reasonCodes.push('MINIMAL_RISK_AUTO_ALLOWED');
      } else {
        evaluation = 'BLOCKED';
        reasonCodes.push('CONFIDENCE_BELOW_MINIMUM');
      }
    }
    
    // Determine approval and input requirements
    const approvalRequired = evaluation === 'APPROVAL_REQUIRED';
    
    return {
      action_ref: proposal.action_ref, // Use action_ref from proposal (before approval)
      evaluation,
      reason_codes: reasonCodes,
      confidence_threshold_met: confidenceThresholdMet,
      policy_risk_tier: riskTier, // Authoritative policy risk tier
      approval_required: approvalRequired, // Authoritative: policy requires approval
      needs_human_input: false, // No blocking unknowns at this point
      blocked_reason: evaluation === 'BLOCKED' ? reasonCodes[0] : undefined,
      llm_suggests_human_review: proposal.llm_suggests_human_review, // LLM's advisory field (for reference)
      llm_risk_level: proposal.risk_level // LLM's risk estimate (for reference)
    };
  }
  
  /**
   * Evaluate all actions in a decision proposal
   */
  async evaluateDecisionProposal(
    proposal: DecisionProposalV1,
    policyContext: PolicyContext
  ): Promise<PolicyEvaluationResult[]> {
    if (proposal.decision_type === 'NO_ACTION_RECOMMENDED' ||
        proposal.decision_type === 'BLOCKED_BY_UNKNOWNS') {
      return []; // No actions to evaluate
    }
    
    const results: PolicyEvaluationResult[] = [];
    
    for (const action of proposal.actions) {
      const result = await this.evaluateAction(action, policyContext);
      results.push(result);
    }
    
    return results;
  }
}
