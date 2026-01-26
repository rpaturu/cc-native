/**
 * LifecycleStateService - Infer and manage account lifecycle state
 * 
 * Uses AccountState read model for efficient inference (point reads, not scans).
 * Implements deterministic lifecycle inference with priority order:
 * CUSTOMER → SUSPECT → PROSPECT
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import {
  AccountState,
  LifecycleState,
  LifecycleTransition,
  LIFECYCLE_INFERENCE_PRIORITY,
  DEFAULT_LIFECYCLE_INFERENCE_RULES,
} from '../../types/LifecycleTypes';
import { Signal, SignalType, SignalStatus } from '../../types/SignalTypes';
import { Logger } from '../core/Logger';
import { LedgerService } from '../ledger/LedgerService';
import { LedgerEventType } from '../../types/LedgerTypes';
import { SuppressionEngine } from './SuppressionEngine';
import { v4 as uuidv4 } from 'uuid';

export interface LifecycleStateServiceConfig {
  logger: Logger;
  accountsTableName: string;
  ledgerService: LedgerService;
  suppressionEngine: SuppressionEngine;
  region?: string;
  inferenceRuleVersion?: string;
}

/**
 * LifecycleStateService
 */
export class LifecycleStateService {
  private dynamoClient: DynamoDBDocumentClient;
  private logger: Logger;
  private accountsTableName: string;
  private ledgerService: LedgerService;
  private suppressionEngine: SuppressionEngine;
  private inferenceRuleVersion: string;

