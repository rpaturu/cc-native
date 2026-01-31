/**
 * Decision Scheduling Infrastructure Configuration - Phase 5.2
 */

export interface DecisionSchedulingInfrastructureConfig {
  readonly resourcePrefix: string;
  readonly tableNames: {
    readonly decisionRunState: string;
    readonly idempotencyStore: string;
  };
  readonly functionNames: {
    readonly decisionCostGate: string;
    readonly decisionDeferredRequeue: string;
  };
  readonly scheduleGroupName: string;
  readonly defaults: {
    readonly timeoutSeconds: number;
    readonly memorySize: number;
  };
}

export const DEFAULT_DECISION_SCHEDULING_INFRASTRUCTURE_CONFIG: DecisionSchedulingInfrastructureConfig = {
  resourcePrefix: 'cc-native',
  tableNames: {
    decisionRunState: 'cc-native-decision-run-state',
    idempotencyStore: 'cc-native-decision-idempotency-store',
  },
  functionNames: {
    decisionCostGate: 'cc-native-decision-cost-gate',
    decisionDeferredRequeue: 'cc-native-decision-deferred-requeue',
  },
  scheduleGroupName: 'default',
  defaults: {
    timeoutSeconds: 60,
    memorySize: 256,
  },
};
