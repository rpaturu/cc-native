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
import { createHash } from "crypto";
import { LifecycleState, Signal } from './SignalTypes';
import { AccountPostureStateV1, RiskFactorV1, OpportunityV1, UnknownV1 } from './PostureTypes';

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
/**
 * ReasonCodeSchema
 * Normalized reason code string (bounded length for consistency).
 */
const ReasonCodeSchema = z
  .string()
  .min(1)
  // Encourage normalized reason codes; keep permissive to avoid over-tight coupling.
  // Examples:
  //   "RENEWAL_WINDOW_ENTERED < 90d"
  //   "USAGE_TREND_CHANGE = DOWN"
  //   "SUPPORT_RISK_EMERGING"
  .max(256);

/**
 * UnknownItemSchema
 * Unknown identifier string (bounded length).
 */
const UnknownItemSchema = z
  .string()
  .min(1)
  // Examples: "renewal_date_unknown", "primary_contact_missing"
  .max(128);

// Type aliases for consistency (derive from Zod schemas)
export type ReasonCode = z.infer<typeof ReasonCodeSchema>;
export type UnknownItem = z.infer<typeof UnknownItemSchema>;

/**
 * EntityType
 * Structured target entity type for action proposals.
 */
export const EntityTypeEnum = z.enum(['ACCOUNT', 'CONTACT', 'OPPORTUNITY', 'DEAL', 'ENGAGEMENT']);
export type EntityType = z.infer<typeof EntityTypeEnum>;

/**
 * TargetEntity
 * Structured target entity (replaces ambiguous string).
 */
export const TargetEntitySchema = z.object({
  entity_type: EntityTypeEnum,
  entity_id: NonEmptyString,
}).strict();

export type TargetEntity = z.infer<typeof TargetEntitySchema>;

/**
 * ActionProposalV1
 * One proposed action intent, prior to policy + human approval.
 * (Consolidated naming: previously "DecisionActionProposalV1")
 */
export const ActionProposalV1Schema = z
  .object({
    action_intent_id: NonEmptyString, // UUID recommended
    action_type: ActionTypeV1Enum,

    // "why" must be structured (array of reason strings), not a blob of prose.
    why: z.array(ReasonCodeSchema).min(1).max(20),

    // LLM self-assessed certainty, bounded [0,1].
    confidence: z.number().min(0).max(1),

    // LLM-estimated risk tier. Policy gate will reinterpret/override as needed.
    risk_level: RiskLevelEnum,

    // LLM's advisory opinion (policy gate is authoritative).
    // Renamed from requires_human to make advisory nature explicit.
    llm_suggests_human_review: z.boolean(),

    // If present and non-empty, decision flow should ask one minimal human question
    // (per Phase 3 uncertainty handling) and avoid proceeding silently.
    blocking_unknowns: z.array(UnknownItemSchema).max(20).default([]),

    // Action-specific parameters (e.g., meeting date, opportunity stage, account fields)
    // Include schema version for forward compatibility.
    parameters: z.record(z.any()).default({}),
    parameters_schema_version: z.string().optional(), // e.g., "v1", "v2" per action type

    // Structured target entity (replaces ambiguous string)
    target: TargetEntitySchema,

    // Optional: allow LLM to suggest rank ordering (UI may ignore; policy may re-rank)
    // Lower number = higher priority.
    // Keep optional to avoid reliance.
    proposed_rank: z.number().int().min(1).max(50).optional(),
  })
  .strict();

export type ActionProposalV1 = z.infer<typeof ActionProposalV1Schema>;

// Legacy alias for backward compatibility during migration
export const DecisionActionProposalV1Schema = ActionProposalV1Schema;
export type DecisionActionProposalV1 = ActionProposalV1;

/**
 * DecisionProposalBodyV1
 * LLM output schema (proposal body only, no IDs).
 * Server enriches with decision_id, account_id, tenant_id, trace_id post-parse.
 * 
 * Schema invariants (enforced via superRefine):
 * - If decision_type === NO_ACTION_RECOMMENDED, then actions must be empty
 * - If decision_type === BLOCKED_BY_UNKNOWNS, then blocking_unknowns must be non-empty and actions must be empty
 * - If decision_type === PROPOSE_ACTIONS, then actions.length >= 1
 */
