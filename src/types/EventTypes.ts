import { TraceContext, EventSource, EvidenceRef } from './CommonTypes';

/**
 * Standard event envelope for all system events
 * Uses camelCase in code; EventBridge Detail will serialize as-is
 */
export interface EventEnvelope {
  traceId: string;
  tenantId: string;
  accountId?: string;
  source: EventSource;
  eventType: string;
  ts: string;
  payload: Record<string, any>;
  metadata?: {
    correlationId?: string;
    causationId?: string;
    evidenceRefs?: EvidenceRef[];
  };
}

/**
 * Event type registry
 */
export enum EventType {
  // Intent events
  INTENT_RECEIVED = 'INTENT_RECEIVED',
  INTENT_PROCESSED = 'INTENT_PROCESSED',
  
  // Signal events
  SIGNAL_GENERATED = 'SIGNAL_GENERATED',
  SIGNAL_BATCH_READY = 'SIGNAL_BATCH_READY',
  
  // Tool events
  TOOL_CALL_REQUESTED = 'TOOL_CALL_REQUESTED',
  TOOL_CALL_COMPLETED = 'TOOL_CALL_COMPLETED',
  TOOL_CALL_FAILED = 'TOOL_CALL_FAILED',
  
  // Validation events
  VALIDATION_STARTED = 'VALIDATION_STARTED',
  VALIDATION_COMPLETED = 'VALIDATION_COMPLETED',
  VALIDATION_FAILED = 'VALIDATION_FAILED',
  
  // Action events
  ACTION_PROPOSED = 'ACTION_PROPOSED',
  ACTION_APPROVED = 'ACTION_APPROVED',
  ACTION_REJECTED = 'ACTION_REJECTED',
  ACTION_EXECUTED = 'ACTION_EXECUTED',
  ACTION_FAILED = 'ACTION_FAILED',
  
  // Approval events
  APPROVAL_REQUESTED = 'APPROVAL_REQUESTED',
  APPROVAL_GRANTED = 'APPROVAL_GRANTED',
  APPROVAL_DENIED = 'APPROVAL_DENIED',
  
  // Decision events
  DECISION_MADE = 'DECISION_MADE',
  
  // World Model events
  EVIDENCE_STORED = 'EVIDENCE_STORED',
  STATE_COMPUTED = 'STATE_COMPUTED',
  SNAPSHOT_CREATED = 'SNAPSHOT_CREATED',
}

/**
 * Helper to create namespaced event source
 */
export function createEventSource(source: EventSource): string {
  return `cc-native.${source}`;
}
