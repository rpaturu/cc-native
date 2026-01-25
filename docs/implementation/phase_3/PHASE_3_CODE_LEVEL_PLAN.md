# Phase 3: Code-Level Implementation Plan

## Autonomous Decision + Action Proposal (Human-in-the-Loop)

**Goal:** Build a Decision Layer that consumes truth (posture, signals, graph, evidence), synthesizes what should happen next via LLM, produces explicit auditable action proposals, routes human involvement only when required, and executes nothing silently.

**Duration:** 4-5 weeks  
**Status:** 📋 **PLANNING** (Not Started)  
**Dependencies:** Phase 0 ✅ Complete | Phase 1 ✅ Complete | Phase 2 ✅ Complete

**Last Updated:** 2026-01-25

**Prerequisites:**
- Phase 2 synthesis engine producing `AccountPostureState`
- Phase 2 graph materializer creating situation graph
- EventBridge routing `GRAPH_MATERIALIZED` events
- Active signals stored in DynamoDB
- Evidence snapshots stored in S3

---

## Implementation Status Summary

| Component | Status | Completion |
|-----------|--------|------------|
| 1. Decision Types & Interfaces | 📋 Planned | 0% |
| 2. Decision Context Assembler | 📋 Planned | 0% |
| 3. Decision Synthesis Service | 📋 Planned | 0% |
| 4. Policy Gate Engine | 📋 Planned | 0% |
| 5. Action Intent Service | 📋 Planned | 0% |
| 6. Decision Trigger Service | 📋 Planned | 0% |
| 7. Human Approval API | 📋 Planned | 0% |
| 8. Decision Ledger Events | 📋 Planned | 0% |
| 9. Cost Budgeting Service | 📋 Planned | 0% |
| 10. Event Handlers | 📋 Planned | 0% |
| 11. Infrastructure (CDK) | 📋 Planned | 0% |
| 12. Unit Tests & Contract Tests | 📋 Planned | 0% |

**Overall Phase 3 Progress: 0% 📋**

**Target Implementation Date:** TBD  
**Estimated Files:** ~20-25 TypeScript files (decision layer)

---

## Implementation Order

1. **Decision Types & Interfaces** (Day 1-2)
2. **Decision Trigger Service** (Day 2-3)
3. **Decision Context Assembler** (Day 3-5)
4. **Cost Budgeting Service** (Day 4-5) ⚠️ **Do this early**
5. **Decision Synthesis Service** (Day 6-9)
6. **Policy Gate Engine** (Day 7-10)
7. **Action Intent Service** (Day 10-12)
8. **Decision Ledger Events** (Day 11-12)
9. **Human Approval API** (Day 13-15)
10. **Event Handlers** (Day 14-16)
11. **Infrastructure (CDK)** (Day 15-17)
12. **Unit Tests & Contract Tests** (Day 18-20)

---

## 1. Decision Types & Interfaces

### 1.1 Decision Types

**File:** `src/types/DecisionTypes.ts`

**Purpose:** Define canonical decision types, action types, and decision contracts

**Validation Approach:**
* **Zod schemas are the source of truth** for `DecisionProposalBodyV1` (LLM output) and `ActionProposalV1`
* **TypeScript types derive from Zod**: `export type ActionProposalV1 = z.infer<typeof ActionProposalV1Schema>`
* **Clear split**: `DecisionProposalBodyV1` (LLM output, no IDs) vs `DecisionProposalV1` (enriched with server-assigned IDs)
* This prevents schema/type drift and ensures validated objects are usable
* TypeScript interfaces for internal types (`DecisionContextV1`, `ActionIntentV1`, etc.) - no runtime validation needed

**Key Types:**

```typescript
// Zod Schemas (for LLM output validation)
export const DecisionProposalBodyV1Schema = z.object({...}); // LLM output (no IDs)
export const ActionProposalV1Schema = z.object({...}); // Action proposal (consolidated naming)
export const DecisionProposalV1Schema = DecisionProposalBodyV1Schema.extend({...}); // Enriched (with IDs)
export const ActionTypeV1Enum = z.enum([...]);
export const DecisionTypeEnum = z.enum([
  "PROPOSE_ACTIONS",
  "NO_ACTION_RECOMMENDED", 
  "BLOCKED_BY_UNKNOWNS"
]);

// TypeScript Interfaces (for internal use)
// Decision Context (Input)
export interface DecisionContextV1 {
  tenant_id: string;
  account_id: string;
  lifecycle_state: LifecycleState;
  posture_state: AccountPostureStateV1;
  active_signals: Signal[];
  risk_factors: RiskFactor[];
  opportunities: Opportunity[];
  unknowns: Unknown[];
  graph_context_refs: GraphContextRef[]; // Bounded (max 10)
  policy_context: PolicyContext;
  trace_id: string;
}

export interface GraphContextRef {
  vertex_id: string;
  vertex_type: string;
  depth: number; // Max depth: 2
}

export interface PolicyContext {
  tenant_id: string;
  min_confidence_threshold: number;
  action_type_permissions: Record<ActionTypeV1, ActionPermission>;
  cost_budget_remaining: number;
}

export interface ActionPermission {
  default_approval_required: boolean;
  min_confidence: number;
  risk_tier: 'HIGH' | 'MEDIUM' | 'LOW' | 'MINIMAL';
}

// Decision Proposal (LLM Output)
export interface DecisionProposalV1 {
  decision_id: string;
  account_id: string;
  decision_type: DecisionType;
  decision_reason_codes: string[]; // Normalized codes for analytics
  actions: ActionProposal[];
  summary: string;
  decision_version: 'v1';
  confidence?: number; // Overall decision confidence (optional)
  blocking_unknowns?: string[]; // Unknown IDs that block decision
}

export enum DecisionType {
  PROPOSE_ACTIONS = 'PROPOSE_ACTIONS',
  NO_ACTION_RECOMMENDED = 'NO_ACTION_RECOMMENDED',
  BLOCKED_BY_UNKNOWNS = 'BLOCKED_BY_UNKNOWNS'
}

export interface ActionProposalV1 {
  action_intent_id: string;
  action_type: ActionTypeV1;
  why: string[]; // Human-readable reasons
  confidence: number; // [0.0, 1.0]
  risk_level: 'MINIMAL' | 'LOW' | 'MEDIUM' | 'HIGH';
  llm_suggests_human_review: boolean; // Advisory (policy gate is authoritative)
  blocking_unknowns: string[];
  parameters: Record<string, any>; // Action-specific parameters
  parameters_schema_version?: string; // For forward compatibility
  target: { entity_type: 'ACCOUNT' | 'CONTACT' | 'OPPORTUNITY' | 'DEAL' | 'ENGAGEMENT', entity_id: string }; // Structured target
  proposed_rank?: number; // Optional LLM-suggested ranking
}

// Action Type Registry
export enum ActionTypeV1 {
  // Outreach Actions (HIGH risk, always require approval)
  REQUEST_RENEWAL_MEETING = 'REQUEST_RENEWAL_MEETING',
  REQUEST_DISCOVERY_CALL = 'REQUEST_DISCOVERY_CALL',
  REQUEST_STAKEHOLDER_INTRO = 'REQUEST_STAKEHOLDER_INTRO',
  
  // CRM Write Actions (MEDIUM risk, approval unless low risk)
  UPDATE_OPPORTUNITY_STAGE = 'UPDATE_OPPORTUNITY_STAGE',
  CREATE_OPPORTUNITY = 'CREATE_OPPORTUNITY',
  UPDATE_ACCOUNT_FIELDS = 'UPDATE_ACCOUNT_FIELDS',
  
  // Internal Actions (LOW risk, auto-allowed if confidence threshold met)
  CREATE_INTERNAL_NOTE = 'CREATE_INTERNAL_NOTE',
  CREATE_INTERNAL_TASK = 'CREATE_INTERNAL_TASK',
  FLAG_FOR_REVIEW = 'FLAG_FOR_REVIEW',
  
  // Research Actions (MINIMAL risk, auto-allowed)
  FETCH_ACCOUNT_NEWS = 'FETCH_ACCOUNT_NEWS',
  ANALYZE_USAGE_PATTERNS = 'ANALYZE_USAGE_PATTERNS',
}

// Action Intent (Post-Approval)
export interface ActionIntentV1 {
  action_intent_id: string;
  action_type: ActionTypeV1;
  target: { entity_type: 'ACCOUNT' | 'CONTACT' | 'OPPORTUNITY' | 'DEAL' | 'ENGAGEMENT', entity_id: string };
  parameters: Record<string, any>;
  parameters_schema_version?: string;
  approved_by: string; // User ID
  approval_timestamp: string; // ISO timestamp
  execution_policy: ExecutionPolicy;
  expires_at: string; // ISO timestamp
  original_proposal_id: string; // Links to DecisionProposalV1
  original_decision_id: string; // Links to DecisionContextV1
  edited_fields: string[]; // Field names that were edited (if any)
  edited_by?: string; // User ID who edited (if edited)
  edited_at?: string; // Timestamp of edit (if edited)
  tenant_id: string;
  account_id: string;
  trace_id: string;
}

export interface ExecutionPolicy {
  retry_count: number;
  timeout_seconds: number;
  max_attempts: number;
}

// Policy Evaluation Result
export interface PolicyEvaluationResult {
  action_intent_id: string;
  evaluation: 'ALLOWED' | 'BLOCKED' | 'APPROVAL_REQUIRED';
  reason_codes: string[];
  confidence_threshold_met: boolean;
  risk_tier: 'HIGH' | 'MEDIUM' | 'LOW' | 'MINIMAL';
  requires_human: boolean;
}
```