/**
 * DecisionProposalBodyV1BaseSchema
 * Base schema for decision proposal body (before invariants).
 * This is the base object schema that can be extended.
 */
const DecisionProposalBodyV1BaseSchema = z
  .object({
    decision_type: DecisionTypeEnum,

    // Normalized reason codes at decision level (for analytics)
    // Examples: ["RENEWAL_WINDOW_ENTERED", "USAGE_TREND_DOWN", "SUPPORT_RISK_EMERGING"]
    decision_reason_codes: z.array(ReasonCodeSchema).max(50).default([]),

    // Versioning: keep as literal "v1" to fail closed on incompatible changes.
    // decision_version: semantic behavior version (what the decision means)
    // schema_version: wire format version (how it's serialized)
    // In v1, both are "v1" and move together. Future versions may diverge.
    decision_version: z.literal("v1"),
    schema_version: z.literal("v1"), // Wire format version (for schema evolution tracking)

    // Summary is human-readable and should be short.
    summary: z.string().min(1).max(280),

    // Actions array (bounded, with invariants enforced below)
    actions: z.array(ActionProposalV1Schema).min(0).max(25),

    // Optional overall decision confidence (if LLM provides it)
    confidence: z.number().min(0).max(1).optional(),

    // Optional blocking unknowns at decision level (if BLOCKED_BY_UNKNOWNS)
    blocking_unknowns: z.array(UnknownItemSchema).max(20).optional(),
  })
  .strict();

/**
 * Invariant validation function (shared between body and enriched schemas)
 * Enforces decision_type constraints:
 * - NO_ACTION_RECOMMENDED → actions must be empty
 * - BLOCKED_BY_UNKNOWNS → blocking_unknowns non-empty, actions empty
 * - PROPOSE_ACTIONS → actions.length >= 1
 */
const validateDecisionInvariants = (data: any, ctx: z.RefinementCtx) => {
  // Invariant 1: NO_ACTION_RECOMMENDED must have empty actions
  if (data.decision_type === 'NO_ACTION_RECOMMENDED' && data.actions.length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'NO_ACTION_RECOMMENDED must have empty actions array',
      path: ['actions'],
    });
  }

  // Invariant 2: BLOCKED_BY_UNKNOWNS must have non-empty blocking_unknowns and empty actions
  if (data.decision_type === 'BLOCKED_BY_UNKNOWNS') {
    if (!data.blocking_unknowns || data.blocking_unknowns.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'BLOCKED_BY_UNKNOWNS must have non-empty blocking_unknowns',
        path: ['blocking_unknowns'],
      });
    }
    if (data.actions.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'BLOCKED_BY_UNKNOWNS must have empty actions array',
        path: ['actions'],
      });
    }
  }

  // Invariant 3: PROPOSE_ACTIONS must have at least one action
  if (data.decision_type === 'PROPOSE_ACTIONS' && data.actions.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'PROPOSE_ACTIONS must have at least one action',
      path: ['actions'],
    });
  }
};

/**
 * DecisionProposalBodyV1
 * LLM output schema (proposal body only, no IDs).
 * Server enriches with decision_id, account_id, tenant_id, trace_id post-parse.
 * 
 * Schema invariants (enforced via superRefine):
 * - If decision_type === NO_ACTION_RECOMMENDED, then actions must be empty
 * - If decision_type === BLOCKED_BY_UNKNOWNS, then blocking_unknowns must be non-empty and actions must be empty
 * - If decision_type === PROPOSE_ACTIONS, then actions.length >= 1
 */
export const DecisionProposalBodyV1Schema = DecisionProposalBodyV1BaseSchema.superRefine(validateDecisionInvariants);

// Define type before using in superRefine (needed for type inference)
export type DecisionProposalBodyV1 = z.infer<typeof DecisionProposalBodyV1Schema>;

