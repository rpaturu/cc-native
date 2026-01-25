/**
 * Decision Types - Phase 3: Autonomous Decision + Action Proposal
 * 
 * Defines canonical decision types, action types, and decision contracts.
 * Uses Zod for runtime validation (fail-closed validation).
 * 
 * Usage:
 *   import { DecisionProposalV1Schema, ActionTypeV1Enum } from "./DecisionTypes";
 *   const parsed = DecisionProposalV1Schema.parse(payload); // throws on invalid
 */

import { z } from "zod";

/**
 * ActionTypeV1
 * Canonical set of action intents the Decision Layer may propose.
 * (Keep in sync with the Phase 3 plan.)
 */
export const ActionTypeV1Enum = z.enum([
  // Outreach Actions (HIGH risk, always require approval)
  "REQUEST_RENEWAL_MEETING",
  "REQUEST_DISCOVERY_CALL",
  "REQUEST_STAKEHOLDER_INTRO",

  // CRM Write Actions (MEDIUM risk, approval unless low risk)
  "UPDATE_OPPORTUNITY_STAGE",
  "CREATE_OPPORTUNITY",
  "UPDATE_ACCOUNT_FIELDS",

  // Internal Actions (LOW risk, auto-allowed if confidence threshold met)
  "CREATE_INTERNAL_NOTE",
  "CREATE_INTERNAL_TASK",
  "FLAG_FOR_REVIEW",

  // Research Actions (MINIMAL risk, auto-allowed)
  "FETCH_ACCOUNT_NEWS",
  "ANALYZE_USAGE_PATTERNS",
]);

export type ActionTypeV1 = z.infer<typeof ActionTypeV1Enum>;

/**
 * RiskLevel
 * LLM-proposed risk classification (policy gate remains authoritative).
 * Includes MINIMAL for research actions.
 */
export const RiskLevelEnum = z.enum(["MINIMAL", "LOW", "MEDIUM", "HIGH"]);
export type RiskLevel = z.infer<typeof RiskLevelEnum>;

/**
 * DecisionType
 * Phase 3 supports three decision outcomes:
 * - PROPOSE_ACTIONS: LLM proposes specific actions
 * - NO_ACTION_RECOMMENDED: LLM determines no action is appropriate
 * - BLOCKED_BY_UNKNOWNS: Blocking unknowns prevent decision
 */
export const DecisionTypeEnum = z.enum([
  "PROPOSE_ACTIONS",
  "NO_ACTION_RECOMMENDED",
  "BLOCKED_BY_UNKNOWNS"
]);
export type DecisionType = z.infer<typeof DecisionTypeEnum>;

/**
 * Common helpers
 */
const NonEmptyString = z.string().min(1);
const ReasonCode = z
  .string()
  .min(1)
  // Encourage normalized reason codes; keep permissive to avoid over-tight coupling.
  // Examples:
  //   "RENEWAL_WINDOW_ENTERED < 90d"
  //   "USAGE_TREND_CHANGE = DOWN"
  //   "SUPPORT_RISK_EMERGING"
  .max(256);

const UnknownItem = z
  .string()
  .min(1)
  // Examples: "renewal_date_unknown", "primary_contact_missing"
  .max(128);

/**
 * DecisionActionProposalV1
 * One proposed action intent, prior to policy + human approval.
 */
export const DecisionActionProposalV1Schema = z
  .object({
    action_intent_id: NonEmptyString, // UUID recommended
    action_type: ActionTypeV1Enum,

    // "why" must be structured (array of reason strings), not a blob of prose.
    why: z.array(ReasonCode).min(1).max(20),

    // LLM self-assessed certainty, bounded [0,1].
    confidence: z.number().min(0).max(1),

    // LLM-estimated risk tier. Policy gate will reinterpret/override as needed.
    risk_level: RiskLevelEnum,

    // True means must be routed to human approval regardless of confidence.
    requires_human: z.boolean(),

    // If present and non-empty, decision flow should ask one minimal human question
    // (per Phase 3 uncertainty handling) and avoid proceeding silently.
    blocking_unknowns: z.array(UnknownItem).max(20).default([]),

    // Action-specific parameters (e.g., meeting date, opportunity stage, account fields)
    parameters: z.record(z.any()).default({}),

    // Target entity ID (account, contact, opportunity)
    target_entity: NonEmptyString,

    // Optional: allow LLM to suggest rank ordering (UI may ignore; policy may re-rank)
    // Lower number = higher priority.
    // Keep optional to avoid reliance.
    proposed_rank: z.number().int().min(1).max(50).optional(),
  })
  .strict();

export type DecisionActionProposalV1 = z.infer<
  typeof DecisionActionProposalV1Schema
>;

/**
 * DecisionProposalBodyV1
 * LLM output schema (proposal body only, no IDs).
 * Server enriches with decision_id, account_id, tenant_id, trace_id post-parse.
 */
