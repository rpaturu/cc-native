/**
 * ExecutionOutcomeService Unit Tests - Phase 4.2
 */

import { ExecutionOutcomeService } from '../../../services/execution/ExecutionOutcomeService';
import { Logger } from '../../../services/core/Logger';
import { DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { mockDynamoDBDocumentClient, resetAllMocks } from '../../__mocks__/aws-sdk-clients';
import { ActionOutcomeV1 } from '../../../types/ExecutionTypes';
import actionOutcomeSucceeded from '../../fixtures/execution/action-outcome-succeeded.json';
import actionOutcomeFailed from '../../fixtures/execution/action-outcome-failed.json';

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn(() => mockDynamoDBDocumentClient),
  },
  PutCommand: jest.fn(),
  GetCommand: jest.fn(),
  QueryCommand: jest.fn(),
}));

describe('ExecutionOutcomeService', () => {
  let service: ExecutionOutcomeService;
  let logger: Logger;

  beforeEach(() => {
    resetAllMocks();
    jest.clearAllMocks();
    logger = new Logger('ExecutionOutcomeServiceTest');
    service = new ExecutionOutcomeService(
      mockDynamoDBDocumentClient as any,
      'test-execution-outcomes-table',
      logger
    );
  });

  describe('recordOutcome', () => {
    it('should create ActionOutcomeV1 with conditional PutCommand', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({});

      const outcome = await service.recordOutcome({
        action_intent_id: 'ai_test_123',
        status: 'SUCCEEDED',
        external_object_refs: [
          {
            system: 'CRM',
            object_type: 'Task',
            object_id: 'task_12345',
          },
        ],
        attempt_count: 1,
        tool_name: 'crm.create_task',
        tool_schema_version: 'v1.0',
        registry_version: 1,
        tool_run_ref: 'toolrun/trace_123/1/crm.create_task',
        started_at: '2026-01-26T12:00:00.000Z',
        completed_at: '2026-01-26T12:05:00.000Z',
        compensation_status: 'NONE',
        tenant_id: 'tenant_test_1',
        account_id: 'account_test_1',
        trace_id: 'execution_trace_123',
      });

      expect(outcome.status).toBe('SUCCEEDED');
      expect(outcome.action_intent_id).toBe('ai_test_123');
      expect(PutCommand).toHaveBeenCalled();
      const putCommandCall = (PutCommand as unknown as jest.Mock).mock.calls[0][0];
      expect(putCommandCall.ConditionExpression).toBe('attribute_not_exists(pk) AND attribute_not_exists(sk)');
    });

    it('should populate GSI attributes', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({});

      const outcome = await service.recordOutcome({
        action_intent_id: 'ai_test_123',
        status: 'SUCCEEDED',
        external_object_refs: [],
        attempt_count: 1,
        tool_name: 'crm.create_task',
        tool_schema_version: 'v1.0',
        registry_version: 1,
        tool_run_ref: 'toolrun/trace_123/1/crm.create_task',
        started_at: '2026-01-26T12:00:00.000Z',
        completed_at: '2026-01-26T12:05:00.000Z',
        compensation_status: 'NONE',
        tenant_id: 'tenant_test_1',
        account_id: 'account_test_1',
        trace_id: 'execution_trace_123',
      });

      expect(outcome.gsi1pk).toBe('ACTION_INTENT#ai_test_123');
      expect(outcome.gsi1sk).toMatch(/^COMPLETED_AT#/);
      expect(outcome.gsi2pk).toBe('TENANT#tenant_test_1');
      expect(outcome.gsi2sk).toMatch(/^COMPLETED_AT#/);
    });

    it('should prevent overwrites (write-once immutability)', async () => {
      // PutCommand fails with ConditionalCheckFailedException
      mockDynamoDBDocumentClient.send
        .mockRejectedValueOnce({
          name: 'ConditionalCheckFailedException',
          message: 'Conditional check failed',
        })
        .mockResolvedValueOnce({
          Item: actionOutcomeSucceeded as ActionOutcomeV1,
        }); // getOutcome returns existing

      const outcome = await service.recordOutcome({
        action_intent_id: 'ai_test_123',
        status: 'SUCCEEDED',
        external_object_refs: [],
        attempt_count: 1,
        tool_name: 'crm.create_task',
        tool_schema_version: 'v1.0',
        registry_version: 1,
        tool_run_ref: 'toolrun/trace_123/1/crm.create_task',
        started_at: '2026-01-26T12:00:00.000Z',
        completed_at: '2026-01-26T12:05:00.000Z',
        compensation_status: 'NONE',
        tenant_id: 'tenant_test_1',
        account_id: 'account_test_1',
        trace_id: 'execution_trace_123',
      });

      // Should return existing outcome (idempotent)
      expect(outcome.action_intent_id).toBe('ai_test_123');
      expect(outcome.status).toBe('SUCCEEDED');
    });

    it('should store external_object_refs array', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({});

      const externalRefs = [
        {
          system: 'CRM' as const,
          object_type: 'Task',
          object_id: 'task_12345',
          object_url: 'https://salesforce.com/task/12345',
        },
      ];

      const outcome = await service.recordOutcome({
        action_intent_id: 'ai_test_123',
        status: 'SUCCEEDED',
        external_object_refs: externalRefs,
        attempt_count: 1,
        tool_name: 'crm.create_task',
        tool_schema_version: 'v1.0',
        registry_version: 1,
        tool_run_ref: 'toolrun/trace_123/1/crm.create_task',
        started_at: '2026-01-26T12:00:00.000Z',
        completed_at: '2026-01-26T12:05:00.000Z',
        compensation_status: 'NONE',
        tenant_id: 'tenant_test_1',
        account_id: 'account_test_1',
        trace_id: 'execution_trace_123',
      });

      expect(outcome.external_object_refs).toEqual(externalRefs);
    });

    it('should store error classification', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({});

      const outcome = await service.recordOutcome({
        action_intent_id: 'ai_test_123',
        status: 'FAILED',
        external_object_refs: [],
        error_code: 'AUTH_FAILED',
        error_class: 'AUTH',
        error_message: 'Authentication failed',
        attempt_count: 1,
        tool_name: 'crm.create_task',
        tool_schema_version: 'v1.0',
        registry_version: 1,
        tool_run_ref: 'toolrun/trace_123/1/crm.create_task',
        started_at: '2026-01-26T12:00:00.000Z',
        completed_at: '2026-01-26T12:05:00.000Z',
        compensation_status: 'NONE',
        tenant_id: 'tenant_test_1',
        account_id: 'account_test_1',
        trace_id: 'execution_trace_123',
      });

      expect(outcome.error_code).toBe('AUTH_FAILED');
      expect(outcome.error_class).toBe('AUTH');
      expect(outcome.error_message).toBe('Authentication failed');
    });

    it('should store registry_version for audit', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({});

      const outcome = await service.recordOutcome({
        action_intent_id: 'ai_test_123',
        status: 'SUCCEEDED',
        external_object_refs: [],
        attempt_count: 1,
        tool_name: 'crm.create_task',
        tool_schema_version: 'v1.0',
        registry_version: 2, // Registry version 2
        tool_run_ref: 'toolrun/trace_123/1/crm.create_task',
        started_at: '2026-01-26T12:00:00.000Z',
        completed_at: '2026-01-26T12:05:00.000Z',
        compensation_status: 'NONE',
        tenant_id: 'tenant_test_1',
        account_id: 'account_test_1',
        trace_id: 'execution_trace_123',
      });

      expect(outcome.registry_version).toBe(2);
    });

    it('should set TTL to completed_at + 90 days', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({});

      const completedAt = '2026-01-26T12:05:00.000Z';
      const outcome = await service.recordOutcome({
        action_intent_id: 'ai_test_123',
        status: 'SUCCEEDED',
        external_object_refs: [],
        attempt_count: 1,
        tool_name: 'crm.create_task',
        tool_schema_version: 'v1.0',
        registry_version: 1,
        tool_run_ref: 'toolrun/trace_123/1/crm.create_task',
        started_at: '2026-01-26T12:00:00.000Z',
        completed_at: completedAt,
        compensation_status: 'NONE',
        tenant_id: 'tenant_test_1',
        account_id: 'account_test_1',
        trace_id: 'execution_trace_123',
      });

      // TTL should be: completed_at timestamp + 90 days (7776000 seconds)
      const completedTimestamp = Math.floor(new Date(completedAt).getTime() / 1000);
      const expectedTTL = completedTimestamp + 7776000;
      expect(outcome.ttl).toBe(expectedTTL);
    });
  });

  describe('getOutcome', () => {
    it('should retrieve ActionOutcomeV1 by action_intent_id, tenant_id, account_id', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({
        Item: actionOutcomeSucceeded as ActionOutcomeV1,
      });

      const outcome = await service.getOutcome(
        'ai_test_123',
        'tenant_test_1',
        'account_test_1'
      );

      expect(outcome).toBeDefined();
      expect(outcome?.action_intent_id).toBe('ai_test_123');
      expect(outcome?.status).toBe('SUCCEEDED');
      expect(GetCommand).toHaveBeenCalled();
    });

    it('should return null if outcome does not exist', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({
        Item: undefined,
      });

      const outcome = await service.getOutcome(
        'ai_test_999',
        'tenant_test_1',
        'account_test_1'
      );

      expect(outcome).toBeNull();
    });

    it('should use correct DynamoDB key structure', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({
        Item: actionOutcomeSucceeded as ActionOutcomeV1,
      });

      await service.getOutcome(
        'ai_test_123',
        'tenant_test_1',
        'account_test_1'
      );

      expect(GetCommand).toHaveBeenCalled();
      const getCommandCall = (GetCommand as unknown as jest.Mock).mock.calls[0][0];
      expect(getCommandCall.Key.pk).toBe('TENANT#tenant_test_1#ACCOUNT#account_test_1');
      expect(getCommandCall.Key.sk).toBe('OUTCOME#ai_test_123');
    });
  });

  describe('listOutcomes', () => {
    it('should query outcomes by pk (tenant + account)', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({
        Items: [actionOutcomeSucceeded, actionOutcomeFailed] as ActionOutcomeV1[],
      });

      const outcomes = await service.listOutcomes('tenant_test_1', 'account_test_1', 50);

      expect(outcomes).toHaveLength(2);
      expect(QueryCommand).toHaveBeenCalled();
      const queryCommandCall = (QueryCommand as unknown as jest.Mock).mock.calls[0][0];
      expect(queryCommandCall.KeyConditionExpression).toBe('pk = :pk');
      expect(queryCommandCall.ExpressionAttributeValues[':pk']).toBe('TENANT#tenant_test_1#ACCOUNT#account_test_1');
    });

    it('should respect limit parameter', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({
        Items: [actionOutcomeSucceeded] as ActionOutcomeV1[],
      });

      await service.listOutcomes('tenant_test_1', 'account_test_1', 10);

      const queryCommandCall = (QueryCommand as unknown as jest.Mock).mock.calls[0][0];
      expect(queryCommandCall.Limit).toBe(10);
    });

    it('should use default limit of 50', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({
        Items: [],
      });

      await service.listOutcomes('tenant_test_1', 'account_test_1');

      const queryCommandCall = (QueryCommand as unknown as jest.Mock).mock.calls[0][0];
      expect(queryCommandCall.Limit).toBe(50);
    });

    it('should return empty array if no outcomes found', async () => {
      mockDynamoDBDocumentClient.send.mockResolvedValue({
        Items: [],
      });

      const outcomes = await service.listOutcomes('tenant_test_1', 'account_test_1');

      expect(outcomes).toEqual([]);
    });
  });
});
