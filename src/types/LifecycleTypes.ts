/**
 * Lifecycle Types - Phase 1: Lifecycle State Inference
 * 
 * Defines lifecycle state inference logic, transitions, and read models
 * for efficient lifecycle state management.
 */

import { Timestamped, TenantScoped } from './CommonTypes';
import { SignalType, SignalStatus } from './SignalTypes';

/**
 * Lifecycle State
 */
export enum LifecycleState {
  PROSPECT = 'PROSPECT',
  SUSPECT = 'SUSPECT',
  CUSTOMER = 'CUSTOMER',
}

/**
 * Lifecycle Transition
 */
export interface LifecycleTransition extends Timestamped, TenantScoped {
  transitionId: string;
  accountId: string;
  fromState: LifecycleState;
  toState: LifecycleState;
  triggeredBy: SignalType[];        // Signals that triggered this transition
  evidenceRefs: string[];            // Evidence snapshot references
  inferenceRuleVersion: string;      // Version of inference rule used
}

/**
 * Lifecycle Inference Rule
 */
export interface LifecycleInferenceRule {
  ruleId: string;
  inferenceRuleVersion: string;
  priority: number;                  // Evaluation priority (higher = evaluated first)
  targetState: LifecycleState;
  conditions: LifecycleInferenceCondition[];
  description: string;
}

/**
 * Lifecycle Inference Condition
 */
export interface LifecycleInferenceCondition {
  signalType?: SignalType;           // Required signal type (if any)
  hasActiveContract?: boolean;       // Contract requirement (for CUSTOMER)
  hasEngagement?: boolean;           // Engagement requirement (for SUSPECT)
  hasActivation?: boolean;           // Activation requirement (for PROSPECT)
}

/**
 * Account State - Read Model for Efficient Inference
 * 
 * Maintains current lifecycle state and active signal index for fast lookup.
 * Updated atomically with signal creation.
 */
export interface AccountState extends Timestamped, TenantScoped {
  accountId: string;
  currentLifecycleState: LifecycleState;
  activeSignalIndex: Record<SignalType, string[]>; // Active signal IDs by type
  lastTransitionAt: string | null;   // ISO timestamp of last transition
  lastEngagementAt: string | null;   // ISO timestamp of last engagement
  hasActiveContract: boolean;         // Whether account has active contract
  lastInferenceAt: string;           // ISO timestamp of last inference run
  inferenceRuleVersion: string;      // Version of inference rule used
}

/**
 * Signal Precedence Rule
 * 
 * Defines signal conflict resolution logic.
 */
export interface SignalPrecedenceRule {
  ruleId: string;
  precedenceRuleVersion: string;
  signalType: SignalType;
  takesPrecedenceOver: SignalType[]; // Signal types this signal takes precedence over
  description: string;
}

/**
 * Signal Suppression Rule
 * 
 * Defines lifecycle-scoped suppression logic.
 */
export interface SignalSuppressionRule {
  ruleId: string;
  suppressionRuleVersion: string;
  fromState: LifecycleState;
  toState: LifecycleState;
  suppressSignalTypes: SignalType[]; // Signal types to suppress on this transition
  description: string;
}

/**
 * Lifecycle Inference Priority Order
 * 
 * Inference is evaluated in this order: CUSTOMER → SUSPECT → PROSPECT
 * This prevents edge ambiguity when signals overlap briefly during transitions.
 */
export const LIFECYCLE_INFERENCE_PRIORITY: LifecycleState[] = [
  LifecycleState.CUSTOMER,
  LifecycleState.SUSPECT,
  LifecycleState.PROSPECT,
];

/**
 * Default Lifecycle Inference Rules
 */
export const DEFAULT_LIFECYCLE_INFERENCE_RULES: LifecycleInferenceRule[] = [
  {
    ruleId: 'customer-rule',
    inferenceRuleVersion: '1.0.0',
    priority: 3, // Highest priority
    targetState: LifecycleState.CUSTOMER,
    conditions: [
      { hasActiveContract: true },
    ],
    description: 'Account has active contract',
  },
  {
    ruleId: 'suspect-rule',
    inferenceRuleVersion: '1.0.0',
    priority: 2,
    targetState: LifecycleState.SUSPECT,
    conditions: [
      { signalType: SignalType.FIRST_ENGAGEMENT_OCCURRED },
    ],
    description: 'First engagement occurred',
  },
  {
    ruleId: 'prospect-rule',
    inferenceRuleVersion: '1.0.0',
    priority: 1, // Lowest priority
    targetState: LifecycleState.PROSPECT,
    conditions: [
      { signalType: SignalType.ACCOUNT_ACTIVATION_DETECTED },
      { hasEngagement: false },
    ],
    description: 'Activation detected with no engagement',
  },
];

/**
 * Default Suppression Rules
 * 
 * Defines which signals are suppressed on lifecycle transitions.
 */
export const DEFAULT_SUPPRESSION_RULES: SignalSuppressionRule[] = [
  {
    ruleId: 'prospect-to-suspect-suppression',
    suppressionRuleVersion: '1.0.0',
    fromState: LifecycleState.PROSPECT,
    toState: LifecycleState.SUSPECT,
    suppressSignalTypes: [
      SignalType.ACCOUNT_ACTIVATION_DETECTED,
      SignalType.NO_ENGAGEMENT_PRESENT,
    ],
    description: 'Suppress PROSPECT signals on SUSPECT transition',
  },
  {
    ruleId: 'suspect-to-customer-suppression',
    suppressionRuleVersion: '1.0.0',
    fromState: LifecycleState.SUSPECT,
    toState: LifecycleState.CUSTOMER,
    suppressSignalTypes: [
      SignalType.FIRST_ENGAGEMENT_OCCURRED,
      SignalType.DISCOVERY_PROGRESS_STALLED,
      SignalType.STAKEHOLDER_GAP_DETECTED,
    ],
    description: 'Suppress SUSPECT signals on CUSTOMER transition',
  },
];
