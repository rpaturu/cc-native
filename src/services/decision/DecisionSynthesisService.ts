/**
 * Decision Synthesis Service - Phase 3
 * 
 * Generate decision proposals using LLM (Bedrock), with strict schema enforcement.
 */

import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { DecisionProposalBodyV1Schema, DecisionProposalV1, generateProposalFingerprint, ActionProposalV1, ActionProposalBodyV1, ActionTypeV1Enum } from '../../types/DecisionTypes';
import { DecisionContextV1 } from '../../types/DecisionTypes';
import { Logger } from '../core/Logger';
import { createHash } from 'crypto';

/**
 * Decision Synthesis Service
 */
export class DecisionSynthesisService {
  constructor(
    private bedrockClient: BedrockRuntimeClient,
    private modelId: string, // e.g., 'anthropic.claude-3-5-sonnet-20241022-v2:0'
    private logger: Logger
  ) {}

  /**
   * Synthesize decision proposal from context
   * Calls Bedrock following cc-orchestrator1 pattern (no response_format for compatibility)
   */
  async synthesizeDecision(
    context: DecisionContextV1
  ): Promise<DecisionProposalV1> {
    // Build prompt with context
    const prompt = this.buildPrompt(context);
    
    // Log model ID for debugging
    this.logger.debug('Invoking Bedrock model', {
      modelId: this.modelId,
      promptLength: prompt.length,
    });
    
    // Call Bedrock following cc-orchestrator1 pattern (no response_format for compatibility)
    // Note: response_format with json_schema is not supported by all Claude models (e.g., Claude 3.5 Haiku)
    let responseBody: any;
    try {
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
          ]
        }),
        contentType: 'application/json',
        accept: 'application/json'
      }));
    
      // Parse Bedrock response (following cc-orchestrator1 pattern)
      // For Claude models: response.body is JSON with 'content' array containing text
      const rawResponse = JSON.parse(new TextDecoder().decode(response.body));
      const responseText = rawResponse.content?.[0]?.text || '';
      
      // Extract JSON from response text (may be wrapped in markdown code blocks)
      try {
        // Try to parse as-is first
        responseBody = JSON.parse(responseText);
      } catch {
        // If that fails, try to extract JSON from markdown code blocks
        const jsonMatch = responseText.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/) || 
                         responseText.match(/(\{[\s\S]*\})/);
        if (jsonMatch) {
          responseBody = JSON.parse(jsonMatch[1]);
        } else {
          throw new Error(`Failed to parse JSON from Bedrock response: ${responseText.substring(0, 200)}`);
        }
      }
    } catch (error) {
      // Enhanced error logging for Bedrock failures
      this.logger.error('Bedrock invocation failed', {
        modelId: this.modelId,
        error: error instanceof Error ? error.message : String(error),
        errorName: error instanceof Error ? error.name : 'Unknown',
        errorCode: (error as any)?.$metadata?.httpStatusCode,
      });
      
      // Re-throw with more context
      if (error instanceof Error) {
        if (error.name === 'ResourceNotFoundException' || (error as any)?.$metadata?.httpStatusCode === 404) {
          throw new Error(`Bedrock model not found: ${this.modelId}. Please verify the model ID is correct and available in your region.`);
        }
      }
      throw error;
    }
    
    // Validate LLM output (proposal body only, no IDs)
    const proposalBody = DecisionProposalBodyV1Schema.parse(responseBody);
    
    // Generate proposal fingerprint for determinism testing and duplicate detection
    const fingerprint = generateProposalFingerprint(proposalBody);
    
    // Generate decision ID first (needed for action ref generation)
    const decisionId = this.generateDecisionId(context);
    
    // Generate server-assigned action reference IDs (for UI approval flow)
    // Note: LLM does NOT generate action_ref - server generates stable refs post-parse
    // Naming: action_ref (in proposal) vs action_intent_id (in intent, created on approval)
    // Sort actions by stable criteria (e.g., action_type + target) to ensure refs are stable even if order changes
    const sortedActions = [...proposalBody.actions].sort((a, b) => {
      const keyA = `${a.action_type}:${a.target.entity_type}:${a.target.entity_id}`;
      const keyB = `${b.action_type}:${b.target.entity_type}:${b.target.entity_id}`;
      return keyA.localeCompare(keyB);
    });
    
    const enrichedActions = sortedActions.map((action) => ({
      ...action,
      action_ref: `action_ref_${this.generateActionRef(decisionId, action)}` // Server-generated stable ref (no index, order-independent)
    }));
    
    // Enrich with server-assigned IDs and metadata
    const proposal: DecisionProposalV1 = {
      ...proposalBody,
      actions: enrichedActions, // Actions with server-generated refs
      decision_id: decisionId, // Server-assigned (non-deterministic)
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
   * Note: Explicitly requests JSON output since we're not using structured output mode
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
${context.active_signals.slice(0, 10).map(s => `- ${s.signalType}: ${s.description || 'No description'}`).join('\n')}

Risk Factors:
${context.risk_factors.map(r => `- ${r.type}: ${r.description}`).join('\n')}

Opportunities:
${context.opportunities.map(o => `- ${o.type}: ${o.description}`).join('\n')}

Unknowns (blocking):
${context.unknowns.map(u => `- ${u.type}: ${u.description}`).join('\n')}

Policy Constraints:
- Min confidence threshold: ${context.policy_context.min_confidence_threshold}
- Available action types: ${Object.keys(context.policy_context.action_type_permissions).join(', ')}

Task:
Synthesize what actions should be taken next for this account. Consider:
1. Current posture and risk factors
2. Active signals and opportunities
3. Blocking unknowns (if any)
4. Policy constraints

CRITICAL: You must output ONLY valid JSON matching the DecisionProposalV1 schema. Do not include markdown code blocks or any other formatting. Return a JSON object with:
- decision_type: "PROPOSE_ACTIONS", "NO_ACTION_RECOMMENDED", or "BLOCKED_BY_UNKNOWNS"
- decision_reason_codes: Array of normalized reason codes (e.g., ["RENEWAL_WINDOW_ENTERED", "USAGE_TREND_DOWN"])
- actions: Array of action proposals (if PROPOSE_ACTIONS, otherwise empty array)
- summary: Brief summary string (max 280 characters)
- decision_version: "v1"
- schema_version: "v1"
- confidence: Number between 0 and 1
- blocking_unknowns: Array of strings (if BLOCKED_BY_UNKNOWNS, otherwise empty array)

Each action must include:
- action_type: One of the available action types
- why: Array of strings explaining the rationale
- confidence: Number between 0 and 1
- risk_level: "MINIMAL", "LOW", "MEDIUM", or "HIGH"
- llm_suggests_human_review: Boolean
- parameters: Object with action-specific parameters
- target: Object with entity_type and entity_id

If no action is appropriate, set decision_type to "NO_ACTION_RECOMMENDED" and actions to [].
If blocking unknowns prevent decision, set decision_type to "BLOCKED_BY_UNKNOWNS" and blocking_unknowns to the list of unknowns.

Output only the JSON object, nothing else.`;
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

You must output valid JSON matching the DecisionProposalV1 schema. Return only the JSON object, no markdown formatting.`;
  }
  
  /**
   * Get JSON schema for DecisionProposalBodyV1 (for Bedrock JSON mode)
   * Note: LLM returns proposal body only (no IDs). Server enriches post-parse.
   * 
   * IMPORTANT: Bedrock schema enforces structure; Zod enforces invariants fail-closed.
   * - Bedrock JSON mode ensures LLM output matches structure (required fields, types, enums)
   * - Zod validation (post-parse) enforces invariants (decision_type rules, array bounds, etc.)
   * - In tests, treat "Bedrock schema matches Zod" as structural parity, not invariant parity
   */
  private getDecisionProposalSchema(): object {
    return {
      type: 'object',
      required: ['decision_type', 'decision_reason_codes', 'summary', 'decision_version', 'schema_version'],
      properties: {
        decision_type: {
          type: 'string',
          enum: ['PROPOSE_ACTIONS', 'NO_ACTION_RECOMMENDED', 'BLOCKED_BY_UNKNOWNS']
        },
        decision_reason_codes: {
          type: 'array',
          items: { type: 'string' },
          maxItems: 50
        },
        actions: {
          type: 'array',
          items: {
            type: 'object',
            // Note: action_ref is NOT required - server generates it post-parse
            required: ['action_type', 'why', 'confidence', 'risk_level', 'llm_suggests_human_review', 'target'],
            properties: {
              // action_ref removed - server generates stable ID post-parse
              action_type: { type: 'string', enum: ActionTypeV1Enum.options },
              why: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 20 },
              confidence: { type: 'number', minimum: 0, maximum: 1 },
              risk_level: { type: 'string', enum: ['MINIMAL', 'LOW', 'MEDIUM', 'HIGH'] },
              llm_suggests_human_review: { type: 'boolean' },
              blocking_unknowns: { type: 'array', items: { type: 'string' }, maxItems: 20 },
              parameters: { type: 'object' },
              parameters_schema_version: { type: 'string' },
              target: {
                type: 'object',
                required: ['entity_type', 'entity_id'],
                properties: {
                  entity_type: { type: 'string', enum: ['ACCOUNT', 'CONTACT', 'OPPORTUNITY', 'DEAL', 'ENGAGEMENT'] },
                  entity_id: { type: 'string' }
                }
              },
              proposed_rank: { type: 'number', minimum: 1, maximum: 50 }
            }
          },
          maxItems: 25
        },
        summary: { type: 'string', maxLength: 280 },
        decision_version: { type: 'string', const: 'v1' },
        schema_version: { type: 'string', const: 'v1' },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
        blocking_unknowns: { type: 'array', items: { type: 'string' }, maxItems: 20 }
      }
      // Note: decision_id, account_id, tenant_id, trace_id, proposal_fingerprint are NOT in schema (server-enriched)
    };
  }
  
  /**
   * Generate stable action reference ID for UI approval flow
   * Server-generated, deterministic hash based on proposal content
   * Used for matching action proposals in approval requests
   * Note: This is action_ref (in proposal), not action_intent_id (which is generated on approval)
   */
  private generateActionRef(decisionId: string, action: ActionProposalBodyV1): string {
    // Stable hash: decision_id + action_type + target + first why reason
    const stableKey = `${decisionId}:${action.action_type}:${action.target.entity_type}:${action.target.entity_id}:${action.why[0]}`;
    return createHash('sha256').update(stableKey, 'utf8').digest('hex').substring(0, 16);
  }
  
  /**
   * Generate decision ID (non-deterministic, server-assigned)
   * Note: Decision IDs are not deterministic; only context assembly and policy evaluation are deterministic.
   */
  private generateDecisionId(context: DecisionContextV1): string {
    return `decision-${context.account_id}-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  }
}
