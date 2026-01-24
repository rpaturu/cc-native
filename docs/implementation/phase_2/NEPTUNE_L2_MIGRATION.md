# Neptune L2 Alpha Package Migration

## Status
✅ Code refactored to use L2 alpha package  
⏳ Package installation pending (network issue)

## Installation Required

Once network connectivity is available, install the Neptune L2 alpha package:

```bash
npm install @aws-cdk/aws-neptune-alpha@2.124.0 --save-exact
```

**Important:** Using `--save-exact` to pin the version and avoid unexpected breaking changes.

## Changes Made

### 1. Package.json
- Added `@aws-cdk/aws-neptune-alpha: "2.124.0"` to devDependencies (exact version pinning)

### 2. CDK Stack (`src/stacks/CCNativeStack.ts`)
- **Import:** Changed from `aws-cdk-lib/aws-neptune` to `@aws-cdk/aws-neptune-alpha`
- **Type:** Changed `neptuneCluster` from `cdk.CfnResource` to `neptune.DatabaseCluster`
- **Removed:** L1 construct code (CfnDBSubnetGroup, CfnDBClusterParameterGroup, CfnDBCluster, CfnDBInstance)
- **Added:** L2 `DatabaseCluster` construct with simplified configuration
- **Parameter Group:** Created custom parameter group with query timeout and audit logging
- **Outputs:** Updated to use L2 construct properties (`.clusterEndpoint.hostname`, `.clusterIdentifier`)

## Benefits of L2 Alpha Package

1. **Simplified Code:** ~50 lines reduced to ~20 lines
2. **Automatic Management:** Subnet groups, parameter groups, and instances handled automatically
3. **Better Type Safety:** Strongly-typed properties and methods
4. **Sensible Defaults:** Less boilerplate configuration needed
5. **Future-Proof:** Will become stable API eventually

## Configuration

The L2 construct automatically:
- Creates subnet group from VPC subnets
- Creates cluster and instances
- Handles security group associations
- Manages IAM authentication

Custom configuration:
- Parameter group with query timeout (120s) and audit logging
- Single instance (db.r5.large) for development
- IAM authentication enabled
- 7-day backup retention
- Encryption at rest enabled

## Next Steps

1. **Install package:** `npm install @aws-cdk/aws-neptune-alpha@2.124.0 --save-exact`
2. **Verify build:** `npm run build`
3. **Test deployment:** Deploy to development environment
4. **Monitor:** Watch for any alpha package breaking changes in future updates

## Version Pinning Strategy

- ✅ Exact version pinning (no `^` or `~`)
- ✅ Match CDK version (2.124.0)
- ⚠️ Read release notes before updating
- ⚠️ Test thoroughly after any alpha package updates

## Rollback Plan

If issues arise with L2 alpha package:
1. Revert import to `aws-cdk-lib/aws-neptune`
2. Restore L1 construct code (saved in git history)
3. Update type definitions accordingly
