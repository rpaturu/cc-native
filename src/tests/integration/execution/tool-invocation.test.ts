/**
 * Phase 4.5B — Tool Invocation Integration Tests
 *
 * Validates Tool Invoker handler with mocked Gateway (axios) and JWT (Cognito/Secrets):
 * invoke handler with valid SFN state, assert ToolInvocationResponse shape (success, external_object_refs).
 *
 * No real DynamoDB or Gateway; mocks provide JWT and Gateway response.
 * Skip when SKIP_TOOL_INVOCATION_INTEGRATION=1.
 */

const skipIntegration = process.env.SKIP_TOOL_INVOCATION_INTEGRATION === '1';

// Mock Secrets Manager (JWT path)
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

// Mock Cognito (JWT)
jest.mock('@aws-sdk/client-cognito-identity-provider', () => ({
  CognitoIdentityProviderClient: jest.fn().mockImplementation(() => ({
    send: jest.fn().mockResolvedValue({
      AuthenticationResult: { IdToken: 'mock-jwt-for-integration' },
    }),
  })),
  InitiateAuthCommand: jest.fn(),
  NotAuthorizedException: class NotAuthorizedException extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'NotAuthorizedException';
    }
  },
}));

// Mock axios so handler never hits the network (no spread of actual to avoid real implementation)
jest.mock('axios', () => ({
  __esModule: true,
  default: {
    post: jest.fn().mockResolvedValue({
      data: {
        result: {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                external_object_refs: [
                  { object_id: 'mock-obj-1', object_type: 'Task', system: 'INTERNAL' },
                ],
              }),
            },
          ],
        },
      },
    }),
  },
}));

import { handler } from '../../../handlers/phase4/tool-invoker-handler';

(skipIntegration ? describe.skip : describe)(
  'Tool Invocation Integration (Tool Invoker with mocked Gateway)',
  () => {
    const originalEnv: Record<string, string | undefined> = {};

    beforeAll(() => {
      // getJwtToken requires these or it throws before calling Cognito/Secrets (which we mock)
      originalEnv.COGNITO_USER_POOL_ID = process.env.COGNITO_USER_POOL_ID;
      originalEnv.COGNITO_CLIENT_ID = process.env.COGNITO_CLIENT_ID;
      originalEnv.COGNITO_SERVICE_USERNAME = process.env.COGNITO_SERVICE_USERNAME;
      originalEnv.COGNITO_SERVICE_PASSWORD = process.env.COGNITO_SERVICE_PASSWORD;
      process.env.COGNITO_USER_POOL_ID = process.env.COGNITO_USER_POOL_ID || 'test-pool-id';
      process.env.COGNITO_CLIENT_ID = process.env.COGNITO_CLIENT_ID || 'test-client-id';
      process.env.COGNITO_SERVICE_USERNAME = process.env.COGNITO_SERVICE_USERNAME || 'test-user';
      process.env.COGNITO_SERVICE_PASSWORD = process.env.COGNITO_SERVICE_PASSWORD || 'test-pass';
    });

    afterAll(() => {
      if (originalEnv.COGNITO_USER_POOL_ID !== undefined) process.env.COGNITO_USER_POOL_ID = originalEnv.COGNITO_USER_POOL_ID;
      else delete process.env.COGNITO_USER_POOL_ID;
      if (originalEnv.COGNITO_CLIENT_ID !== undefined) process.env.COGNITO_CLIENT_ID = originalEnv.COGNITO_CLIENT_ID;
      else delete process.env.COGNITO_CLIENT_ID;
      if (originalEnv.COGNITO_SERVICE_USERNAME !== undefined) process.env.COGNITO_SERVICE_USERNAME = originalEnv.COGNITO_SERVICE_USERNAME;
      else delete process.env.COGNITO_SERVICE_USERNAME;
      if (originalEnv.COGNITO_SERVICE_PASSWORD !== undefined) process.env.COGNITO_SERVICE_PASSWORD = originalEnv.COGNITO_SERVICE_PASSWORD;
      else delete process.env.COGNITO_SERVICE_PASSWORD;
    });

    it('invoke handler with valid SFN state, assert ToolInvocationResponse shape', async () => {
      const event = {
        gateway_url: 'https://gateway.example.com/integration',
        tool_name: 'internal.create_task',
        tool_arguments: {
          title: 'Tool invocation integration test',
          description: 'Phase 4.5B',
          tenant_id: 'tenant-ti-1',
          account_id: 'account-ti-1',
        },
        idempotency_key: 'idem-ti-1',
        action_intent_id: 'ai_ti_1',
        tenant_id: 'tenant-ti-1',
        account_id: 'account-ti-1',
        trace_id: 'trace-ti-1',
        attempt_count: 1,
      };

      const response = await handler(event, {} as any, () => {});

      expect(response).toBeDefined();
      expect((response as any).success).toBe(true);
      expect(Array.isArray((response as any).external_object_refs)).toBe(true);
      expect((response as any).external_object_refs.length).toBeGreaterThanOrEqual(1);
      expect((response as any).external_object_refs[0].object_type).toBeDefined();
      expect((response as any).tool_run_ref).toBeDefined();
    });
  }
);
