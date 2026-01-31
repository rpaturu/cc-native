/**
 * Phase 5.6 — Ledger explanation: why / what it knew / which policy.
 * Builds LedgerExplanationV1 from execution outcome + ledger entries (canonical: action_intent_id).
 */

import { Logger } from '../core/Logger';
import type { ExecutionOutcomeService } from '../execution/ExecutionOutcomeService';
import type { ILedgerService } from '../../types/LedgerTypes';
import { LedgerEventType } from '../../types/LedgerTypes';
import type { LedgerExplanationV1 } from '../../types/phase5/ControlCenterTypes';

export interface LedgerExplanationServiceDeps {
  executionOutcomeService: ExecutionOutcomeService;
  ledgerService: ILedgerService;
  logger: Logger;
}

/**
 * Builds human-readable explanation from outcome + ledger. Canonical key: action_intent_id
 * (execution_id in response is set to action_intent_id for our model).
 */
export class LedgerExplanationService {
  constructor(private deps: LedgerExplanationServiceDeps) {}

  async getExplanation(
    actionIntentId: string,
    tenantId: string,
    accountId: string
  ): Promise<LedgerExplanationV1 | null> {
    const outcome = await this.deps.executionOutcomeService.getOutcome(
      actionIntentId,
      tenantId,
      accountId
    );
    if (!outcome) return null;

    const entries = await this.deps.ledgerService.query({
      tenantId,
      traceId: outcome.trace_id,
      limit: 100,
    });

    const why = this.deriveWhy(entries, outcome);
    const what_it_knew = this.deriveWhatItKnew(entries);
    const which_policy = this.deriveWhichPolicy(entries);

    return {
      execution_id: actionIntentId,
      action_intent_id: actionIntentId,
      account_id: accountId,
      tenant_id: tenantId,
      why,
      what_it_knew:
        what_it_knew && typeof what_it_knew === 'object' && Object.keys(what_it_knew).length > 0
          ? what_it_knew
          : undefined,
      which_policy,
      approval_source: outcome.approval_source,
      auto_executed: outcome.auto_executed,
    };
  }

  private deriveWhy(
    entries: { eventType: string; data?: Record<string, unknown> }[],
    outcome: { status: string }
  ): LedgerExplanationV1['why'] {
    const approved = entries.find(e => e.eventType === LedgerEventType.ACTION_APPROVED);
    const policyEval = entries.find(e => e.eventType === LedgerEventType.POLICY_EVALUATED);
    const executed = entries.find(e => e.eventType === LedgerEventType.ACTION_EXECUTED);
    const failed = entries.find(e => e.eventType === LedgerEventType.ACTION_FAILED);

    let policy_decision = 'REQUIRE_APPROVAL';
    let reason: string | undefined;
    let explanation = 'Execution outcome recorded.';

    if (policyEval?.data?.evaluation) {
      policy_decision = (policyEval.data.evaluation as string).toUpperCase().replace(' ', '_');
      explanation = (policyEval.data.explanation as string) || explanation;
      reason = policyEval.data.reason as string | undefined;
    }
    if (approved) {
      policy_decision = 'AUTO_EXECUTE';
      explanation = 'Action approved (human or policy).';
    }
    if (outcome.status === 'SUCCEEDED' && executed) {
      explanation = 'Action executed successfully.';
    }
    if (outcome.status === 'FAILED' && failed) {
      explanation = (failed.data?.error_message as string) || 'Execution failed.';
      reason = failed.data?.error_class as string | undefined;
    }

    return {
      trigger_type: approved ? 'APPROVAL' : policyEval ? 'POLICY' : 'EXECUTION',
      policy_decision: policy_decision as LedgerExplanationV1['why']['policy_decision'],
      reason,
      explanation,
    };
  }

  private deriveWhatItKnew(
    entries: { eventType: string; data?: Record<string, unknown> }[]
  ): LedgerExplanationV1['what_it_knew'] {
    const decision = entries.find(e => e.eventType === LedgerEventType.DECISION_PROPOSED);
    const out: LedgerExplanationV1['what_it_knew'] = {};
    if (decision?.data?.signals_snapshot) out.signals_snapshot = decision.data.signals_snapshot;
    if (decision?.data?.posture_snapshot) out.posture_snapshot = decision.data.posture_snapshot;
    if (decision?.data?.intent_snapshot) out.intent_snapshot = decision.data.intent_snapshot;
    return out;
  }

  private deriveWhichPolicy(
    entries: { eventType: string; data?: Record<string, unknown> }[]
  ): LedgerExplanationV1['which_policy'] {
    const policyEval = entries.find(e => e.eventType === LedgerEventType.POLICY_EVALUATED);
    const policy_version = (policyEval?.data?.policy_version as string) || 'unknown';
    const policy_clause = policyEval?.data?.policy_clause as string | undefined;
    return { policy_version, policy_clause };
  }
}