**ActionType Risk Classification:**

```typescript
export const ACTION_TYPE_RISK_TIERS: Record<ActionTypeV1, {
  risk_tier: 'HIGH' | 'MEDIUM' | 'LOW' | 'MINIMAL';
  default_approval_required: boolean;
  min_confidence: number;
}> = {
  [ActionTypeV1.REQUEST_RENEWAL_MEETING]: {
    risk_tier: 'HIGH',
    default_approval_required: true,
    min_confidence: 0.75
  },
  [ActionTypeV1.REQUEST_DISCOVERY_CALL]: {
    risk_tier: 'HIGH',
    default_approval_required: true,
    min_confidence: 0.75
  },
  [ActionTypeV1.REQUEST_STAKEHOLDER_INTRO]: {
    risk_tier: 'HIGH',
    default_approval_required: true,
    min_confidence: 0.75
  },
  [ActionTypeV1.UPDATE_OPPORTUNITY_STAGE]: {
    risk_tier: 'MEDIUM',
    default_approval_required: true,
    min_confidence: 0.70
  },
  [ActionTypeV1.CREATE_OPPORTUNITY]: {
    risk_tier: 'MEDIUM',
    default_approval_required: true,
    min_confidence: 0.70
  },
  [ActionTypeV1.UPDATE_ACCOUNT_FIELDS]: {
    risk_tier: 'MEDIUM',
    default_approval_required: true,
    min_confidence: 0.70
  },
  [ActionTypeV1.CREATE_INTERNAL_NOTE]: {
    risk_tier: 'LOW',
    default_approval_required: false,
    min_confidence: 0.65
  },
  [ActionTypeV1.CREATE_INTERNAL_TASK]: {
    risk_tier: 'LOW',
    default_approval_required: false,
    min_confidence: 0.65
  },
  [ActionTypeV1.FLAG_FOR_REVIEW]: {
    risk_tier: 'LOW',
    default_approval_required: false,
    min_confidence: 0.65
  },
  [ActionTypeV1.FETCH_ACCOUNT_NEWS]: {
    risk_tier: 'MINIMAL',
    default_approval_required: false,
    min_confidence: 0.60
  },
  [ActionTypeV1.ANALYZE_USAGE_PATTERNS]: {
    risk_tier: 'MINIMAL',
    default_approval_required: false,
    min_confidence: 0.60
  },
};
```

**Acceptance Criteria:**
* Zod schemas are defined for `DecisionProposalBodyV1` (LLM output) and `ActionProposalV1`
* `DecisionProposalV1` is the enriched type (extends body + server-assigned IDs)
* TypeScript interfaces are defined for internal types (`DecisionContextV1`, `ActionIntentV1`, etc.)
* ActionTypeV1 enum is complete and locked
* Risk tiers are assigned per action type
* `DecisionTypeEnum` includes all three types: `PROPOSE_ACTIONS`, `NO_ACTION_RECOMMENDED`, `BLOCKED_BY_UNKNOWNS`
* Zod `.superRefine()` enforces invariants:
  * NO_ACTION_RECOMMENDED → actions empty
  * BLOCKED_BY_UNKNOWNS → blocking_unknowns non-empty, actions empty
  * PROPOSE_ACTIONS → actions.length >= 1
* `decision_reason_codes` is included at decision level (max 50)
* `target` is structured (`{entity_type, entity_id}`) not ambiguous string
* `parameters_schema_version` included for forward compatibility
* `llm_suggests_human_review` is advisory (policy gate is authoritative)
* `proposed_rank` is optional (for UI/policy re-ranking)
* Schema versioning (`decision_version: 'v1'`, `schema_version: 'v1'`) included
* `proposal_fingerprint` included for determinism testing and duplicate detection
* Zod dependency added to `package.json`

---

## 2. Decision Trigger Service

### 2.1 Decision Trigger Types

**File:** `src/types/DecisionTriggerTypes.ts`

**Purpose:** Define decision trigger types and trigger evaluation logic

**Key Types:**

```typescript
export enum DecisionTriggerType {
  LIFECYCLE_TRANSITION = 'LIFECYCLE_TRANSITION',
  HIGH_SIGNAL_ARRIVAL = 'HIGH_SIGNAL_ARRIVAL',
  EXPLICIT_USER_REQUEST = 'EXPLICIT_USER_REQUEST',
  COOLDOWN_GATED_PERIODIC = 'COOLDOWN_GATED_PERIODIC'
}

export interface DecisionTrigger {
  trigger_type: DecisionTriggerType;
  account_id: string;
  tenant_id: string;
  trigger_event_id?: string; // EventBridge event ID (if event-driven)
  trigger_timestamp: string;
  cooldown_until?: string; // ISO timestamp (if cooldown applies)
}

export interface TriggerEvaluationResult {
  should_evaluate: boolean;
  reason: string;
  cooldown_until?: string;
}
```

**Acceptance Criteria:**
* Trigger types are enumerated
* Cooldown logic is explicit
* Trigger evaluation is deterministic

---

### 2.2 Decision Trigger Service

**File:** `src/services/decision/DecisionTriggerService.ts`

**Purpose:** Evaluate whether a decision should be triggered for an account

**Key Methods:**

```typescript
export class DecisionTriggerService {
  constructor(
    private accountPostureStateService: AccountPostureStateService,
    private signalService: SignalService,
    private logger: Logger
  ) {}

  /**
   * Evaluate if decision should be triggered
   * Returns should_evaluate=true only if:
   * - Explicit trigger event (lifecycle transition, high-signal)
   * - User-initiated request
   * - Cooldown period has passed (24 hours)
   */
  async shouldTriggerDecision(
    accountId: string,
    tenantId: string,
    triggerType: DecisionTriggerType,
    triggerEventId?: string
  ): Promise<TriggerEvaluationResult> {
    // Check cooldown (24-hour window)
    const postureState = await this.accountPostureStateService.getPostureState(
      accountId,
      tenantId
    );
    
    if (postureState?.last_decision_evaluated_at) {
      const lastEvaluation = new Date(postureState.last_decision_evaluated_at);
      const cooldownUntil = new Date(lastEvaluation.getTime() + 24 * 60 * 60 * 1000);
      
      if (new Date() < cooldownUntil && triggerType !== DecisionTriggerType.EXPLICIT_USER_REQUEST) {
        return {
          should_evaluate: false,
          reason: 'COOLDOWN_ACTIVE',
          cooldown_until: cooldownUntil.toISOString()
        };
      }
    }
    
    // Event-driven triggers (lifecycle transition, high-signal)
    if (triggerType === DecisionTriggerType.LIFECYCLE_TRANSITION ||
        triggerType === DecisionTriggerType.HIGH_SIGNAL_ARRIVAL) {
      return {
        should_evaluate: true,
        reason: `TRIGGERED_BY_${triggerType}`
      };
    }
    
    // User-initiated (always allowed, bypasses cooldown)
    if (triggerType === DecisionTriggerType.EXPLICIT_USER_REQUEST) {
      return {
        should_evaluate: true,
        reason: 'USER_REQUESTED'
      };
    }
    
    // Cooldown-gated periodic (only if cooldown passed)
    if (triggerType === DecisionTriggerType.COOLDOWN_GATED_PERIODIC) {
      return {
        should_evaluate: true,
        reason: 'COOLDOWN_EXPIRED'
      };
    }
    
    return {
      should_evaluate: false,
      reason: 'NO_TRIGGER_CONDITION_MET'
    };
  }
}
```

**Acceptance Criteria:**
* Cooldown is enforced (24-hour window)
* Event-driven triggers bypass cooldown
* User requests bypass cooldown
* Periodic evaluation respects cooldown
* Evaluation is deterministic

---

## 3. Decision Context Assembler

### 3.1 Decision Context Assembler Service

**File:** `src/services/decision/DecisionContextAssembler.ts`

**Purpose:** Assemble bounded, deterministic input for LLM decision synthesis

**Key Methods:**

