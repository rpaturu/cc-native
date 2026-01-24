# Zero Trust Architecture Implementation Plan

## Overview
This document provides a detailed, code-level implementation plan to transform the cc-native stack into a fully zero trust architecture. The plan addresses network micro-segmentation, enhanced monitoring, stricter access controls, and comprehensive security hardening.

## Prerequisites

Before implementing this plan, ensure you have:

- **AWS CDK v2** installed and configured
- **AWS account** with permissions to create:
  - VPC endpoints (interface and gateway)
  - KMS keys and aliases
  - CloudWatch Logs groups and metric filters
  - SNS topics and subscriptions
  - IAM roles and policies
- **Neptune cluster** must support audit logging (engine version 1.2.0.0 or later)
- **VPC Flow Logs** require CloudWatch Logs permissions
- **Network Firewall** (Phase 5, optional) - verify module availability in your CDK version

## Current State Assessment
- **Zero Trust Score**: ~70%
- **Strengths**: IAM authentication, encryption at rest/in-transit, network isolation
- **Gaps**: Network micro-segmentation, monitoring, per-function security groups, flow logs

---

## Required Imports

Add these imports at the top of `src/stacks/CCNativeStack.ts`:

```typescript
import * as logs from 'aws-cdk-lib/aws-logs';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cloudwatch_actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
```

---

## Implementation Phases

### Phase 1: Network Micro-Segmentation (Priority: High)
**Goal**: Implement per-function security groups and restrict outbound traffic

#### 1.1 Create Per-Function Security Groups

**File**: `src/stacks/CCNativeStack.ts`

**Step 1**: Update the interface at the top of the file (around line 24):

```typescript
/**
 * Internal properties for Neptune infrastructure
 * These are not exposed as readonly public properties
 */
interface NeptuneInternalProperties {
  neptuneLambdaSecurityGroup: ec2.SecurityGroup;  // Keep for backward compatibility
  graphMaterializerSecurityGroup: ec2.SecurityGroup;  // ✅ Add
  synthesisEngineSecurityGroup: ec2.SecurityGroup;  // ✅ Add
  neptuneSubnets: string[];
}
```

**Step 2**: Update `createNeptuneInfrastructure()` method

**Location**: `createNeptuneInfrastructure()` method

**Current Code** (lines 712-716):
```typescript
const lambdaSecurityGroup = new ec2.SecurityGroup(this, 'NeptuneLambdaSecurityGroup', {
  vpc: vpc,
  description: 'Security group for Lambda functions accessing Neptune',
  allowAllOutbound: true,
});
```

**Implementation**:
```typescript
// In createNeptuneInfrastructure():
// 1. Create base security group for Neptune (keep existing)
const neptuneSecurityGroup = new ec2.SecurityGroup(this, 'NeptuneSecurityGroup', {
  vpc: vpc,
  description: 'Security group for Neptune cluster (VPC-only access)',
  allowAllOutbound: false, // Already correct
});

// 2. Create per-function security groups
const graphMaterializerSecurityGroup = new ec2.SecurityGroup(this, 'GraphMaterializerSecurityGroup', {
  vpc: vpc,
  description: 'Security group for graph-materializer Lambda function',
  allowAllOutbound: false, // Restrict outbound
});

const synthesisEngineSecurityGroup = new ec2.SecurityGroup(this, 'SynthesisEngineSecurityGroup', {
  vpc: vpc,
  description: 'Security group for synthesis-engine Lambda function',
  allowAllOutbound: false, // Restrict outbound
});

// 3. Allow specific egress from Lambda security groups
// Graph Materializer needs: Neptune (8182), DynamoDB (443), EventBridge (443), CloudWatch Logs (443)
graphMaterializerSecurityGroup.addEgressRule(
  neptuneSecurityGroup,
  ec2.Port.tcp(8182),
  'Allow Gremlin connections to Neptune'
);

// Allow HTTPS to AWS services via VPC endpoints
// Note: VPC endpoints are within the VPC CIDR, so this allows access to them
graphMaterializerSecurityGroup.addEgressRule(
  ec2.Peer.ipv4(vpc.vpcCidrBlock),
  ec2.Port.tcp(443),
  'Allow HTTPS to AWS services via VPC endpoints (DynamoDB, EventBridge, CloudWatch Logs)'
);

// Synthesis Engine needs: Neptune (8182), DynamoDB (443), EventBridge (443), CloudWatch Logs (443)
synthesisEngineSecurityGroup.addEgressRule(
  neptuneSecurityGroup,
  ec2.Port.tcp(8182),
  'Allow Gremlin connections to Neptune'
);

synthesisEngineSecurityGroup.addEgressRule(
  ec2.Peer.ipv4(vpc.vpcCidrBlock),
  ec2.Port.tcp(443),
  'Allow HTTPS to AWS services via VPC endpoints (DynamoDB, EventBridge, CloudWatch Logs)'
);

// 4. Update Neptune ingress to allow from both security groups
// Remove the old ingress rule that used lambdaSecurityGroup
// Add new ingress rules for per-function security groups
neptuneSecurityGroup.addIngressRule(
  graphMaterializerSecurityGroup,
  ec2.Port.tcp(8182),
  'Allow Gremlin connections from graph-materializer Lambda'
);

neptuneSecurityGroup.addIngressRule(
  synthesisEngineSecurityGroup,
  ec2.Port.tcp(8182),
  'Allow Gremlin connections from synthesis-engine Lambda'
);

// 5. Store in internal properties
(this as unknown as CCNativeStack & NeptuneInternalProperties).graphMaterializerSecurityGroup = graphMaterializerSecurityGroup;
(this as unknown as CCNativeStack & NeptuneInternalProperties).synthesisEngineSecurityGroup = synthesisEngineSecurityGroup;
```

