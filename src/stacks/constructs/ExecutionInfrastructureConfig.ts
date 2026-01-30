/**
 * Execution Infrastructure Configuration
 * 
 * Centralized configuration for Execution Infrastructure construct.
 * All hardcoded values should be defined here for maintainability and scalability.
 */

export interface ExecutionInfrastructureConfig {
  // Resource naming
  readonly resourcePrefix: string;
  
  // Table names
  readonly tableNames: {
    readonly executionAttempts: string;
    readonly executionOutcomes: string;
    readonly actionTypeRegistry: string;
    readonly externalWriteDedupe: string;
    readonly connectorConfig: string; // Phase 4.3
    readonly internalNotes: string; // Phase 4.3
    readonly internalTasks: string; // Phase 4.3
  };
  
  // Function names
  readonly functionNames: {
    readonly executionStarter: string;
    readonly executionValidator: string;
    readonly toolMapper: string;
    readonly toolInvoker: string;
    readonly executionRecorder: string;
    readonly executionFailureRecorder: string;
    readonly compensation: string;
    readonly executionStatusApi: string;
    readonly internalAdapter: string; // Phase 4.3
    readonly crmAdapter: string; // Phase 4.3
  };
  
  // Queue names (DLQs)
  readonly queueNames: {
    readonly executionStarterDlq: string;
    readonly executionValidatorDlq: string;
    readonly toolMapperDlq: string;
    readonly toolInvokerDlq: string;
    readonly executionRecorderDlq: string;
    readonly executionFailureRecorderDlq: string;
    readonly compensationDlq: string;
  };
  
  // Step Functions
  readonly stepFunctions: {
    readonly stateMachineName: string;
    readonly timeoutHours: number;
  };
  
  // S3 Buckets
  readonly s3: {
    readonly executionArtifactsBucketPrefix: string;
  };
  
  // EventBridge
  readonly eventBridge: {
    readonly source: string;
    readonly detailTypes: {
      readonly actionApproved: string;
    };
  };
  
  // Defaults
  readonly defaults: {
    readonly region: string;
    readonly timeout: {
      readonly executionStarter: number; // seconds
      readonly executionValidator: number; // seconds
      readonly toolMapper: number; // seconds
      readonly toolInvoker: number; // seconds
      readonly executionRecorder: number; // seconds
      readonly compensation: number; // seconds
      readonly executionStatusApi: number; // seconds
      readonly internalAdapter: number; // seconds (VPC + DynamoDB; 60s for cold start)
      readonly crmAdapter?: number; // seconds
    };
    readonly memorySize?: {
      readonly executionStarter?: number;
      readonly executionValidator?: number;
      readonly toolMapper?: number;
      readonly toolInvoker?: number;
      readonly executionRecorder?: number;
      readonly compensation?: number;
      readonly executionStatusApi?: number;
    };
  };
  
  // Lambda configuration
  readonly lambda: {
    readonly retryAttempts: number;
    readonly dlqRetentionDays: number;
  };
}

/**
 * Default Execution Infrastructure Configuration
 */
export const DEFAULT_EXECUTION_INFRASTRUCTURE_CONFIG: ExecutionInfrastructureConfig = {
  resourcePrefix: 'cc-native',
  
  tableNames: {
    executionAttempts: 'cc-native-execution-attempts',
    executionOutcomes: 'cc-native-execution-outcomes',
    actionTypeRegistry: 'cc-native-action-type-registry',
    externalWriteDedupe: 'cc-native-external-write-dedupe',
    connectorConfig: 'cc-native-connector-config', // Phase 4.3
    internalNotes: 'cc-native-internal-notes', // Phase 4.3
    internalTasks: 'cc-native-internal-tasks', // Phase 4.3
  },
  
  functionNames: {
    executionStarter: 'cc-native-execution-starter',
    executionValidator: 'cc-native-execution-validator',
    toolMapper: 'cc-native-tool-mapper',
    toolInvoker: 'cc-native-tool-invoker',
    executionRecorder: 'cc-native-execution-recorder',
    executionFailureRecorder: 'cc-native-execution-failure-recorder',
    compensation: 'cc-native-compensation-handler',
    executionStatusApi: 'cc-native-execution-status-api',
    internalAdapter: 'cc-native-internal-adapter-handler', // Phase 4.3
    crmAdapter: 'cc-native-crm-adapter-handler', // Phase 4.3
  },
  
  queueNames: {
    executionStarterDlq: 'cc-native-execution-starter-handler-dlq',
    executionValidatorDlq: 'cc-native-execution-validator-handler-dlq',
    toolMapperDlq: 'cc-native-tool-mapper-handler-dlq',
    toolInvokerDlq: 'cc-native-tool-invoker-handler-dlq',
    executionRecorderDlq: 'cc-native-execution-recorder-handler-dlq',
    executionFailureRecorderDlq: 'cc-native-execution-failure-recorder-handler-dlq',
    compensationDlq: 'cc-native-compensation-handler-dlq',
  },
  
  stepFunctions: {
    stateMachineName: 'cc-native-execution-orchestrator',
    timeoutHours: 1,
  },
  
  s3: {
    executionArtifactsBucketPrefix: 'cc-native-execution-artifacts',
  },
  
  eventBridge: {
    source: 'cc-native',
    detailTypes: {
      actionApproved: 'ACTION_APPROVED',
    },
  },
  
  defaults: {
    // Read from CDK context parameter 'awsRegion' (passed via deploy script)
    // This placeholder value will be overridden by createExecutionInfrastructureConfig()
    region: 'PLACEHOLDER_WILL_BE_OVERRIDDEN',
    timeout: {
      executionStarter: 30, // seconds
      executionValidator: 30, // seconds
      toolMapper: 30, // seconds
      toolInvoker: 60, // seconds (longer for external calls)
      executionRecorder: 30, // seconds
      compensation: 60, // seconds
      executionStatusApi: 30, // seconds
      internalAdapter: 60, // seconds (VPC + DynamoDB; cold start can exceed 30s)
    },
  },
  
  lambda: {
    retryAttempts: 2,
    dlqRetentionDays: 14,
  },
};

/**
 * Creates Execution Infrastructure Configuration with specific values.
 * Follows the same pattern as DecisionInfrastructureConfig.
 * 
 * @param awsRegion - AWS region (from CDK context: awsRegion)
 * @returns ExecutionInfrastructureConfig with provided values
 */
export function createExecutionInfrastructureConfig(
  awsRegion: string
): ExecutionInfrastructureConfig {
  // Validate inputs (fail fast - no defaults)
  if (!awsRegion || typeof awsRegion !== 'string' || awsRegion.trim() === '') {
    throw new Error(
      'awsRegion is required. ' +
      'Please set AWS_REGION in .env.local and ensure the deploy script passes it as -c awsRegion=$AWS_REGION'
    );
  }

  // Merge provided values with default config
  return {
    ...DEFAULT_EXECUTION_INFRASTRUCTURE_CONFIG,
    defaults: {
      ...DEFAULT_EXECUTION_INFRASTRUCTURE_CONFIG.defaults,
      region: awsRegion.trim(),
    },
  };
}
