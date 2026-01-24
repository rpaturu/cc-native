# Zero Trust Architecture Implementation Plan

## Overview
This document provides a detailed, code-level implementation plan to transform the cc-native stack into a fully zero trust architecture. The plan addresses network micro-segmentation, enhanced monitoring, stricter access controls, and comprehensive security hardening.

## Current State Assessment
- **Zero Trust Score**: ~70%
- **Strengths**: IAM authentication, encryption at rest/in-transit, network isolation
- **Gaps**: Network micro-segmentation, monitoring, per-function security groups, flow logs

---

## Implementation Phases

### Phase 1: Network Micro-Segmentation (Priority: High)
**Goal**: Implement per-function security groups and restrict outbound traffic

#### 1.1 Create Per-Function Security Groups

**File**: `src/stacks/CCNativeStack.ts`
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
// Replace single security group with per-function groups
// Store in internal properties for reuse
interface NeptuneInternalProperties {
  neptuneLambdaSecurityGroup: ec2.SecurityGroup;
  graphMaterializerSecurityGroup: ec2.SecurityGroup;
  synthesisEngineSecurityGroup: ec2.SecurityGroup;
  neptuneSubnets: string[];
}

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
// Graph Materializer needs: Neptune (8182), DynamoDB (443), EventBridge (443)
graphMaterializerSecurityGroup.addEgressRule(
  neptuneSecurityGroup,
  ec2.Port.tcp(8182),
  'Allow Gremlin connections to Neptune'
);

// Allow HTTPS to AWS services (DynamoDB, EventBridge)
graphMaterializerSecurityGroup.addEgressRule(
  ec2.Peer.ipv4(vpc.vpcCidrBlock),
  ec2.Port.tcp(443),
  'Allow HTTPS to AWS services via VPC endpoints'
);

// Synthesis Engine needs: Neptune (8182), DynamoDB (443), EventBridge (443)
synthesisEngineSecurityGroup.addEgressRule(
  neptuneSecurityGroup,
  ec2.Port.tcp(8182),
  'Allow Gremlin connections to Neptune'
);

synthesisEngineSecurityGroup.addEgressRule(
  ec2.Peer.ipv4(vpc.vpcCidrBlock),
  ec2.Port.tcp(443),
  'Allow HTTPS to AWS services via VPC endpoints'
);

// 4. Update Neptune ingress to allow from both security groups
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

**File**: `src/stacks/CCNativeStack.ts`
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

#### 1.2 Add VPC Endpoints for DynamoDB and EventBridge

**File**: `src/stacks/CCNativeStack.ts`
**Location**: `createNeptuneInfrastructure()` method, after existing VPC endpoints

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
**Location**: `createNeptuneInfrastructure()` method, after VPC creation

**Implementation**:
```typescript
import * as logs from 'aws-cdk-lib/aws-logs';

// Create CloudWatch Log Group for VPC Flow Logs
const vpcFlowLogGroup = new logs.LogGroup(this, 'VPCFlowLogGroup', {
  logGroupName: '/aws/vpc/cc-native-flow-logs',
  retention: logs.RetentionDays.ONE_MONTH, // Adjust as needed
  removalPolicy: cdk.RemovalPolicy.RETAIN,
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

**Implementation**:
```typescript
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';

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

  // Alarm 3: VPC Flow Log anomalies (high traffic to unexpected destinations)
  // Note: This requires CloudWatch Insights queries or AWS GuardDuty
  // For now, we'll monitor for high outbound traffic
  const vpcFlowLogMetric = new cloudwatch.Metric({
    namespace: 'AWS/VPC',
    metricName: 'FlowLogBytes',
    statistic: 'Sum',
    period: cdk.Duration.minutes(5),
  });

  new cloudwatch.Alarm(this, 'HighVPCTraffic', {
    alarmName: 'cc-native-high-vpc-traffic',
    metric: vpcFlowLogMetric,
    threshold: 1000000000, // 1GB in 5 minutes (adjust as needed)
    evaluationPeriods: 2,
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
  }).addAlarmAction(new cloudwatch_actions.SnsAction(securityAlertsTopic));

  // Alarm 4: IAM authentication failures
  // Note: Neptune IAM auth failures are logged to CloudWatch Logs
  // This requires a log metric filter (see section 2.3)
}
```

**Add import**:
```typescript
import * as cloudwatch_actions from 'aws-cdk-lib/aws-cloudwatch-actions';
```

#### 2.3 Create Log Metric Filters for Security Events

**File**: `src/stacks/CCNativeStack.ts`
**Location**: `createSecurityMonitoring()` method

**Implementation**:
```typescript
import * as logs from 'aws-cdk-lib/aws-logs';

