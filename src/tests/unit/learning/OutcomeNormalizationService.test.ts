/**
 * Unit tests for OutcomeNormalizationService — Phase 5.5
 */

import { OutcomeNormalizationService } from '../../../services/learning/OutcomeNormalizationService';
import type { ActionOutcomeV1 } from '../../../types/ExecutionTypes';

describe('OutcomeNormalizationService', () => {
  let service: OutcomeNormalizationService;

  beforeEach(() => {
    service = new OutcomeNormalizationService();
  });

  describe('normalizeFromExecutionOutcome', () => {
    const baseOutcome: ActionOutcomeV1 = {
      pk: 'pk',
      sk: 'sk',
      action_intent_id: 'ai_1',
      status: 'SUCCEEDED',
      external_object_refs: [],
      attempt_count: 1,
      tool_name: 'crm.create_task',
      tool_schema_version: 'v1.0',
      registry_version: 1,
      tool_run_ref: 'ref',
      started_at: '2026-01-01T10:00:00.000Z',
      completed_at: '2026-01-01T10:05:00.000Z',
      compensation_status: 'NONE',
      tenant_id: 't1',
      account_id: 'a1',
      trace_id: 'trace1',
    };

    it('maps SUCCEEDED with no edits to EXECUTION_SUCCEEDED', () => {
      const result = service.normalizeFromExecutionOutcome(baseOutcome, {
        action_type: 'CREATE_CRM_TASK',
      });
      expect(result.taxonomy).toBe('EXECUTION_SUCCEEDED');
      expect(result.action_intent_id).toBe('ai_1');
      expect(result.action_type).toBe('CREATE_CRM_TASK');
      expect(result.outcome_at).toBe(baseOutcome.completed_at);
      expect(result.outcome_id).toMatch(/^outcome-ai_1-/);
    });

    it('maps SUCCEEDED with edited_fields to IDEA_EDITED', () => {
      const result = service.normalizeFromExecutionOutcome(baseOutcome, {
        action_type: 'CREATE_CRM_TASK',
        edited_fields: ['parameters.subject'],
      });
      expect(result.taxonomy).toBe('IDEA_EDITED');
    });

    it('maps FAILED to EXECUTION_FAILED', () => {
      const failed = { ...baseOutcome, status: 'FAILED' as const };
      const result = service.normalizeFromExecutionOutcome(failed, {
        action_type: 'CREATE_CRM_TASK',
      });
      expect(result.taxonomy).toBe('EXECUTION_FAILED');
    });

    it('maps CANCELLED and RETRYING to EXECUTION_FAILED', () => {
      const cancelled = { ...baseOutcome, status: 'CANCELLED' as const };
      expect(service.normalizeFromExecutionOutcome(cancelled, { action_type: 'X' }).taxonomy).toBe('EXECUTION_FAILED');
      const retrying = { ...baseOutcome, status: 'RETRYING' as const };
      expect(service.normalizeFromExecutionOutcome(retrying, { action_type: 'X' }).taxonomy).toBe('EXECUTION_FAILED');
    });

    it('maps SUCCEEDED with empty edited_fields to EXECUTION_SUCCEEDED', () => {
      const result = service.normalizeFromExecutionOutcome(baseOutcome, {
        action_type: 'CREATE_CRM_TASK',
        edited_fields: [],
      });
      expect(result.taxonomy).toBe('EXECUTION_SUCCEEDED');
    });

    it('includes confidence_score and metadata when provided', () => {
      const result = service.normalizeFromExecutionOutcome(baseOutcome, {
        action_type: 'CREATE_CRM_TASK',
        confidence_score: 0.9,
      });
      expect(result.confidence_score).toBe(0.9);
      expect(result.metadata?.tool_name).toBe('crm.create_task');
      expect(result.metadata?.status).toBe('SUCCEEDED');
    });
  });

  describe('normalizeFromRejection', () => {
    it('produces IDEA_REJECTED with no action_intent_id', () => {
      const result = service.normalizeFromRejection({
        decision_id: 'dec_1',
        action_ref: 'ref_1',
        tenant_id: 't1',
        account_id: 'a1',
        outcome_at: '2026-01-01T12:00:00.000Z',
        action_type: 'CREATE_CRM_TASK',
      });
      expect(result.taxonomy).toBe('IDEA_REJECTED');
      expect(result.action_intent_id).toBeUndefined();
      expect(result.outcome_id).toMatch(/^rejected-dec_1-ref_1-/);
      expect(result.metadata?.decision_id).toBe('dec_1');
      expect(result.metadata?.action_ref).toBe('ref_1');
    });
  });
});