```typescript
export class DecisionContextAssembler {
  constructor(
    private accountPostureStateService: AccountPostureStateService,
    private signalService: SignalService,
    private graphService: IGraphService,
    private tenantService: TenantService,
    private logger: Logger
  ) {}

  /**
   * Assemble DecisionContextV1 from account state
   * Bounded: Max 10 graph refs, max 50 active signals, max depth 2
   */
  async assembleContext(
    accountId: string,
    tenantId: string,
    traceId: string
  ): Promise<DecisionContextV1> {
    // 1. Fetch AccountPostureState (DDB)
    const postureState = await this.accountPostureStateService.getPostureState(
      accountId,
      tenantId
    );
    
    if (!postureState) {
      throw new Error(`AccountPostureState not found for account: ${accountId}`);
    }
    
    // 2. Fetch active signals (bounded: max 50)
    const activeSignals = await this.signalService.getActiveSignals(
      accountId,
      tenantId,
      { limit: 50 }
    );
    
    // 3. Extract risk factors, opportunities, unknowns from posture state
    const riskFactors = postureState.risk_factors || [];
    const opportunities = postureState.opportunities || [];
    const unknowns = postureState.unknowns || [];
    
    // 4. Fetch limited graph neighborhood (Neptune, depth <= 2, max 10 refs)
    const graphContextRefs = await this.fetchBoundedGraphContext(
      accountId,
      tenantId,
      maxDepth: 2,
      maxRefs: 10
    );
    
    // 5. Fetch tenant policy config
    const tenant = await this.tenantService.getTenant(tenantId);
    const policyContext = this.buildPolicyContext(tenant);
    
    // 6. Determine lifecycle state
    const lifecycleState = this.inferLifecycleState(postureState, activeSignals);
    
    return {
      tenant_id: tenantId,
      account_id: accountId,
      lifecycle_state: lifecycleState,
      posture_state: postureState,
      active_signals: activeSignals,
      risk_factors: riskFactors,
      opportunities: opportunities,
      unknowns: unknowns,
      graph_context_refs: graphContextRefs,
      policy_context: policyContext,
      trace_id: traceId
    };
  }
  
  /**
   * Fetch bounded graph context (max depth 2, max 10 refs)
   */
  private async fetchBoundedGraphContext(
    accountId: string,
    tenantId: string,
    maxDepth: number,
    maxRefs: number
  ): Promise<GraphContextRef[]> {
    const accountVertexId = VertexIdGenerator.account(tenantId, accountId);
    const refs: GraphContextRef[] = [];
    
    // Fetch immediate neighbors (depth 1)
    const depth1Vertices = await this.graphService.getNeighbors(
      accountVertexId,
      { maxDepth: 1, limit: maxRefs }
    );
    
    for (const vertex of depth1Vertices.slice(0, maxRefs)) {
      refs.push({
        vertex_id: vertex.id,
        vertex_type: vertex.label,
        depth: 1
      });
    }
    
    // If we have room, fetch depth 2 (but respect maxRefs total)
    if (refs.length < maxRefs && maxDepth >= 2) {
      const remaining = maxRefs - refs.length;
      const depth2Vertices = await this.graphService.getNeighbors(
        accountVertexId,
        { maxDepth: 2, limit: remaining }
      );
      
      for (const vertex of depth2Vertices) {
        if (refs.length >= maxRefs) break;
        refs.push({
          vertex_id: vertex.id,
          vertex_type: vertex.label,
          depth: 2
        });
      }
    }
    
    return refs;
  }
  
  /**
   * Build policy context from tenant config
   */
  private buildPolicyContext(tenant: Tenant): PolicyContext {
    return {
      tenant_id: tenant.tenant_id,
      min_confidence_threshold: tenant.min_confidence_threshold || 0.70,
      action_type_permissions: this.getActionTypePermissions(tenant),
      cost_budget_remaining: tenant.decision_cost_budget_remaining || 100
    };
  }
  
  /**
   * Get action type permissions (from tenant config or defaults)
   */
  private getActionTypePermissions(tenant: Tenant): Record<ActionTypeV1, ActionPermission> {
    const permissions: Record<ActionTypeV1, ActionPermission> = {} as any;
    
    for (const actionType of Object.values(ActionTypeV1)) {
      const defaultConfig = ACTION_TYPE_RISK_TIERS[actionType];
      const tenantOverride = tenant.action_type_permissions?.[actionType];
      
      permissions[actionType] = tenantOverride || {
        default_approval_required: defaultConfig.default_approval_required,
        min_confidence: defaultConfig.min_confidence,
        risk_tier: defaultConfig.risk_tier
      };
    }
    
    return permissions;
  }
  
  /**
   * Infer lifecycle state from posture and signals
   */
  private inferLifecycleState(
    posture: AccountPostureStateV1,
    signals: Signal[]
  ): LifecycleState {
    // Use Phase 1 lifecycle inference logic
    // CUSTOMER if active contract, SUSPECT if engagement, PROSPECT otherwise
    if (posture.posture === 'CUSTOMER' || signals.some(s => s.signalType === SignalType.RENEWAL_WINDOW_ENTERED)) {
      return LifecycleState.CUSTOMER;
    }
    if (signals.some(s => s.signalType === SignalType.FIRST_ENGAGEMENT_OCCURRED)) {
      return LifecycleState.SUSPECT;
    }
    return LifecycleState.PROSPECT;
  }
}
```

**Acceptance Criteria:**
* Context assembly is deterministic
* Graph context is bounded (max depth 2, max 10 refs)
* Active signals are bounded (max 50)
* Input size is capped and logged
* Policy context is correctly assembled from tenant config

---

## 4. Cost Budgeting Service

### 4.1 Cost Budget Service

**File:** `src/services/decision/CostBudgetService.ts`

**Purpose:** Enforce cost budgets for decision evaluation to prevent unbounded LLM usage

**Key Methods:**

```typescript
export class CostBudgetService {
  constructor(
    private dynamoClient: DynamoDBDocumentClient,
    private budgetTableName: string,
    private logger: Logger
  ) {}

  /**
   * Check if decision evaluation is allowed (budget check)
   */
  async canEvaluateDecision(
    accountId: string,
    tenantId: string
  ): Promise<{ allowed: boolean; reason: string; budget_remaining: number }> {
    const budget = await this.getBudget(accountId, tenantId);
    
    if (budget.daily_decisions_remaining <= 0) {
      return {
        allowed: false,
        reason: 'DAILY_BUDGET_EXCEEDED',
        budget_remaining: 0
      };
    }
    
    if (budget.monthly_cost_remaining <= 0) {
      return {
        allowed: false,
        reason: 'MONTHLY_BUDGET_EXCEEDED',
        budget_remaining: 0
      };
    }
    
    return {
      allowed: true,
      reason: 'BUDGET_AVAILABLE',
      budget_remaining: budget.daily_decisions_remaining
    };
  }
  
  /**
   * Consume budget for decision evaluation
   */
  async consumeBudget(
    accountId: string,
    tenantId: string,
    cost: number // Cost in "decision units" (1 = standard decision, 2 = deep context)
  ): Promise<void> {
    const budget = await this.getBudget(accountId, tenantId);
    
    await this.dynamoClient.send(new UpdateCommand({
      TableName: this.budgetTableName,
      Key: {
        pk: `ACCOUNT#${tenantId}#${accountId}`,
        sk: 'BUDGET'
      },
      UpdateExpression: 'SET daily_decisions_remaining = daily_decisions_remaining - :cost, monthly_cost_remaining = monthly_cost_remaining - :cost, updated_at = :now',
      ConditionExpression: 'daily_decisions_remaining >= :cost AND monthly_cost_remaining >= :cost',
      ExpressionAttributeValues: {
        ':cost': cost,
        ':now': new Date().toISOString()
      }
    }));
  }
  
  /**
   * Reset daily budget (called by scheduled job)
   */
  async resetDailyBudget(accountId: string, tenantId: string): Promise<void> {
    await this.dynamoClient.send(new UpdateCommand({
      TableName: this.budgetTableName,
      Key: {
        pk: `ACCOUNT#${tenantId}#${accountId}`,
        sk: 'BUDGET'
      },
      UpdateExpression: 'SET daily_decisions_remaining = :daily_limit, updated_at = :now',
      ExpressionAttributeValues: {
        ':daily_limit': 10, // Max 10 decisions per account per day
        ':now': new Date().toISOString()
      }
    }));
  }
  
  private async getBudget(accountId: string, tenantId: string): Promise<DecisionBudget> {
    const result = await this.dynamoClient.send(new GetCommand({
      TableName: this.budgetTableName,
      Key: {
        pk: `ACCOUNT#${tenantId}#${accountId}`,
        sk: 'BUDGET'
      }
    }));
    
    if (!result.Item) {
      // Initialize budget
      return {
        daily_decisions_remaining: 10,
        monthly_cost_remaining: 100,
        last_reset_date: new Date().toISOString().split('T')[0]
      };
    }
    
    return result.Item as DecisionBudget;
  }
}