// Create log group for Neptune audit logs
const neptuneAuditLogGroup = new logs.LogGroup(this, 'NeptuneAuditLogGroup', {
  logGroupName: '/aws/neptune/cc-native-cluster/audit',
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
    // Require encryption in transit
    StringEquals: {
      'neptune-db:EncryptionContext': 'true',
    },
    // Time-based access control (optional - restrict to business hours)
    // DateGreaterThan: {
    //   'aws:CurrentTime': '09:00Z',
    // },
    // DateLessThan: {
    //   'aws:CurrentTime': '17:00Z',
    // },
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
**Location**: `createNeptuneInfrastructure()` method

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
new kms.Alias(this, 'NeptuneEncryptionKeyAlias', {
  aliasName: 'alias/cc-native-neptune',
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
**Location**: Throughout resource creation

**Implementation**:
```typescript
// Create a helper method for consistent tagging
private getSecurityTags(): cdk.Tag[] {
  return [
    { key: 'DataClassification', value: 'Confidential' },
    { key: 'SecurityLevel', value: 'High' },
    { key: 'ZeroTrust', value: 'Enabled' },
    { key: 'Compliance', value: 'SOC2' }, // Adjust as needed
  ];
}

// Apply to Neptune cluster
const neptuneCluster = new neptune.CfnDBCluster(this, 'NeptuneCluster', {
  // ... config ...
  tags: [
    { key: 'Name', value: 'cc-native-neptune-cluster' },
    ...this.getSecurityTags(),
  ],
});

// Apply to all DynamoDB tables
this.accountsTable = new dynamodb.Table(this, 'AccountsTable', {
  // ... config ...
  tags: this.getSecurityTags(),
});
```

---

### Phase 5: Network Policy Enforcement (Priority: Low)

#### 5.1 Consider AWS Network Firewall (Optional - Advanced)

**File**: `src/stacks/CCNativeStack.ts`
**Location**: New method `createNetworkFirewall()`, called from constructor

**Note**: AWS Network Firewall is a premium service. Only implement if you need advanced network policy enforcement.

**Implementation**:
```typescript
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
```

---

## Implementation Checklist

### Phase 1: Network Micro-Segmentation
- [ ] Create per-function security groups for Graph Materializer and Synthesis Engine
- [ ] Restrict `allowAllOutbound` to `false` for all Lambda security groups
- [ ] Add specific egress rules for required destinations (Neptune, DynamoDB, EventBridge)
- [ ] Add VPC endpoints for DynamoDB, EventBridge, and CloudWatch Logs
- [ ] Update Lambda functions to use per-function security groups
- [ ] Test Lambda functions can still access required services

### Phase 2: Enhanced Monitoring
- [ ] Create CloudWatch Log Group for VPC Flow Logs
- [ ] Create IAM role for VPC Flow Logs
- [ ] Enable VPC Flow Logs for all traffic
- [ ] Create SNS topic for security alerts
- [ ] Create CloudWatch alarms for:
  - [ ] Unauthorized Neptune connections
  - [ ] Lambda function errors
  - [ ] High VPC traffic
  - [ ] IAM authentication failures
- [ ] Create log metric filters for security events
- [ ] Test alarm notifications

### Phase 3: Enhanced IAM
- [ ] Add condition-based IAM policies
- [ ] Implement time-based access controls (if needed)
- [ ] Add IP-based restrictions (if applicable)
- [ ] Review and tighten all IAM policies

### Phase 4: Data Protection
- [ ] Create KMS key for Neptune encryption
- [ ] Update Neptune cluster to use KMS key
- [ ] Add data classification tags to all resources
- [ ] Enable key rotation for all KMS keys

### Phase 5: Network Policy (Optional)
- [ ] Evaluate need for AWS Network Firewall
- [ ] Implement if required for compliance

---

## Testing Strategy

### Unit Tests
- Test security group egress rules allow only required traffic
- Test IAM policies enforce least privilege
- Test VPC Flow Logs are enabled

### Integration Tests
- Verify Lambda functions can access Neptune with new security groups
- Verify Lambda functions can access DynamoDB via VPC endpoint
- Verify Lambda functions can publish to EventBridge via VPC endpoint
- Verify CloudWatch alarms trigger on security events

### Security Testing
- Attempt unauthorized access (should be blocked)
- Verify encryption is enforced
- Test alarm notifications

---

## Migration Plan

1. **Week 1**: Implement Phase 1 (Network Micro-Segmentation)
   - Deploy in development environment
   - Test thoroughly
   - Monitor for any connectivity issues

2. **Week 2**: Implement Phase 2 (Enhanced Monitoring)
   - Deploy monitoring infrastructure
   - Configure alerts
   - Establish baseline metrics

3. **Week 3**: Implement Phase 3 & 4 (IAM & Data Protection)
   - Tighten IAM policies
   - Enable KMS encryption
   - Add data classification

4. **Week 4**: Testing and Validation
   - Run full security test suite
   - Review CloudWatch metrics
   - Document any issues

---

## Rollback Plan

If issues arise:
1. Revert security group changes (allow `allowAllOutbound: true` temporarily)
2. Disable VPC Flow Logs if causing performance issues
3. Relax IAM conditions if blocking legitimate access
4. Document issues and create follow-up tasks

---

## Cost Considerations

- **VPC Flow Logs**: ~$0.50 per GB ingested
- **VPC Endpoints**: Interface endpoints ~$0.01 per hour + data processing
- **CloudWatch Alarms**: First 10 alarms free, then $0.10 per alarm per month
- **Network Firewall**: ~$0.395 per hour + data processing (if implemented)

**Estimated Monthly Cost Increase**: ~$50-200 (depending on traffic volume)

---

## References

- [AWS Zero Trust Architecture](https://aws.amazon.com/architecture/security-identity-compliance/zero-trust-architecture/)
- [VPC Flow Logs](https://docs.aws.amazon.com/vpc/latest/userguide/flow-logs.html)
- [AWS Network Firewall](https://docs.aws.amazon.com/network-firewall/)
- [Neptune Security Best Practices](https://docs.aws.amazon.com/neptune/latest/userguide/security.html)
