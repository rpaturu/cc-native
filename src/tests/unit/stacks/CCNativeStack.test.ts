/**
 * CCNativeStack Infrastructure Tests
 * 
 * Validates that all required infrastructure constructs are instantiated
 * and required resources are created. This catches issues like missing
 * ExecutionInfrastructure before deployment.
 * 
 * Key Test: Ensures ExecutionInfrastructure is instantiated in CCNativeStack.
 * If ExecutionInfrastructure is missing, ActionTypeRegistry table won't exist,
 * causing seed script to fail during integration testing.
 */

import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { CCNativeStack } from '../../../stacks/CCNativeStack';

describe('CCNativeStack Infrastructure', () => {
  let app: App;
  let stack: CCNativeStack;
  let template: Template;

  beforeEach(() => {
    app = new App();
    
    // Set required context parameters BEFORE creating stack (same as deploy script)
    app.node.setContext('bedrockModel', 'anthropic.claude-3-5-sonnet-20240620-v1:0');
    app.node.setContext('awsRegion', 'us-west-2');
    app.node.setContext('nodeEnv', 'test');
    app.node.setContext('logLevel', 'info');
    
    // Create stack with required environment
    stack = new CCNativeStack(app, 'TestStack', {
      env: {
        account: '123456789012',
        region: 'us-west-2',
      },
    });
    
    template = Template.fromStack(stack);
  });

  describe('ExecutionInfrastructure', () => {
    /**
     * CRITICAL TEST: Validates ExecutionInfrastructure is instantiated in CCNativeStack.
     * 
     * This test catches the defect where ExecutionInfrastructure was not instantiated,
     * causing ActionTypeRegistry table to be missing and seed script to fail.
     * 
     * If ExecutionInfrastructure is missing:
     * - Stack synthesis will succeed (no error)
     * - But ActionTypeRegistry table won't exist
     * - Seed script will fail during integration testing
     * 
     * This test catches it at unit test time, before deployment.
     */
    it('should create ActionTypeRegistry table (validates ExecutionInfrastructure is instantiated)', () => {
      // If ExecutionInfrastructure is not instantiated, this table won't exist
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        TableName: 'cc-native-action-type-registry',
      });
    });

    it('should create ExecutionAttempts table', () => {
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        TableName: 'cc-native-execution-attempts',
      });
    });

    it('should create ExecutionOutcomes table', () => {
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        TableName: 'cc-native-execution-outcomes',
      });
    });

    it('should create ExternalWriteDedupe table', () => {
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        TableName: 'cc-native-external-write-dedupe',
      });
    });

    it('should create ConnectorConfig table', () => {
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        TableName: 'cc-native-connector-config',
      });
    });

    it('should create InternalNotes table', () => {
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        TableName: 'cc-native-internal-notes',
      });
    });

    it('should create InternalTasks table', () => {
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        TableName: 'cc-native-internal-tasks',
      });
    });

    it('should output ActionTypeRegistryTableName', () => {
      template.hasOutput('ActionTypeRegistryTableName', {});
    });

    it('should output ExecutionAttemptsTableName', () => {
      template.hasOutput('ExecutionAttemptsTableName', {});
    });

    it('should output ExecutionOutcomesTableName', () => {
      template.hasOutput('ExecutionOutcomesTableName', {});
    });

    it('should output ExternalWriteDedupeTableName', () => {
      template.hasOutput('ExternalWriteDedupeTableName', {});
    });

    it('should output ConnectorConfigTableName', () => {
      template.hasOutput('ConnectorConfigTableName', {});
    });

    it('should output InternalNotesTableName', () => {
      template.hasOutput('InternalNotesTableName', {});
    });

    it('should output InternalTasksTableName', () => {
      template.hasOutput('InternalTasksTableName', {});
    });

    it('should create AgentCore Gateway', () => {
      template.hasResourceProperties('AWS::BedrockAgentCore::Gateway', {
        Name: 'cc-native-execution-gateway',
        ProtocolType: 'MCP',
      });
    });

    it('should create Connectors VPC', () => {
      template.hasResourceProperties('AWS::EC2::VPC', {
        Tags: [
          {
            Key: 'Name',
            Value: 'ConnectorsVpc',
          },
        ],
      });
    });

    it('should create InternalAdapter Lambda function', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: 'cc-native-internal-adapter-handler',
      });
    });

    it('should create CrmAdapter Lambda function', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: 'cc-native-crm-adapter-handler',
      });
    });
  });

  describe('DecisionInfrastructure', () => {
    it('should create ActionIntent table', () => {
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        TableName: 'cc-native-action-intent',
      });
    });

    it('should output ActionIntentTableName', () => {
      template.hasOutput('ActionIntentTableName', {});
    });
  });

  describe('Methodology Infrastructure', () => {
    it('should create Methodology table', () => {
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        TableName: 'cc-native-methodology',
      });
    });

    it('should output MethodologyTableName', () => {
      template.hasOutput('MethodologyTableName', {});
    });
  });
});
