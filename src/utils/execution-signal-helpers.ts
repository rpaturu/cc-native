/**
 * Execution Signal Helpers - Phase 4.4
 *
 * Builds Signal objects for execution outcomes (ACTION_EXECUTED / ACTION_FAILED)
 * for consistent signal shape and perception layer integration.
 */

import { createHash } from 'crypto';
import {
  Signal,
  SignalType,
  SignalStatus,
  WINDOW_KEY_DERIVATION,
  DEFAULT_SIGNAL_TTL,
  EvidenceSnapshotRef,
  EvidenceBinding,
  SignalMetadata,
  SignalSuppression,
  SignalTTL,
} from '../types/SignalTypes';
import { ActionOutcomeV1 } from '../types/ExecutionTypes';
import { ActionIntentV1 } from '../types/DecisionTypes';

const EXECUTION_DETECTOR_VERSION = 'execution-outcome-v1';
const EXECUTION_EVIDENCE_SCHEMA = 'execution-outcome-v1';

/**
 * Build a full Signal from an execution outcome for ACTION_EXECUTED or ACTION_FAILED.
 * Uses WINDOW_KEY_DERIVATION and DEFAULT_SIGNAL_TTL for consistent contract.
 *
 * @param outcome - Recorded execution outcome
 * @param intent - Action intent (optional; used for context only)
 * @param trace_id - Execution trace ID
 * @param now - ISO timestamp for signal creation
 */
export function buildExecutionOutcomeSignal(
  outcome: ActionOutcomeV1,
  intent: ActionIntentV1 | null,
  trace_id: string,
  now: string
): Signal {
  const signalType =
    outcome.status === 'SUCCEEDED' ? SignalType.ACTION_EXECUTED : SignalType.ACTION_FAILED;

  const evidencePayload = {
    action_intent_id: outcome.action_intent_id,
    completed_at: outcome.completed_at,
    status: outcome.status,
  };
  const evidenceRef: EvidenceSnapshotRef = {
    s3Uri: `execution://${outcome.tenant_id}/${outcome.account_id}/${outcome.action_intent_id}`,
    sha256: createHash('sha256').update(JSON.stringify(evidencePayload)).digest('hex'),
    capturedAt: outcome.completed_at,
    schemaVersion: EXECUTION_EVIDENCE_SCHEMA,
    detectorInputVersion: EXECUTION_EVIDENCE_SCHEMA,
  };
  const evidence: EvidenceBinding = {
    evidenceRef,
    evidenceSchemaVersion: EXECUTION_EVIDENCE_SCHEMA,
  };

  const windowKey = WINDOW_KEY_DERIVATION[signalType](
    outcome.account_id,
    { action_intent_id: outcome.action_intent_id },
    now
  );

  const ttlConfig = DEFAULT_SIGNAL_TTL[signalType];
  const ttl: SignalTTL = {
    ttlDays: ttlConfig.ttlDays,
    expiresAt:
      ttlConfig.ttlDays != null
        ? new Date(new Date(now).getTime() + ttlConfig.ttlDays * 24 * 60 * 60 * 1000).toISOString()
        : null,
    isPermanent: ttlConfig.isPermanent,
  };

  const metadata: SignalMetadata = {
    confidence: 1.0,
    confidenceSource: 'direct',
    severity: outcome.status === 'SUCCEEDED' ? 'low' : 'medium',
    ttl,
  };

  const suppression: SignalSuppression = {
    suppressed: false,
    suppressedAt: null,
    suppressedBy: null,
    inferenceActive: true,
  };

  const signalId = `exec-${outcome.action_intent_id}-${outcome.account_id}-${signalType}`;
  const dedupeKey = createHash('sha256')
    .update(`${outcome.account_id}:${signalType}:${windowKey}:${evidenceRef.sha256}`)
    .digest('hex');

  return {
    signalId,
    signalType,
    accountId: outcome.account_id,
    tenantId: outcome.tenant_id,
    traceId: trace_id,
    createdAt: now,
    updatedAt: now,
    dedupeKey,
    windowKey,
    detectorVersion: EXECUTION_DETECTOR_VERSION,
    detectorInputVersion: EXECUTION_EVIDENCE_SCHEMA,
    status: SignalStatus.ACTIVE,
    metadata,
    evidence,
    suppression,
    description: `Execution ${outcome.status.toLowerCase()}: ${outcome.action_intent_id}`,
    context: intent
      ? { original_decision_id: intent.original_decision_id, registry_version: outcome.registry_version }
      : { registry_version: outcome.registry_version },
  };
}
