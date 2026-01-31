/**
 * Action Intent Service - Phase 3
 * 
 * Manage action intents (create, approve, reject, edit).
 */

import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { ActionIntentV1, ActionProposalV1, ActionTypeV1, validateProvenanceInvariant } from '../../types/DecisionTypes';
import { Logger } from '../core/Logger';

/**
 * Action Intent Service
 */
export class ActionIntentService {
  constructor(
    private dynamoClient: DynamoDBDocumentClient,
    private intentTableName: string,
    private logger: Logger
  ) {}

  /**
   * Create action intent from approved proposal
   * Note: proposal.action_ref is used to identify the proposal; action_intent_id is generated on approval
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
    // Generate new action_intent_id on approval (proposal.action_ref is just for selection)
    const actionIntentId = `ai_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    
    const expiresAt = this.calculateExpiration(proposal.action_type);
    const intent: ActionIntentV1 = {
      action_intent_id: actionIntentId, // New ID generated on approval (not proposal.action_ref)
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
      expires_at: expiresAt,
      expires_at_epoch: Math.floor(new Date(expiresAt).getTime() / 1000), // TTL field (epoch seconds) - required for DynamoDB TTL
      original_decision_id: decisionId, // Links to DecisionProposalV1.decision_id
      original_proposal_id: decisionId, // Same as decision_id (INVARIANT: proposal_id == decision_id in v1)
      edited_fields: editedFields || [],
      edited_by: editedFields && editedFields.length > 0 ? approvedBy : undefined,
      edited_at: editedFields && editedFields.length > 0 ? new Date().toISOString() : undefined,
      tenant_id: tenantId,
      account_id: accountId,
      trace_id: traceId,
      // Phase 4: Registry version (required for deterministic execution)
      // TODO: Phase 3 needs to be updated to fetch registry_version from ActionTypeRegistryService
      // For now, defaulting to 1 (will be properly populated when Phase 3 is updated)
      registry_version: 1, // TODO: Get from ActionTypeRegistryService.getToolMapping(action_type)?.registry_version
      // Phase 5.4: Optional; used by auto-approval policy when gate runs on this intent
      confidence_score: proposal.confidence,
      risk_level: proposal.risk_level,
    };
    
    // Validate provenance invariant (original_proposal_id == original_decision_id)
    validateProvenanceInvariant(intent);
    
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
    // Note: If expires_at is edited, expires_at_epoch must be recalculated
    const editedExpiresAt = edits.expires_at || original.expires_at;
    const editedIntent: ActionIntentV1 = {
      ...original,
      action_intent_id: newActionIntentId, // New ID
      supersedes_action_intent_id: original.action_intent_id, // Link to parent
      ...edits,
      expires_at_epoch: Math.floor(new Date(editedExpiresAt).getTime() / 1000), // Recalculate TTL if expires_at changed
      edited_fields: [...(original.edited_fields || []), ...editedFields],
      edited_by: editedBy,
      edited_at: new Date().toISOString()
    };
    
    // Validate provenance invariant (original_proposal_id == original_decision_id)
    validateProvenanceInvariant(editedIntent);
    
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
    // Use string literals (ActionTypeV1 is a type, not an enum with properties)
    const expirationDays: Record<ActionTypeV1, number> = {
      'REQUEST_RENEWAL_MEETING': 7,
      'REQUEST_DISCOVERY_CALL': 14,
      'REQUEST_STAKEHOLDER_INTRO': 14,
      'UPDATE_OPPORTUNITY_STAGE': 30,
      'CREATE_OPPORTUNITY': 30,
      'UPDATE_ACCOUNT_FIELDS': 30,
      'CREATE_INTERNAL_NOTE': 90,
      'CREATE_INTERNAL_TASK': 30,
      'FLAG_FOR_REVIEW': 7,
      'FETCH_ACCOUNT_NEWS': 1,
      'ANALYZE_USAGE_PATTERNS': 1
    };
    
    const days = expirationDays[actionType] || 30;
    const expiration = new Date();
    expiration.setDate(expiration.getDate() + days);
    return expiration.toISOString();
  }
  
  /**
   * Get intent by action_intent_id (GetItem on pk/sk for consistent read).
   * CRITICAL: Verifies tenant and account match to prevent cross-scope access.
   *
   * Phase 4: Made public for execution-starter-handler and execution-status-api to fetch intent.
   * Uses GetItem instead of GSI Query so integration tests and status API get consistent reads
   * immediately after intent creation (GSI is eventually consistent).
   */
  public async getIntent(intentId: string, tenantId: string, accountId: string): Promise<ActionIntentV1 | null> {
    const pk = `TENANT#${tenantId}#ACCOUNT#${accountId}`;
    const sk = `ACTION_INTENT#${intentId}`;

    const result = await this.dynamoClient.send(new GetCommand({
      TableName: this.intentTableName,
      Key: { pk, sk },
    }));

    if (!result.Item) {
      return null;
    }

    const intent = result.Item as ActionIntentV1;
    return intent;
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
