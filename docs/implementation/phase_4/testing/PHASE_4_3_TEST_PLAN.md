# Phase 4.3 Testing Plan

**Status:** ✅ **COMPLETE**  
**Created:** 2026-01-27  
**Last Updated:** 2026-01-27  
**Parent Document:** `PHASE_4_3_CODE_LEVEL_PLAN.md`

---

## Executive Summary

This document outlines the comprehensive testing strategy for Phase 4.3 (Connectors). The plan includes **unit tests for adapter logic and handlers** (can be done now) and **integration tests** for Gateway → Adapter flow (requires deployed Gateway).

**Testing Philosophy:**
> Test adapter business logic early (unit tests), validate Gateway integration when infrastructure is available (integration tests).

### Implementation Status

**✅ Unit Tests: COMPLETE**

- **Expected Test Files:** 5 test files
- **Status:** All implemented and passing ✅
- **Test Count:** 66 total tests across 5 files

**Test Files Created:**
1. ✅ `InternalConnectorAdapter.test.ts` - Adapter logic, persistence, validation (18 tests)
2. ✅ `CrmConnectorAdapter.test.ts` - OAuth, tenant config, Salesforce integration, idempotency (20 tests)
3. ✅ `ConnectorConfigService.test.ts` - Tenant-scoped config retrieval, secrets handling (12 tests)
4. ✅ `internal-adapter-handler.test.ts` - Gateway event → MCPToolInvocation conversion (8 tests)
5. ✅ `crm-adapter-handler.test.ts` - Gateway event → MCPToolInvocation conversion (8 tests)

**🟡 Integration Tests: PLANNING**

- **Expected Test Files:** 2-3 test files
- **Status:** Not yet implemented
- **Dependencies:** Requires deployed Gateway and VPC infrastructure

**Test Files to Create:**
1. ⏳ `gateway-adapter-integration.test.ts` - Gateway → Adapter flow (real Gateway)
2. ⏳ `connector-adapters.test.ts` - Adapter execution flow (with mocked Gateway)
3. ⏳ `execution-flow-with-adapters.test.ts` - Full execution lifecycle with adapters

---

## Testing Strategy Overview

### Three-Tier Testing Approach

1. **Unit Tests (Phase 4.3 - Immediate Priority)**
   - Adapter business logic (InternalConnectorAdapter, CrmConnectorAdapter)
   - ConnectorConfigService (tenant-scoped config retrieval)
   - Handler event conversion (Gateway Lambda event → MCPToolInvocation)
   - Validation logic (tenant binding, required fields)
   - Idempotency handling (adapter-level dedupe)

2. **Integration Tests (Phase 4.3 - After Deployment)**
   - Gateway → Adapter flow (real Gateway, real Lambda functions)
   - VPC connectivity (adapter Lambdas in VPC)
   - Secrets Manager access (tenant-scoped secrets)
   - DynamoDB persistence (internal adapter)
   - External API calls (CRM adapter with mocked Salesforce)

3. **End-to-End Tests (Phase 4.3+)**
   - Full execution lifecycle: ACTION_APPROVED → Step Functions → ToolInvoker → Gateway → Adapter
   - External system integration (real Salesforce API calls in test environment)
   - Compensation scenarios (rollback for reversible actions)

---

## Unit Tests (Phase 4.3 - Immediate Priority)

### Priority 1: Adapter Logic (Critical Business Logic)

#### 1.1 InternalConnectorAdapter Tests

**File:** `src/tests/unit/adapters/internal/InternalConnectorAdapter.test.ts`

**Test Cases:**

1. **`execute()` - create_note**
   - ✅ Creates note in DynamoDB with correct partition key structure
   - ✅ Generates unique note_id
   - ✅ Persists before returning success
   - ✅ Returns MCPResponse with external_object_refs array
   - ✅ Includes invocationId in created_by field
   - ✅ Throws ValidationError if content missing
   - ✅ Throws ValidationError if tenant_id missing
   - ✅ Throws ValidationError if account_id missing
   - ✅ Throws ValidationError if tenant binding mismatch (identity.tenantId !== args.tenant_id)

