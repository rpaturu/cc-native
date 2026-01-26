import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as neptune from 'aws-cdk-lib/aws-neptune';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

export interface NeptuneInfrastructureProps {
  /**
   * Stack region for VPC endpoint service names
   */
  readonly region: string;
}

/**
 * Construct for Neptune graph database infrastructure
 * Includes VPC, Neptune cluster, security groups, and VPC endpoints
 */
export class NeptuneInfrastructure extends Construct {
  public readonly vpc: ec2.Vpc;
  public readonly neptuneCluster: neptune.CfnDBCluster;
  public readonly neptuneSecurityGroup: ec2.SecurityGroup;
  public readonly neptuneAccessRole: iam.Role;
  public readonly graphMaterializerSecurityGroup: ec2.SecurityGroup;
  public readonly synthesisEngineSecurityGroup: ec2.SecurityGroup;
  public readonly neptuneSubnets: string[];
  public readonly neptuneAuditLogGroup: logs.LogGroup;

  constructor(scope: Construct, id: string, props: NeptuneInfrastructureProps) {
    super(scope, id);

    // Create VPC with isolated subnets for Neptune
    // Neptune requires at least 2 AZs, so we'll create subnets in 2 AZs
    // Note: Neptune doesn't need internet access, so isolated subnets are fine
    this.vpc = new ec2.Vpc(this, 'CCNativeVpc', {
      vpcName: 'cc-native-vpc',
      maxAzs: 2, // Neptune requires at least 2 AZs
      natGateways: 0, // No NAT gateways needed - Neptune doesn't need internet access
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'NeptuneIsolated',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED, // Isolated subnets (no internet, no NAT)
        },
      ],
    });

    // ✅ Zero Trust: Enable VPC Flow Logs for network visibility
    // Create CloudWatch Log Group for VPC Flow Logs
    const vpcFlowLogGroup = new logs.LogGroup(this, 'VPCFlowLogGroup', {
      logGroupName: '/aws/vpc/cc-native-flow-logs',
      retention: logs.RetentionDays.ONE_MONTH, // Adjust as needed
      removalPolicy: cdk.RemovalPolicy.RETAIN, // Prevent accidental deletion
    });
    // Override logical ID to match existing CloudFormation resource
    (vpcFlowLogGroup.node.defaultChild as cdk.CfnResource).overrideLogicalId('VPCFlowLogGroup');

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
      resourceType: ec2.FlowLogResourceType.fromVpc(this.vpc),
      destination: ec2.FlowLogDestination.toCloudWatchLogs(vpcFlowLogGroup, vpcFlowLogRole),
      trafficType: ec2.FlowLogTrafficType.ALL, // Log all traffic
    });

    // ✅ Zero Trust: Create Neptune audit log group BEFORE cluster creation
    // The log group must exist before cluster if using enableCloudwatchLogsExports
    this.neptuneAuditLogGroup = new logs.LogGroup(this, 'NeptuneAuditLogGroup', {
      logGroupName: '/aws/neptune/cluster/cc-native-neptune-cluster/audit',  // Match Neptune format
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    // Override logical ID to match existing CloudFormation resource
    (this.neptuneAuditLogGroup.node.defaultChild as cdk.CfnResource).overrideLogicalId('NeptuneAuditLogGroup');

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
      resources: [this.neptuneAuditLogGroup.logGroupArn],
    }));

    // Security group for Neptune cluster
    this.neptuneSecurityGroup = new ec2.SecurityGroup(this, 'NeptuneSecurityGroup', {
      vpc: this.vpc,
      description: 'Security group for Neptune cluster (VPC-only access)',
      allowAllOutbound: false, // Restrict outbound traffic
    });

    // ✅ Zero Trust: Create per-function security groups for better isolation
    this.graphMaterializerSecurityGroup = new ec2.SecurityGroup(this, 'GraphMaterializerSecurityGroup', {
      vpc: this.vpc,
      description: 'Security group for graph-materializer Lambda function',
      allowAllOutbound: false, // Restrict outbound traffic
    });

    this.synthesisEngineSecurityGroup = new ec2.SecurityGroup(this, 'SynthesisEngineSecurityGroup', {
      vpc: this.vpc,
      description: 'Security group for synthesis-engine Lambda function',
      allowAllOutbound: false, // Restrict outbound traffic
    });

    // ✅ Zero Trust: Allow specific egress from Lambda security groups
    // Graph Materializer needs: Neptune (8182), DynamoDB (443), EventBridge (443), CloudWatch Logs (443)
    this.graphMaterializerSecurityGroup.addEgressRule(
      this.neptuneSecurityGroup,
      ec2.Port.tcp(8182),
      'Allow Gremlin connections to Neptune'
    );

    // Allow HTTPS to AWS services via VPC endpoints
    // Note: VPC endpoints are within the VPC CIDR, so this allows access to them
    this.graphMaterializerSecurityGroup.addEgressRule(
      ec2.Peer.ipv4(this.vpc.vpcCidrBlock),
      ec2.Port.tcp(443),
      'Allow HTTPS to AWS services via VPC endpoints (DynamoDB, EventBridge, CloudWatch Logs)'
    );

    // Synthesis Engine needs: Neptune (8182), DynamoDB (443), EventBridge (443), CloudWatch Logs (443)
    this.synthesisEngineSecurityGroup.addEgressRule(
      this.neptuneSecurityGroup,
      ec2.Port.tcp(8182),
      'Allow Gremlin connections to Neptune'
    );

    this.synthesisEngineSecurityGroup.addEgressRule(
      ec2.Peer.ipv4(this.vpc.vpcCidrBlock),
      ec2.Port.tcp(443),
      'Allow HTTPS to AWS services via VPC endpoints (DynamoDB, EventBridge, CloudWatch Logs)'
    );

    // ✅ Zero Trust: Add per-function ingress rules
    this.neptuneSecurityGroup.addIngressRule(
      this.graphMaterializerSecurityGroup,
      ec2.Port.tcp(8182),
      'Allow Gremlin connections from graph-materializer Lambda'
    );

    this.neptuneSecurityGroup.addIngressRule(
      this.synthesisEngineSecurityGroup,
      ec2.Port.tcp(8182),
      'Allow Gremlin connections from synthesis-engine Lambda'
    );

    // Neptune Subnet Group (L1 construct)
    const neptuneSubnetGroup = new neptune.CfnDBSubnetGroup(this, 'NeptuneSubnetGroup', {
      dbSubnetGroupName: 'cc-native-neptune-subnet-group',
      dbSubnetGroupDescription: 'Subnet group for Neptune cluster',
      subnetIds: this.vpc.isolatedSubnets.map(subnet => subnet.subnetId),
      tags: [
        { key: 'Name', value: 'cc-native-neptune-subnet-group' },
      ],
    });

    // Neptune Parameter Group (L1 construct)
    const neptuneParameterGroup = new neptune.CfnDBClusterParameterGroup(this, 'NeptuneParameterGroup', {
      description: 'Parameter group for Neptune cluster',
      family: 'neptune1.4', // Neptune engine family (updated to 1.4 for current Neptune service version)
      parameters: {
        neptune_query_timeout: '120000', // 2 minutes
        neptune_enable_audit_log: '1',
      },
    });

    // Neptune Cluster (L1 construct) - must be created before instances
    this.neptuneCluster = new neptune.CfnDBCluster(this, 'NeptuneCluster', {
      dbClusterIdentifier: 'cc-native-neptune-cluster',
      dbSubnetGroupName: neptuneSubnetGroup.ref,
      dbClusterParameterGroupName: neptuneParameterGroup.ref,
      vpcSecurityGroupIds: [this.neptuneSecurityGroup.securityGroupId],
      backupRetentionPeriod: 7,
      preferredBackupWindow: '03:00-04:00',
      preferredMaintenanceWindow: 'sun:04:00-sun:05:00',
      storageEncrypted: true,
      deletionProtection: false, // Disable for development
      iamAuthEnabled: true, // Enable IAM authentication
      // ✅ Zero Trust: Enable CloudWatch Logs export for audit logs
      enableCloudwatchLogsExports: ['audit'],
      tags: [
        { key: 'Name', value: 'cc-native-neptune-cluster' },
      ],
    });

    // Make cluster depend on log group
    this.neptuneCluster.addDependency(this.neptuneAuditLogGroup.node.defaultChild as cdk.CfnResource);

    // Neptune Cluster Instance (L1 construct) - must reference cluster
    // Note: Security groups and cluster parameter group are inherited from the cluster
    // Do NOT set dbParameterGroupName - instances inherit cluster-level parameters
    const neptuneInstance = new neptune.CfnDBInstance(this, 'NeptuneInstance', {
      dbInstanceIdentifier: 'cc-native-neptune-instance',
      dbInstanceClass: 'db.r5.large', // Instance type for development
      dbClusterIdentifier: this.neptuneCluster.ref,
      dbSubnetGroupName: neptuneSubnetGroup.ref,
      // dbParameterGroupName removed - instances inherit cluster parameter group
      publiclyAccessible: false,
      tags: [
        { key: 'Name', value: 'cc-native-neptune-instance' },
      ],
    });

    // Instance depends on cluster
    neptuneInstance.addDependency(this.neptuneCluster);

    // IAM Role for Lambda functions to access Neptune
    this.neptuneAccessRole = new iam.Role(this, 'NeptuneAccessRole', {
      roleName: 'cc-native-neptune-access-role',
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'IAM role for Lambda functions to access Neptune cluster',
    });

    // Grant Neptune access permissions
    this.neptuneAccessRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'neptune-db:connect',
        'neptune-db:ReadDataViaQuery',
        'neptune-db:WriteDataViaQuery',
      ],
      resources: [
        `arn:aws:neptune-db:${props.region}:${cdk.Stack.of(this).account}:${this.neptuneCluster.ref}/*`,
      ],
    }));

    // Store subnet IDs for later use
    this.neptuneSubnets = this.vpc.isolatedSubnets.map(subnet => subnet.subnetId);

    // Create VPC endpoints for SSM (required for Session Manager in isolated subnets)
    // These allow EC2 instances in isolated subnets to use SSM without internet access
    // SSM requires 3 interface endpoints: ssm, ssmmessages, and ec2messages
    new ec2.InterfaceVpcEndpoint(this, 'SSMEndpoint', {
      vpc: this.vpc,
      service: new ec2.InterfaceVpcEndpointService(`com.amazonaws.${props.region}.ssm`, 443),
      privateDnsEnabled: true,
    });

    new ec2.InterfaceVpcEndpoint(this, 'SSMMessagesEndpoint', {
      vpc: this.vpc,
      service: new ec2.InterfaceVpcEndpointService(`com.amazonaws.${props.region}.ssmmessages`, 443),
      privateDnsEnabled: true,
    });

    new ec2.InterfaceVpcEndpoint(this, 'EC2MessagesEndpoint', {
      vpc: this.vpc,
      service: new ec2.InterfaceVpcEndpointService(`com.amazonaws.${props.region}.ec2messages`, 443),
      privateDnsEnabled: true,
    });

    // Gateway endpoint for S3 (for git clone and npm install)
    // Gateway endpoints are free and don't require ENIs
    new ec2.GatewayVpcEndpoint(this, 'S3Endpoint', {
      vpc: this.vpc,
      service: ec2.GatewayVpcEndpointAwsService.S3,
    });

    // ✅ Zero Trust: Add VPC endpoints for DynamoDB, EventBridge, and CloudWatch Logs
    // These allow Lambda functions in isolated subnets to access AWS services without internet access

    // Add DynamoDB VPC endpoint (gateway endpoint - free and recommended for DynamoDB)
    // Gateway endpoints work at the route table level and automatically route traffic to DynamoDB
    // CDK automatically creates route tables for isolated subnets and associates them with the VPC
    // The Gateway endpoint will automatically add routes to all route tables in the VPC
    // ✅ Zero Trust: Traffic stays within AWS network, no internet gateway required
    new ec2.GatewayVpcEndpoint(this, 'DynamoDBEndpoint', {
      vpc: this.vpc,
      service: ec2.GatewayVpcEndpointAwsService.DYNAMODB,
      // Gateway endpoints automatically associate with all route tables in the VPC
      // No subnet specification needed - they work at the VPC/route table level
    });

    // Add EventBridge VPC endpoint (interface endpoint)
    new ec2.InterfaceVpcEndpoint(this, 'EventBridgeEndpoint', {
      vpc: this.vpc,
      service: new ec2.InterfaceVpcEndpointService(`com.amazonaws.${props.region}.events`, 443),
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
      vpc: this.vpc,
      service: new ec2.InterfaceVpcEndpointService(`com.amazonaws.${props.region}.logs`, 443),
      privateDnsEnabled: true,
      subnets: {
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED,  // ✅ Specify subnet type explicitly
      },
    });

    // Add STS (Security Token Service) VPC endpoint
    // ⚠️ CRITICAL: EC2 instances using IAM roles need STS to assume the role and get credentials
    // Without this, instances in isolated subnets cannot get temporary credentials
    // This is required for all EC2 instances using IAM instance profiles
    new ec2.InterfaceVpcEndpoint(this, 'STSEndpoint', {
      vpc: this.vpc,
      service: new ec2.InterfaceVpcEndpointService(`com.amazonaws.${props.region}.sts`, 443),
      privateDnsEnabled: true,
      subnets: {
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED,  // ✅ Specify subnet type explicitly
      },
    });

    // Add CloudFormation VPC endpoint
    // ⚠️ CRITICAL: EC2 test runner instances need CloudFormation access to query stack outputs
    // Without this, instances in isolated subnets cannot query CloudFormation for environment variables
    // This is required for test runner instances that need to dynamically retrieve stack outputs
    new ec2.InterfaceVpcEndpoint(this, 'CloudFormationEndpoint', {
      vpc: this.vpc,
      service: new ec2.InterfaceVpcEndpointService(`com.amazonaws.${props.region}.cloudformation`, 443),
      privateDnsEnabled: true,
      subnets: {
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED,  // ✅ Specify subnet type explicitly
      },
    });

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
  }
}
