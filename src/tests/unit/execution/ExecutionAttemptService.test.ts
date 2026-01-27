/**
 * ExecutionAttemptService Unit Tests - Phase 4.2
 */

import { ExecutionAttemptService } from '../../../services/execution/ExecutionAttemptService';
import { Logger } from '../../../services/core/Logger';
import { DynamoDBDocumentClient, PutCommand, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { mockDynamoDBDocumentClient, resetAllMocks } from '../../__mocks__/aws-sdk-clients';
import { ExecutionAttempt } from '../../../types/ExecutionTypes';
import executionAttemptRunning from '../../fixtures/execution/execution-attempt-running.json';
import executionAttemptSucceeded from '../../fixtures/execution/execution-attempt-succeeded.json';
import executionAttemptFailed from '../../fixtures/execution/execution-attempt-failed.json';

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn(() => mockDynamoDBDocumentClient),
  },
  PutCommand: jest.fn(),
  GetCommand: jest.fn(),
  UpdateCommand: jest.fn(),
}));

describe('ExecutionAttemptService', () => {
  let service: ExecutionAttemptService;
  let logger: Logger;

  beforeEach(() => {
    resetAllMocks();
    jest.clearAllMocks();
    logger = new Logger('ExecutionAttemptServiceTest');
    service = new ExecutionAttemptService(
      mockDynamoDBDocumentClient as any,
      'test-execution-attempts-table',
      logger
    );
  });

  describe('startAttempt', () => {
    describe('Initial Execution (First Attempt)', () => {
      it('should create ExecutionAttempt with status=RUNNING', async () => {
        mockDynamoDBDocumentClient.send.mockResolvedValue({});

        const attempt = await service.startAttempt(
          'ai_test_123',
          'tenant_test_1',
          'account_test_1',
          'execution_trace_123',
          'idempotency_key_123',
          3600, // 1 hour timeout
          false // allowRerun = false (normal execution path)
        );

        expect(attempt.status).toBe('RUNNING');
        expect(attempt.action_intent_id).toBe('ai_test_123');
        expect(attempt.tenant_id).toBe('tenant_test_1');
        expect(attempt.account_id).toBe('account_test_1');
        expect(attempt.trace_id).toBe('execution_trace_123');
        expect(attempt.idempotency_key).toBe('idempotency_key_123');
        expect(attempt.attempt_count).toBe(1);
        expect(attempt.last_attempt_id).toBeDefined();
        expect(attempt.started_at).toBeDefined();
        expect(attempt.updated_at).toBeDefined();
        expect(attempt.ttl).toBeDefined();
      });

      it('should generate unique attempt_id', async () => {
        mockDynamoDBDocumentClient.send.mockResolvedValue({});

        const attempt1 = await service.startAttempt(
          'ai_test_123',
          'tenant_test_1',
          'account_test_1',
          'execution_trace_123',
          'idempotency_key_123'
        );

        const attempt2 = await service.startAttempt(
          'ai_test_456',
          'tenant_test_1',
          'account_test_1',
          'execution_trace_456',
          'idempotency_key_456'
        );

        expect(attempt1.last_attempt_id).not.toBe(attempt2.last_attempt_id);
      });

      it('should populate GSI attributes', async () => {
        mockDynamoDBDocumentClient.send.mockResolvedValue({});

        const attempt = await service.startAttempt(
          'ai_test_123',
          'tenant_test_1',
          'account_test_1',
          'execution_trace_123',
          'idempotency_key_123'
        );

        expect(attempt.gsi1pk).toBe('ACTION_INTENT#ai_test_123');
        expect(attempt.gsi1sk).toMatch(/^UPDATED_AT#/);
        expect(attempt.gsi2pk).toBe('TENANT#tenant_test_1');
        expect(attempt.gsi2sk).toMatch(/^UPDATED_AT#/);
      });

      it('should set TTL based on stateMachineTimeoutSeconds', async () => {
        mockDynamoDBDocumentClient.send.mockResolvedValue({});

        const timeoutSeconds = 7200; // 2 hours
        const attempt = await service.startAttempt(
          'ai_test_123',
          'tenant_test_1',
          'account_test_1',
          'execution_trace_123',
          'idempotency_key_123',
          timeoutSeconds
        );

        // TTL should be approximately: now + timeoutSeconds + 900 (15 min buffer)
        const expectedTTL = Math.floor(Date.now() / 1000) + timeoutSeconds + 900;
        expect(attempt.ttl).toBeGreaterThanOrEqual(expectedTTL - 5); // Allow 5 second variance
        expect(attempt.ttl).toBeLessThanOrEqual(expectedTTL + 5);
      });

      it('should use default TTL (1 hour) if stateMachineTimeoutSeconds not provided', async () => {
        mockDynamoDBDocumentClient.send.mockResolvedValue({});

        const attempt = await service.startAttempt(
          'ai_test_123',
          'tenant_test_1',
          'account_test_1',
          'execution_trace_123',
          'idempotency_key_123'
        );

        // Default: 3600 seconds (1 hour) + 900 seconds (15 min buffer) = 4500 seconds
        const expectedTTL = Math.floor(Date.now() / 1000) + 4500;
        expect(attempt.ttl).toBeGreaterThanOrEqual(expectedTTL - 5);
        expect(attempt.ttl).toBeLessThanOrEqual(expectedTTL + 5);
      });

      it('should use conditional PutCommand with attribute_not_exists check', async () => {
        mockDynamoDBDocumentClient.send.mockResolvedValue({});

        await service.startAttempt(
          'ai_test_123',
          'tenant_test_1',
          'account_test_1',
          'execution_trace_123',
          'idempotency_key_123'
        );

        expect(PutCommand).toHaveBeenCalled();
        const putCommandCall = (PutCommand as unknown as jest.Mock).mock.calls[0][0];
        expect(putCommandCall.ConditionExpression).toBe('attribute_not_exists(pk) AND attribute_not_exists(sk)');
      });

      it('should throw ExecutionAlreadyInProgressError if attempt already exists with status=RUNNING', async () => {
        // First call succeeds (creates attempt)
        mockDynamoDBDocumentClient.send
          .mockResolvedValueOnce({})
          // Second call fails with ConditionalCheckFailedException
          .mockRejectedValueOnce({
            name: 'ConditionalCheckFailedException',
            message: 'Conditional check failed',
          })
          // GetCommand call returns existing RUNNING attempt
          .mockResolvedValueOnce({
            Item: executionAttemptRunning as ExecutionAttempt,
          });

        // First attempt succeeds
        await service.startAttempt(
          'ai_test_123',
          'tenant_test_1',
          'account_test_1',
          'execution_trace_123',
          'idempotency_key_123'
        );

        // Second attempt should fail
        await expect(
          service.startAttempt(
            'ai_test_123',
            'tenant_test_1',
            'account_test_1',
            'execution_trace_123',
            'idempotency_key_123'
          )
        ).rejects.toThrow('Execution already in progress for action_intent_id: ai_test_123');
      });
    });

    describe('Rerun from Terminal State', () => {
      it('should allow rerun if status is SUCCEEDED and allowRerun=true', async () => {
        // PutCommand fails (attempt exists)
        mockDynamoDBDocumentClient.send
          .mockRejectedValueOnce({
            name: 'ConditionalCheckFailedException',
            message: 'Conditional check failed',
          })
          // GetCommand returns SUCCEEDED attempt
          .mockResolvedValueOnce({
            Item: executionAttemptSucceeded as ExecutionAttempt,
          })
          // UpdateCommand succeeds (rerun allowed)
          .mockResolvedValueOnce({})
          // GetCommand returns updated attempt
          .mockResolvedValueOnce({
            Item: {
              ...executionAttemptSucceeded,
              status: 'RUNNING',
              attempt_count: 2,
            } as ExecutionAttempt,
          });

        const attempt = await service.startAttempt(
          'ai_test_123',
          'tenant_test_1',
          'account_test_1',
          'execution_trace_123',
          'idempotency_key_123',
          3600,
          true // allowRerun = true
        );

        expect(attempt.status).toBe('RUNNING');
        expect(attempt.attempt_count).toBe(2);
        expect(UpdateCommand).toHaveBeenCalled();
      });

      it('should allow rerun if status is FAILED and allowRerun=true', async () => {
        mockDynamoDBDocumentClient.send
          .mockRejectedValueOnce({
            name: 'ConditionalCheckFailedException',
            message: 'Conditional check failed',
          })
          .mockResolvedValueOnce({
            Item: executionAttemptFailed as ExecutionAttempt,
          })
          .mockResolvedValueOnce({})
          .mockResolvedValueOnce({
            Item: {
              ...executionAttemptFailed,
              status: 'RUNNING',
              attempt_count: 2,
            } as ExecutionAttempt,
          });

        const attempt = await service.startAttempt(
          'ai_test_123',
          'tenant_test_1',
          'account_test_1',
          'execution_trace_123',
          'idempotency_key_123',
          3600,
          true
        );

        expect(attempt.status).toBe('RUNNING');
        expect(attempt.attempt_count).toBe(2);
      });

      it('should allow rerun if status is CANCELLED and allowRerun=true', async () => {
        const cancelledAttempt = {
          ...executionAttemptSucceeded,
          status: 'CANCELLED' as const,
        };

        mockDynamoDBDocumentClient.send
          .mockRejectedValueOnce({
            name: 'ConditionalCheckFailedException',
            message: 'Conditional check failed',
          })
          .mockResolvedValueOnce({
            Item: cancelledAttempt as ExecutionAttempt,
          })
          .mockResolvedValueOnce({})
          .mockResolvedValueOnce({
            Item: {
              ...cancelledAttempt,
              status: 'RUNNING',
              attempt_count: 2,
            } as ExecutionAttempt,
          });

        const attempt = await service.startAttempt(
          'ai_test_123',
          'tenant_test_1',
          'account_test_1',
          'execution_trace_123',
          'idempotency_key_123',
          3600,
          true
        );

        expect(attempt.status).toBe('RUNNING');
        expect(attempt.attempt_count).toBe(2);
      });

      it('should increment attempt_count on rerun', async () => {
        mockDynamoDBDocumentClient.send
          .mockRejectedValueOnce({
            name: 'ConditionalCheckFailedException',
            message: 'Conditional check failed',
          })
          .mockResolvedValueOnce({
            Item: {
              ...executionAttemptSucceeded,
              attempt_count: 1,
            } as ExecutionAttempt,
          })
          .mockResolvedValueOnce({})
          .mockResolvedValueOnce({
            Item: {
              ...executionAttemptSucceeded,
              status: 'RUNNING',
              attempt_count: 2,
            } as ExecutionAttempt,
          });

        const attempt = await service.startAttempt(
          'ai_test_123',
          'tenant_test_1',
          'account_test_1',
          'execution_trace_123',
          'idempotency_key_123',
          3600,
          true
        );

        expect(attempt.attempt_count).toBe(2);
      });

      it('should update last_attempt_id on rerun', async () => {
        mockDynamoDBDocumentClient.send
          .mockRejectedValueOnce({
            name: 'ConditionalCheckFailedException',
            message: 'Conditional check failed',
          })
          .mockResolvedValueOnce({
            Item: executionAttemptSucceeded as ExecutionAttempt,
          })
          .mockResolvedValueOnce({})
          .mockResolvedValueOnce({
            Item: {
              ...executionAttemptSucceeded,
              status: 'RUNNING',
              last_attempt_id: 'attempt_new_123',
            } as ExecutionAttempt,
          });

        const attempt = await service.startAttempt(
          'ai_test_123',
          'tenant_test_1',
          'account_test_1',
          'execution_trace_123',
          'idempotency_key_123',
          3600,
          true
        );

        expect(attempt.last_attempt_id).toBe('attempt_new_123');
        expect(attempt.last_attempt_id).not.toBe(executionAttemptSucceeded.last_attempt_id);
      });

      it('should use conditional UpdateCommand with status IN [SUCCEEDED, FAILED, CANCELLED]', async () => {
        mockDynamoDBDocumentClient.send
          .mockRejectedValueOnce({
            name: 'ConditionalCheckFailedException',
            message: 'Conditional check failed',
          })
          .mockResolvedValueOnce({
            Item: executionAttemptSucceeded as ExecutionAttempt,
          })
          .mockResolvedValueOnce({})
          .mockResolvedValueOnce({
            Item: {
              ...executionAttemptSucceeded,
              status: 'RUNNING',
            } as ExecutionAttempt,
          });

        await service.startAttempt(
          'ai_test_123',
          'tenant_test_1',
          'account_test_1',
          'execution_trace_123',
          'idempotency_key_123',
          3600,
          true
        );

        expect(UpdateCommand).toHaveBeenCalled();
        const updateCommandCall = (UpdateCommand as unknown as jest.Mock).mock.calls[0][0];
        expect(updateCommandCall.ConditionExpression).toBe('#status IN (:succeeded, :failed, :cancelled)');
      });

      it('should throw error if allowRerun=false (normal execution path)', async () => {
        mockDynamoDBDocumentClient.send
          .mockRejectedValueOnce({
            name: 'ConditionalCheckFailedException',
            message: 'Conditional check failed',
          })
          .mockResolvedValueOnce({
            Item: executionAttemptSucceeded as ExecutionAttempt,
          });

        await expect(
          service.startAttempt(
            'ai_test_123',
            'tenant_test_1',
            'account_test_1',
            'execution_trace_123',
            'idempotency_key_123',
            3600,
            false // allowRerun = false (normal execution path)
          )
        ).rejects.toThrow('Execution already completed for action_intent_id: ai_test_123');
      });

      it('should clear last_error_class on rerun', async () => {
        mockDynamoDBDocumentClient.send
          .mockRejectedValueOnce({
            name: 'ConditionalCheckFailedException',
            message: 'Conditional check failed',
          })
          .mockResolvedValueOnce({
            Item: executionAttemptFailed as ExecutionAttempt, // Has last_error_class
          })
          .mockResolvedValueOnce({})
          .mockResolvedValueOnce({
            Item: {
              ...executionAttemptFailed,
              status: 'RUNNING',
              last_error_class: undefined, // Cleared on rerun
            } as ExecutionAttempt,
          });

        const attempt = await service.startAttempt(
          'ai_test_123',
          'tenant_test_1',
          'account_test_1',
          'execution_trace_123',
          'idempotency_key_123',
          3600,
          true
        );

        expect(attempt.last_error_class).toBeUndefined();
      });
    });
  });

  describe('updateStatus', () => {
    it('should update status from RUNNING to SUCCEEDED', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({});

      await service.updateStatus(
        'ai_test_123',
        'tenant_test_1',
        'account_test_1',
        'SUCCEEDED'
      );

      expect(UpdateCommand).toHaveBeenCalled();
      const updateCommandCall = (UpdateCommand as unknown as jest.Mock).mock.calls[0][0];
      expect(updateCommandCall.ConditionExpression).toBe('#status = :running');
      expect(updateCommandCall.ExpressionAttributeValues[':status']).toBe('SUCCEEDED');
    });

    it('should update status from RUNNING to FAILED', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({});

      await service.updateStatus(
        'ai_test_123',
        'tenant_test_1',
        'account_test_1',
        'FAILED'
      );

      expect(UpdateCommand).toHaveBeenCalled();
      const updateCommandCall = (UpdateCommand as unknown as jest.Mock).mock.calls[0][0];
      expect(updateCommandCall.ExpressionAttributeValues[':status']).toBe('FAILED');
    });

    it('should update status from RUNNING to CANCELLED', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({});

      await service.updateStatus(
        'ai_test_123',
        'tenant_test_1',
        'account_test_1',
        'CANCELLED'
      );

      expect(UpdateCommand).toHaveBeenCalled();
      const updateCommandCall = (UpdateCommand as unknown as jest.Mock).mock.calls[0][0];
      expect(updateCommandCall.ExpressionAttributeValues[':status']).toBe('CANCELLED');
    });

    it('should populate GSI attributes on update', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({});

      await service.updateStatus(
        'ai_test_123',
        'tenant_test_1',
        'account_test_1',
        'SUCCEEDED'
      );

      expect(UpdateCommand).toHaveBeenCalled();
      const updateCommandCall = (UpdateCommand as unknown as jest.Mock).mock.calls[0][0];
      expect(updateCommandCall.UpdateExpression).toContain('#gsi1pk = :gsi1pk');
      expect(updateCommandCall.UpdateExpression).toContain('#gsi1sk = :gsi1sk');
      expect(updateCommandCall.UpdateExpression).toContain('#gsi2pk = :gsi2pk');
      expect(updateCommandCall.UpdateExpression).toContain('#gsi2sk = :gsi2sk');
    });

    it('should use conditional UpdateCommand (status = RUNNING)', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({});

      await service.updateStatus(
        'ai_test_123',
        'tenant_test_1',
        'account_test_1',
        'SUCCEEDED'
      );

      expect(UpdateCommand).toHaveBeenCalled();
      const updateCommandCall = (UpdateCommand as unknown as jest.Mock).mock.calls[0][0];
      expect(updateCommandCall.ConditionExpression).toBe('#status = :running');
    });

    it('should throw error if current status is not RUNNING', async () => {
      mockDynamoDBDocumentClient.send.mockRejectedValue({
        name: 'ConditionalCheckFailedException',
        message: 'Conditional check failed',
      });

      await expect(
        service.updateStatus(
          'ai_test_123',
          'tenant_test_1',
          'account_test_1',
          'SUCCEEDED'
        )
      ).rejects.toThrow('Cannot update status to SUCCEEDED for action_intent_id: ai_test_123');
    });

    it('should update last_error_class when status=FAILED and errorClass provided', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({});

      await service.updateStatus(
        'ai_test_123',
        'tenant_test_1',
        'account_test_1',
        'FAILED',
        'VALIDATION'
      );

      expect(UpdateCommand).toHaveBeenCalled();
      const updateCommandCall = (UpdateCommand as unknown as jest.Mock).mock.calls[0][0];
      expect(updateCommandCall.UpdateExpression).toContain('#last_error_class = :error_class');
      expect(updateCommandCall.ExpressionAttributeValues[':error_class']).toBe('VALIDATION');
    });

    it('should not update last_error_class when errorClass not provided', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({});

      await service.updateStatus(
        'ai_test_123',
        'tenant_test_1',
        'account_test_1',
        'SUCCEEDED'
      );

      expect(UpdateCommand).toHaveBeenCalled();
      const updateCommandCall = (UpdateCommand as unknown as jest.Mock).mock.calls[0][0];
      expect(updateCommandCall.UpdateExpression).not.toContain('last_error_class');
    });
  });

  describe('getAttempt', () => {
    it('should retrieve ExecutionAttempt by action_intent_id, tenant_id, account_id', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({
        Item: executionAttemptRunning as ExecutionAttempt,
      });

      const attempt = await service.getAttempt(
        'ai_test_123',
        'tenant_test_1',
        'account_test_1'
      );

      expect(attempt).toBeDefined();
      expect(attempt?.action_intent_id).toBe('ai_test_123');
      expect(attempt?.tenant_id).toBe('tenant_test_1');
      expect(attempt?.account_id).toBe('account_test_1');
      expect(GetCommand).toHaveBeenCalled();
    });

    it('should return null if attempt does not exist', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({
        // Item is undefined when not found
      });

      const attempt = await service.getAttempt(
        'ai_test_999',
        'tenant_test_1',
        'account_test_1'
      );

      // Service returns null when Item is undefined (type assertion converts undefined to null)
      expect(attempt).toBeNull();
    });

    it('should use correct DynamoDB key structure', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({
        Item: executionAttemptRunning as ExecutionAttempt,
      });

      await service.getAttempt(
        'ai_test_123',
        'tenant_test_1',
        'account_test_1'
      );

      expect(GetCommand).toHaveBeenCalled();
      const getCommandCall = (GetCommand as unknown as jest.Mock).mock.calls[0][0];
      expect(getCommandCall.Key.pk).toBe('TENANT#tenant_test_1#ACCOUNT#account_test_1');
      expect(getCommandCall.Key.sk).toBe('EXECUTION#ai_test_123');
    });
  });
});
