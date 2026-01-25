/**
 * PolicyGateService Unit Tests - Phase 3
 */

import { PolicyGateService } from '../../../services/decision/PolicyGateService';
import { Logger } from '../../../services/core/Logger';
import { ActionProposalV1, PolicyContext, DecisionProposalV1 } from '../../../types/DecisionTypes';
import { ActionTypeV1Enum } from '../../../types/DecisionTypes';

describe('PolicyGateService', () => {
  let policyGateService: PolicyGateService;
  let logger: Logger;

  beforeEach(() => {
    logger = new Logger('PolicyGateServiceTest');
    policyGateService = new PolicyGateService(logger);
  });

  describe('evaluateAction', () => {
    const mockPolicyContext: PolicyContext = {
      tenant_id: 'tenant-1',
      min_confidence_threshold: 0.70,
      action_type_permissions: {
        'REQUEST_RENEWAL_MEETING': {
          default_approval_required: true,
          min_confidence: 0.75,
          risk_tier: 'HIGH',
        },
        'UPDATE_OPPORTUNITY_STAGE': {
          default_approval_required: true,
          min_confidence: 0.70,
          risk_tier: 'MEDIUM',
        },
        'CREATE_INTERNAL_NOTE': {
          default_approval_required: false,
          min_confidence: 0.65,
          risk_tier: 'LOW',
        },
        'FETCH_ACCOUNT_NEWS': {
          default_approval_required: false,
          min_confidence: 0.60,
          risk_tier: 'MINIMAL',
        },
      } as any,
      cost_budget_remaining: 100,
    };

    it('should block unknown action types', async () => {
      const proposal: ActionProposalV1 = {
        action_ref: 'action-ref-1',
        action_type: 'UNKNOWN_ACTION' as any,
        why: ['REASON_1'],
        confidence: 0.9,
        risk_level: 'LOW',
        llm_suggests_human_review: false,
        blocking_unknowns: [],
        parameters: {},
        target: { entity_type: 'ACCOUNT', entity_id: 'account-1' },
      };

      const result = await policyGateService.evaluateAction(proposal, mockPolicyContext);

      expect(result.evaluation).toBe('BLOCKED');
      expect(result.reason_codes).toContain('UNKNOWN_ACTION_TYPE');
      expect(result.blocked_reason).toBe('UNKNOWN_ACTION_TYPE');
    });

    it('should block actions with blocking unknowns', async () => {
      const proposal: ActionProposalV1 = {
        action_ref: 'action-ref-1',
        action_type: 'REQUEST_RENEWAL_MEETING',
        why: ['REASON_1'],
        confidence: 0.9,
        risk_level: 'HIGH',
        llm_suggests_human_review: true,
        blocking_unknowns: ['renewal_date_unknown'],
        parameters: {},
        target: { entity_type: 'ACCOUNT', entity_id: 'account-1' },
      };

      const result = await policyGateService.evaluateAction(proposal, mockPolicyContext);

      expect(result.evaluation).toBe('BLOCKED');
      expect(result.reason_codes).toContain('BLOCKING_UNKNOWNS_PRESENT');
      expect(result.needs_human_input).toBe(true);
    });

    it('should require approval for HIGH risk actions', async () => {
      const proposal: ActionProposalV1 = {
        action_ref: 'action-ref-1',
        action_type: 'REQUEST_RENEWAL_MEETING',
        why: ['REASON_1'],
        confidence: 0.9,
        risk_level: 'HIGH',
        llm_suggests_human_review: true,
        blocking_unknowns: [],
        parameters: {},
        target: { entity_type: 'ACCOUNT', entity_id: 'account-1' },
      };

      const result = await policyGateService.evaluateAction(proposal, mockPolicyContext);

      expect(result.evaluation).toBe('APPROVAL_REQUIRED');
      expect(result.reason_codes).toContain('HIGH_RISK_ACTION');
      expect(result.approval_required).toBe(true);
    });

    it('should require approval for MEDIUM risk actions (policy is authoritative)', async () => {
      const proposal: ActionProposalV1 = {
        action_ref: 'action-ref-1',
        action_type: 'UPDATE_OPPORTUNITY_STAGE',
        why: ['REASON_1'],
        confidence: 0.9,
        risk_level: 'LOW', // LLM says LOW, but policy tier is MEDIUM
        llm_suggests_human_review: false,
        blocking_unknowns: [],
        parameters: {},
        target: { entity_type: 'ACCOUNT', entity_id: 'account-1' },
      };

      const result = await policyGateService.evaluateAction(proposal, mockPolicyContext);

      expect(result.evaluation).toBe('APPROVAL_REQUIRED');
      expect(result.reason_codes).toContain('MEDIUM_RISK_ACTION');
      expect(result.policy_risk_tier).toBe('MEDIUM');
      expect(result.approval_required).toBe(true);
    });

    it('should allow LOW risk actions if confidence threshold met', async () => {
      const proposal: ActionProposalV1 = {
        action_ref: 'action-ref-1',
        action_type: 'CREATE_INTERNAL_NOTE',
        why: ['REASON_1'],
        confidence: 0.8, // Above 0.65 threshold
        risk_level: 'LOW',
        llm_suggests_human_review: false,
        blocking_unknowns: [],
        parameters: {},
        target: { entity_type: 'ACCOUNT', entity_id: 'account-1' },
      };

      const result = await policyGateService.evaluateAction(proposal, mockPolicyContext);

      expect(result.evaluation).toBe('ALLOWED');
      expect(result.confidence_threshold_met).toBe(true);
    });

    it('should block LOW risk actions if confidence below threshold', async () => {
      const proposal: ActionProposalV1 = {
        action_ref: 'action-ref-1',
        action_type: 'CREATE_INTERNAL_NOTE',
        why: ['REASON_1'],
        confidence: 0.5, // Below 0.65 threshold
        risk_level: 'LOW',
        llm_suggests_human_review: false,
        blocking_unknowns: [],
        parameters: {},
        target: { entity_type: 'ACCOUNT', entity_id: 'account-1' },
      };

      const result = await policyGateService.evaluateAction(proposal, mockPolicyContext);

      expect(result.evaluation).toBe('BLOCKED');
      expect(result.reason_codes).toContain('CONFIDENCE_BELOW_THRESHOLD');
    });

    it('should allow MINIMAL risk actions if confidence >= 0.60', async () => {
      const proposal: ActionProposalV1 = {
        action_ref: 'action-ref-1',
        action_type: 'FETCH_ACCOUNT_NEWS',
        why: ['REASON_1'],
        confidence: 0.65,
        risk_level: 'MINIMAL',
        llm_suggests_human_review: false,
        blocking_unknowns: [],
        parameters: {},
        target: { entity_type: 'ACCOUNT', entity_id: 'account-1' },
      };

      const result = await policyGateService.evaluateAction(proposal, mockPolicyContext);

      expect(result.evaluation).toBe('ALLOWED');
      expect(result.reason_codes).toContain('MINIMAL_RISK_AUTO_ALLOWED');
    });
  });

  describe('evaluateDecisionProposal', () => {
    it('should return empty array for NO_ACTION_RECOMMENDED', async () => {
      const proposal: DecisionProposalV1 = {
        decision_id: 'dec-1',
        account_id: 'account-1',
        tenant_id: 'tenant-1',
        trace_id: 'trace-1',
        decision_type: 'NO_ACTION_RECOMMENDED',
        decision_version: 'v1',
        schema_version: 'v1',
        decision_reason_codes: [],
        summary: 'No action needed',
        actions: [],
        created_at: new Date().toISOString(),
        proposal_fingerprint: 'fingerprint-1',
      };

      const policyContext: PolicyContext = {
        tenant_id: 'tenant-1',
        min_confidence_threshold: 0.70,
        action_type_permissions: {} as any,
        cost_budget_remaining: 100,
      };

      const results = await policyGateService.evaluateDecisionProposal(proposal, policyContext);

      expect(results).toEqual([]);
    });

    it('should evaluate all actions in proposal', async () => {
      const proposal: DecisionProposalV1 = {
        decision_id: 'dec-1',
        account_id: 'account-1',
        tenant_id: 'tenant-1',
        trace_id: 'trace-1',
        decision_type: 'PROPOSE_ACTIONS',
        decision_version: 'v1',
        schema_version: 'v1',
        decision_reason_codes: ['REASON_1'],
        summary: 'Propose actions',
        actions: [
          {
            action_ref: 'action-ref-1',
            action_type: 'REQUEST_RENEWAL_MEETING',
            why: ['REASON_1'],
            confidence: 0.9,
            risk_level: 'HIGH',
            llm_suggests_human_review: true,
            blocking_unknowns: [],
            parameters: {},
            target: { entity_type: 'ACCOUNT', entity_id: 'account-1' },
          },
        ],
        created_at: new Date().toISOString(),
        proposal_fingerprint: 'fingerprint-1',
      };

      const policyContext: PolicyContext = {
        tenant_id: 'tenant-1',
        min_confidence_threshold: 0.70,
        action_type_permissions: {
          'REQUEST_RENEWAL_MEETING': {
            default_approval_required: true,
            min_confidence: 0.75,
            risk_tier: 'HIGH',
          },
        } as any,
        cost_budget_remaining: 100,
      };

      const results = await policyGateService.evaluateDecisionProposal(proposal, policyContext);

      expect(results).toHaveLength(1);
      expect(results[0].evaluation).toBe('APPROVAL_REQUIRED');
    });
  });
});