interface DecisionBudget {
  pk: string;
  sk: string;
  daily_decisions_remaining: number;
  monthly_cost_remaining: number;
  last_reset_date: string;
  updated_at: string;
}
```

**Budget Rules:**
* Max 10 decisions per account per day
* Max 100 decision units per account per month
* Deep context fetches cost 2 units (standard decision = 1 unit)
* Budget resets daily at midnight UTC (documented in metrics/UI for clarity)

**Acceptance Criteria:**
* Budget checks are enforced before decision evaluation
* Budget consumption is atomic (DynamoDB conditional write)
* Budget resets are scheduled (EventBridge rule)
* Budget usage is logged and visible in metrics

---

## 5. Decision Synthesis Service

### 5.1 Decision Synthesis Service

**File:** `src/services/decision/DecisionSynthesisService.ts`

**Purpose:** Generate decision proposals using LLM (Bedrock), with strict schema enforcement

**Key Methods:**

```typescript
import { DecisionProposalBodyV1Schema, DecisionProposalV1, generateProposalFingerprint } from '../../types/DecisionTypes';

export class DecisionSynthesisService {
  constructor(
    private bedrockClient: BedrockRuntimeClient,
    private modelId: string, // e.g., 'anthropic.claude-3-5-sonnet-20241022-v2:0'
    private logger: Logger
  ) {}