  constructor(config: LifecycleStateServiceConfig) {
    this.logger = config.logger;
    this.accountsTableName = config.accountsTableName;
    this.ledgerService = config.ledgerService;
    this.suppressionEngine = config.suppressionEngine;
    this.inferenceRuleVersion = config.inferenceRuleVersion || '1.0.0';
    
    this.dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({ region: config.region }));
  }

  /**
   * Get inference rule version
   */
  getInferenceRuleVersion(): string {
    return this.inferenceRuleVersion;
  }

  /**
   * Get AccountState read model (efficient point read)
   */
  async getAccountState(accountId: string, tenantId: string): Promise<AccountState | null> {
    try {
      const result = await this.dynamoClient.send(new GetCommand({
        TableName: this.accountsTableName,
        Key: {
          tenantId,
          accountId,
        },
      }));

      if (!result.Item) {
        return null;
      }

      // Extract AccountState from account record
      const item = result.Item;
      return {
        accountId: item.accountId,
        tenantId: item.tenantId,
        currentLifecycleState: item.currentLifecycleState || LifecycleState.PROSPECT,
        activeSignalIndex: item.activeSignalIndex || this.initializeActiveSignalIndex(),
        lastTransitionAt: item.lastTransitionAt || null,
        lastEngagementAt: item.lastEngagementAt || null,
        hasActiveContract: item.hasActiveContract || false,
        lastInferenceAt: item.lastInferenceAt || new Date().toISOString(),
        inferenceRuleVersion: item.inferenceRuleVersion || this.inferenceRuleVersion,
        createdAt: item.createdAt || new Date().toISOString(),
        updatedAt: item.updatedAt || new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error('Failed to get AccountState', {
        accountId,
        tenantId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Update AccountState read model
   * 
   * Called atomically with signal creation.
   */
  async updateAccountState(
    accountId: string,
    tenantId: string,
    updates: Partial<AccountState>
  ): Promise<AccountState> {
    const now = new Date().toISOString();

    try {
      // Get current state
      const current = await this.getAccountState(accountId, tenantId);
      const existing = current || this.createInitialAccountState(accountId, tenantId);

      // Merge updates
      const updated: AccountState = {
        ...existing,
        ...updates,
        updatedAt: now,
        lastInferenceAt: now,
      };

      // Update in DynamoDB
      await this.dynamoClient.send(new PutCommand({
        TableName: this.accountsTableName,
        Item: {
          tenantId,
          accountId,
          currentLifecycleState: updated.currentLifecycleState,
          activeSignalIndex: updated.activeSignalIndex,
          lastTransitionAt: updated.lastTransitionAt,
          lastEngagementAt: updated.lastEngagementAt,
          hasActiveContract: updated.hasActiveContract,
          lastInferenceAt: updated.lastInferenceAt,
          inferenceRuleVersion: updated.inferenceRuleVersion,
          createdAt: updated.createdAt,
          updatedAt: updated.updatedAt,
        },
      }));

      this.logger.debug('AccountState updated', {
        accountId,
        tenantId,
        lifecycleState: updated.currentLifecycleState,
      });

      return updated;
    } catch (error) {
      this.logger.error('Failed to update AccountState', {
        accountId,
        tenantId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Infer lifecycle state from AccountState read model
   * 
   * Uses priority order: CUSTOMER → SUSPECT → PROSPECT
   */
  async inferLifecycleState(accountId: string, tenantId: string): Promise<LifecycleState> {
    const accountState = await this.getAccountState(accountId, tenantId);
    
    if (!accountState) {
      // No state exists, default to PROSPECT
      return LifecycleState.PROSPECT;
    }

    // Evaluate in priority order
    for (const targetState of LIFECYCLE_INFERENCE_PRIORITY) {
      const rule = DEFAULT_LIFECYCLE_INFERENCE_RULES.find(r => r.targetState === targetState);
      if (!rule) {
        continue;
      }

      // Check if rule conditions are met
      if (this.evaluateInferenceRule(rule, accountState)) {
        return targetState;
      }
    }

    // Default to PROSPECT if no rules match
    return LifecycleState.PROSPECT;
  }

  /**
   * Evaluate inference rule against AccountState
   */
  private evaluateInferenceRule(rule: any, accountState: AccountState): boolean {
    for (const condition of rule.conditions) {
      // Check signal type condition
      if (condition.signalType) {
        const activeSignals = accountState.activeSignalIndex[condition.signalType as SignalType] || [];
        if (activeSignals.length === 0) {
          return false; // Required signal not present
        }
      }

      // Check hasActiveContract condition
      if (condition.hasActiveContract !== undefined) {
        if (accountState.hasActiveContract !== condition.hasActiveContract) {
          return false;
        }
      }

      // Check hasEngagement condition
      if (condition.hasEngagement !== undefined) {
        const hasEngagement = !!accountState.lastEngagementAt;
        if (hasEngagement !== condition.hasEngagement) {
          return false;
        }
      }

      // Check hasActivation condition
      if (condition.hasActivation !== undefined) {
        const hasActivation = (accountState.activeSignalIndex[SignalType.ACCOUNT_ACTIVATION_DETECTED] || []).length > 0;
        if (hasActivation !== condition.hasActivation) {
          return false;
        }
      }
    }

    return true; // All conditions met
  }

  /**
   * Check if transition is needed
   */
  async shouldTransition(accountId: string, tenantId: string, activeSignals: Signal[]): Promise<boolean> {
    const currentState = await this.inferLifecycleState(accountId, tenantId);
    const accountState = await this.getAccountState(accountId, tenantId);

    if (!accountState) {
      return false;
    }

    // Re-infer with updated signals
    const updatedState = await this.inferLifecycleState(accountId, tenantId);

    return updatedState !== currentState;
  }

  /**
   * Record lifecycle transition
   */
  async recordTransition(
    accountId: string,
    tenantId: string,
    fromState: LifecycleState,
    toState: LifecycleState,
    triggeredBy: SignalType[],
    evidenceRefs: string[],
    traceId: string
  ): Promise<LifecycleTransition> {
    const now = new Date().toISOString();
    const transitionId = `trans_${Date.now()}_${uuidv4()}`;

    const transition: LifecycleTransition = {
      transitionId,
      accountId,
      tenantId,
      fromState,
      toState,
      triggeredBy,
      evidenceRefs,
      inferenceRuleVersion: this.inferenceRuleVersion,
      createdAt: now,
      updatedAt: now,
    };

    try {
      // Store transition in ledger (transitions are also logged there)
      // For now, transitions are primarily stored via ledger entries
      // A dedicated transitions table can be added later if needed

      // Update AccountState
      await this.updateAccountState(accountId, tenantId, {
        currentLifecycleState: toState,
        lastTransitionAt: now,
      });

      // Log to ledger
      await this.ledgerService.append({
        eventType: LedgerEventType.SIGNAL, // Use SIGNAL for lifecycle transitions
        accountId,
        tenantId,
        traceId,
        data: {
          transitionId,
          fromState,
          toState,
          triggeredBy,
          evidenceRefs,
        },
        evidenceRefs: evidenceRefs.map(ref => ({
          type: 's3' as const,
          location: ref,
          timestamp: now,
        })),
      });

      this.logger.info('Lifecycle transition recorded', {
        accountId,
        tenantId,
        fromState,
        toState,
        transitionId,
      });

      return transition;
    } catch (error) {
      this.logger.error('Failed to record transition', {
        accountId,
        tenantId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get lifecycle history
   * 
   * Retrieves transitions from ledger entries.
   * A dedicated transitions table can be added later for better querying.
   */
  async getLifecycleHistory(accountId: string, tenantId: string): Promise<LifecycleTransition[]> {
    try {
      // Query ledger for LIFECYCLE_TRANSITION events
      // For now, return empty array - can be enhanced with ledger query
      // TODO: Implement ledger query for transitions
      this.logger.debug('Getting lifecycle history from ledger', {
        accountId,
        tenantId,
      });
      
      return [];
    } catch (error) {
      this.logger.error('Failed to get lifecycle history', {
        accountId,
        tenantId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Create initial AccountState
   */
  private createInitialAccountState(accountId: string, tenantId: string): AccountState {
    const now = new Date().toISOString();
    return {
      accountId,
      tenantId,
      currentLifecycleState: LifecycleState.PROSPECT,
      activeSignalIndex: this.initializeActiveSignalIndex(),
      lastTransitionAt: null,
      lastEngagementAt: null,
      hasActiveContract: false,
      lastInferenceAt: now,
      inferenceRuleVersion: this.inferenceRuleVersion,
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * Initialize active signal index
   */
  private initializeActiveSignalIndex(): Record<SignalType, string[]> {
    return {
      [SignalType.ACCOUNT_ACTIVATION_DETECTED]: [],
      [SignalType.NO_ENGAGEMENT_PRESENT]: [],
      [SignalType.FIRST_ENGAGEMENT_OCCURRED]: [],
      [SignalType.DISCOVERY_PROGRESS_STALLED]: [],
      [SignalType.STAKEHOLDER_GAP_DETECTED]: [],
      [SignalType.ACTION_EXECUTED]: [],
      [SignalType.ACTION_FAILED]: [],
      [SignalType.USAGE_TREND_CHANGE]: [],
      [SignalType.SUPPORT_RISK_EMERGING]: [],
      [SignalType.RENEWAL_WINDOW_ENTERED]: [],
    };
  }
}
