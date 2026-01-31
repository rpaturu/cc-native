/**
 * Auto-Execute Allowlist Service - Phase 5.4
 *
 * Resolves allowlist of action_type values that may auto-execute (hard stop before policy/budget).
 * Stored in autonomy config table; per-tenant or per-tenant+account.
 */

import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { AutoExecuteAllowListV1 } from '../../types/autonomy/AutonomyTypes';
import { Logger } from '../core/Logger';

const SK_ALLOWLIST = 'ALLOWLIST#AUTO_EXEC';

function pkTenant(tenantId: string): string {
  return `TENANT#${tenantId}`;
}

function pkTenantAccount(tenantId: string, accountId: string): string {
  return `TENANT#${tenantId}#ACCOUNT#${accountId}`;
}

export class AutoExecuteAllowListService {
  constructor(
    private dynamoClient: DynamoDBDocumentClient,
    private tableName: string,
    private logger: Logger
  ) {}

  /**
   * Get allowlist: account-level first, then tenant-level. Returns empty array if none (no auto-exec allowed).
   */
  async getAllowlist(tenantId: string, accountId?: string): Promise<string[]> {
    if (accountId) {
      const accountItem = await this.getAllowlistItem(pkTenantAccount(tenantId, accountId));
      if (accountItem?.action_types?.length) {
        return accountItem.action_types;
      }
    }
    const tenantItem = await this.getAllowlistItem(pkTenant(tenantId));
    return tenantItem?.action_types ?? [];
  }

  /**
   * Check if action_type is allowlisted for tenant (and optional account).
   */
  async isAllowlisted(tenantId: string, actionType: string, accountId?: string): Promise<boolean> {
    const list = await this.getAllowlist(tenantId, accountId);
    return list.includes(actionType);
  }

  private async getAllowlistItem(pk: string): Promise<AutoExecuteAllowListV1 | null> {
    const result = await this.dynamoClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { pk, sk: SK_ALLOWLIST },
      })
    );
    return (result.Item as AutoExecuteAllowListV1) ?? null;
  }

  /**
   * Put allowlist (admin API or bootstrap). Per-tenant or per-tenant+account.
   */
  async putAllowlist(config: {
    tenant_id: string;
    account_id?: string;
    action_types: string[];
  }): Promise<void> {
    const pk = config.account_id
      ? pkTenantAccount(config.tenant_id, config.account_id)
      : pkTenant(config.tenant_id);
    const item: AutoExecuteAllowListV1 = {
      pk,
      sk: SK_ALLOWLIST,
      tenant_id: config.tenant_id,
      account_id: config.account_id,
      action_types: config.action_types,
      updated_at: new Date().toISOString(),
    };
    await this.dynamoClient.send(
      new PutCommand({ TableName: this.tableName, Item: item })
    );
    this.logger.debug('Auto-execute allowlist written', {
      tenant_id: config.tenant_id,
      account_id: config.account_id,
      count: config.action_types.length,
    });
  }
}
