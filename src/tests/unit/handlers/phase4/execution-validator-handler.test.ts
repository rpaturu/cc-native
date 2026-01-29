/**
 * ExecutionValidatorHandler Unit Tests - Phase 4.1
 * 
 * Tests handler validation, preflight checks, and integration with services.
 */

// Set environment variables BEFORE importing handler (handler runs requireEnv at module load)
process.env.AWS_REGION = 'us-west-2';
process.env.ACTION_INTENT_TABLE_NAME = 'test-action-intent';
process.env.TENANTS_TABLE_NAME = 'test-tenants';

import { Handler } from 'aws-lambda';
import { createHandler } from '../../../../handlers/phase4/execution-validator-handler';
import { ActionIntentService } from '../../../../services/decision/ActionIntentService';
import { KillSwitchService } from '../../../../services/execution/KillSwitchService';
import { TraceService } from '../../../../services/core/TraceService';
import { Logger } from '../../../../services/core/Logger';
import {
  IntentNotFoundError,
  IntentExpiredError,
  KillSwitchEnabledError,
  ValidationError,
} from '../../../../types/ExecutionErrors';
import { ActionIntentV1 } from '../../../../types/DecisionTypes';

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
    generateTraceId: jest.fn(() => 'validation_trace_123'),
  })),
}));


