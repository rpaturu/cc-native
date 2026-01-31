/**
 * ToolInvokerHandler Validation and Error Classification Tests - Phase 4.2
 * 
 * Tests Zod schema validation and error classification logic.
 * Includes a handler-invocation test that fails when JWT retrieval is not implemented
 * (so CI catches "JWT token retrieval not implemented" before deploy). See JWT_NOT_CAUGHT_ASSESSMENT.md.
 */

import { z } from 'zod';
import { AxiosError } from 'axios';
import nock from 'nock';

// Mock Secrets Manager for COGNITO_SERVICE_USER_SECRET_ARN path (JWT_SERVICE_USER_STACK_PLAN.md)
const mockSecretsManagerSend = jest.fn().mockResolvedValue({
  SecretString: JSON.stringify({
    username: 'test-service-user',
    password: 'test-service-pass',
    userPoolId: 'test-pool-id',
    clientId: 'test-client-id',
    createdAt: new Date().toISOString(),
  }),
});
jest.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: jest.fn().mockImplementation(() => ({ send: mockSecretsManagerSend })),
  GetSecretValueCommand: jest.fn(),
}));

// Mock Cognito so handler can obtain a JWT in tests (when env is set)
const mockCognitoSend = jest.fn().mockResolvedValue({
  AuthenticationResult: { IdToken: 'mock-jwt-for-tests' },
});
jest.mock('@aws-sdk/client-cognito-identity-provider', () => ({
  CognitoIdentityProviderClient: jest.fn().mockImplementation(() => ({ send: mockCognitoSend })),
  InitiateAuthCommand: jest.fn(),
  NotAuthorizedException: class NotAuthorizedException extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'NotAuthorizedException';
    }
  },
}));

// Do not mock axios so handler makes real HTTP calls; we use nock in handler-invocation tests to intercept

import { handler } from '../../../handlers/phase4/tool-invoker-handler';

