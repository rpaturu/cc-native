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

**Note**: Lambda functions in VPC experience longer cold starts (1-3 seconds) due to ENI creation. Consider using provisioned concurrency for production workloads if latency is critical.

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

**Current Code** (lines 712-723):
```typescript
const lambdaSecurityGroup = new ec2.SecurityGroup(this, 'NeptuneLambdaSecurityGroup', {
  vpc: vpc,
  description: 'Security group for Lambda functions accessing Neptune',
  allowAllOutbound: true,
});

// Allow Lambda to connect to Neptune on Gremlin port (8182)
neptuneSecurityGroup.addIngressRule(
  lambdaSecurityGroup,
  ec2.Port.tcp(8182),
  'Allow Gremlin connections from Lambda'
);
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

// 4. ⚠️ CRITICAL: Remove the old ingress rule (lines 719-723)
// REMOVE this old ingress rule that uses lambdaSecurityGroup:
// neptuneSecurityGroup.addIngressRule(
//   lambdaSecurityGroup,
//   ec2.Port.tcp(8182),
//   'Allow Gremlin connections from Lambda'
// );

// 5. Add new ingress rules for per-function security groups
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

// 6. Store in internal properties
(this as unknown as CCNativeStack & NeptuneInternalProperties).graphMaterializerSecurityGroup = graphMaterializerSecurityGroup;
(this as unknown as CCNativeStack & NeptuneInternalProperties).synthesisEngineSecurityGroup = synthesisEngineSecurityGroup;
```

**Step 3**: Create Per-Function IAM Roles and Update Lambda Functions

**Location**: `createPhase2Handlers()` method

**Important**: For zero trust, each Lambda function should have its own dedicated IAM role. This provides better isolation and follows least privilege principles.

**Implementation**:
```typescript
// Get per-function security groups from internal properties
const graphMaterializerSecurityGroup = (this as any).graphMaterializerSecurityGroup as ec2.SecurityGroup;
const synthesisEngineSecurityGroup = (this as any).synthesisEngineSecurityGroup as ec2.SecurityGroup;

// Create dedicated IAM role for Graph Materializer
const graphMaterializerRole = new iam.Role(this, 'GraphMaterializerRole', {
  roleName: 'cc-native-graph-materializer-role',
  assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
  description: 'IAM role for graph-materializer Lambda function',
});

// Add VPC permissions (REQUIRED for Lambda in VPC)
// Note: If using default Lambda execution role, CDK adds this automatically when vpc is specified
// But with custom roles, you must add it manually
graphMaterializerRole.addManagedPolicy(
  iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaVPCAccessExecutionRole')
);

// Create dedicated IAM role for Synthesis Engine
const synthesisEngineRole = new iam.Role(this, 'SynthesisEngineRole', {
  roleName: 'cc-native-synthesis-engine-role',
  assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
  description: 'IAM role for synthesis-engine Lambda function',
});

// Add VPC permissions (REQUIRED for Lambda in VPC)
synthesisEngineRole.addManagedPolicy(
  iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaVPCAccessExecutionRole')
);

// Graph Materializer Handler
const graphMaterializerHandler = new lambdaNodejs.NodejsFunction(this, 'GraphMaterializerHandler', {
  functionName: 'cc-native-graph-materializer-handler',
  entry: 'src/handlers/phase2/graph-materializer-handler.ts',
  handler: 'handler',
  runtime: lambda.Runtime.NODEJS_20_X,
  timeout: cdk.Duration.minutes(5),
  memorySize: 1024,
  environment: phase2Env,
  deadLetterQueue: this.graphMaterializerDlq,
  deadLetterQueueEnabled: true,
  retryAttempts: 2,
  // VPC configuration for Neptune access
  vpc: this.vpc,
  vpcSubnets: { subnets: this.vpc.isolatedSubnets },
  securityGroups: [graphMaterializerSecurityGroup], // Use specific security group
  role: graphMaterializerRole,  // ✅ Use dedicated role
});

// Synthesis Engine Handler
const synthesisEngineHandler = new lambdaNodejs.NodejsFunction(this, 'SynthesisEngineHandler', {
  functionName: 'cc-native-synthesis-engine-handler',
  entry: 'src/handlers/phase2/synthesis-engine-handler.ts',
  handler: 'handler',
  runtime: lambda.Runtime.NODEJS_20_X,
  timeout: cdk.Duration.minutes(3),
  memorySize: 1024,
  environment: phase2Env,
  deadLetterQueue: this.synthesisEngineDlq,
  deadLetterQueueEnabled: true,
  retryAttempts: 2,
  // VPC configuration for Neptune access
  vpc: this.vpc,
  vpcSubnets: { subnets: this.vpc.isolatedSubnets },
  securityGroups: [synthesisEngineSecurityGroup], // Use specific security group
  role: synthesisEngineRole,  // ✅ Use dedicated role
});

// Grant permissions for Graph Materializer
this.signalsTable.grantReadData(graphMaterializerHandler);
this.accountsTable.grantReadData(graphMaterializerHandler);
this.graphMaterializationStatusTable.grantReadWriteData(graphMaterializerHandler);
this.ledgerTable.grantWriteData(graphMaterializerHandler);
this.eventBus.grantPutEventsTo(graphMaterializerHandler);

// Grant permissions for Synthesis Engine
this.signalsTable.grantReadData(synthesisEngineHandler);
this.accountsTable.grantReadData(synthesisEngineHandler);
this.accountPostureStateTable.grantReadWriteData(synthesisEngineHandler);
this.graphMaterializationStatusTable.grantReadData(synthesisEngineHandler);
this.ledgerTable.grantWriteData(synthesisEngineHandler);
```

