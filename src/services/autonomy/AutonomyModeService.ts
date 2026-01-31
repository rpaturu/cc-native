/**
 * Autonomy Mode Service - Phase 5.1
 *
 * Resolves and persists autonomy mode config (per-tenant, per-account, per-action-type).
 * Default: APPROVAL_REQUIRED when no config is found.
 */

import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import {
  AutonomyMode,
  AutonomyModeConfigV1,
} from '../../types/autonomy/AutonomyTypes';
import { Logger } from '../core/Logger';

const POLICY_VERSION = 'AutonomyModeConfigV1';

function pkTenant(tenantId: string): string {
  return `TENANT#${tenantId}`;
}

function pkTenantAccount(tenantId: string, accountId: string): string {
  return `TENANT#${tenantId}#ACCOUNT#${accountId}`;
}

function skAction(actionType: string): string {
  return `AUTONOMY#${actionType}`;
}

const SK_DEFAULT = 'AUTONOMY#DEFAULT';

export class AutonomyModeService {
  constructor(
    private dynamoClient: DynamoDBDocumentClient,
    private tableName: string,
    private logger: Logger
  ) {}

  /**
   * Resolve effective mode by precedence (first match wins):
   * (1) account + action_type, (2) tenant + action_type, (3) account + DEFAULT, (4) tenant + DEFAULT, (5) APPROVAL_REQUIRED.
   */
  async getMode(
    tenantId: string,
    accountId: string,
    actionType: string
  ): Promise<AutonomyMode> {
    const candidates: { pk: string; sk: string }[] = [
      { pk: pkTenantAccount(tenantId, accountId), sk: skAction(actionType) },
      { pk: pkTenant(tenantId), sk: skAction(actionType) },
      { pk: pkTenantAccount(tenantId, accountId), sk: SK_DEFAULT },
      { pk: pkTenant(tenantId), sk: SK_DEFAULT },
    ];

    for (const { pk, sk } of candidates) {
      const item = await this.getConfigItem(pk, sk);
      if (item?.mode) {
        return item.mode as AutonomyMode;
      }
    }

    return 'APPROVAL_REQUIRED';
  }

  /**
   * Get a single config item by pk/sk.
   */
  async getConfigItem(
    pk: string,
    sk: string
  ): Promise<AutonomyModeConfigV1 | null> {
    const result = await this.dynamoClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { pk, sk },
      })
    );
    return (result.Item as AutonomyModeConfigV1) || null;
  }

  /**
   * Write config item. Caller should append to ledger for audit if needed.
   */
  async putConfig(item: AutonomyModeConfigV1): Promise<void> {
    const withVersion = {
      ...item,
      policy_version: item.policy_version || POLICY_VERSION,
      updated_at: item.updated_at || new Date().toISOString(),
    };
    await this.dynamoClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: withVersion,
      })
    );
    this.logger.debug('Autonomy mode config written', {
      pk: item.pk,
      sk: item.sk,
      mode: item.mode,
    });
  }

  /**
   * List configs for tenant, optionally scoped to account.
   * Uses Query on pk (tenant or tenant#account).
   */
  async listConfigs(
    tenantId: string,
    accountId?: string
  ): Promise<AutonomyModeConfigV1[]> {
    const pk = accountId
      ? pkTenantAccount(tenantId, accountId)
      : pkTenant(tenantId);
    const result = await this.dynamoClient.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'pk = :pk',
        ExpressionAttributeValues: { ':pk': pk },
      })
    );
    return (result.Items || []) as AutonomyModeConfigV1[];
  }
}