// Mirror handler schema: state from MapActionToTool (tool-mapper output)
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
  tool_schema_version: z.string().min(1).optional(),
  registry_version: z.number().int().positive().optional(),
  compensation_strategy: z.string().min(1).optional(),
  started_at: z.string().min(1).optional(),
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

    it('should accept valid input with tool_schema_version, registry_version, compensation_strategy, started_at (state from MapActionToTool)', () => {
      const validInput = {
        gateway_url: 'https://gateway.example.com',
        tool_name: 'internal.create_task',
        tool_arguments: { title: 'E2E test', description: 'Phase 4 E2E seed' },
        tool_schema_version: 'v1.0',
        registry_version: 1,
        compensation_strategy: 'AUTOMATIC',
        idempotency_key: 'key_123',
        action_intent_id: 'ai_test_123',
        tenant_id: 'tenant_test_1',
        account_id: 'account_test_1',
        trace_id: 'trace_123',
        attempt_count: 1,
        started_at: '2026-01-29T05:40:10.304Z',
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

describe('ToolInvokerHandler - Handler invocation', () => {
  /**
   * Valid Step Functions input (same shape as MapActionToTool output).
   */
  const validStepFunctionsEvent = {
    gateway_url: 'https://gateway.example.com',
    tool_name: 'create_task',
    tool_arguments: { title: 'Test', idempotency_key: 'key-1', action_intent_id: 'intent-1' },
    idempotency_key: 'key-1',
    action_intent_id: 'intent-1',
    tenant_id: 'tenant-1',
    account_id: 'account-1',
    trace_id: 'trace-1',
    attempt_count: 1,
  };

  const successMcpBody = {
    result: {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: true,
            external_object_refs: [{ object_id: 'mock-id', object_type: 'Task' }],
          }),
        },
      ],
    },
  };

  /**
   * Asserts the handler does not throw "JWT token retrieval not implemented".
   * With JWT implemented, we set Cognito env vars and nock the gateway so the handler runs to completion.
   * See JWT_NOT_CAUGHT_ASSESSMENT.md.
   */
  it('must not throw JWT token retrieval not implemented when invoked with valid input', async () => {
    nock('https://gateway.example.com').post('/').reply(200, successMcpBody);
    const orig = {
      COGNITO_USER_POOL_ID: process.env.COGNITO_USER_POOL_ID,
      COGNITO_CLIENT_ID: process.env.COGNITO_CLIENT_ID,
      COGNITO_SERVICE_USERNAME: process.env.COGNITO_SERVICE_USERNAME,
      COGNITO_SERVICE_PASSWORD: process.env.COGNITO_SERVICE_PASSWORD,
    };
    process.env.COGNITO_USER_POOL_ID = 'test-pool-id';
    process.env.COGNITO_CLIENT_ID = 'test-client-id';
    process.env.COGNITO_SERVICE_USERNAME = 'test-service-user';
    process.env.COGNITO_SERVICE_PASSWORD = 'test-service-pass';
    try {
      let thrown: unknown;
      try {
        await handler(validStepFunctionsEvent, {} as any, () => {});
      } catch (e) {
        thrown = e;
      }
      const message = (thrown as Error)?.message ?? '';
      expect(message).not.toContain('JWT token retrieval not implemented');
    } finally {
      nock.cleanAll();
      process.env.COGNITO_USER_POOL_ID = orig.COGNITO_USER_POOL_ID;
      process.env.COGNITO_CLIENT_ID = orig.COGNITO_CLIENT_ID;
      process.env.COGNITO_SERVICE_USERNAME = orig.COGNITO_SERVICE_USERNAME;
      process.env.COGNITO_SERVICE_PASSWORD = orig.COGNITO_SERVICE_PASSWORD;
      delete process.env.COGNITO_SERVICE_USER_SECRET_ARN;
    }
  });

  /**
   * When COGNITO_SERVICE_USER_SECRET_ARN is set, handler uses Secrets Manager for JWT credentials (JWT_SERVICE_USER_STACK_PLAN.md).
   * Asserts secret path is used (GetSecretValue called) and no JWT config error; nock gateway so handler completes.
   */
  it('uses secret for JWT when COGNITO_SERVICE_USER_SECRET_ARN is set', async () => {
    mockSecretsManagerSend.mockClear();
    nock('https://gateway.example.com').post('/').reply(200, successMcpBody);
    const orig = {
      COGNITO_USER_POOL_ID: process.env.COGNITO_USER_POOL_ID,
      COGNITO_CLIENT_ID: process.env.COGNITO_CLIENT_ID,
      COGNITO_SERVICE_USER_SECRET_ARN: process.env.COGNITO_SERVICE_USER_SECRET_ARN,
      COGNITO_SERVICE_USERNAME: process.env.COGNITO_SERVICE_USERNAME,
      COGNITO_SERVICE_PASSWORD: process.env.COGNITO_SERVICE_PASSWORD,
    };
    process.env.COGNITO_USER_POOL_ID = 'test-pool-id';
    process.env.COGNITO_CLIENT_ID = 'test-client-id';
    process.env.COGNITO_SERVICE_USER_SECRET_ARN = 'arn:aws:secretsmanager:us-east-1:123456789012:secret:execution/gateway-service';
    delete process.env.COGNITO_SERVICE_USERNAME;
    delete process.env.COGNITO_SERVICE_PASSWORD;
    try {
      let thrown: unknown;
      try {
        await handler(validStepFunctionsEvent, {} as any, () => {});
      } catch (e) {
        thrown = e;
      }
      expect(mockSecretsManagerSend).toHaveBeenCalled();
      const message = (thrown as Error)?.message ?? '';
      expect(message).not.toContain('JWT token retrieval not implemented');
      expect(message).not.toContain('JWT credentials not configured');
      expect(message).not.toContain('JWT secret');
    } finally {
      nock.cleanAll();
      process.env.COGNITO_USER_POOL_ID = orig.COGNITO_USER_POOL_ID;
      process.env.COGNITO_CLIENT_ID = orig.COGNITO_CLIENT_ID;
      if (orig.COGNITO_SERVICE_USER_SECRET_ARN) process.env.COGNITO_SERVICE_USER_SECRET_ARN = orig.COGNITO_SERVICE_USER_SECRET_ARN;
      else delete process.env.COGNITO_SERVICE_USER_SECRET_ARN;
      if (orig.COGNITO_SERVICE_USERNAME) process.env.COGNITO_SERVICE_USERNAME = orig.COGNITO_SERVICE_USERNAME;
      if (orig.COGNITO_SERVICE_PASSWORD) process.env.COGNITO_SERVICE_PASSWORD = orig.COGNITO_SERVICE_PASSWORD;
    }
  });

  it('throws ValidationError when Step Functions input is invalid (missing gateway_url)', async () => {
    const invalidEvent = {
      tool_name: 'create_task',
      tool_arguments: {},
      idempotency_key: 'key-1',
      action_intent_id: 'intent-1',
      tenant_id: 'tenant-1',
      account_id: 'account-1',
      trace_id: 'trace-1',
    };
    await expect(handler(invalidEvent as any, {} as any, jest.fn())).rejects.toMatchObject({
      name: 'ValidationError',
      message: expect.stringContaining('Invalid Step Functions input'),
    });
  });

  it('returns success: false with error_class when gateway returns tool business failure', async () => {
    process.env.COGNITO_USER_POOL_ID = 'test-pool-id';
    process.env.COGNITO_CLIENT_ID = 'test-client-id';
    process.env.COGNITO_SERVICE_USERNAME = 'test-service-user';
    process.env.COGNITO_SERVICE_PASSWORD = 'test-service-pass';
    const mcpFailureBody = {
      result: {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: false,
              error_message: 'validation failed: missing required field',
            }),
          },
        ],
      },
    };
    nock('https://gateway.example.com')
      .post('/')
      .reply(200, mcpFailureBody);
    try {
      const result = await handler(validStepFunctionsEvent, {} as any, jest.fn());
      expect(result).toBeDefined();
      expect((result as any).success).toBe(false);
      expect((result as any).error_class).toBe('VALIDATION');
      expect((result as any).error_code).toBe('VALIDATION_ERROR');
    } finally {
      nock.cleanAll();
      delete process.env.COGNITO_USER_POOL_ID;
      delete process.env.COGNITO_CLIENT_ID;
      delete process.env.COGNITO_SERVICE_USERNAME;
      delete process.env.COGNITO_SERVICE_PASSWORD;
    }
  });

  it('returns success: false with AUTH when gateway returns authentication error message', async () => {
    process.env.COGNITO_USER_POOL_ID = 'test-pool-id';
    process.env.COGNITO_CLIENT_ID = 'test-client-id';
    process.env.COGNITO_SERVICE_USERNAME = 'test-service-user';
    process.env.COGNITO_SERVICE_PASSWORD = 'test-service-pass';
    const mcpBody = {
      result: {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: false,
              error_message: 'authentication failed: Invalid token',
            }),
          },
        ],
      },
    };
    nock('https://gateway.example.com').post('/').reply(200, mcpBody);
    try {
      const result = await handler(validStepFunctionsEvent, {} as any, jest.fn());
      expect((result as any).success).toBe(false);
      expect((result as any).error_class).toBe('AUTH');
      expect((result as any).error_code).toBe('AUTH_FAILED');
    } finally {
      nock.cleanAll();
      delete process.env.COGNITO_USER_POOL_ID;
      delete process.env.COGNITO_CLIENT_ID;
      delete process.env.COGNITO_SERVICE_USERNAME;
      delete process.env.COGNITO_SERVICE_PASSWORD;
    }
  });

  it('returns success: false with error_message when gateway returns result.isError and non-JSON text', async () => {
    process.env.COGNITO_USER_POOL_ID = 'test-pool-id';
    process.env.COGNITO_CLIENT_ID = 'test-client-id';
    process.env.COGNITO_SERVICE_USERNAME = 'test-service-user';
    process.env.COGNITO_SERVICE_PASSWORD = 'test-service-pass';
    const mcpBody = {
      result: {
        isError: true,
        content: [{ type: 'text', text: 'Plain error from adapter' }],
      },
    };
    nock('https://gateway.example.com').post('/').reply(200, mcpBody);
    try {
      const result = await handler(validStepFunctionsEvent, {} as any, jest.fn());
      expect((result as any).success).toBe(false);
      expect((result as any).error_message).toBe('Plain error from adapter');
      expect((result as any).error_class).toBe('UNKNOWN');
    } finally {
      nock.cleanAll();
      delete process.env.COGNITO_USER_POOL_ID;
      delete process.env.COGNITO_CLIENT_ID;
      delete process.env.COGNITO_SERVICE_USERNAME;
      delete process.env.COGNITO_SERVICE_PASSWORD;
    }
  });

  it('returns success: true with external_object_refs and tool_run_ref when gateway succeeds', async () => {
    process.env.COGNITO_USER_POOL_ID = 'test-pool-id';
    process.env.COGNITO_CLIENT_ID = 'test-client-id';
    process.env.COGNITO_SERVICE_USERNAME = 'test-service-user';
    process.env.COGNITO_SERVICE_PASSWORD = 'test-service-pass';
    nock('https://gateway.example.com').post('/').reply(200, successMcpBody);
    try {
      const result = await handler(validStepFunctionsEvent, {} as any, jest.fn());
      expect((result as any).success).toBe(true);
      expect((result as any).tool_run_ref).toMatch(/^toolrun\/trace-1\/1\/create_task$/);
      expect(Array.isArray((result as any).external_object_refs)).toBe(true);
      expect((result as any).external_object_refs[0].object_id).toBe('mock-id');
      expect((result as any).external_object_refs[0].object_type).toBe('Task');
    } finally {
      nock.cleanAll();
      delete process.env.COGNITO_USER_POOL_ID;
      delete process.env.COGNITO_CLIENT_ID;
      delete process.env.COGNITO_SERVICE_USERNAME;
      delete process.env.COGNITO_SERVICE_PASSWORD;
    }
  });

  it('throws PermanentError when gateway returns MCP protocol error (response.error)', async () => {
    process.env.COGNITO_USER_POOL_ID = 'test-pool-id';
    process.env.COGNITO_CLIENT_ID = 'test-client-id';
    process.env.COGNITO_SERVICE_USERNAME = 'test-service-user';
    process.env.COGNITO_SERVICE_PASSWORD = 'test-service-pass';
    nock('https://gateway.example.com')
      .post('/')
      .reply(200, { error: { code: -32600, message: 'Invalid request' } });
    try {
      await expect(handler(validStepFunctionsEvent, {} as any, jest.fn())).rejects.toMatchObject({
        name: 'PermanentError',
        message: expect.stringContaining('MCP protocol error'),
      });
    } finally {
      nock.cleanAll();
      delete process.env.COGNITO_USER_POOL_ID;
      delete process.env.COGNITO_CLIENT_ID;
      delete process.env.COGNITO_SERVICE_USERNAME;
      delete process.env.COGNITO_SERVICE_PASSWORD;
    }
  });

  it('throws PermanentError when gateway returns 401', async () => {
    process.env.COGNITO_USER_POOL_ID = 'test-pool-id';
    process.env.COGNITO_CLIENT_ID = 'test-client-id';
    process.env.COGNITO_SERVICE_USERNAME = 'test-service-user';
    process.env.COGNITO_SERVICE_PASSWORD = 'test-service-pass';
    nock('https://gateway.example.com').post('/').reply(401, { message: 'Unauthorized' });
    try {
      await expect(handler(validStepFunctionsEvent, {} as any, jest.fn())).rejects.toMatchObject({
        name: 'PermanentError',
      });
    } finally {
      nock.cleanAll();
      delete process.env.COGNITO_USER_POOL_ID;
      delete process.env.COGNITO_CLIENT_ID;
      delete process.env.COGNITO_SERVICE_USERNAME;
      delete process.env.COGNITO_SERVICE_PASSWORD;
    }
  });

  it('throws TransientError when gateway returns 500 after retries', async () => {
    process.env.COGNITO_USER_POOL_ID = 'test-pool-id';
    process.env.COGNITO_CLIENT_ID = 'test-client-id';
    process.env.COGNITO_SERVICE_USERNAME = 'test-service-user';
    process.env.COGNITO_SERVICE_PASSWORD = 'test-service-pass';
    for (let i = 0; i < 4; i++) {
      nock('https://gateway.example.com').post('/').reply(500, { error: 'Internal Server Error' });
    }
    try {
      await expect(handler(validStepFunctionsEvent, {} as any, jest.fn())).rejects.toMatchObject({
        name: 'TransientError',
      });
    } finally {
      nock.cleanAll();
      delete process.env.COGNITO_USER_POOL_ID;
      delete process.env.COGNITO_CLIENT_ID;
      delete process.env.COGNITO_SERVICE_USERNAME;
      delete process.env.COGNITO_SERVICE_PASSWORD;
    }
  });

  it('throws PermanentError when Cognito user pool and client id are not set', async () => {
    const origPool = process.env.COGNITO_USER_POOL_ID;
    const origClient = process.env.COGNITO_CLIENT_ID;
    delete process.env.COGNITO_USER_POOL_ID;
    delete process.env.COGNITO_CLIENT_ID;
    try {
      await expect(handler(validStepFunctionsEvent, {} as any, jest.fn())).rejects.toMatchObject({
        name: 'PermanentError',
        message: expect.stringContaining('JWT token retrieval not implemented'),
      });
    } finally {
      if (origPool) process.env.COGNITO_USER_POOL_ID = origPool;
      if (origClient) process.env.COGNITO_CLIENT_ID = origClient;
    }
  });
});
