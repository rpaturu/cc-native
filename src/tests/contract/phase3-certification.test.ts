/**
 * Phase 3 Certification Tests
 * 
 * Contract tests for Phase 3 decision layer:
 * - Decision synthesis produces valid proposals
 * - Policy gate is deterministic
 * - Budget enforcement works
 * - Approval/rejection flow is secure
 */

import { DecisionProposalBodyV1Schema, DecisionProposalV1Schema, ActionProposalV1Schema } from '../../types/DecisionTypes';
import { PolicyGateService } from '../../services/decision/PolicyGateService';
import { Logger } from '../../services/core/Logger';
import { PolicyContext } from '../../types/DecisionTypes';
import { ActionTypeV1Enum, ACTION_TYPE_RISK_TIERS } from '../../types/DecisionTypes';

describe('Phase 3 Certification Tests', () => {
  let policyGateService: PolicyGateService;
  let logger: Logger;

  beforeEach(() => {
    logger = new Logger('Phase3CertificationTest');
    policyGateService = new PolicyGateService(logger);
  });

  describe('Decision Proposal Schema Validation', () => {
    it('should validate PROPOSE_ACTIONS with at least one action', () => {
      const validProposal = {
        decision_type: 'PROPOSE_ACTIONS' as const,
        decision_version: 'v1' as const,
        schema_version: 'v1' as const,
        decision_reason_codes: ['REASON_1'],
        summary: 'Test proposal',
        actions: [
          {
            action_type: 'CREATE_INTERNAL_NOTE',
            why: ['REASON_1'],
            confidence: 0.8,
            risk_level: 'LOW' as const,
            llm_suggests_human_review: false,
            blocking_unknowns: [],
            parameters: {},
            target: { entity_type: 'ACCOUNT' as const, entity_id: 'account-1' },
          },
        ],
      };

      expect(() => DecisionProposalBodyV1Schema.parse(validProposal)).not.toThrow();
    });

    it('should reject PROPOSE_ACTIONS with empty actions', () => {
      const invalidProposal = {
        decision_type: 'PROPOSE_ACTIONS' as const,
        decision_version: 'v1' as const,
        schema_version: 'v1' as const,
        decision_reason_codes: [],
        summary: 'Test proposal',
        actions: [],
      };

      expect(() => DecisionProposalBodyV1Schema.parse(invalidProposal)).toThrow();
    });

    it('should validate NO_ACTION_RECOMMENDED with empty actions', () => {
      const validProposal = {
        decision_type: 'NO_ACTION_RECOMMENDED' as const,
        decision_version: 'v1' as const,
        schema_version: 'v1' as const,
        decision_reason_codes: [],
        summary: 'No action needed',
        actions: [],
      };

      expect(() => DecisionProposalBodyV1Schema.parse(validProposal)).not.toThrow();
    });

    it('should reject NO_ACTION_RECOMMENDED with non-empty actions', () => {
      const invalidProposal = {
        decision_type: 'NO_ACTION_RECOMMENDED' as const,
        decision_version: 'v1' as const,
        schema_version: 'v1' as const,
        decision_reason_codes: [],
        summary: 'Test proposal',
        actions: [
          {
            action_type: 'CREATE_INTERNAL_NOTE',
            why: ['REASON_1'],
            confidence: 0.8,
            risk_level: 'LOW' as const,
            llm_suggests_human_review: false,
            blocking_unknowns: [],
            parameters: {},
            target: { entity_type: 'ACCOUNT' as const, entity_id: 'account-1' },
          },
        ],
      };

      expect(() => DecisionProposalBodyV1Schema.parse(invalidProposal)).toThrow();
    });

    it('should validate BLOCKED_BY_UNKNOWNS with non-empty blocking_unknowns and empty actions', () => {
      const validProposal = {
        decision_type: 'BLOCKED_BY_UNKNOWNS' as const,
        decision_version: 'v1' as const,
        schema_version: 'v1' as const,
        decision_reason_codes: [],
        summary: 'Blocked by unknowns',
        blocking_unknowns: ['unknown-1'],
        actions: [],
      };

      expect(() => DecisionProposalBodyV1Schema.parse(validProposal)).not.toThrow();
    });

    it('should reject BLOCKED_BY_UNKNOWNS with empty blocking_unknowns', () => {
      const invalidProposal = {
        decision_type: 'BLOCKED_BY_UNKNOWNS' as const,
        decision_version: 'v1' as const,
        schema_version: 'v1' as const,
        decision_reason_codes: [],
        summary: 'Blocked by unknowns',
        blocking_unknowns: [],
        actions: [],
      };

      expect(() => DecisionProposalBodyV1Schema.parse(invalidProposal)).toThrow();
    });
  });

  describe('Policy Gate Determinism', () => {
    const mockPolicyContext: PolicyContext = {
      tenant_id: 'tenant-1',
      min_confidence_threshold: 0.70,
      action_type_permissions: Object.fromEntries(
        ActionTypeV1Enum.options.map(actionType => [
          actionType,
          {
            default_approval_required: ACTION_TYPE_RISK_TIERS[actionType].default_approval_required,
            min_confidence: ACTION_TYPE_RISK_TIERS[actionType].min_confidence,
            risk_tier: ACTION_TYPE_RISK_TIERS[actionType].risk_tier,
          },
        ])
      ) as any,
      cost_budget_remaining: 100,
    };

    it('should produce same result for same proposal (deterministic)', async () => {
      const proposal = {
        action_ref: 'action-ref-1',
        action_type: 'UPDATE_OPPORTUNITY_STAGE' as const,
        why: ['REASON_1'],
        confidence: 0.75,
        risk_level: 'MEDIUM' as const,
        llm_suggests_human_review: false,
        blocking_unknowns: [],
        parameters: {},
        target: { entity_type: 'ACCOUNT' as const, entity_id: 'account-1' },
      };

      const result1 = await policyGateService.evaluateAction(proposal, mockPolicyContext);
      const result2 = await policyGateService.evaluateAction(proposal, mockPolicyContext);

      expect(result1.evaluation).toBe(result2.evaluation);
      expect(result1.reason_codes).toEqual(result2.reason_codes);
      expect(result1.policy_risk_tier).toBe(result2.policy_risk_tier);
    });

    it('should always require approval for MEDIUM risk actions (policy authoritative)', async () => {
      const proposal = {
        action_ref: 'action-ref-1',
        action_type: 'UPDATE_OPPORTUNITY_STAGE' as const,
        why: ['REASON_1'],
        confidence: 0.9,
        risk_level: 'LOW' as const, // LLM says LOW, but policy tier is MEDIUM
        llm_suggests_human_review: false,
        blocking_unknowns: [],
        parameters: {},
        target: { entity_type: 'ACCOUNT' as const, entity_id: 'account-1' },
      };

      const result = await policyGateService.evaluateAction(proposal, mockPolicyContext);

      // Policy tier (MEDIUM) is authoritative, not LLM risk_level (LOW)
      expect(result.evaluation).toBe('APPROVAL_REQUIRED');
      expect(result.policy_risk_tier).toBe('MEDIUM');
      expect(result.llm_risk_level).toBe('LOW'); // LLM estimate preserved for reference
    });
  });

  describe('Action Proposal Schema Validation', () => {
    it('should validate action proposal with all required fields', () => {
      const validAction = {
        action_ref: 'action-ref-1',
        action_type: 'CREATE_INTERNAL_NOTE',
        why: ['REASON_1'],
        confidence: 0.8,
        risk_level: 'LOW' as const,
        llm_suggests_human_review: false,
        blocking_unknowns: [],
        parameters: {},
        target: { entity_type: 'ACCOUNT' as const, entity_id: 'account-1' },
      };

      expect(() => ActionProposalV1Schema.parse(validAction)).not.toThrow();
    });

    it('should require action_ref in enriched proposal', () => {
      const invalidAction = {
        // Missing action_ref
        action_type: 'CREATE_INTERNAL_NOTE',
        why: ['REASON_1'],
        confidence: 0.8,
        risk_level: 'LOW' as const,
        llm_suggests_human_review: false,
        blocking_unknowns: [],
        parameters: {},
        target: { entity_type: 'ACCOUNT' as const, entity_id: 'account-1' },
      };

      expect(() => ActionProposalV1Schema.parse(invalidAction)).toThrow();
    });
  });
});
