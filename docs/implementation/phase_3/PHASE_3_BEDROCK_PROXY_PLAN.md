# Phase 3: Bedrock VPC Interface Endpoint - Implementation Plan

**Review Date:** 2026-01-25  
**Status:** ✅ **IMPLEMENTED** - Bedrock VPC Interface Endpoint Configured

---

## Executive Summary

**Solution:** AWS Bedrock supports VPC Interface Endpoints (AWS PrivateLink), enabling full Zero Trust isolation without proxy Lambda functions.

**Implementation Status:** ✅ **COMPLETE** - Bedrock VPC endpoint implemented and configured

**Approach:** ✅ **Bedrock VPC Interface Endpoint** - Direct Bedrock access from VPC Lambda functions

**Benefits:**
- ✅ **Full Zero Trust Compliance** - All traffic stays within VPC
- ✅ **No Proxy Complexity** - Direct Bedrock calls via VPC endpoint
- ✅ **Lower Latency** - No Lambda-to-Lambda hop (~50-100ms saved)
- ✅ **Lower Cost** - No additional Lambda invocations
- ✅ **Simpler Architecture** - One less component to maintain

**Reference:** [AWS Bedrock VPC Interface Endpoints Documentation](https://docs.aws.amazon.com/bedrock/latest/userguide/vpc-interface-endpoints.html)

---

## Implementation Status

### ✅ Completed Components

1. ✅ **Bedrock VPC Interface Endpoint** - Added to `NeptuneInfrastructure.ts`
2. ✅ **Security Group Egress Rule** - Updated comment to include Bedrock
3. ✅ **IAM Permissions** - Region-restricted, resource-scoped for decision evaluation handler
4. ✅ **DecisionSynthesisService** - Already uses `BedrockRuntimeClient` directly (no changes needed)
5. ⚠️ **API Handler IAM Permissions** - Needs update (currently uses `resources: ['*']`)

---

## Implementation Details

### 1. Bedrock VPC Interface Endpoint ✅ **IMPLEMENTED**

**Location:** `src/stacks/constructs/NeptuneInfrastructure.ts` (lines 352-362)

**Implementation:**

```typescript
// ✅ Zero Trust: Add Bedrock Runtime VPC endpoint (AWS PrivateLink)
// This allows Lambda functions in isolated subnets to access Bedrock without internet access
// Service name: bedrock-runtime (for InvokeModel API calls)
new ec2.InterfaceVpcEndpoint(this, 'BedrockRuntimeEndpoint', {
  vpc: this.vpc,
  service: new ec2.InterfaceVpcEndpointService(`com.amazonaws.${props.region}.bedrock-runtime`, 443),
  privateDnsEnabled: true,
  subnets: {
    subnetType: ec2.SubnetType.PRIVATE_ISOLATED,  // ✅ Specify subnet type explicitly
  },
});
```

**Service Names Available:**
- `com.amazonaws.{region}.bedrock` - Control Plane API
- `com.amazonaws.{region}.bedrock-runtime` - Runtime API (for InvokeModel) ✅ **Implemented**
- `com.amazonaws.{region}.bedrock-agent` - Agents Build-time API
- `com.amazonaws.{region}.bedrock-agent-runtime` - Agents Runtime API

**Note:** We use `bedrock-runtime` because `DecisionSynthesisService` calls `InvokeModel`, which is part of the Runtime API.

**How It Works:**
- When `privateDnsEnabled: true`, AWS automatically routes DNS queries for `bedrock-runtime.{region}.amazonaws.com` to the VPC endpoint
- `BedrockRuntimeClient` automatically uses the VPC endpoint when Lambda is in VPC and DNS resolves to the endpoint
- No code changes needed in `DecisionSynthesisService` - it works transparently

---

### 2. Security Group Egress Rule ✅ **IMPLEMENTED**

**Location:** `src/stacks/constructs/DecisionInfrastructure.ts` (lines 156-163)

**Implementation:**

```typescript
// Allow HTTPS to AWS services via VPC endpoints
// Includes: DynamoDB, EventBridge, CloudWatch Logs, Bedrock (via VPC Interface Endpoint)
// ✅ Zero Trust: All AWS service access via VPC endpoints (no internet access required)
this.decisionEvaluationSecurityGroup.addEgressRule(
  ec2.Peer.ipv4(props.vpc.vpcCidrBlock),
  ec2.Port.tcp(443),
  'Allow HTTPS to AWS services via VPC endpoints (DynamoDB, EventBridge, CloudWatch Logs, Bedrock)'
);
```

**Note:** The existing rule already covers Bedrock (allows HTTPS to VPC CIDR), so only the comment was updated.

---

### 3. DecisionSynthesisService ✅ **NO CHANGES NEEDED**

**Status:** ✅ **Already correct** - Service uses `BedrockRuntimeClient` directly

**Current Implementation:**

```typescript
// src/services/decision/DecisionSynthesisService.ts
export class DecisionSynthesisService {
  constructor(
    private bedrockClient: BedrockRuntimeClient, // Direct Bedrock via VPC endpoint
    private modelId: string,
    private logger: Logger
  ) {}

  async synthesizeDecision(
    context: DecisionContextV1
  ): Promise<DecisionProposalV1> {
    // Direct Bedrock call via VPC endpoint (automatic routing)
    const response = await this.bedrockClient.send(new InvokeModelCommand({
      modelId: this.modelId,
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 4096,
        system: this.getSystemPrompt(),
        messages: [
          {
            role: 'user',
            content: this.buildPrompt(context)
          }
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'DecisionProposalV1',
            schema: this.getDecisionProposalSchema(),
            strict: true
          }
        }
      }),
      contentType: 'application/json',
      accept: 'application/json'
    }));
    
    // ... rest of implementation unchanged
  }
}
```

**Why This Works:**
- `BedrockRuntimeClient` automatically uses the VPC endpoint when:
  1. Lambda is in VPC
  2. VPC endpoint exists with `privateDnsEnabled: true`
  3. DNS resolution routes `bedrock-runtime.{region}.amazonaws.com` to the endpoint
- No code changes needed - AWS SDK handles routing automatically

**Handlers Using Bedrock:**
- ✅ `decision-evaluation-handler.ts` - Uses `DecisionSynthesisService`
- ✅ `decision-api-handler.ts` - Uses `DecisionSynthesisService` (for direct API calls)

---

### 4. IAM Permissions ✅ **IMPLEMENTED** (with minor enhancement needed)

**Location:** `src/stacks/constructs/DecisionInfrastructure.ts`

#### Decision Evaluation Handler ✅ **COMPLETE**

**Current Implementation (Lines 215-228):**

```typescript
// Grant Bedrock invoke permission (via VPC endpoint)
// ✅ Zero Trust: Region-restricted, resource-scoped permissions
decisionEvaluationRole.addToPolicy(new iam.PolicyStatement({
  effect: iam.Effect.ALLOW,
  actions: ['bedrock:InvokeModel'],
  resources: [
    `arn:aws:bedrock:${props.region || 'us-west-2'}::foundation-model/anthropic.claude-3-*`,
  ],
  conditions: {
    StringEquals: {
      'aws:RequestedRegion': props.region || 'us-west-2',
    },
  },
}));
```

**Status:** ✅ **Correct** - Region-restricted and resource-scoped

#### Decision API Handler ✅ **COMPLETE** (2026-01-25)

**Current Implementation (Lines 302-318):**

```typescript
// Grant Bedrock invoke permission (via VPC endpoint)
// ✅ Zero Trust: Region-restricted, resource-scoped permissions (matches decision evaluation handler)
this.decisionApiHandler.addToRolePolicy(new iam.PolicyStatement({
  effect: iam.Effect.ALLOW,
  actions: ['bedrock:InvokeModel'],
  resources: [
    `arn:aws:bedrock:${props.region || 'us-west-2'}::foundation-model/anthropic.claude-3-*`,
  ],
  conditions: {
    StringEquals: {
      'aws:RequestedRegion': props.region || 'us-west-2',
    },
  },
}));
```

**Status:** ✅ **Updated** - Now matches decision evaluation handler with region-restricted, resource-scoped permissions

**Rationale:** API handler also uses Bedrock (via `DecisionSynthesisService`), so it should have the same Zero Trust restrictions.

---

### 5. VPC Endpoint Policy (Optional - Defense in Depth)

**Status:** ⚠️ **NOT IMPLEMENTED** (Optional)

**Purpose:** Restrict which principals can use the VPC endpoint (defense in depth)

**Note:** VPC endpoint policies in CDK are set using the `policyDocument` property, not `addToPolicy`. However, IAM role permissions already restrict access, so this is optional.

**If Implementing:**

```typescript
import * as iam from 'aws-cdk-lib/aws-iam';

// Create Bedrock endpoint with policy
const bedrockEndpoint = new ec2.InterfaceVpcEndpoint(this, 'BedrockRuntimeEndpoint', {
  vpc: this.vpc,
  service: new ec2.InterfaceVpcEndpointService(`com.amazonaws.${props.region}.bedrock-runtime`, 443),
  privateDnsEnabled: true,
  subnets: {
    subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
  },
  // Optional: Add endpoint policy for defense in depth
  policyDocument: new iam.PolicyDocument({
    statements: [
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        principals: [decisionEvaluationRole, decisionApiRole], // Only specific roles
        actions: ['bedrock:InvokeModel'],
        resources: ['*'],
      }),
    ],
  }),
});
```

**Recommendation:** Optional - IAM role permissions already provide sufficient restriction. Endpoint policy adds defense in depth but increases complexity.

---

## Zero Trust Compliance Assessment

| Principle | Compliance | Notes |
|-----------|------------|-------|
| **Never Trust, Always Verify** | ✅ | IAM conditions verify caller identity and region |
| **Least Privilege Access** | ✅ | Roles have only Bedrock InvokeModel permission, region-restricted, resource-scoped |
| **Assume Breach** | ✅ | VPC isolation limits blast radius |
| **Verify Explicitly** | ✅ | All calls authenticated (IAM) and authorized (resource ARN) |
| **Network Segmentation** | ✅ | **Full compliance** - All traffic stays within VPC via PrivateLink |
| **Encryption in Transit** | ✅ | All calls use TLS (HTTPS) via VPC endpoint |
| **Audit Trail** | ✅ | All Bedrock calls logged with trace_id |

**Overall Assessment:** ✅ **Full Zero Trust Compliant** - No compromises needed!

**Minor Enhancement:** Update API handler IAM permissions to match evaluation handler (region-restricted, resource-scoped).

---

## Performance Considerations

1. **Latency:** VPC endpoint adds ~1-2ms latency (negligible)
   - **Impact:** Minimal - much better than Lambda-to-Lambda proxy (~50-100ms)
   - **Acceptable:** Standard for VPC endpoint access

2. **Cost Impact:** VPC Interface Endpoint pricing
   - **Estimate:** ~$7.20/month per AZ (standard VPC endpoint pricing)
   - **Acceptable:** Cost of maintaining Zero Trust isolation

3. **Availability:** VPC endpoints are highly available
   - **Impact:** No single point of failure
   - **Acceptable:** Standard AWS service availability

4. **DNS Resolution:** Private DNS automatically routes to endpoint
   - **Impact:** Transparent to application code
   - **Acceptable:** No code changes needed

---

## Implementation Checklist

- [x] Add Bedrock Runtime VPC endpoint to `NeptuneInfrastructure.ts` ✅ **COMPLETE**
- [x] Update security group egress rule comment in `DecisionInfrastructure.ts` ✅ **COMPLETE**
- [x] Verify Bedrock IAM permissions for decision evaluation handler ✅ **COMPLETE** (region-restricted)
- [x] Update API handler IAM permissions ✅ **COMPLETE** (2026-01-25 - changed from `resources: ['*']` to region-restricted, resource-scoped)
- [ ] Optional: Add VPC endpoint policy for additional security (defense in depth)
- [ ] Test end-to-end flow (VPC Lambda → Bedrock via VPC endpoint)
- [x] Update documentation with Bedrock VPC endpoint architecture ✅ **COMPLETE**

---

## Remaining Tasks

### 1. ✅ Update API Handler IAM Permissions - **COMPLETE** (2026-01-25)

**Location:** `src/stacks/constructs/DecisionInfrastructure.ts` (lines 302-318)

**Status:** ✅ **IMPLEMENTED** - Updated from `resources: ['*']` to region-restricted, resource-scoped permissions

**Implementation:**
```typescript
// Grant Bedrock invoke permission (via VPC endpoint)
// ✅ Zero Trust: Region-restricted, resource-scoped permissions (matches decision evaluation handler)
this.decisionApiHandler.addToRolePolicy(new iam.PolicyStatement({
  effect: iam.Effect.ALLOW,
  actions: ['bedrock:InvokeModel'],
  resources: [
    `arn:aws:bedrock:${props.region || 'us-west-2'}::foundation-model/anthropic.claude-3-*`,
  ],
  conditions: {
    StringEquals: {
      'aws:RequestedRegion': props.region || 'us-west-2',
    },
  },
}));
```

**Result:** Both handlers now have consistent, Zero Trust-aligned IAM permissions.

---

## Migration from Proxy Approach (If Previously Considered)

**Status:** ✅ **Not Needed** - Proxy approach was never implemented

If a proxy approach was previously implemented, migration steps would be:

1. ✅ Add Bedrock VPC endpoint to `NeptuneInfrastructure.ts` (already done)
2. ✅ Keep DecisionSynthesisService using `BedrockRuntimeClient` directly (already correct)
3. Remove Bedrock proxy handler (`bedrock-proxy-handler.ts`) - if exists
4. Remove proxy Lambda from `DecisionInfrastructure.ts` - if exists
5. Remove Lambda invoke permissions from decision evaluation role - if exists
6. Remove Lambda VPC endpoint - if added, no longer needed

**Migration effort:** N/A (proxy never implemented)

---

## Comparison: Proxy vs VPC Endpoint

| Aspect | Proxy Lambda | VPC Endpoint |
|--------|--------------|--------------|
| **Zero Trust Compliance** | ⚠️ Partial (proxy outside VPC) | ✅ Full (all traffic in VPC) |
| **Latency** | ~50-100ms (Lambda-to-Lambda) | ~1-2ms (VPC endpoint) |
| **Cost** | ~$0.20 per 1M requests | ~$7.20/month per AZ |
| **Complexity** | Higher (proxy handler, Lambda invoke) | Lower (direct calls) |
| **Maintenance** | More components | Fewer components |
| **Security** | Good (IAM restrictions) | Excellent (VPC isolation) |
| **Code Changes** | Requires proxy handler + service updates | No code changes needed |

**Winner:** ✅ **VPC Endpoint** - Better in every dimension

---

## Testing Recommendations

### Overview

**Testing Strategy:**
- ✅ **Unit Tests** - Already implemented (schema validation, policy determinism)
- ⚠️ **Integration Tests** - Need to add for Bedrock VPC endpoint validation
- ✅ **Contract Tests** - Already implemented (Phase 3 certification tests)

**Test Environment:**
- Integration tests must run from within VPC (same as Phase 2 tests)
- Can use existing EC2 test runner infrastructure
- Tests should verify VPC endpoint routing and Zero Trust compliance

---

### 1. Unit Tests (Already Implemented)

**Status:** ✅ **COMPLETE**

**Files:**
- `src/tests/unit/decision/DecisionSynthesisService.test.ts` - Mock Bedrock client tests
- `src/tests/contract/phase3-certification.test.ts` - Schema validation tests

**Coverage:**
- ✅ Schema validation (DecisionProposalBodyV1Schema)
- ✅ Policy determinism
- ✅ Budget enforcement
- ✅ Action intent creation/editing

**Note:** Unit tests use mocked Bedrock client, so they don't test VPC endpoint routing.

---

### 2. Integration Tests (Recommended)

**Status:** ⚠️ **TO BE IMPLEMENTED**

**Purpose:** Verify Bedrock VPC endpoint works end-to-end from VPC Lambda

**Test File:** `src/tests/integration/phase3-bedrock-vpc.test.ts` (to be created)

**Prerequisites:**
- Infrastructure deployed (Bedrock VPC endpoint active)
- Test runner EC2 instance in VPC (can reuse Phase 2 test runner)
- Environment variables loaded from `.env`

**Test Scenarios:**

#### 2.1 End-to-End Decision Synthesis Test

**Test:** VPC Lambda → Bedrock via VPC endpoint

**Steps:**
1. Deploy infrastructure with Bedrock VPC endpoint
2. Create test account and posture state
3. Trigger decision evaluation (via API or EventBridge)
4. Verify Bedrock call succeeds
5. Check CloudWatch Logs for Bedrock API calls
6. Verify traffic stays within VPC (check VPC Flow Logs)

**Expected Result:**
- ✅ Decision synthesis succeeds
- ✅ Bedrock calls use VPC endpoint (visible in VPC Flow Logs)
- ✅ No internet gateway traffic for Bedrock calls
- ✅ Decision proposal is valid and stored

**Code Template:**
```typescript
describe('Phase 3 Bedrock VPC Endpoint Integration Tests', () => {
  it('should synthesize decision via Bedrock VPC endpoint', async () => {
    // 1. Setup test account and posture state
    // 2. Call decision evaluation handler
    // 3. Verify Bedrock call succeeds
    // 4. Verify proposal is valid
    // 5. Check VPC Flow Logs for endpoint usage
  });
});
```

#### 2.2 DNS Resolution Test

**Test:** Verify private DNS routes to VPC endpoint

**Steps:**
1. SSH into EC2 instance in VPC (test runner)
2. Run: `nslookup bedrock-runtime.{region}.amazonaws.com`
3. Verify DNS resolves to VPC endpoint IP (not public IP)
4. Verify IP is in VPC CIDR range

**Expected Result:**
- ✅ DNS resolves to private IP (VPC endpoint)
- ✅ No public IP resolution
- ✅ IP is within VPC CIDR block

**Manual Test:**
```bash
# From EC2 instance in VPC
nslookup bedrock-runtime.us-west-2.amazonaws.com
# Should return private IP (e.g., 10.0.x.x)
```

#### 2.3 IAM Permissions Test

**Test:** Verify region and resource restrictions work

**Steps:**
1. Attempt Bedrock call from different region (should fail)
2. Attempt Bedrock call with different model ARN (should fail if not matching pattern)
3. Verify only allowed models can be invoked
4. Check CloudTrail for denied API calls

**Expected Result:**
- ✅ Cross-region calls blocked (AccessDeniedException)
- ✅ Unauthorized model ARNs blocked
- ✅ Only `anthropic.claude-3-*` models allowed

**Code Template:**
```typescript
it('should block cross-region Bedrock calls', async () => {
  // Attempt to call Bedrock with different region
  // Should throw AccessDeniedException
});

it('should block unauthorized model ARNs', async () => {
  // Attempt to call Bedrock with non-Claude model
  // Should throw AccessDeniedException
});
```

#### 2.4 VPC Flow Logs Verification Test

**Test:** Verify all Bedrock traffic stays within VPC

**Steps:**
1. Trigger decision evaluation
2. Query VPC Flow Logs for Bedrock API calls
3. Verify source IP is Lambda ENI (in VPC)
4. Verify destination IP is VPC endpoint IP
5. Verify no internet gateway traffic

**Expected Result:**
- ✅ All Bedrock traffic uses VPC endpoint (private IPs)
- ✅ No internet gateway traffic for Bedrock calls
- ✅ Traffic stays within VPC CIDR

**Query Example:**
```bash
# Query VPC Flow Logs for Bedrock traffic
aws logs filter-log-events \
  --log-group-name /aws/vpc/cc-native-flow-logs \
  --filter-pattern "bedrock-runtime" \
  --region us-west-2
```

---

### 3. Manual Verification Tests

**Status:** ⚠️ **Manual Steps Required**

#### 3.1 CloudWatch Metrics Verification

**Steps:**
1. Navigate to CloudWatch → Metrics → VPC Endpoints
2. Select Bedrock VPC endpoint
3. Verify traffic metrics show activity
4. Verify no errors or throttling

**Expected Metrics:**
- `BytesIn` - Incoming traffic from Lambda
- `BytesOut` - Outgoing traffic to Bedrock
- `PacketsIn` - Incoming packets
- `PacketsOut` - Outgoing packets

#### 3.2 CloudTrail Audit Verification

**Steps:**
1. Navigate to CloudTrail → Event History
2. Filter by `bedrock:InvokeModel`
3. Verify all calls show:
   - Source IP: Lambda ENI (VPC IP)
   - User agent: AWS SDK
   - Region: Correct region
   - Resource ARN: Matches allowed pattern

**Expected Result:**
- ✅ All Bedrock calls logged in CloudTrail
- ✅ Source IPs are VPC IPs (not public)
- ✅ Region matches IAM condition

---

### 4. Performance Tests (Optional)

**Status:** ⚠️ **Optional**

#### 4.1 Latency Test

**Test:** Measure Bedrock call latency via VPC endpoint

**Steps:**
1. Trigger multiple decision evaluations
2. Measure time from Lambda start to Bedrock response
3. Compare with expected latency (~1-2ms for VPC endpoint)

**Expected Result:**
- ✅ Latency is acceptable (<100ms total, including Bedrock processing)
- ✅ VPC endpoint adds minimal overhead (~1-2ms)

#### 4.2 Throughput Test

**Test:** Verify Bedrock endpoint handles concurrent requests

**Steps:**
1. Trigger multiple concurrent decision evaluations
2. Verify all succeed
3. Check for throttling or errors

**Expected Result:**
- ✅ All concurrent requests succeed
- ✅ No throttling errors
- ✅ VPC endpoint handles load

---

### 5. Security Tests

**Status:** ⚠️ **Recommended**

#### 5.1 Zero Trust Compliance Test

**Test:** Verify no internet access is used for Bedrock

**Steps:**
1. Disable internet gateway (or verify it doesn't exist)
2. Trigger decision evaluation
3. Verify Bedrock call still succeeds
4. Verify VPC Flow Logs show only VPC endpoint traffic

**Expected Result:**
- ✅ Bedrock calls succeed without internet gateway
- ✅ All traffic uses VPC endpoint
- ✅ Full Zero Trust compliance verified

#### 5.2 IAM Policy Enforcement Test

**Test:** Verify IAM conditions are enforced

**Steps:**
1. Temporarily modify IAM policy to remove region condition
2. Attempt cross-region call (should still fail due to VPC endpoint)
3. Restore IAM policy
4. Verify region condition is enforced

**Expected Result:**
- ✅ IAM conditions are enforced
- ✅ Unauthorized calls are blocked
- ✅ Policy changes take effect immediately

---

### Test Implementation Checklist

- [ ] Create `src/tests/integration/phase3-bedrock-vpc.test.ts`
- [ ] Add test for end-to-end decision synthesis via VPC endpoint
- [ ] Add test for DNS resolution (private IP)
- [ ] Add test for IAM permissions (region/resource restrictions)
- [ ] Add test for VPC Flow Logs verification
- [ ] Add manual verification steps documentation
- [ ] Update test runner setup to include Bedrock permissions
- [ ] Document test execution process

---

### Test Execution

**Automated Tests (from EC2 test runner):**
```bash
# From EC2 instance in VPC
cd /path/to/cc-native
npm test -- src/tests/integration/phase3-bedrock-vpc.test.ts
```

**Manual Verification:**
- Use AWS Console to check VPC Flow Logs
- Use CloudWatch to monitor endpoint metrics
- Use CloudTrail to audit API calls

**Note:** Integration tests require VPC access (same as Phase 2 tests), so they must run from within the VPC or via VPN/bastion host.

---

## Troubleshooting

### Issue: Bedrock calls fail from VPC Lambda

**Symptoms:**
- Connection timeout errors
- DNS resolution failures

**Solutions:**
1. Verify Bedrock VPC endpoint is created and active
2. Verify security group allows HTTPS (443) to VPC CIDR
3. Verify `privateDnsEnabled: true` on endpoint
4. Check VPC Flow Logs for connection attempts
5. Verify Lambda is in same VPC as endpoint

### Issue: Bedrock calls succeed but use internet

**Symptoms:**
- Bedrock calls work but VPC Flow Logs show internet gateway traffic

**Solutions:**
1. Verify `privateDnsEnabled: true` on endpoint
2. Check DNS resolution: `nslookup bedrock-runtime.{region}.amazonaws.com`
3. Verify endpoint is in same VPC as Lambda
4. Check Route53 resolver rules (if custom DNS)

### Issue: IAM permission denied

**Symptoms:**
- `AccessDeniedException` from Bedrock

**Solutions:**
1. Verify IAM role has `bedrock:InvokeModel` permission
2. Verify resource ARN matches model being invoked
3. Verify region condition matches request region
4. Check CloudTrail for denied API calls

---

## Final Recommendation

✅ **VPC INTERFACE ENDPOINT APPROACH IS CORRECT AND IMPLEMENTED**

**Status:**
- ✅ Bedrock VPC endpoint: **IMPLEMENTED**
- ✅ Security group: **UPDATED**
- ✅ IAM permissions (evaluation handler): **COMPLETE** (region-restricted, resource-scoped)
- ✅ IAM permissions (API handler): **COMPLETE** (2026-01-25 - updated to region-restricted, resource-scoped)

**Next Steps:**
1. Test end-to-end flow (VPC Lambda → Bedrock via VPC endpoint)
2. Monitor VPC Flow Logs to verify traffic stays within VPC
3. Optional: Add VPC endpoint policy for defense in depth

---

## References

- [AWS Bedrock VPC Interface Endpoints Documentation](https://docs.aws.amazon.com/bedrock/latest/userguide/vpc-interface-endpoints.html)
- [AWS PrivateLink Guide](https://docs.aws.amazon.com/vpc/latest/privatelink/)
- [Bedrock Runtime API Reference](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_Operations_Amazon_Bedrock_Runtime.html)
- [CDK InterfaceVpcEndpoint Documentation](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_ec2.InterfaceVpcEndpoint.html)