**Step 3**: Update `createPhase2Handlers()` method

**Location**: `createPhase2Handlers()` method

**Current Code** (lines 1087-1089):
```typescript
vpc: this.vpc,
vpcSubnets: { subnets: this.vpc.isolatedSubnets },
securityGroups: [neptuneLambdaSecurityGroup],
```

**Implementation**:
```typescript
// Get per-function security groups from internal properties
const graphMaterializerSecurityGroup = (this as any).graphMaterializerSecurityGroup as ec2.SecurityGroup;
const synthesisEngineSecurityGroup = (this as any).synthesisEngineSecurityGroup as ec2.SecurityGroup;

// Graph Materializer Handler
const graphMaterializerHandler = new lambdaNodejs.NodejsFunction(this, 'GraphMaterializerHandler', {
  // ... existing config ...
  vpc: this.vpc,
  vpcSubnets: { subnets: this.vpc.isolatedSubnets },
  securityGroups: [graphMaterializerSecurityGroup], // Use specific security group
});

// Synthesis Engine Handler
const synthesisEngineHandler = new lambdaNodejs.NodejsFunction(this, 'SynthesisEngineHandler', {
  // ... existing config ...
  vpc: this.vpc,
  vpcSubnets: { subnets: this.vpc.isolatedSubnets },
  securityGroups: [synthesisEngineSecurityGroup], // Use specific security group
});
```

#### 1.2 Add VPC Endpoints for DynamoDB, EventBridge, and CloudWatch Logs

**File**: `src/stacks/CCNativeStack.ts`
**Location**: `createNeptuneInfrastructure()` method, after existing VPC endpoints (around line 837)

**Implementation**:
```typescript
// Add DynamoDB VPC endpoint (interface endpoint)
new ec2.InterfaceVpcEndpoint(this, 'DynamoDBEndpoint', {
  vpc: vpc,
  service: new ec2.InterfaceVpcEndpointService(`com.amazonaws.${this.region}.dynamodb`, 443),
  privateDnsEnabled: true,
});

// Add EventBridge VPC endpoint (interface endpoint)
new ec2.InterfaceVpcEndpoint(this, 'EventBridgeEndpoint', {
  vpc: vpc,
  service: new ec2.InterfaceVpcEndpointService(`com.amazonaws.${this.region}.events`, 443),
  privateDnsEnabled: true,
});

// Add CloudWatch Logs endpoint (for Lambda logging)
// ⚠️ CRITICAL: Lambda functions in VPC cannot write logs without this endpoint
// Without this, Lambda logs will be lost and you won't see function output
// This is required for all Lambda functions running in VPC
new ec2.InterfaceVpcEndpoint(this, 'CloudWatchLogsEndpoint', {
  vpc: vpc,
  service: new ec2.InterfaceVpcEndpointService(`com.amazonaws.${this.region}.logs`, 443),
  privateDnsEnabled: true,
});
```

---

### Phase 2: Enhanced Monitoring and Logging (Priority: High)

