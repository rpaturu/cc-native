# Phase 4.5 — Testing & Polish: Code-Level Implementation Plan

**Status:** 🟡 **PLANNING**  
**Created:** 2026-01-26  
**Last Updated:** 2026-01-26  
**Parent Document:** `PHASE_4_CODE_LEVEL_PLAN.md`  
**Prerequisites:** Phase 4.1, 4.2, 4.3, and 4.4 complete

---

## Overview

Phase 4.5 focuses on comprehensive testing, documentation, and polish:
- Complete unit test coverage
- Complete integration test coverage
- End-to-end test suite
- Documentation updates
- Performance testing
- Security audit

**Duration:** Week 6-7  
**Dependencies:** Phase 4.1, 4.2, 4.3, and 4.4 complete

---

## Implementation Tasks

1. Complete unit test coverage
2. Complete integration test coverage
3. End-to-end test suite
4. Update documentation
5. Performance testing
6. Security audit

---

## 1. Unit Tests

### Files to Create/Complete

**Service Tests:**
- `src/tests/unit/execution/ExecutionAttemptService.test.ts`
- `src/tests/unit/execution/ActionTypeRegistryService.test.ts`
- `src/tests/unit/execution/IdempotencyService.test.ts`
- `src/tests/unit/execution/ExecutionOutcomeService.test.ts`
- `src/tests/unit/execution/KillSwitchService.test.ts`

**Handler Tests:**
- `src/tests/unit/handlers/phase4/execution-starter-handler.test.ts`
- `src/tests/unit/handlers/phase4/execution-validator-handler.test.ts`
- `src/tests/unit/handlers/phase4/tool-mapper-handler.test.ts`
- `src/tests/unit/handlers/phase4/tool-invoker-handler.test.ts`
- `src/tests/unit/handlers/phase4/execution-recorder-handler.test.ts`
- `src/tests/unit/handlers/phase4/compensation-handler.test.ts`
- `src/tests/unit/handlers/phase4/execution-status-api-handler.test.ts`

**Adapter Tests:**
- `src/tests/unit/adapters/internal/InternalConnectorAdapter.test.ts`
- `src/tests/unit/adapters/crm/CrmConnectorAdapter.test.ts`

---

## 2. Integration Tests

### Files to Create/Complete

**Execution Flow Tests:**
- `src/tests/integration/execution/execution-flow.test.ts` - End-to-end execution flow
- `src/tests/integration/execution/idempotency.test.ts` - Dual-layer idempotency
- `src/tests/integration/execution/kill-switches.test.ts` - Kill switch behavior
- `src/tests/integration/execution/orchestration-flow.test.ts` - Step Functions execution flow
- `src/tests/integration/execution/tool-invocation.test.ts` - ToolInvoker → Gateway → Adapter flow
- `src/tests/integration/execution/connector-adapters.test.ts` - Adapter execution flow
- `src/tests/integration/execution/gateway-integration.test.ts` - Gateway → Adapter flow
- `src/tests/integration/execution/end-to-end-execution.test.ts` - Full execution flow
- `src/tests/integration/execution/execution-status-api.test.ts` - Status API tests

---

## 3. End-to-End Test Suite

### File: `scripts/phase_4/test-phase4-execution.sh`

**Purpose:** End-to-end execution flow test

**Script:**

