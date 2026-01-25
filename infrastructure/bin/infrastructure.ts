#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { CCNativeStack } from '../../src/stacks/CCNativeStack';

const app = new cdk.App();

new CCNativeStack(app, 'CCNativeStack', {
  env: {
    // Use AWS_ACCOUNT_ID from .env.local if CDK_DEFAULT_ACCOUNT is not set
    account: process.env.CDK_DEFAULT_ACCOUNT || process.env.AWS_ACCOUNT_ID,
    region: process.env.CDK_DEFAULT_REGION || process.env.AWS_REGION || 'us-west-2',
  },
});
