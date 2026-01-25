/**
 * Decision Proposal Store Service - Phase 3
 * 
 * Store and retrieve DecisionProposalV1 from authoritative DynamoDB table.
 */

import { DynamoDBDocumentClient, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { DecisionProposalV1 } from '../../types/DecisionTypes';
import { Logger } from '../core/Logger';

/**
 * Decision Proposal Store Service
 */
export class DecisionProposalStore {
  constructor(
    private dynamoClient: DynamoDBDocumentClient,
    private tableName: string,
    private logger: Logger
  ) {}

  /**
   * Store enriched DecisionProposalV1 (authoritative storage for approval/rejection flow)
   */
  async storeProposal(proposal: DecisionProposalV1): Promise<void> {
    const pk = `TENANT#${proposal.tenant_id}#ACCOUNT#${proposal.account_id}`;
    const sk = `DECISION#${proposal.decision_id}`;
    
    await this.dynamoClient.send(new PutCommand({
      TableName: this.tableName,
      Item: {
        ...proposal,
        pk,
        sk
      }
    }));
  }

  /**
   * Get proposal by decision_id (uses GSI)
   */
  async getProposal(decisionId: string, tenantId: string): Promise<DecisionProposalV1 | null> {
    // Use GSI for direct lookup by decision_id
    const result = await this.dynamoClient.send(new QueryCommand({
      TableName: this.tableName,
      IndexName: 'decision-id-index',
      KeyConditionExpression: 'decision_id = :decisionId',
      ExpressionAttributeValues: {
        ':decisionId': decisionId
      },
      Limit: 1
    }));
    
    if (!result.Items || result.Items.length === 0) {
      return null;
    }
    
    const proposal = result.Items[0] as DecisionProposalV1;
    
    // Verify tenant match (security check)
    if (proposal.tenant_id !== tenantId) {
      this.logger.warn('Tenant mismatch in proposal lookup', { decisionId, tenantId, proposalTenantId: proposal.tenant_id });
      return null;
    }
    
    return proposal;
  }
}
