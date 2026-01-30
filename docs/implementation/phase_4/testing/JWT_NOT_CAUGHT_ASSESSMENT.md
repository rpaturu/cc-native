# Why "JWT token retrieval not implemented" Was Not Caught by Unit/Integration Tests

**Date:** 2026-01-29  
**Incident:** Tool-invoker Lambda throws `PermanentError: JWT token retrieval not implemented` in production.

---

## Root cause: handler flow never executed in tests

1. **Unit tests do not invoke the handler.**  
   `tool-invoker-handler.test.ts` only tests:
   - **Zod schema** (`ToolInvocationRequestSchema`) — validation of input shape.
   - **Error classification helpers** (`isRetryableError`, `classifyError`) — logic duplicated/copied from the handler for testing.

   The actual handler flow (validate input → **getJwtToken** → invokeWithRetry → parse response) is never run. So `getJwtToken` was never called in any test.

2. **No integration test runs the tool-invoker.**  
   Integration tests (e.g. execution-status-api, DynamoDB) do not start a Step Functions execution or invoke the tool-invoker handler with a real event. E2E was the first time the full chain ran and hit `getJwtToken`.

3. **getJwtToken is not injectable.**  
   It is a private function inside the handler file. There is no way to mock it in tests without refactoring (e.g. inject a JWT provider). So even if we had “handler tests,” they would have called the real `getJwtToken` and failed the same way.

---

## Fix: test that invokes the handler and asserts JWT path

Add a test that:

1. Invokes the **real** exported `handler` with valid Step Functions input (same shape as from MapActionToTool).
2. Asserts that the handler **does not** throw an error whose message contains `"JWT token retrieval not implemented"`.

**Behavior:**

- **Today (JWT not implemented):** The test **fails** — handler throws that error, so the assertion fails. CI would block deployment.
- **After JWT is implemented:** The test can pass (e.g. with mocked HTTP for the gateway, or assert on a different error/success). When JWT is implemented, this test is updated to mock gateway and expect success or a non-JWT error.

This test is in `tool-invoker-handler.test.ts`: **"Handler invocation (integration) – must not throw JWT retrieval not implemented"**.

---

## JWT fully provisioned by stack (post-fix)

When `userPool` and `userPoolClient` are provided to **ExecutionInfrastructure**, the stack now:

- Creates a Secrets Manager secret (`execution/gateway-service-credentials`).
- Runs a custom resource that creates the Cognito user `gateway-service` and writes credentials to the secret.
- Passes `COGNITO_SERVICE_USER_SECRET_ARN` to the ToolInvoker Lambda and grants `GetSecretValue` on that secret.

No manual “create user + set env vars” steps. See **JWT_SERVICE_USER_STACK_PLAN.md** and **User Pool Client prerequisites** (must enable `USER_PASSWORD_AUTH`).

---

## Checklist for similar gaps

- [ ] For handlers that call external auth (JWT, IAM, etc.), add at least one test that **invokes the handler** and asserts the auth path is implemented or fails in an expected way.
- [ ] Prefer injectable auth (e.g. `getJwtToken: () => Promise<string>`) so unit tests can mock it and integration tests can assert “real auth or skip.”
- [ ] Run handler-invocation tests in CI so “not implemented” stubs fail the build.