/**
 * DecisionProposalV1Schema (for validation of enriched proposals)
 * Used for runtime validation of complete proposals after server enrichment.
 * All fields are required (server always enriches with IDs, timestamps, fingerprint).
 * 
 * Note: We extend the base schema (before superRefine) to add server-enriched fields,
 * then apply the same invariants.
 * 
 * Field documentation:
 * - Server-enriched fields (always present after enrichment):
 *   - decision_id: Server-assigned (not from LLM)
 *   - account_id: Server-assigned (from context)
 *   - tenant_id: Server-assigned (from context)
 *   - trace_id: Server-assigned (from context)
 *   - created_at: Server-assigned timestamp (ISO 8601)
 *   - proposal_fingerprint: SHA256 hash of normalized proposal core (without IDs/timestamps)
 */
export const DecisionProposalV1Schema = DecisionProposalBodyV1BaseSchema.extend({
  decision_id: NonEmptyString,
  account_id: NonEmptyString,
  tenant_id: NonEmptyString,
  trace_id: NonEmptyString,
  created_at: z.string().datetime(),
  proposal_fingerprint: NonEmptyString, // SHA256 hash for determinism testing
}).superRefine(validateDecisionInvariants);

/**
 * DecisionProposalV1
 * Enriched proposal with server-assigned IDs and metadata.
 * This is the complete proposal after server enrichment.
 * 
 * Type is derived from Zod schema to prevent drift.
 * All fields are required (no optional server-enriched fields).
 */
export type DecisionProposalV1 = z.infer<typeof DecisionProposalV1Schema>;

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
 * Canonicalize an object by sorting object keys recursively.
 * Preserves array order (arrays are not sorted - order may matter).
 * Ensures stable JSON serialization for fingerprinting.
 * 
 * Rule: Sort object keys, never sort arrays (unless explicitly declared as unordered).
 */
function canonicalizeObject(obj: any): any {
  if (obj === null || obj === undefined) {
    return obj;
  }
  if (Array.isArray(obj)) {
    // Preserve array order - do not sort arrays in parameters
    // Arrays may contain ordered data (agenda items, step sequences, etc.)
    return obj.map(canonicalizeObject);
  }
  if (typeof obj === 'object') {
    const sorted: Record<string, any> = {};
    const keys = Object.keys(obj).sort();
    for (const key of keys) {
      sorted[key] = canonicalizeObject(obj[key]);
    }
    return sorted;
  }
  return obj;
}

/**
 * Generate proposal fingerprint for determinism testing and duplicate detection.
 * Hash excludes IDs, timestamps, and other non-deterministic fields.
 * 
 * Normalization ensures:
 * - Actions are sorted by stable key (action_type + target)
 * - Parameters are canonicalized (object keys sorted, array order preserved)
 * - Set-like arrays are sorted (why, blocking_unknowns, decision_reason_codes)
 * - Same logical proposal → same fingerprint
 * 
 * @param proposalBody - The LLM output (DecisionProposalBodyV1) before enrichment
 * @returns SHA256 hash of normalized proposal core (hex string)
 */
export function generateProposalFingerprint(proposalBody: DecisionProposalBodyV1): string {
  // Normalize actions: sort by stable key (action_type + target.entity_type + target.entity_id)
  const normalizedActions = proposalBody.actions
    .map((action: ActionProposalV1) => ({
      action_type: action.action_type,
      why: [...action.why].sort(),
      confidence: action.confidence,
      risk_level: action.risk_level,
      llm_suggests_human_review: action.llm_suggests_human_review,
      blocking_unknowns: [...action.blocking_unknowns].sort(),
      // Canonicalize parameters (deep-sort keys for stable ordering)
      parameters: canonicalizeObject(action.parameters),
      parameters_schema_version: action.parameters_schema_version,
      target: action.target, // Already structured, no normalization needed
      // Exclude: action_intent_id, proposed_rank (non-deterministic)
    }))
    .sort((a, b) => {
      // Stable sort key: action_type + target.entity_type + target.entity_id
      const aKey = `${a.action_type}:${a.target.entity_type}:${a.target.entity_id}`;
      const bKey = `${b.action_type}:${b.target.entity_type}:${b.target.entity_id}`;
      return aKey < bKey ? -1 : aKey > bKey ? 1 : 0;
    });

  // Normalize proposal body
  const normalized = {
    decision_type: proposalBody.decision_type,
    decision_reason_codes: [...proposalBody.decision_reason_codes].sort(),
    decision_version: proposalBody.decision_version,
    schema_version: proposalBody.schema_version,
    summary: proposalBody.summary,
    actions: normalizedActions,
    confidence: proposalBody.confidence,
    blocking_unknowns: proposalBody.blocking_unknowns ? [...proposalBody.blocking_unknowns].sort() : undefined,
  };
  
  // Generate SHA-256 hash of canonical JSON
  const jsonString = JSON.stringify(normalized);
  const hash = createHash('sha256').update(jsonString, 'utf8').digest('hex');
  return hash;
}

