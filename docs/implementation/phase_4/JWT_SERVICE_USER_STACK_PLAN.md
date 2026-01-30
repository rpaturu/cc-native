# Plan: JWT Service User and Credentials in Stack

**Status:** Approved with refinements (final review incorporated)  
**Goal:** Make JWT retrieval for the ToolInvoker Lambda fully provisioned by the stack (no manual “create user + set env vars” steps).

---

## 1. Current state

- ToolInvoker needs a Cognito User Pool JWT to call the Gateway.
- Handler uses `InitiateAuth` with `USER_PASSWORD_AUTH` and expects either:
  - **Env vars:** `COGNITO_SERVICE_USERNAME` + `COGNITO_SERVICE_PASSWORD`, or
  - (Not yet) **Secret:** `COGNITO_SERVICE_USER_SECRET_ARN` (Secrets Manager).
- CDK already passes `COGNITO_USER_POOL_ID` and `COGNITO_CLIENT_ID` when `userPool` / `userPoolClient` are provided.
- Today, deployers must manually: create a service user in Cognito and set the two env vars on the ToolInvoker Lambda.

---

## 2. Options

| Option | Pros | Cons |
|--------|------|------|
| **A. Leave as-is (manual)** | No code change. | Manual steps per env; easy to forget; credentials in Lambda env (visible in console). |
| **B. Secret only (no auto user)** | CDK creates a Secret; deployer fills it (or uses parameter/store). Lambda reads secret. No Cognito API from CDK. | Still need to create user and put credentials somewhere once. |
| **C. Custom resource: create user + secret** | One deploy; user and secret created and wired; no credentials in env. | Custom resource Lambda + permissions; idempotency and update semantics to define. |
| **D. Parameter Store / CDK context** | Could pass secret ARN or “use this secret” from parent. | Does not create the user or the secret; same “who creates user?” as B. |

**Recommendation:** **C** — custom resource that creates the Cognito service user and writes credentials to a Secrets Manager secret; ToolInvoker gets `COGNITO_SERVICE_USER_SECRET_ARN` and reads from the secret. Optional: keep support for env vars (B) for dev/test overrides.

---

## 3. Scope (if we choose C)

### 3.1 CDK (ExecutionInfrastructure or dedicated construct)

#### Prerequisites (must be true or runtime fails)

- **User Pool Client:** The CDK-created User Pool Client **must** enable:
  - `USER_PASSWORD_AUTH` (required for ToolInvoker `InitiateAuth`)
  - `ALLOW_REFRESH_TOKEN_AUTH` (recommended)
  Otherwise the stack deploys but ToolInvoker fails at runtime with a non-obvious auth error. Document in Scope 3.1 and in Handler/code comments.
- **Custom attributes:** The user pool must define the custom attributes `service_type` and `created_by`. If the pool is owned by this stack, CDK should create these attributes when creating the User Pool; otherwise they must exist before the custom resource runs. Otherwise `AdminCreateUser` can fail when setting user attributes.

- **Secret:** One Secrets Manager secret (e.g. `execution/gateway-service-credentials`). Created by CDK; contents filled by custom resource. See **3.1.1 Secret structure**.
- **Custom resource Lambda:**
  - **Inputs (from CFN props):** UserPoolId, ClientId, SecretArn, Username (e.g. `gateway-service`). Optional: `ForceRecreate` (string/boolean) for emergency password reset.
  - **Create (prefer existence check over exception flow):** First call `AdminGetUser`. If user exists → skip creation and **do not** call `PutSecretValue` (leave existing secret). If user does not exist → generate random password; `AdminCreateUser` (MessageAction SUPPRESS) with user attributes (see below); `AdminSetUserPassword` (Permanent true); **then** `PutSecretValue` with the agreed secret JSON. Fallback: if `AdminCreateUser` throws `UsernameExistsException` (e.g. race), log “Service user already exists, skipping creation” and do not overwrite secret.
  - **Update:** No-op unless `ForceRecreate` is set; then regenerate password, `AdminSetUserPassword`, **and** `PutSecretValue` (new version). Do **not** call `PutSecretValue` on update when ForceRecreate is not set (avoids unnecessary secret versions and keeps rotation history clean).
  - **Delete:** No-op (leave Cognito user for safety).
  - **User attributes (Cognito):** Set for identification and audit: `email_verified: true`, `custom:service_type: gateway-service`, `custom:created_by: cdk-automation`. Use a placeholder email if required (e.g. `gateway-service@internal`). Requires custom attributes to exist on the pool (see Prerequisites).
  - **Error handling:** Use `AdminGetUser` for idempotency (cleaner than exception-driven flow); re-throw all unexpected errors. Use CloudWatch logging for all operations (create/skip/update/failure).
  - **IAM (least privilege):** Custom resource role only: `cognito-idp:AdminCreateUser`, `cognito-idp:AdminSetUserPassword`, `cognito-idp:AdminGetUser` (for existence check), `secretsmanager:PutSecretValue` on the single secret. Scope to the specific UserPool ARN and Secret ARN.
- **ToolInvoker Lambda:**
  - Env: set `COGNITO_SERVICE_USER_SECRET_ARN` when userPool + userPoolClient are provided.
  - IAM: grant `secretsmanager:GetSecretValue` on that secret only.

#### 3.1.1 Secret structure

JSON stored in Secrets Manager (handler only needs `username` and `password`; rest for ops/audit):

```json
{
  "username": "gateway-service",
  "password": "<generated-password>",
  "userPoolId": "us-west-2_xxxxx",
  "clientId": "xxxxx",
  "createdAt": "2024-01-25T10:00:00Z"
}
```

