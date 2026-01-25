/**
 * ActionIntentService Unit Tests - Phase 3
 */

import { ActionIntentService } from '../../../services/decision/ActionIntentService';
import { Logger } from '../../../services/core/Logger';
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { mockDynamoDBDocumentClient, resetAllMocks } from '../../__mocks__/aws-sdk-clients';
import { ActionProposalV1, ActionIntentV1 } from '../../../types/DecisionTypes';

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn(() => mockDynamoDBDocumentClient),
  },
  PutCommand: jest.fn(),
  QueryCommand: jest.fn(),
}));

describe('ActionIntentService', () => {
  let service: ActionIntentService;
  let logger: Logger;

  beforeEach(() => {
    resetAllMocks();
    logger = new Logger('ActionIntentServiceTest');
    service = new ActionIntentService(
      mockDynamoDBDocumentClient as any,
      'test-intent-table',
      logger
    );
  });

  describe('createIntent', () => {
    it('should create intent from approved proposal', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({});

      const proposal: ActionProposalV1 = {
        action_ref: 'action-ref-1',
        action_type: 'REQUEST_RENEWAL_MEETING',
        why: ['REASON_1'],
        confidence: 0.9,
        risk_level: 'HIGH',
        llm_suggests_human_review: true,
        blocking_unknowns: [],
        parameters: { meeting_type: 'renewal' },
        target: { entity_type: 'ACCOUNT', entity_id: 'account-1' },
      };

      const intent = await service.createIntent(
        proposal,
        'dec-123',
        'user-1',
        'tenant-1',
        'account-1',
        'trace-1'
      );

      expect(intent.action_intent_id).toBeDefined();
      expect(intent.action_type).toBe('REQUEST_RENEWAL_MEETING');
      expect(intent.original_decision_id).toBe('dec-123');
      expect(intent.original_proposal_id).toBe('dec-123');
      expect(intent.expires_at_epoch).toBeDefined();
      expect(intent.approved_by).toBe('user-1');
      expect(PutCommand).toHaveBeenCalled();
    });

    it('should validate provenance invariant', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({});

      const proposal: ActionProposalV1 = {
        action_ref: 'action-ref-1',
        action_type: 'REQUEST_RENEWAL_MEETING',
        why: ['REASON_1'],
        confidence: 0.9,
        risk_level: 'HIGH',
        llm_suggests_human_review: true,
        blocking_unknowns: [],
        parameters: {},
        target: { entity_type: 'ACCOUNT', entity_id: 'account-1' },
      };

      const intent = await service.createIntent(
        proposal,
        'dec-123',
        'user-1',
        'tenant-1',
        'account-1',
        'trace-1'
      );

      // Provenance invariant: original_proposal_id == original_decision_id
      expect(intent.original_proposal_id).toBe(intent.original_decision_id);
    });
  });

  describe('editIntent', () => {
    it('should create new intent with provenance link', async () => {
      const originalIntent: ActionIntentV1 = {
        action_intent_id: 'ai-original',
        action_type: 'REQUEST_RENEWAL_MEETING',
        target: { entity_type: 'ACCOUNT', entity_id: 'account-1' },
        parameters: { meeting_type: 'renewal' },
        approved_by: 'user-1',
        approval_timestamp: new Date().toISOString(),
        execution_policy: { retry_count: 3, timeout_seconds: 300, max_attempts: 1 },
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        expires_at_epoch: Math.floor((Date.now() + 7 * 24 * 60 * 60 * 1000) / 1000),
        original_decision_id: 'dec-123',
        original_proposal_id: 'dec-123',
        edited_fields: [],
        tenant_id: 'tenant-1',
        account_id: 'account-1',
        trace_id: 'trace-1',
      };

      mockDynamoDBDocumentClient.send
        .mockResolvedValueOnce({ Items: [originalIntent] }) // getIntent query
        .mockResolvedValueOnce({}); // storeIntent put

      const editedIntent = await service.editIntent(
        'ai-original',
        'tenant-1',
        'account-1',
        { parameters: { meeting_type: 'renewal', date: '2024-02-01' } },
        'user-2'
      );

      expect(editedIntent.action_intent_id).not.toBe('ai-original');
      expect(editedIntent.supersedes_action_intent_id).toBe('ai-original');
      expect(editedIntent.edited_fields).toContain('parameters');
      expect(editedIntent.edited_by).toBe('user-2');
    });

    it('should prevent editing locked fields', async () => {
      const originalIntent: ActionIntentV1 = {
        action_intent_id: 'ai-original',
        action_type: 'REQUEST_RENEWAL_MEETING',
        target: { entity_type: 'ACCOUNT', entity_id: 'account-1' },
        parameters: {},
        approved_by: 'user-1',
        approval_timestamp: new Date().toISOString(),
        execution_policy: { retry_count: 3, timeout_seconds: 300, max_attempts: 1 },
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        expires_at_epoch: Math.floor((Date.now() + 7 * 24 * 60 * 60 * 1000) / 1000),
        original_decision_id: 'dec-123',
        original_proposal_id: 'dec-123',
        edited_fields: [],
        tenant_id: 'tenant-1',
        account_id: 'account-1',
        trace_id: 'trace-1',
      };

      mockDynamoDBDocumentClient.send.mockResolvedValue({ Items: [originalIntent] });

      await expect(
        service.editIntent(
          'ai-original',
          'tenant-1',
          'account-1',
          { action_type: 'UPDATE_OPPORTUNITY_STAGE' as any }, // Attempt to edit locked field
          'user-2'
        )
      ).rejects.toThrow('Cannot edit locked field: action_type');
    });

    it('should recalculate expires_at_epoch if expires_at is edited', async () => {
      const originalIntent: ActionIntentV1 = {
        action_intent_id: 'ai-original',
        action_type: 'REQUEST_RENEWAL_MEETING',
        target: { entity_type: 'ACCOUNT', entity_id: 'account-1' },
        parameters: {},
        approved_by: 'user-1',
        approval_timestamp: new Date().toISOString(),
        execution_policy: { retry_count: 3, timeout_seconds: 300, max_attempts: 1 },
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        expires_at_epoch: Math.floor((Date.now() + 7 * 24 * 60 * 60 * 1000) / 1000),
        original_decision_id: 'dec-123',
        original_proposal_id: 'dec-123',
        edited_fields: [],
        tenant_id: 'tenant-1',
        account_id: 'account-1',
        trace_id: 'trace-1',
      };

      const newExpiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
      const expectedEpoch = Math.floor(new Date(newExpiresAt).getTime() / 1000);

      mockDynamoDBDocumentClient.send
        .mockResolvedValueOnce({ Items: [originalIntent] })
        .mockResolvedValueOnce({});

      const editedIntent = await service.editIntent(
        'ai-original',
        'tenant-1',
        'account-1',
        { expires_at: newExpiresAt },
        'user-2'
      );

      expect(editedIntent.expires_at).toBe(newExpiresAt);
      expect(editedIntent.expires_at_epoch).toBe(expectedEpoch);
    });
  });
});
