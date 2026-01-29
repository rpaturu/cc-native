/**
 * ExecutionStarterHandler Unit Tests - Phase 4.1
 * 
 * Tests handler validation, event processing, and integration with services.
 */

// Set environment variables BEFORE importing handler (handler runs requireEnv at module load)
process.env.AWS_REGION = 'us-west-2';
process.env.EXECUTION_ATTEMPTS_TABLE_NAME = 'test-execution-attempts';
process.env.ACTION_INTENT_TABLE_NAME = 'test-action-intent';
process.env.ACTION_TYPE_REGISTRY_TABLE_NAME = 'test-action-type-registry';
process.env.LEDGER_TABLE_NAME = 'test-ledger';
process.env.STATE_MACHINE_TIMEOUT_HOURS = '1';

import { Handler } from 'aws-lambda';
import { createHandler } from '../../../../handlers/phase4/execution-starter-handler';
import { ExecutionAttemptService } from '../../../../services/execution/ExecutionAttemptService';
import { ActionIntentService } from '../../../../services/decision/ActionIntentService';
import { ActionTypeRegistryService } from '../../../../services/execution/ActionTypeRegistryService';
import { IdempotencyService } from '../../../../services/execution/IdempotencyService';
import { LedgerService } from '../../../../services/ledger/LedgerService';
import { TraceService } from '../../../../services/core/TraceService';
import { Logger } from '../../../../services/core/Logger';
import {
  IntentNotFoundError,
  ValidationError,
  ExecutionAlreadyInProgressError,
  UnknownExecutionError,
} from '../../../../types/ExecutionErrors';
import { ActionIntentV1 } from '../../../../types/DecisionTypes';
import actionIntent from '../../../fixtures/execution/action-intent.json';
import actionTypeRegistryV1 from '../../../fixtures/execution/action-type-registry-v1.json';

// Helper to create complete ActionIntentV1 from fixture
function createActionIntentV1(overrides?: Partial<ActionIntentV1>): ActionIntentV1 {
  return {
    action_intent_id: 'ai_test_123',
    action_type: 'CREATE_INTERNAL_TASK', // Use valid ActionTypeV1
    target: {
      entity_type: 'ACCOUNT',
      entity_id: 'account_test_1',
    },
    parameters: {
      title: 'Test Task',
      priority: 'HIGH',
    },
    approved_by: 'user_test_1',
    approval_timestamp: new Date().toISOString(),
    execution_policy: {
      retry_count: 3,
      timeout_seconds: 3600,
      max_attempts: 1,
    },
    expires_at: new Date(Date.now() + 3600000).toISOString(),
    expires_at_epoch: Math.floor(Date.now() / 1000) + 3600,
    original_decision_id: 'dec_test_123',
    original_proposal_id: 'dec_test_123',
    edited_fields: [],
    tenant_id: 'tenant_test_1',
    account_id: 'account_test_1',
    registry_version: 1,
    trace_id: 'decision_trace_123',
    ...overrides,
  } as ActionIntentV1;
}

// Mock services
jest.mock('../../../../services/core/Logger');
jest.mock('../../../../services/core/TraceService', () => ({
  TraceService: jest.fn().mockImplementation(() => ({
    generateTraceId: jest.fn(() => 'execution_trace_123'),
  })),
}));