### 3.2 Handler (tool-invoker-handler)

- **Behavior:** If `COGNITO_SERVICE_USER_SECRET_ARN` is set, call Secrets Manager `GetSecretValue`, parse JSON and read `username` and `password` (ignore extra fields), use for `InitiateAuth`. Else fall back to `COGNITO_SERVICE_USERNAME` + `COGNITO_SERVICE_PASSWORD` (current behavior).
- **Error:** If secret ARN is set but secret missing or malformed, throw `PermanentError` with a clear message.

### 3.3 Security

- No credentials in CDK code or in Lambda env when using secret.
- **Least privilege:** Custom resource: only the three Cognito actions above + PutSecretValue on the one secret. ToolInvoker: only GetSecretValue on that secret. No wildcards on secrets.
- **Secret rotation:** Document as future work (e.g. rotation Lambda that sets new password and updates secret); out of scope for this implementation.

### 3.4 Idempotency and updates

- **First deploy:** Custom resource calls `AdminGetUser`; user not found → create user, set permanent password, **then** write secret once.
- **Subsequent deploys:** Custom resource calls `AdminGetUser`; user found → skip creation and **do not** call `PutSecretValue` (password and secret unchanged).
- **Secret write semantics:** Call `PutSecretValue` only on create (new user) and on ForceRecreate. Do **not** write on update when ForceRecreate is not set (avoids unnecessary secret versions and keeps rotation history clean).
- **Force recreate:** Optional CFN property (e.g. change a timestamp) to trigger password regeneration, `AdminSetUserPassword`, and new `PutSecretValue` for emergency rotation.
- **Username change:** Out of scope for v1 (fixed username `gateway-service`).

### 3.5 Monitoring

- **Secrets Manager:** Alarm on the secret’s `GetSecretValue` errors (e.g. threshold 5 in 2 evaluation periods) so failures to read the JWT secret are visible.
- **ToolInvoker Lambda (recommended):** Alarm on **ToolInvoker Lambda errors** with message/pattern that indicates JWT or auth failure (e.g. `COGNITO_SERVICE_USER_SECRET_ARN`, `GetSecretValue`, `InitiateAuth`, malformed secret, auth failed). This catches malformed secret, auth failures, region mismatch, and client config errors that Secrets Manager metrics alone do not surface.
- **Custom resource:** Log all create/skip/update outcomes and errors to CloudWatch for troubleshooting.

---

## 4. Steps (implementation order)

1. **Prerequisites:** Ensure User Pool Client enables `USER_PASSWORD_AUTH` (and optionally `ALLOW_REFRESH_TOKEN_AUTH`). If the pool is owned by this stack, ensure custom attributes `service_type` and `created_by` are defined when creating the User Pool.
2. **Handler:** Add support for `COGNITO_SERVICE_USER_SECRET_ARN`: read secret, parse JSON for `username`/`password` (per 3.1.1), use in `InitiateAuth`; keep env-var fallback. Add unit test (mock Secrets Manager).
3. **CDK:** Create Secrets Manager secret in ExecutionInfrastructure when userPool + userPoolClient are provided.
4. **CDK:** Add custom resource Lambda: **first** `AdminGetUser` (if found → skip creation and do not write secret); if not found → create user (with user attributes), set password, **then** `PutSecretValue` once. Fallback on `UsernameExistsException` if needed. PutSecretValue only on create and on ForceRecreate. CloudWatch logging; IAM limited to AdminCreateUser, AdminSetUserPassword, AdminGetUser, PutSecretValue.
5. **CDK:** Pass `COGNITO_SERVICE_USER_SECRET_ARN` to ToolInvoker env; grant ToolInvoker `GetSecretValue` on that secret only.
6. **CDK:** Add CloudWatch alarm on secret `GetSecretValue` errors; add alarm on ToolInvoker Lambda errors (JWT/auth failure pattern) per 3.5.
7. **Docs:** Update JWT_NOT_CAUGHT_ASSESSMENT or README; document secret rotation strategy and User Pool Client prerequisites.

---

## 5. Out of scope (for this plan)

- Rotating the service user password automatically (document strategy only).
- Supporting multiple service users or per-tenant users for JWT in this path.
- Changing Gateway auth model (e.g. IAM instead of JWT).
- **Optional future hardening:** Using `ADMIN_USER_PASSWORD_AUTH` instead of `USER_PASSWORD_AUTH` for cleaner “service user” semantics; requires `cognito-idp:AdminInitiateAuth` and corresponding handler + IAM change. Document as an option for later.

**Secret rotation strategy (future):** Manual: set custom resource property `ForceRecreate` (e.g. new timestamp) and redeploy; custom resource regenerates password and updates secret. Automated: rotation Lambda could call `AdminSetUserPassword` and `PutSecretValue` on schedule; out of scope for this implementation.

---

## 6. Sign-off

- [ ] Plan reviewed; option C (custom resource + secret) agreed; refinements (AdminGetUser-first, prerequisites, secret write semantics, ToolInvoker alarm) incorporated.
- [ ] User Pool Client enables USER_PASSWORD_AUTH; custom attributes defined if pool is stack-owned.
- [ ] Handler secret support implemented and tested.
- [ ] Custom resource implemented; idempotency via AdminGetUser (fallback UsernameExistsException); PutSecretValue only on create and ForceRecreate; CloudWatch logging in place.
- [ ] IAM least privilege verified (custom resource + ToolInvoker).
- [ ] CloudWatch alarms: secret GetSecretValue errors and ToolInvoker Lambda JWT/auth failure pattern.
- [ ] CDK changes deployed in a dev environment; ToolInvoker obtains JWT and calls Gateway successfully.
