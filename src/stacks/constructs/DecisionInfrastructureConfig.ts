/**
 * Decision Infrastructure Configuration
 * 
 * Centralized configuration for Decision Infrastructure construct.
 * All hardcoded values should be defined here for maintainability and scalability.
 */

export interface DecisionInfrastructureConfig {
  // Resource naming
  readonly resourcePrefix: string;
  
  // Table names
  readonly tableNames: {
    readonly decisionBudget: string;
    readonly actionIntent: string;
    readonly decisionProposal: string;
  };
  
  // Function names
  readonly functionNames: {
    readonly decisionEvaluation: string;
    readonly decisionTrigger: string;
    readonly decisionApi: string;
    readonly budgetReset: string;
  };
  
  // Queue names
  readonly queueNames: {
    readonly decisionEvaluationDlq: string;
    readonly decisionTriggerDlq: string;
  };
  
  // API Gateway
  readonly apiGateway: {
    readonly restApiName: string;
    readonly apiKeyName: string;
    readonly usagePlanName: string;
  };
  
  // EventBridge
  readonly eventBridge: {
    readonly sources: {
      readonly perception: string;
      readonly decision: string;
    };
    readonly detailTypes: {
      readonly lifecycleStateChanged: string;
      readonly signalDetected: string;
      readonly decisionEvaluationRequested: string;
    };
    readonly signalTypes: {
      readonly renewalWindowEntered: string;
      readonly supportRiskEmerging: string;
      readonly usageTrendChange: string;
    };
  };
  
  // Bedrock
  readonly bedrock: {
    readonly modelId: string;
    readonly modelPattern: string; // For ARN wildcard matching
  };
  
  // Neptune
  readonly neptune: {
    readonly iamActions: {
      readonly connect: string;
      readonly readDataViaQuery: string;
    };
    readonly queryLanguage: string;
  };
  
  // Defaults
  readonly defaults: {
    readonly region: string;
    readonly timeout: {
      readonly decisionEvaluation: number; // minutes
      readonly decisionTrigger: number; // seconds
      readonly decisionApi: number; // minutes
      readonly budgetReset: number; // minutes
    };
    readonly memorySize: {
      readonly decisionEvaluation: number;
      readonly decisionTrigger: number;
      readonly decisionApi: number;
      readonly budgetReset: number;
    };
  };
  
  // API Gateway throttling
  readonly throttling: {
    readonly rateLimit: number; // requests per second
    readonly burstLimit: number;
    readonly quotaLimit: number; // requests per day
  };
  
  // API Gateway CORS
  readonly cors: {
    readonly allowOrigins: string[];
    readonly allowMethods: string[];
    readonly allowHeaders: string[];
  };
  
  // Lambda configuration
  readonly lambda: {
    readonly retryAttempts: number;
    readonly dlqRetentionDays: number;
  };
  
  // Bedrock IAM
  readonly bedrockIam: {
    readonly actions: string[];
  };
  
  // Budget reset schedule (cron expression)
  readonly budgetReset: {
    readonly schedule: {
      readonly minute: string;
      readonly hour: string;
      readonly day: string;
      readonly month: string;
      readonly year: string;
    };
    readonly description: string;
  };
}

/**
 * Default Decision Infrastructure Configuration
 */
export const DEFAULT_DECISION_INFRASTRUCTURE_CONFIG: DecisionInfrastructureConfig = {
  resourcePrefix: 'cc-native',
  
  tableNames: {
    decisionBudget: 'cc-native-decision-budget',
    actionIntent: 'cc-native-action-intent',
    decisionProposal: 'cc-native-decision-proposal',
  },
  
  functionNames: {
    decisionEvaluation: 'cc-native-decision-evaluation-handler',
    decisionTrigger: 'cc-native-decision-trigger-handler',
    decisionApi: 'cc-native-decision-api-handler',
    budgetReset: 'cc-native-budget-reset-handler',
  },
  
  queueNames: {
    decisionEvaluationDlq: 'cc-native-decision-evaluation-handler-dlq',
    decisionTriggerDlq: 'cc-native-decision-trigger-handler-dlq',
  },
  
  apiGateway: {
    restApiName: 'cc-native-decision-api',
    apiKeyName: 'cc-native-decision-api-key',
    usagePlanName: 'cc-native-decision-api-usage-plan',
  },
  
  eventBridge: {
    sources: {
      perception: 'cc-native.perception',
      decision: 'cc-native.decision',
    },
    detailTypes: {
      lifecycleStateChanged: 'LIFECYCLE_STATE_CHANGED',
      signalDetected: 'SIGNAL_DETECTED',
      decisionEvaluationRequested: 'DECISION_EVALUATION_REQUESTED',
    },
    signalTypes: {
      renewalWindowEntered: 'RENEWAL_WINDOW_ENTERED',
      supportRiskEmerging: 'SUPPORT_RISK_EMERGING',
      usageTrendChange: 'USAGE_TREND_CHANGE',
    },
  },
  
  bedrock: {
    modelId: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
    modelPattern: 'anthropic.claude-3-*',
  },
  
  neptune: {
    iamActions: {
      connect: 'neptune-db:connect',
      readDataViaQuery: 'neptune-db:ReadDataViaQuery',
    },
    queryLanguage: 'gremlin',
  },
  
  defaults: {
    region: 'us-west-2',
    timeout: {
      decisionEvaluation: 5, // minutes
      decisionTrigger: 30, // seconds
      decisionApi: 5, // minutes
      budgetReset: 5, // minutes
    },
    memorySize: {
      decisionEvaluation: 1024,
      decisionTrigger: 256,
      decisionApi: 1024,
      budgetReset: 256,
    },
  },
  
  throttling: {
    rateLimit: 100, // requests per second
    burstLimit: 200,
    quotaLimit: 10000, // requests per day
  },
  
  cors: {
    // ⚠️ SECURITY: Wildcard '*' allows any origin - RESTRICT IN PRODUCTION
    // Override this in DecisionInfrastructureProps.config for production deployments
    // Example: allowOrigins: ['https://app.yourdomain.com', 'https://admin.yourdomain.com']
    allowOrigins: ['*'], // TODO: Replace with specific domains in production
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'X-Amz-Date', 'Authorization', 'X-Api-Key', 'x-tenant-id'],
  },
  
  lambda: {
    retryAttempts: 2,
    dlqRetentionDays: 14,
  },
  
  bedrockIam: {
    actions: ['bedrock:InvokeModel'],
  },
  
  budgetReset: {
    schedule: {
      minute: '0',
      hour: '0',
      day: '*',
      month: '*',
      year: '*',
    },
    description: 'Daily budget reset at midnight UTC',
  },
};
