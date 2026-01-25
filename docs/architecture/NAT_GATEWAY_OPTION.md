# NAT Gateway Option for Test Runner

## Overview
This document outlines the option to add a NAT Gateway to enable internet access for the test runner instance, allowing `npm install` and `git clone` to work directly.

## Trade-offs

### Current Approach (Isolated Subnets, No NAT)
**Pros:**
- ✅ Zero-trust compliant (no internet access)
- ✅ Lower cost (~$0/month for NAT Gateway)
- ✅ More secure (no outbound internet)
- ✅ Aligns with production architecture

**Cons:**
- ❌ Need to bundle `node_modules` (~81M archive)
- ❌ Can't use `npm install` directly
- ❌ Can't clone from GitHub (use S3 deployment)

### NAT Gateway Approach
**Pros:**
- ✅ Can use `npm install` (smaller archives ~5M)
- ✅ Can clone from GitHub directly
- ✅ Simpler deployment workflow

**Cons:**
- ❌ Cost: ~$32/month + data transfer (~$0.045/GB)
- ❌ Less secure (internet access)
- ❌ Conflicts with zero-trust principles
- ❌ Requires public subnets

## Recommendation: Hybrid Approach

**Option 1: Keep Current (Recommended)**
- Keep production isolated (zero-trust)
- Use S3 deployment with bundled `node_modules`
- Current approach is working and secure

**Option 2: Add NAT Gateway for Test Subnets Only**
- Keep Neptune in isolated subnets (zero-trust)
- Create separate private subnets with NAT Gateway for test runner
- Test runner gets internet access, production stays isolated

## Implementation (Option 2)

If you choose to add NAT Gateway, modify `NeptuneInfrastructure.ts`:

```typescript
this.vpc = new ec2.Vpc(this, 'CCNativeVpc', {
  vpcName: 'cc-native-vpc',
  maxAzs: 2,
  natGateways: 1, // Add NAT Gateway for test subnets
  subnetConfiguration: [
    {
      cidrMask: 24,
      name: 'NeptuneIsolated',
      subnetType: ec2.SubnetType.PRIVATE_ISOLATED, // Neptune stays isolated
    },
    {
      cidrMask: 24,
      name: 'TestRunnerPrivate',
      subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, // Test runner with NAT
    },
  ],
});
```

Then update test runner scripts to use the private subnet instead of isolated.

## Cost Estimate

- NAT Gateway: ~$32/month
- Data transfer: ~$0.045/GB
- For test runs: ~$0.50-2.00/month (depends on frequency)

**Total: ~$32-34/month**

## Security Considerations

With NAT Gateway:
- Test runner can access internet
- Can download packages from npm registry
- Can clone from GitHub
- Still no direct inbound access (private subnet)
- VPC Flow Logs will show all outbound traffic

## Decision

**Current approach is recommended** because:
1. Zero-trust alignment (95% score)
2. Cost savings (~$32/month)
3. Current solution works (S3 + bundled node_modules)
4. Production stays fully isolated

**Add NAT Gateway if:**
- You frequently run tests and want faster iterations
- Cost is not a concern
- You're okay with test runner having internet access
- You want simpler deployment (no bundling)