#### 2.1 Enable VPC Flow Logs

**File**: `src/stacks/CCNativeStack.ts`
**Location**: `createNeptuneInfrastructure()` method, after VPC creation (around line 700)

**Implementation**:
```typescript
// Create CloudWatch Log Group for VPC Flow Logs
const vpcFlowLogGroup = new logs.LogGroup(this, 'VPCFlowLogGroup', {
  logGroupName: '/aws/vpc/cc-native-flow-logs',
  retention: logs.RetentionDays.ONE_MONTH, // Adjust as needed
  removalPolicy: cdk.RemovalPolicy.RETAIN, // Prevent accidental deletion
});

// Create IAM role for VPC Flow Logs
const vpcFlowLogRole = new iam.Role(this, 'VPCFlowLogRole', {
  assumedBy: new iam.ServicePrincipal('vpc-flow-logs.amazonaws.com'),
  description: 'IAM role for VPC Flow Logs',
});

vpcFlowLogRole.addToPolicy(new iam.PolicyStatement({
  effect: iam.Effect.ALLOW,
  actions: [
    'logs:CreateLogGroup',
    'logs:CreateLogStream',
    'logs:PutLogEvents',
    'logs:DescribeLogGroups',
    'logs:DescribeLogStreams',
  ],
  resources: [vpcFlowLogGroup.logGroupArn],
}));

// Enable VPC Flow Logs
new ec2.FlowLog(this, 'VPCFlowLog', {
  resourceType: ec2.FlowLogResourceType.fromVpc(vpc),
  destination: ec2.FlowLogDestination.toCloudWatchLogs(vpcFlowLogGroup, vpcFlowLogRole),
  trafficType: ec2.FlowLogTrafficType.ALL, // Log all traffic
});
```

#### 2.2 Create CloudWatch Alarms for Security Events

**File**: `src/stacks/CCNativeStack.ts`
**Location**: New method `createSecurityMonitoring()`, called from constructor

**Important**: This method must be called **AFTER** `createPhase2Handlers()` in the constructor to ensure Lambda functions exist.

**Implementation**:
```typescript
private createSecurityMonitoring(): void {
  // Create SNS topic for security alerts
  const securityAlertsTopic = new sns.Topic(this, 'SecurityAlertsTopic', {
    topicName: 'cc-native-security-alerts',
    displayName: 'CC Native Security Alerts',
  });

  // Add email subscription (replace with your email)
  // securityAlertsTopic.addSubscription(new subscriptions.EmailSubscription('security@example.com'));

  // Alarm 1: Unauthorized Neptune connection attempts
  new cloudwatch.Alarm(this, 'NeptuneUnauthorizedConnections', {
    alarmName: 'cc-native-neptune-unauthorized-connections',
    metric: new cloudwatch.Metric({
      namespace: 'AWS/Neptune',
      metricName: 'DatabaseConnections',
      dimensionsMap: {
        DBClusterIdentifier: this.neptuneCluster.ref,
      },
      statistic: 'Sum',
      period: cdk.Duration.minutes(5),
    }),
    threshold: 100, // Adjust based on baseline
    evaluationPeriods: 1,
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
  }).addAlarmAction(new cloudwatch_actions.SnsAction(securityAlertsTopic));

  // Alarm 2: Lambda function errors (potential security issues)
  // Note: These handlers must exist before this method is called
  const graphMaterializerErrors = new cloudwatch.Metric({
    namespace: 'AWS/Lambda',
    metricName: 'Errors',
    dimensionsMap: {
      FunctionName: this.graphMaterializerHandler.functionName,
    },
    statistic: 'Sum',
    period: cdk.Duration.minutes(5),
  });

  new cloudwatch.Alarm(this, 'GraphMaterializerErrors', {
    alarmName: 'cc-native-graph-materializer-errors',
    metric: graphMaterializerErrors,
    threshold: 5, // Alert if 5+ errors in 5 minutes
    evaluationPeriods: 1,
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
  }).addAlarmAction(new cloudwatch_actions.SnsAction(securityAlertsTopic));

  // Alarm 3: VPC Endpoint traffic monitoring
  // Note: VPC Flow Logs don't automatically create CloudWatch metrics
  // Monitor VPC endpoint traffic instead, or use CloudWatch Insights queries
  const vpcEndpointMetric = new cloudwatch.Metric({
    namespace: 'AWS/PrivateLinkEndpoints',
    metricName: 'BytesProcessed',
    statistic: 'Sum',
    period: cdk.Duration.minutes(5),
  });

  new cloudwatch.Alarm(this, 'HighVPCEndpointTraffic', {
    alarmName: 'cc-native-high-vpc-endpoint-traffic',
    metric: vpcEndpointMetric,
    threshold: 1000000000, // 1GB in 5 minutes (adjust as needed)
    evaluationPeriods: 2,
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
  }).addAlarmAction(new cloudwatch_actions.SnsAction(securityAlertsTopic));

  // Alarm 4: IAM authentication failures
  // Note: Neptune IAM auth failures are logged to CloudWatch Logs
  // This requires a log metric filter (see section 2.3)
}
```

