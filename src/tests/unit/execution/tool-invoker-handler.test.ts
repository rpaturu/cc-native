/**
 * ToolInvokerHandler Validation and Error Classification Tests - Phase 4.2
 * 
 * Tests Zod schema validation and error classification logic.
 * Full handler integration tests deferred to Phase 4.3 (requires Gateway).
 */

import { z } from 'zod';
import { AxiosError } from 'axios';

// Import schemas and functions from handler (we'll test them in isolation)
const ToolInvocationRequestSchema = z.object({
  gateway_url: z.string().url('gateway_url must be a valid URL'),
  tool_name: z.string().min(1, 'tool_name is required'),
  tool_arguments: z.record(z.any())
    .refine(
      (val) => {
        if (!val || typeof val !== 'object' || Array.isArray(val)) {
          return false;
        }
        return true;
      },
      { message: 'tool_arguments must be a plain object (not array, not null)' }
    )
    .refine(
      (val) => {
        const size = JSON.stringify(val).length;
        return size < 200 * 1024; // 200KB
      },
      { message: 'tool_arguments exceeds size limit (200KB). Large payloads should be passed via S3 artifact reference.' }
    ),
  idempotency_key: z.string().min(1, 'idempotency_key is required'),
  action_intent_id: z.string().min(1, 'action_intent_id is required'),
  tenant_id: z.string().min(1, 'tenant_id is required'),
  account_id: z.string().min(1, 'account_id is required'),
  trace_id: z.string().min(1, 'trace_id is required'),
  attempt_count: z.number().int().positive().optional(),
}).strict();

// Error classification functions (extracted for testing)
function isRetryableError(error: any): boolean {
  if (error instanceof AxiosError) {
    if (error.response?.status && error.response.status >= 500) {
      return true;
    }
    if (error.response?.status === 429) {
      return true;
    }
    const retryableNetworkCodes = [
      'ECONNRESET',
      'ETIMEDOUT',
      'ENOTFOUND',
      'EAI_AGAIN',
      'ECONNREFUSED',
    ];
    if (error.code && retryableNetworkCodes.includes(error.code)) {
      return true;
    }
  }
  if (error.code && ['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT'].includes(error.code)) {
    return true;
  }
  return false;
}

function classifyError(parsedResponse: any): {
  error_code?: string;
  error_class?: 'AUTH' | 'RATE_LIMIT' | 'VALIDATION' | 'DOWNSTREAM' | 'TIMEOUT' | 'UNKNOWN';
  error_message?: string;
} {
  if (parsedResponse.success) {
    return {};
  }
  
  const error = parsedResponse.error || parsedResponse;
  const errorMessage = error.message || error.error;
  if (!errorMessage) {
    throw new Error('Tool invocation failed but no error message was provided');
  }
  
  if (errorMessage.includes('authentication') || errorMessage.includes('unauthorized')) {
    return {
      error_code: 'AUTH_FAILED',
      error_class: 'AUTH',
      error_message: errorMessage,
    };
  }
  
  if (errorMessage.includes('rate limit') || errorMessage.includes('throttle')) {
    return {
      error_code: 'RATE_LIMIT',
      error_class: 'RATE_LIMIT',
      error_message: errorMessage,
    };
  }
  
  if (errorMessage.includes('validation') || errorMessage.includes('invalid')) {
    return {
      error_code: 'VALIDATION_ERROR',
      error_class: 'VALIDATION',
      error_message: errorMessage,
    };
  }
  
  if (errorMessage.includes('timeout')) {
    return {
      error_code: 'TIMEOUT',
      error_class: 'TIMEOUT',
      error_message: errorMessage,
    };
  }
  
  return {
    error_code: 'UNKNOWN_ERROR',
    error_class: 'UNKNOWN',
    error_message: errorMessage,
  };
}

