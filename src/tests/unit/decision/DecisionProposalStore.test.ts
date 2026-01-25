/**
 * DecisionProposalStore Unit Tests - Phase 3
 */

import { DecisionProposalStore } from '../../../services/decision/DecisionProposalStore';
import { Logger } from '../../../services/core/Logger';
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { mockDynamoDBDocumentClient, resetAllMocks } from '../../__mocks__/aws-sdk-clients';
import { DecisionProposalV1 } from '../../../types/DecisionTypes';

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn(() => mockDynamoDBDocumentClient),
  },
  PutCommand: jest.fn(),
  QueryCommand: jest.fn(),
}));

describe('DecisionProposalStore', () => {
  let store: DecisionProposalStore;
  let logger: Logger;

  beforeEach(() => {
    resetAllMocks();
    logger = new Logger('DecisionProposalStoreTest');
    store = new DecisionProposalStore(
      mockDynamoDBDocumentClient as any,
      'test-proposal-table',
      logger
    );
  });

  describe('storeProposal', () => {
    it('should store proposal with correct PK/SK pattern', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({});

      const proposal: DecisionProposalV1 = {
        decision_id: 'dec-123',
        account_id: 'account-1',
        tenant_id: 'tenant-1',
        trace_id: 'trace-1',
        decision_type: 'PROPOSE_ACTIONS',
        decision_version: 'v1',
        schema_version: 'v1',
        decision_reason_codes: [],
        summary: 'Test proposal',
        actions: [],
        created_at: new Date().toISOString(),
        proposal_fingerprint: 'fingerprint-1',
      };

      await store.storeProposal(proposal);

      expect(PutCommand).toHaveBeenCalled();
      const putCall = (PutCommand as unknown as jest.Mock).mock.calls[0][0];
      expect(putCall.Item.pk).toBe('TENANT#tenant-1#ACCOUNT#account-1');
      expect(putCall.Item.sk).toBe('DECISION#dec-123');
    });
  });

  describe('getProposal', () => {
    it('should retrieve proposal by decision_id', async () => {
      const proposal: DecisionProposalV1 = {
        decision_id: 'dec-123',
        account_id: 'account-1',
        tenant_id: 'tenant-1',
        trace_id: 'trace-1',
        decision_type: 'PROPOSE_ACTIONS',
        decision_version: 'v1',
        schema_version: 'v1',
        decision_reason_codes: [],
        summary: 'Test proposal',
        actions: [],
        created_at: new Date().toISOString(),
        proposal_fingerprint: 'fingerprint-1',
      };

      mockDynamoDBDocumentClient.send.mockResolvedValue({
        Items: [proposal],
      });

      const result = await store.getProposal('dec-123', 'tenant-1');

      expect(result).toEqual(proposal);
      expect(QueryCommand).toHaveBeenCalled();
    });

    it('should return null if proposal not found', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({
        Items: [],
      });

      const result = await store.getProposal('dec-123', 'tenant-1');

      expect(result).toBeNull();
    });

    it('should return null if tenant mismatch', async () => {
      const proposal: DecisionProposalV1 = {
        decision_id: 'dec-123',
        account_id: 'account-1',
        tenant_id: 'tenant-2', // Different tenant
        trace_id: 'trace-1',
        decision_type: 'PROPOSE_ACTIONS',
        decision_version: 'v1',
        schema_version: 'v1',
        decision_reason_codes: [],
        summary: 'Test proposal',
        actions: [],
        created_at: new Date().toISOString(),
        proposal_fingerprint: 'fingerprint-1',
      };

      mockDynamoDBDocumentClient.send.mockResolvedValue({
        Items: [proposal],
      });

      const result = await store.getProposal('dec-123', 'tenant-1');

      expect(result).toBeNull();
    });
  });
});
