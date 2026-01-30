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

// Mock axios (Gateway response)
jest.mock('axios', () => {
  const actual = jest.requireActual<typeof import('axios')>('axios');
  return {
    ...actual,
    default: {
      ...actual.default,
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
  };
});

import { handler } from '../../../handlers/phase4/tool-invoker-handler';

(skipIntegration ? describe.skip : describe)(
  'Tool Invocation Integration (Tool Invoker with mocked Gateway)',
  () => {
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