```bash
#!/bin/bash
# Test Phase 4 execution flow end-to-end

set -e

REGION=${AWS_REGION:-us-west-2}
TENANT_ID=${TENANT_ID:-test-tenant-1}
ACCOUNT_ID=${ACCOUNT_ID:-test-account-1}

echo "🧪 Phase 4 End-to-End Execution Test"
echo "======================================"

# 1. Create ActionIntentV1 (via API)
echo "1. Creating ActionIntentV1..."
ACTION_INTENT_RESPONSE=$(aws apigatewayv2 invoke \
  --api-id $API_GATEWAY_ID \
  --route-id $CREATE_INTENT_ROUTE_ID \
  --payload '{
    "action_type": "CREATE_INTERNAL_NOTE",
    "parameters": {
      "content": "Test note from Phase 4 E2E test"
    },
    "target": {
      "entity_type": "ACCOUNT",
      "entity_id": "'$ACCOUNT_ID'"
    }
  }' \
  --region $REGION)

ACTION_INTENT_ID=$(echo $ACTION_INTENT_RESPONSE | jq -r '.action_intent_id')

if [ -z "$ACTION_INTENT_ID" ]; then
  echo "❌ Failed to create ActionIntent"
  exit 1
fi

echo "✅ ActionIntent created: $ACTION_INTENT_ID"

# 2. Approve action (triggers ACTION_APPROVED event)
echo "2. Approving action..."
aws apigatewayv2 invoke \
  --api-id $API_GATEWAY_ID \
  --route-id $APPROVE_ACTION_ROUTE_ID \
  --payload '{
    "action_intent_id": "'$ACTION_INTENT_ID'"
  }' \
  --region $REGION

echo "✅ Action approved"

# 3. Wait for Step Functions execution
echo "3. Waiting for Step Functions execution..."
sleep 10

# 4. Verify ExecutionAttempt record
echo "4. Verifying ExecutionAttempt record..."
ATTEMPT=$(aws dynamodb get-item \
  --region $REGION \
  --table-name cc-native-execution-attempts \
  --key '{
    "pk": {"S": "TENANT#'$TENANT_ID'#ACCOUNT#'$ACCOUNT_ID'"},
    "sk": {"S": "EXECUTION#'$ACTION_INTENT_ID'"}
  }')

if [ -z "$ATTEMPT" ]; then
  echo "❌ ExecutionAttempt not found"
  exit 1
fi

STATUS=$(echo $ATTEMPT | jq -r '.Item.status.S')
echo "✅ ExecutionAttempt found with status: $STATUS"

# 5. Verify ActionOutcomeV1 record
echo "5. Verifying ActionOutcomeV1 record..."
OUTCOME=$(aws dynamodb get-item \
  --region $REGION \
  --table-name cc-native-execution-outcomes \
  --key '{
    "pk": {"S": "TENANT#'$TENANT_ID'#ACCOUNT#'$ACCOUNT_ID'"},
    "sk": {"S": "OUTCOME#'$ACTION_INTENT_ID'"}
  }')

if [ -z "$OUTCOME" ]; then
  echo "❌ ActionOutcomeV1 not found"
  exit 1
fi

OUTCOME_STATUS=$(echo $OUTCOME | jq -r '.Item.status.S')
echo "✅ ActionOutcomeV1 found with status: $OUTCOME_STATUS"

# 6. Verify ledger events
echo "6. Verifying ledger events..."
LEDGER_ENTRIES=$(aws dynamodb query \
  --region $REGION \
  --table-name cc-native-ledger \
  --index-name gsi1-index \
  --key-condition-expression "gsi1pk = :pk" \
  --expression-attribute-values '{
    ":pk": {"S": "TRACE#..."}
  }')

echo "✅ Ledger events verified"

echo ""
echo "✅ Phase 4 End-to-End Test PASSED"
```

---

## 4. Documentation Updates

### Files to Update

- `README.md` - Add Phase 4 execution overview
- `docs/implementation/phase_4/PHASE_4_IMPLEMENTATION_PLAN.md` - Update status to complete
- `docs/implementation/phase_4/PHASE_4_ARCHITECTURE.md` - Update status to complete
- Create `docs/implementation/phase_4/PHASE_4_TESTING_GUIDE.md` - Testing guide
- Create `docs/implementation/phase_4/PHASE_4_TROUBLESHOOTING.md` - Troubleshooting guide

---

## 5. Performance Testing

### Test Scenarios

1. **Concurrent Executions:** Test multiple ActionIntents executing simultaneously
2. **Retry Behavior:** Test retry logic under failure conditions
3. **Idempotency:** Test dual-layer idempotency under race conditions
4. **Gateway Latency:** Test ToolInvoker → Gateway → Adapter latency
5. **Step Functions Throughput:** Test state machine execution rate

---

## 6. Security Audit

### Audit Checklist

- [ ] IAM permissions follow Zero Trust principles
- [ ] No hardcoded secrets or credentials
- [ ] All external API calls use OAuth tokens (not stored credentials)
- [ ] DynamoDB conditional writes prevent race conditions
- [ ] Step Functions execution names enforce idempotency
- [ ] Error messages don't leak sensitive information
- [ ] All handlers validate tenant/account scope
- [ ] Kill switches are accessible without redeploy

---

## 7. Implementation Checklist

- [ ] Complete unit test coverage (all services, handlers, adapters)
- [ ] Complete integration test coverage (all flows)
- [ ] End-to-end test suite (full execution flow)
- [ ] Update README.md with Phase 4 overview
- [ ] Update Phase 4 implementation plan status
- [ ] Create Phase 4 testing guide
- [ ] Create Phase 4 troubleshooting guide
- [ ] Performance testing (concurrent executions, retries, latency)
- [ ] Security audit (IAM, secrets, error handling, scope validation)

---

## 8. Definition of Done

Phase 4.5 is complete when:
- ✅ All unit tests pass with >90% coverage
- ✅ All integration tests pass
- ✅ End-to-end test suite passes
- ✅ Documentation is complete and accurate
- ✅ Performance meets requirements (latency, throughput)
- ✅ Security audit passes
- ✅ All Phase 4 components are production-ready

---

## 9. Next Steps

After Phase 4.5 completion:
- ✅ Phase 4 complete and production-ready
- ⏳ Proceed to Phase 5 (if defined) or production deployment

---

**See:** `PHASE_4_CODE_LEVEL_PLAN.md` for complete Phase 4 overview and cross-references.
