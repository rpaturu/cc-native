/**
 * Phase 5.5 — Outcome normalization to learning-ready format with OutcomeTaxonomyV1.
 * Maps ActionOutcome (Phase 4) and approval/rejection events (Phase 3) to NormalizedOutcomeV1.
 */

import { v4 as uuidv4 } from 'uuid';
import type { ActionOutcomeV1 } from '../../types/ExecutionTypes';
import type { NormalizedOutcomeV1, OutcomeTaxonomyV1 } from '../../types/learning/LearningTypes';

/** Context from the action intent when normalizing from execution outcome. */
export interface ExecutionOutcomeIntentContext {
  action_type: string;
  edited_fields?: string[];
  confidence_score?: number;
}

/** Rejection event (Phase 3 ACTION_REJECTED); no action_intent_id. */
export interface RejectionEventInput {
  decision_id: string;
  action_ref: string;
  tenant_id: string;
  account_id: string;
  outcome_at: string;
  action_type: string;
}

/**
 * Pure normalization logic: no I/O. Caller persists NormalizedOutcomeV1 and writes
 * NORMALIZATION_MISSING ledger entries when gaps are detected.
 */
export class OutcomeNormalizationService {
  /**
   * Normalize from Phase 4 execution outcome.
   * Taxonomy: EXECUTION_SUCCEEDED, EXECUTION_FAILED, or IDEA_EDITED (approved with edits then succeeded).
   */
  normalizeFromExecutionOutcome(
    outcome: ActionOutcomeV1,
    intentContext: ExecutionOutcomeIntentContext
  ): NormalizedOutcomeV1 {
    const taxonomy = this.taxonomyFromExecutionOutcome(outcome, intentContext);
    const outcome_id = `outcome-${outcome.action_intent_id}-${uuidv4().slice(0, 8)}`;
    return {
      outcome_id,
      action_intent_id: outcome.action_intent_id,
      tenant_id: outcome.tenant_id,
      account_id: outcome.account_id,
      taxonomy,
      action_type: intentContext.action_type,
      confidence_score: intentContext.confidence_score,
      executed_at: outcome.started_at,
      outcome_at: outcome.completed_at,
      metadata: {
        tool_name: outcome.tool_name,
        status: outcome.status,
        attempt_count: outcome.attempt_count,
      },
    };
  }

  /**
   * Normalize from Phase 3 rejection (no intent created).
   * Taxonomy: IDEA_REJECTED. action_intent_id omitted.
   */
  normalizeFromRejection(event: RejectionEventInput): NormalizedOutcomeV1 {
    const outcome_id = `rejected-${event.decision_id}-${event.action_ref}-${uuidv4().slice(0, 8)}`;
    return {
      outcome_id,
      tenant_id: event.tenant_id,
      account_id: event.account_id,
      taxonomy: 'IDEA_REJECTED',
      action_type: event.action_type,
      outcome_at: event.outcome_at,
      metadata: { decision_id: event.decision_id, action_ref: event.action_ref },
    };
  }

  private taxonomyFromExecutionOutcome(
    outcome: ActionOutcomeV1,
    intentContext: ExecutionOutcomeIntentContext
  ): OutcomeTaxonomyV1 {
    if (outcome.status === 'SUCCEEDED') {
      const hadEdits = (intentContext.edited_fields?.length ?? 0) > 0;
      return hadEdits ? 'IDEA_EDITED' : 'EXECUTION_SUCCEEDED';
    }
    return 'EXECUTION_FAILED';
  }
}
