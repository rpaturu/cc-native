/**
 * Unit tests for HeatScoringService - Phase 5.3
 */

import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { mockDynamoDBDocumentClient, resetAllMocks } from '../../__mocks__/aws-sdk-clients';
import { HeatScoringService } from '../../../services/perception/HeatScoringService';
import { HeatTierPolicyService } from '../../../services/perception/HeatTierPolicyService';
import { Logger } from '../../../services/core/Logger';
import { Momentum, PostureState } from '../../../types/PostureTypes';
import { SignalStatus } from '../../../types/SignalTypes';

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn(() => mockDynamoDBDocumentClient) },
  GetCommand: jest.fn(),
  PutCommand: jest.fn(),
}));

const logger = new Logger('HeatScoringServiceTest');

describe('HeatScoringService', () => {
  const tableName = 'test-heat';
  const tenantId = 't1';
  const accountId = 'a1';

  const getPostureState = jest.fn();
  const getSignalsForAccount = jest.fn();
  const heatTierPolicyService = new HeatTierPolicyService();

  let service: HeatScoringService;

  beforeEach(() => {
    resetAllMocks();
    jest.clearAllMocks();
    getPostureState.mockReset();
    getSignalsForAccount.mockReset();
    service = new HeatScoringService({
      dynamoClient: mockDynamoDBDocumentClient as any,
      tableName,
      getPostureState,
      getSignalsForAccount,
      heatTierPolicyService,
      logger,
    });
  });

  it('computeAndStoreHeat writes HEAT#LATEST with heat_tier and heat_score', async () => {
    getPostureState.mockResolvedValue({
      account_id: accountId,
      tenantId,
      posture: PostureState.WATCH,
      momentum: Momentum.FLAT,
      risk_factors: [],
      opportunities: [],
      unknowns: [],
      evidence_signal_ids: [],
      evidence_snapshot_refs: [],
      evidence_signal_types: [],
      ruleset_version: 'v1',
      schema_version: 'v1',
      active_signals_hash: 'h',
      inputs_hash: 'h',
      evaluated_at: new Date().toISOString(),
      output_ttl_days: null,
      rule_id: 'r1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    getSignalsForAccount.mockResolvedValue([
      {
        signalId: 's1',
        accountId,
        tenantId,
        signalType: 'RENEWAL_WINDOW_ENTERED',
        status: SignalStatus.ACTIVE,
        createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
        updatedAt: new Date().toISOString(),
      } as any,
    ]);
    mockDynamoDBDocumentClient.send.mockResolvedValue({}); // GetCommand (previous heat) then PutCommand

    const heat = await service.computeAndStoreHeat(tenantId, accountId);

    expect(heat.pk).toBe(`TENANT#${tenantId}#ACCOUNT#${accountId}`);
    expect(heat.sk).toBe('HEAT#LATEST');
    expect(heat.tenant_id).toBe(tenantId);
    expect(heat.account_id).toBe(accountId);
    expect(heat.heat_score).toBeGreaterThanOrEqual(0);
    expect(heat.heat_score).toBeLessThanOrEqual(1);
    expect(['HOT', 'WARM', 'COLD']).toContain(heat.heat_tier);
    expect(heat.factors?.posture_score).toBeDefined();
    expect(heat.factors?.signal_recency).toBeDefined();
    expect(heat.factors?.signal_volume).toBeDefined();
    expect(PutCommand).toHaveBeenCalled();
  });

  it('getLatestHeat returns null when no item', async () => {
    mockDynamoDBDocumentClient.send.mockResolvedValue({ Item: undefined });

    const result = await service.getLatestHeat(tenantId, accountId);

    expect(result).toBeNull();
  });

  it('getLatestHeat returns AccountHeatV1 when item exists', async () => {
    const item = {
      pk: `TENANT#${tenantId}#ACCOUNT#${accountId}`,
      sk: 'HEAT#LATEST',
      tenant_id: tenantId,
      account_id: accountId,
      heat_score: 0.6,
      heat_tier: 'WARM',
      computed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    mockDynamoDBDocumentClient.send.mockResolvedValue({ Item: item });

    const result = await service.getLatestHeat(tenantId, accountId);

    expect(result).toEqual(item);
  });

  const basePosture = {
    account_id: accountId,
    tenantId,
    momentum: Momentum.FLAT,
    risk_factors: [],
    opportunities: [],
    unknowns: [],
    evidence_signal_ids: [],
    evidence_snapshot_refs: [],
    evidence_signal_types: [],
    ruleset_version: 'v1',
    schema_version: 'v1',
    active_signals_hash: 'h',
    inputs_hash: 'h',
    evaluated_at: new Date().toISOString(),
    output_ttl_days: null,
    rule_id: 'r1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  it('computeAndStoreHeat uses postureToScore for DORMANT, OK, AT_RISK, EXPAND', async () => {
    const postures = [
      PostureState.DORMANT,
      PostureState.OK,
      PostureState.AT_RISK,
      PostureState.EXPAND,
    ] as const;
    for (const p of postures) {
      getPostureState.mockResolvedValue({ ...basePosture, posture: p });
      getSignalsForAccount.mockResolvedValue([]);
      mockDynamoDBDocumentClient.send
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({});
      const heat = await service.computeAndStoreHeat(tenantId, accountId);
      expect(heat.factors?.posture_score).toBeDefined();
      expect(heat.heat_tier).toBeDefined();
    }
  });

  it('computeAndStoreHeat uses postureScore 0 when getPostureState returns null', async () => {
    getPostureState.mockResolvedValue(null);
    getSignalsForAccount.mockResolvedValue([]);
    mockDynamoDBDocumentClient.send
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});
    const heat = await service.computeAndStoreHeat(tenantId, accountId);
    expect(heat.factors?.posture_score).toBe(0);
    expect(heat.heat_score).toBeLessThanOrEqual(0.25);
  });

  it('computeAndStoreHeat signalRecencyToScore: empty signals yields 0', async () => {
    getPostureState.mockResolvedValue({ ...basePosture, posture: PostureState.OK });
    getSignalsForAccount.mockResolvedValue([]);
    mockDynamoDBDocumentClient.send
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});
    const heat = await service.computeAndStoreHeat(tenantId, accountId);
    expect(heat.factors?.signal_recency).toBe(0);
  });

  it('computeAndStoreHeat signalRecencyToScore: recent signal (<=1h) yields 1', async () => {
    getPostureState.mockResolvedValue({ ...basePosture, posture: PostureState.OK });
    getSignalsForAccount.mockResolvedValue([
      {
        signalId: 's1',
        accountId,
        tenantId,
        signalType: 'RENEWAL',
        status: SignalStatus.ACTIVE,
        createdAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
        updatedAt: new Date().toISOString(),
      } as any,
    ]);
    mockDynamoDBDocumentClient.send
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});
    const heat = await service.computeAndStoreHeat(tenantId, accountId);
    expect(heat.factors?.signal_recency).toBe(1);
  });

  it('computeAndStoreHeat signalRecencyToScore: 3h ago yields 0.7', async () => {
    getPostureState.mockResolvedValue({ ...basePosture, posture: PostureState.OK });
    getSignalsForAccount.mockResolvedValue([
      {
        signalId: 's1',
        accountId,
        tenantId,
        signalType: 'RENEWAL',
        status: SignalStatus.ACTIVE,
        createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
        updatedAt: new Date().toISOString(),
      } as any,
    ]);
    mockDynamoDBDocumentClient.send
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});
    const heat = await service.computeAndStoreHeat(tenantId, accountId);
    expect(heat.factors?.signal_recency).toBe(0.7);
  });

  it('computeAndStoreHeat signalRecencyToScore: 12h ago yields 0.4', async () => {
    getPostureState.mockResolvedValue({ ...basePosture, posture: PostureState.OK });
    getSignalsForAccount.mockResolvedValue([
      {
        signalId: 's1',
        accountId,
        tenantId,
        signalType: 'RENEWAL',
        status: SignalStatus.ACTIVE,
        createdAt: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(),
        updatedAt: new Date().toISOString(),
      } as any,
    ]);
    mockDynamoDBDocumentClient.send
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});
    const heat = await service.computeAndStoreHeat(tenantId, accountId);
    expect(heat.factors?.signal_recency).toBe(0.4);
  });

  it('computeAndStoreHeat signalRecencyToScore: 48h ago yields 0.1', async () => {
    getPostureState.mockResolvedValue({ ...basePosture, posture: PostureState.OK });
    getSignalsForAccount.mockResolvedValue([
      {
        signalId: 's1',
        accountId,
        tenantId,
        signalType: 'RENEWAL',
        status: SignalStatus.ACTIVE,
        createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
        updatedAt: new Date().toISOString(),
      } as any,
    ]);
    mockDynamoDBDocumentClient.send
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});
    const heat = await service.computeAndStoreHeat(tenantId, accountId);
    expect(heat.factors?.signal_recency).toBe(0.1);
  });

  it('computeAndStoreHeat scoreToTier: rawScore >= 0.7 yields HOT', async () => {
    getPostureState.mockResolvedValue({ ...basePosture, posture: PostureState.EXPAND });
    getSignalsForAccount.mockResolvedValue([
      {
        signalId: 's1',
        accountId,
        tenantId,
        signalType: 'RENEWAL',
        status: SignalStatus.ACTIVE,
        createdAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
        updatedAt: new Date().toISOString(),
      } as any,
    ]);
    mockDynamoDBDocumentClient.send
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});
    const heat = await service.computeAndStoreHeat(tenantId, accountId);
    expect(heat.heat_tier).toBe('HOT');
  });

  it('computeAndStoreHeat scoreToTier: low score yields COLD', async () => {
    getPostureState.mockResolvedValue({ ...basePosture, posture: PostureState.DORMANT });
    getSignalsForAccount.mockResolvedValue([]);
    mockDynamoDBDocumentClient.send
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});
    const heat = await service.computeAndStoreHeat(tenantId, accountId);
    expect(heat.heat_tier).toBe('COLD');
  });

  it('computeAndStoreHeat hysteresis: keeps previous tier when demotion within cooldown', async () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    getPostureState.mockResolvedValue({ ...basePosture, posture: PostureState.WATCH });
    getSignalsForAccount.mockResolvedValue([
      {
        signalId: 's1',
        accountId,
        tenantId,
        signalType: 'RENEWAL',
        status: SignalStatus.ACTIVE,
        createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
        updatedAt: new Date().toISOString(),
      } as any,
    ]);
    mockDynamoDBDocumentClient.send
      .mockResolvedValueOnce({
        Item: {
          pk: `TENANT#${tenantId}#ACCOUNT#${accountId}`,
          sk: 'HEAT#LATEST',
          tenant_id: tenantId,
          account_id: accountId,
          heat_score: 0.8,
          heat_tier: 'HOT',
          computed_at: twoHoursAgo,
          updated_at: twoHoursAgo,
        },
      })
      .mockResolvedValueOnce({});
    const heat = await service.computeAndStoreHeat(tenantId, accountId);
    expect(heat.heat_tier).toBe('HOT');
  });

  it('computeAndStoreHeat hysteresis: demotes when hours since last computed >= cooldown', async () => {
    const fiveHoursAgo = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();
    getPostureState.mockResolvedValue({ ...basePosture, posture: PostureState.WATCH });
    getSignalsForAccount.mockResolvedValue([
      {
        signalId: 's1',
        accountId,
        tenantId,
        signalType: 'RENEWAL',
        status: SignalStatus.ACTIVE,
        createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
        updatedAt: new Date().toISOString(),
      } as any,
    ]);
    mockDynamoDBDocumentClient.send
      .mockResolvedValueOnce({
        Item: {
          pk: `TENANT#${tenantId}#ACCOUNT#${accountId}`,
          sk: 'HEAT#LATEST',
          tenant_id: tenantId,
          account_id: accountId,
          heat_score: 0.8,
          heat_tier: 'HOT',
          computed_at: fiveHoursAgo,
          updated_at: fiveHoursAgo,
        },
      })
      .mockResolvedValueOnce({});
    const heat = await service.computeAndStoreHeat(tenantId, accountId);
    expect(heat.heat_tier).toBe('WARM');
  });
});