describe('ExecutionStarterHandler', () => {
  let mockExecutionAttemptService: jest.Mocked<ExecutionAttemptService>;
  let mockActionIntentService: jest.Mocked<ActionIntentService>;
  let mockActionTypeRegistryService: jest.Mocked<ActionTypeRegistryService>;
  let mockIdempotencyService: jest.Mocked<IdempotencyService>;
  let mockLedgerService: jest.Mocked<LedgerService>;
  let mockTraceService: jest.Mocked<TraceService>;
  let mockLogger: jest.Mocked<Logger>;
  let handler: Handler;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock services
    mockExecutionAttemptService = {
      startAttempt: jest.fn(),
    } as any;

    mockActionIntentService = {
      getIntent: jest.fn(),
    } as any;

    mockActionTypeRegistryService = {
      getToolMapping: jest.fn(),
      mapParametersToToolArguments: jest.fn(),
    } as any;

    mockIdempotencyService = {
      generateIdempotencyKey: jest.fn(),
    } as any;

    mockLedgerService = {
      append: jest.fn(),
    } as any;

    mockTraceService = {
      generateTraceId: jest.fn(() => 'execution_trace_123'),
    } as any;

    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as any;

    // Create handler with injected dependencies
    handler = createHandler(
      mockExecutionAttemptService,
      mockActionIntentService,
      mockActionTypeRegistryService,
      mockIdempotencyService,
      mockLedgerService,
      mockTraceService,
      mockLogger,
      1 // stateMachineTimeoutHours
    );
  });

  describe('Event Validation', () => {
    it('should validate Step Functions input with required fields', async () => {
      const validEvent = {
        action_intent_id: 'ai_test_123',
        tenant_id: 'tenant_test_1',
        account_id: 'account_test_1',
      };

      const intent = createActionIntentV1();
      mockActionIntentService.getIntent.mockResolvedValue(intent);
      mockActionTypeRegistryService.getToolMapping.mockResolvedValue(actionTypeRegistryV1 as any);
      mockActionTypeRegistryService.mapParametersToToolArguments.mockReturnValue({ title: 'Test Task' });
      mockIdempotencyService.generateIdempotencyKey.mockReturnValue('idempotency_key_123');
      mockExecutionAttemptService.startAttempt.mockResolvedValue({
        action_intent_id: 'ai_test_123',
        tenant_id: 'tenant_test_1',
        account_id: 'account_test_1',
        trace_id: 'execution_trace_123',
        idempotency_key: 'idempotency_key_123',
        status: 'RUNNING',
        attempt_count: 1,
        last_attempt_id: 'attempt_123',
        started_at: Date.now(),
        updated_at: Date.now(),
        ttl: Date.now() + 3600,
      } as any);
      mockLedgerService.append.mockResolvedValue({
        entryId: 'entry_123',
        timestamp: new Date().toISOString(),
        eventType: 'EXECUTION_STARTED',
        tenantId: 'tenant_test_1',
        accountId: 'account_test_1',
        traceId: 'execution_trace_123',
        data: {},
      } as any);

      const result = await handler(validEvent, {} as any, jest.fn());

      expect(result).toHaveProperty('action_intent_id', 'ai_test_123');
      expect(result).toHaveProperty('idempotency_key', 'idempotency_key_123');
      expect(result).toHaveProperty('trace_id', 'execution_trace_123');
    });

    it('should throw error for missing action_intent_id', async () => {
      const invalidEvent = {
        tenant_id: 'tenant_test_1',
        account_id: 'account_test_1',
      };

      await expect(handler(invalidEvent, {} as any, jest.fn())).rejects.toThrow();
      await expect(handler(invalidEvent, {} as any, jest.fn())).rejects.toThrow('Invalid Step Functions input');
    });

    it('should throw error for missing tenant_id', async () => {
      const invalidEvent = {
        action_intent_id: 'ai_test_123',
        account_id: 'account_test_1',
      };

      await expect(handler(invalidEvent, {} as any, jest.fn())).rejects.toThrow();
      await expect(handler(invalidEvent, {} as any, jest.fn())).rejects.toThrow('Invalid Step Functions input');
    });

    it('should throw error for missing account_id', async () => {
      const invalidEvent = {
        action_intent_id: 'ai_test_123',
        tenant_id: 'tenant_test_1',
      };

      await expect(handler(invalidEvent, {} as any, jest.fn())).rejects.toThrow();
      await expect(handler(invalidEvent, {} as any, jest.fn())).rejects.toThrow('Invalid Step Functions input');
    });

    it('should throw error for empty action_intent_id', async () => {
      const invalidEvent = {
        action_intent_id: '',
        tenant_id: 'tenant_test_1',
        account_id: 'account_test_1',
      };

      await expect(handler(invalidEvent, {} as any, jest.fn())).rejects.toThrow();
    });

    it('should reject extra fields (strict validation)', async () => {
      const invalidEvent = {
        action_intent_id: 'ai_test_123',
        tenant_id: 'tenant_test_1',
        account_id: 'account_test_1',
        extra_field: 'should_not_be_here',
      };

      await expect(handler(invalidEvent, {} as any, jest.fn())).rejects.toThrow();
    });

    it('should throw for null event', async () => {
      await expect(handler(null as any, {} as any, jest.fn())).rejects.toThrow();
      await expect(handler(null as any, {} as any, jest.fn())).rejects.toThrow('Invalid Step Functions input');
    });

    it('should throw for non-object event', async () => {
      await expect(handler('invalid' as any, {} as any, jest.fn())).rejects.toThrow();
      await expect(handler(123 as any, {} as any, jest.fn())).rejects.toThrow();
    });
  });

  describe('Handler Processing', () => {
    const validEvent = {
      action_intent_id: 'ai_test_123',
      tenant_id: 'tenant_test_1',
      account_id: 'account_test_1',
    };

    it('should fetch ActionIntent from ActionIntentService', async () => {
      const intent = createActionIntentV1();
      mockActionIntentService.getIntent.mockResolvedValue(intent);
      mockActionTypeRegistryService.getToolMapping.mockResolvedValue(actionTypeRegistryV1 as any);
      mockActionTypeRegistryService.mapParametersToToolArguments.mockReturnValue({ title: 'Test Task' });
      mockIdempotencyService.generateIdempotencyKey.mockReturnValue('idempotency_key_123');
      mockExecutionAttemptService.startAttempt.mockResolvedValue({
        action_intent_id: 'ai_test_123',
        tenant_id: 'tenant_test_1',
        account_id: 'account_test_1',
        trace_id: 'execution_trace_123',
        idempotency_key: 'idempotency_key_123',
        status: 'RUNNING',
        attempt_count: 1,
        last_attempt_id: 'attempt_123',
        started_at: Date.now(),
        updated_at: Date.now(),
        ttl: Date.now() + 3600,
      } as any);
      mockLedgerService.append.mockResolvedValue({
        entryId: 'entry_123',
        timestamp: new Date().toISOString(),
        eventType: 'EXECUTION_STARTED',
        tenantId: 'tenant_test_1',
        accountId: 'account_test_1',
        traceId: 'execution_trace_123',
        data: {},
      } as any);

      await handler(validEvent, {} as any, jest.fn());

      expect(mockActionIntentService.getIntent).toHaveBeenCalledWith(
        'ai_test_123',
        'tenant_test_1',
        'account_test_1'
      );
    });

    it('should get tool mapping from ActionTypeRegistryService', async () => {
      const intent = createActionIntentV1();
      mockActionIntentService.getIntent.mockResolvedValue(intent);
      mockActionTypeRegistryService.getToolMapping.mockResolvedValue(actionTypeRegistryV1 as any);
      mockActionTypeRegistryService.mapParametersToToolArguments.mockReturnValue({ title: 'Test Task' });
      mockIdempotencyService.generateIdempotencyKey.mockReturnValue('idempotency_key_123');
      mockExecutionAttemptService.startAttempt.mockResolvedValue({
        action_intent_id: 'ai_test_123',
        tenant_id: 'tenant_test_1',
        account_id: 'account_test_1',
        trace_id: 'execution_trace_123',
        idempotency_key: 'idempotency_key_123',
        status: 'RUNNING',
        attempt_count: 1,
        last_attempt_id: 'attempt_123',
        started_at: Date.now(),
        updated_at: Date.now(),
        ttl: Date.now() + 3600,
      } as any);
      mockLedgerService.append.mockResolvedValue({
        entryId: 'entry_123',
        timestamp: new Date().toISOString(),
        eventType: 'EXECUTION_STARTED',
        tenantId: 'tenant_test_1',
        accountId: 'account_test_1',
        traceId: 'execution_trace_123',
        data: {},
      } as any);

      await handler(validEvent, {} as any, jest.fn());

      expect(mockActionTypeRegistryService.getToolMapping).toHaveBeenCalledWith(
        'CREATE_INTERNAL_TASK',
        1 // registry_version from intent
      );
    });

    it('should generate idempotency key using IdempotencyService', async () => {
      const intent = createActionIntentV1();
      mockActionIntentService.getIntent.mockResolvedValue(intent);
      mockActionTypeRegistryService.getToolMapping.mockResolvedValue(actionTypeRegistryV1 as any);
      mockActionTypeRegistryService.mapParametersToToolArguments.mockReturnValue({ title: 'Test Task' });
      mockIdempotencyService.generateIdempotencyKey.mockReturnValue('idempotency_key_123');
      mockExecutionAttemptService.startAttempt.mockResolvedValue({
        action_intent_id: 'ai_test_123',
        tenant_id: 'tenant_test_1',
        account_id: 'account_test_1',
        trace_id: 'execution_trace_123',
        idempotency_key: 'idempotency_key_123',
        status: 'RUNNING',
        attempt_count: 1,
        last_attempt_id: 'attempt_123',
        started_at: Date.now(),
        updated_at: Date.now(),
        ttl: Date.now() + 3600,
      } as any);
      mockLedgerService.append.mockResolvedValue({
        entryId: 'entry_123',
        timestamp: new Date().toISOString(),
        eventType: 'EXECUTION_STARTED',
        tenantId: 'tenant_test_1',
        accountId: 'account_test_1',
        traceId: 'execution_trace_123',
        data: {},
      } as any);

      await handler(validEvent, {} as any, jest.fn());

      expect(mockIdempotencyService.generateIdempotencyKey).toHaveBeenCalledWith(
        'tenant_test_1',
        'ai_test_123',
        expect.any(String), // tool_name from registry (varies by action type)
        { title: 'Test Task' }, // normalized params
        1 // registry_version
      );
    });

    it('should start execution attempt with ExecutionAttemptService', async () => {
      const intent = createActionIntentV1();
      mockActionIntentService.getIntent.mockResolvedValue(intent);
      mockActionTypeRegistryService.getToolMapping.mockResolvedValue(actionTypeRegistryV1 as any);
      mockActionTypeRegistryService.mapParametersToToolArguments.mockReturnValue({ title: 'Test Task' });
      mockIdempotencyService.generateIdempotencyKey.mockReturnValue('idempotency_key_123');
      mockExecutionAttemptService.startAttempt.mockResolvedValue({
        action_intent_id: 'ai_test_123',
        tenant_id: 'tenant_test_1',
        account_id: 'account_test_1',
        trace_id: 'execution_trace_123',
        idempotency_key: 'idempotency_key_123',
        status: 'RUNNING',
        attempt_count: 1,
        last_attempt_id: 'attempt_123',
        started_at: Date.now(),
        updated_at: Date.now(),
        ttl: Date.now() + 3600,
      } as any);
      mockLedgerService.append.mockResolvedValue({
        entryId: 'entry_123',
        timestamp: new Date().toISOString(),
        eventType: 'EXECUTION_STARTED',
        tenantId: 'tenant_test_1',
        accountId: 'account_test_1',
        traceId: 'execution_trace_123',
        data: {},
      } as any);

      await handler(validEvent, {} as any, jest.fn());

      expect(mockExecutionAttemptService.startAttempt).toHaveBeenCalledWith(
        'ai_test_123',
        'tenant_test_1',
        'account_test_1',
        'execution_trace_123', // execution trace (not decision trace)
        'idempotency_key_123',
        3600, // timeout in seconds (1 hour)
        false // allowRerun = false
      );
    });

    it('should emit ledger event for execution started', async () => {
      const intent = createActionIntentV1();
      mockActionIntentService.getIntent.mockResolvedValue(intent);
      mockActionTypeRegistryService.getToolMapping.mockResolvedValue(actionTypeRegistryV1 as any);
      mockActionTypeRegistryService.mapParametersToToolArguments.mockReturnValue({ title: 'Test Task' });
      mockIdempotencyService.generateIdempotencyKey.mockReturnValue('idempotency_key_123');
      mockExecutionAttemptService.startAttempt.mockResolvedValue({
        action_intent_id: 'ai_test_123',
        tenant_id: 'tenant_test_1',
        account_id: 'account_test_1',
        trace_id: 'execution_trace_123',
        idempotency_key: 'idempotency_key_123',
        status: 'RUNNING',
        attempt_count: 1,
        last_attempt_id: 'attempt_123',
        started_at: Date.now(),
        updated_at: Date.now(),
        ttl: Date.now() + 3600,
      } as any);
      mockLedgerService.append.mockResolvedValue({
        entryId: 'entry_123',
        timestamp: new Date().toISOString(),
        eventType: 'EXECUTION_STARTED',
        tenantId: 'tenant_test_1',
        accountId: 'account_test_1',
        traceId: 'execution_trace_123',
        data: {},
      } as any);

      await handler(validEvent, {} as any, jest.fn());

      expect(mockLedgerService.append).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'EXECUTION_STARTED',
          tenantId: 'tenant_test_1',
          accountId: 'account_test_1',
          traceId: 'execution_trace_123',
          data: expect.objectContaining({
            action_intent_id: 'ai_test_123',
            attempt_id: 'attempt_123',
            attempt_count: 1,
            idempotency_key: 'idempotency_key_123',
            registry_version: 1,
            decision_trace_id: 'decision_trace_123',
          }),
        })
      );
    });

    it('should return correct output format for Step Functions', async () => {
      const intent = createActionIntentV1();
      mockActionIntentService.getIntent.mockResolvedValue(intent);
      mockActionTypeRegistryService.getToolMapping.mockResolvedValue(actionTypeRegistryV1 as any);
      mockActionTypeRegistryService.mapParametersToToolArguments.mockReturnValue({ title: 'Test Task' });
      mockIdempotencyService.generateIdempotencyKey.mockReturnValue('idempotency_key_123');
      mockExecutionAttemptService.startAttempt.mockResolvedValue({
        action_intent_id: 'ai_test_123',
        tenant_id: 'tenant_test_1',
        account_id: 'account_test_1',
        trace_id: 'execution_trace_123',
        idempotency_key: 'idempotency_key_123',
        status: 'RUNNING',
        attempt_count: 1,
        last_attempt_id: 'attempt_123',
        started_at: Date.now(),
        updated_at: Date.now(),
        ttl: Date.now() + 3600,
      } as any);
      mockLedgerService.append.mockResolvedValue({
        entryId: 'entry_123',
        timestamp: new Date().toISOString(),
        eventType: 'EXECUTION_STARTED',
        tenantId: 'tenant_test_1',
        accountId: 'account_test_1',
        traceId: 'execution_trace_123',
        data: {},
      } as any);

      const result = await handler(validEvent, {} as any, jest.fn());

      expect(result).toEqual({
        action_intent_id: 'ai_test_123',
        idempotency_key: 'idempotency_key_123',
        tenant_id: 'tenant_test_1',
        account_id: 'account_test_1',
        trace_id: 'execution_trace_123',
        registry_version: 1,
      });
    });
  });

  describe('Error Handling', () => {
    const validEvent = {
      action_intent_id: 'ai_test_123',
      tenant_id: 'tenant_test_1',
      account_id: 'account_test_1',
    };

    it('should throw IntentNotFoundError when intent not found', async () => {
      mockActionIntentService.getIntent.mockResolvedValue(null);

      await expect(handler(validEvent, {} as any, jest.fn())).rejects.toThrow(IntentNotFoundError);
      await expect(handler(validEvent, {} as any, jest.fn())).rejects.toThrow('ai_test_123');
    });

    it('should throw ValidationError when registry_version missing', async () => {
      const intentWithoutRegistryVersion = createActionIntentV1({
        registry_version: undefined,
      });
      mockActionIntentService.getIntent.mockResolvedValue(intentWithoutRegistryVersion);

      await expect(handler(validEvent, {} as any, jest.fn())).rejects.toThrow(ValidationError);
      await expect(handler(validEvent, {} as any, jest.fn())).rejects.toThrow('registry_version');
    });

    it('should throw ValidationError when tool mapping not found', async () => {
      const intent = createActionIntentV1();
      mockActionIntentService.getIntent.mockResolvedValue(intent);
      mockActionTypeRegistryService.getToolMapping.mockResolvedValue(null);

      await expect(handler(validEvent, {} as any, jest.fn())).rejects.toThrow(ValidationError);
      await expect(handler(validEvent, {} as any, jest.fn())).rejects.toThrow('Tool mapping not found');
    });

    it('should throw ExecutionAlreadyInProgressError when attempt already exists', async () => {
      const intent = createActionIntentV1();
      mockActionIntentService.getIntent.mockResolvedValue(intent);
      mockActionTypeRegistryService.getToolMapping.mockResolvedValue(actionTypeRegistryV1 as any);
      mockActionTypeRegistryService.mapParametersToToolArguments.mockReturnValue({ title: 'Test Task' });
      mockIdempotencyService.generateIdempotencyKey.mockReturnValue('idempotency_key_123');
      mockExecutionAttemptService.startAttempt.mockRejectedValue(
        new Error('Execution attempt already in progress')
      );

      await expect(handler(validEvent, {} as any, jest.fn())).rejects.toThrow(ExecutionAlreadyInProgressError);
    });

    it('should throw UnknownExecutionError for unexpected errors', async () => {
      const intent = createActionIntentV1();
      mockActionIntentService.getIntent.mockResolvedValue(intent);
      mockActionTypeRegistryService.getToolMapping.mockResolvedValue(actionTypeRegistryV1 as any);
      mockActionTypeRegistryService.mapParametersToToolArguments.mockReturnValue({ title: 'Test Task' });
      mockIdempotencyService.generateIdempotencyKey.mockReturnValue('idempotency_key_123');
      mockExecutionAttemptService.startAttempt.mockRejectedValue(new Error('Unexpected database error'));

      await expect(handler(validEvent, {} as any, jest.fn())).rejects.toThrow(UnknownExecutionError);
    });

    it('should preserve ExecutionError subclasses', async () => {
      const intent = createActionIntentV1();
      mockActionIntentService.getIntent.mockResolvedValue(intent);
      mockActionTypeRegistryService.getToolMapping.mockResolvedValue(actionTypeRegistryV1 as any);
      mockActionTypeRegistryService.mapParametersToToolArguments.mockReturnValue({ title: 'Test Task' });
      mockIdempotencyService.generateIdempotencyKey.mockReturnValue('idempotency_key_123');
      
      const customError = new ValidationError('Custom validation error', 'CUSTOM_ERROR');
      mockExecutionAttemptService.startAttempt.mockRejectedValue(customError);

      await expect(handler(validEvent, {} as any, jest.fn())).rejects.toThrow(ValidationError);
      await expect(handler(validEvent, {} as any, jest.fn())).rejects.toThrow('Custom validation error');
    });
  });

  describe('Integration with Services', () => {
    const validEvent = {
      action_intent_id: 'ai_test_123',
      tenant_id: 'tenant_test_1',
      account_id: 'account_test_1',
    };

    it('should use execution trace (not decision trace) for execution lifecycle', async () => {
      const intent = createActionIntentV1();
      mockActionIntentService.getIntent.mockResolvedValue(intent);
      mockActionTypeRegistryService.getToolMapping.mockResolvedValue(actionTypeRegistryV1 as any);
      mockActionTypeRegistryService.mapParametersToToolArguments.mockReturnValue({ title: 'Test Task' });
      mockIdempotencyService.generateIdempotencyKey.mockReturnValue('idempotency_key_123');
      mockExecutionAttemptService.startAttempt.mockResolvedValue({
        action_intent_id: 'ai_test_123',
        tenant_id: 'tenant_test_1',
        account_id: 'account_test_1',
        trace_id: 'execution_trace_123',
        idempotency_key: 'idempotency_key_123',
        status: 'RUNNING',
        attempt_count: 1,
        last_attempt_id: 'attempt_123',
        started_at: Date.now(),
        updated_at: Date.now(),
        ttl: Date.now() + 3600,
      } as any);
      mockLedgerService.append.mockResolvedValue({
        entryId: 'entry_123',
        timestamp: new Date().toISOString(),
        eventType: 'EXECUTION_STARTED',
        tenantId: 'tenant_test_1',
        accountId: 'account_test_1',
        traceId: 'execution_trace_123',
        data: {},
      } as any);

      const result = await handler(validEvent, {} as any, jest.fn());

      // Verify execution trace is used (not decision trace from intent)
      expect(result.trace_id).toBe('execution_trace_123');
      expect(mockExecutionAttemptService.startAttempt).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        'execution_trace_123', // execution trace
        expect.anything(),
        expect.anything(),
        expect.anything()
      );
    });

    it('should preserve decision trace in ledger event', async () => {
      const intent = createActionIntentV1();
      mockActionIntentService.getIntent.mockResolvedValue(intent);
      mockActionTypeRegistryService.getToolMapping.mockResolvedValue(actionTypeRegistryV1 as any);
      mockActionTypeRegistryService.mapParametersToToolArguments.mockReturnValue({ title: 'Test Task' });
      mockIdempotencyService.generateIdempotencyKey.mockReturnValue('idempotency_key_123');
      mockExecutionAttemptService.startAttempt.mockResolvedValue({
        action_intent_id: 'ai_test_123',
        tenant_id: 'tenant_test_1',
        account_id: 'account_test_1',
        trace_id: 'execution_trace_123',
        idempotency_key: 'idempotency_key_123',
        status: 'RUNNING',
        attempt_count: 1,
        last_attempt_id: 'attempt_123',
        started_at: Date.now(),
        updated_at: Date.now(),
        ttl: Date.now() + 3600,
      } as any);
      mockLedgerService.append.mockResolvedValue({
        entryId: 'entry_123',
        timestamp: new Date().toISOString(),
        eventType: 'EXECUTION_STARTED',
        tenantId: 'tenant_test_1',
        accountId: 'account_test_1',
        traceId: 'execution_trace_123',
        data: {},
      } as any);

      await handler(validEvent, {} as any, jest.fn());

      expect(mockLedgerService.append).toHaveBeenCalledWith(
        expect.objectContaining({
          traceId: 'execution_trace_123', // execution trace for event
          data: expect.objectContaining({
            decision_trace_id: 'decision_trace_123', // decision trace preserved for correlation
          }),
        })
      );
    });
  });
});