  /**
   * Synthesize decision proposal from context
   * Calls Bedrock with strict schema output (JSON mode)
   */
  async synthesizeDecision(
    context: DecisionContextV1
  ): Promise<DecisionProposalV1> {
    // Build prompt with context
    const prompt = this.buildPrompt(context);
    
    // Call Bedrock with JSON mode (strict schema)
    const response = await this.bedrockClient.send(new InvokeModelCommand({
      modelId: this.modelId,
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 4096,
        system: this.getSystemPrompt(),
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'DecisionProposalV1',
            schema: this.getDecisionProposalSchema(),
            strict: true
          }
        }
      }),
      contentType: 'application/json',
      accept: 'application/json'
    }));
    
    // Parse Bedrock response (model-specific structure)
    // Note: Bedrock responses may wrap content; parse the correct field based on model
    // For Claude models: response.body is JSON with 'content' array
    const rawResponse = JSON.parse(new TextDecoder().decode(response.body));
    const responseBody = rawResponse.content?.[0]?.text 
      ? JSON.parse(rawResponse.content[0].text) 
      : rawResponse; // Fallback for direct JSON mode
    
    // Validate LLM output (proposal body only, no IDs)
    const proposalBody = DecisionProposalBodyV1Schema.parse(responseBody);
    
    // Generate proposal fingerprint for determinism testing and duplicate detection
    const fingerprint = generateProposalFingerprint(proposalBody);
    
    // Enrich with server-assigned IDs and metadata
    const proposal: DecisionProposalV1 = {
      ...proposalBody,
      decision_id: this.generateDecisionId(context), // Server-assigned (non-deterministic)
      account_id: context.account_id,
      tenant_id: context.tenant_id,
      trace_id: context.trace_id,
      created_at: new Date().toISOString(),
      proposal_fingerprint: fingerprint
    };
    
    return proposal;
  }
  
  /**
   * Build prompt from decision context
   */
  private buildPrompt(context: DecisionContextV1): string {
    return `You are a decision synthesis engine for a revenue intelligence system.

Account Context:
- Account ID: ${context.account_id}
- Lifecycle State: ${context.lifecycle_state}
- Posture: ${context.posture_state.posture}
- Risk Factors: ${context.risk_factors.length}
- Opportunities: ${context.opportunities.length}
- Unknowns: ${context.unknowns.length}

Active Signals (${context.active_signals.length}):
${context.active_signals.slice(0, 10).map(s => `- ${s.signalType}: ${s.summary}`).join('\n')}

Risk Factors:
${context.risk_factors.map(r => `- ${r.factor_type}: ${r.description}`).join('\n')}

Opportunities:
${context.opportunities.map(o => `- ${o.opportunity_type}: ${o.description}`).join('\n')}

Unknowns (blocking):
${context.unknowns.map(u => `- ${u.unknown_type}: ${u.description}`).join('\n')}

Policy Constraints:
- Min confidence threshold: ${context.policy_context.min_confidence_threshold}
- Available action types: ${Object.keys(context.policy_context.action_type_permissions).join(', ')}

Task:
Synthesize what actions should be taken next for this account. Consider:
1. Current posture and risk factors
2. Active signals and opportunities
3. Blocking unknowns (if any)
4. Policy constraints

Output a DecisionProposalV1 with:
- decision_type: PROPOSE_ACTIONS, NO_ACTION_RECOMMENDED, or BLOCKED_BY_UNKNOWNS
- decision_reason_codes: Normalized reason codes (e.g., RENEWAL_WINDOW_ENTERED, USAGE_TREND_DOWN)
- actions: Array of action proposals (if PROPOSE_ACTIONS)
- Each action must include: action_type, why[], confidence, risk_level, llm_suggests_human_review, parameters, target

If no action is appropriate, set decision_type to NO_ACTION_RECOMMENDED.
If blocking unknowns prevent decision, set decision_type to BLOCKED_BY_UNKNOWNS.`;
  }
  
  /**
   * Get system prompt (defines LLM role and constraints)
   */
  private getSystemPrompt(): string {
    return `You are a decision synthesis engine. Your role is to:
1. Analyze account context (posture, signals, risks, opportunities)
2. Propose specific, actionable next steps
3. Provide explicit confidence scores and rationale
4. Never execute actions or make autonomous decisions
5. Always respect policy constraints and human approval requirements

You must output valid DecisionProposalV1 JSON schema.`;
  }
  
  /**
   * Get JSON schema for DecisionProposalBodyV1 (for Bedrock JSON mode)
   * Note: LLM returns proposal body only (no IDs). Server enriches post-parse.
   */
  private getDecisionProposalSchema(): object {
    return {
      type: 'object',
      required: ['decision_type', 'decision_reason_codes', 'summary', 'decision_version'],
      properties: {
        decision_type: {
          type: 'string',
          enum: ['PROPOSE_ACTIONS', 'NO_ACTION_RECOMMENDED', 'BLOCKED_BY_UNKNOWNS']
        },
        decision_reason_codes: {
          type: 'array',
          items: { type: 'string' }
        },
        actions: {
          type: 'array',
          items: {
            type: 'object',
            required: ['action_intent_id', 'action_type', 'why', 'confidence', 'risk_level', 'llm_suggests_human_review', 'target'],
            properties: {
              action_intent_id: { type: 'string' },
              action_type: { type: 'string', enum: Object.values(ActionTypeV1) },
              why: { type: 'array', items: { type: 'string' } },
              confidence: { type: 'number', minimum: 0, maximum: 1 },
              risk_level: { type: 'string', enum: ['MINIMAL', 'LOW', 'MEDIUM', 'HIGH'] },
              llm_suggests_human_review: { type: 'boolean' },
              blocking_unknowns: { type: 'array', items: { type: 'string' } },
              parameters: { type: 'object' },
              parameters_schema_version: { type: 'string' },
              target: {
                type: 'object',
                required: ['entity_type', 'entity_id'],
                properties: {
                  entity_type: { type: 'string', enum: ['ACCOUNT', 'CONTACT', 'OPPORTUNITY', 'DEAL', 'ENGAGEMENT'] },
                  entity_id: { type: 'string' }
                }
              }
            }
          }
        },
        summary: { type: 'string' },
        decision_version: { type: 'string', const: 'v1' },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
        blocking_unknowns: { type: 'array', items: { type: 'string' } }
      }
      // Note: decision_id, account_id, tenant_id, trace_id are NOT in schema (server-enriched)
    };
  }
  
  /**
   * Generate decision ID (non-deterministic, server-assigned)
   * Note: Decision IDs are not deterministic; only context assembly and policy evaluation are deterministic.
   */
  private generateDecisionId(context: DecisionContextV1): string {
    return `decision-${context.account_id}-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  }
}
```

**Acceptance Criteria:**
* LLM output always conforms to DecisionProposalBodyV1 schema (proposal body only, no IDs)
* Server enriches proposal with decision_id, account_id, tenant_id, trace_id post-parse
* Zod schema validation is fail-closed (throws on invalid output)
* Bedrock JSON schema matches Zod schema (no ID fields in LLM output)
* Bedrock JSON mode enforces schema at LLM level
* Zod validation provides additional runtime safety
* No tool execution from LLM
* Confidence + rationale always present
* Decision types are valid (PROPOSE_ACTIONS, NO_ACTION_RECOMMENDED, BLOCKED_BY_UNKNOWNS)
* Action types are from ActionTypeV1 enum
* Decision IDs are non-deterministic (server-assigned); only context assembly and policy evaluation are deterministic

---

## 6. Policy Gate Engine

### 6.1 Policy Gate Service

**File:** `src/services/decision/PolicyGateService.ts`

**Purpose:** Deterministic policy evaluation of action proposals (code-only, no LLM)

**Key Methods:**

```typescript
export class PolicyGateService {
  constructor(
    private logger: Logger
  ) {}

  /**
   * Evaluate action proposal against policy
   * Deterministic: same proposal → same result
   * Evaluation order: 1) Unknown action type, 2) Blocking unknowns, 3) Tier rules
   */
  async evaluateAction(
    proposal: ActionProposalV1,
    policyContext: PolicyContext
  ): Promise<PolicyEvaluationResult> {
    // Step 1: Check for unknown action type (block immediately)
    const actionPermission = policyContext.action_type_permissions[proposal.action_type];
    if (!actionPermission) {
      return {
        action_intent_id: proposal.action_intent_id,
        evaluation: 'BLOCKED',
        reason_codes: ['UNKNOWN_ACTION_TYPE'],
        confidence_threshold_met: false,
        risk_tier: 'HIGH',
        approval_required: false,
        needs_human_input: false,
        blocked_reason: 'UNKNOWN_ACTION_TYPE',
        llm_requires_human: proposal.llm_suggests_human_review
      };
    }
    
    // Step 2: Check for blocking unknowns (block immediately, needs human input)
    const hasBlockingUnknowns = proposal.blocking_unknowns && proposal.blocking_unknowns.length > 0;
    if (hasBlockingUnknowns) {
      return {
        action_intent_id: proposal.action_intent_id,
        evaluation: 'BLOCKED',
        reason_codes: ['BLOCKING_UNKNOWNS_PRESENT'],
        confidence_threshold_met: false,
        risk_tier: actionPermission.risk_tier,
        approval_required: false,
        needs_human_input: true, // Blocking unknowns require human question/input
        blocked_reason: 'BLOCKING_UNKNOWNS_PRESENT',
        llm_requires_human: proposal.llm_suggests_human_review
      };
    }
    
    // Step 3: Evaluate by tier rules (deterministic)
    const confidenceThresholdMet = proposal.confidence >= actionPermission.min_confidence;
    const riskTier = actionPermission.risk_tier;
    
    let evaluation: 'ALLOWED' | 'BLOCKED' | 'APPROVAL_REQUIRED';
    let reasonCodes: string[] = [];
    
    // HIGH risk actions always require approval
    if (riskTier === 'HIGH') {
      evaluation = 'APPROVAL_REQUIRED';
      reasonCodes.push('HIGH_RISK_ACTION');
    }
    // MEDIUM risk: approval required unless low risk + high confidence
    else if (riskTier === 'MEDIUM') {
      if (proposal.risk_level === 'LOW' && proposal.confidence >= 0.85) {
        evaluation = 'ALLOWED';
        reasonCodes.push('LOW_RISK_HIGH_CONFIDENCE');
      } else {
        evaluation = 'APPROVAL_REQUIRED';
        reasonCodes.push('MEDIUM_RISK_ACTION');
      }
    }
    // LOW risk: auto-allowed if confidence threshold met
    else if (riskTier === 'LOW') {
      if (confidenceThresholdMet) {
        evaluation = 'ALLOWED';
        reasonCodes.push('LOW_RISK_CONFIDENCE_THRESHOLD_MET');
      } else {
        evaluation = 'BLOCKED';
        reasonCodes.push('CONFIDENCE_BELOW_THRESHOLD');
      }
    }
    // MINIMAL risk: auto-allowed if confidence >= 0.60
    else {
      if (proposal.confidence >= 0.60) {
        evaluation = 'ALLOWED';
        reasonCodes.push('MINIMAL_RISK_AUTO_ALLOWED');
      } else {
        evaluation = 'BLOCKED';
        reasonCodes.push('CONFIDENCE_BELOW_MINIMUM');
      }
    }
    
    // Determine approval and input requirements
    const approvalRequired = evaluation === 'APPROVAL_REQUIRED';
    
    return {
      action_intent_id: proposal.action_intent_id,
      evaluation,
      reason_codes: reasonCodes,
      confidence_threshold_met: confidenceThresholdMet,
      risk_tier: riskTier,
      approval_required: approvalRequired, // Authoritative: policy requires approval
      needs_human_input: false, // No blocking unknowns at this point
      blocked_reason: evaluation === 'BLOCKED' ? reasonCodes[0] : undefined,
      llm_requires_human: proposal.requires_human // LLM's advisory field (for reference)
    };
  }
  
  /**
   * Evaluate all actions in a decision proposal
   */
  async evaluateDecisionProposal(
    proposal: DecisionProposalV1,
    policyContext: PolicyContext
  ): Promise<PolicyEvaluationResult[]> {
    if (proposal.decision_type === 'NO_ACTION_RECOMMENDED' ||
        proposal.decision_type === 'BLOCKED_BY_UNKNOWNS') {
      return []; // No actions to evaluate
    }
    
    const results: PolicyEvaluationResult[] = [];
    
    for (const action of proposal.actions) {
      const result = await this.evaluateAction(action, policyContext);
      results.push(result);
    }
    
    return results;
  }
}
```

**Policy Rules (Deterministic, evaluated in order):**
1. Unknown action type → BLOCKED (immediate)
2. Blocking unknowns present → BLOCKED + needs_human_input=true (immediate)
3. HIGH risk actions → Always APPROVAL_REQUIRED
4. MEDIUM risk actions → APPROVAL_REQUIRED unless LOW risk + confidence >= 0.85
5. LOW risk actions → ALLOWED if confidence >= threshold, else BLOCKED
6. MINIMAL risk actions → ALLOWED if confidence >= 0.60, else BLOCKED

**Evaluation order ensures:**
* Blocking unknowns override tier rules (prevents confusing reason code ordering)
* Unknown action types are caught first
* Tier rules are only evaluated if no blocking conditions exist

**Acceptance Criteria:**
* Policy evaluation is deterministic (same input → same output)
* Rules are code + config (no prompts)
* Policy decision is logged + replayable
* Policy changes do not affect historical decisions

---

## 7. Action Intent Service

### 7.1 Action Intent Service

**File:** `src/services/decision/ActionIntentService.ts`

**Purpose:** Manage action intents (create, approve, reject, edit)

**Key Methods:**

```typescript
export class ActionIntentService {
  constructor(
    private dynamoClient: DynamoDBDocumentClient,
    private intentTableName: string,
    private logger: Logger
  ) {}

  /**
   * Create action intent from approved proposal
   */
  async createIntent(
    proposal: ActionProposalV1,
    decisionId: string, // This is proposal.decision_id
    approvedBy: string,
    tenantId: string,
    accountId: string,
    traceId: string,
    editedFields?: string[]
  ): Promise<ActionIntentV1> {
    const intent: ActionIntentV1 = {
      action_intent_id: proposal.action_intent_id,
      action_type: proposal.action_type,
      target: proposal.target,
      parameters: proposal.parameters,
      parameters_schema_version: proposal.parameters_schema_version,
      approved_by: approvedBy,
      approval_timestamp: new Date().toISOString(),
      execution_policy: {
        retry_count: 3,
        timeout_seconds: 300,
        max_attempts: 1
      },
      expires_at: this.calculateExpiration(proposal.action_type),
      original_decision_id: decisionId, // Links to DecisionProposalV1.decision_id
      original_proposal_id: decisionId, // Same as decision_id (proposal_id == decision_id in our model)
      edited_fields: editedFields || [],
      edited_by: editedFields && editedFields.length > 0 ? approvedBy : undefined,
      edited_at: editedFields && editedFields.length > 0 ? new Date().toISOString() : undefined,
      tenant_id: tenantId,
      account_id: accountId,
      trace_id: traceId
    };
    
    // Store in DynamoDB with PK/SK pattern
    await this.storeIntent(intent);
    
    return intent;
  }
  
  /**
   * Edit action intent (creates new intent with provenance)
   * Original intent is preserved; new intent links to it via supersedes_action_intent_id
   */
  async editIntent(
    originalIntentId: string,
    tenantId: string,
    accountId: string,
    edits: Partial<ActionIntentV1>,
    editedBy: string
  ): Promise<ActionIntentV1> {
    const original = await this.getIntent(originalIntentId, tenantId, accountId);
    
    if (!original) {
      throw new Error(`Action intent not found: ${originalIntentId}`);
    }
    
    // Validate editable fields
    const editableFields = ['parameters', 'target', 'expires_at'];
    const editedFields: string[] = [];
    
    for (const field of editableFields) {
      if (edits[field as keyof ActionIntentV1] !== undefined) {
        editedFields.push(field);
      }
    }
    
    // Validate locked fields are not edited
    const lockedFields = ['action_type', 'original_proposal_id', 'original_decision_id', 'action_intent_id'];
    for (const field of lockedFields) {
      if (edits[field as keyof ActionIntentV1] !== undefined) {
        throw new Error(`Cannot edit locked field: ${field}`);
      }
    }
    
    // Generate new action_intent_id for edited intent
    const newActionIntentId = `ai_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    
    // Create new intent with edits (original preserved)
    const editedIntent: ActionIntentV1 = {
      ...original,
      action_intent_id: newActionIntentId, // New ID
      supersedes_action_intent_id: original.action_intent_id, // Link to parent
      ...edits,
      edited_fields: [...(original.edited_fields || []), ...editedFields],
      edited_by: editedBy,
      edited_at: new Date().toISOString()
    };
    
    // Store as new intent (original preserved) with PK/SK pattern
    await this.storeIntent(editedIntent);
    
    return editedIntent;
  }
  
  /**
   * Reject action proposal
   */
  async rejectProposal(
    proposalId: string,
    rejectedBy: string,
    reason: string
  ): Promise<void> {
    // Log rejection to ledger (no intent created)
    // Rejection is handled by ledger event
  }
  
  private calculateExpiration(actionType: ActionTypeV1): string {
    const expirationDays: Record<ActionTypeV1, number> = {
      [ActionTypeV1.REQUEST_RENEWAL_MEETING]: 7,
      [ActionTypeV1.REQUEST_DISCOVERY_CALL]: 14,
      [ActionTypeV1.REQUEST_STAKEHOLDER_INTRO]: 14,
      [ActionTypeV1.UPDATE_OPPORTUNITY_STAGE]: 30,
      [ActionTypeV1.CREATE_OPPORTUNITY]: 30,
      [ActionTypeV1.UPDATE_ACCOUNT_FIELDS]: 30,
      [ActionTypeV1.CREATE_INTERNAL_NOTE]: 90,
      [ActionTypeV1.CREATE_INTERNAL_TASK]: 30,
      [ActionTypeV1.FLAG_FOR_REVIEW]: 7,
      [ActionTypeV1.FETCH_ACCOUNT_NEWS]: 1,
      [ActionTypeV1.ANALYZE_USAGE_PATTERNS]: 1
    };
    
    const days = expirationDays[actionType] || 30;
    const expiration = new Date();
    expiration.setDate(expiration.getDate() + days);
    return expiration.toISOString();
  }
  
  /**
   * Get intent by action_intent_id (uses GSI)
   */
  private async getIntent(intentId: string, tenantId: string, accountId: string): Promise<ActionIntentV1 | null> {
    // Use GSI for direct lookup
    const result = await this.dynamoClient.send(new QueryCommand({
      TableName: this.intentTableName,
      IndexName: 'action-intent-id-index',
      KeyConditionExpression: 'action_intent_id = :intentId',
      ExpressionAttributeValues: {
        ':intentId': intentId
      },
      Limit: 1
    }));
    
    if (!result.Items || result.Items.length === 0) {
      return null;
    }
    
    return result.Items[0] as ActionIntentV1;
  }
  
  /**
   * Store intent with PK/SK pattern
   */
  private async storeIntent(intent: ActionIntentV1): Promise<void> {
    const pk = `TENANT#${intent.tenant_id}#ACCOUNT#${intent.account_id}`;
    const sk = `ACTION_INTENT#${intent.action_intent_id}`;
    
    await this.dynamoClient.send(new PutCommand({
      TableName: this.intentTableName,
      Item: {
        ...intent,
        pk,
        sk
      }
    }));
  }
}
```

**Acceptance Criteria:**
* Action intents are created from approved proposals
* Edited intents create new records (original preserved)
* Locked fields cannot be edited
* Editable fields are validated
* Expiration is calculated per action type
* Original proposal ID is preserved (provenance)

---

## 8. Decision Ledger Events

### 8.1 Decision Ledger Event Types

**File:** `src/types/LedgerEventTypes.ts` (extend existing)

**Purpose:** Add Phase 3 decision events to ledger

**New Event Types:**

```typescript
export enum LedgerEventType {
  // ... existing types ...
  DECISION_PROPOSED = 'DECISION_PROPOSED',
  POLICY_EVALUATED = 'POLICY_EVALUATED',
  ACTION_APPROVED = 'ACTION_APPROVED',
  ACTION_REJECTED = 'ACTION_REJECTED',
  ACTION_EDITED = 'ACTION_EDITED'
}
```

**Event Schemas:**

```typescript
export interface DecisionProposedEvent {
  eventType: LedgerEventType.DECISION_PROPOSED;
  decision_id: string;
  account_id: string;
  decision_type: DecisionType;
  action_count: number;
  confidence_scores: number[];
  trace_id: string;
}