**Note**: The `neptuneAccessRole` created in `createNeptuneInfrastructure()` is not used with this approach. You can either:
- Remove it (since we're using per-function roles), OR
- Keep it for backward compatibility but document that it's not used

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
  subnets: {
    subnetType: ec2.SubnetType.PRIVATE_ISOLATED,  // ✅ Specify subnet type explicitly
  },
});

// Add EventBridge VPC endpoint (interface endpoint)
new ec2.InterfaceVpcEndpoint(this, 'EventBridgeEndpoint', {
  vpc: vpc,
  service: new ec2.InterfaceVpcEndpointService(`com.amazonaws.${this.region}.events`, 443),
  privateDnsEnabled: true,
  subnets: {
    subnetType: ec2.SubnetType.PRIVATE_ISOLATED,  // ✅ Specify subnet type explicitly
  },
});

// Add CloudWatch Logs endpoint (for Lambda logging)
// ⚠️ CRITICAL: Lambda functions in VPC cannot write logs without this endpoint
// Without this, Lambda logs will be lost and you won't see function output
// This is required for all Lambda functions running in VPC
new ec2.InterfaceVpcEndpoint(this, 'CloudWatchLogsEndpoint', {
  vpc: vpc,
  service: new ec2.InterfaceVpcEndpointService(`com.amazonaws.${this.region}.logs`, 443),
  privateDnsEnabled: true,
  subnets: {
    subnetType: ec2.SubnetType.PRIVATE_ISOLATED,  // ✅ Specify subnet type explicitly
  },
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

  // Alarm 2: Graph Materializer Lambda function errors (potential security issues)
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

  // Alarm 3: Synthesis Engine Lambda function errors
  const synthesisEngineErrors = new cloudwatch.Metric({
    namespace: 'AWS/Lambda',
    metricName: 'Errors',
    dimensionsMap: {
      FunctionName: this.synthesisEngineHandler.functionName,
    },
    statistic: 'Sum',
    period: cdk.Duration.minutes(5),
  });

  new cloudwatch.Alarm(this, 'SynthesisEngineErrors', {
    alarmName: 'cc-native-synthesis-engine-errors',
    metric: synthesisEngineErrors,
    threshold: 5, // Alert if 5+ errors in 5 minutes
    evaluationPeriods: 1,
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
  }).addAlarmAction(new cloudwatch_actions.SnsAction(securityAlertsTopic));

  // Alarm 4: VPC Endpoint traffic monitoring
  // Note: VPC Flow Logs don't automatically create CloudWatch metrics
  // Monitor VPC endpoint traffic instead, or use CloudWatch Insights queries
  // For zero trust, monitor each endpoint separately
  const dynamoDBEndpointMetric = new cloudwatch.Metric({
    namespace: 'AWS/PrivateLinkEndpoints',
    metricName: 'BytesProcessed',
    dimensionsMap: {
      ServiceName: `com.amazonaws.${this.region}.dynamodb`,  // ✅ Specify which endpoint
    },
    statistic: 'Sum',
    period: cdk.Duration.minutes(5),
  });

  new cloudwatch.Alarm(this, 'HighDynamoDBEndpointTraffic', {
    alarmName: 'cc-native-high-dynamodb-endpoint-traffic',
    metric: dynamoDBEndpointMetric,
    threshold: 1000000000, // 1GB in 5 minutes (adjust as needed)
    evaluationPeriods: 2,
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
  }).addAlarmAction(new cloudwatch_actions.SnsAction(securityAlertsTopic));

  // Alarm 5: IAM authentication failures
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

#### 2.3 Create Neptune Audit Log Group and Metric Filters

**File**: `src/stacks/CCNativeStack.ts`
**Location**: `createNeptuneInfrastructure()` method, BEFORE creating Neptune cluster

**Important**: The Neptune audit log group must be created BEFORE the cluster if using `enableCloudwatchLogsExports`.

**Implementation**:
```typescript
// Create log group for Neptune audit logs
// ⚠️ IMPORTANT: Must be created BEFORE Neptune cluster if using enableCloudwatchLogsExports
// The log group name must match Neptune's expected format: /aws/neptune/cluster/{cluster-identifier}/audit
const neptuneAuditLogGroup = new logs.LogGroup(this, 'NeptuneAuditLogGroup', {
  logGroupName: `/aws/neptune/cluster/cc-native-neptune-cluster/audit`,  // Match Neptune format
  retention: logs.RetentionDays.ONE_MONTH,
  removalPolicy: cdk.RemovalPolicy.RETAIN,
});

// Create IAM role for Neptune to write to CloudWatch Logs
const neptuneLogsRole = new iam.Role(this, 'NeptuneLogsRole', {
  assumedBy: new iam.ServicePrincipal(`rds.amazonaws.com`),  // Neptune uses RDS service principal
  description: 'IAM role for Neptune to write audit logs to CloudWatch',
});

neptuneLogsRole.addToPolicy(new iam.PolicyStatement({
  effect: iam.Effect.ALLOW,
  actions: [
    'logs:CreateLogGroup',
    'logs:CreateLogStream',
    'logs:PutLogEvents',
    'logs:DescribeLogStreams',
  ],
  resources: [neptuneAuditLogGroup.logGroupArn],
}));

// Update Neptune cluster to enable CloudWatch Logs export
const neptuneCluster = new neptune.CfnDBCluster(this, 'NeptuneCluster', {
  // ... existing config ...
  enableCloudwatchLogsExports: ['audit'],  // ✅ Enable audit log export to CloudWatch
  // Note: Verify if cloudwatchLogsExportsRoleArn property exists in CfnDBCluster
  // If not available, you may need to configure via AWS CLI after deployment:
  // aws neptune modify-db-cluster --db-cluster-identifier cc-native-neptune-cluster \
  //   --cloudwatch-logs-export-configuration '{"EnableLogTypes":["audit"]}'
  // ... rest of config ...
});

// Make cluster depend on log group
neptuneCluster.addDependency(neptuneAuditLogGroup.node.defaultChild as cdk.CfnResource);
```

**Then in `createSecurityMonitoring()` method**, add the metric filter:
```typescript
// Metric filter for IAM authentication failures
// Note: Neptune audit logs are comma-delimited
// Format: timestamp,client_host,server_host,connection_type,iam_arn,auth_context,...
// Test the actual log format after deployment and adjust the filter pattern if needed
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
**Location**: `createPhase2Handlers()` method, after creating Lambda roles

**Implementation**:
```typescript
// Add Neptune permissions to Graph Materializer role with conditions
// Note: Neptune only supports neptune-db:QueryLanguage as a service-specific condition key
// For encryption enforcement, use aws:SecureTransport instead
graphMaterializerRole.addToPolicy(new iam.PolicyStatement({
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

// Add Neptune permissions to Synthesis Engine role with conditions
synthesisEngineRole.addToPolicy(new iam.PolicyStatement({
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

**Note**: The old `neptuneAccessRole` is no longer needed if using per-function roles. You can remove it from `createNeptuneInfrastructure()` or keep it for backward compatibility.

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

// ⚠️ CRITICAL: Grant Neptune service permission to use the key
// Neptune uses the RDS service principal
neptuneEncryptionKey.addToResourcePolicy(new iam.PolicyStatement({
  sid: 'Allow Neptune service to use key',
  effect: iam.Effect.ALLOW,
  principals: [
    new iam.ServicePrincipal(`rds.amazonaws.com`),  // Neptune uses RDS service principal
  ],
  actions: [
    'kms:Decrypt',
    'kms:DescribeKey',
    'kms:CreateGrant',
  ],
  resources: ['*'],
  conditions: {
    StringEquals: {
      'kms:ViaService': `rds.${this.region}.amazonaws.com`,
    },
  },
}));

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
- [ ] **Remove old ingress rule** using `lambdaSecurityGroup` (lines 719-723)
- [ ] Add new ingress rules for per-function security groups
- [ ] Create per-function IAM roles for Lambda functions
- [ ] Add VPC execution permissions to Lambda roles (`AWSLambdaVPCAccessExecutionRole`)
- [ ] Add VPC endpoints for DynamoDB, EventBridge, and CloudWatch Logs with subnet configuration
- [ ] Update Lambda functions to use per-function security groups and roles
- [ ] Test Lambda functions can still access required services

### Phase 2: Enhanced Monitoring
- [ ] Add required imports (logs, cloudwatch, cloudwatch_actions, sns, subscriptions)
- [ ] Create CloudWatch Log Group for VPC Flow Logs
- [ ] Create IAM role for VPC Flow Logs
- [ ] Enable VPC Flow Logs for all traffic
- [ ] **Create Neptune audit log group BEFORE cluster creation** (in `createNeptuneInfrastructure()`)
- [ ] Create IAM role for Neptune CloudWatch Logs export
- [ ] Add `enableCloudwatchLogsExports: ['audit']` to Neptune cluster
- [ ] Create SNS topic for security alerts
- [ ] Create CloudWatch alarms for:
  - [ ] Unauthorized Neptune connections
  - [ ] Graph Materializer Lambda function errors
  - [ ] Synthesis Engine Lambda function errors
  - [ ] High DynamoDB endpoint traffic (with dimensions)
  - [ ] IAM authentication failures
- [ ] Create log metric filters for security events
- [ ] Add `createSecurityMonitoring()` call to constructor (after `createPhase2Handlers()`)
- [ ] Test alarm notifications
- [ ] Verify Neptune audit logs are being written to CloudWatch

### Phase 3: Enhanced IAM
- [ ] Add Neptune permissions to Graph Materializer role with conditions
- [ ] Add Neptune permissions to Synthesis Engine role with conditions
- [ ] Use `aws:SecureTransport` condition for encryption enforcement
- [ ] Use `neptune-db:QueryLanguage` condition to restrict query language
- [ ] Implement time-based access controls (if needed)
- [ ] Add IP-based restrictions (if applicable)
- [ ] Review and tighten all IAM policies
- [ ] Remove or document unused `neptuneAccessRole`

### Phase 4: Data Protection
- [ ] Create KMS key for Neptune encryption
- [ ] Create KMS alias (with 'alias/' prefix)
- [ ] **Grant Neptune service permission to use KMS key** (RDS service principal)
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

### Phase 1 Testing
1. Deploy stack with Phase 1 changes
2. Verify Lambda functions can connect to Neptune with new security groups
3. Verify Lambda functions can access DynamoDB via VPC endpoint
4. Verify Lambda functions can publish to EventBridge via VPC endpoint
5. Verify Lambda functions can write CloudWatch Logs via VPC endpoint
6. Verify Lambda logs appear in CloudWatch Logs
7. Test with security group egress rules restricted
8. Verify old ingress rule is removed (check security group rules in console)

### Phase 2 Testing
1. Deploy stack with Phase 2 changes
2. Verify VPC Flow Logs are being created in CloudWatch Logs
3. Verify Neptune audit logs are being written (if enabled)
4. Trigger test events to verify CloudWatch alarms
5. Verify alarm notifications are sent to SNS topic
6. Test log metric filters with actual log data

### Phase 3 Testing
1. Deploy stack with Phase 3 changes
2. Verify IAM conditions block non-compliant requests
3. Test that TLS is required (attempt non-TLS connection - should fail)
4. Test that only Gremlin queries are allowed (if condition is enabled)

### Phase 4 Testing
1. Deploy stack with Phase 4 changes
2. Verify KMS encryption is working for Neptune
3. Verify tags are applied correctly to all resources
4. Test KMS key rotation

### Security Testing
- Attempt unauthorized access (should be blocked)
- Verify encryption is enforced (TLS required)
- Test alarm notifications
- Verify IAM conditions block non-compliant requests
- Verify old security group ingress rule is removed

---

## Migration Plan

### Migration from Existing Cluster

If you have an existing Neptune cluster:
1. **KMS Encryption**: Adding KMS key to existing cluster requires cluster modification
   - Plan for brief downtime (usually < 5 minutes)
   - Backup cluster before modification
   - Test in development environment first
2. **Security Groups**: Changing security groups is non-disruptive
   - Can be updated without cluster modification
3. **VPC Endpoints**: Can be added without cluster modification
4. **CloudWatch Logs**: Can be enabled via `modify-db-cluster` without downtime
   - Or use `enableCloudwatchLogsExports` in CDK (requires stack update)

### Implementation Timeline

1. **Week 1**: Implement Phase 1 (Network Micro-Segmentation)
   - Deploy in development environment
   - Test thoroughly
   - Monitor for any connectivity issues
   - Verify Lambda logs are being written
   - Verify old ingress rule is removed

2. **Week 2**: Implement Phase 2 (Enhanced Monitoring)
   - Deploy monitoring infrastructure
   - Configure alerts
   - Establish baseline metrics
   - Verify Neptune audit logs are being written

3. **Week 3**: Implement Phase 3 & 4 (IAM & Data Protection)
   - Tighten IAM policies
   - Enable KMS encryption (plan for downtime if existing cluster)
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
2. Revert to default Lambda execution roles if custom roles cause issues
3. Remove IAM conditions if blocking legitimate access
4. Disable VPC Flow Logs if causing performance issues
5. Remove KMS key requirement if causing cluster modification issues
6. Document issues and create follow-up tasks

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
- [Neptune CloudWatch Logs Export](https://docs.aws.amazon.com/neptune/latest/userguide/cloudwatch-logs.html)
