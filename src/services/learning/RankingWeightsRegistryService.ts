/**
 * Phase 5.5 — Ranking weights registry: DDB storage, conditional updates, ledger on promote/rollback.
 * Production ranking only uses weights for active_version; resolution order: tenant → GLOBAL.
 */

import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { Logger } from '../core/Logger';
import type { RankingWeightsRegistryV1, RankingWeightsV1 } from '../../types/learning/LearningTypes';
import { LedgerEventType } from '../../types/LedgerTypes';
import type { ILedgerService } from '../../types/LedgerTypes';
import type { IRankingWeightsRegistry } from './IRankingWeightsRegistry';

const REGISTRY_SK = 'REGISTRY';
const WEIGHTS_SK_PREFIX = 'WEIGHTS#';

function pk(tenantId: string): string {
  return `TENANT#${tenantId}`;
}

function weightsSk(version: string): string {
  return `${WEIGHTS_SK_PREFIX}${version}`;
}

export class RankingWeightsRegistryService implements IRankingWeightsRegistry {
  constructor(
    private dynamoClient: DynamoDBDocumentClient,
    private tableName: string,
    private logger: Logger,
    private ledgerService?: ILedgerService
  ) {}

  async getRegistry(tenantId: string): Promise<RankingWeightsRegistryV1 | null> {
    const result = await this.dynamoClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { pk: pk(tenantId), sk: REGISTRY_SK },
      })
    );
    if (!result.Item) return null;
    const { pk: _p, sk: _s, ...reg } = result.Item as Record<string, unknown>;
    return reg as unknown as RankingWeightsRegistryV1;
  }

  async resolveActiveVersion(tenantId: string): Promise<string | null> {
    const tenantReg = await this.getRegistry(tenantId);
    if (tenantReg?.active_version) return tenantReg.active_version;
    const globalReg = await this.getRegistry('GLOBAL');
    return globalReg?.active_version ?? null;
  }

  async getWeights(tenantId: string, version: string): Promise<RankingWeightsV1 | null> {
    const result = await this.dynamoClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { pk: pk(tenantId), sk: weightsSk(version) },
      })
    );
    if (!result.Item) return null;
    const { pk: _p, sk: _s, ...w } = result.Item as Record<string, unknown>;
    return w as unknown as RankingWeightsV1;
  }

  async putWeights(weights: RankingWeightsV1): Promise<void> {
    const item = {
      pk: pk(weights.tenant_id),
      sk: weightsSk(weights.version),
      ...weights,
    };
    await this.dynamoClient.send(
      new PutCommand({ TableName: this.tableName, Item: item })
    );
    this.logger.debug('Ranking weights stored', {
      tenant_id: weights.tenant_id,
      version: weights.version,
    });
  }

  async setCandidate(tenantId: string, version: string): Promise<void> {
    const key = { pk: pk(tenantId), sk: REGISTRY_SK };
    const existing = await this.getRegistry(tenantId);
    const now = new Date().toISOString();
    if (!existing) {
      await this.dynamoClient.send(
        new PutCommand({
          TableName: this.tableName,
          Item: {
            ...key,
            tenant_id: tenantId,
            active_version: version,
            candidate_version: version,
            status: 'CANDIDATE',
            activated_at: now,
            activated_by: 'initial',
          },
        })
      );
      return;
    }
    await this.dynamoClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: key,
        UpdateExpression: 'SET candidate_version = :v, #st = :st',
        ExpressionAttributeNames: { '#st': 'status' },
        ExpressionAttributeValues: { ':v': version, ':st': 'CANDIDATE' },
      })
    );
  }

  async promoteCandidateToActive(tenantId: string, activatedBy: string): Promise<void> {
    const reg = await this.getRegistry(tenantId);
    if (!reg?.candidate_version) {
      throw new Error(`No candidate_version for tenant ${tenantId}`);
    }
    const previousActive = reg.active_version;
    const newActive = reg.candidate_version;
    const now = new Date().toISOString();
    await this.dynamoClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { pk: pk(tenantId), sk: REGISTRY_SK },
        ConditionExpression: 'candidate_version = :cand',
        UpdateExpression:
          'SET active_version = :new, candidate_version = :cand, #st = :act, activated_at = :now, activated_by = :by',
        ExpressionAttributeNames: { '#st': 'status' },
        ExpressionAttributeValues: {
          ':cand': newActive,
          ':new': newActive,
          ':act': 'ACTIVE',
          ':now': now,
          ':by': activatedBy,
        },
      })
    );
    if (this.ledgerService) {
      const traceId = `registry-${tenantId}-${Date.now()}`;
      await this.ledgerService.append({
        tenantId,
        traceId,
        eventType: LedgerEventType.RANKING_WEIGHTS_PROMOTED,
        data: {
          tenant_id: tenantId,
          previous_active_version: previousActive,
          new_active_version: newActive,
          activated_by: activatedBy,
        },
      });
    }
    this.logger.info('Ranking weights promoted to active', {
      tenant_id: tenantId,
      new_active_version: newActive,
      activated_by: activatedBy,
    });
  }

  async rollback(tenantId: string, targetVersion: string, activatedBy: string): Promise<void> {
    const reg = await this.getRegistry(tenantId);
    if (!reg) throw new Error(`No registry for tenant ${tenantId}`);
    const previousActive = reg.active_version;
    const now = new Date().toISOString();
    await this.dynamoClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { pk: pk(tenantId), sk: REGISTRY_SK },
        ConditionExpression: 'active_version = :prev',
        UpdateExpression:
          'SET active_version = :target, #st = :st, activated_at = :now, activated_by = :by, rollback_of = :prev',
        ExpressionAttributeNames: { '#st': 'status' },
        ExpressionAttributeValues: {
          ':prev': previousActive,
          ':target': targetVersion,
          ':st': 'ROLLED_BACK',
          ':now': now,
          ':by': activatedBy,
        },
      })
    );
    if (this.ledgerService) {
      const traceId = `registry-${tenantId}-${Date.now()}`;
      await this.ledgerService.append({
        tenantId,
        traceId,
        eventType: LedgerEventType.RANKING_WEIGHTS_ROLLED_BACK,
        data: {
          tenant_id: tenantId,
          rolled_back_from: previousActive,
          new_active_version: targetVersion,
          activated_by: activatedBy,
        },
      });
    }
    this.logger.info('Ranking weights rolled back', {
      tenant_id: tenantId,
      from: previousActive,
      to: targetVersion,
      activated_by: activatedBy,
    });
  }
}