export interface PolicyEvaluatedEvent {
  eventType: LedgerEventType.POLICY_EVALUATED;
  decision_id: string;
  action_intent_id: string;
  evaluation: 'ALLOWED' | 'BLOCKED' | 'APPROVAL_REQUIRED';
  reason_codes: string[];
  trace_id: string;
}

export interface ActionApprovedEvent {
  eventType: LedgerEventType.ACTION_APPROVED;
  action_intent_id: string;
  decision_id: string;
  approved_by: string;
  edited_fields: string[];
  trace_id: string;
}

export interface ActionRejectedEvent {
  eventType: LedgerEventType.ACTION_REJECTED;
  action_intent_id: string;
  decision_id: string;
  rejected_by: string;
  rejection_reason: string;
  trace_id: string;
}
```

**Acceptance Criteria:**
* All decision events are logged to ledger
* Full decision chain is traceable via `trace_id`
* Evidence pointers are preserved
* Event schemas are versioned

---

## 9. Human Approval API

### 9.1 Decision API Handler

**File:** `src/handlers/phase3/decision-api-handler.ts`

**Purpose:** API endpoints for decision evaluation and approval

**Endpoints:**

```typescript
// POST /decisions/evaluate
// Trigger decision evaluation for an account
export async function evaluateDecisionHandler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const { account_id, tenant_id, trigger_type } = JSON.parse(event.body || '{}');
  
  // 1. Check trigger
  const triggerService = new DecisionTriggerService(...);
  const triggerResult = await triggerService.shouldTriggerDecision(account_id, tenant_id, trigger_type);
  
  if (!triggerResult.should_evaluate) {
    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Decision not triggered', reason: triggerResult.reason })
    };
  }
  
  // 2. Check budget
  const budgetService = new CostBudgetService(...);
  const budgetResult = await budgetService.canEvaluateDecision(account_id, tenant_id);
  
  if (!budgetResult.allowed) {
    return {
      statusCode: 429,
      body: JSON.stringify({ message: 'Budget exceeded', reason: budgetResult.reason })
    };
  }
  
  // 3. Assemble context
  const contextAssembler = new DecisionContextAssembler(...);
  const context = await contextAssembler.assembleContext(account_id, tenant_id, traceId);
  
  // 4. Synthesize decision
  const synthesisService = new DecisionSynthesisService(...);
  const proposal = await synthesisService.synthesizeDecision(context);
  
  // 5. Evaluate policy
  const policyGate = new PolicyGateService(...);
  const policyResults = await policyGate.evaluateDecisionProposal(proposal, context.policy_context);
  
  // 6. Consume budget
  await budgetService.consumeBudget(account_id, tenant_id, 1);
  
  // 7. Log to ledger
  await ledgerService.append({
    eventType: LedgerEventType.DECISION_PROPOSED,
    tenantId: tenant_id,
    accountId: account_id,
    traceId,
    data: {
      decision_id: proposal.decision_id,
      decision_type: proposal.decision_type,
      action_count: proposal.actions?.length || 0
    }
  });
  
  return {
    statusCode: 200,
    body: JSON.stringify({
      decision: proposal,
      policy_evaluations: policyResults
    })
  };
}

// GET /accounts/{id}/decisions
// Get decision history for an account
export async function getAccountDecisionsHandler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const accountId = event.pathParameters?.account_id;
  const tenantId = event.headers['x-tenant-id'];
  
  // Query ledger for DECISION_PROPOSED events
  const decisions = await ledgerService.query({
    tenantId,
    accountId,
    eventType: LedgerEventType.DECISION_PROPOSED
  });
  
  return {
    statusCode: 200,
    body: JSON.stringify({ decisions })
  };
}

