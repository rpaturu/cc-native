/**
 * Autonomy Infrastructure Configuration - Phase 5.1
 */

export interface AutonomyInfrastructureConfig {
  readonly resourcePrefix: string;
  readonly tableNames: {
    readonly autonomyConfig: string;
    readonly autonomyBudgetState: string;
  };
  readonly functionNames: {
    readonly autonomyAdminApi: string;
  };
  readonly apiGateway: {
    readonly restApiName: string;
  };
  readonly defaults: {
    readonly timeoutSeconds: number;
    readonly memorySize: number;
  };
}

export const DEFAULT_AUTONOMY_INFRASTRUCTURE_CONFIG: AutonomyInfrastructureConfig = {
  resourcePrefix: 'cc-native',
  tableNames: {
    autonomyConfig: 'cc-native-autonomy-config',
    autonomyBudgetState: 'cc-native-autonomy-budget-state',
  },
  functionNames: {
    autonomyAdminApi: 'cc-native-autonomy-admin-api',
  },
  apiGateway: {
    restApiName: 'cc-native-autonomy-admin-api',
  },
  defaults: {
    timeoutSeconds: 30,
    memorySize: 256,
  },
};
