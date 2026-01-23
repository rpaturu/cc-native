import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

/**
 * IAM Policy for Integration Test Users
 * 
 * Grants permissions needed for running integration tests against real AWS resources.
 * This policy should be attached to the IAM user/role used for running tests.
 */
export class TestUserPolicy extends Construct {
  public readonly policy: iam.ManagedPolicy;

  constructor(scope: Construct, id: string, props: {
    evidenceLedgerBucket: string;
    worldStateSnapshotsBucket: string;
    schemaRegistryBucket: string;
    artifactsBucket: string;
    ledgerArchivesBucket: string;
    eventBusName: string;
    tableNames: {
      tenants: string;
      evidenceIndex: string;
      worldState: string;
      snapshotsIndex: string;
      schemaRegistry: string;
      criticalFieldRegistry: string;
      ledger: string;
      cache: string;
      accounts: string;
      signals: string;
      toolRuns: string;
      approvalRequests: string;
      actionQueue: string;
      policyConfig: string;
      methodology: string;
      assessment: string;
      identities: string;
    };
  }) {
    super(scope, id);

    this.policy = new iam.ManagedPolicy(this, 'TestUserPolicy', {
      description: 'IAM policy for integration test users - grants access to all CC Native resources',
      statements: [
        // DynamoDB: Full access to all tables
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'dynamodb:PutItem',
            'dynamodb:GetItem',
            'dynamodb:UpdateItem',
            'dynamodb:DeleteItem',
            'dynamodb:Query',
            'dynamodb:Scan',
            'dynamodb:BatchGetItem',
            'dynamodb:BatchWriteItem',
          ],
          resources: [
            `arn:aws:dynamodb:*:*:table/${props.tableNames.tenants}`,
            `arn:aws:dynamodb:*:*:table/${props.tableNames.evidenceIndex}`,
            `arn:aws:dynamodb:*:*:table/${props.tableNames.worldState}`,
            `arn:aws:dynamodb:*:*:table/${props.tableNames.snapshotsIndex}`,
            `arn:aws:dynamodb:*:*:table/${props.tableNames.schemaRegistry}`,
            `arn:aws:dynamodb:*:*:table/${props.tableNames.criticalFieldRegistry}`,
            `arn:aws:dynamodb:*:*:table/${props.tableNames.ledger}`,
            `arn:aws:dynamodb:*:*:table/${props.tableNames.cache}`,
            `arn:aws:dynamodb:*:*:table/${props.tableNames.accounts}`,
            `arn:aws:dynamodb:*:*:table/${props.tableNames.signals}`,
            `arn:aws:dynamodb:*:*:table/${props.tableNames.toolRuns}`,
            `arn:aws:dynamodb:*:*:table/${props.tableNames.approvalRequests}`,
            `arn:aws:dynamodb:*:*:table/${props.tableNames.actionQueue}`,
            `arn:aws:dynamodb:*:*:table/${props.tableNames.policyConfig}`,
            `arn:aws:dynamodb:*:*:table/${props.tableNames.methodology}`,
            `arn:aws:dynamodb:*:*:table/${props.tableNames.assessment}`,
            `arn:aws:dynamodb:*:*:table/${props.tableNames.identities}`,
            // Allow access to indexes
            `arn:aws:dynamodb:*:*:table/${props.tableNames.evidenceIndex}/index/*`,
            `arn:aws:dynamodb:*:*:table/${props.tableNames.snapshotsIndex}/index/*`,
            `arn:aws:dynamodb:*:*:table/${props.tableNames.schemaRegistry}/index/*`,
          ],
        }),

        // S3: Full access to all buckets
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            's3:GetObject',
            's3:PutObject',
            's3:DeleteObject',
            's3:ListBucket',
            's3:GetObjectVersion',
            's3:PutObjectVersion',
          ],
          resources: [
            `arn:aws:s3:::${props.evidenceLedgerBucket}`,
            `arn:aws:s3:::${props.evidenceLedgerBucket}/*`,
            `arn:aws:s3:::${props.worldStateSnapshotsBucket}`,
            `arn:aws:s3:::${props.worldStateSnapshotsBucket}/*`,
            `arn:aws:s3:::${props.schemaRegistryBucket}`,
            `arn:aws:s3:::${props.schemaRegistryBucket}/*`,
            `arn:aws:s3:::${props.artifactsBucket}`,
            `arn:aws:s3:::${props.artifactsBucket}/*`,
            `arn:aws:s3:::${props.ledgerArchivesBucket}`,
            `arn:aws:s3:::${props.ledgerArchivesBucket}/*`,
          ],
        }),

        // EventBridge: PutEvents on the event bus
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'events:PutEvents',
          ],
          resources: [
            `arn:aws:events:*:*:event-bus/${props.eventBusName}`,
          ],
        }),
      ],
    });
  }
}