describe('ExecutionValidatorHandler', () => {
  let mockActionIntentService: jest.Mocked<ActionIntentService>;
  let mockKillSwitchService: jest.Mocked<KillSwitchService>;
  let mockTraceService: jest.Mocked<TraceService>;
  let mockLogger: jest.Mocked<Logger>;
  let handler: Handler;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock services
    mockActionIntentService = {
      getIntent: jest.fn(),
    } as any;

    mockKillSwitchService = {
      isExecutionEnabled: jest.fn(),
    } as any;

    mockTraceService = {
      generateTraceId: jest.fn(() => 'validation_trace_123'),
    } as any;

    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as any;

    // Create handler with injected dependencies
    handler = createHandler(
      mockActionIntentService,
      mockKillSwitchService,
      mockTraceService,
      mockLogger
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
      // Set expires_at_epoch to future
      intent.expires_at_epoch = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
      mockActionIntentService.getIntent.mockResolvedValue(intent);
      mockKillSwitchService.isExecutionEnabled.mockResolvedValue(true);

      const result = await handler(validEvent, {} as any, jest.fn());

      expect(result).toHaveProperty('valid', true);
      expect(result).toHaveProperty('action_intent');
    });

    it('should throw error for missing action_intent_id', async () => {
      const invalidEvent = {
        tenant_id: 'tenant_test_1',
        account_id: 'account_test_1',
      };

      await expect(handler(invalidEvent, {} as any, jest.fn())).rejects.toThrow(ValidationError);
      await expect(handler(invalidEvent, {} as any, jest.fn())).rejects.toThrow('Invalid Step Functions input');
    });

    it('should throw error for missing tenant_id', async () => {
      const invalidEvent = {
        action_intent_id: 'ai_test_123',
        account_id: 'account_test_1',
      };

      await expect(handler(invalidEvent, {} as any, jest.fn())).rejects.toThrow(ValidationError);
    });

    it('should throw error for missing account_id', async () => {
      const invalidEvent = {
        action_intent_id: 'ai_test_123',
        tenant_id: 'tenant_test_1',
      };

      await expect(handler(invalidEvent, {} as any, jest.fn())).rejects.toThrow(ValidationError);
    });

    it('should throw error for empty action_intent_id', async () => {
      const invalidEvent = {
        action_intent_id: '',
        tenant_id: 'tenant_test_1',
        account_id: 'account_test_1',
      };

      await expect(handler(invalidEvent, {} as any, jest.fn())).rejects.toThrow(ValidationError);
    });

    it('should reject extra fields (strict validation)', async () => {
      const invalidEvent = {
        action_intent_id: 'ai_test_123',
        tenant_id: 'tenant_test_1',
        account_id: 'account_test_1',
        extra_field: 'should_not_be_here',
      };

      await expect(handler(invalidEvent, {} as any, jest.fn())).rejects.toThrow(ValidationError);
    });

    it('should throw ValidationError for null event', async () => {
      await expect(handler(null as any, {} as any, jest.fn())).rejects.toThrow(ValidationError);
      await expect(handler(null as any, {} as any, jest.fn())).rejects.toThrow('Invalid Step Functions input');
    });

    it('should throw ValidationError for non-object event', async () => {
      await expect(handler('invalid' as any, {} as any, jest.fn())).rejects.toThrow(ValidationError);
      await expect(handler(123 as any, {} as any, jest.fn())).rejects.toThrow(ValidationError);
    });
  });

  describe('Preflight Checks', () => {
    const validEvent = {
      action_intent_id: 'ai_test_123',
      tenant_id: 'tenant_test_1',
      account_id: 'account_test_1',
    };

    it('should fetch ActionIntent from ActionIntentService', async () => {
      const intent = createActionIntentV1();
      intent.expires_at_epoch = Math.floor(Date.now() / 1000) + 3600;
      mockActionIntentService.getIntent.mockResolvedValue(intent);
      mockKillSwitchService.isExecutionEnabled.mockResolvedValue(true);

      await handler(validEvent, {} as any, jest.fn());

      expect(mockActionIntentService.getIntent).toHaveBeenCalledWith(
        'ai_test_123',
        'tenant_test_1',
        'account_test_1'
      );
    });

    it('should check expiration (intent not expired)', async () => {
      const intent = createActionIntentV1();
      // Set expires_at_epoch to future (1 hour from now)
      intent.expires_at_epoch = Math.floor(Date.now() / 1000) + 3600;
      mockActionIntentService.getIntent.mockResolvedValue(intent);
      mockKillSwitchService.isExecutionEnabled.mockResolvedValue(true);

      const result = await handler(validEvent, {} as any, jest.fn());

      expect(result.valid).toBe(true);
    });

    it('should check expiration (intent expired)', async () => {
      const intent = createActionIntentV1();
      // Set expires_at_epoch to past (1 hour ago)
      intent.expires_at_epoch = Math.floor(Date.now() / 1000) - 3600;
      mockActionIntentService.getIntent.mockResolvedValue(intent);

      await expect(handler(validEvent, {} as any, jest.fn())).rejects.toThrow(IntentExpiredError);
    });

    it('should check kill switches (execution enabled)', async () => {
      const intent = createActionIntentV1();
      intent.expires_at_epoch = Math.floor(Date.now() / 1000) + 3600;
      mockActionIntentService.getIntent.mockResolvedValue(intent);
      mockKillSwitchService.isExecutionEnabled.mockResolvedValue(true);

      const result = await handler(validEvent, {} as any, jest.fn());

      expect(result.valid).toBe(true);
      expect(mockKillSwitchService.isExecutionEnabled).toHaveBeenCalledWith(
        'tenant_test_1',
        'CREATE_INTERNAL_TASK'
      );
    });

    it('should check kill switches (execution disabled)', async () => {
      const intent = createActionIntentV1();
      intent.expires_at_epoch = Math.floor(Date.now() / 1000) + 3600;
      mockActionIntentService.getIntent.mockResolvedValue(intent);
      mockKillSwitchService.isExecutionEnabled.mockResolvedValue(false);

      await expect(handler(validEvent, {} as any, jest.fn())).rejects.toThrow(KillSwitchEnabledError);
      await expect(handler(validEvent, {} as any, jest.fn())).rejects.toThrow('tenant_test_1');
      await expect(handler(validEvent, {} as any, jest.fn())).rejects.toThrow('CREATE_INTERNAL_TASK');
    });

    it('should return valid response with action_intent', async () => {
      const intent = createActionIntentV1();
      intent.expires_at_epoch = Math.floor(Date.now() / 1000) + 3600;
      mockActionIntentService.getIntent.mockResolvedValue(intent);
      mockKillSwitchService.isExecutionEnabled.mockResolvedValue(true);

      const result = await handler(validEvent, {} as any, jest.fn());

      expect(result).toEqual({
        valid: true,
        action_intent: intent,
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

    it('should throw IntentExpiredError with correct expiration details', async () => {
      const intent = createActionIntentV1();
      const expiredAt = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago
      intent.expires_at_epoch = expiredAt;
      mockActionIntentService.getIntent.mockResolvedValue(intent);

      await expect(handler(validEvent, {} as any, jest.fn())).rejects.toThrow(IntentExpiredError);
      await expect(handler(validEvent, {} as any, jest.fn())).rejects.toThrow('ai_test_123');
      await expect(handler(validEvent, {} as any, jest.fn())).rejects.toThrow('expired');
    });

    it('should throw KillSwitchEnabledError with tenant and action_type', async () => {
      const intent = createActionIntentV1();
      intent.expires_at_epoch = Math.floor(Date.now() / 1000) + 3600;
      mockActionIntentService.getIntent.mockResolvedValue(intent);
      mockKillSwitchService.isExecutionEnabled.mockResolvedValue(false);

      await expect(handler(validEvent, {} as any, jest.fn())).rejects.toThrow(KillSwitchEnabledError);
      await expect(handler(validEvent, {} as any, jest.fn())).rejects.toThrow('tenant_test_1');
      await expect(handler(validEvent, {} as any, jest.fn())).rejects.toThrow('CREATE_INTERNAL_TASK');
    });

    it('should preserve ExecutionError subclasses', async () => {
      const intent = createActionIntentV1();
      intent.expires_at_epoch = Math.floor(Date.now() / 1000) + 3600;
      mockActionIntentService.getIntent.mockResolvedValue(intent);

      const customError = new ValidationError('Custom validation error', 'CUSTOM_ERROR');
      mockKillSwitchService.isExecutionEnabled.mockRejectedValue(customError);

      await expect(handler(validEvent, {} as any, jest.fn())).rejects.toThrow(ValidationError);
      await expect(handler(validEvent, {} as any, jest.fn())).rejects.toThrow('Custom validation error');
    });

    it('should wrap unknown errors as ValidationError', async () => {
      const intent = createActionIntentV1();
      intent.expires_at_epoch = Math.floor(Date.now() / 1000) + 3600;
      mockActionIntentService.getIntent.mockResolvedValue(intent);
      mockKillSwitchService.isExecutionEnabled.mockRejectedValue(new Error('Unexpected database error'));

      await expect(handler(validEvent, {} as any, jest.fn())).rejects.toThrow(ValidationError);
      await expect(handler(validEvent, {} as any, jest.fn())).rejects.toThrow('Validation failed');
    });
  });

  describe('Integration with Services', () => {
    const validEvent = {
      action_intent_id: 'ai_test_123',
      tenant_id: 'tenant_test_1',
      account_id: 'account_test_1',
    };

    it('should check kill switch for specific action_type', async () => {
      const intent = createActionIntentV1({
        action_type: 'CREATE_INTERNAL_TASK',
        expires_at_epoch: Math.floor(Date.now() / 1000) + 3600,
      });
      mockActionIntentService.getIntent.mockResolvedValue(intent);
      mockKillSwitchService.isExecutionEnabled.mockResolvedValue(true);

      await handler(validEvent, {} as any, jest.fn());

      expect(mockKillSwitchService.isExecutionEnabled).toHaveBeenCalledWith(
        'tenant_test_1',
        'CREATE_INTERNAL_TASK' // Specific action type
      );
    });

    it('should validate intent with correct tenant and account', async () => {
      const intent = createActionIntentV1();
      intent.expires_at_epoch = Math.floor(Date.now() / 1000) + 3600;
      mockActionIntentService.getIntent.mockResolvedValue(intent);
      mockKillSwitchService.isExecutionEnabled.mockResolvedValue(true);

      await handler(validEvent, {} as any, jest.fn());

      expect(mockActionIntentService.getIntent).toHaveBeenCalledWith(
        'ai_test_123',
        'tenant_test_1',
        'account_test_1'
      );
    });

    it('should pass all preflight checks in correct order', async () => {
      const intent = createActionIntentV1();
      intent.expires_at_epoch = Math.floor(Date.now() / 1000) + 3600;
      mockActionIntentService.getIntent.mockResolvedValue(intent);
      mockKillSwitchService.isExecutionEnabled.mockResolvedValue(true);

      await handler(validEvent, {} as any, jest.fn());

      // Verify both services were called
      expect(mockActionIntentService.getIntent).toHaveBeenCalled();
      expect(mockKillSwitchService.isExecutionEnabled).toHaveBeenCalled();
    });
  });

  describe('Edge Cases', () => {
    const validEvent = {
      action_intent_id: 'ai_test_123',
      tenant_id: 'tenant_test_1',
      account_id: 'account_test_1',
    };

    it('should handle intent expiring exactly now', async () => {
      const intent = createActionIntentV1();
      // Set expires_at_epoch to current time (should be considered expired)
      intent.expires_at_epoch = Math.floor(Date.now() / 1000);
      mockActionIntentService.getIntent.mockResolvedValue(intent);

      await expect(handler(validEvent, {} as any, jest.fn())).rejects.toThrow(IntentExpiredError);
    });

    it('should handle intent expiring in 1 second (still valid)', async () => {
      const intent = createActionIntentV1();
      // Set expires_at_epoch to 1 second from now (should be valid)
      intent.expires_at_epoch = Math.floor(Date.now() / 1000) + 1;
      mockActionIntentService.getIntent.mockResolvedValue(intent);
      mockKillSwitchService.isExecutionEnabled.mockResolvedValue(true);

      const result = await handler(validEvent, {} as any, jest.fn());

      expect(result.valid).toBe(true);
    });

    it('should handle different action types for kill switch check', async () => {
      const intent = createActionIntentV1({
        action_type: 'CREATE_INTERNAL_NOTE',
      });
      intent.expires_at_epoch = Math.floor(Date.now() / 1000) + 3600;
      mockActionIntentService.getIntent.mockResolvedValue(intent);
      mockKillSwitchService.isExecutionEnabled.mockResolvedValue(true);

      await handler(validEvent, {} as any, jest.fn());

      expect(mockKillSwitchService.isExecutionEnabled).toHaveBeenCalledWith(
        'tenant_test_1',
        'CREATE_INTERNAL_NOTE'
      );
    });
  });
});
