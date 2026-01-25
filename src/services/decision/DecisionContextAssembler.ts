/**
 * Decision Context Assembler - Phase 3
 * 
 * Assembles bounded, deterministic input for LLM decision synthesis.
 * Bounded: Max 10 graph refs, max 50 active signals, max depth 2.
 */

import { DecisionContextV1, GraphContextRef, PolicyContext, ActionTypeV1, ActionPermission } from '../../types/DecisionTypes';
import { AccountPostureStateService } from '../synthesis/AccountPostureStateService';
import { SignalService } from '../perception/SignalService';
import { IGraphService } from '../graph/IGraphService';
import { TenantService } from '../core/TenantService';
import { Logger } from '../core/Logger';
import { LifecycleState, SignalType } from '../../types/SignalTypes';
import { ACTION_TYPE_RISK_TIERS } from '../../types/DecisionTypes';
import { VertexIdGenerator } from '../../types/GraphTypes';
import { ActionTypeV1Enum } from '../../types/DecisionTypes';

/**
 * Decision Context Assembler
 */
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
    const activeSignals = await this.signalService.getSignalsForAccount(
      accountId,
      tenantId,
      { status: 'ACTIVE' as any }
    );
    // Limit to 50 signals
    const boundedSignals = activeSignals.slice(0, 50);
    
    // 3. Extract risk factors, opportunities, unknowns from posture state
    const riskFactors = postureState.risk_factors || [];
    const opportunities = postureState.opportunities || [];
    const unknowns = postureState.unknowns || [];
    
    // 4. Fetch limited graph neighborhood (Neptune, depth <= 2, max 10 refs)
    const graphContextRefs = await this.fetchBoundedGraphContext(
      accountId,
      tenantId,
      2, // maxDepth
      10 // maxRefs
    );
    
    // 5. Fetch tenant policy config
    const tenant = await this.tenantService.getTenant(tenantId);
    if (!tenant) {
      throw new Error(`Tenant not found: ${tenantId}`);
    }
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
   * Optimized: Single call to getNeighbors(maxDepth:2) returns full neighborhood, then slice by depth
   */
  private async fetchBoundedGraphContext(
    accountId: string,
    tenantId: string,
    maxDepth: number,
    maxRefs: number
  ): Promise<GraphContextRef[]> {
    const accountVertexId = VertexIdGenerator.account(tenantId, accountId);
    const refs: GraphContextRef[] = [];
    
    // Single call to fetch full neighborhood up to maxDepth (more efficient than separate depth-1/depth-2 calls)
    const allVertices = await this.graphService.getNeighbors(
      accountVertexId,
      { maxDepth: maxDepth, limit: maxRefs * 2 } // Fetch more than needed, then filter by depth
    );
    
    // Separate by depth and respect maxRefs total
    const depth1Vertices = allVertices.filter(v => v.depth === 1).slice(0, maxRefs);
    for (const vertex of depth1Vertices) {
      refs.push({
        vertex_id: vertex.id,
        vertex_type: vertex.label,
        depth: 1
      });
    }
    
    // If we have room, add depth 2 vertices (but respect maxRefs total)
    if (refs.length < maxRefs && maxDepth >= 2) {
      const remaining = maxRefs - refs.length;
      const depth2Vertices = allVertices.filter(v => v.depth === 2).slice(0, remaining);
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
  private buildPolicyContext(tenant: any): PolicyContext {
    return {
      tenant_id: tenant.tenantId,
      min_confidence_threshold: tenant.config?.min_confidence_threshold || 0.70,
      action_type_permissions: this.getActionTypePermissions(tenant),
      cost_budget_remaining: tenant.config?.decision_cost_budget_remaining || 100
    };
  }
  
  /**
   * Get action type permissions (from tenant config or defaults)
   * Note: ActionTypeV1Enum is a Zod enum - iterate via .options
   */
  private getActionTypePermissions(tenant: any): Record<ActionTypeV1, ActionPermission> {
    const permissions: Record<ActionTypeV1, ActionPermission> = {} as any;
    
    // Iterate over Zod enum values (ActionTypeV1Enum.options)
    for (const actionType of ActionTypeV1Enum.options) {
      const defaultConfig = ACTION_TYPE_RISK_TIERS[actionType];
      const tenantOverride = tenant.config?.action_type_permissions?.[actionType];
      
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
    posture: any,
    signals: any[]
  ): LifecycleState {
    // Use Phase 1 lifecycle inference logic
    // CUSTOMER if active contract, SUSPECT if engagement, PROSPECT otherwise
    if (posture.posture === 'CUSTOMER' || signals.some((s: any) => s.signalType === SignalType.RENEWAL_WINDOW_ENTERED)) {
      return LifecycleState.CUSTOMER;
    }
    if (signals.some((s: any) => s.signalType === SignalType.FIRST_ENGAGEMENT_OCCURRED)) {
      return LifecycleState.SUSPECT;
    }
    return LifecycleState.PROSPECT;
  }
}