// POST /actions/{id}/approve
// Approve an action proposal
export async function approveActionHandler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const actionId = event.pathParameters?.action_id;
  const { decision_id, edits } = JSON.parse(event.body || '{}');
  const userId = event.requestContext.authorizer?.userId;
  const tenantId = event.headers['x-tenant-id'];
  
  // CRITICAL: Do not trust client payload. Load proposal from server storage.
  // Approval request must pass {decision_id, action_intent_id}
  // Server loads proposal from DecisionStore (or ledger) by decision_id
  const decisionStore = new DecisionStore(...);
  const proposal = await decisionStore.getDecision(decision_id, tenantId);
  
  if (!proposal) {
    return {
      statusCode: 404,
      body: JSON.stringify({ error: 'Decision not found' })
    };
  }
  
  // Find the specific action proposal
  const actionProposal = proposal.actions.find(a => a.action_intent_id === actionId);
  if (!actionProposal) {
    return {
      statusCode: 404,
      body: JSON.stringify({ error: 'Action proposal not found in decision' })
    };
  }
  
  // Derive tenant/account/trace from proposal (server-authoritative)
  const accountId = proposal.account_id;
  const traceId = proposal.trace_id;
  
  // Create action intent
  const intentService = new ActionIntentService(...);
  const intent = await intentService.createIntent(
    actionProposal,
    proposal.decision_id,
    userId,
    tenantId,
    accountId,
    traceId,
    edits ? Object.keys(edits) : undefined
  );
  
  // Log to ledger
  await ledgerService.append({
    eventType: LedgerEventType.ACTION_APPROVED,
    tenantId,
    accountId,
    traceId,
    data: {
      action_intent_id: intent.action_intent_id,
      decision_id: proposal.decision_id,
      edited_fields: intent.edited_fields
    }
  });
  
  return {
    statusCode: 200,
    body: JSON.stringify({ intent })
  };
}

// POST /actions/{id}/reject
// Reject an action proposal
export async function rejectActionHandler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const actionId = event.pathParameters?.action_id;
  const { reason } = JSON.parse(event.body || '{}');
  const userId = event.requestContext.authorizer?.userId;
  
  // Log rejection to ledger
  await ledgerService.append({
    eventType: LedgerEventType.ACTION_REJECTED,
    tenantId,
    accountId,
    traceId,
    data: {
      action_intent_id: actionId,
      rejection_reason: reason
    }
  });
  
  return {
    statusCode: 200,
    body: JSON.stringify({ message: 'Action rejected' })
  };
}
```

**Acceptance Criteria:**
* All endpoints are tenant-scoped
* All endpoints are trace-aware
* All endpoints log to ledger
* Approval flow supports edits
* Rejection flow logs reason

---

## 10. Event Handlers

### 10.1 Decision Trigger Handler

**File:** `src/handlers/phase3/decision-trigger-handler.ts`

**Purpose:** Handle event-driven decision triggers (lifecycle transitions, high-signal events)

**Event Sources:**
* `LIFECYCLE_STATE_CHANGED` → Trigger decision evaluation
* `SIGNAL_DETECTED` (high-signal types) → Trigger decision evaluation
* `GRAPH_MATERIALIZED` → Optional: Trigger decision evaluation if posture changed

**Implementation:**

```typescript
export async function decisionTriggerHandler(event: EventBridgeEvent): Promise<void> {
  const envelope = event as EventEnvelope;
  const { account_id, tenant_id } = envelope.detail;
  
  // Check if trigger is valid
  const triggerService = new DecisionTriggerService(...);
  const triggerType = inferTriggerType(envelope);
  
  if (!triggerType) {
    logger.warn('Unknown trigger event, blocking', { 
      account_id, 
      detailType: envelope.detailType,
      source: envelope.source 
    });
    return; // Block unknown events
  }
  
  const triggerResult = await triggerService.shouldTriggerDecision(
    account_id,
    tenant_id,
    triggerType,
    envelope.id
  );
  
  if (!triggerResult.should_evaluate) {
    logger.info('Decision not triggered', { account_id, reason: triggerResult.reason });
    return;
  }
  
  // Trigger decision evaluation (async, via EventBridge or SQS)
  await eventBridgeClient.send(new PutEventsCommand({
    Entries: [{
      Source: 'cc-native.decision',
      DetailType: 'DECISION_EVALUATION_REQUESTED',
      Detail: JSON.stringify({
        account_id,
        tenant_id,
        trigger_type: triggerType,
        trigger_event_id: envelope.id
      }),
      EventBusName: 'cc-native-events'
    }]
  }));
}

function inferTriggerType(envelope: EventEnvelope): DecisionTriggerType | null {
  if (envelope.detailType === 'LIFECYCLE_STATE_CHANGED') {
    return DecisionTriggerType.LIFECYCLE_TRANSITION;
  }
  
  if (envelope.detailType === 'SIGNAL_DETECTED') {
    const signalType = envelope.detail.signal_type;
    const highSignalTypes = [
      SignalType.RENEWAL_WINDOW_ENTERED,
      SignalType.SUPPORT_RISK_EMERGING,
      SignalType.USAGE_TREND_CHANGE
    ];
    
    if (highSignalTypes.includes(signalType)) {
      return DecisionTriggerType.HIGH_SIGNAL_ARRIVAL;
    }
  }
  
  // Only allow periodic triggers from scheduler events we control
  if (envelope.source === 'cc-native.scheduler' && envelope.detailType === 'PERIODIC_DECISION_EVALUATION') {
    return DecisionTriggerType.COOLDOWN_GATED_PERIODIC;
  }
  
  // Unknown event - return null to block
  return null;
}
```

**Acceptance Criteria:**
* Trigger handler evaluates trigger conditions
* Only valid triggers emit DECISION_EVALUATION_REQUESTED events
* Cooldown is respected
* Event routing is correct

---

### 10.2 Decision Evaluation Handler

**File:** `src/handlers/phase3/decision-evaluation-handler.ts`

**Purpose:** Handle DECISION_EVALUATION_REQUESTED events and orchestrate decision synthesis

**Implementation:**

```typescript
export async function decisionEvaluationHandler(event: EventBridgeEvent): Promise<void> {
  const { account_id, tenant_id, trigger_type } = event.detail;
  const traceId = generateTraceId();
  
  try {
    // 1. Assemble context
    const contextAssembler = new DecisionContextAssembler(...);
    const context = await contextAssembler.assembleContext(account_id, tenant_id, traceId);
    
    // 2. Check budget
    const budgetService = new CostBudgetService(...);
    const budgetResult = await budgetService.canEvaluateDecision(account_id, tenant_id);
    
    if (!budgetResult.allowed) {
      logger.warn('Decision evaluation blocked by budget', { account_id, reason: budgetResult.reason });
      return;
    }
    
    // 3. Synthesize decision
    const synthesisService = new DecisionSynthesisService(...);
    const proposal = await synthesisService.synthesizeDecision(context);
    
    // 4. Evaluate policy
    const policyGate = new PolicyGateService(...);
    const policyResults = await policyGate.evaluateDecisionProposal(proposal, context.policy_context);
    
    // 5. Consume budget
    await budgetService.consumeBudget(account_id, tenant_id, 1);
    
    // 6. Log to ledger
    await ledgerService.append({
      eventType: LedgerEventType.DECISION_PROPOSED,
      tenantId: tenant_id,
      accountId: account_id,
      traceId,
      data: {
        decision_id: proposal.decision_id,
        decision_type: proposal.decision_type,
        action_count: proposal.actions?.length || 0
      }
    });
    
    // 7. Log policy evaluations
    for (const result of policyResults) {
      await ledgerService.append({
        eventType: LedgerEventType.POLICY_EVALUATED,
        tenantId: tenant_id,
        accountId: account_id,
        traceId,
        data: result
      });
    }
    
    // 8. Emit DECISION_PROPOSED event (for UI/approval flow)
    await eventBridgeClient.send(new PutEventsCommand({
      Entries: [{
        Source: 'cc-native.decision',
        DetailType: 'DECISION_PROPOSED',
        Detail: JSON.stringify({
          decision: proposal,
          policy_evaluations: policyResults
        }),
        EventBusName: 'cc-native-events'
      }]
    }));
    
  } catch (error) {
    logger.error('Decision evaluation failed', { account_id, error });
    // Send to DLQ
    throw error;
  }
}
```

**Acceptance Criteria:**
* Handler orchestrates full decision flow
* Errors are handled and sent to DLQ
* Budget is consumed atomically
* All events are logged to ledger
* DECISION_PROPOSED event is emitted for UI

---

## 11. Infrastructure (CDK)

### 11.1 DynamoDB Tables

**File:** `src/stacks/constructs/DecisionInfrastructure.ts` (new construct)

**Tables:**

```typescript
// Decision Budget Table
const decisionBudgetTable = new dynamodb.Table(this, 'DecisionBudgetTable', {
  tableName: `cc-native-decision-budget`,
  partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
  sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
  billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
  pointInTimeRecovery: true
});

