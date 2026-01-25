/**
 * Decision Trigger Types - Phase 3: Autonomous Decision + Action Proposal
 * 
 * Defines decision trigger types and trigger evaluation logic.
 * 
 * NOTE: DecisionTriggerType is a TypeScript enum (not Zod enum) because triggers are internal-only
 * and do not require runtime validation. This is acceptable for internal types.
 * LLM-facing types (DecisionType, ActionTypeV1) use Zod enums as source of truth.
 */

/**
 * DecisionTriggerType
 * Types of events that can trigger decision evaluation.
 */
export enum DecisionTriggerType {
  LIFECYCLE_TRANSITION = 'LIFECYCLE_TRANSITION',
  HIGH_SIGNAL_ARRIVAL = 'HIGH_SIGNAL_ARRIVAL',
  EXPLICIT_USER_REQUEST = 'EXPLICIT_USER_REQUEST',
  COOLDOWN_GATED_PERIODIC = 'COOLDOWN_GATED_PERIODIC'
}

/**
 * DecisionTrigger
 * Trigger event metadata.
 */
export interface DecisionTrigger {
  trigger_type: DecisionTriggerType;
  account_id: string;
  tenant_id: string;
  trigger_event_id?: string; // EventBridge event ID (if event-driven)
  trigger_timestamp: string;
  cooldown_until?: string; // ISO timestamp (if cooldown applies)
}

/**
 * TriggerEvaluationResult
 * Result of trigger evaluation.
 */
export interface TriggerEvaluationResult {
  should_evaluate: boolean;
  reason: string;
  cooldown_until?: string;
}