export const DecisionProposalBodyV1Schema = z
  .object({
    decision_type: DecisionTypeEnum,

    // Normalized reason codes at decision level (for analytics)
    // Examples: ["RENEWAL_WINDOW_ENTERED", "USAGE_TREND_DOWN", "SUPPORT_RISK_EMERGING"]
    decision_reason_codes: z.array(ReasonCode).min(0).max(20).default([]),

    // Versioning: keep as literal "v1" to fail closed on incompatible changes.
    decision_version: z.literal("v1"),

    // Summary is human-readable and should be short.
    summary: z.string().min(1).max(280),

    // Actions array (empty if NO_ACTION_RECOMMENDED or BLOCKED_BY_UNKNOWNS)
    actions: z.array(DecisionActionProposalV1Schema).min(0).max(25),

    // Optional overall decision confidence (if LLM provides it)
    confidence: z.number().min(0).max(1).optional(),

    // Optional blocking unknowns at decision level (if BLOCKED_BY_UNKNOWNS)
    blocking_unknowns: z.array(UnknownItem).max(20).optional(),
  })
  .strict();

export type DecisionProposalBodyV1 = z.infer<typeof DecisionProposalBodyV1Schema>;

/**
 * DecisionProposalV1
 * Enriched proposal with server-assigned IDs and metadata.
 * This is the complete proposal after server enrichment.
 */
export interface DecisionProposalV1 extends DecisionProposalBodyV1 {
  decision_id: string; // Server-assigned (not from LLM)
  account_id: string; // Server-assigned (from context)
  tenant_id: string; // Server-assigned (from context)
  trace_id: string; // Server-assigned (from context)
  created_at?: string; // Optional timestamp
}

/**
 * DecisionProposalV1Schema (for validation of enriched proposals)
 * Used for runtime validation of complete proposals after enrichment.
 */
export const DecisionProposalV1Schema: z.ZodType<DecisionProposalV1> = DecisionProposalBodyV1Schema.extend({
  decision_id: NonEmptyString,
  account_id: NonEmptyString,
  tenant_id: NonEmptyString,
  trace_id: NonEmptyString,
  created_at: z.string().datetime().optional(),
});

/**
 * Safe parse helper (non-throwing)
 */
export function safeParseDecisionProposalV1(input: unknown): {
  ok: true;
  value: DecisionProposalV1;
} | { ok: false; error: z.ZodError } {
  const result = DecisionProposalV1Schema.safeParse(input);
  return result.success
    ? { ok: true, value: result.data }
    : { ok: false, error: result.error };
}

/**
 * Example: minimal valid payload (for tests)
 */
export const ExampleDecisionProposalV1: DecisionProposalV1 = {
  decision_id: "dec_123",
  account_id: "acct_acme",
  decision_type: "PROPOSE_ACTIONS",
  decision_version: "v1",
  decision_reason_codes: [
    "RENEWAL_WINDOW_ENTERED < 90d",
    "USAGE_TREND_CHANGE = DOWN",
    "SUPPORT_RISK_EMERGING",
  ],
  summary: "Renewal risk detected; proactive engagement recommended.",
  actions: [
    {
      action_intent_id: "ai_456",
      action_type: "REQUEST_RENEWAL_MEETING",
      why: [
        "RENEWAL_WINDOW_ENTERED < 90d",
        "USAGE_TREND_CHANGE = DOWN",
        "SUPPORT_RISK_EMERGING",
      ],
      confidence: 0.84,
      risk_level: "MEDIUM",
      requires_human: true,
      blocking_unknowns: [],
      parameters: {
        meeting_type: "renewal_review",
        suggested_date_range: "next_30_days"
      },
      target_entity: "account:acct_acme",
    },
  ],
};

// ============================================================================
// Internal Types (TypeScript interfaces, not Zod schemas)
// These are used internally and don't require runtime validation.
// ============================================================================

import { LifecycleState } from './SignalTypes';
import { AccountPostureStateV1, RiskFactorV1, OpportunityV1, UnknownV1 } from './PostureTypes';
import { Signal } from './SignalTypes';

/**
 * GraphContextRef
 * Reference to a graph vertex with bounded depth.
 */
export interface GraphContextRef {
  vertex_id: string;
  vertex_type: string;
  depth: number; // Max depth: 2
}

/**
 * ActionPermission
 * Policy configuration for an action type.
 */
export interface ActionPermission {
  default_approval_required: boolean;
  min_confidence: number;
  risk_tier: 'HIGH' | 'MEDIUM' | 'LOW' | 'MINIMAL';
}

/**
 * PolicyContext
 * Policy configuration for decision evaluation.
 */
export interface PolicyContext {
  tenant_id: string;
  min_confidence_threshold: number;
  action_type_permissions: Record<ActionTypeV1, ActionPermission>;
  cost_budget_remaining: number;
}