**Add to constructor** (around line 489, after `createPhase2Handlers()`):
```typescript
this.createNeptuneInfrastructure();
this.createPhase2Tables();
this.createPhase2Handlers();
this.createSecurityMonitoring();  // ✅ Add this line - must be after createPhase2Handlers()
```

#### 2.3 Create Log Metric Filters for Security Events

**File**: `src/stacks/CCNativeStack.ts`
**Location**: `createSecurityMonitoring()` method (add to the end of the method)

**Implementation**:
```typescript
// Create log group for Neptune audit logs
// Note: To enable Neptune audit logs to this log group, you need to:
// 1. Set neptune_enable_audit_log: '1' in parameter group (already done in createNeptuneInfrastructure, line 741)
// 2. Configure CloudWatch Logs export via Neptune console or CLI after deployment
// 3. The log group name must match Neptune's expected format: /aws/neptune/cluster/{cluster-identifier}/audit
const neptuneAuditLogGroup = new logs.LogGroup(this, 'NeptuneAuditLogGroup', {
  logGroupName: `/aws/neptune/cluster/${this.neptuneCluster.ref}/audit`,  // Match Neptune format
  retention: logs.RetentionDays.ONE_MONTH,
});

// Metric filter for IAM authentication failures
new logs.MetricFilter(this, 'NeptuneIAMAuthFailure', {
  logGroup: neptuneAuditLogGroup,
  metricNamespace: 'CCNative/Security',
  metricName: 'NeptuneIAMAuthFailures',
  filterPattern: logs.FilterPattern.stringMatch('$message', '*AUTHENTICATION_FAILED*'),
  metricValue: '1',
});

// Create alarm for IAM auth failures
new cloudwatch.Alarm(this, 'NeptuneIAMAuthFailureAlarm', {
  alarmName: 'cc-native-neptune-iam-auth-failure',
  metric: new cloudwatch.Metric({
    namespace: 'CCNative/Security',
    metricName: 'NeptuneIAMAuthFailures',
    statistic: 'Sum',
    period: cdk.Duration.minutes(5),
  }),
  threshold: 3, // Alert if 3+ failures in 5 minutes
  evaluationPeriods: 1,
  treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
}).addAlarmAction(new cloudwatch_actions.SnsAction(securityAlertsTopic));
```

---

### Phase 3: Enhanced IAM and Access Controls (Priority: Medium)

#### 3.1 Implement Resource-Level IAM Policies with Conditions

**File**: `src/stacks/CCNativeStack.ts`
**Location**: `createPhase2Handlers()` method

