/**
 * Heat Scoring Handler - Phase 5.3
 *
 * Recomputes account heat from posture + signals; writes latest only (HEAT#LATEST).
 * Triggered by: EventBridge schedule (periodic) or SIGNAL_DETECTED (on signal arrival).
 * Input: { tenantId, accountId? } or { tenantId, accountIds? }.
 */

import { Handler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { getAWSClientConfig } from '../../utils/aws-client-config';
import { Logger } from '../../services/core/Logger';
import { AccountPostureStateService } from '../../services/synthesis/AccountPostureStateService';
import { SignalService } from '../../services/perception/SignalService';
import { HeatScoringService } from '../../services/perception/HeatScoringService';
import { HeatTierPolicyService } from '../../services/perception/HeatTierPolicyService';
import { SignalStatus } from '../../types/SignalTypes';

const logger = new Logger('HeatScoringHandler');
const region = process.env.AWS_REGION || 'us-west-2';
const clientConfig = getAWSClientConfig(region);
const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient(clientConfig), {
  marshallOptions: { removeUndefinedValues: true },
});

const perceptionSchedulerTableName =
  process.env.PERCEPTION_SCHEDULER_TABLE_NAME || 'cc-native-perception-scheduler';
const accountPostureStateTableName =
  process.env.ACCOUNT_POSTURE_STATE_TABLE_NAME || 'cc-native-account-posture-state';
const signalsTableName = process.env.SIGNALS_TABLE_NAME || 'cc-native-signals';

const accountPostureStateService = new AccountPostureStateService({
  dynamoClient,
  tableName: accountPostureStateTableName,
});

const signalService = new SignalService({
  logger,
  signalsTableName,
  region,
});

const heatTierPolicyService = new HeatTierPolicyService();
const heatScoringService = new HeatScoringService({
  dynamoClient,
  tableName: perceptionSchedulerTableName,
  getPostureState: (accountId: string, tenantId: string) =>
    accountPostureStateService.getPostureState(accountId, tenantId),
  getSignalsForAccount: (accountId: string, tenantId: string, filters?) =>
    signalService.getSignalsForAccount(accountId, tenantId, { ...filters, status: SignalStatus.ACTIVE }),
  heatTierPolicyService,
  logger,
});

export interface HeatScoringEvent {
  tenantId?: string;
  accountId?: string;
  accountIds?: string[];
  /** EventBridge envelope: detail may contain accountId/tenantId (e.g. SIGNAL_DETECTED). */
  'detail-type'?: string;
  detail?: { tenantId?: string; accountId?: string; tenant_id?: string; account_id?: string };
}

function normalizeEvent(event: HeatScoringEvent): { tenantId: string; accountIds: string[] } | null {
  const tenantId =
    event.tenantId ??
    event.detail?.tenantId ??
    event.detail?.tenant_id;
  const singleAccount =
    event.accountId ??
    event.detail?.accountId ??
    event.detail?.account_id;
  const accountIds = event.accountIds
    ? event.accountIds
    : singleAccount
      ? [singleAccount]
      : [];
  if (!tenantId || accountIds.length === 0) return null;
  return { tenantId, accountIds };
}

export const handler: Handler<HeatScoringEvent> = async (event) => {
  const normalized = normalizeEvent(event);
  if (!normalized) {
    logger.warn('Heat scoring skipped: missing tenantId or accountId(s)');
    return { computed: 0, errors: [] };
  }
  const { tenantId, accountIds } = normalized;

  if (accountIds.length === 0) {
    logger.warn('Heat scoring skipped: no accountId or accountIds');
    return { computed: 0, errors: [] };
  }

  let computed = 0;
  const errors: { accountId: string; error: string }[] = [];

  for (const accountId of accountIds) {
    try {
      await heatScoringService.computeAndStoreHeat(tenantId, accountId);
      computed++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('Heat scoring failed for account', { tenantId, accountId, error: message });
      errors.push({ accountId, error: message });
    }
  }

  logger.info('Heat scoring completed', { tenantId, computed, total: accountIds.length, errors: errors.length });
  return { computed, errors };
};