/**
 * Example: minimal valid payload (for tests)
 */
export const ExampleDecisionProposalV1: DecisionProposalV1 = {
  decision_id: "dec_123",
  account_id: "acct_acme",
  tenant_id: "tenant_123",
  trace_id: "trace_123",
  decision_type: "PROPOSE_ACTIONS",
  decision_version: "v1",
  schema_version: "v1",
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
      risk_level: "HIGH", // Outreach actions are HIGH risk per ACTION_TYPE_RISK_TIERS
      llm_suggests_human_review: true,
      blocking_unknowns: [],
      parameters: {
        meeting_type: "renewal_review",
        suggested_date_range: "next_30_days"
      },
      parameters_schema_version: "v1",
      target: {
        entity_type: "ACCOUNT",
        entity_id: "acct_acme"
      },
    },
  ],
  created_at: new Date().toISOString(),
  proposal_fingerprint: "sha256_hash_of_normalized_proposal_core",
};

// ============================================================================
// Internal Types (TypeScript interfaces, not Zod schemas)
// These are used internally and don't require runtime validation.
// ============================================================================

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
  target: TargetEntity; // Structured target (replaces target_entity string)
  parameters: Record<string, any>;
  parameters_schema_version?: string; // Preserved from proposal
  approved_by: string; // User ID
  approval_timestamp: string; // ISO timestamp
  execution_policy: ExecutionPolicy;
  expires_at: string; // ISO timestamp
  original_decision_id: string; // Links to DecisionProposalV1.decision_id (the decision that created this proposal)
  original_proposal_id: string; // Same as original_decision_id (INVARIANT: proposal_id == decision_id in v1)
  // INVARIANT: original_proposal_id MUST equal original_decision_id in v1
  // The decision_id is the identifier for the proposal artifact.
  // Use validateProvenanceInvariant() to enforce this at runtime.
  supersedes_action_intent_id?: string; // If this intent was created by editing another, link to parent intent
  edited_fields: string[]; // Field names that were edited (if any)
  edited_by?: string; // User ID who edited (if edited)
  edited_at?: string; // Timestamp of edit (if edited)
  tenant_id: string;
  account_id: string;
  trace_id: string;
}

/**
 * Validate provenance invariant: original_proposal_id == original_decision_id in v1
 * Throws if invariant is violated (prevents data corruption).
 * 
 * @param intent - ActionIntentV1 to validate
 * @throws Error if invariant is violated
 */
export function validateProvenanceInvariant(intent: ActionIntentV1): void {
  if (intent.original_proposal_id !== intent.original_decision_id) {
    throw new Error(
      `Provenance invariant violated: original_proposal_id (${intent.original_proposal_id}) ` +
      `must equal original_decision_id (${intent.original_decision_id}) in v1`
    );
  }
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
 * Captures both LLM estimates and authoritative policy decisions for debugging.
 */
export interface PolicyEvaluationResult {
  action_intent_id: string;
  evaluation: 'ALLOWED' | 'BLOCKED' | 'APPROVAL_REQUIRED';
  reason_codes: string[];
  confidence_threshold_met: boolean;
  policy_risk_tier: 'HIGH' | 'MEDIUM' | 'LOW' | 'MINIMAL'; // Authoritative policy risk tier
  approval_required: boolean; // True if human approval is required (authoritative, from policy)
  needs_human_input: boolean; // True if blocking unknowns require human question/input
  blocked_reason?: string; // If BLOCKED, the reason (e.g., "CONFIDENCE_BELOW_THRESHOLD", "BLOCKING_UNKNOWNS_PRESENT")
  llm_suggests_human_review?: boolean; // LLM's advisory field (for reference, not authoritative)
  llm_risk_level?: RiskLevel; // LLM's risk estimate (for reference, not authoritative)
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