**Current Code** (lines 1099-1109):
```typescript
graphMaterializerHandler.addToRolePolicy(new iam.PolicyStatement({
  effect: iam.Effect.ALLOW,
  actions: [
    'neptune-db:connect',
    'neptune-db:ReadDataViaQuery',
    'neptune-db:WriteDataViaQuery',
  ],
  resources: [
    `arn:aws:neptune-db:${this.region}:${this.account}:${this.neptuneCluster.ref}/*`,
  ],
}));
```

**Implementation**:
```typescript
// Enhanced IAM policy with conditions
// Note: Neptune only supports neptune-db:QueryLanguage as a service-specific condition key
// For encryption enforcement, use aws:SecureTransport instead
graphMaterializerHandler.addToRolePolicy(new iam.PolicyStatement({
  effect: iam.Effect.ALLOW,
  actions: [
    'neptune-db:connect',
    'neptune-db:ReadDataViaQuery',
    'neptune-db:WriteDataViaQuery',
  ],
  resources: [
    `arn:aws:neptune-db:${this.region}:${this.account}:${this.neptuneCluster.ref}/*`,
  ],
  conditions: {
    // Require encryption in transit (HTTPS/TLS)
    Bool: {
      'aws:SecureTransport': 'true',
    },
    // Optional: Restrict query language to Gremlin only
    StringEquals: {
      'neptune-db:QueryLanguage': 'gremlin',
    },
    // Time-based access control (optional - uncomment to restrict to business hours)
    // DateGreaterThan: {
    //   'aws:CurrentTime': '09:00Z',
    // },
    // DateLessThan: {
    //   'aws:CurrentTime': '17:00Z',
    // },
  },
}));

// Apply the same conditions to synthesisEngineHandler
synthesisEngineHandler.addToRolePolicy(new iam.PolicyStatement({
  effect: iam.Effect.ALLOW,
  actions: [
    'neptune-db:connect',
    'neptune-db:ReadDataViaQuery',
    'neptune-db:WriteDataViaQuery',
  ],
  resources: [
    `arn:aws:neptune-db:${this.region}:${this.account}:${this.neptuneCluster.ref}/*`,
  ],
  conditions: {
    Bool: {
      'aws:SecureTransport': 'true',
    },
    StringEquals: {
      'neptune-db:QueryLanguage': 'gremlin',
    },
  },
}));
```

#### 3.2 Add IP-Based Conditions (if applicable)

**File**: `src/stacks/CCNativeStack.ts`
**Location**: `createNeptuneInfrastructure()` method

**Implementation**:
```typescript
// If you need to restrict access to specific IP ranges (e.g., for EC2 test runner)
// Add this to the security group ingress rules
// Note: In isolated subnets, this is less relevant, but useful for documentation

// Example: Restrict Neptune access to VPC CIDR only
// (This is already enforced by security groups, but can be made explicit)
neptuneSecurityGroup.addIngressRule(
  ec2.Peer.ipv4(vpc.vpcCidrBlock),
  ec2.Port.tcp(8182),
  'Allow Gremlin connections from VPC CIDR only'
);
```

---

### Phase 4: Data Protection and Encryption (Priority: Medium)

#### 4.1 Enable KMS Encryption for Neptune

**File**: `src/stacks/CCNativeStack.ts`
**Location**: `createNeptuneInfrastructure()` method, before creating Neptune cluster

**Current Code** (line 754):
```typescript
storageEncrypted: true,
```

**Implementation**:
```typescript
// Create KMS key for Neptune encryption
const neptuneEncryptionKey = new kms.Key(this, 'NeptuneEncryptionKey', {
  description: 'KMS key for Neptune cluster encryption',
  enableKeyRotation: true,
  removalPolicy: cdk.RemovalPolicy.RETAIN,
});

// Add alias for easier management
// KMS alias names must start with 'alias/' prefix
new kms.Alias(this, 'NeptuneEncryptionKeyAlias', {
  aliasName: 'alias/cc-native-neptune',  // ✅ Prefix required
  targetKey: neptuneEncryptionKey,
});

// Update Neptune cluster to use KMS key
const neptuneCluster = new neptune.CfnDBCluster(this, 'NeptuneCluster', {
  // ... existing config ...
  storageEncrypted: true,
  kmsKeyId: neptuneEncryptionKey.keyId, // Add this
  // ... rest of config ...
});
```

#### 4.2 Add Data Classification Tags

**File**: `src/stacks/CCNativeStack.ts`
**Location**: Create helper methods, then apply throughout resource creation

**Implementation**:
```typescript
// Create helper methods for consistent tagging
// Option 1: For L1 constructs (like Neptune CfnDBCluster) - use CfnTag
private getSecurityTags(): cdk.CfnTag[] {
  return [
    { key: 'DataClassification', value: 'Confidential' },
    { key: 'SecurityLevel', value: 'High' },
    { key: 'ZeroTrust', value: 'Enabled' },
    { key: 'Compliance', value: 'SOC2' }, // Adjust as needed
  ];
}

// Option 2: For L2 constructs (like DynamoDB Table) - use plain objects
private getSecurityTagProps(): Record<string, string> {
  return {
    DataClassification: 'Confidential',
    SecurityLevel: 'High',
    ZeroTrust: 'Enabled',
    Compliance: 'SOC2',
  };
}

// Apply to Neptune cluster (L1 construct)
const neptuneCluster = new neptune.CfnDBCluster(this, 'NeptuneCluster', {
  // ... config ...
  tags: [
    { key: 'Name', value: 'cc-native-neptune-cluster' },
    ...this.getSecurityTags(),  // ✅ Use CfnTag array
  ],
});

// Apply to DynamoDB tables (L2 constructs)
this.accountsTable = new dynamodb.Table(this, 'AccountsTable', {
  // ... config ...
  tags: Object.entries(this.getSecurityTagProps()).map(([key, value]) => ({
    key,
    value,
  })),
});
```

---

### Phase 5: Network Policy Enforcement (Priority: Low)

#### 5.1 Consider AWS Network Firewall (Optional - Advanced)

**File**: `src/stacks/CCNativeStack.ts`
**Location**: New method `createNetworkFirewall()`, called from constructor

**Note**: AWS Network Firewall is a premium service. Only implement if you need advanced network policy enforcement.

**Important**: Verify Network Firewall module availability in your CDK version:
```bash
npm list aws-cdk-lib
# Check if aws-networkfirewall is available
```

**Implementation**:
```typescript
// Network Firewall may be in a separate module or not yet available in CDK v2
// If not available in aws-cdk-lib, you may need to use L1 Cfn constructs directly
// For now, this example assumes it's available

// Uncomment and verify module availability before using:
/*
import * as networkfirewall from 'aws-cdk-lib/aws-networkfirewall';

private createNetworkFirewall(): void {
  // Create Network Firewall rule group
  const firewallRuleGroup = new networkfirewall.CfnRuleGroup(this, 'NetworkFirewallRuleGroup', {
    capacity: 100,
    ruleGroupName: 'cc-native-firewall-rules',
    type: 'STATEFUL',
    ruleGroup: {
      rulesSource: {
        rulesSourceList: {
          generatedRulesType: 'DENYLIST',
          targets: ['malicious-domains.com'], // Example
          targetTypes: ['HTTP_HOST', 'TLS_SNI'],
        },
      },
    },
  });

  // Create Network Firewall policy
  const firewallPolicy = new networkfirewall.CfnFirewallPolicy(this, 'NetworkFirewallPolicy', {
    firewallPolicyName: 'cc-native-firewall-policy',
    firewallPolicy: {
      statelessDefaultActions: ['aws:forward_to_sfe'],
      statelessFragmentDefaultActions: ['aws:forward_to_sfe'],
      statefulRuleGroupReferences: [
        {
          resourceArn: firewallRuleGroup.attrRuleGroupArn,
        },
      ],
    },
  });

  // Create Network Firewall
  const networkFirewall = new networkfirewall.CfnFirewall(this, 'NetworkFirewall', {
    firewallName: 'cc-native-firewall',
    firewallPolicyArn: firewallPolicy.attrFirewallPolicyArn,
    vpcId: this.vpc.vpcId,
    subnetMappings: this.vpc.isolatedSubnets.map(subnet => ({
      subnetId: subnet.subnetId,
    })),
  });

  // Note: This requires additional routing configuration
  // Consider this optional and only for advanced use cases
}
*/
```

---

## Implementation Checklist

### Phase 1: Network Micro-Segmentation
- [ ] Update `NeptuneInternalProperties` interface at top of file
- [ ] Create per-function security groups for Graph Materializer and Synthesis Engine
- [ ] Restrict `allowAllOutbound` to `false` for all Lambda security groups
- [ ] Add specific egress rules for required destinations (Neptune, DynamoDB, EventBridge, CloudWatch Logs)
- [ ] Add VPC endpoints for DynamoDB, EventBridge, and CloudWatch Logs
- [ ] Update Lambda functions to use per-function security groups
- [ ] Remove old ingress rule using `lambdaSecurityGroup`
- [ ] Test Lambda functions can still access required services

### Phase 2: Enhanced Monitoring
- [ ] Add required imports (logs, cloudwatch, cloudwatch_actions, sns, subscriptions)
- [ ] Create CloudWatch Log Group for VPC Flow Logs
- [ ] Create IAM role for VPC Flow Logs
- [ ] Enable VPC Flow Logs for all traffic
- [ ] Create SNS topic for security alerts
- [ ] Create CloudWatch alarms for:
  - [ ] Unauthorized Neptune connections
  - [ ] Lambda function errors
  - [ ] High VPC endpoint traffic
  - [ ] IAM authentication failures
- [ ] Create log metric filters for security events
- [ ] Add `createSecurityMonitoring()` call to constructor (after `createPhase2Handlers()`)
- [ ] Configure Neptune audit logs export (via console/CLI after deployment)
- [ ] Test alarm notifications

### Phase 3: Enhanced IAM
- [ ] Fix Neptune IAM condition keys (use `aws:SecureTransport` instead of invalid key)
- [ ] Add condition-based IAM policies
- [ ] Implement time-based access controls (if needed)
- [ ] Add IP-based restrictions (if applicable)
- [ ] Review and tighten all IAM policies

### Phase 4: Data Protection
- [ ] Create KMS key for Neptune encryption
- [ ] Create KMS alias (with 'alias/' prefix)
- [ ] Update Neptune cluster to use KMS key
- [ ] Create tag helper methods (separate for L1 and L2 constructs)
- [ ] Add data classification tags to all resources
- [ ] Enable key rotation for all KMS keys

### Phase 5: Network Policy (Optional)
- [ ] Verify Network Firewall module availability
- [ ] Evaluate need for AWS Network Firewall
- [ ] Implement if required for compliance

---

## Testing Strategy

### Unit Tests
- Test security group egress rules allow only required traffic
- Test IAM policies enforce least privilege
- Test VPC Flow Logs are enabled
- Test tag helper methods return correct types

### Integration Tests
- Verify Lambda functions can access Neptune with new security groups
- Verify Lambda functions can access DynamoDB via VPC endpoint
- Verify Lambda functions can publish to EventBridge via VPC endpoint
- Verify Lambda functions can write CloudWatch Logs via VPC endpoint
- Verify CloudWatch alarms trigger on security events
- Verify Neptune audit logs are being written (after manual configuration)

### Security Testing
- Attempt unauthorized access (should be blocked)
- Verify encryption is enforced (TLS required)
- Test alarm notifications
- Verify IAM conditions block non-compliant requests

---

## Migration Plan

1. **Week 1**: Implement Phase 1 (Network Micro-Segmentation)
   - Deploy in development environment
   - Test thoroughly
   - Monitor for any connectivity issues
   - Verify Lambda logs are being written

2. **Week 2**: Implement Phase 2 (Enhanced Monitoring)
   - Deploy monitoring infrastructure
   - Configure alerts
   - Establish baseline metrics
   - Configure Neptune audit logs export (manual step)

3. **Week 3**: Implement Phase 3 & 4 (IAM & Data Protection)
   - Tighten IAM policies
   - Enable KMS encryption
   - Add data classification
   - Test IAM conditions

4. **Week 4**: Testing and Validation
   - Run full security test suite
   - Review CloudWatch metrics
   - Verify all alarms are functional
   - Document any issues

---

## Rollback Plan

If issues arise:
1. Revert security group changes (allow `allowAllOutbound: true` temporarily)
2. Remove IAM conditions if blocking legitimate access
3. Disable VPC Flow Logs if causing performance issues
4. Document issues and create follow-up tasks

---

## Cost Considerations

- **VPC Flow Logs**: ~$0.50 per GB ingested
- **VPC Endpoints**: 
  - Interface endpoints: ~$0.01 per hour per endpoint + $0.01 per GB data processed
  - Gateway endpoints (S3): Free
  - With 4 interface endpoints: ~$0.04/hour = ~$29/month base + data processing
- **CloudWatch Alarms**: First 10 alarms free, then $0.10 per alarm per month
- **CloudWatch Logs**: First 5GB free, then $0.50 per GB ingested
- **KMS Keys**: $1.00 per month per key + $0.03 per 10,000 requests
- **Network Firewall**: ~$0.395 per hour + data processing (if implemented)

**Estimated Monthly Cost Increase**: ~$50-200 (depending on traffic volume and log retention)

---

## References

- [AWS Zero Trust Architecture](https://aws.amazon.com/architecture/security-identity-compliance/zero-trust-architecture/)
- [VPC Flow Logs](https://docs.aws.amazon.com/vpc/latest/userguide/flow-logs.html)
- [AWS Network Firewall](https://docs.aws.amazon.com/network-firewall/)
- [Neptune Security Best Practices](https://docs.aws.amazon.com/neptune/latest/userguide/security.html)
- [Neptune IAM Condition Keys](https://docs.aws.amazon.com/neptune/latest/userguide/iam-data-condition-keys.html)
- [AWS CDK VPC Endpoints](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_ec2.InterfaceVpcEndpoint.html)
