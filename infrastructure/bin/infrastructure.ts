#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { CCNativeStack } from '../../src/stacks/CCNativeStack';

const app = new cdk.App();

new CCNativeStack(app, 'CCNativeStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'us-west-2',
  },
});