2. **`execute()` - create_task**
   - ✅ Creates task in DynamoDB with correct partition key structure
   - ✅ Generates unique task_id
   - ✅ Persists before returning success
   - ✅ Returns MCPResponse with external_object_refs array
   - ✅ Throws ValidationError if title missing
   - ✅ Throws ValidationError if tenant_id/account_id missing
   - ✅ Throws ValidationError if tenant binding mismatch

3. **`execute()` - Unknown Tool**
   - ✅ Throws ValidationError for unknown tool name

4. **`validate()` - Parameter Validation**
   - ✅ Returns valid=true for correct parameters
   - ✅ Returns valid=false with error if tenant_id missing
   - ✅ Returns valid=false with error if account_id missing

**Mock Requirements:**
- Mock DynamoDBDocumentClient
- Mock PutCommand
- Test persistence before return (verify PutCommand called before response)

**Test Fixtures:**
- Valid MCPToolInvocation for create_note
- Valid MCPToolInvocation for create_task
- MCPToolInvocation with missing tenant_id
- MCPToolInvocation with tenant binding mismatch

---

#### 1.2 CrmConnectorAdapter Tests

**File:** `src/tests/unit/adapters/crm/CrmConnectorAdapter.test.ts`

**Test Cases:**

1. **`execute()` - Idempotency Check**
   - ✅ Returns existing external_object_refs if idempotency_key already exists
   - ✅ Skips Salesforce API call if dedupe found
   - ✅ Throws ValidationError if idempotency_key missing

2. **`execute()` - create_task - Validation**
   - ✅ Throws ValidationError if idempotency_key missing
   - ✅ Throws ValidationError if action_intent_id missing
   - ✅ Throws ValidationError if tenant_id/account_id missing
   - ✅ Throws ValidationError if tenant binding mismatch
   - ✅ Throws ValidationError if OAuth token missing

3. **`execute()` - create_task - Config Retrieval**
   - ✅ Gets Salesforce instance URL from ConnectorConfigService
   - ✅ Throws ConfigurationError if instance URL not found
   - ✅ Uses tenant_id and account_id for config lookup

4. **`execute()` - create_task - Salesforce API Call**
   - ✅ Calls Salesforce REST API with correct URL
   - ✅ Includes OAuth token in Authorization header
   - ✅ Includes Idempotency-Key header (best-effort)
   - ✅ Handles Salesforce response with "id" field
   - ✅ Handles Salesforce response with "Id" field
   - ✅ Throws ValidationError if response missing task ID
   - ✅ Throws ValidationError on 401/403 (auth failed)
   - ✅ Re-throws other errors for retry logic

5. **`execute()` - create_task - Dedupe Recording**
   - ✅ Records external_object_refs array in dedupe table
   - ✅ Includes action_intent_id in dedupe record
   - ✅ Includes full ExternalObjectRef (system, object_type, object_id, object_url)

6. **`execute()` - create_task - Response Format**
   - ✅ Returns MCPResponse with external_object_refs array
   - ✅ Includes object_url in ExternalObjectRef

7. **`validate()` - Parameter Validation**
   - ✅ Returns valid=true for correct parameters
   - ✅ Returns valid=false with error if title missing

**Mock Requirements:**
- Mock DynamoDBDocumentClient (for dedupe table)
- Mock SecretsManagerClient (for ConnectorConfigService)
- Mock ConnectorConfigService (or mock DynamoDB + Secrets Manager)
- Mock axios (for Salesforce API calls)
- Mock IdempotencyService (or test with real service)

**Test Fixtures:**
- Valid MCPToolInvocation for create_task
- MCPToolInvocation with existing idempotency_key (dedupe scenario)
- Salesforce API response with "id" field
- Salesforce API response with "Id" field
- Salesforce API error response (401, 403)

---

#### 1.3 ConnectorConfigService Tests

**File:** `src/tests/unit/execution/ConnectorConfigService.test.ts`

**Test Cases:**