// Action Intent Table
// Uses consistent PK/SK pattern for multi-tenant isolation
const actionIntentTable = new dynamodb.Table(this, 'ActionIntentTable', {
  tableName: `cc-native-action-intent`,
  partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING }, // TENANT#{tenantId}#ACCOUNT#{accountId}
  sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING }, // ACTION_INTENT#{action_intent_id}
  billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
  pointInTimeRecovery: true,
  timeToLiveAttribute: 'expires_at'
});

// GSI: By action_intent_id (for direct lookups)
actionIntentTable.addGlobalSecondaryIndex({
  indexName: 'action-intent-id-index',
  partitionKey: { name: 'action_intent_id', type: dynamodb.AttributeType.STRING }
});

// GSI: By account (for listing intents by account)
actionIntentTable.addGlobalSecondaryIndex({
  indexName: 'account-index',
  partitionKey: { name: 'account_id', type: dynamodb.AttributeType.STRING },
  sortKey: { name: 'approval_timestamp', type: dynamodb.AttributeType.STRING }
});
```

### 11.2 Lambda Functions

```typescript
// Decision Evaluation Handler
const decisionEvaluationHandler = new lambda.Function(this, 'DecisionEvaluationHandler', {
  runtime: lambda.Runtime.NODEJS_20_X,
  handler: 'decision-evaluation-handler.handler',
  timeout: cdk.Duration.minutes(5),
  memorySize: 1024,
  environment: {
    DECISION_BUDGET_TABLE_NAME: decisionBudgetTable.tableName,
    ACTION_INTENT_TABLE_NAME: actionIntentTable.tableName,
    BEDROCK_MODEL_ID: 'anthropic.claude-3-5-sonnet-20241022-v2:0'
  }
});

// Grant permissions
decisionBudgetTable.grantReadWriteData(decisionEvaluationHandler);
actionIntentTable.grantReadWriteData(decisionEvaluationHandler);
bedrockClient.grantInvoke(decisionEvaluationHandler);

// Decision Trigger Handler
const decisionTriggerHandler = new lambda.Function(this, 'DecisionTriggerHandler', {
  runtime: lambda.Runtime.NODEJS_20_X,
  handler: 'decision-trigger-handler.handler',
  timeout: cdk.Duration.seconds(30),
  memorySize: 256
});
```

### 11.3 EventBridge Rules

```typescript
// Rule: LIFECYCLE_STATE_CHANGED → decision-trigger-handler
new events.Rule(this, 'LifecycleDecisionTriggerRule', {
  eventBus: eventBus,
  eventPattern: {
    source: ['cc-native.perception'],
    detailType: ['LIFECYCLE_STATE_CHANGED']
  },
  targets: [new targets.LambdaFunction(decisionTriggerHandler)]
});

// Rule: HIGH_SIGNAL_DETECTED → decision-trigger-handler
new events.Rule(this, 'HighSignalDecisionTriggerRule', {
  eventBus: eventBus,
  eventPattern: {
    source: ['cc-native.perception'],
    detailType: ['SIGNAL_DETECTED'],
    detail: {
      signal_type: [
        SignalType.RENEWAL_WINDOW_ENTERED,
        SignalType.SUPPORT_RISK_EMERGING,
        SignalType.USAGE_TREND_CHANGE
      ]
    }
  },
  targets: [new targets.LambdaFunction(decisionTriggerHandler)]
});

// Rule: DECISION_EVALUATION_REQUESTED → decision-evaluation-handler
new events.Rule(this, 'DecisionEvaluationRule', {
  eventBus: eventBus,
  eventPattern: {
    source: ['cc-native.decision'],
    detailType: ['DECISION_EVALUATION_REQUESTED']
  },
  targets: [new targets.LambdaFunction(decisionEvaluationHandler)]
});
```

### 11.4 API Gateway

```typescript
// Decision API
const decisionApi = new apigateway.RestApi(this, 'DecisionApi', {
  restApiName: 'cc-native-decision-api',
  description: 'Decision evaluation and approval API'
});

// POST /decisions/evaluate
const evaluateResource = decisionApi.root.addResource('decisions').addResource('evaluate');
evaluateResource.addMethod('POST', new apigateway.LambdaIntegration(decisionApiHandler));

// GET /accounts/{id}/decisions
const accountsResource = decisionApi.root.addResource('accounts');
const accountDecisionsResource = accountsResource.addResource('{account_id}').addResource('decisions');
accountDecisionsResource.addMethod('GET', new apigateway.LambdaIntegration(decisionApiHandler));

// POST /actions/{id}/approve
const actionsResource = decisionApi.root.addResource('actions');
const approveResource = actionsResource.addResource('{action_id}').addResource('approve');
approveResource.addMethod('POST', new apigateway.LambdaIntegration(decisionApiHandler));

// POST /actions/{id}/reject
const rejectResource = actionsResource.addResource('{action_id}').addResource('reject');
rejectResource.addMethod('POST', new apigateway.LambdaIntegration(decisionApiHandler));
```

**Acceptance Criteria:**
* All tables are provisioned
* Lambda functions have correct permissions
* EventBridge rules route events correctly
* API Gateway endpoints are configured
* Dead Letter Queues are configured for all handlers

---

## 12. Unit Tests & Contract Tests

### 12.1 Unit Tests

**Files:**
* `src/tests/unit/decision/DecisionTriggerService.test.ts`
* `src/tests/unit/decision/DecisionContextAssembler.test.ts`
* `src/tests/unit/decision/DecisionSynthesisService.test.ts`
* `src/tests/unit/decision/PolicyGateService.test.ts`
* `src/tests/unit/decision/ActionIntentService.test.ts`
* `src/tests/unit/decision/CostBudgetService.test.ts`

**Test Coverage:**
* Decision trigger evaluation (cooldown, event-driven, user-initiated)
* Context assembly (bounded graph, bounded signals)
* Policy evaluation (deterministic rules)
* Action intent creation and editing
* Budget enforcement

### 12.2 Contract Tests

**File:** `src/tests/contract/phase3-certification.test.ts`

**Contract Tests:**
1. **Context Assembly Determinism Test** - Same inputs → same context (deterministic)
2. **Policy Determinism Test** - Same proposal → same policy result (deterministic)
3. **Budget Enforcement Test** - Budget exhaustion blocks evaluation
4. **Trigger Cooldown Test** - Cooldown prevents decision storms
5. **Edit Provenance Test** - Edited intents create new IDs and preserve original
6. **Schema Validation Test** - LLM output always conforms to DecisionProposalBodyV1 schema
7. **Schema Invariant Test** - LLM output respects invariants:
   * No unknown keys (strict mode)
   * Confidence in [0,1]
   * Action types valid
   * Bounded counts (actions max 25, why max 20)
   * Decision type rules consistent (no actions if NO_ACTION_RECOMMENDED)
8. **Proposal ID Invariant Test** - proposal_id == decision_id (no separate proposal_id in v1)

**Acceptance Criteria:**
* All unit tests pass
* All contract tests pass
* Test coverage > 80%
* Golden fixtures for deterministic tests

---

## Implementation Checklist

### Phase 3.1: Foundation
- [ ] Decision types and interfaces defined
- [ ] ActionTypeV1 enum locked
- [ ] Risk tier classification complete
- [ ] Decision trigger types defined

### Phase 3.2: Core Services
- [ ] Decision Trigger Service implemented
- [ ] Decision Context Assembler implemented
- [ ] Cost Budgeting Service implemented
- [ ] Decision Synthesis Service implemented
- [ ] Policy Gate Service implemented
- [ ] Action Intent Service implemented

### Phase 3.3: Integration
- [ ] Decision Ledger Events added
- [ ] Event Handlers implemented
- [ ] API Handlers implemented
- [ ] Infrastructure (CDK) deployed

### Phase 3.4: Testing
- [ ] Unit tests written and passing
- [ ] Contract tests written and passing
- [ ] Integration tests written and passing

---

## Key Implementation Notes

1. **LLM Schema Enforcement:** Use Bedrock JSON mode with strict schema validation (fail-closed)
2. **Budget Enforcement:** Check budget before synthesis, consume atomically after
3. **Cooldown Enforcement:** Track `last_decision_evaluated_at` in AccountPostureState
4. **Edit Provenance:** Edited intents create new records, original preserved
5. **Policy Determinism:** Policy rules are code-only, no LLM influence
6. **Bounded Context:** Graph refs max 10, signals max 50, depth max 2

---

## Related Documents

* `PHASE_3_IMPLEMENTATION_PLAN.md` - High-level implementation plan
* `WORLD_MODEL_CONTRACT.md` - Truth layer foundation
* `AGENT_READ_POLICY.md` - Confidence gating and autonomy tiers
* `PHASE_2_IMPLEMENTATION_PLAN.md` - Situation graph and synthesis (prerequisite)
* `GRAPH_CONVENTIONS.md` - Graph query patterns and conventions

---

**Status:** 📋 Planning Complete - Ready for Implementation