/**
 * DecisionContextV1
 * Input to the decision engine (assembled from account state).
 */
export interface DecisionContextV1 {
  tenant_id: string;
  account_id: string;
  lifecycle_state: LifecycleState;
  posture_state: AccountPostureStateV1;
  active_signals: Signal[];
  risk_factors: RiskFactorV1[];
  opportunities: OpportunityV1[];
  unknowns: UnknownV1[];
  graph_context_refs: GraphContextRef[]; // Bounded (max 10)
  policy_context: PolicyContext;
  trace_id: string;
}

/**
 * ActionIntentV1
 * Post-approval action intent (ready for Phase 4 execution).
 */
export interface ActionIntentV1 {
  action_intent_id: string;
  action_type: ActionTypeV1;
  target_entity: string;
  parameters: Record<string, any>;
  approved_by: string; // User ID
  approval_timestamp: string; // ISO timestamp
  execution_policy: ExecutionPolicy;
  expires_at: string; // ISO timestamp
  original_decision_id: string; // Links to DecisionProposalV1.decision_id (the decision that created this proposal)
  original_proposal_id: string; // Same as original_decision_id
  // INVARIANT: proposal_id == decision_id in v1 (there is no separate proposal_id field)
  // The decision_id is the identifier for the proposal artifact.
  supersedes_action_intent_id?: string; // If this intent was created by editing another, link to parent intent
  edited_fields: string[]; // Field names that were edited (if any)
  edited_by?: string; // User ID who edited (if edited)
  edited_at?: string; // Timestamp of edit (if edited)
  tenant_id: string;
  account_id: string;
  trace_id: string;
}

/**
 * ExecutionPolicy
 * Execution configuration for action intent.
 */
export interface ExecutionPolicy {
  retry_count: number;
  timeout_seconds: number;
  max_attempts: number;
}

/**
 * PolicyEvaluationResult
 * Result of policy gate evaluation.
 * Separates approval requirements from blocking reasons for clarity.
 */
export interface PolicyEvaluationResult {
  action_intent_id: string;
  evaluation: 'ALLOWED' | 'BLOCKED' | 'APPROVAL_REQUIRED';
  reason_codes: string[];
  confidence_threshold_met: boolean;
  risk_tier: 'HIGH' | 'MEDIUM' | 'LOW' | 'MINIMAL';
  approval_required: boolean; // True if human approval is required (authoritative, from policy)
  needs_human_input: boolean; // True if blocking unknowns require human question/input
  blocked_reason?: string; // If BLOCKED, the reason (e.g., "CONFIDENCE_BELOW_THRESHOLD", "BLOCKING_UNKNOWNS_PRESENT")
  llm_requires_human?: boolean; // LLM's advisory field (for reference, not authoritative)
}

/**
 * ActionType Risk Classification
 * Default risk tiers and policy rules per action type.
 */
export const ACTION_TYPE_RISK_TIERS: Record<ActionTypeV1, {
  risk_tier: 'HIGH' | 'MEDIUM' | 'LOW' | 'MINIMAL';
  default_approval_required: boolean;
  min_confidence: number;
}> = {
  REQUEST_RENEWAL_MEETING: {
    risk_tier: 'HIGH',
    default_approval_required: true,
    min_confidence: 0.75
  },
  REQUEST_DISCOVERY_CALL: {
    risk_tier: 'HIGH',
    default_approval_required: true,
    min_confidence: 0.75
  },
  REQUEST_STAKEHOLDER_INTRO: {
    risk_tier: 'HIGH',
    default_approval_required: true,
    min_confidence: 0.75
  },
  UPDATE_OPPORTUNITY_STAGE: {
    risk_tier: 'MEDIUM',
    default_approval_required: true,
    min_confidence: 0.70
  },
  CREATE_OPPORTUNITY: {
    risk_tier: 'MEDIUM',
    default_approval_required: true,
    min_confidence: 0.70
  },
  UPDATE_ACCOUNT_FIELDS: {
    risk_tier: 'MEDIUM',
    default_approval_required: true,
    min_confidence: 0.70
  },
  CREATE_INTERNAL_NOTE: {
    risk_tier: 'LOW',
    default_approval_required: false,
    min_confidence: 0.65
  },
  CREATE_INTERNAL_TASK: {
    risk_tier: 'LOW',
    default_approval_required: false,
    min_confidence: 0.65
  },
  FLAG_FOR_REVIEW: {
    risk_tier: 'LOW',
    default_approval_required: false,
    min_confidence: 0.65
  },
  FETCH_ACCOUNT_NEWS: {
    risk_tier: 'MINIMAL',
    default_approval_required: false,
    min_confidence: 0.60
  },
  ANALYZE_USAGE_PATTERNS: {
    risk_tier: 'MINIMAL',
    default_approval_required: false,
    min_confidence: 0.60
  },
};
