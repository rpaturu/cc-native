import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cloudwatch_actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as neptune from 'aws-cdk-lib/aws-neptune';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';

export interface SecurityMonitoringProps {
  readonly neptuneCluster: neptune.CfnDBCluster;
  readonly graphMaterializerHandler: lambda.Function;
  readonly synthesisEngineHandler: lambda.Function;
  readonly region: string;
  readonly neptuneAuditLogGroup: logs.LogGroup;
}

/**
 * Construct for security monitoring infrastructure
 * CloudWatch alarms, log metric filters, and SNS notifications
 */
export class SecurityMonitoring extends Construct {
  public readonly securityAlertsTopic: sns.Topic;

  constructor(scope: Construct, id: string, props: SecurityMonitoringProps) {
    super(scope, id);

    // Create SNS topic for security alerts
    this.securityAlertsTopic = new sns.Topic(this, 'SecurityAlertsTopic', {
      topicName: 'cc-native-security-alerts',
      displayName: 'CC Native Security Alerts',
    });

    // Add email subscription (replace with your email)
    // this.securityAlertsTopic.addSubscription(new subscriptions.EmailSubscription('security@example.com'));

    // Alarm 1: Unauthorized Neptune connection attempts
    new cloudwatch.Alarm(this, 'NeptuneUnauthorizedConnections', {
      alarmName: 'cc-native-neptune-unauthorized-connections',
      metric: new cloudwatch.Metric({
        namespace: 'AWS/Neptune',
        metricName: 'DatabaseConnections',
        dimensionsMap: {
          DBClusterIdentifier: props.neptuneCluster.ref,
        },
        statistic: 'Sum',
        period: cdk.Duration.minutes(5),
      }),
      threshold: 100, // Adjust based on baseline
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    }).addAlarmAction(new cloudwatch_actions.SnsAction(this.securityAlertsTopic));

    // Alarm 2: Graph Materializer Lambda function errors (potential security issues)
    const graphMaterializerErrors = new cloudwatch.Metric({
      namespace: 'AWS/Lambda',
      metricName: 'Errors',
      dimensionsMap: {
        FunctionName: props.graphMaterializerHandler.functionName,
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
    }).addAlarmAction(new cloudwatch_actions.SnsAction(this.securityAlertsTopic));

    // Alarm 3: Synthesis Engine Lambda function errors
    const synthesisEngineErrors = new cloudwatch.Metric({
      namespace: 'AWS/Lambda',
      metricName: 'Errors',
      dimensionsMap: {
        FunctionName: props.synthesisEngineHandler.functionName,
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
    }).addAlarmAction(new cloudwatch_actions.SnsAction(this.securityAlertsTopic));

    // Alarm 4: VPC Endpoint traffic monitoring
    // For zero trust, monitor each endpoint separately
    const dynamoDBEndpointMetric = new cloudwatch.Metric({
      namespace: 'AWS/PrivateLinkEndpoints',
      metricName: 'BytesProcessed',
      dimensionsMap: {
        ServiceName: `com.amazonaws.${props.region}.dynamodb`,  // ✅ Specify which endpoint
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
    }).addAlarmAction(new cloudwatch_actions.SnsAction(this.securityAlertsTopic));

    // Alarm 5: IAM authentication failures
    // Use Neptune audit log group passed from NeptuneInfrastructure
    // Metric filter for IAM authentication failures
    // Note: Neptune audit logs are comma-delimited
    // Format: timestamp,client_host,server_host,connection_type,iam_arn,auth_context,...
    // Test the actual log format after deployment and adjust the filter pattern if needed
    // Use allTerms to match if "AUTHENTICATION_FAILED" appears anywhere in the log message
    new logs.MetricFilter(this, 'NeptuneIAMAuthFailure', {
      logGroup: props.neptuneAuditLogGroup,
      metricNamespace: 'CCNative/Security',
      metricName: 'NeptuneIAMAuthFailures',
      filterPattern: logs.FilterPattern.allTerms('AUTHENTICATION_FAILED'),
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
    }).addAlarmAction(new cloudwatch_actions.SnsAction(this.securityAlertsTopic));
  }
}