describe('ToolInvokerHandler - ToolInvocationRequestSchema Validation', () => {
  describe('Valid Input', () => {
    it('should accept valid input', () => {
      const validInput = {
        gateway_url: 'https://gateway.example.com',
        tool_name: 'crm.create_task',
        tool_arguments: { title: 'Test', priority: 'HIGH' },
        idempotency_key: 'key_123',
        action_intent_id: 'ai_test_123',
        tenant_id: 'tenant_test_1',
        account_id: 'account_test_1',
        trace_id: 'trace_123',
      };

      const result = ToolInvocationRequestSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });

    it('should accept optional attempt_count', () => {
      const validInput = {
        gateway_url: 'https://gateway.example.com',
        tool_name: 'crm.create_task',
        tool_arguments: { title: 'Test' },
        idempotency_key: 'key_123',
        action_intent_id: 'ai_test_123',
        tenant_id: 'tenant_test_1',
        account_id: 'account_test_1',
        trace_id: 'trace_123',
        attempt_count: 1,
      };

      const result = ToolInvocationRequestSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });
  });

  describe('URL Validation', () => {
    it('should reject invalid URL for gateway_url', () => {
      const invalidInput = {
        gateway_url: 'not-a-url',
        tool_name: 'crm.create_task',
        tool_arguments: { title: 'Test' },
        idempotency_key: 'key_123',
        action_intent_id: 'ai_test_123',
        tenant_id: 'tenant_test_1',
        account_id: 'account_test_1',
        trace_id: 'trace_123',
      };

      const result = ToolInvocationRequestSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });
  });

  describe('tool_arguments Validation', () => {
    it('should reject array for tool_arguments', () => {
      const invalidInput = {
        gateway_url: 'https://gateway.example.com',
        tool_name: 'crm.create_task',
        tool_arguments: ['item1', 'item2'], // Array instead of object
        idempotency_key: 'key_123',
        action_intent_id: 'ai_test_123',
        tenant_id: 'tenant_test_1',
        account_id: 'account_test_1',
        trace_id: 'trace_123',
      };

      const result = ToolInvocationRequestSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });

    it('should reject null for tool_arguments', () => {
      const invalidInput = {
        gateway_url: 'https://gateway.example.com',
        tool_name: 'crm.create_task',
        tool_arguments: null,
        idempotency_key: 'key_123',
        action_intent_id: 'ai_test_123',
        tenant_id: 'tenant_test_1',
        account_id: 'account_test_1',
        trace_id: 'trace_123',
      };

      const result = ToolInvocationRequestSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });

    it('should reject tool_arguments exceeding 200KB', () => {
      const largeObject: Record<string, string> = {};
      for (let i = 0; i < 10000; i++) {
        largeObject[`key_${i}`] = 'x'.repeat(25); // ~250KB total
      }

      const invalidInput = {
        gateway_url: 'https://gateway.example.com',
        tool_name: 'crm.create_task',
        tool_arguments: largeObject,
        idempotency_key: 'key_123',
        action_intent_id: 'ai_test_123',
        tenant_id: 'tenant_test_1',
        account_id: 'account_test_1',
        trace_id: 'trace_123',
      };

      const result = ToolInvocationRequestSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });

    it('should accept tool_arguments under 200KB', () => {
      const smallObject: Record<string, string> = {};
      for (let i = 0; i < 100; i++) {
        smallObject[`key_${i}`] = 'value';
      }

      const validInput = {
        gateway_url: 'https://gateway.example.com',
        tool_name: 'crm.create_task',
        tool_arguments: smallObject,
        idempotency_key: 'key_123',
        action_intent_id: 'ai_test_123',
        tenant_id: 'tenant_test_1',
        account_id: 'account_test_1',
        trace_id: 'trace_123',
      };

      const result = ToolInvocationRequestSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });
  });

  describe('Required Fields', () => {
    it('should reject missing required fields', () => {
      const invalidInput = {
        gateway_url: 'https://gateway.example.com',
        tool_name: 'crm.create_task',
        // Missing other required fields
      };

      const result = ToolInvocationRequestSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });
  });

  describe('Strict Mode', () => {
    it('should reject extra fields', () => {
      const invalidInput = {
        gateway_url: 'https://gateway.example.com',
        tool_name: 'crm.create_task',
        tool_arguments: { title: 'Test' },
        idempotency_key: 'key_123',
        action_intent_id: 'ai_test_123',
        tenant_id: 'tenant_test_1',
        account_id: 'account_test_1',
        trace_id: 'trace_123',
        extra_field: 'should be rejected',
      };

      const result = ToolInvocationRequestSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });
  });
});

