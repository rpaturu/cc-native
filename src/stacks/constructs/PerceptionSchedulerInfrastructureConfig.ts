/**
 * Perception Scheduler Infrastructure Configuration - Phase 5.3
 */

export interface PerceptionSchedulerInfrastructureConfig {
  readonly resourcePrefix: string;
  readonly tableNames: {
    readonly perceptionScheduler: string;
    readonly pullIdempotencyStore: string;
  };
  readonly functionNames: {
    readonly heatScoring: string;
    readonly perceptionPullOrchestrator: string;
  };
  readonly defaults: {
    readonly timeoutSeconds: number;
    readonly memorySize: number;
  };
}

export const DEFAULT_PERCEPTION_SCHEDULER_INFRASTRUCTURE_CONFIG: PerceptionSchedulerInfrastructureConfig = {
  resourcePrefix: 'cc-native',
  tableNames: {
    perceptionScheduler: 'cc-native-perception-scheduler',
    pullIdempotencyStore: 'cc-native-pull-idempotency-store',
  },
  functionNames: {
    heatScoring: 'cc-native-heat-scoring',
    perceptionPullOrchestrator: 'cc-native-perception-pull-orchestrator',
  },
  defaults: {
    timeoutSeconds: 60,
    memorySize: 256,
  },
};