1. **`getConnectorConfig()` - DynamoDB Config Retrieval**
   - ✅ Retrieves non-sensitive config from DynamoDB
   - ✅ Uses correct partition key (TENANT#{tenantId}#ACCOUNT#{accountId})
   - ✅ Uses correct sort key (CONNECTOR#{connectorType})
   - ✅ Returns instanceUrl from DynamoDB item
   - ✅ Returns apiEndpoint from DynamoDB item
   - ✅ Returns null if config not found

2. **`getConnectorConfig()` - Secrets Manager Retrieval**
   - ✅ Retrieves sensitive config from Secrets Manager
   - ✅ Uses account-specific secret ID: `tenant/{tenantId}/account/{accountId}/connector/{connectorType}`
   - ✅ Parses JSON secret string
   - ✅ Extracts apiKey from secret
   - ✅ Handles ResourceNotFoundException gracefully (returns null)
   - ✅ Logs warning for non-ResourceNotFound errors
   - ✅ Does NOT fall back to tenant-global secrets (account-specific only)

3. **`getConnectorConfig()` - Combined Config**
   - ✅ Merges DynamoDB config with Secrets Manager config
   - ✅ Returns null if both DynamoDB and Secrets Manager return empty
   - ✅ Returns config with only DynamoDB fields if secret not found
   - ✅ Returns config with only Secrets Manager fields if DynamoDB not found

**Mock Requirements:**
- Mock DynamoDBDocumentClient
- Mock SecretsManagerClient
- Mock GetCommand (DynamoDB)
- Mock GetSecretValueCommand (Secrets Manager)

**Test Fixtures:**
- DynamoDB item with connector config
- Secrets Manager secret with API key
- ResourceNotFoundException from Secrets Manager

---

### Priority 2: Handler Event Conversion

#### 2.1 InternalAdapterHandler Tests

**File:** `src/tests/unit/handlers/phase4/internal-adapter-handler.test.ts`

**Test Cases:**

1. **Gateway Event → MCPToolInvocation Conversion**
   - ✅ Extracts tool name from context.clientContext.custom.bedrockAgentCoreToolName
   - ✅ Removes target prefix (e.g., "internal-adapter___" from "internal-adapter___internal.create_note")
   - ✅ Preserves namespace if present (e.g., "internal.create_note")
   - ✅ Adds namespace if missing (e.g., "create_note" → "internal.create_note")
   - ✅ Extracts gatewayId, targetId, mcpMessageId from context
   - ✅ Uses mcpMessageId as invocation.id
   - ✅ Falls back to generated ID if mcpMessageId missing
   - ✅ Converts event data to MCPToolInvocation.params.arguments
   - ✅ Extracts identity context (accessToken, tenantId, userId)

2. **Adapter Execution**
   - ✅ Calls adapter.execute() with converted MCPToolInvocation
   - ✅ Returns MCPResponse from adapter
   - ✅ Handles ValidationError from adapter
   - ✅ Logs invocation details

**Mock Requirements:**
- Mock Lambda Context with clientContext.custom
- Mock InternalConnectorAdapter
- Mock DynamoDBDocumentClient

**Test Fixtures:**
- Gateway Lambda event (with tool name, arguments)
- Lambda Context with bedrockAgentCoreToolName
- Lambda Context with identity context

---

#### 2.2 CrmAdapterHandler Tests

**File:** `src/tests/unit/handlers/phase4/crm-adapter-handler.test.ts`

**Test Cases:**

1. **Gateway Event → MCPToolInvocation Conversion**
   - ✅ Extracts tool name from context.clientContext.custom.bedrockAgentCoreToolName
   - ✅ Removes target prefix (e.g., "crm-adapter___" from "crm-adapter___crm.create_task")
   - ✅ Preserves namespace if present (e.g., "crm.create_task")
   - ✅ Adds namespace if missing (e.g., "create_task" → "crm.create_task")
   - ✅ Extracts identity context (OAuth token for outbound calls)
   - ✅ Converts event data to MCPToolInvocation.params.arguments

2. **Adapter Execution**
   - ✅ Calls adapter.execute() with converted MCPToolInvocation
   - ✅ Returns MCPResponse from adapter
   - ✅ Handles ValidationError from adapter
   - ✅ Handles ConfigurationError from adapter

**Mock Requirements:**
- Mock Lambda Context with clientContext.custom
- Mock CrmConnectorAdapter
- Mock DynamoDBDocumentClient
- Mock SecretsManagerClient

**Test Fixtures:**
- Gateway Lambda event (with tool name, arguments, OAuth token)
- Lambda Context with identity context (accessToken)

---

## Integration Tests (Phase 4.3 - After Deployment)

### Priority 1: Gateway → Adapter Flow

#### 3.1 Gateway Adapter Integration Tests

**File:** `src/tests/integration/execution/gateway-adapter-integration.test.ts`

**Test Scenarios:**

1. **Internal Adapter - create_note**
   - ✅ Invoke Gateway with internal.create_note tool
   - ✅ Verify Gateway routes to internal-adapter-handler Lambda
   - ✅ Verify Lambda receives correct event structure
   - ✅ Verify note is created in DynamoDB
   - ✅ Verify MCPResponse returned to Gateway
   - ✅ Verify external_object_refs in response

2. **Internal Adapter - create_task**
   - ✅ Invoke Gateway with internal.create_task tool
   - ✅ Verify task is created in DynamoDB
   - ✅ Verify response format

3. **CRM Adapter - create_task (Mocked Salesforce)**
   - ✅ Invoke Gateway with crm.create_task tool
   - ✅ Verify Gateway routes to crm-adapter-handler Lambda
   - ✅ Verify Lambda retrieves tenant-scoped config
   - ✅ Verify Lambda calls Salesforce API (mocked)
   - ✅ Verify dedupe record is created
   - ✅ Verify response includes external_object_refs

4. **CRM Adapter - Idempotency**
   - ✅ Invoke Gateway twice with same idempotency_key
   - ✅ Verify second call returns existing external_object_refs
   - ✅ Verify Salesforce API called only once

5. **Error Handling**
   - ✅ Verify ValidationError returned as MCP error response
   - ✅ Verify ConfigurationError returned as MCP error response
   - ✅ Verify tenant binding validation works

**Test Environment:**
- Real AgentCore Gateway (deployed)
- Real Lambda functions (deployed in VPC)
- Real DynamoDB tables
- Mocked Salesforce API (using nock or similar)

**Prerequisites:**
- Gateway deployed and ready
- Adapter Lambdas deployed
- VPC endpoints configured
- Test data seeded (connector config)

---

#### 3.2 Connector Adapters Integration Tests

**File:** `src/tests/integration/execution/connector-adapters.test.ts`

**Test Scenarios:**

1. **Internal Adapter - Full Flow**
   - ✅ Create MCPToolInvocation directly
   - ✅ Call InternalConnectorAdapter.execute()
   - ✅ Verify DynamoDB persistence
   - ✅ Verify response format

2. **CRM Adapter - Full Flow (Mocked Salesforce)**
   - ✅ Create MCPToolInvocation with OAuth token
   - ✅ Seed connector config in DynamoDB
   - ✅ Call CrmConnectorAdapter.execute()
   - ✅ Verify Salesforce API call (mocked)
   - ✅ Verify dedupe record created
   - ✅ Verify response format

3. **ConnectorConfigService - Real AWS**
   - ✅ Store config in DynamoDB
   - ✅ Store secret in Secrets Manager
   - ✅ Call ConnectorConfigService.getConnectorConfig()
   - ✅ Verify merged config returned

**Test Environment:**
- Real DynamoDB tables
- Real Secrets Manager
- Mocked Salesforce API
- Real AWS SDK clients

---

#### 3.3 Execution Flow with Adapters

**File:** `src/tests/integration/execution/execution-flow-with-adapters.test.ts`

**Test Scenarios:**

1. **Full Execution Lifecycle - Internal Adapter**
   - ✅ Create ActionIntentV1
   - ✅ Approve action (triggers ACTION_APPROVED event)
   - ✅ Wait for Step Functions execution
   - ✅ Verify ToolInvoker calls Gateway
   - ✅ Verify Gateway routes to internal-adapter-handler
   - ✅ Verify note/task created
   - ✅ Verify ExecutionOutcomeV1 recorded
   - ✅ Verify external_object_refs in outcome

2. **Full Execution Lifecycle - CRM Adapter**
   - ✅ Create ActionIntentV1 for CRM action
   - ✅ Approve action
   - ✅ Verify ToolInvoker → Gateway → CRM adapter flow
   - ✅ Verify Salesforce API called (mocked)
   - ✅ Verify dedupe record created
   - ✅ Verify outcome recorded

3. **Idempotency - Full Flow**
   - ✅ Execute action twice (same idempotency_key)
   - ✅ Verify second execution returns existing external_object_refs
   - ✅ Verify no duplicate writes

**Test Environment:**
- Real Step Functions state machine
- Real EventBridge
- Real Gateway
- Real adapter Lambdas
- Mocked external APIs

---

## Test Fixtures

### Adapter Test Fixtures

**Directory:** `src/tests/fixtures/execution/adapters/`

**Files:**
- `mcp-tool-invocation-internal-create-note.json` - Valid MCPToolInvocation for create_note
- `mcp-tool-invocation-internal-create-task.json` - Valid MCPToolInvocation for create_task
- `mcp-tool-invocation-crm-create-task.json` - Valid MCPToolInvocation for create_task
- `mcp-tool-invocation-tenant-mismatch.json` - Invalid (tenant binding mismatch)
- `mcp-tool-invocation-missing-fields.json` - Invalid (missing required fields)
- `gateway-lambda-event-internal.json` - Gateway Lambda event for internal adapter
- `gateway-lambda-event-crm.json` - Gateway Lambda event for CRM adapter
- `lambda-context-with-identity.json` - Lambda Context with identity context
- `salesforce-api-response-id.json` - Salesforce response with "id" field
- `salesforce-api-response-Id.json` - Salesforce response with "Id" field
- `salesforce-api-error-401.json` - Salesforce 401 error response
- `connector-config-dynamodb-item.json` - DynamoDB item for connector config
- `connector-secret-secrets-manager.json` - Secrets Manager secret structure

---

## Mock Strategy

### Unit Tests

1. **DynamoDB Mocks**
   - Use existing `mockDynamoDBDocumentClient` from `src/tests/__mocks__/aws-sdk-clients.ts`
   - Mock `PutCommand`, `GetCommand` for adapter tests
   - Test conditional write logic

2. **Secrets Manager Mocks**
   - Mock `GetSecretValueCommand`
   - Test ResourceNotFoundException handling
   - Test secret parsing

3. **HTTP Mocks (CRM Adapter)**
   - Mock axios for Salesforce API calls
   - Use `nock` or `msw` for HTTP mocking
   - Test different response shapes ("id" vs "Id")
   - Test error responses (401, 403, 500)

4. **Lambda Context Mocks**
   - Mock `context.clientContext.custom` structure
   - Mock identity context
   - Test tool name extraction logic

### Integration Tests

1. **Real AWS Services**
   - Real DynamoDB tables
   - Real Secrets Manager
   - Real Gateway (deployed)
   - Real Lambda functions (deployed)

2. **Mocked External APIs**
   - Mock Salesforce API (nock or similar)
   - Test different response scenarios
   - Test error scenarios

---

## Implementation Priority

### Phase 4.3 (Now) - Unit Tests

**High Priority:**
1. ⏳ InternalConnectorAdapter.test.ts (adapter logic, persistence)
2. ⏳ CrmConnectorAdapter.test.ts (OAuth, config, Salesforce integration)
3. ⏳ ConnectorConfigService.test.ts (tenant-scoped config retrieval)
4. ⏳ internal-adapter-handler.test.ts (event conversion)
5. ⏳ crm-adapter-handler.test.ts (event conversion)

**Medium Priority:**
6. ⏳ Integration tests (after Gateway deployment)

---

## Test Coverage Goals

- **Unit Test Coverage:** >90% for adapter logic
- **Integration Test Coverage:** Critical paths (Gateway → Adapter flow)
- **Error Scenarios:** All validation errors, configuration errors, API errors

---

## Notes

- Adapter tests should focus on business logic (validation, persistence, API calls)
- Handler tests should focus on event conversion (Gateway event → MCPToolInvocation)
- Integration tests require deployed Gateway and VPC infrastructure
- Mock external APIs (Salesforce) to avoid dependencies on external systems
- Test idempotency behavior (adapter-level dedupe)
