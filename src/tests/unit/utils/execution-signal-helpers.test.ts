/**
 * Unit tests for execution-signal-helpers (Phase 4.4)
 */

import { buildExecutionOutcomeSignal } from '../../../utils/execution-signal-helpers';
import { SignalType } from '../../../types/SignalTypes';
import { ActionOutcomeV1 } from '../../../types/ExecutionTypes';
import { ActionIntentV1 } from '../../../types/DecisionTypes';

const now = '2026-01-29T12:00:00.000Z';
const traceId = 'trace-1';

function makeOutcome(overrides: Partial<ActionOutcomeV1> = {}): ActionOutcomeV1 {
  return {
    action_intent_id: 'ai_123',
    tenant_id: 'tenant-1',
    account_id: 'account-1',
    status: 'SUCCEEDED',
    external_object_refs: [],
    attempt_count: 1,
    tool_name: 'crm.create_task',
    tool_schema_version: 'v1.0',
    registry_version: 1,
    tool_run_ref: 'run-1',
    started_at: now,
    completed_at: now,
    compensation_status: 'NONE',
    trace_id: traceId,
    ...overrides,
  } as ActionOutcomeV1;
}

function makeIntent(): ActionIntentV1 {
  return {
    action_intent_id: 'ai_123',
    action_type: 'CREATE_INTERNAL_NOTE',
    target: { entity_type: 'ACCOUNT', entity_id: 'account-1' },
    parameters: {},
    approved_by: 'user-1',
    approval_timestamp: now,
    execution_policy: { retry_count: 3, timeout_seconds: 300, max_attempts: 1 },
    expires_at: now,
    expires_at_epoch: Math.floor(Date.now() / 1000),
    original_decision_id: 'dec-1',
    original_proposal_id: 'dec-1',
    edited_fields: [],
    tenant_id: 'tenant-1',
    account_id: 'account-1',
    trace_id: traceId,
    registry_version: 1,
  };
}

describe('execution-signal-helpers', () => {
  describe('buildExecutionOutcomeSignal', () => {
    it('returns ACTION_EXECUTED signal for SUCCEEDED outcome', () => {
      const outcome = makeOutcome({ status: 'SUCCEEDED' });
      const signal = buildExecutionOutcomeSignal(outcome, null, traceId, now);

      expect(signal.signalType).toBe(SignalType.ACTION_EXECUTED);
      expect(signal.accountId).toBe('account-1');
      expect(signal.tenantId).toBe('tenant-1');
      expect(signal.traceId).toBe(traceId);
      expect(signal.createdAt).toBe(now);
      expect(signal.updatedAt).toBe(now);
      expect(signal.status).toBe('ACTIVE');
      expect(signal.metadata.severity).toBe('low');
      expect(signal.description).toContain('succeeded');
      expect(signal.signalId).toContain('ai_123');
      expect(signal.signalId).toContain('account-1');
      expect(signal.evidence.evidenceRef.s3Uri).toContain('execution://');
      expect(signal.windowKey).toBeDefined();
      expect(signal.dedupeKey).toBeDefined();
    });

    it('returns ACTION_FAILED signal for FAILED outcome', () => {
      const outcome = makeOutcome({ status: 'FAILED' });
      const signal = buildExecutionOutcomeSignal(outcome, null, traceId, now);

      expect(signal.signalType).toBe(SignalType.ACTION_FAILED);
      expect(signal.metadata.severity).toBe('medium');
      expect(signal.description).toContain('failed');
    });

    it('includes intent context when intent is provided', () => {
      const outcome = makeOutcome();
      const intent = makeIntent();
      const signal = buildExecutionOutcomeSignal(outcome, intent, traceId, now);

      expect(signal.context).toEqual({
        original_decision_id: 'dec-1',
        registry_version: 1,
      });
    });

    it('omits original_decision_id from context when intent is null', () => {
      const outcome = makeOutcome();
      const signal = buildExecutionOutcomeSignal(outcome, null, traceId, now);

      expect(signal.context).toEqual({ registry_version: 1 });
    });

    it('sets evidence ref with execution URI and schema version', () => {
      const outcome = makeOutcome({ action_intent_id: 'ai_xyz' });
      const signal = buildExecutionOutcomeSignal(outcome, null, traceId, now);

      expect(signal.evidence.evidenceRef.s3Uri).toBe(
        'execution://tenant-1/account-1/ai_xyz'
      );
      expect(signal.evidence.evidenceRef.schemaVersion).toBe('execution-outcome-v1');
      expect(signal.evidence.evidenceSchemaVersion).toBe('execution-outcome-v1');
    });

    it('sets detectorVersion and suppression', () => {
      const outcome = makeOutcome();
      const signal = buildExecutionOutcomeSignal(outcome, null, traceId, now);

      expect(signal.detectorVersion).toBe('execution-outcome-v1');
      expect(signal.suppression.suppressed).toBe(false);
      expect(signal.suppression.inferenceActive).toBe(true);
    });
  });
});