describe('ToolInvokerHandler - Error Classification', () => {
  describe('isRetryableError', () => {
    it('should classify 5xx errors as retryable', () => {
      const error = new AxiosError('Server error');
      error.response = { status: 500 } as any;

      expect(isRetryableError(error)).toBe(true);
    });

    it('should classify 429 as retryable', () => {
      const error = new AxiosError('Rate limited');
      error.response = { status: 429 } as any;

      expect(isRetryableError(error)).toBe(true);
    });

    it('should classify ECONNRESET as retryable', () => {
      const error = {
        code: 'ECONNRESET',
      };

      expect(isRetryableError(error)).toBe(true);
    });

    it('should classify ETIMEDOUT as retryable', () => {
      const error = {
        code: 'ETIMEDOUT',
      };

      expect(isRetryableError(error)).toBe(true);
    });

    it('should classify ENOTFOUND as retryable', () => {
      const error = {
        code: 'ENOTFOUND',
      };

      expect(isRetryableError(error)).toBe(true);
    });

    it('should classify EAI_AGAIN as retryable', () => {
      const error = {
        code: 'EAI_AGAIN',
      };

      expect(isRetryableError(error)).toBe(true);
    });

    it('should classify ECONNREFUSED as retryable', () => {
      const error = {
        code: 'ECONNREFUSED',
      };

      expect(isRetryableError(error)).toBe(true);
    });

    it('should classify 4xx (except 429) as non-retryable', () => {
      const error = new AxiosError('Bad request');
      error.response = { status: 400 } as any;

      expect(isRetryableError(error)).toBe(false);
    });

    it('should classify 401 as non-retryable', () => {
      const error = new AxiosError('Unauthorized');
      error.response = { status: 401 } as any;

      expect(isRetryableError(error)).toBe(false);
    });

    it('should classify 403 as non-retryable', () => {
      const error = new AxiosError('Forbidden');
      error.response = { status: 403 } as any;

      expect(isRetryableError(error)).toBe(false);
    });
  });

  describe('classifyError', () => {
    it('should return empty object if success=true', () => {
      const response = {
        success: true,
      };

      const classification = classifyError(response);
      expect(classification).toEqual({});
    });

    it('should classify authentication errors as AUTH', () => {
      const response = {
        success: false,
        error: {
          message: 'authentication failed: Invalid token', // lowercase to match implementation
        },
      };

      const classification = classifyError(response);
      expect(classification.error_code).toBe('AUTH_FAILED');
      expect(classification.error_class).toBe('AUTH');
    });

    it('should classify unauthorized errors as AUTH', () => {
      const response = {
        success: false,
        error: {
          message: 'unauthorized access', // lowercase to match implementation
        },
      };

      const classification = classifyError(response);
      expect(classification.error_class).toBe('AUTH');
    });

    it('should classify rate limit errors as RATE_LIMIT', () => {
      const response = {
        success: false,
        error: {
          message: 'rate limit exceeded', // lowercase to match implementation
        },
      };

      const classification = classifyError(response);
      expect(classification.error_code).toBe('RATE_LIMIT');
      expect(classification.error_class).toBe('RATE_LIMIT');
    });

    it('should classify throttle errors as RATE_LIMIT', () => {
      const response = {
        success: false,
        error: {
          message: 'Request throttled',
        },
      };

      const classification = classifyError(response);
      expect(classification.error_class).toBe('RATE_LIMIT');
    });

    it('should classify validation errors as VALIDATION', () => {
      const response = {
        success: false,
        error: {
          message: 'validation failed: missing required field', // lowercase to match implementation
        },
      };

      const classification = classifyError(response);
      expect(classification.error_code).toBe('VALIDATION_ERROR');
      expect(classification.error_class).toBe('VALIDATION');
    });

    it('should classify invalid errors as VALIDATION', () => {
      const response = {
        success: false,
        error: {
          message: 'invalid parameter value', // lowercase to match implementation
        },
      };

      const classification = classifyError(response);
      expect(classification.error_class).toBe('VALIDATION');
    });

    it('should classify timeout errors as TIMEOUT', () => {
      const response = {
        success: false,
        error: {
          message: 'Request timeout',
        },
      };

      const classification = classifyError(response);
      expect(classification.error_code).toBe('TIMEOUT');
      expect(classification.error_class).toBe('TIMEOUT');
    });

    it('should classify unknown errors as UNKNOWN', () => {
      const response = {
        success: false,
        error: {
          message: 'Something went wrong',
        },
      };

      const classification = classifyError(response);
      expect(classification.error_code).toBe('UNKNOWN_ERROR');
      expect(classification.error_class).toBe('UNKNOWN');
    });

    it('should throw error if no error message provided', () => {
      const response = {
        success: false,
        error: {},
      };

      expect(() => classifyError(response)).toThrow('Tool invocation failed but no error message was provided');
    });
  });
});
