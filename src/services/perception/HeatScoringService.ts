/**
 * Heat Scoring Service - Phase 5.3
 *
 * Computes account heat from posture + signals; stores latest only (sk=HEAT#LATEST).
 * Triggers: recompute on signal arrival; periodic sweep for cold accounts.
 */

import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { AccountPostureStateV1 } from '../../types/PostureTypes';
import { PostureState } from '../../types/PostureTypes';
import { Signal } from '../../types/SignalTypes';
import { AccountHeatV1, HeatTier } from '../../types/perception/PerceptionSchedulerTypes';
import { HeatTierPolicyService } from './HeatTierPolicyService';
import { Logger } from '../core/Logger';

const SK_HEAT_LATEST = 'HEAT#LATEST';

function heatPk(tenantId: string, accountId: string): string {
  return `TENANT#${tenantId}#ACCOUNT#${accountId}`;
}

/** Posture state → 0–1 score (higher = more active/urgent). */
function postureToScore(posture: PostureState): number {
  switch (posture) {
    case PostureState.DORMANT:
      return 0;
    case PostureState.OK:
      return 0.3;
    case PostureState.WATCH:
      return 0.5;
    case PostureState.AT_RISK:
      return 0.7;
    case PostureState.EXPAND:
      return 0.9;
    default:
      return 0.3;
  }
}

/** Hours since most recent signal → recency score 0–1 (recent = high). */
function signalRecencyToScore(signals: Signal[]): number {
  if (signals.length === 0) return 0;
  const sorted = [...signals].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  const mostRecent = new Date(sorted[0].createdAt).getTime();
  const hoursAgo = (Date.now() - mostRecent) / (1000 * 60 * 60);
  if (hoursAgo <= 1) return 1;
  if (hoursAgo <= 6) return 0.7;
  if (hoursAgo <= 24) return 0.4;
  return 0.1;
}

/** Signal count → volume score 0–1 (capped at 5 signals). */
function signalVolumeToScore(signals: Signal[]): number {
  return Math.min(signals.length / 5, 1);
}

/** Raw score 0–1 → tier (no hysteresis). */
function scoreToTier(score: number): HeatTier {
  if (score >= 0.7) return 'HOT';
  if (score >= 0.35) return 'WARM';
  return 'COLD';
}

export interface HeatScoringServiceConfig {
  dynamoClient: DynamoDBDocumentClient;
  tableName: string;
  getPostureState: (accountId: string, tenantId: string) => Promise<AccountPostureStateV1 | null>;
  getSignalsForAccount: (
    accountId: string,
    tenantId: string,
    filters?: { status?: string }
  ) => Promise<Signal[]>;
  heatTierPolicyService: HeatTierPolicyService;
  logger: Logger;
}

export class HeatScoringService {
  private dynamoClient: DynamoDBDocumentClient;
  private tableName: string;
  private getPostureState: HeatScoringServiceConfig['getPostureState'];
  private getSignalsForAccount: HeatScoringServiceConfig['getSignalsForAccount'];
  private heatTierPolicyService: HeatTierPolicyService;
  private logger: Logger;

  constructor(config: HeatScoringServiceConfig) {
    this.dynamoClient = config.dynamoClient;
    this.tableName = config.tableName;
    this.getPostureState = config.getPostureState;
    this.getSignalsForAccount = config.getSignalsForAccount;
    this.heatTierPolicyService = config.heatTierPolicyService;
    this.logger = config.logger;
  }

  /**
   * Compute heat for account and write latest only (sk=HEAT#LATEST).
   * Applies hysteresis: demotion only after demotion_cooldown_hours since last computed_at.
   */
  async computeAndStoreHeat(tenantId: string, accountId: string): Promise<AccountHeatV1> {
    const [posture, signals, previousHeat] = await Promise.all([
      this.getPostureState(accountId, tenantId),
      this.getSignalsForAccount(accountId, tenantId, { status: 'ACTIVE' }),
      this.getLatestHeat(tenantId, accountId),
    ]);

    const postureScore = posture ? postureToScore(posture.posture) : 0;
    const signalRecency = signalRecencyToScore(signals);
    const signalVolume = signalVolumeToScore(signals);
    const rawScore =
      0.4 * postureScore + 0.35 * signalRecency + 0.25 * signalVolume;
    const rawTier = scoreToTier(rawScore);

    const tierOrder: HeatTier[] = ['COLD', 'WARM', 'HOT'];
    const rawTierIndex = tierOrder.indexOf(rawTier);
    let finalTier = rawTier;
    if (previousHeat && rawTierIndex < tierOrder.indexOf(previousHeat.heat_tier)) {
      const policy = this.heatTierPolicyService.getPolicy(previousHeat.heat_tier);
      const cooldownHours = policy?.demotion_cooldown_hours ?? 48;
      const lastComputed = new Date(previousHeat.computed_at).getTime();
      const hoursSince = (Date.now() - lastComputed) / (1000 * 60 * 60);
      if (hoursSince < cooldownHours) {
        finalTier = previousHeat.heat_tier;
      }
    }

    const now = new Date().toISOString();
    const heat: AccountHeatV1 = {
      pk: heatPk(tenantId, accountId),
      sk: SK_HEAT_LATEST,
      tenant_id: tenantId,
      account_id: accountId,
      heat_score: rawScore,
      heat_tier: finalTier,
      factors: {
        posture_score: postureScore,
        signal_recency: signalRecency,
        signal_volume: signalVolume,
      },
      computed_at: now,
      updated_at: now,
    };

    await this.dynamoClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: heat,
      })
    );
    this.logger.debug('Heat computed and stored', {
      tenantId,
      accountId,
      heat_tier: finalTier,
      heat_score: rawScore,
    });
    return heat;
  }

  /** Get latest heat for account (for orchestrator or hysteresis). */
  async getLatestHeat(
    tenantId: string,
    accountId: string
  ): Promise<AccountHeatV1 | null> {
    const result = await this.dynamoClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { pk: heatPk(tenantId, accountId), sk: SK_HEAT_LATEST },
      })
    );
    return (result.Item as AccountHeatV1) ?? null;
  }
}
